/**
 * Creative DNA aggregator. Builds the data shapes the page renders:
 *   - benchmarks (portfolio averages)
 *   - scoredAds (every ad with classification + half-life + metrics)
 *   - patterns (ads grouped by theme × treatment, sorted)
 *   - matchup (top performer vs bottom performer among active ads)
 *   - historical winners + losers (for the "what history teaches" section)
 *   - lede (auto-generated story summary)
 */

import type { Ad, DailyMetric } from "@/lib/db/schema";
import { classify, type ClassifiedAd } from "./classify";
import { computeHalfLife, type HalfLifeResult } from "./halflife";

export interface AdScored {
  ad: Ad;
  cls: ClassifiedAd;
  halfLife: HalfLifeResult;
  metrics: DailyMetric[];
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalActions: number;
  recentCtr: number;        // last 7 days, weighted by impressions
  recentCpm: number;
  recentFrequency: number;
  recentCpc: number;
  dailySpend: number;
  isActive: boolean;
}

export interface PatternStats {
  patternKey: string;
  patternLabel: string;
  themeLabel: string;
  treatmentLabel: string;
  adCount: number;
  activeAdCount: number;
  totalSpend: number;
  avgCtr: number;
  avgHalfLifeDays: number | null;
  ctrIndex: number;       // pattern CTR / portfolio CTR
  spendShare: number;
  ads: AdScored[];        // sorted by spend desc
}

export interface PortfolioBenchmarks {
  avgCtr: number;
  avgCpm: number;
  avgCpc: number;
  avgHalfLifeDays: number | null;
  totalSpend: number;
  totalAds: number;
  totalActiveAds: number;
}

export interface CreativeDNAResult {
  benchmarks: PortfolioBenchmarks;
  scoredAds: AdScored[];          // every ad
  activeAds: AdScored[];          // active subset, sorted by daily spend desc
  patterns: PatternStats[];       // theme×treatment groups, sorted by spend
  topActive: AdScored | null;     // best active ad by recent CTR
  bottomActive: AdScored | null;  // worst active ad by recent CTR
  historicalWinners: AdScored[];  // top 5 paused/archived by recent CTR with min spend
  historicalLosers: AdScored[];   // bottom 5 paused/archived by recent CTR with min spend
  themeWinners: { theme: string; avgCtr: number; ctrIndex: number; adCount: number; totalSpend: number }[]; // theme leaderboard
  storyLede: string;
}

const recentMean = <T,>(arr: T[], days: number, field: keyof T): number => {
  const recent = arr.slice(-days).filter((m: any) => (m.impressions || 0) > 0);
  if (recent.length === 0) return 0;
  const sum = recent.reduce((s: number, m: any) => s + (Number(m[field]) || 0), 0);
  return sum / recent.length;
};

export function score(ad: Ad, metrics: DailyMetric[]): AdScored {
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const totalSpend = sorted.reduce((s, m) => s + m.spend, 0);
  const totalImpressions = sorted.reduce((s, m) => s + m.impressions, 0);
  const totalClicks = sorted.reduce((s, m) => s + m.clicks, 0);
  const totalActions = sorted.reduce((s, m) => s + m.actions, 0);

  const days = sorted.length || 1;
  const dailySpend = totalSpend / days;

  const recentCtr = recentMean(sorted, 7, "ctr");
  const recentCpm = recentMean(sorted, 7, "cpm");
  const recentFrequency = recentMean(sorted, 7, "frequency");
  const recentCpc = recentMean(sorted, 7, "cpc");

  return {
    ad,
    cls: classify(ad),
    halfLife: computeHalfLife(ad.id, sorted),
    metrics: sorted,
    totalSpend,
    totalImpressions,
    totalClicks,
    totalActions,
    recentCtr,
    recentCpm,
    recentFrequency,
    recentCpc,
    dailySpend,
    isActive: ad.status === "ACTIVE",
  };
}

