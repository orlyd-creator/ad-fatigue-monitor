/**
 * On-demand ad status refresh.
 *
 * The auto-sync loop usually catches paused ads within 2 min, but if Railway
 * restarts or the user is looking at a stale render we don't want any ad to
 * ever show as ACTIVE when Meta says PAUSED.
 *
 * Two layers of defense (cheapest first):
 *   1. verifyActiveAdStatuses(): targeted batch lookup of every ad currently
 *      flagged ACTIVE in our DB. Uses Meta's `?ids=A,B,C` endpoint (50/req).
 *      Tiny request, can't fail mid-pagination, can't miss the very ad you
 *      just paused. This is the layer that fixes "ad still showing ACTIVE
 *      days after pause."
 *   2. refreshAdStatusesForAccounts(): bulk paginate every ad in the account
 *      (up to 20k). Used by full sync. Heavy, can hit transient pagination
 *      failures, has a coverage safeguard so it can't nuke the dashboard.
 *
 * Public pages call layer 1 every load (fast). The 10-min auto-sync runs
 * layer 2 (thorough). Together: a paused ad goes stale in ≤30s in the UI
 * regardless of where the bulk fetch is in its retry loop.
 */
import { db } from "@/lib/db";
import { accounts, ads } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

const MIN_INTERVAL_MS = 15 * 1000;          // bulk refresh: at most once per 15s per account
const VERIFY_INTERVAL_MS = 10 * 1000;       // verifyActive: at most once per 10s per account
const VERIFY_BATCH_SIZE = 50;               // Meta `?ids=` endpoint accepts up to 50 IDs

// in-process dedupe
const lastRunByAccount = new Map<string, number>();
const lastVerifyByAccount = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
const inFlightVerify = new Map<string, Promise<void>>();

// Fetch with retry on 429/5xx. Transient Meta failures used to silently
// break out of pagination, leaving later-page ads stuck on their stale
// status. Retry with exponential backoff, give up after 3 attempts.
async function fetchWithRetry(url: string, attempts = 3): Promise<Response | null> {
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url).catch(() => null);
    if (!res) { lastStatus = 0; }
    else if (res.ok) return res;
    else {
      lastStatus = res.status;
      // Only retry on transient failures (429 rate limit, 5xx).
      if (res.status !== 429 && res.status < 500) return res;
    }
    if (i < attempts - 1) {
      await new Promise(r => setTimeout(r, 300 * Math.pow(2, i)));
    }
  }
  console.warn(`[statusRefresh] giving up after ${attempts} attempts (last status ${lastStatus})`);
  return null;
}

/**
 * Targeted verification: for every ad currently marked ACTIVE in our DB for
 * the given account, query Meta directly for its current effective_status
 * via the batch IDs endpoint. Updates the DB if Meta says different.
 *
 * Why this exists: bulk pagination can lose an ad on a transiently-failed
 * page, leaving a paused ad stuck as ACTIVE in the UI. This function ONLY
 * looks at ads we currently believe to be ACTIVE (small set, usually <100),
 * so each batch request is small and we can't "miss" anything.
 *
 * If Meta returns no row for an ad we asked about, that means the ad was
 * deleted on the Meta side — we mark it ARCHIVED.
 */
