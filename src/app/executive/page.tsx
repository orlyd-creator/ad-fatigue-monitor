import { db } from "@/lib/db";
import { ads, dailyMetrics } from "@/lib/db/schema";
import { inArray, gte } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import {
  format, startOfMonth, endOfMonth, subMonths, addMonths, isBefore,
  isAfter, startOfYear,
} from "date-fns";
import { getLeadsFunnelLite } from "@/lib/hubspot/client";
import ExecutiveClient from "./ExecutiveClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Up to 6 parallel HubSpot queries run below; allow enough headroom.
// Historical ranges (6m, 12m, ytd) need more than the default 60s.
export const maxDuration = 300;

/**
 * Executive View — CEO-friendly dashboard with:
 * - Date range selector (query-driven so links + PDFs are shareable)
 * - KPI cards with month-over-month deltas
 * - Trend lines, CPL trend, campaign breakdown, monthly summary table
 * - Top ad cards
 * - One-click PDF export
 */
export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
}) {
  const session = await getSessionOrPublic();
  if (!session) redirect("/login");
  const accountId = session.accountId;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = session.allAccountIds;

  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const defaultFrom = startOfMonth(subMonths(now, 5));

  const params = await searchParams;
  const preset = params.preset || "6m";
  const fromDate = params.from ? new Date(params.from + "T00:00:00") : defaultFrom;
  const toDate = params.to ? new Date(params.to + "T23:59:59") : now;
  const rangeFromStr = format(fromDate, "yyyy-MM-dd");
  const rangeToStr = format(toDate, "yyyy-MM-dd");

  const [allAds, metricsRaw, hubspotResult] = await Promise.all([
    db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all(),
    db.select().from(dailyMetrics).where(gte(dailyMetrics.date, rangeFromStr)).all(),
    getLeadsFunnelLite(rangeFromStr, rangeToStr).catch(err => {
      console.error("[executive] HubSpot fetch failed:", err);
      return null;
    }),
  ]);
  // Don't filter metrics by allAds.id — Meta removes ads from its list API once
  // they're deleted, but dailyMetrics persists historical rows. Filtering them
  // out silently drops real spend from past months. Every row in dailyMetrics
  // was synced from one of the owner's accounts, so include it in the totals.
  const metrics = metricsRaw.filter(m => m.date <= rangeToStr);

  // Month buckets covering the selected range
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
  let cursor = startOfMonth(fromDate);
  const rangeEnd = endOfMonth(toDate);
  while (isBefore(cursor, addMonths(rangeEnd, 1)) && !isAfter(cursor, rangeEnd)) {
    buckets.push({
      key: format(cursor, "yyyy-MM"),
      label: format(cursor, "MMM yyyy"),
      monthStart: startOfMonth(cursor),
      monthEnd: endOfMonth(cursor),
      spend: 0,
      atm: 0,
      sqls: 0,
    });
    cursor = addMonths(cursor, 1);
  }

  // Meta spend by month
  for (const m of metrics) {
    const d = new Date(m.date + "T00:00:00");
    const bucket = buckets.find(b => d >= b.monthStart && d <= b.monthEnd);
    if (bucket) bucket.spend += m.spend ?? 0;
  }

  // HubSpot ATM by month (from ATM companies)
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

  // Current vs previous month (for top cards)
  const lastMonthStart = startOfMonth(subMonths(now, 1));
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

  // Range-wide totals (for the header stat line + export context)
  const rangeTotals = buckets.reduce(
    (acc, b) => ({
      spend: acc.spend + b.spend,
      atm: acc.atm + b.atm,
      sqls: acc.sqls + b.sqls,
    }),
    { spend: 0, atm: 0, sqls: 0 }
  );
  const rangeCPL = rangeTotals.atm > 0 ? Math.round((rangeTotals.spend / rangeTotals.atm) * 100) / 100 : null;
  const rangeCostPerSQL = rangeTotals.sqls > 0 ? Math.round((rangeTotals.spend / rangeTotals.sqls) * 100) / 100 : null;

  // Top ad this month
  const adStatsMap = new Map<string, { spend: number; conversions: number }>();
  for (const m of metrics) {
    const d = new Date(m.date + "T00:00:00");
    if (d < thisMonthStart) continue;
    const cur = adStatsMap.get(m.adId) ?? { spend: 0, conversions: 0 };
    cur.spend += m.spend ?? 0;
    cur.conversions += m.actions ?? 0;
    adStatsMap.set(m.adId, cur);
  }
  const adRanks = Array.from(adStatsMap.entries()).map(([adId, stats]) => {
    const ad = allAds.find(a => a.id === adId);
    return {
      adId,
      adName: ad?.adName || "Unknown",
      campaignName: ad?.campaignName || "",
      thumbnailUrl: ad?.imageUrl || ad?.thumbnailUrl || "",
      spend: Math.round(stats.spend * 100) / 100,
      conversions: stats.conversions,
      cpConv: stats.conversions > 0 ? Math.round((stats.spend / stats.conversions) * 100) / 100 : null,
    };
  });
  const topAdByConversions = adRanks
    .filter(a => a.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions)[0] || null;
  const topAdBySpend = adRanks.slice().sort((a, b) => b.spend - a.spend)[0] || null;

  // Top 5 campaigns across the selected range
  const campaignMap = new Map<string, { spend: number; conversions: number }>();
  for (const m of metrics) {
    const ad = allAds.find(a => a.id === m.adId);
    if (!ad) continue;
    const key = ad.campaignName || "(unknown)";
    const cur = campaignMap.get(key) ?? { spend: 0, conversions: 0 };
    cur.spend += m.spend ?? 0;
    cur.conversions += m.actions ?? 0;
    campaignMap.set(key, cur);
  }
  const topCampaigns = Array.from(campaignMap.entries())
    .map(([name, v]) => ({
      name,
      spend: Math.round(v.spend * 100) / 100,
      conversions: v.conversions,
      costPerConv: v.conversions > 0 ? Math.round((v.spend / v.conversions) * 100) / 100 : null,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);

  // Presets the selector renders (values stored in URL as ?preset=XXX)
  const presets = {
    "this-month": { from: format(thisMonthStart, "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") },
    "last-month": { from: format(lastMonthStart, "yyyy-MM-dd"), to: format(endOfMonth(lastMonthStart), "yyyy-MM-dd") },
    "3m": { from: format(startOfMonth(subMonths(now, 2)), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") },
    "6m": { from: format(startOfMonth(subMonths(now, 5)), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") },
    "ytd": { from: format(startOfYear(now), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") },
    "12m": { from: format(startOfMonth(subMonths(now, 11)), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") },
  };

  return (
    <div className="min-h-screen">
      <ExecutiveClient
        monthLabel={format(now, "MMMM yyyy")}
        rangeLabel={
          buckets.length === 1
            ? buckets[0].label
            : `${format(fromDate, "MMM d, yyyy")} — ${format(toDate, "MMM d, yyyy")}`
        }
        rangeFrom={rangeFromStr}
        rangeTo={rangeToStr}
        preset={preset}
        presets={presets}
        thisMonth={{ spend: thisSpend, atm: thisATM, sqls: thisSQLs, cpl: thisCPL }}
        lastMonthLabel={format(lastMonthStart, "MMMM")}
        deltas={deltas}
        rangeTotals={{
          spend: Math.round(rangeTotals.spend * 100) / 100,
          atm: rangeTotals.atm,
          sqls: rangeTotals.sqls,
          cpl: rangeCPL,
          costPerSQL: rangeCostPerSQL,
        }}
        trend={buckets.map(b => ({
          label: b.label,
          spend: b.spend,
          atm: b.atm,
          sqls: b.sqls,
          cpl: b.atm > 0 ? Math.round((b.spend / b.atm) * 100) / 100 : 0,
          costPerSQL: b.sqls > 0 ? Math.round((b.spend / b.sqls) * 100) / 100 : 0,
          sqlRate: b.atm > 0 ? Math.round((b.sqls / b.atm) * 1000) / 10 : 0,
        }))}
        monthlyTable={buckets.map(b => ({
          label: b.label,
          spend: b.spend,
          atm: b.atm,
          sqls: b.sqls,
          cpl: b.atm > 0 ? Math.round((b.spend / b.atm) * 100) / 100 : 0,
          costPerSQL: b.sqls > 0 ? Math.round((b.spend / b.sqls) * 100) / 100 : 0,
        }))}
        topCampaigns={topCampaigns}
        topAdByConversions={topAdByConversions}
        topAdBySpend={topAdBySpend}
      />
    </div>
  );
}
