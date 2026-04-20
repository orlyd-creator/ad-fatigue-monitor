import { db } from "@/lib/db";
import { ads, dailyMetrics } from "@/lib/db/schema";
import { inArray, gte } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { getLeadsFunnelLite } from "@/lib/hubspot/client";
import { buildStrategicForecast, type DailyPoint } from "@/lib/strategy/forecast";
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

  // Range 1: this month to date
  const thisMonthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const today = format(now, "yyyy-MM-dd");

  // Range 2: last full month (March when we're in April)
  const lastMonthDate = subMonths(now, 1);
  const lastMonthStart = format(startOfMonth(lastMonthDate), "yyyy-MM-dd");
  const lastMonthEnd = format(endOfMonth(lastMonthDate), "yyyy-MM-dd");
  const lastMonthLabel = format(lastMonthDate, "MMMM");

  // Range 3: 90 days for daily history chart (smoothing)
  const ninetyDaysAgo = format(subDays(now, 89), "yyyy-MM-dd");

  const [allAdsRaw, metricsRaw, hsMTD, hsLast] = await Promise.all([
    db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all(),
    db.select().from(dailyMetrics).where(gte(dailyMetrics.date, ninetyDaysAgo)).all(),
    getLeadsFunnelLite(thisMonthStart, today).catch(() => null),
    getLeadsFunnelLite(lastMonthStart, lastMonthEnd).catch(() => null),
  ]);

  const allAdIds = new Set(allAdsRaw.map((a) => a.id));
  const scoped = metricsRaw.filter((m) => m.date <= today && allAdIds.has(m.adId));

  // MTD spend
  const mtdSpendTotal = scoped
    .filter((m) => m.date >= thisMonthStart)
    .reduce((s, m) => s + (m.spend ?? 0), 0);

  // Last month spend
  const lastMonthSpendTotal = scoped
    .filter((m) => m.date >= lastMonthStart && m.date <= lastMonthEnd)
    .reduce((s, m) => s + (m.spend ?? 0), 0);

  // Daily history (for the chart — full 90 days of spend)
  const spendByDate = new Map<string, number>();
  for (const m of scoped) {
    spendByDate.set(m.date, (spendByDate.get(m.date) || 0) + (m.spend ?? 0));
  }
  const dailySpend: DailyPoint[] = Array.from(spendByDate.entries())
    .map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const dailyATM: DailyPoint[] = hsMTD
    ? hsMTD.dailyATM.map((d) => ({ date: d.date, value: d.atm }))
    : [];
  const dailySQLs: DailyPoint[] = hsMTD
    ? hsMTD.dailySQLDeals.map((d) => ({ date: d.date, value: d.sqlDeals }))
    : [];

  // Build the strategic forecast
  const forecast = buildStrategicForecast({
    now,
    mtdSpend: mtdSpendTotal,
    mtdATM: hsMTD?.totalATM ?? 0,
    mtdSQLs: hsMTD?.totalSQLs ?? 0,
    lastMonthLabel,
    lastMonthSpend: lastMonthSpendTotal,
    lastMonthATM: hsLast?.totalATM ?? 0,
    lastMonthSQLs: hsLast?.totalSQLs ?? 0,
    dailySpend,
    dailyATM,
    dailySQLs,
  });

  // At-risk + rising ad lists (unchanged from v1 but still useful)
  const activeAds = allAdsRaw.filter(
    (a) => a.status === "ACTIVE" && !a.id.startsWith("__unattributed_"),
  );
  const adProjections = await Promise.all(
    activeAds.map(async (ad) => {
      const adMetrics = metricsRaw
        .filter((m) => m.adId === ad.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      const fatigue = calculateFatigueScore(adMetrics, DEFAULT_SETTINGS);
      const monthMetrics = adMetrics.filter((m) => m.date >= thisMonthStart);
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

  const atRisk = [...adProjections]
    .filter((a) => a.fatigueScore >= 50 || (a.fatigueScore >= 30 && a.fatigueVelocity > 0.5))
    .sort((a, b) => b.monthSpend - a.monthSpend)
    .slice(0, 5);
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
        forecast={forecast}
        atRisk={atRisk}
        rising={rising}
      />
    </div>
  );
}
