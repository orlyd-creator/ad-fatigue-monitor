import { db } from "@/lib/db";
import { ads, dailyMetrics } from "@/lib/db/schema";
import type { Ad, DailyMetric } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import { buildCreativeDNA, describeWinner, describeLoser } from "@/lib/creative/dna";
import FreshnessGuard from "@/components/FreshnessGuard";
import CreativeDNAMatrix from "./CreativeDNAMatrix";
import ActivePatternsList from "./ActivePatternsList";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

        {/* Page header + lede */}
        <div className="mb-8 animate-fade-in">
          <div className="display-label mb-1.5">Creative DNA</div>
          <h1 className="display-heading mb-3">
            What actually works for <span className="gradient-text">OD</span>
          </h1>
          <p className="text-[14.5px] leading-[1.65] text-foreground/80 max-w-3xl">
            {dna.storyLede}
          </p>
        </div>

        {/* Benchmarks strip — quiet, supporting context for the lede */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Bench label="Ads analyzed" value={String(dna.benchmarks.totalAds)} sub={`${dna.benchmarks.totalActiveAds} active right now`} />
          <Bench label="Portfolio CTR" value={`${dna.benchmarks.avgCtr.toFixed(2)}%`} sub="weighted by impressions" />
          <Bench
            label="Avg half-life"
            value={dna.benchmarks.avgHalfLifeDays ? `${dna.benchmarks.avgHalfLifeDays} days` : "—"}
            sub="time until CTR drops 30%"
          />
          <Bench label="Total spend" value={`$${Math.round(dna.benchmarks.totalSpend).toLocaleString()}`} sub="across all ads in DB" />
        </div>

        {/* What's working */}
        {dna.winners.length > 0 && (
          <section className="mb-10">
            <div className="section-head">
              <h2>What's working — and what to do about it</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-1">
              {dna.winners.map((p) => (
                <NarrativeCard
                  key={p.patternKey}
                  tone="winner"
                  pattern={p.patternLabel}
                  metricLine={`${p.ctrIndex.toFixed(1)}× portfolio CTR · ${p.adCount} ads · $${Math.round(p.totalSpend).toLocaleString()} spent`}
                  paragraph={describeWinner(p, dna.benchmarks)}
                  topAdName={p.ads[0]?.ad.adName}
                  topAdImage={p.ads[0]?.ad.imageUrl || p.ads[0]?.ad.thumbnailUrl}
                />
              ))}
            </div>
          </section>
        )}

        {/* What's costing you */}
        {dna.losers.length > 0 && (
          <section className="mb-10">
            <div className="section-head">
              <h2>What's costing you — and what to do about it</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-1">
              {dna.losers.map((p) => (
                <NarrativeCard
                  key={p.patternKey}
                  tone="loser"
                  pattern={p.patternLabel}
                  metricLine={`${(p.ctrIndex * 100).toFixed(0)}% of portfolio CTR · ${p.adCount} ads · ${p.activeAdCount} active`}
                  paragraph={describeLoser(p, dna.benchmarks)}
                  topAdName={p.ads.filter((a) => a.isActive)[0]?.ad.adName || p.ads[0]?.ad.adName}
                  topAdImage={
                    (p.ads.filter((a) => a.isActive)[0]?.ad.imageUrl
                      || p.ads.filter((a) => a.isActive)[0]?.ad.thumbnailUrl
                      || p.ads[0]?.ad.imageUrl
                      || p.ads[0]?.ad.thumbnailUrl) ?? null
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* Pattern matrix — full transparency */}
        <section className="mb-10">
          <div className="section-head">
            <h2>Pattern matrix</h2>
            <p className="text-[12px] text-muted-foreground">Every format × hook combination in your account, weighted by spend.</p>
          </div>
          <CreativeDNAMatrix patterns={dna.patterns} portfolioCtr={dna.benchmarks.avgCtr} />
        </section>

        {/* Currently active ads, tagged with their pattern */}
        <section className="mb-12">
          <div className="section-head">
            <h2>Live ads, tagged by pattern</h2>
            <p className="text-[12px] text-muted-foreground">How each currently-running ad's pattern has historically performed in this account.</p>
          </div>
          <ActivePatternsList scoredAds={dna.scoredAds.filter((a) => a.isActive)} portfolioCtr={dna.benchmarks.avgCtr} />
        </section>
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

function NarrativeCard({
  tone,
  pattern,
  metricLine,
  paragraph,
  topAdName,
  topAdImage,
}: {
  tone: "winner" | "loser";
  pattern: string;
  metricLine: string;
  paragraph: string;
  topAdName?: string;
  topAdImage?: string | null;
}) {
  const accent = tone === "winner" ? "#22c55e" : "#F04E80";
  const accentBg = tone === "winner" ? "rgba(34,197,94,0.06)" : "rgba(240,78,128,0.06)";
  return (
    <div className="lv-card p-5 sm:p-6 relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <div className="flex flex-col sm:flex-row gap-5">
        {topAdImage && (
          <div
            className="w-full sm:w-[140px] h-[140px] rounded-lg overflow-hidden flex-shrink-0 bg-gray-100"
            style={{ background: accentBg }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={topAdImage} alt={topAdName || ""} className="w-full h-full object-cover" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <h3 className="text-[16.5px] font-semibold text-foreground">{pattern}</h3>
            <span className="text-[11.5px] tabular-nums" style={{ color: accent }}>{metricLine}</span>
          </div>
          <p className="text-[14px] leading-[1.65] text-foreground/85">{paragraph}</p>
          {topAdName && (
            <div className="mt-3 text-[11.5px] text-gray-500">
              Reference ad: <span className="text-foreground/80 font-medium">{topAdName}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
