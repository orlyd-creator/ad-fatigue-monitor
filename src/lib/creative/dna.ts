/**
 * Creative DNA aggregator. Takes ads + daily metrics + classifications and
 * builds the "patterns" view: each format × hook combo with averaged
 * performance, half-life, spend, and ad count. Also generates the strategist
 * narrative paragraphs that anchor the page.
 */

import type { Ad, DailyMetric } from "@/lib/db/schema";
import { classify, type ClassifiedAd, formatLabel, hookLabel } from "./classify";
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
  recentCtr: number;        // last 7 days
  recentCpm: number;        // last 7 days
  recentFrequency: number;  // last 7 days
  dailySpend: number;       // total spend / days active
  isActive: boolean;
}

export interface PatternStats {
  patternKey: string;
  patternLabel: string;
  formatLabel: string;
  hookLabel: string;
  adCount: number;
  activeAdCount: number;
  totalSpend: number;
  totalClicks: number;
  totalImpressions: number;
  totalActions: number;
  avgCtr: number;
  avgCpm: number;
  avgCpc: number;
  avgHalfLifeDays: number | null;  // null if no ads in pattern have decayed
  ctrIndex: number;                // pattern CTR / portfolio CTR (1.0 = par)
  halfLifeIndex: number | null;    // pattern half-life / portfolio half-life
  spendShare: number;              // share of total portfolio spend (0..1)
  ads: AdScored[];                 // ads in this pattern, sorted by spend desc
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
  patterns: PatternStats[];      // sorted by spend desc
  winners: PatternStats[];       // top 3 by ctrIndex (with min ad count)
  losers: PatternStats[];        // bottom 3 with active spend
  scoredAds: AdScored[];         // every ad with classification + scoring
  storyLede: string;             // 1-2 sentence narrative for the header
}

const ACTIVE = (a: Ad) => a.status === "ACTIVE";
const DAY_MS = 1000 * 60 * 60 * 24;

function recentMean<T extends DailyMetric>(metrics: T[], days: number, field: keyof T): number {
  const recent = metrics.slice(-days).filter((m) => m.impressions > 0);
  if (recent.length === 0) return 0;
  const sum = recent.reduce((s, m) => s + (m[field] as unknown as number), 0);
  return sum / recent.length;
}

export function score(ad: Ad, metrics: DailyMetric[]): AdScored {
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const totalSpend = sorted.reduce((s, m) => s + m.spend, 0);
  const totalImpressions = sorted.reduce((s, m) => s + m.impressions, 0);
  const totalClicks = sorted.reduce((s, m) => s + m.clicks, 0);
  const totalActions = sorted.reduce((s, m) => s + m.actions, 0);
  const recentCtr = recentMean(sorted, 7, "ctr");
  const recentCpm = recentMean(sorted, 7, "cpm");
  const recentFrequency = recentMean(sorted, 7, "frequency");
  const daysActive = sorted.length || 1;
  const dailySpend = totalSpend / daysActive;
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
    dailySpend,
    isActive: ACTIVE(ad),
  };
}

function aggregate(scoredAds: AdScored[]): PortfolioBenchmarks {
  const totalSpend = scoredAds.reduce((s, a) => s + a.totalSpend, 0);
  const totalImpressions = scoredAds.reduce((s, a) => s + a.totalImpressions, 0);
  const totalClicks = scoredAds.reduce((s, a) => s + a.totalClicks, 0);
  // CTR weighted by impressions, CPM weighted by spend — accurate portfolio view.
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
    const totalClicks = ads.reduce((s, a) => s + a.totalClicks, 0);
    const totalImpressions = ads.reduce((s, a) => s + a.totalImpressions, 0);
    const totalActions = ads.reduce((s, a) => s + a.totalActions, 0);
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const halfLives = ads.map((a) => a.halfLife.halfLifeDays).filter((d): d is number => d !== null);
    const avgHalfLifeDays = halfLives.length ? Math.round(halfLives.reduce((s, d) => s + d, 0) / halfLives.length) : null;
    const ctrIndex = bench.avgCtr > 0 ? avgCtr / bench.avgCtr : 0;
    const halfLifeIndex = (bench.avgHalfLifeDays && avgHalfLifeDays)
      ? avgHalfLifeDays / bench.avgHalfLifeDays
      : null;
    const spendShare = bench.totalSpend > 0 ? totalSpend / bench.totalSpend : 0;
    const sample = ads[0];
    out.push({
      patternKey: key,
      patternLabel: sample.cls.patternLabel,
      formatLabel: formatLabel(sample.cls.format),
      hookLabel: hookLabel(sample.cls.hook),
      adCount: ads.length,
      activeAdCount: ads.filter((a) => a.isActive).length,
      totalSpend,
      totalClicks,
      totalImpressions,
      totalActions,
      avgCtr,
      avgCpm,
      avgCpc,
      avgHalfLifeDays,
      ctrIndex,
      halfLifeIndex,
      spendShare,
      ads: [...ads].sort((a, b) => b.totalSpend - a.totalSpend),
    });
  }

  return out.sort((a, b) => b.totalSpend - a.totalSpend);
}

