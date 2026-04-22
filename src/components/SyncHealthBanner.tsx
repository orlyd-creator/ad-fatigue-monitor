import Link from "next/link";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { createClient } from "@libsql/client";

/**
 * Shows the real status of the most recent auto-sync tick for each of
 * the user's accounts. If any recent run failed, shows the error text
 * and a Reconnect CTA. No more silent empty dashboards.
 *
 * Reads the sync_runs table directly (created in instrumentation.ts).
 * If the table is missing (first boot after this deploy) we swallow
 * the error and show nothing — by the 10-min tick it'll populate.
 */
export default async function SyncHealthBanner({ accountIds }: { accountIds: string[] }) {
  if (accountIds.length === 0) return null;

  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, tokenExpiresAt: accounts.tokenExpiresAt })
    .from(accounts)
    .where(inArray(accounts.id, accountIds))
    .all();
  if (accountRows.length === 0) return null;

  // Read the latest sync_runs row per account
  type Run = {
    account_id: string | null;
    started_at: number;
    finished_at: number;
    success: number;
    ads_found: number;
    metrics_upserted: number;
    errors: string | null;
  };
  let latestByAccount = new Map<string, Run>();
  try {
    const c = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:sqlite.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const res = await c.execute({
      sql: `SELECT account_id, started_at, finished_at, success, ads_found, metrics_upserted, errors
            FROM sync_runs
            WHERE account_id IN (${accountIds.map(() => "?").join(",")})
              AND mode = 'full'
            ORDER BY finished_at DESC
            LIMIT 50`,
      args: accountIds,
    });
    for (const row of res.rows as unknown as Run[]) {
      if (!row.account_id) continue;
      if (!latestByAccount.has(row.account_id)) {
        latestByAccount.set(row.account_id, row);
      }
    }
  } catch {
    return null; // table not yet created, stay silent
  }

  const failing: Array<{ name: string; error: string; minutesAgo: number; tokenExpired: boolean }> = [];
  const now = Date.now();
  for (const acc of accountRows) {
    const run = latestByAccount.get(acc.id);
    if (!run) continue;
    if (run.success) continue;
    let errText = "Last auto-sync failed";
    if (run.errors) {
      try {
        const arr = JSON.parse(run.errors);
        if (Array.isArray(arr) && arr.length > 0) errText = String(arr[0]);
      } catch {}
    }
    failing.push({
      name: acc.name,
      error: errText,
      minutesAgo: Math.max(0, Math.floor((now - run.finished_at) / 60000)),
      tokenExpired: acc.tokenExpiresAt < now || /token expired|reconnect/i.test(errText),
    });
  }

  if (failing.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-rose-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100">
          <svg className="h-5 w-5 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-foreground">
            {failing.length === 1
              ? `Auto-sync for "${failing[0].name}" is failing`
              : `Auto-sync is failing for ${failing.length} accounts`}
          </div>
          <ul className="mt-2 space-y-1">
            {failing.map((f, i) => (
              <li key={i} className="text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">{f.name}</span>
                {" · "}
                {f.minutesAgo === 0 ? "just now" : `${f.minutesAgo}m ago`}
                {" · "}
                <span className="text-rose-700">{f.error}</span>
              </li>
            ))}
          </ul>
          {failing.some((f) => f.tokenExpired) && (
            <Link
              href="/login"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:shadow-md active:scale-[0.98]"
            >
              Reconnect Meta
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
