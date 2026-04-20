import { db } from "@/lib/db";
import { ads, dailyMetrics } from "@/lib/db/schema";
import { inArray, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { format, startOfMonth, endOfMonth, subMonths, addMonths, isBefore } from "date-fns";
import { getLeadsFunnel } from "@/lib/hubspot/client";
import ExecutiveClient from "./ExecutiveClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Executive View — the "CEO dashboard". Plain-English summary of
 * money in → demos booked → qualified, with month-over-month deltas
 * and a six-month trend chart. Strips all technical signals
 * (fatigue scores, CTR, engagement, etc.).
 */
export default async function ExecutivePage() {
  const session = await auth();
  if (!session) redirect("/login");
  const accountId = (session as any).accountId as string;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = (session as any).allAccountIds || [accountId];

  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const sixMonthsAgoStart = startOfMonth(subMonths(now, 5));

  const rangeFromStr = format(sixMonthsAgoStart, "yyyy-MM-dd");
  const rangeToStr = format(now, "yyyy-MM-dd");

  const [allAds, metricsRaw, hubspotResult] = await Promise.all([
    db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all(),
    db.select().from(dailyMetrics).where(gte(dailyMetrics.date, rangeFromStr)).all(),
    getLeadsFunnel(rangeFromStr, rangeToStr).catch(err => {
      console.error("[executive] HubSpot fetch failed:", err);
      return null;
    }),
  ]);
  const allAdIds = new Set(allAds.map(a => a.id));
  const metrics = metricsRaw.filter(m => m.date <= rangeToStr && allAdIds.has(m.adId));

  // Build month buckets for the last 6 months
  type MonthBucket = {
    key: string;
    label: string;
    monthStart: Date;
    monthEnd: Date;
    spend: number;
    atm: number;
    sqls: number;
  };
  const buckets: MonthBucket[] = [];
  for (
    let cursor = sixMonthsAgoStart;
    isBefore(cursor, addMonths(thisMonthStart, 1));
    cursor = addMonths(cursor, 1)
  ) {
    buckets.push({
      key: format(cursor, "yyyy-MM"),
      label: format(cursor, "MMM yyyy"),
      monthStart: startOfMonth(cursor),
      monthEnd: endOfMonth(cursor),
      spend: 0,
      atm: 0,
      sqls: 0,
    });
  }

  // Aggregate Meta spend by month
  for (const m of metrics) {
    const d = new Date(m.date + "T00:00:00");
    const bucket = buckets.find(b => d >= b.monthStart && d <= b.monthEnd);
    if (bucket) bucket.spend += m.spend ?? 0;
  }

  // Aggregate HubSpot ATM by month (from the 49 ATM companies)
  // and SQL deals by month (from the 21 SQL deals by createdate — matches native report).
  if (hubspotResult) {
    for (const day of hubspotResult.dailyATM) {
      const d = new Date(day.date + "T00:00:00");
      const bucket = buckets.find(b => d >= b.monthStart && d <= b.monthEnd);
      if (bucket) bucket.atm += day.atm;
    }
    for (const day of hubspotResult.dailySQLDeals) {
      const d = new Date(day.date + "T00:00:00");
      const bucket = buckets.find(b => d >= b.monthStart && d <= b.monthEnd);
      if (bucket) bucket.sqls += day.sqlDeals;
    }
  }

  for (const b of buckets) b.spend = Math.round(b.spend * 100) / 100;

  const thisMonthKey = format(thisMonthStart, "yyyy-MM");
  const lastMonthKey = format(lastMonthStart, "yyyy-MM");
  const thisMonth = buckets.find(b => b.key === thisMonthKey);
  const lastMonth = buckets.find(b => b.key === lastMonthKey);

  const pctDelta = (curr: number, prev: number): number | null => {
    if (!prev) return null;
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  };

  const thisSpend = thisMonth?.spend ?? 0;
  const thisATM = thisMonth?.atm ?? 0;
  const thisSQLs = thisMonth?.sqls ?? 0;
  const thisCPL = thisATM > 0 ? Math.round((thisSpend / thisATM) * 100) / 100 : null;

  const lastSpend = lastMonth?.spend ?? 0;
  const lastATM = lastMonth?.atm ?? 0;
  const lastSQLs = lastMonth?.sqls ?? 0;
  const lastCPL = lastATM > 0 ? Math.round((lastSpend / lastATM) * 100) / 100 : null;

  const deltas = {
    spend: pctDelta(thisSpend, lastSpend),
    atm: pctDelta(thisATM, lastATM),
    sqls: pctDelta(thisSQLs, lastSQLs),
    cpl: lastCPL && thisCPL ? pctDelta(thisCPL, lastCPL) : null,
  };

  // Top ad this month by spend + conversions
  const adSpendMap = new Map<string, { spend: number; conversions: number }>();
  for (const m of metrics) {
    const d = new Date(m.date + "T00:00:00");
    if (d < thisMonthStart) continue;
    const cur = adSpendMap.get(m.adId) ?? { spend: 0, conversions: 0 };
    cur.spend += m.spend ?? 0;
    cur.conversions += m.actions ?? 0;
    adSpendMap.set(m.adId, cur);
  }
  const adRanks = Array.from(adSpendMap.entries()).map(([adId, stats]) => {
    const ad = allAds.find(a => a.id === adId);
    return {
      adId,
      adName: ad?.adName || "Unknown",
      campaignName: ad?.campaignName || "",
      thumbnailUrl: ad?.thumbnailUrl || ad?.imageUrl || "",
      spend: Math.round(stats.spend * 100) / 100,
      conversions: stats.conversions,
      cpConv: stats.conversions > 0 ? Math.round((stats.spend / stats.conversions) * 100) / 100 : null,
    };
  });
  const topAdByConversions = adRanks
    .filter(a => a.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions)[0] || null;
  const topAdBySpend = adRanks.slice().sort((a, b) => b.spend - a.spend)[0] || null;

  return (
    <div className="min-h-screen">
      <ExecutiveClient
        monthLabel={format(now, "MMMM yyyy")}
        thisMonth={{
          spend: thisSpend,
          atm: thisATM,
          sqls: thisSQLs,
          cpl: thisCPL,
        }}
        lastMonthLabel={format(lastMonthStart, "MMMM")}
        deltas={deltas}
        trend={buckets.map(b => ({
          label: b.label,
          spend: b.spend,
          atm: b.atm,
          sqls: b.sqls,
          cpl: b.atm > 0 ? Math.round((b.spend / b.atm) * 100) / 100 : 0,
        }))}
        topAdByConversions={topAdByConversions}
        topAdBySpend={topAdBySpend}
      />
    </div>
  );
}