function pickWinners(patterns: PatternStats[]): PatternStats[] {
  // Eligibility: ≥3 ads OR ≥10% portfolio spend, and a clear CTR lift.
  // Avoids "lookalike of one" patterns that just had one fluke ad.
  return [...patterns]
    .filter((p) => (p.adCount >= 3 || p.spendShare >= 0.1) && p.ctrIndex >= 1.1)
    .sort((a, b) => b.ctrIndex - a.ctrIndex)
    .slice(0, 3);
}

function pickLosers(patterns: PatternStats[]): PatternStats[] {
  // Eligibility: ≥3 ads OR ≥10% spend, currently has active ads burning money,
  // CTR clearly under portfolio.
  return [...patterns]
    .filter((p) => (p.adCount >= 3 || p.spendShare >= 0.1) && p.activeAdCount >= 1 && p.ctrIndex <= 0.9)
    .sort((a, b) => a.ctrIndex - b.ctrIndex)
    .slice(0, 3);
}

function fmt$(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}
function pct(n: number, digits = 1) {
  return `${n.toFixed(digits)}%`;
}
function lift(ratio: number) {
  // 1.4 → "1.4×" / 0.6 → "0.6×"
  return `${ratio.toFixed(1)}×`;
}

export function buildLede(
  bench: PortfolioBenchmarks,
  patterns: PatternStats[],
  winners: PatternStats[],
  losers: PatternStats[],
): string {
  if (bench.totalAds === 0) {
    return "No ad data yet — sync your Meta account from the sidebar to start mapping your creative DNA.";
  }
  if (patterns.length === 0) {
    return `Across ${bench.totalAds} ads, you've spent ${fmt$(bench.totalSpend)} but the patterns aren't yet distinguishable. Once a few more ads accumulate spend, this view will start surfacing what consistently works for OD.`;
  }

  const winner = winners[0];
  const loser = losers[0];

  const parts: string[] = [];
  if (winner) {
    const halfLine = winner.avgHalfLifeDays && bench.avgHalfLifeDays
      ? ` and stays viable about ${winner.avgHalfLifeDays} days before fatigue sets in (vs. ${bench.avgHalfLifeDays} days portfolio-wide)`
      : "";
    parts.push(
      `Across ${bench.totalAds} ads and ${fmt$(bench.totalSpend)} of spend, your most reliable creative pattern is ${winner.patternLabel.toLowerCase()}: it earns ${lift(winner.ctrIndex)} the click-through of your portfolio average${halfLine}.`,
    );
  }
  if (loser) {
    const activeLine = loser.activeAdCount > 0
      ? ` ${loser.activeAdCount} of those ads ${loser.activeAdCount === 1 ? "is" : "are"} live right now, costing roughly ${fmt$(loser.totalSpend / Math.max(1, loser.adCount))} per ad on average and lifting your blended CPL.`
      : "";
    parts.push(
      `Your weakest pattern is ${loser.patternLabel.toLowerCase()} — it underperforms by about ${lift(1 - loser.ctrIndex)}.${activeLine}`,
    );
  }
  if (!winner && !loser) {
    parts.push(
      `Across ${bench.totalAds} ads and ${fmt$(bench.totalSpend)} of spend, no pattern is meaningfully ahead or behind the rest. That's typical when most ads share a single format — try testing a different format or hook so this view can start telling you what wins.`,
    );
  }

  return parts.join(" ");
}

