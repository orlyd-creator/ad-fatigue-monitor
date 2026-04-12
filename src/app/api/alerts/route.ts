import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alerts, ads } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const allAlerts = db
    .select({
      id: alerts.id,
      adId: alerts.adId,
      createdAt: alerts.createdAt,
      fatigueScore: alerts.fatigueScore,
      stage: alerts.stage,
      signals: alerts.signals,
      dismissed: alerts.dismissed,
      adName: ads.adName,
    })
    .from(alerts)
    .leftJoin(ads, eq(alerts.adId, ads.id))
    .orderBy(desc(alerts.createdAt))
    .limit(50)
    .all();

  return NextResponse.json(allAlerts);
}
