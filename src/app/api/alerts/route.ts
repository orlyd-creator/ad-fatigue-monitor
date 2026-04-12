import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alerts, ads } from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = (session as any).accountId as string;
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
    })
    .from(alerts)
    .leftJoin(ads, eq(alerts.adId, ads.id))
    .where(eq(ads.accountId, accountId))
    .orderBy(desc(alerts.createdAt))
    .limit(50)
    .all();

  return NextResponse.json(allAlerts);
}
