import { db } from "@/lib/db";
import { accounts, ads, dailyMetrics, publicLinks } from "@/lib/db/schema";
import { eq, gte, sql } from "drizzle-orm";
import {
  format, startOfMonth, endOfMonth, subMonths, addMonths, isBefore,
  isAfter, startOfYear,
} from "date-fns";
import { getLeadsFunnelLite } from "@/lib/hubspot/client";
import ExecutiveClient from "@/app/executive/ExecutiveClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

/**
 * Public view-only executive dashboard. No login required.
 * Anyone with a valid, non-revoked token can view the live data.
 * URL: /public/executive/<token>
 */
export default async function PublicExecutivePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
}) {
  const { token } = await params;

  // Validate token
  const link = await db
    .select()
    .from(publicLinks)
    .where(eq(publicLinks.token, token))
    .get();

  if (!link || link.revokedAt) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Link unavailable</h1>
          <p className="text-[14px] text-muted-foreground">
            This view-only link has been revoked or doesn't exist. Ask the person who shared it for a new one.
          </p>
        </div>
      </main>
    );
  }

  // Bump view counter (best-effort, non-blocking)
  db.update(publicLinks)
    .set({ viewsCount: sql`${publicLinks.viewsCount} + 1` })
    .where(eq(publicLinks.token, token))
    .run();

  // Owner's Meta accounts — public viewer sees everything across every connected ad account.
  const allAccountRows = await db.select({ id: accounts.id }).from(accounts).all();
  const allAccountIds = allAccountRows.map(r => r.id);

  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const defaultFrom = thisMonthStart;

  const sp = await searchParams;
  const preset = sp.preset || "this-month";
  const fromDate = sp.from ? new Date(sp.from + "T00:00:00") : defaultFrom;
  const toDate = sp.to ? new Date(sp.to + "T23:59:59") : now;
  const rangeFromStr = format(fromDate, "yyyy-MM-dd");
  const rangeToStr = format(toDate, "yyyy-MM-dd");

  const [allAds, metricsRaw, hubspotResult] = await Promise.all([
    db.select().from(ads).all(),
    db.select().from(dailyMetrics).where(gte(dailyMetrics.date, rangeFromStr)).all(),
    getLeadsFunnelLite(rangeFromStr, rangeToStr).catch(err => {
      console.error("[public-executive] HubSpot fetch failed:", err);
      return null;
    }),
  ]);
  const adAccountSet = new Set(allAccountIds);
  const allAdsForAccount = allAds.filter(a => adAccountSet.has(a.accountId));
  const allAdIds = new Set(allAdsForAccount.map(a => a.id));
  const metrics = metricsRaw.filter(m => m.date <= rangeToStr && allAdIds.has(m.adId));

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

  for (const m of metrics) {
    const d = new Date(m.date + "T00:00:00");
    const bucket = buckets.find(b => d >= b.monthStart && d <= b.monthEnd);
    if (bucket) bucket.spend += m.spend ?? 0;
  }

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
    const ad = allAdsForAccount.find(a => a.id === adId);
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

  const campaignMap = new Map<string, { spend: number; conversions: number }>();
  for (const m of metrics) {
    const ad = allAdsForAccount.find(a => a.id === m.adId);
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
      {/* Tiny banner so viewer knows this is a shared view */}
      <div className="bg-gradient-to-r from-[#6B93D8]/10 via-[#9B7ED0]/10 to-[#D06AB8]/10 border-b border-border exec-no-print">
        <div className="max-w-6xl mx-auto px-6 py-2 text-[12px] text-muted-foreground flex items-center justify-between">
          <span>
            {link.label ? <>Shared view — <span className="font-medium text-foreground">{link.label}</span></> : "Shared view"}
          </span>
          <span className="text-[11px]">View-only · live data</span>
        </div>
      </div>
      <ExecutiveClient
        basePath={`/public/executive/${token}`}
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
