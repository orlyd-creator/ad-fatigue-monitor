import { db } from "@/lib/db";
import { alerts, ads } from "@/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import NavBar from "@/components/NavBar";
import AlertFeed from "@/components/AlertFeed";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const accountId = (session as any).accountId as string;
  if (!accountId) redirect("/login");

  // Get ad IDs belonging to this user's account
  const userAds = await db.select({ id: ads.id }).from(ads).where(eq(ads.accountId, accountId)).all();
  const userAdIds = userAds.map(a => a.id);

  if (userAdIds.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <NavBar />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Alerts</h1>
            <p className="text-[14px] text-muted-foreground mt-1">No ads found for your account.</p>
          </div>
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
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Alerts</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            When an ad crosses into a worse stage, it shows up here. Click any to see the full breakdown.
          </p>
        </div>
        <AlertFeed alerts={alertsWithNames} />
      </main>
    </div>
  );
}
