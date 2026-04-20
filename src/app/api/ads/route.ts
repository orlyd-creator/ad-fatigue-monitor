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

  const results = await Promise.all(allAds.map(async (ad) => {
    const metrics = await db
      .select()
      .from(dailyMetrics)
      .where(eq(dailyMetrics.adId, ad.id))
      .orderBy(dailyMetrics.date)
      .all();

    const fatigue = calculateFatigueScore(metrics, scoringSettings);

    // Get last 7 days of metrics for sparklines
    const recentMetrics = metrics.slice(-7);

    return {
      ...ad,
      fatigue,
      recentMetrics,
      totalDays: metrics.length,
    };
  }));

  // Sort by fatigue score descending (worst first)
  results.sort((a, b) => b.fatigue.fatigueScore - a.fatigue.fatigueScore);

  return NextResponse.json(results);
}