async function verifyOneAccount(accountId: string, token: string): Promise<void> {
  try {
    const activeAds = await db
      .select({ id: ads.id })
      .from(ads)
      .where(eq(ads.accountId, accountId))
      .all();
    const activeIds = activeAds
      .map(a => a.id)
      .filter(id => !id.startsWith("__unattributed_"));
    if (activeIds.length === 0) return;

    // Filter further to only ads currently marked ACTIVE in DB. We re-query
    // to get the status column, which we didn't pull above to keep the row
    // payload small.
    const withStatus = await db
      .select({ id: ads.id, status: ads.status })
      .from(ads)
      .where(inArray(ads.id, activeIds))
      .all();
    const toCheck = withStatus.filter(a => a.status === "ACTIVE").map(a => a.id);
    if (toCheck.length === 0) return;

    const now = Date.now();
    let changed = 0;
    let archived = 0;
    let errors = 0;

    // Batch in chunks of 50 (Meta's hard limit for ?ids=).
    for (let i = 0; i < toCheck.length; i += VERIFY_BATCH_SIZE) {
      const chunk = toCheck.slice(i, i + VERIFY_BATCH_SIZE);
      const idsParam = encodeURIComponent(chunk.join(","));
      const url = `https://graph.facebook.com/v21.0/?ids=${idsParam}&fields=id,status,effective_status&access_token=${token}`;
      const res = await fetchWithRetry(url);
      if (!res) {
        errors++;
        continue;
      }
      if (!res.ok) {
        // 400 with "object does not exist" means at least one of the ids
        // is gone from Meta. Re-query each id individually so we can mark
        // the dead ones ARCHIVED without losing the live ones.
        const body: { error?: { code?: number; error_subcode?: number } } | null =
          await res.json().catch(() => null);
        const code = body?.error?.code;
        const subcode = body?.error?.error_subcode;
        // 100 = generic invalid arg (often a deleted id), 803 = ID resolution
        // failure. Fall back to per-id query.
        if (code === 100 || code === 803) {
          for (const id of chunk) {
            const single = await fetchWithRetry(
              `https://graph.facebook.com/v21.0/${id}?fields=id,status,effective_status&access_token=${token}`,
            );
            if (!single) { errors++; continue; }
            if (!single.ok) {
              // Truly missing — mark archived so it stops appearing in the
              // active filter.
              await db.run(sql`UPDATE ads SET status = 'ARCHIVED', last_synced_at = ${now} WHERE id = ${id}`);
              archived++;
              continue;
            }
            const sb: { status?: string; effective_status?: string } | null = await single.json().catch(() => null);
            const newStatus = sb?.effective_status || sb?.status;
            if (newStatus && newStatus !== "ACTIVE") {
              await db.run(sql`UPDATE ads SET status = ${newStatus}, last_synced_at = ${now} WHERE id = ${id}`);
              changed++;
            } else if (newStatus === "ACTIVE") {
              // Still active per Meta — bump last_synced_at so freshness
              // pills reflect that we just verified.
              await db.run(sql`UPDATE ads SET last_synced_at = ${now} WHERE id = ${id}`);
            }
          }
          continue;
        }
        console.warn(`[statusRefresh] verify chunk HTTP ${res.status} code=${code} subcode=${subcode}, skipping`);
        errors++;
        continue;
      }

      const body: Record<string, { id?: string; status?: string; effective_status?: string }> = await res.json();
      // Meta returns an object keyed by id: { "123": {status, effective_status}, ... }.
      // Any id we asked for that isn't a key in the response is gone — archive it.
      const returned = new Set(Object.keys(body || {}));
      for (const id of chunk) {
        if (!returned.has(id)) {
          await db.run(sql`UPDATE ads SET status = 'ARCHIVED', last_synced_at = ${now} WHERE id = ${id}`);
          archived++;
          continue;
        }
        const row = body[id];
        const newStatus = row?.effective_status || row?.status;
        if (!newStatus) continue;
        if (newStatus !== "ACTIVE") {
          await db.run(sql`UPDATE ads SET status = ${newStatus}, last_synced_at = ${now} WHERE id = ${id}`);
          changed++;
        } else {
          // Still active — refresh last_synced_at.
          await db.run(sql`UPDATE ads SET last_synced_at = ${now} WHERE id = ${id}`);
        }
      }
    }

    if (changed > 0 || archived > 0) {
      console.log(`[statusRefresh] verifyActive ${accountId}: checked ${toCheck.length}, ${changed} status changed, ${archived} archived, ${errors} errors`);
    }
  } catch (err) {
    console.warn(`[statusRefresh] verifyActive ${accountId} failed:`, err);
  }
}

/**
 * Public entry: targeted verification of every currently-ACTIVE ad across
 * the given accounts. Cheap and fast (~50 ads per Meta request). Call this
 * before rendering pages that filter to active ads.
 */
export async function verifyActiveAdStatuses(accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  const now = Date.now();
  const toRefresh = accountIds.filter(
    (id) => !lastVerifyByAccount.has(id) || now - (lastVerifyByAccount.get(id) || 0) > VERIFY_INTERVAL_MS,
  );
  if (toRefresh.length === 0) return;

  const acctRows = await db.select().from(accounts).where(inArray(accounts.id, toRefresh)).all();
  await Promise.all(acctRows.map(async (a) => {
    if (a.tokenExpiresAt < now) return;
    const existing = inFlightVerify.get(a.id);
    if (existing) return existing;
    const p = verifyOneAccount(a.id, a.accessToken);
    inFlightVerify.set(a.id, p);
    try { await p; } finally {
      inFlightVerify.delete(a.id);
      lastVerifyByAccount.set(a.id, Date.now());
    }
  }));
}

