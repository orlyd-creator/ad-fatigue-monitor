import { db } from "@/lib/db";
import { ads, dailyMetrics } from "@/lib/db/schema";
import type { Ad, DailyMetric } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import { buildCreativeDNA, type AdScored } from "@/lib/creative/dna";
import { narrate, compareWinnerLoser } from "@/lib/creative/narrative";
import FreshnessGuard from "@/components/FreshnessGuard";
import HistoricalLens from "./HistoricalLens";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATUS_TONE: Record<string, { color: string; bg: string; label: string }> = {
  winner: { color: "#16a34a", bg: "rgba(34,197,94,0.08)",  label: "Winner" },
  watch:  { color: "#475569", bg: "rgba(148,163,184,0.10)", label: "Holding" },
  fading: { color: "#c2410c", bg: "rgba(249,115,22,0.10)",  label: "Fading" },
  dead:   { color: "#be185d", bg: "rgba(240,78,128,0.10)",  label: "Pause it" },
  early:  { color: "#1d4ed8", bg: "rgba(59,130,246,0.10)",  label: "Too early" },
};

export default async function CreativeDNAPage() {
  const session = await getSessionOrPublic();
  if (!session) redirect("/login");
  const accountId = session.accountId;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = session.allAccountIds;

  const allAds = await db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all();
  const lastSyncedAt = allAds.reduce((max, a) => Math.max(max, a.lastSyncedAt ?? 0), 0);

  if (allAds.length === 0) {
    return (
      <div className="min-h-screen">
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="px-0 pb-4">
            <FreshnessGuard lastSyncedAt={null} isPublic={!!session.isPublic} />
          </div>
          <div className="mb-8 animate-fade-in">
            <div className="display-label mb-1.5">Creative DNA</div>
            <h1 className="display-heading mb-1.5">No ads to read yet</h1>
            <p className="text-[14px] text-muted-foreground max-w-2xl">
              Sync your Meta account from the sidebar so OD can map your creative patterns.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const adIds = allAds.map((a) => a.id);
  const allMetrics = adIds.length === 0
    ? []
    : await db.select().from(dailyMetrics).where(inArray(dailyMetrics.adId, adIds)).all();
  const metricsByAdId = new Map<string, DailyMetric[]>();
  for (const m of allMetrics) {
    const arr = metricsByAdId.get(m.adId);
    if (arr) arr.push(m);
    else metricsByAdId.set(m.adId, [m]);
  }

  const dna = buildCreativeDNA(allAds as Ad[], metricsByAdId);

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="px-0 pb-4">
          <FreshnessGuard lastSyncedAt={lastSyncedAt || null} isPublic={!!session.isPublic} />
        </div>

        {/* Header + lede */}
        <div className="mb-8 animate-fade-in">
          <div className="display-label mb-1.5">Creative DNA</div>
          <h1 className="display-heading mb-3">
            What actually works for <span className="gradient-text">OD</span>
          </h1>
          <p className="text-[14.5px] leading-[1.65] text-foreground/80 max-w-3xl">
            {dna.storyLede}
          </p>
        </div>

        {/* Benchmarks strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Bench label="Active ads" value={String(dna.benchmarks.totalActiveAds)} sub={`of ${dna.benchmarks.totalAds} total in DB`} />
          <Bench label="Portfolio CTR" value={`${dna.benchmarks.avgCtr.toFixed(2)}%`} sub="weighted by impressions" />
          <Bench
            label="Avg half-life"
            value={dna.benchmarks.avgHalfLifeDays ? `${dna.benchmarks.avgHalfLifeDays} days` : "—"}
            sub="time until CTR drops 30%"
          />
          <Bench label="Lifetime spend" value={`$${Math.round(dna.benchmarks.totalSpend).toLocaleString()}`} sub="across all ads" />
        </div>

        {/* The Matchup — top vs bottom active */}
        {dna.topActive && dna.bottomActive && dna.topActive.ad.id !== dna.bottomActive.ad.id && (
          <section className="mb-10">
            <div className="section-head">
              <h2>The matchup</h2>
              <p className="text-[12px] text-muted-foreground">Your strongest live ad vs your weakest, side-by-side.</p>
            </div>
            <div className="lv-card p-5 sm:p-6">
              <div className="grid md:grid-cols-2 gap-4 mb-5">
                <MatchupCard ad={dna.topActive} portfolioCtr={dna.benchmarks.avgCtr} side="winner" />
                <MatchupCard ad={dna.bottomActive} portfolioCtr={dna.benchmarks.avgCtr} side="loser" />
              </div>
              <div className="border-t border-gray-100 pt-4">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">What separates them</div>
                <p className="text-[14px] leading-[1.65] text-foreground/85">
                  {compareWinnerLoser(dna.topActive, dna.bottomActive, dna.benchmarks.avgCtr)}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Per-ad strategist briefs */}
        {dna.activeAds.length > 0 && (
          <section className="mb-10">
            <div className="section-head">
              <h2>Every active ad, briefed</h2>
              <p className="text-[12px] text-muted-foreground">A real read on each ad — what it is, how it's performing, and what to do this week.</p>
            </div>
            <div className="grid gap-4">
              {dna.activeAds.map((a) => (
                <AdBriefCard key={a.ad.id} ad={a} portfolioCtr={dna.benchmarks.avgCtr} portfolioHalfLife={dna.benchmarks.avgHalfLifeDays} />
              ))}
            </div>
          </section>
        )}

        {/* What history teaches */}
        {(dna.historicalWinners.length > 0 || dna.themeWinners.length > 0) && (
          <section className="mb-12">
            <div className="section-head">
              <h2>What your history teaches you</h2>
              <p className="text-[12px] text-muted-foreground">Patterns that repeated across every ad you've ever run, so the next round is informed.</p>
            </div>
            <HistoricalLens
              winners={dna.historicalWinners}
              losers={dna.historicalLosers}
              themeWinners={dna.themeWinners}
              portfolioCtr={dna.benchmarks.avgCtr}
            />
          </section>
        )}
      </main>
    </div>
  );
}

function Bench({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="lv-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

function MatchupCard({ ad, portfolioCtr, side }: { ad: AdScored; portfolioCtr: number; side: "winner" | "loser" }) {
  const accent = side === "winner" ? "#22c55e" : "#F04E80";
  const bg = side === "winner" ? "rgba(34,197,94,0.05)" : "rgba(240,78,128,0.05)";
  const label = side === "winner" ? "Winning" : "Losing";
  const ctrIndex = portfolioCtr > 0 ? ad.recentCtr / portfolioCtr : 1;
  return (
    <div className="rounded-xl border border-gray-100 p-4" style={{ background: bg }}>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: accent }}>{label}</span>
        <span className="text-[11px] tabular-nums text-foreground/60">{ctrIndex.toFixed(1)}× portfolio</span>
      </div>
      <div className="flex gap-3">
        {(ad.ad.imageUrl || ad.ad.thumbnailUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.ad.imageUrl || ad.ad.thumbnailUrl || ""} alt="" className="w-20 h-20 rounded-lg object-cover bg-white flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-foreground truncate" title={ad.ad.adName}>{ad.ad.adName}</div>
          <div className="text-[11px] text-gray-500 truncate mb-2" title={`${ad.cls.themeLabel} · ${ad.cls.audienceLabel}`}>
            {ad.cls.themeLabel} · {ad.cls.audienceLabel}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums">
            <Stat label="CTR" value={`${ad.recentCtr.toFixed(2)}%`} />
            <Stat label="Daily" value={`$${ad.dailySpend.toFixed(0)}`} />
            <Stat label="Freq" value={`${ad.recentFrequency.toFixed(1)}×`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-[12px] font-semibold text-foreground">{value}</div>
    </div>
  );
}

function AdBriefCard({ ad, portfolioCtr, portfolioHalfLife }: { ad: AdScored; portfolioCtr: number; portfolioHalfLife: number | null }) {
  const narrative = narrate(ad, portfolioCtr, portfolioHalfLife);
  const tone = STATUS_TONE[narrative.status] || STATUS_TONE.watch;
  return (
    <div className="lv-card p-5 sm:p-6 relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone.color }} />
      <div className="flex flex-col sm:flex-row gap-4">
        {(ad.ad.imageUrl || ad.ad.thumbnailUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.ad.imageUrl || ad.ad.thumbnailUrl || ""}
            alt=""
            className="w-full sm:w-[120px] h-[120px] rounded-lg object-cover bg-gray-100 flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap mb-1">
            <h3 className="text-[15.5px] font-semibold text-foreground">{ad.ad.adName}</h3>
            <span
              className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full"
              style={{ background: tone.bg, color: tone.color }}
            >
              {tone.label}
            </span>
          </div>
          <div className="text-[11.5px] text-gray-500 mb-2">
            {ad.cls.themeLabel} · {ad.cls.treatmentLabel} · {ad.cls.audienceLabel} · {ad.ad.campaignName}
          </div>
          <div className="text-[13px] font-medium mb-2" style={{ color: tone.color }}>
            {narrative.oneLine}
          </div>
          <p className="text-[13.5px] leading-[1.65] text-foreground/85">{narrative.paragraph}</p>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] tabular-nums">
            <KV label="Days running" value={String(ad.metrics.length)} />
            <KV label="Total spend" value={`$${Math.round(ad.totalSpend).toLocaleString()}`} />
            <KV label="Recent CTR" value={`${ad.recentCtr.toFixed(2)}%`} />
            <KV label="Recent freq" value={`${ad.recentFrequency.toFixed(1)}×`} />
            <KV label="Decay" value={`${Math.round((ad.halfLife.decayedBy || 0) * 100)}%`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-[12px] font-semibold text-foreground">{value}</div>
    </div>
  );
}
