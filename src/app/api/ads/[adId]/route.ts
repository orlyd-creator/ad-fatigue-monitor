import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, settings } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ adId: string }> }
) {
  const session = await getSessionOrPublic();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = session.accountId;
  const allAccountIds: string[] = session.allAccountIds;
  if (!accountId) return NextResponse.json({ error: "No account connected" }, { status: 400 });

  const { adId } = await params;

  const ad = await db.select().from(ads).where(eq(ads.id, adId)).get();
  if (!ad) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  // Verify this ad belongs to one of the user's accounts
  if (!allAccountIds.includes(ad.accountId)) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

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

  const metrics = await db
    .select()
    .from(dailyMetrics)
    .where(eq(dailyMetrics.adId, adId))
    .orderBy(dailyMetrics.date)
    .all();

  const fatigue = calculateFatigueScore(metrics, scoringSettings);

  const adAlerts = await db
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