async function refreshOneAccount(accountId: string, token: string): Promise<void> {
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  try {
    // Paginate through ALL ads in the account. Cap raised to 100 pages at
    // limit=200 (20k ads) to match paginateAll() in sync.ts, so a paused ad
    // past the first 5k can't stay ACTIVE forever.
    const all: Array<{ id: string; status?: string; effective_status?: string }> = [];
    let url: string | null =
      `https://graph.facebook.com/v21.0/${actId}/ads?fields=id,status,effective_status&effective_status=${encodeURIComponent(
        JSON.stringify([
          "ACTIVE", "PAUSED", "DELETED", "PENDING_REVIEW", "DISAPPROVED",
          "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ARCHIVED",
          "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES",
        ]),
      )}&limit=200&access_token=${token}`;
    let pages = 0;
    while (url && pages < 100) {
      const res = await fetchWithRetry(url);
      if (!res) {
        console.warn(`[statusRefresh] ${accountId} stopped at page ${pages} (transient failure, retries exhausted)`);
        break;
      }
      if (!res.ok) {
        console.warn(`[statusRefresh] ${accountId} page ${pages} HTTP ${res.status}`);
        break;
      }
      const body: { data?: Array<{ id: string; status?: string; effective_status?: string }>; paging?: { next?: string } } = await res.json();
      for (const row of body.data || []) all.push(row);
      url = body.paging?.next || null;
      pages++;
    }
    if (url) {
      console.warn(`[statusRefresh] ${accountId} truncated at page cap (>20k ads, increase cap if this account ever reaches it)`);
    }

    // PASS 1: Write the status we got from Meta for every returned ad.
    // Unconditional UPDATE so same-status rows still refresh last_synced_at.
    const now = Date.now();
    const seenIds = new Set<string>();
    let changed = 0;
    for (const row of all) {
      const newStatus = row.effective_status || row.status;
      if (!row.id || !newStatus) continue;
      seenIds.add(row.id);
      await db.run(sql`UPDATE ads SET status = ${newStatus}, last_synced_at = ${now} WHERE id = ${row.id}`);
      changed++;
    }

    // PASS 2: RECONCILIATION — SAFEGUARDED.
    // Previous version auto-archived every ad missing from Meta's response.
    // That silently nuked Orly's entire dashboard when Meta paginated oddly
    // or rate-limited mid-fetch. Now we skip reconciliation unless we're
    // confident Meta returned a complete picture:
    //   1. Pagination did NOT hit the 100-page cap (url is falsy after loop)
    //   2. Meta returned at least 50% of the ads we have in DB for this account
    // If either check fails, leave statuses alone — the next /api/sync run
    // will write authoritative status from the fuller fetch.
    const dbAds = await db
      .select({ id: ads.id, status: ads.status })
      .from(ads)
      .where(eq(ads.accountId, accountId))
      .all();
    const truncated = Boolean(url);
    const coverage = dbAds.length > 0 ? all.length / dbAds.length : 1;
    let reconciled = 0;
    if (truncated || coverage < 0.5) {
      console.warn(`[statusRefresh] ${accountId}: SKIPPING reconciliation (truncated=${truncated}, coverage=${coverage.toFixed(2)}, Meta=${all.length}/DB=${dbAds.length}). Will rely on next full sync.`);
    } else {
      const staleIds: string[] = [];
      for (const a of dbAds) {
        if (seenIds.has(a.id)) continue;
        if (a.status === "ARCHIVED" || a.status === "DELETED") continue;
        staleIds.push(a.id);
      }
      if (staleIds.length > 0) {
        await db.run(sql`
          UPDATE ads SET status = 'ARCHIVED', last_synced_at = ${now}
          WHERE id IN (${sql.join(staleIds.map(id => sql`${id}`), sql`, `)})
        `);
        reconciled = staleIds.length;
      }
    }
    console.log(`[statusRefresh] ${accountId}: scanned ${all.length} ads, wrote ${changed}, reconciled ${reconciled} missing → ARCHIVED`);
  } catch (err) {
    console.warn(`[statusRefresh] ${accountId} failed:`, err);
  }
}

export async function refreshAdStatusesForAccounts(accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  const now = Date.now();

  // Dedupe window: per account, at most once every MIN_INTERVAL_MS regardless
  // of how fresh the DB looks. This keeps the refresh firing on every page
  // view up to the cap, even if a sync just ran.
  const toRefresh = accountIds.filter(
    (id) => !lastRunByAccount.has(id) || now - (lastRunByAccount.get(id) || 0) > MIN_INTERVAL_MS,
  );
  if (toRefresh.length === 0) return;

  const acctRows = await db.select().from(accounts).where(inArray(accounts.id, toRefresh)).all();
  await Promise.all(acctRows.map(async (a) => {
    if (a.tokenExpiresAt < now) return;
    const existing = inFlight.get(a.id);
    if (existing) return existing;
    const p = refreshOneAccount(a.id, a.accessToken);
    inFlight.set(a.id, p);
    try { await p; } finally {
      inFlight.delete(a.id);
      lastRunByAccount.set(a.id, Date.now());
    }
  }));
}
