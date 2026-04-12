import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, settings } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ adId: string }> }
) {
  const { adId } = await params;

  const ad = db.select().from(ads).where(eq(ads.id, adId)).get();
  if (!ad) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  const userSettings = db.select().from(settings).where(eq(settings.id, 1)).get();
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

  const metrics = db
    .select()
    .from(dailyMetrics)
    .where(eq(dailyMetrics.adId, adId))
    .orderBy(dailyMetrics.date)
    .all();

  const fatigue = calculateFatigueScore(metrics, scoringSettings);

  const adAlerts = db
    .select()
    .from(alerts)
    .where(eq(alerts.adId, adId))
    .orderBy(desc(alerts.createdAt))
    .limit(20)
    .all();

  return NextResponse.json({
    ad,
    fatigue,
    metrics,
    alerts: adAlerts,
  });
}
