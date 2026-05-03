/**
 * "This Week" briefing builder. Turns the same ad + metrics + alerts data the
 * old alerts page used into a small set of strongly-worded narrative blocks:
 *
 *  - lede        : 1-3 sentence overview of the week (WoW deltas + headline)
 *  - moves       : up to 3 specific actions ranked by $ impact, each with a
 *                  multi-sentence reasoning
 *  - diagnosis   : short paragraph distinguishing audience saturation, creative
 *                  wear, and auction inflation
 *  - numbers     : at-a-glance metrics with WoW deltas
 *  - watchlist   : the same fatigue alerts list we used to lead with — now
 *                  collapsed reference, not the headline
 */

import type { Ad, DailyMetric, Alert } from "@/lib/db/schema";
import type { FatigueResult, ScoringSettings } from "@/lib/fatigue/types";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";

export interface AdWithFatigue {
  ad: Ad;
  metrics: DailyMetric[];
  fatigue: FatigueResult;
  recentSpend7: number;
  priorSpend7: number;
  recentCtr7: number;
  priorCtr7: number;
  recentCpm7: number;
  priorCpm7: number;
  recentFreq7: number;
  priorFreq7: number;
  dailySpendNow: number;
}

export interface Move {
  id: string;
  rank: 1 | 2 | 3;
  category: "stop_bleed" | "scale_winner" | "queue_replacement" | "audience" | "test";
  title: string;
  paragraph: string;        // multi-sentence reasoning, written as prose
  dollarImpact: number;     // monthly $ at stake (positive = save / earn)
  refAdName?: string;
  refCampaignName?: string;
}

export interface Diagnosis {
  primaryDriver: "saturation" | "creative_wear" | "auction_inflation" | "mixed" | "none";
  paragraph: string;
}

export interface AtAGlance {
  spend7: number;
  spend7WoWPct: number | null;
  ctr7: number;
  ctr7WoWPct: number | null;
  cpm7: number;
  cpm7WoWPct: number | null;
  freq7: number;
  freq7WoWPct: number | null;
}

export interface BriefingResult {
  lede: string;
  atAGlance: AtAGlance;
  moves: Move[];
  diagnosis: Diagnosis;
  watchlist: AdWithFatigue[]; // ads with fatigueScore >= 25, sorted desc
}

const DAY_MS = 1000 * 60 * 60 * 24;
const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number, d = 0) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

