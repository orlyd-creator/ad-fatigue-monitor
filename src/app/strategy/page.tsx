import { db } from "@/lib/db";
import { ads, dailyMetrics, settings } from "@/lib/db/schema";
import { eq, inArray, gte } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { getLeadsFunnelLite } from "@/lib/hubspot/client";
import StrategyClient from "./StrategyClient";
import FreshnessGuard from "@/components/FreshnessGuard";

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
  const totalImpressionsAll = rangeScopedAll.reduce((s, m) => s + (m.impressions ?? 0), 0);

  // Campaign-level aggregates — spend/reach/clicks MUST include paused/archived/
  // unattributed rows so totals match Dashboard + top-line. Previous version summed
  // adSummaries (ACTIVE-only) which silently dropped historical spend.
  const campaignNameById = new Map(allAdsRaw.map(a => [a.id, a.campaignName]));
  const activeAdCountByCampaign = new Map<string, number>();
  const fatigueSumByCampaign = new Map<string, number>();
  for (const ad of adSummaries) {
    activeAdCountByCampaign.set(ad.campaignName, (activeAdCountByCampaign.get(ad.campaignName) ?? 0) + 1);
    fatigueSumByCampaign.set(ad.campaignName, (fatigueSumByCampaign.get(ad.campaignName) ?? 0) + ad.fatigueScore);
  }

  const campaignMap = new Map<string, { spend: number; reach: number; clicks: number }>();
  for (const m of rangeScopedAll) {
    const name = campaignNameById.get(m.adId);
    if (!name) continue;
    const c = campaignMap.get(name) ?? { spend: 0, reach: 0, clicks: 0 };
    c.spend += m.spend ?? 0;
    c.reach += m.reach ?? 0;
    c.clicks += m.clicks ?? 0;
    campaignMap.set(name, c);
  }

  const campaignSpend = Array.from(campaignMap.entries()).map(([campaignName, c]) => {
    const activeAds = activeAdCountByCampaign.get(campaignName) ?? 0;
    const fatigueSum = fatigueSumByCampaign.get(campaignName) ?? 0;
    return {
      campaignName,
      spend: Math.round(c.spend * 100) / 100,
      reach: c.reach,
      clicks: c.clicks,
      ads: activeAds,
      avgFatigue: activeAds > 0 ? Math.round(fatigueSum / activeAds) : 0,
    };
  });

  // Account health
  const accountHealth = adSummaries.length > 0
    ? Math.round(100 - adSummaries.reduce((s, a) => s + a.fatigueScore, 0) / adSummaries.length)
    : 100;

  // HUBSPOT FUNNEL: pull ATM + SQL counts for the range so we can compute
  // Meta-driven cost-per-demo and cost-per-SQL — the numbers that actually
  // matter for growth decisions.
  const hs = await getLeadsFunnelLite(rangeStart, rangeEnd).catch((err) => {
    console.error("[strategy] HubSpot fetch failed:", err);
    return null;
  });
  const totalATM = hs?.totalATM ?? 0;
  const totalSQLs = hs?.totalSQLs ?? 0;
  const costPerDemo = totalATM > 0 ? totalSpend / totalATM : null;
  const costPerSQL = totalSQLs > 0 ? totalSpend / totalSQLs : null;
  const demoToSQLRate = totalATM > 0 ? (totalSQLs / totalATM) * 100 : null;
  const clickToLeadRate = totalClicks > 0 ? (totalATM / totalClicks) * 100 : null;

  // DAY-OF-WEEK PERFORMANCE: aggregate spend + clicks + CTR by weekday to
  // expose when campaigns are most efficient.
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowBuckets: Array<{ day: string; spend: number; clicks: number; impressions: number }> =
    DAY_LABELS.map((day) => ({ day, spend: 0, clicks: 0, impressions: 0 }));
  for (const m of rangeScopedAll) {
    const d = new Date(m.date + "T00:00:00");
    const b = dowBuckets[d.getDay()];
    b.spend += m.spend ?? 0;
    b.clicks += m.clicks ?? 0;
    b.impressions += m.impressions ?? 0;
  }
  const dayOfWeek = dowBuckets.map((b) => ({
    day: b.day,
    spend: Math.round(b.spend * 100) / 100,
    clicks: b.clicks,
    ctr: b.impressions > 0 ? Math.round((b.clicks / b.impressions) * 10000) / 100 : 0,
  }));

  const lastSyncedAt = allAdsRaw.reduce((max, ad) => Math.max(max, ad.lastSyncedAt ?? 0), 0);

  return (
    <div className="min-h-screen">
      <div className="px-8 pt-6">
        <FreshnessGuard lastSyncedAt={lastSyncedAt || null} isPublic={!!session.isPublic} />
      </div>
      <StrategyClient
        ads={adSummaries}
        dailySpendByAd={dailySpendByAd}
        campaignSpend={campaignSpend}
        accountHealth={accountHealth}
        totalSpend={Math.round(totalSpend * 100) / 100}
        totalReach={totalReach}
        totalClicks={totalClicks}
        totalImpressions={totalImpressionsAll}
        totalATM={totalATM}
        totalSQLs={totalSQLs}
        costPerDemo={costPerDemo !== null ? Math.round(costPerDemo * 100) / 100 : null}
        costPerSQL={costPerSQL !== null ? Math.round(costPerSQL * 100) / 100 : null}
        demoToSQLRate={demoToSQLRate !== null ? Math.round(demoToSQLRate * 10) / 10 : null}
        clickToLeadRate={clickToLeadRate !== null ? Math.round(clickToLeadRate * 100) / 100 : null}
        dayOfWeek={dayOfWeek}
        rangeLabel={`${format(startOfMonth(now), "MMM d")} – ${format(now, "MMM d, yyyy")}`}
      />
    </div>
  );
}
