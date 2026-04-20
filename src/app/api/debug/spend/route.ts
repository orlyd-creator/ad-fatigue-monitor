import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts, ads, dailyMetrics } from "@/lib/db/schema";
import { gte, lte, and, sql, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Debug spend — hit /api/debug/spend?from=2026-04-01&to=2026-04-20 (logged in).
 * Breaks down daily_metrics totals by account + unattributed vs real so we can
 * see exactly where the $27k-vs-$13.9k gap is coming from.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-04-01";
  const to = searchParams.get("to") || "2026-04-20";

  // All accounts in DB
  const allAccounts = await db.select().from(accounts).all();

  // Session's scoped account IDs
  const sessAccountIds: string[] = (session as any).allAccountIds || [];

  // For each account, sum spend by joining ads -> dailyMetrics
  const perAccount: Array<{ accountId: string; name: string; ads: number; realSpend: number; unattributedSpend: number; total: number }> = [];

  for (const acct of allAccounts) {
    const adsInAcct = await db.select({ id: ads.id }).from(ads).where(sql`${ads.accountId} = ${acct.id}`).all();
    const adIds = adsInAcct.map((a) => a.id);
    const realAdIds = adIds.filter((id) => !id.startsWith("__unattributed_"));
    const unAdIds = adIds.filter((id) => id.startsWith("__unattributed_"));

    const realSpend = realAdIds.length
      ? (
          await db
            .select({ s: sql<number>`COALESCE(SUM(${dailyMetrics.spend}), 0)` })
            .from(dailyMetrics)
            .where(and(gte(dailyMetrics.date, from), lte(dailyMetrics.date, to), inArray(dailyMetrics.adId, realAdIds)))
            .get()
        )?.s || 0
      : 0;

    const unSpend = unAdIds.length
      ? (
          await db
            .select({ s: sql<number>`COALESCE(SUM(${dailyMetrics.spend}), 0)` })
            .from(dailyMetrics)
            .where(and(gte(dailyMetrics.date, from), lte(dailyMetrics.date, to), inArray(dailyMetrics.adId, unAdIds)))
            .get()
        )?.s || 0
      : 0;

    perAccount.push({
      accountId: acct.id,
      name: acct.name,
      ads: adIds.length,
      realSpend: Math.round(realSpend * 100) / 100,
      unattributedSpend: Math.round(unSpend * 100) / 100,
      total: Math.round((realSpend + unSpend) * 100) / 100,
    });
  }

  // Orphan rows: dailyMetrics rows whose ad_id is NOT in the ads table at all.
  const orphan =
    (
      await db
        .select({ s: sql<number>`COALESCE(SUM(${dailyMetrics.spend}), 0)` })
        .from(dailyMetrics)
        .where(
          and(
            gte(dailyMetrics.date, from),
            lte(dailyMetrics.date, to),
            sql`${dailyMetrics.adId} NOT IN (SELECT id FROM ads)`,
          ),
        )
        .get()
    )?.s || 0;

  // Grand total
  const grand =
    (
      await db
        .select({ s: sql<number>`COALESCE(SUM(${dailyMetrics.spend}), 0)` })
        .from(dailyMetrics)
        .where(and(gte(dailyMetrics.date, from), lte(dailyMetrics.date, to)))
        .get()
    )?.s || 0;

  return NextResponse.json({
    range: { from, to },
    session: {
      accountId: (session as any).accountId,
      allAccountIds: sessAccountIds,
    },
    accountsInDb: allAccounts.length,
    perAccount,
    orphanSpend: Math.round(orphan * 100) / 100,
    grandTotalDailyMetrics: Math.round(grand * 100) / 100,
    note: "If grandTotal >> sum of perAccount.total, unattributed/orphan rows are being double-counted. If perAccount has multiple entries with non-trivial spend, the session is pulling from more accounts than you intended.",
  });
}