function meanField<T>(arr: T[], field: keyof T): number {
  const nums = arr.map((x) => x[field] as unknown as number).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function sumField<T>(arr: T[], field: keyof T): number {
  return arr.reduce((s, x) => s + (Number(x[field]) || 0), 0);
}

function pctChange(a: number, b: number): number | null {
  if (b === 0) return null;
  return ((a - b) / b) * 100;
}

function toAdWithFatigue(ad: Ad, metrics: DailyMetric[], settings: ScoringSettings): AdWithFatigue {
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const last7 = sorted.slice(-7);
  const prior7 = sorted.slice(-14, -7);
  const fatigue = calculateFatigueScore(sorted, settings);
  const totalSpend = sumField(sorted, "spend");
  const days = sorted.length || 1;
  return {
    ad,
    metrics: sorted,
    fatigue,
    recentSpend7: sumField(last7, "spend"),
    priorSpend7: sumField(prior7, "spend"),
    recentCtr7: meanField(last7.filter(m => m.impressions > 0), "ctr"),
    priorCtr7: meanField(prior7.filter(m => m.impressions > 0), "ctr"),
    recentCpm7: meanField(last7.filter(m => m.impressions > 0), "cpm"),
    priorCpm7: meanField(prior7.filter(m => m.impressions > 0), "cpm"),
    recentFreq7: meanField(last7.filter(m => m.impressions > 0), "frequency"),
    priorFreq7: meanField(prior7.filter(m => m.impressions > 0), "frequency"),
    dailySpendNow: totalSpend / days,
  };
}

function buildLede(ads: AdWithFatigue[], glance: AtAGlance): string {
  if (ads.length === 0) return "No active ads to brief on this week.";

  const fatigued = ads.filter((a) => a.fatigue.fatigueScore >= 50);
  const winners = ads.filter((a) => a.fatigue.fatigueScore < 25 && a.recentCtr7 >= glance.ctr7 * 1.2);
  const totalSpendAtRisk = fatigued.reduce((s, a) => s + a.recentSpend7, 0);

  const ctrLine = glance.ctr7WoWPct !== null
    ? glance.ctr7WoWPct < -8 ? `Click-through fell ${Math.abs(glance.ctr7WoWPct).toFixed(0)}% versus last week`
      : glance.ctr7WoWPct > 8 ? `Click-through climbed ${glance.ctr7WoWPct.toFixed(0)}% versus last week`
      : `Click-through held roughly flat versus last week`
    : "Click-through stayed roughly flat";

  const driverLine = fatigued.length > 0
    ? `, driven mostly by ${fatigued.length} ad${fatigued.length === 1 ? "" : "s"} actively fatiguing — about ${fmt$(totalSpendAtRisk)} of last week's spend went to creative the audience has stopped responding to.`
    : `. Nothing in the account is meaningfully fatigued, so the fix is not damage control — it's pressure.`;

  const winnersLine = winners.length > 0
    ? ` ${winners.length} ad${winners.length === 1 ? "" : "s"} ${winners.length === 1 ? "is" : "are"} currently outperforming the rest of the account by 20%+ on CTR; budget should bias toward ${winners.length === 1 ? "it" : "them"} this week.`
    : ``;

  return `${ctrLine}${driverLine}${winnersLine}`;
}

function buildMoves(ads: AdWithFatigue[], portfolioCtr: number): Move[] {
  const moves: Move[] = [];

  // Sort fatigued ads by daily spend descending — biggest bleed first.
  const fatigued = ads
    .filter((a) => a.fatigue.fatigueScore >= 50)
    .sort((a, b) => b.dailySpendNow - a.dailySpendNow);

  if (fatigued.length > 0) {
    const top = fatigued[0];
    const monthly = top.dailySpendNow * 30;
    moves.push({
      id: "stop_bleed",
      rank: 1,
      category: "stop_bleed",
      title: `Pause "${top.ad.adName}"`,
      paragraph: `This ad is scoring ${top.fatigue.fatigueScore.toFixed(0)} on the fatigue model with frequency at ${top.recentFreq7.toFixed(1)}× and CTR at ${top.recentCtr7.toFixed(2)}%, well below your ${portfolioCtr.toFixed(2)}% portfolio average. It's spending roughly ${fmt$(top.dailySpendNow)}/day — about ${fmt$(monthly)} a month if left alone — and that money is going to clicks the audience is no longer giving you. Pause it, then redirect the budget to whichever ad in the same adset still has CTR above portfolio. Don't just lower the budget — pausing forces Meta to relearn cleanly when you ship the replacement.`,
      dollarImpact: monthly,
      refAdName: top.ad.adName,
      refCampaignName: top.ad.campaignName,
    });
  }

  // Scale winner — find a low-fatigue, high-CTR active ad.
  const winners = ads
    .filter((a) => a.fatigue.fatigueScore < 25 && a.recentCtr7 >= portfolioCtr * 1.2)
    .sort((a, b) => b.recentCtr7 - a.recentCtr7);
  if (winners.length > 0) {
    const w = winners[0];
    const liftPct = portfolioCtr > 0 ? ((w.recentCtr7 - portfolioCtr) / portfolioCtr) * 100 : 0;
    moves.push({
      id: "scale_winner",
      rank: (moves.length + 1) as 1 | 2 | 3,
      category: "scale_winner",
      title: `Push budget into "${w.ad.adName}"`,
      paragraph: `This ad is running ${liftPct.toFixed(0)}% above portfolio CTR (${w.recentCtr7.toFixed(2)}% vs ${portfolioCtr.toFixed(2)}%) and the fatigue model is still well in the green at ${w.fatigue.fatigueScore.toFixed(0)}. Frequency is ${w.recentFreq7.toFixed(1)}×, so there's headroom before the audience saturates. Increase its daily budget by 15–20% — not more, or you'll knock the campaign back into Meta's learning phase. Pair the bump with one new variant queued behind it so you don't get caught flat-footed when fatigue does eventually arrive.`,
      dollarImpact: w.dailySpendNow * 30 * 0.18,
      refAdName: w.ad.adName,
      refCampaignName: w.ad.campaignName,
    });
  }

  // Queue replacement — long-running ad with rising frequency, not yet fully fatigued.
  const aging = ads
    .filter((a) => a.metrics.length >= 21 && a.recentFreq7 > 3 && a.fatigue.fatigueScore >= 25 && a.fatigue.fatigueScore < 50)
    .sort((a, b) => b.dailySpendNow - a.dailySpendNow);
  if (aging.length > 0) {
    const r = aging[0];
    moves.push({
      id: "queue_replacement",
      rank: (moves.length + 1) as 1 | 2 | 3,
      category: "queue_replacement",
      title: `Brief a replacement for "${r.ad.adName}" this week`,
      paragraph: `This ad has been running ${r.metrics.length} days with frequency now at ${r.recentFreq7.toFixed(1)}× — the audience is seeing it more than three times a week, and CTR has slipped to ${r.recentCtr7.toFixed(2)}%. The fatigue model puts it at ${r.fatigue.fatigueScore.toFixed(0)} today, so it's not dead yet, but the slope is wrong. Use this week to brief and produce a fresh variant — keep the offer constant, change the hook and the visual. Have it ready to ship before the score crosses 50, or you'll be replacing this ad reactively (always more expensive than replacing it on schedule).`,
      dollarImpact: r.dailySpendNow * 30 * 0.25,
      refAdName: r.ad.adName,
      refCampaignName: r.ad.campaignName,
    });
  }

  return moves.slice(0, 3) as Move[];
}

function buildDiagnosis(ads: AdWithFatigue[]): Diagnosis {
  // Distinguish the three failure modes:
  //   saturation       = freq rising AND CTR falling (audience over-exposed)
  //   creative_wear    = freq stable AND CTR falling (people aren't moved by the creative)
  //   auction_inflation= CPM rising AND CTR stable  (paying more for same engagement)
  const flagged = ads.filter((a) => a.fatigue.fatigueScore >= 25);
  if (flagged.length === 0) {
    return {
      primaryDriver: "none",
      paragraph: "Nothing meaningful is failing right now — fatigue scores are clean across the active portfolio, so this week's job is to push and test, not to triage.",
    };
  }

  let saturation = 0;
  let wear = 0;
  let inflation = 0;
  for (const a of flagged) {
    const freqUp = a.priorFreq7 > 0 && a.recentFreq7 > a.priorFreq7 * 1.05;
    const ctrDown = a.priorCtr7 > 0 && a.recentCtr7 < a.priorCtr7 * 0.92;
    const cpmUp = a.priorCpm7 > 0 && a.recentCpm7 > a.priorCpm7 * 1.05;
    if (freqUp && ctrDown) saturation++;
    else if (!freqUp && ctrDown) wear++;
    else if (cpmUp && !ctrDown) inflation++;
  }

  const total = saturation + wear + inflation;
  if (total === 0) {
    return {
      primaryDriver: "mixed",
      paragraph: `${flagged.length} ad${flagged.length === 1 ? " is" : "s are"} flagged but the signals don't point cleanly at one root cause. Open the watchlist below and look at frequency vs. CTR per ad before deciding whether to refresh creative, broaden audiences, or ride it out.`,
    };
  }

  const top = Math.max(saturation, wear, inflation);
  const driver: Diagnosis["primaryDriver"] =
    top === saturation ? "saturation" : top === wear ? "creative_wear" : "auction_inflation";

  if (driver === "saturation") {
    return {
      primaryDriver: "saturation",
      paragraph: `The dominant failure pattern this week is audience saturation: frequency is climbing on ${saturation} of the flagged ads while their CTR slips. This is an audience problem, not a creative one — the same audience is seeing the same ad too many times. Open a parallel adset with a Lookalike or a broader interest stack, and let the new audience absorb spend before you spend more on new creative.`,
    };
  }
  if (driver === "creative_wear") {
    return {
      primaryDriver: "creative_wear",
      paragraph: `The dominant failure pattern this week is creative wear-out: frequency is steady but CTR is falling on ${wear} of the flagged ads. The audience is still in front of these ads — they just don't care anymore. Don't broaden audiences yet; brief a fresh hook and visual for the strongest performer in this group and replace the weakest with it.`,
    };
  }
  return {
    primaryDriver: "auction_inflation",
    paragraph: `The dominant failure pattern this week is auction inflation: CPM is up on ${inflation} of the flagged ads but CTR is roughly intact. The creative still works — you're just paying more to get in front of the same people. This is normal in Q4, around major retail moments, or when a competitor launches. Tighten optimization to a deeper conversion event (Lead → Subscribe → Purchase) so Meta only spends on the highest-intent users.`,
  };
}

export async function buildBriefing(
  activeAds: Ad[],
  metricsByAdId: Map<string, DailyMetric[]>,
  settings: ScoringSettings,
): Promise<BriefingResult> {
  const enriched = activeAds.map((ad) => toAdWithFatigue(ad, metricsByAdId.get(ad.id) || [], settings));

  // Glance metrics, weighted across portfolio (last 7 vs prior 7).
  const all7Spend = enriched.reduce((s, a) => s + a.recentSpend7, 0);
  const all7PriorSpend = enriched.reduce((s, a) => s + a.priorSpend7, 0);
  const ctr7 = (() => {
    const allRecent = enriched.flatMap((a) => a.metrics.slice(-7).filter(m => m.impressions > 0));
    const imps = allRecent.reduce((s, m) => s + m.impressions, 0);
    const clicks = allRecent.reduce((s, m) => s + m.clicks, 0);
    return imps > 0 ? (clicks / imps) * 100 : 0;
  })();
  const ctrPrior = (() => {
    const allPrior = enriched.flatMap((a) => a.metrics.slice(-14, -7).filter(m => m.impressions > 0));
    const imps = allPrior.reduce((s, m) => s + m.impressions, 0);
    const clicks = allPrior.reduce((s, m) => s + m.clicks, 0);
    return imps > 0 ? (clicks / imps) * 100 : 0;
  })();
  const cpm7 = (() => {
    const allRecent = enriched.flatMap((a) => a.metrics.slice(-7).filter(m => m.impressions > 0));
    const spend = allRecent.reduce((s, m) => s + m.spend, 0);
    const imps = allRecent.reduce((s, m) => s + m.impressions, 0);
    return imps > 0 ? (spend / imps) * 1000 : 0;
  })();
  const cpmPrior = (() => {
    const allPrior = enriched.flatMap((a) => a.metrics.slice(-14, -7).filter(m => m.impressions > 0));
    const spend = allPrior.reduce((s, m) => s + m.spend, 0);
    const imps = allPrior.reduce((s, m) => s + m.impressions, 0);
    return imps > 0 ? (spend / imps) * 1000 : 0;
  })();
  const freq7 = enriched.length ? meanField(enriched, "recentFreq7") : 0;
  const freqPrior = enriched.length ? meanField(enriched, "priorFreq7") : 0;

  const atAGlance: AtAGlance = {
    spend7: all7Spend,
    spend7WoWPct: pctChange(all7Spend, all7PriorSpend),
    ctr7,
    ctr7WoWPct: pctChange(ctr7, ctrPrior),
    cpm7,
    cpm7WoWPct: pctChange(cpm7, cpmPrior),
    freq7,
    freq7WoWPct: pctChange(freq7, freqPrior),
  };

  const lede = buildLede(enriched, atAGlance);
  const moves = buildMoves(enriched, ctr7);
  const diagnosis = buildDiagnosis(enriched);
  const watchlist = enriched
    .filter((a) => a.fatigue.fatigueScore >= 25)
    .sort((a, b) => b.fatigue.fatigueScore - a.fatigue.fatigueScore);

  return { lede, atAGlance, moves, diagnosis, watchlist };
}
