import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alerts, ads } from "@/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";

export async function GET() {
  const session = await getSessionOrPublic();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = session.accountId;
  const allAccountIds: string[] = session.allAccountIds;
  if (!accountId) return NextResponse.json({ error: "No account connected" }, { status: 400 });

  const allAlerts = await db
    .select({
      id: alerts.id,
      adId: alerts.adId,
      createdAt: alerts.createdAt,
      fatigueScore: alerts.fatigueScore,
      stage: alerts.stage,
      signals: alerts.signals,
      dismissed: alerts.dismissed,
      adName: ads.adName,
      campaignName: ads.campaignName,
      adsetName: ads.adsetName,
    })
    .from(alerts)
    .leftJoin(ads, eq(alerts.adId, ads.id))
    .where(inArray(ads.accountId, allAccountIds))
    .orderBy(desc(alerts.createdAt))
    .limit(50)
    .all();

  return NextResponse.json(allAlerts);
}
