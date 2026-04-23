import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, dailyMetrics, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";

export async function GET() {
  const session = await getSessionOrPublic();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = session.accountId;
  const allAccountIds: string[] = session.allAccountIds;
  if (!accountId) return NextResponse.json({ error: "No account connected" }, { status: 400 });

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

  // Get ads from ALL of user's accounts
  const allAds = await db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all();

  // Batch-load metrics for every ad in ONE query, group in memory. Previous
  // N+1 fired one query per ad which made this route 5-10x slower on
  // accounts with 1000+ ads.
  const adIds = allAds.map(a => a.id);
  const metricsAll = adIds.length === 0
    ? []
    : await db.select().from(dailyMetrics).where(inArray(dailyMetrics.adId, adIds)).all();
  const metricsByAd = new Map<string, typeof metricsAll>();
  for (const m of metricsAll) {
    const arr = metricsByAd.get(m.adId);
    if (arr) arr.push(m);
    else metricsByAd.set(m.adId, [m]);
  }
  for (const arr of metricsByAd.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  const results = allAds.map((ad) => {
    const metrics = metricsByAd.get(ad.id) ?? [];
    const fatigue = calculateFatigueScore(metrics, scoringSettings);
    const recentMetrics = metrics.slice(-7);
    return {
      ...ad,
      fatigue,
      recentMetrics,
      totalDays: metrics.length,
    };
  });

  // Sort by fatigue score descending (worst first)
  results.sort((a, b) => b.fatigue.fatigueScore - a.fatigue.fatigueScore);

  return NextResponse.json(results);
}
