import { db } from "@/lib/db";
import { ads, dailyMetrics } from "@/lib/db/schema";
import { inArray, gte } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import { format, subDays, startOfMonth } from "date-fns";
import { getLeadsFunnelLite } from "@/lib/hubspot/client";
import { forecastSeries, narrateOutlook, type DailyPoint } from "@/lib/strategy/forecast";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import { DEFAULT_SETTINGS, type FatigueStage } from "@/lib/fatigue/types";
import ForecastClient from "./ForecastClient";
import FreshnessGuard from "@/components/FreshnessGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ForecastPage() {
  const session = await getSessionOrPublic();
  if (!session) redirect("/login");
  const accountId = session.accountId;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = session.allAccountIds;

  const now = new Date();
  const ninetyDaysAgo = format(subDays(now, 89), "yyyy-MM-dd");
  const todayStr = format(now, "yyyy-MM-dd");

  // Pull 90d of daily metrics + HS funnel for forecasting baseline.
  const [allAdsRaw, metricsRaw, hs] = await Promise.all([
    db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all(),
    db.select().from(dailyMetrics).where(gte(dailyMetrics.date, ninetyDaysAgo)).all(),
    getLeadsFunnelLite(ninetyDaysAgo, todayStr).catch(() => null),
  ]);

  const allAdIds = new Set(allAdsRaw.map((a) => a.id));
  const scoped = metricsRaw.filter(
    (m) => m.date <= todayStr && allAdIds.has(m.adId),
  );

  // Daily spend series
  const spendByDate = new Map<string, number>();
  for (const m of scoped) {
    spendByDate.set(m.date, (spendByDate.get(m.date) || 0) + (m.spend ?? 0));
  }
  const spendHistory: DailyPoint[] = Array.from(spendByDate.entries())
    .map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // HS daily ATM + SQL
  const atmHistory: DailyPoint[] = hs
    ? hs.dailyATM.map((d) => ({ date: d.date, value: d.atm }))
    : [];
  const sqlHistory: DailyPoint[] = hs
    ? hs.dailySQLDeals.map((d) => ({ date: d.date, value: d.sqlDeals }))
    : [];

  // Daily CPL series (requires joining spend + atm)
  const atmByDate = new Map(atmHistory.map((d) => [d.date, d.value]));
  const cplHistory: DailyPoint[] = spendHistory
    .map((d) => {
      const atm = atmByDate.get(d.date) || 0;
      return atm > 0
        ? { date: d.date, value: Math.round((d.value / atm) * 100) / 100 }
        : null;
    })
    .filter((x): x is DailyPoint => x !== null);

  // Run forecasts
  const spendForecast = forecastSeries(spendHistory, { horizonDays: 30, label: "spend" });
  const atmForecast = forecastSeries(atmHistory, { horizonDays: 30, label: "ATM leads" });
  const sqlsForecast = forecastSeries(sqlHistory, { horizonDays: 30, label: "SQLs" });
  const cplForecast = forecastSeries(cplHistory, { horizonDays: 30, label: "CPL" });

  const outlook = narrateOutlook({
    spend: spendForecast,
    atm: atmForecast,
    sqls: sqlsForecast,
    cpl: cplForecast,
  });

  // ── Best + worst ad forecast ──
  // For each ACTIVE ad, compute fatigue + recent CPL contribution and rank.
  const activeAds = allAdsRaw.filter(
    (a) => a.status === "ACTIVE" && !a.id.startsWith("__unattributed_"),
  );
  const adProjections = await Promise.all(
    activeAds.map(async (ad) => {
      const adMetrics = metricsRaw
        .filter((m) => m.adId === ad.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      const fatigue = calculateFatigueScore(adMetrics, DEFAULT_SETTINGS);
      const rangeStart = format(startOfMonth(now), "yyyy-MM-dd");
      const monthMetrics = adMetrics.filter((m) => m.date >= rangeStart);
      const monthSpend = monthMetrics.reduce((s, m) => s + (m.spend ?? 0), 0);
      return {
        id: ad.id,
        adName: ad.adName,
        campaignName: ad.campaignName,
        fatigueScore: fatigue.fatigueScore,
        stage: fatigue.stage as FatigueStage,
        predictedDaysToFatigue: fatigue.predictedDaysToFatigue,
        fatigueVelocity: fatigue.fatigueVelocity,
        monthSpend: Math.round(monthSpend * 100) / 100,
      };
    }),
  );

  // At-risk: high fatigue OR accelerating fatigue, sorted by spend-at-risk.
  const atRisk = [...adProjections]
    .filter(
      (a) =>
        a.fatigueScore >= 50 ||
        (a.fatigueScore >= 30 && a.fatigueVelocity > 0.5),
    )
    .sort((a, b) => b.monthSpend - a.monthSpend)
    .slice(0, 5);

  // Rising: low fatigue + non-trivial spend.
  const rising = [...adProjections]
    .filter((a) => a.fatigueScore < 30 && a.monthSpend > 50)
    .sort((a, b) => b.monthSpend - a.monthSpend)
    .slice(0, 5);

  const lastSyncedAt = allAdsRaw.reduce((max, a) => Math.max(max, a.lastSyncedAt ?? 0), 0);

  return (
    <div className="min-h-screen">
      <div className="px-8 pt-6">
        <FreshnessGuard lastSyncedAt={lastSyncedAt || null} isPublic={!!session.isPublic} />
      </div>
      <ForecastClient
        spendHistory={spendHistory}
        atmHistory={atmHistory}
        sqlHistory={sqlHistory}
        cplHistory={cplHistory}
        spendForecast={spendForecast}
        atmForecast={atmForecast}
        sqlsForecast={sqlsForecast}
        cplForecast={cplForecast}
        outlook={outlook}
        atRisk={atRisk}
        rising={rising}
      />
    </div>
  );
}
