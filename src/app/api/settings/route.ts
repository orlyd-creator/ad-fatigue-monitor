import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  let userSettings = db.select().from(settings).where(eq(settings.id, 1)).get();

  // Create default settings if none exist
  if (!userSettings) {
    db.insert(settings).values({ id: 1 }).run();
    userSettings = db.select().from(settings).where(eq(settings.id, 1)).get();
  }

  return NextResponse.json(userSettings);
}

export async function PUT(req: NextRequest) {
  const body = await req.json();

  // Ensure settings row exists
  const existing = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!existing) {
    db.insert(settings).values({ id: 1 }).run();
  }

  db.update(settings)
    .set({
      sensitivityPreset: body.sensitivityPreset,
      ctrWeight: body.ctrWeight,
      cpmWeight: body.cpmWeight,
      frequencyWeight: body.frequencyWeight,
      conversionWeight: body.conversionWeight,
      costPerResultWeight: body.costPerResultWeight,
      engagementWeight: body.engagementWeight,
      baselineWindowDays: body.baselineWindowDays,
      recentWindowDays: body.recentWindowDays,
      minDataDays: body.minDataDays,
    })
    .where(eq(settings.id, 1))
    .run();

  const updated = db.select().from(settings).where(eq(settings.id, 1)).get();
  return NextResponse.json(updated);
}
