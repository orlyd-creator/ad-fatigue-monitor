import { db } from "@/lib/db";
import { alerts, ads, dailyMetrics } from "@/lib/db/schema";
import { desc, eq, inArray, gte } from "drizzle-orm";
import AlertFeed from "@/components/AlertFeed";
import InsightsPanel from "@/components/InsightsPanel";
import FreshnessGuard from "@/components/FreshnessGuard";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import { format, startOfMonth, subDays } from "date-fns";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await getSessionOrPublic();
  if (!session) redirect("/login");
  const accountId = session.accountId;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = session.allAccountIds;

  // Kick off status refresh so paused ads drop out of the lists.
  const { refreshAdStatusesForAccounts } = await import("@/lib/meta/statusRefresh");
  await refreshAdStatusesForAccounts(allAccountIds);

  const userAds = await db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all();
  const activeAds = userAds.filter(a => a.status === "ACTIVE");
  const activeAdIds = activeAds.map(a => a.id);
  const lastSyncedAt = userAds.reduce((max, a) => Math.max(max, a.lastSyncedAt ?? 0), 0);

  if (activeAdIds.length === 0) {
    return (
      <div className="min-h-screen">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="px-0 pb-4">
            <FreshnessGuard lastSyncedAt={lastSyncedAt || null} isPublic={!!session.isPublic} />
          </div>
          <div className="mb-8 animate-fade-in">
            <div className="display-label mb-1.5">Alerts & Insights</div>
            <h1 className="display-heading mb-1.5">Nothing urgent</h1>
            <p className="text-[13.5px] text-muted-foreground">
              Click Refresh to pull your latest Meta data. Insights + fatigue alerts appear here.
            </p>
          </div>
          <InsightsPanel />
        </main>
      </div>
    );
  }

  const allAlerts = await db
    .select()
    .from(alerts)
    .where(inArray(alerts.adId, activeAdIds))
    .orderBy(desc(alerts.createdAt))
    .limit(100)
    .all();

  // Enrich with ad + campaign context.
  const adById = new Map(activeAds.map(a => [a.id, a]));
  const alertsWithNames = allAlerts.map(alert => {
    const ad = adById.get(alert.adId);
    return {
      ...alert,
      adName: ad?.adName || `Ad ${alert.adId}`,
      campaignName: ad?.campaignName,
      adsetName: ad?.adsetName,
    };
  });

  // Summary stats for the header row
  const stageCount = { healthy: 0, early_warning: 0, fatiguing: 0, fatigued: 0 } as Record<string, number>;
  const seenAdIds = new Set<string>();
  const mostRecentByAd = new Map<string, typeof alertsWithNames[number]>();
  for (const a of alertsWithNames) {
    if (!mostRecentByAd.has(a.adId)) mostRecentByAd.set(a.adId, a);
  }
  for (const a of mostRecentByAd.values()) {
    stageCount[a.stage] = (stageCount[a.stage] || 0) + 1;
    seenAdIds.add(a.adId);
  }
  const totalFlagged = (stageCount.fatigued || 0) + (stageCount.fatiguing || 0) + (stageCount.early_warning || 0);

  // Spend at risk: how much MTD spend sits on flagged ads
  const thisMonthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 29), "yyyy-MM-dd");
  const recentMetrics = await db
    .select()
    .from(dailyMetrics)
    .where(gte(dailyMetrics.date, thirtyDaysAgo))
    .all();

  const spendByAd = new Map<string, number>();
  for (const m of recentMetrics) {
    if (m.date < thisMonthStart) continue;
    spendByAd.set(m.adId, (spendByAd.get(m.adId) || 0) + (m.spend ?? 0));
  }
  let spendAtRisk = 0;
  let spendHealthy = 0;
  for (const a of mostRecentByAd.values()) {
    const s = spendByAd.get(a.adId) || 0;
    if (a.stage === "fatiguing" || a.stage === "fatigued" || a.stage === "early_warning") {
      spendAtRisk += s;
    } else {
      spendHealthy += s;
    }
  }
  const totalActiveSpend = Array.from(spendByAd.values()).reduce((s, v) => s + v, 0);

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="px-0 pb-4">
          <FreshnessGuard lastSyncedAt={lastSyncedAt || null} isPublic={!!session.isPublic} />
        </div>

        {/* Page header */}
        <div className="mb-6 animate-fade-in">
          <div className="display-label mb-1.5">Alerts & Insights</div>
          <h1 className="display-heading mb-1.5">
            {totalFlagged === 0 ? (
              <span className="gradient-text">Everything looks healthy</span>
            ) : (
              <>
                <span className="text-[#F04E80]">{totalFlagged}</span> ad{totalFlagged === 1 ? "" : "s"} need attention
              </>
            )}
          </h1>
          <p className="text-[13.5px] text-muted-foreground max-w-2xl">
            Live fatigue scoring + AI recommendations based on your actual Meta + HubSpot data.
            Click any alert to see the full signal breakdown for that ad.
          </p>
        </div>

        {/* Summary stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <SummaryStat
            label="Spend at risk"
            value={`$${Math.round(spendAtRisk).toLocaleString()}`}
            sub={`${totalActiveSpend > 0 ? Math.round((spendAtRisk / totalActiveSpend) * 100) : 0}% of this month's ad spend`}
            accent="#F04E80"
          />
          <SummaryStat
            label="Fatigued"
            value={String(stageCount.fatigued || 0)}
            sub="needs replacement now"
            accent="#ef4444"
          />
          <SummaryStat
            label="Fatiguing"
            value={String(stageCount.fatiguing || 0)}
            sub="watch closely"
            accent="#f97316"
          />
          <SummaryStat
            label="Healthy"
            value={String(activeAds.length - totalFlagged)}
            sub={`of ${activeAds.length} active ads`}
            accent="#22c55e"
          />
        </div>

        {/* AI-generated strategic insights (campaign-level) */}
        <div className="mb-6">
          <InsightsPanel />
        </div>

        {/* Fatigue alert feed */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-foreground">Fatigue alerts</h2>
            <div className="text-[11px] text-gray-500">
              {mostRecentByAd.size} ad{mostRecentByAd.size === 1 ? "" : "s"} flagged,
              newest first
            </div>
          </div>
          <AlertFeed alerts={alertsWithNames} />
        </section>
      </main>
    </div>
  );
}

function SummaryStat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="lv-card p-4 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-[22px] font-semibold tabular-nums" style={{ color: accent }}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}
