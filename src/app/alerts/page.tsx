import { db } from "@/lib/db";
import { alerts, ads } from "@/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import AlertFeed from "@/components/AlertFeed";
import InsightsPanel from "@/components/InsightsPanel";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await getSessionOrPublic();
  if (!session) redirect("/login");
  const accountId = session.accountId;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = session.allAccountIds;

  // Get ACTIVE ad IDs belonging to ALL of user's accounts — never show alerts for paused/archived ads
  const userAds = await db.select({ id: ads.id, status: ads.status }).from(ads).where(inArray(ads.accountId, allAccountIds)).all();
  const activeAdIds = userAds.filter(a => a.status === "ACTIVE").map(a => a.id);
  const userAdIds = activeAdIds;

  if (userAdIds.length === 0) {
    return (
      <div className="min-h-screen">
        <main className="max-w-3xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Alerts & Insights</h1>
            <p className="text-[14px] text-muted-foreground mt-1">AI-powered recommendations and fatigue alerts</p>
          </div>
          <InsightsPanel />
          <AlertFeed alerts={[]} />
        </main>
      </div>
    );
  }

  const allAlerts = await db
    .select({
      id: alerts.id,
      adId: alerts.adId,
      createdAt: alerts.createdAt,
      fatigueScore: alerts.fatigueScore,
      stage: alerts.stage,
      signals: alerts.signals,
      dismissed: alerts.dismissed,
    })
    .from(alerts)
    .where(inArray(alerts.adId, userAdIds))
    .orderBy(desc(alerts.createdAt))
    .limit(50)
    .all();

  // Attach ad names
  const alertsWithNames = await Promise.all(allAlerts.map(async (alert) => {
    const ad = await db.select({ adName: ads.adName }).from(ads).where(eq(ads.id, alert.adId)).get();
    return { ...alert, adName: ad?.adName || `Ad ${alert.adId}` };
  }));

  return (
    <div className="min-h-screen">
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Alerts & Insights</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            AI-powered recommendations and fatigue alerts
          </p>
        </div>
        <InsightsPanel />
        <h2 className="text-lg font-semibold text-foreground mb-4">Fatigue Alerts</h2>
        <AlertFeed alerts={alertsWithNames} />
      </main>
    </div>
  );
}
