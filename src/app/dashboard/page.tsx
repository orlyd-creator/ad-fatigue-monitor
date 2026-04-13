import { db } from "@/lib/db";
import { ads, dailyMetrics, settings } from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import NavBar from "@/components/NavBar";
import DashboardClient from "./DashboardClient";
import { format, subDays } from "date-fns";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const accountId = (session as any).accountId as string;
  if (!accountId) redirect("/login");

  const params = await searchParams;

  // Handle custom date range
  const isCustom = params.range === "custom" && params.from && params.to;
  const range = isCustom ? "custom" : (params.range && RANGE_DAYS[params.range] ? params.range : "30d");
  const rangeDays = isCustom
    ? Math.max(1, Math.ceil((new Date(params.to!).getTime() - new Date(params.from!).getTime()) / (1000 * 60 * 60 * 24)) + 1)
    : RANGE_DAYS[range] ?? 30;

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

  // Get active ads for this user's account
  const allAds = await db.select().from(ads).where(eq(ads.accountId, accountId)).all();

  const now = new Date();
  const rangeStart = isCustom ? params.from! : format(subDays(now, rangeDays), "yyyy-MM-dd");
  const rangeEnd = isCustom ? params.to! : format(now, "yyyy-MM-dd");

  const results = await Promise.all(allAds.map(async (ad) => {
    const allMetrics = await db
      .select()
      .from(dailyMetrics)
      .where(eq(dailyMetrics.adId, ad.id))
      .orderBy(dailyMetrics.date)
      .all();

    // Use all metrics for fatigue scoring (needs full history)
    const fatigue = calculateFatigueScore(allMetrics, scoringSettings);

    // Filter to range for display metrics
    const rangeMetrics = allMetrics.filter(m => m.date >= rangeStart && m.date <= rangeEnd);
    const recentMetrics = rangeMetrics.slice(-7);

    // Compute summary stats for the range
    const totalSpend = rangeMetrics.reduce((s, m) => s + (m.spend ?? 0), 0);
    const totalImpressions = rangeMetrics.reduce((s, m) => s + (m.impressions ?? 0), 0);
    const totalClicks = rangeMetrics.reduce((s, m) => s + (m.clicks ?? 0), 0);
    const avgCTR = rangeMetrics.length > 0 ? rangeMetrics.reduce((s, m) => s + m.ctr, 0) / rangeMetrics.length : 0;

    return {
      id: ad.id,
      adName: ad.adName,
      campaignName: ad.campaignName,
      adsetName: ad.adsetName,
      status: ad.status,
      fatigue,
      recentMetrics,
      totalDays: allMetrics.length,
      thumbnailUrl: ad.thumbnailUrl ?? null,
      rangeSpend: Math.round(totalSpend * 100) / 100,
      rangeImpressions: totalImpressions,
      rangeClicks: totalClicks,
      rangeAvgCTR: Math.round(avgCTR * 100) / 100,
    };
  }));

  // Sort worst first
  results.sort((a, b) => b.fatigue.fatigueScore - a.fatigue.fatigueScore);

  // Build set of ad IDs belonging to this user's account (for filtering aggregate queries)
  const userAdIds = new Set(allAds.map(a => a.id));

  // Compute spend data for the selected range (filtered to user's ads)
  const allMetricsRangeRaw = await db
    .select()
    .from(dailyMetrics)
    .where(gte(dailyMetrics.date, rangeStart))
    .all();
  const allMetricsRange = allMetricsRangeRaw.filter(m => m.date <= rangeEnd && userAdIds.has(m.adId));

  const totalSpendRange = allMetricsRange.reduce((sum, m) => sum + (m.spend ?? 0), 0);
  const totalImpressionsRange = allMetricsRange.reduce((sum, m) => sum + (m.impressions ?? 0), 0);
  const totalClicksRange = allMetricsRange.reduce((sum, m) => sum + (m.clicks ?? 0), 0);
  const overallCTR = totalImpressionsRange > 0 ? (totalClicksRange / totalImpressionsRange) * 100 : 0;

  // Daily spend for the range
  const dailySpendMap = new Map<string, number>();
  if (isCustom) {
    const start = new Date(params.from!);
    const end = new Date(params.to!);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dailySpendMap.set(format(d, "yyyy-MM-dd"), 0);
    }
  } else {
    for (let i = rangeDays - 1; i >= 0; i--) {
      dailySpendMap.set(format(subDays(now, i), "yyyy-MM-dd"), 0);
    }
  }
  for (const m of allMetricsRange) {
    if (dailySpendMap.has(m.date)) {
      dailySpendMap.set(m.date, (dailySpendMap.get(m.date) ?? 0) + (m.spend ?? 0));
    }
  }
  const dailySpend = Array.from(dailySpendMap.entries()).map(([date, spend]) => ({ date, spend }));

  // --- Period-over-period comparison ---
  const prevRangeEnd = isCustom ? format(subDays(new Date(params.from!), 1), "yyyy-MM-dd") : format(subDays(now, rangeDays), "yyyy-MM-dd");
  const prevRangeStart = format(subDays(new Date(prevRangeEnd), rangeDays - 1), "yyyy-MM-dd");
  const allMetricsPrev = (await db
    .select()
    .from(dailyMetrics)
    .where(gte(dailyMetrics.date, prevRangeStart))
    .all())
    .filter(m => m.date >= prevRangeStart && m.date <= prevRangeEnd && userAdIds.has(m.adId));

  const prevSpend = allMetricsPrev.reduce((sum, m) => sum + (m.spend ?? 0), 0);
  const prevImpressions = allMetricsPrev.reduce((sum, m) => sum + (m.impressions ?? 0), 0);
  const prevClicks = allMetricsPrev.reduce((sum, m) => sum + (m.clicks ?? 0), 0);
  const prevCTR = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;

  const spendChange = prevSpend > 0 ? ((totalSpendRange - prevSpend) / prevSpend) * 100 : 0;
  const impressionChange = prevImpressions > 0 ? ((totalImpressionsRange - prevImpressions) / prevImpressions) * 100 : 0;
  const clickChange = prevClicks > 0 ? ((totalClicksRange - prevClicks) / prevClicks) * 100 : 0;
  const ctrChange = prevCTR > 0 ? ((overallCTR - prevCTR) / prevCTR) * 100 : 0;

  // --- Wasted spend estimate ---
  const fatiguedAds = results.filter(r => r.fatigue.fatigueScore >= 50);
  const fatiguedAdIds = new Set(
    fatiguedAds.map(r => r.id)
  );
  const wastedSpend = allMetricsRange
    .filter(m => fatiguedAdIds.has(m.adId))
    .reduce((sum, m) => sum + (m.spend ?? 0), 0);
  const wastedPct = totalSpendRange > 0 ? (wastedSpend / totalSpendRange) * 100 : 0;

  // --- Top/bottom performers by CTR ---
  const adCTRs = results.map(r => {
    const adMetrics = allMetricsRange.filter(m => m.adId === r.id);
    const avgCTR = adMetrics.length > 0 ? adMetrics.reduce((s, m) => s + m.ctr, 0) / adMetrics.length : 0;
    return { ...r, rangeAvgCTR: avgCTR };
  }).filter(r => r.rangeAvgCTR > 0);

  adCTRs.sort((a, b) => b.rangeAvgCTR - a.rangeAvgCTR);
  const topAd = adCTRs[0] ?? null;
  const bottomAd = adCTRs.length > 1 ? adCTRs[adCTRs.length - 1] : null;
  const topAdAvgCTR = topAd?.rangeAvgCTR ?? 0;
  const bottomAdAvgCTR = bottomAd?.rangeAvgCTR ?? 0;

  const spendData = {
    totalSpendRange,
    totalImpressionsRange,
    totalClicksRange,
    overallCTR: Math.round(overallCTR * 100) / 100,
    dailySpend,
    rangeDays,
    // Period comparison
    prevSpend,
    prevImpressions,
    prevClicks,
    prevCTR: Math.round(prevCTR * 100) / 100,
    spendChange,
    impressionChange,
    clickChange,
    ctrChange,
    // Wasted spend
    wastedSpend: Math.round(wastedSpend * 100) / 100,
    wastedPct: Math.round(wastedPct * 100) / 100,
    fatigueAdCount: fatiguedAds.length,
    // Top/bottom
    topAdName: topAd?.adName || null,
    topAdCTR: topAd ? Math.round(topAdAvgCTR * 100) / 100 : 0,
    bottomAdName: bottomAd?.adName || null,
    bottomAdCTR: bottomAd ? Math.round(bottomAdAvgCTR * 100) / 100 : 0,
  };

  return (
    <div className="min-h-screen">
      <NavBar />
      <DashboardClient ads={results} spendData={spendData} range={range} />
    </div>
  );
}
