/**
 * On-demand ad status refresh.
 *
 * The auto-sync loop usually catches paused ads within 2 min, but if Railway
 * restarts or the user is looking at a stale render we don't want any ad to
 * ever show as ACTIVE when Meta says PAUSED.
 *
 * This helper lets any page call `refreshAdStatusesForAccounts()` before
 * querying ads. It's idempotent, fast, and deduplicated so hot pages can't
 * hammer Meta.
 */
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";

const MAX_AGE_MS = 90 * 1000;               // 90 sec freshness ceiling
const MIN_INTERVAL_MS = 30 * 1000;          // at most once per 30s per account

// in-process dedupe
const lastRunByAccount = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

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

    // Unconditional update: always write status + lastSyncedAt so even
    // same-status rows refresh their timestamp. Avoids the bug where a
    // "no-op" WHERE clause skips the write and the row looks stale forever.
    const now = Date.now();
    let changed = 0;
    for (const row of all) {
      const newStatus = row.effective_status || row.status;
      if (!row.id || !newStatus) continue;
      await db.run(sql`UPDATE ads SET status = ${newStatus}, last_synced_at = ${now} WHERE id = ${row.id}`);
      changed++;
    }
    console.log(`[statusRefresh] ${accountId}: scanned ${all.length} ads, wrote ${changed}`);
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