function aggregate(scoredAds: AdScored[]): PortfolioBenchmarks {
  const totalSpend = scoredAds.reduce((s, a) => s + a.totalSpend, 0);
  const totalImpressions = scoredAds.reduce((s, a) => s + a.totalImpressions, 0);
  const totalClicks = scoredAds.reduce((s, a) => s + a.totalClicks, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const halfLives = scoredAds.map((a) => a.halfLife.halfLifeDays).filter((d): d is number => d !== null);
  const avgHalfLifeDays = halfLives.length ? Math.round(halfLives.reduce((s, d) => s + d, 0) / halfLives.length) : null;
  return {
    avgCtr,
    avgCpm,
    avgCpc,
    avgHalfLifeDays,
    totalSpend,
    totalAds: scoredAds.length,
    totalActiveAds: scoredAds.filter((a) => a.isActive).length,
  };
}

function buildPatterns(scoredAds: AdScored[], bench: PortfolioBenchmarks): PatternStats[] {
  const groups = new Map<string, AdScored[]>();
  for (const a of scoredAds) {
    const arr = groups.get(a.cls.patternKey);
    if (arr) arr.push(a);
    else groups.set(a.cls.patternKey, [a]);
  }
  const out: PatternStats[] = [];
  for (const [key, ads] of groups) {
    const totalSpend = ads.reduce((s, a) => s + a.totalSpend, 0);
    const totalImpressions = ads.reduce((s, a) => s + a.totalImpressions, 0);
    const totalClicks = ads.reduce((s, a) => s + a.totalClicks, 0);
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const halfLives = ads.map((a) => a.halfLife.halfLifeDays).filter((d): d is number => d !== null);
    const avgHalfLifeDays = halfLives.length ? Math.round(halfLives.reduce((s, d) => s + d, 0) / halfLives.length) : null;
    const ctrIndex = bench.avgCtr > 0 ? avgCtr / bench.avgCtr : 0;
    const spendShare = bench.totalSpend > 0 ? totalSpend / bench.totalSpend : 0;
    const sample = ads[0];
    out.push({
      patternKey: key,
      patternLabel: sample.cls.patternLabel,
      themeLabel: sample.cls.themeLabel,
      treatmentLabel: sample.cls.treatmentLabel,
      adCount: ads.length,
      activeAdCount: ads.filter((a) => a.isActive).length,
      totalSpend,
      avgCtr,
      avgHalfLifeDays,
      ctrIndex,
      spendShare,
      ads: [...ads].sort((a, b) => b.totalSpend - a.totalSpend),
    });
  }
  return out.sort((a, b) => b.totalSpend - a.totalSpend);
}

function buildThemeWinners(scoredAds: AdScored[], bench: PortfolioBenchmarks) {
  const byTheme = new Map<string, AdScored[]>();
  for (const a of scoredAds) {
    const arr = byTheme.get(a.cls.theme);
    if (arr) arr.push(a);
    else byTheme.set(a.cls.theme, [a]);
  }
  const out = Array.from(byTheme.entries()).map(([theme, ads]) => {
    const totalImpressions = ads.reduce((s, a) => s + a.totalImpressions, 0);
    const totalClicks = ads.reduce((s, a) => s + a.totalClicks, 0);
    const totalSpend = ads.reduce((s, a) => s + a.totalSpend, 0);
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const ctrIndex = bench.avgCtr > 0 ? avgCtr / bench.avgCtr : 0;
    return {
      theme: ads[0].cls.themeLabel,
      avgCtr,
      ctrIndex,
      adCount: ads.length,
      totalSpend,
    };
  });
  return out
    .filter((t) => t.adCount >= 2)         // need at least 2 ads to call it a theme
    .sort((a, b) => b.ctrIndex - a.ctrIndex);
}

function pickHistorical(scoredAds: AdScored[], minSpend: number) {
  // Paused / archived ads with real spend, ranked by recent CTR.
  const eligible = scoredAds.filter(
    (a) => !a.isActive && a.totalSpend >= minSpend && a.metrics.length >= 5,
  );
  const sorted = [...eligible].sort((a, b) => b.recentCtr - a.recentCtr);
  return {
    winners: sorted.slice(0, 5),
    losers: sorted.slice(-5).reverse(),
  };
}

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const lift = (ratio: number) => `${ratio.toFixed(1)}×`;

function buildLede(
  bench: PortfolioBenchmarks,
  active: AdScored[],
  themeWinners: { theme: string; avgCtr: number; ctrIndex: number; adCount: number; totalSpend: number }[],
  topActive: AdScored | null,
  bottomActive: AdScored | null,
): string {
  if (bench.totalAds === 0) {
    return "No ads in the database yet — sync your Meta account from the sidebar to start mapping your creative DNA.";
  }
  if (active.length === 0) {
    return `You have ${bench.totalAds} ads in this account's history but nothing is live right now. The historical lens at the bottom of this page is still useful — it shows which themes earned and which burned cash, so the next round you brief is informed by what worked.`;
  }

  const parts: string[] = [];

  parts.push(
    `You have ${active.length} ad${active.length === 1 ? "" : "s"} live right now spending ${fmt$(active.reduce((s, a) => s + a.dailySpend, 0))}/day combined.`,
  );

  if (topActive && bottomActive && topActive.ad.id !== bottomActive.ad.id) {
    const liftPct = bottomActive.recentCtr > 0
      ? ((topActive.recentCtr - bottomActive.recentCtr) / bottomActive.recentCtr) * 100
      : 0;
    parts.push(
      `Your best performer ("${topActive.ad.adName}") is pulling ${lift(topActive.recentCtr / Math.max(0.01, bench.avgCtr))} the portfolio's CTR while your worst ("${bottomActive.ad.adName}") sits ${liftPct > 0 ? `${liftPct.toFixed(0)}% behind` : "below"} it — same audience, different angle, different result.`,
    );
  }

  const topTheme = themeWinners[0];
  if (topTheme) {
    parts.push(
      `Across all ${bench.totalAds} ads in your history, ${topTheme.theme.toLowerCase()} framing is the most reliable theme (${lift(topTheme.ctrIndex)} the portfolio CTR across ${topTheme.adCount} ads). When you brief the next round, that's the bias to keep.`,
    );
  } else {
    parts.push(`Your account doesn't have a dominant theme yet — historical CTR is roughly even across the angles you've tested. The next test should pick one and double down so the picture sharpens.`);
  }

  return parts.join(" ");
}

export function buildCreativeDNA(ads: Ad[], metricsByAdId: Map<string, DailyMetric[]>): CreativeDNAResult {
  const scoredAds = ads.map((ad) => score(ad, metricsByAdId.get(ad.id) || []));
  const benchmarks = aggregate(scoredAds);
  const patterns = buildPatterns(scoredAds, benchmarks);

  const activeAds = scoredAds
    .filter((a) => a.isActive)
    .sort((a, b) => b.dailySpend - a.dailySpend);

  // For matchup: use only ads with enough data to be fair (at least 5 days
  // and meaningful spend). If we don't have 2 such ads, fall back to "all active".
  const eligibleForMatchup = activeAds.filter((a) => a.metrics.length >= 5 && a.totalSpend >= 50);
  const matchupPool = eligibleForMatchup.length >= 2 ? eligibleForMatchup : activeAds;

  const byCtrDesc = [...matchupPool].sort((a, b) => b.recentCtr - a.recentCtr);
  const topActive = byCtrDesc[0] || null;
  const bottomActive = byCtrDesc.length >= 2 ? byCtrDesc[byCtrDesc.length - 1] : null;

  const themeWinners = buildThemeWinners(scoredAds, benchmarks);
  const { winners: historicalWinners, losers: historicalLosers } = pickHistorical(scoredAds, 50);

  const storyLede = buildLede(benchmarks, activeAds, themeWinners, topActive, bottomActive);

  return {
    benchmarks,
    scoredAds,
    activeAds,
    patterns,
    topActive,
    bottomActive,
    historicalWinners,
    historicalLosers,
    themeWinners,
    storyLede,
  };
}
