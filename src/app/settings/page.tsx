import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import NavBar from "@/components/NavBar";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  // Get or create default settings
  let userSettings = db.select().from(settings).where(eq(settings.id, 1)).get();

  if (!userSettings) {
    db.insert(settings).values({ id: 1 }).run();
    userSettings = db.select().from(settings).where(eq(settings.id, 1)).get()!;
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
    <div className="min-h-screen bg-background">
      <NavBar />
      <SettingsClient initialSettings={data} />
    </div>
  );
}
