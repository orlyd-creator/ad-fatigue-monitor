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
import { accounts, ads } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";

const MAX_AGE_MS = 5 * 60 * 1000;           // 5 min freshness ceiling
const MIN_INTERVAL_MS = 60 * 1000;          // at most once per minute per account

// in-process dedupe
const lastRunByAccount = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

async function refreshOneAccount(accountId: string, token: string): Promise<void> {
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  try {
    const url = `https://graph.facebook.com/v21.0/${actId}/ads?fields=id,status,effective_status&effective_status=${encodeURIComponent(
      JSON.stringify([
        "ACTIVE", "PAUSED", "DELETED", "PENDING_REVIEW", "DISAPPROVED",
        "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ARCHIVED",
        "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES",
      ]),
    )}&limit=500&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const body = await res.json();
    const now = Date.now();
    for (const row of (body.data || []) as Array<{
      id: string; status?: string; effective_status?: string;
    }>) {
      const newStatus = row.effective_status || row.status;
      if (!row.id || !newStatus) continue;
      await db.run(sql`UPDATE ads SET status = ${newStatus}, last_synced_at = ${now} WHERE id = ${row.id} AND status != ${newStatus}`);
    }
  } catch (err) {
    console.warn(`[statusRefresh] ${accountId} failed:`, err);
  }
}

export async function refreshAdStatusesForAccounts(accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  const now = Date.now();

  // Filter to accounts we haven't hit in the last MIN_INTERVAL_MS
  const toRefresh = accountIds.filter(
    (id) => !lastRunByAccount.has(id) || now - (lastRunByAccount.get(id) || 0) > MIN_INTERVAL_MS,
  );
  if (toRefresh.length === 0) return;

  // Also skip if the freshest ad in this account is younger than MAX_AGE_MS.
  // Cheap single SELECT MAX.
  const rows = await db
    .select({ id: ads.accountId, maxAt: sql<number>`MAX(${ads.lastSyncedAt})` })
    .from(ads)
    .where(inArray(ads.accountId, toRefresh))
    .groupBy(ads.accountId)
    .all();
  const maxByAccount = new Map(rows.map((r) => [r.id, r.maxAt || 0]));

  const actuallyStale = toRefresh.filter((id) => {
    const last = maxByAccount.get(id) || 0;
    return now - last > MAX_AGE_MS;
  });
  if (actuallyStale.length === 0) {
    // Mark even fresh ones so we don't re-check for a minute
    for (const id of toRefresh) lastRunByAccount.set(id, now);
    return;
  }

  const acctRows = await db.select().from(accounts).where(inArray(accounts.id, actuallyStale)).all();
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
