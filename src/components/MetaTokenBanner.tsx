import Link from "next/link";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

/**
 * Shows a loud "Reconnect Meta" banner when any of the user's Meta tokens
 * have expired. Without this, the auto-sync silently skips expired-token
 * accounts and the dashboard just sits empty with no explanation.
 *
 * Renders nothing when tokens are healthy, so it's safe to drop on any page.
 */
export default async function MetaTokenBanner({ accountIds }: { accountIds: string[] }) {
  if (accountIds.length === 0) return null;

  const rows = await db
    .select({ id: accounts.id, name: accounts.name, tokenExpiresAt: accounts.tokenExpiresAt })
    .from(accounts)
    .where(inArray(accounts.id, accountIds))
    .all();

  const now = Date.now();
  const expired = rows.filter((a) => a.tokenExpiresAt < now);
  if (expired.length === 0) return null;

  const label =
    expired.length === 1
      ? `Your Meta connection for "${expired[0].name}" expired.`
      : `${expired.length} of your Meta accounts have expired tokens.`;

  return (
    <div className="mb-4 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-rose-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100">
          <svg className="h-5 w-5 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-foreground">{label}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            Auto-refresh can't pull new data until you reconnect. Your dashboard will stay empty until then.
          </div>
          <Link
            href="/login"
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:shadow-md active:scale-[0.98]"
          >
            Reconnect Meta
          </Link>
        </div>
      </div>
    </div>
  );
}
