import { db } from "@/lib/db";
import { ads, dailyMetrics, settings } from "@/lib/db/schema";
import { eq, inArray, gte } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import { format, startOfMonth, endOfMonth } from "date-fns";
import StrategyClient from "./StrategyClient";

export const dynamic = "force-dynamic";

export default async function StrategyPage() {
  const session = await getSessionOrPublic();
  if (!session) redirect("/login");
  const accountId = session.accountId;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = session.allAccountIds;

  // Get settings
  const userSettings = await db.select().from(settings).where(eq(settings.id, 1)).get();
  const scoringSettings: ScoringSettings = userSettings
    ? {
        ctrWeight: userSettings.ctrWeight,
        cpmWeight: userSettings.cpmWeight,
        frequencyWeight: userSettings.frequencyWeight,
        conversionWeight: userSettings.conversionWeight,
        costPerResultWeight: userSettings.costPerResultWeight,
        engagementWeight: userSettings.engagementWeight,
        baselineWindowDays: userSettings.baselineWindowDays,
        recentWindowDays: userSettings.recentWindowDays,
        minDataDays: userSettings.minDataDays,
      }
    : DEFAULT_SETTINGS;

  // Fetch ALL ads (needed for range-scoped spend totals that include paused /
  // archived / unattributed rows — matches Dashboard accuracy).
  const allAdsRaw = await db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all();
  // ACTIVE-only ad summaries for the per-ad detail cards.
  const allAds = allAdsRaw.filter(a => a.status === "ACTIVE" && !a.id.startsWith("__unattributed_"));

  // This month is the default range — matches the Executive + Dashboard defaults.
  const now = new Date();
  const rangeStart = format(startOfMonth(now), "yyyy-MM-dd");
  const rangeEnd = format(endOfMonth(now), "yyyy-MM-dd");

  // Process each ACTIVE ad — summaries use ALL-TIME metrics for fatigue scoring
  // (fatigue needs history) but display numbers are range-scoped to this month.
  const adSummaries = await Promise.all(
    allAds.map(async (ad) => {
      const allMetrics = await db
        .select()
        .from(dailyMetrics)
        .where(eq(dailyMetrics.adId, ad.id))
        .orderBy(dailyMetrics.date)
        .all();

      const fatigue = calculateFatigueScore(allMetrics, scoringSettings);

      // Range-scoped totals so the numbers match Dashboard's this-month view.
      const rangeMetrics = allMetrics.filter(m => m.date >= rangeStart && m.date <= rangeEnd);
      const totalSpend = rangeMetrics.reduce((s, m) => s + (m.spend ?? 0), 0);
      const totalReach = rangeMetrics.reduce((s, m) => s + (m.reach ?? 0), 0);
      const totalImpressions = rangeMetrics.reduce((s, m) => s + (m.impressions ?? 0), 0);
      const totalClicks = rangeMetrics.reduce((s, m) => s + (m.clicks ?? 0), 0);
      const avgCTR = rangeMetrics.length > 0 ? rangeMetrics.reduce((s, m) => s + m.ctr, 0) / rangeMetrics.length : 0;
      const avgCPM = rangeMetrics.length > 0 ? rangeMetrics.reduce((s, m) => s + m.cpm, 0) / rangeMetrics.length : 0;
      const avgFrequency = rangeMetrics.length > 0 ? rangeMetrics.reduce((s, m) => s + m.frequency, 0) / rangeMetrics.length : 0;
      const avgCPC = rangeMetrics.length > 0 ? rangeMetrics.reduce((s, m) => s + m.cpc, 0) / rangeMetrics.length : 0;
      const costPerResult = rangeMetrics.length > 0 ? rangeMetrics.reduce((s, m) => s + m.costPerAction, 0) / rangeMetrics.length : 0;

      return {
        id: ad.id,
        adName: ad.adName,
        campaignName: ad.campaignName,
        status: ad.status,
        fatigueScore: fatigue.fatigueScore,
        stage: fatigue.stage,
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalReach,
        totalImpressions,
        totalClicks,
        avgCTR: Math.round(avgCTR * 100) / 100,
        avgCPM: Math.round(avgCPM * 100) / 100,
        avgFrequency: Math.round(avgFrequency * 100) / 100,
        avgCPC: Math.round(avgCPC * 100) / 100,
        costPerResult: Math.round(costPerResult * 100) / 100,
      };
    })
  );

  // Build daily spend by ad (top 6 by total spend, last 30 days)
  const topAds = [...adSummaries].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 6);
  const topAdIds = new Set(topAds.map(a => a.id));

  const recentMetrics = await db
    .select()
    .from(dailyMetrics)
    .where(gte(dailyMetrics.date, rangeStart))
    .all();

  // Build date -> { adName: spend } map
  const dailyMap = new Map<string, Record<string, number>>();
  const monthStart = startOfMonth(new Date());
  for (let d = new Date(monthStart); d <= new Date(); d.setDate(d.getDate() + 1)) {
    dailyMap.set(format(d, "yyyy-MM-dd"), {});
  }

  const adIdToName = new Map(topAds.map(a => [a.id, a.adName]));
  for (const m of recentMetrics) {
    if (!topAdIds.has(m.adId)) continue;
    const name = adIdToName.get(m.adId);
    if (!name) continue;
    const dayData = dailyMap.get(m.date);
    if (dayData) {
      dayData[name] = (dayData[name] ?? 0) + (m.spend ?? 0);
    }
  }

  const dailySpendByAd = Array.from(dailyMap.entries()).map(([date, spends]) => ({
    date,
    ...Object.fromEntries(
      topAds.map(a => [a.adName, Math.round((spends[a.adName] ?? 0) * 100) / 100])
    ),
  }));

  // Campaign-level aggregates
  const campaignMap = new Map<string, { spend: number; reach: number; clicks: number; ads: number; fatigueSum: number }>();
  for (const ad of adSummaries) {
    const key = ad.campaignName;
    const c = campaignMap.get(key) ?? { spend: 0, reach: 0, clicks: 0, ads: 0, fatigueSum: 0 };
    c.spend += ad.totalSpend;
    c.reach += ad.totalReach;
    c.clicks += ad.totalClicks;
    c.ads++;
    c.fatigueSum += ad.fatigueScore;
    campaignMap.set(key, c);
  }

  const campaignSpend = Array.from(campaignMap.entries()).map(([campaignName, c]) => ({
    campaignName,
    spend: Math.round(c.spend * 100) / 100,
    reach: c.reach,
    clicks: c.clicks,
    ads: c.ads,
    avgFatigue: Math.round(c.fatigueSum / c.ads),
  }));

  // Account health
  const accountHealth = adSummaries.length > 0
    ? Math.round(100 - adSummaries.reduce((s, a) => s + a.fatigueScore, 0) / adSummaries.length)
    : 100;

  // TOP-LINE TOTALS: sum from ALL ads in range (including paused/archived/
  // unattributed) so the numbers match Dashboard's Performance card exactly.
  const allAdIdsFull = new Set(allAdsRaw.map(a => a.id));
  const rangeMetricsAll = await db
    .select()
    .from(dailyMetrics)
    .where(gte(dailyMetrics.date, rangeStart))
    .all();
  const rangeScopedAll = rangeMetricsAll.filter(
    m => m.date <= rangeEnd && allAdIdsFull.has(m.adId),
  );
  const totalSpend = rangeScopedAll.reduce((s, m) => s + (m.spend ?? 0), 0);
  const totalReach = rangeScopedAll.reduce((s, m) => s + (m.reach ?? 0), 0);
  const totalClicks = rangeScopedAll.reduce((s, m) => s + (m.clicks ?? 0), 0);

  return (
    <div className="min-h-screen">
      <StrategyClient
        ads={adSummaries}
        dailySpendByAd={dailySpendByAd}
        campaignSpend={campaignSpend}
        accountHealth={accountHealth}
        totalSpend={Math.round(totalSpend * 100) / 100}
        totalReach={totalReach}
        totalClicks={totalClicks}
      />
    </div>
  );
}
