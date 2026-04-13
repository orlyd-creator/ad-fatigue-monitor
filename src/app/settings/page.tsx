import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import NavBar from "@/components/NavBar";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Get or create default settings
  let userSettings = await db.select().from(settings).where(eq(settings.id, 1)).get();

  if (!userSettings) {
    await db.insert(settings).values({ id: 1 }).run();
    userSettings = (await db.select().from(settings).where(eq(settings.id, 1)).get())!;
  }

  const data = {
    sensitivityPreset: userSettings.sensitivityPreset,
    ctrWeight: userSettings.ctrWeight,
    cpmWeight: userSettings.cpmWeight,
    frequencyWeight: userSettings.frequencyWeight,
    conversionWeight: userSettings.conversionWeight,
    costPerResultWeight: userSettings.costPerResultWeight,
    engagementWeight: userSettings.engagementWeight,
    baselineWindowDays: userSettings.baselineWindowDays,
    recentWindowDays: userSettings.recentWindowDays,
    minDataDays: userSettings.minDataDays,
  };

  return (
    <div className="min-h-screen">
      <NavBar />
      <SettingsClient initialSettings={data} />
    </div>
  );
}
