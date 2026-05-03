import { db } from "@/lib/db";
import { ads, dailyMetrics, settings as settingsTable } from "@/lib/db/schema";
import type { Ad, DailyMetric } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import FreshnessGuard from "@/components/FreshnessGuard";
import { buildBriefing } from "@/lib/alerts/briefing";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import WatchlistSection from "./WatchlistSection";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await getSessionOrPublic();
  if (!session) redirect("/login");
  const accountId = session.accountId;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = session.allAccountIds;

  const { refreshAdStatusesForAccounts } = await import("@/lib/meta/statusRefresh");
  await refreshAdStatusesForAccounts(allAccountIds);

  const userAds = await db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all();
  const activeAds = userAds.filter((a) => a.status === "ACTIVE") as Ad[];
  const lastSyncedAt = userAds.reduce((max, a) => Math.max(max, a.lastSyncedAt ?? 0), 0);

  if (activeAds.length === 0) {
    return (
      <div className="min-h-screen">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="px-0 pb-4">
            <FreshnessGuard lastSyncedAt={lastSyncedAt || null} isPublic={!!session.isPublic} />
          </div>
          <div className="mb-8 animate-fade-in">
            <div className="display-label mb-1.5">This week</div>
            <h1 className="display-heading mb-3">Nothing to brief on yet</h1>
            <p className="text-[14.5px] leading-[1.65] text-foreground/80 max-w-2xl">
              Once your account has a few days of active spend, OD will start writing this page for you — a real Monday-morning briefing on what to push, what to pause, and why.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const recentMetrics = await db
    .select()
    .from(dailyMetrics)
    .where(inArray(dailyMetrics.adId, activeAds.map((a) => a.id)))
    .all();

  const metricsByAdId = new Map<string, DailyMetric[]>();
  for (const m of recentMetrics) {
    const arr = metricsByAdId.get(m.adId);
    if (arr) arr.push(m);
    else metricsByAdId.set(m.adId, [m]);
  }

  const userSettings = await db.select().from(settingsTable).where(eq(settingsTable.id, 1)).get();
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

  const brief = await buildBriefing(activeAds, metricsByAdId, scoringSettings);

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="px-0 pb-4">
          <FreshnessGuard lastSyncedAt={lastSyncedAt || null} isPublic={!!session.isPublic} />
        </div>

        <div className="mb-8 animate-fade-in">
          <div className="display-label mb-1.5">This week</div>
          <h1 className="display-heading mb-3">
            {brief.moves.length === 0 ? (
              <span className="gradient-text">Nothing urgent — push, don&apos;t triage</span>
            ) : (
              <>
                {brief.moves.length} move{brief.moves.length === 1 ? "" : "s"} that matter
              </>
            )}
          </h1>
          <p className="text-[14.5px] leading-[1.65] text-foreground/85 max-w-3xl">
            {brief.lede}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Glance label="Spend (7d)" value={`$${Math.round(brief.atAGlance.spend7).toLocaleString()}`} delta={brief.atAGlance.spend7WoWPct} invertGood />
          <Glance label="CTR (7d)" value={`${brief.atAGlance.ctr7.toFixed(2)}%`} delta={brief.atAGlance.ctr7WoWPct} />
          <Glance label="CPM (7d)" value={`$${brief.atAGlance.cpm7.toFixed(2)}`} delta={brief.atAGlance.cpm7WoWPct} invertGood />
          <Glance label="Avg frequency (7d)" value={`${brief.atAGlance.freq7.toFixed(1)}×`} delta={brief.atAGlance.freq7WoWPct} invertGood />
        </div>

        {brief.moves.length > 0 && (
          <section className="mb-10">
            <div className="section-head">
              <h2>What to do this week</h2>
              <p className="text-[12px] text-muted-foreground">Ranked by dollar impact, with reasoning.</p>
            </div>
            <div className="grid gap-4">
              {brief.moves.map((m) => (
                <MoveCard key={m.id} move={m} />
              ))}
            </div>
          </section>
        )}

        <section className="mb-10">
          <div className="section-head">
            <h2>What&apos;s actually happening</h2>
          </div>
          <div className="lv-card p-5 sm:p-6">
            <p className="text-[14px] leading-[1.65] text-foreground/85">{brief.diagnosis.paragraph}</p>
          </div>
        </section>

        {brief.watchlist.length > 0 && (
          <section className="mb-12">
            <div className="section-head">
              <h2>Watchlist</h2>
              <p className="text-[12px] text-muted-foreground">
                {brief.watchlist.length} ad{brief.watchlist.length === 1 ? "" : "s"} flagged by the fatigue model. Reference, not action.
              </p>
            </div>
            <WatchlistSection items={brief.watchlist} />
          </section>
        )}
      </main>
    </div>
  );
}

function Glance({ label, value, delta, invertGood }: { label: string; value: string; delta: number | null; invertGood?: boolean }) {
  let deltaColor = "#475569";
  let deltaText = "";
  if (delta !== null && Math.abs(delta) >= 1) {
    const isUp = delta > 0;
    const isGood = invertGood ? !isUp : isUp;
    deltaColor = isGood ? "#16a34a" : "#be185d";
    deltaText = `${isUp ? "+" : ""}${delta.toFixed(0)}% vs last week`;
  } else if (delta !== null) {
    deltaText = "flat vs last week";
  } else {
    deltaText = "no prior week data";
  }
  return (
    <div className="lv-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: deltaColor }}>{deltaText}</div>
    </div>
  );
}

function MoveCard({ move }: { move: { id: string; rank: 1 | 2 | 3; category: string; title: string; paragraph: string; dollarImpact: number; refAdName?: string; refCampaignName?: string } }) {
  const tone =
    move.category === "stop_bleed" ? "#F04E80"
    : move.category === "scale_winner" ? "#22c55e"
    : "#6B93D8";
  const accentBg =
    move.category === "stop_bleed" ? "rgba(240,78,128,0.05)"
    : move.category === "scale_winner" ? "rgba(34,197,94,0.05)"
    : "rgba(107,147,216,0.05)";
  return (
    <div className="lv-card p-5 sm:p-6 relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone }} />
      <div className="flex items-start gap-4">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0"
          style={{ background: accentBg, color: tone }}
        >
          {move.rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <h3 className="text-[16px] font-semibold text-foreground">{move.title}</h3>
            <span className="text-[11.5px] tabular-nums" style={{ color: tone }}>
              ~${Math.round(move.dollarImpact).toLocaleString()}/mo at stake
            </span>
          </div>
          <p className="text-[14px] leading-[1.65] text-foreground/85">{move.paragraph}</p>
          {move.refCampaignName && (
            <div className="mt-3 text-[11px] text-gray-500">
              In campaign: <span className="text-foreground/70 font-medium">{move.refCampaignName}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