export function describeWinner(p: PatternStats, bench: PortfolioBenchmarks): string {
  const top = p.ads[0];
  const halfLifeLine = (p.avgHalfLifeDays && bench.avgHalfLifeDays)
    ? ` Ads in this pattern keep working for about ${p.avgHalfLifeDays} days before CTR decays 30% from peak — ${p.avgHalfLifeDays > bench.avgHalfLifeDays ? `${p.avgHalfLifeDays - bench.avgHalfLifeDays} days longer than your portfolio average` : `roughly in line with the rest of the account`}.`
    : "";
  const cpcLine = (bench.avgCpc > 0 && p.avgCpc > 0)
    ? ` Click cost runs ${pct(((bench.avgCpc - p.avgCpc) / bench.avgCpc) * 100, 0)} below the portfolio.`
    : "";
  const moveLine = p.activeAdCount === 0
    ? ` Nothing in this pattern is live right now. Brief a fresh variant of "${top.ad.adName}" and ship it this week — you're leaving cheap clicks on the table.`
    : ` You have ${p.activeAdCount} active ad${p.activeAdCount === 1 ? "" : "s"} on this pattern. Increase their daily budgets 15–20% and prep two new variants of "${top.ad.adName}" so you have replacements queued before fatigue hits.`;
  return [
    `${p.patternLabel} drove ${lift(p.ctrIndex)} your portfolio CTR across ${p.adCount} ads and ${fmt$(p.totalSpend)} of spend.`,
    halfLifeLine,
    cpcLine,
    moveLine,
  ].join("").trim();
}

export function describeLoser(p: PatternStats, bench: PortfolioBenchmarks): string {
  const top = p.ads.filter((a) => a.isActive)[0] || p.ads[0];
  const dailyBleed = p.ads.filter((a) => a.isActive).reduce((s, a) => s + a.dailySpend, 0);
  const ctrGapPct = pct((1 - p.ctrIndex) * 100, 0);

  const halfLifeLine = (p.avgHalfLifeDays && bench.avgHalfLifeDays && p.avgHalfLifeDays < bench.avgHalfLifeDays)
    ? ` They also fatigue faster — averaging ${p.avgHalfLifeDays} productive days vs. ${bench.avgHalfLifeDays} for the rest of the account, so each refresh you ship in this style buys less time than usual.`
    : "";

  const moveLine = p.activeAdCount === 0
    ? ` Nothing in this pattern is currently live, so the action is preventative: avoid briefing more like "${top.ad.adName}" until you can pair it with a stronger hook or format.`
    : ` Right now ${p.activeAdCount} ad${p.activeAdCount === 1 ? "" : "s"} on this pattern ${p.activeAdCount === 1 ? "is" : "are"} burning roughly ${fmt$(dailyBleed)}/day. Pause "${top.ad.adName}" within the next 3–5 days and shift that budget into your strongest pattern instead of refreshing this style again.`;

  return [
    `${p.patternLabel} runs ${ctrGapPct} below your portfolio CTR across ${p.adCount} ads and ${fmt$(p.totalSpend)} of historical spend.`,
    halfLifeLine,
    moveLine,
  ].join("").trim();
}

export function buildCreativeDNA(ads: Ad[], metricsByAdId: Map<string, DailyMetric[]>): CreativeDNAResult {
  const scoredAds = ads.map((ad) => score(ad, metricsByAdId.get(ad.id) || []));
  const benchmarks = aggregate(scoredAds);
  const patterns = buildPatterns(scoredAds, benchmarks);
  const winners = pickWinners(patterns);
  const losers = pickLosers(patterns);
  const storyLede = buildLede(benchmarks, patterns, winners, losers);
  return { benchmarks, patterns, winners, losers, scoredAds, storyLede };
}
