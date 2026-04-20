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
