import type { DailyMetric } from "@/lib/db/schema";
import type { SignalResult } from "./types";

/** Exponential moving average for smoothing — recent-weighted */
function ema(values: number[], alpha = 0.5): number {
  if (values.length === 0) return 0;
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = alpha * values[i] + (1 - alpha) * result;
  }
  return result;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Trimmed baseline that ignores outliers — uses trimmed mean (drop top/bottom 15%) */
function trimmedMean(values: number[], trimPct = 0.15): number {
  if (values.length < 4) return mean(values);
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * trimPct);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  return mean(trimmed);
}

/** Count consecutive declining days from the end of the series (strict) */
function consecutiveDecliningDays(values: number[]): number {
  let count = 0;
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i] < values[i - 1]) count++;
    else break;
  }
  return count;
}

/** Linear regression slope — change per day */
function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = values.reduce((s, _, i) => s + i * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/** Linear interpolation: maps value from 0..threshold to 0..100 (clamped) */
function linearScore(pctChange: number, threshold: number): number {
  if (pctChange <= 0) return 0;
  if (pctChange >= threshold) return 100;
  return (pctChange / threshold) * 100;
}

/** Sigmoid score — smoother than linear, with a steeper kick near the threshold */
function sigmoidScore(pctChange: number, midpoint: number, steepness = 10): number {
  if (pctChange <= 0) return 0;
  const x = (pctChange - midpoint) * steepness;
  return Math.min(100, Math.max(0, (1 / (1 + Math.exp(-x))) * 100));
}

// ---------------------------------------------------------------
// Signal 1: CTR Decline (impressions vs clicks efficiency)
// ---------------------------------------------------------------
export function calcCtrSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  allMetrics: DailyMetric[]
): SignalResult | null {
  // Use trimmed mean for baseline to ignore one-off spikes
  const baselineCtr = trimmedMean(baseline.map((m) => m.ctr));
  const recentCtr = ema(recent.map((m) => m.ctr), 0.6);

  if (baselineCtr < 0.1) return null; // not enough signal to score

  const pctChange = (baselineCtr - recentCtr) / baselineCtr;
  let score = sigmoidScore(pctChange, 0.25, 8); // midpoint at 25% drop

  // Amplifier 1: consecutive declining days
  const ctrValues = allMetrics.slice(-7).map((m) => m.ctr);
  const decliningDays = consecutiveDecliningDays(ctrValues);
  if (decliningDays >= 3) score = Math.min(100, score * 1.25);
  else if (decliningDays >= 2) score = Math.min(100, score * 1.1);

  // Amplifier 2: strong negative slope across last 7 days
  const slope = linearSlope(ctrValues);
  const baselineSlopeRatio = baselineCtr > 0 ? Math.abs(slope) / baselineCtr : 0;
  if (slope < 0 && baselineSlopeRatio > 0.1) {
    score = Math.min(100, score + 10);
  }

  // Variance check: if CTR is unusually volatile, less confident — reduce score slightly
  const recentStd = stddev(recent.map((m) => m.ctr));
  const cv = recentCtr > 0 ? recentStd / recentCtr : 0; // coefficient of variation
  if (cv > 0.5) score = score * 0.9;

  const changeStr = pctChange > 0 ? `-${(pctChange * 100).toFixed(1)}%` : `+${(Math.abs(pctChange) * 100).toFixed(1)}%`;

  return {
    name: "ctr_decline",
    label: "CTR Decline",
    score: Math.round(Math.max(0, Math.min(100, score))),
    weight: 0,
    detail: `CTR ${changeStr} vs baseline (${baselineCtr.toFixed(2)}% → ${recentCtr.toFixed(2)}%)${decliningDays >= 2 ? ` • ${decliningDays}d decline streak` : ""}`,
  };
}

// ---------------------------------------------------------------
// Signal 2: CPM Rising (cost pressure from saturation)
// ---------------------------------------------------------------
export function calcCpmSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  allMetrics: DailyMetric[]
): SignalResult | null {
  const baselineCpm = trimmedMean(baseline.map((m) => m.cpm));
  const recentCpm = ema(recent.map((m) => m.cpm), 0.6);

  if (baselineCpm < 0.5) return null;

  const pctChange = (recentCpm - baselineCpm) / baselineCpm;
  let score = sigmoidScore(pctChange, 0.30, 7); // midpoint at 30% rise

  // Trend amplifier: CPM rising for 3+ consecutive days
  const cpmValues = allMetrics.slice(-7).map((m) => m.cpm);
  const risingDays = consecutiveDecliningDays(cpmValues.map((v) => -v));
  if (risingDays >= 3) score = Math.min(100, score * 1.2);

  const changeStr = pctChange > 0 ? `+${(pctChange * 100).toFixed(1)}%` : `${(pctChange * 100).toFixed(1)}%`;

  return {
    name: "cpm_rising",
    label: "CPM Rising",
    score: Math.round(Math.max(0, Math.min(100, score))),
    weight: 0,
    detail: `CPM ${changeStr} vs baseline ($${baselineCpm.toFixed(2)} → $${recentCpm.toFixed(2)})${risingDays >= 3 ? ` • ${risingDays}d climbing` : ""}`,
  };
}

// ---------------------------------------------------------------
// Signal 3: Frequency Climbing (impressions per unique user)
// ---------------------------------------------------------------
export function calcFrequencySignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  allMetrics: DailyMetric[]
): SignalResult | null {
  const currentFreq = recent[recent.length - 1]?.frequency ?? 0;
  const baselineFreq = trimmedMean(baseline.map((m) => m.frequency));

  // Absolute-threshold score on current frequency
  let absScore: number;
  if (currentFreq <= 1.8) absScore = 0;
  else if (currentFreq >= 5.0) absScore = 100;
  else absScore = ((currentFreq - 1.8) / 3.2) * 100;

  // Relative-change score: how fast has frequency grown vs baseline
  let relScore = 0;
  if (baselineFreq > 0) {
    const freqGrowth = (currentFreq - baselineFreq) / baselineFreq;
    relScore = sigmoidScore(freqGrowth, 0.5, 5);
  }

  // Combine: weight current frequency higher since it's the direct ceiling
  let score = 0.7 * absScore + 0.3 * relScore;

  // Velocity amplifier: how fast is frequency climbing?
  const freqValues = allMetrics.slice(-7).map((m) => m.frequency);
  const freqSlope = linearSlope(freqValues);
  if (freqSlope > 0.1) score = Math.min(100, score * 1.2); // climbing > 0.1/day
  if (freqSlope > 0.2) score = Math.min(100, score + 8);

  return {
    name: "frequency",
    label: "Frequency",
    score: Math.round(Math.max(0, Math.min(100, score))),
    weight: 0,
    detail: `Frequency at ${currentFreq.toFixed(2)}${baselineFreq > 0 ? ` (baseline ${baselineFreq.toFixed(2)})` : ""}${freqSlope > 0.1 ? ` • climbing +${freqSlope.toFixed(2)}/day` : ""}`,
  };
}

// ---------------------------------------------------------------
// Signal 4: Conversion Rate Drop (CTR → action funnel collapse)
// ---------------------------------------------------------------
export function calcConversionSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  _allMetrics: DailyMetric[]
): SignalResult | null {
  const baselineCr = trimmedMean(baseline.map((m) => m.conversionRate));
  const recentCr = ema(recent.map((m) => m.conversionRate), 0.6);

  if (baselineCr < 0.001) return null;

  const pctChange = (baselineCr - recentCr) / baselineCr;
  let score = sigmoidScore(pctChange, 0.25, 6); // conversion drops hit hard

  // Amplifier: zero conversions in recent window but had them in baseline = serious
  const recentActions = recent.reduce((s, m) => s + m.actions, 0);
  const baselineActions = baseline.reduce((s, m) => s + m.actions, 0);
  if (baselineActions > 0 && recentActions === 0) {
    score = Math.min(100, Math.max(score, 75));
  }

  const changeStr = pctChange > 0 ? `-${(pctChange * 100).toFixed(1)}%` : `+${(Math.abs(pctChange) * 100).toFixed(1)}%`;

  return {
    name: "conversion_drop",
    label: "Conversion Rate",
    score: Math.round(Math.max(0, Math.min(100, score))),
    weight: 0,
    detail: `Conv. rate ${changeStr} vs baseline (${(baselineCr * 100).toFixed(2)}% → ${(recentCr * 100).toFixed(2)}%)`,
  };
}

// ---------------------------------------------------------------
// Signal 5: Cost Per Result Increasing (unit economics)
// ---------------------------------------------------------------
export function calcCostPerResultSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  _allMetrics: DailyMetric[]
): SignalResult | null {
  // Robust CPA: sum spend / sum actions over window, ignoring zero-action days
  const baselineCpa = (() => {
    const valid = baseline.filter((m) => m.actions > 0);
    if (valid.length === 0) return 0;
    const totalSpend = valid.reduce((s, m) => s + m.spend, 0);
    const totalActions = valid.reduce((s, m) => s + m.actions, 0);
    return totalActions > 0 ? totalSpend / totalActions : 0;
  })();

  const recentCpa = (() => {
    const valid = recent.filter((m) => m.actions > 0);
    if (valid.length === 0) return 0;
    const totalSpend = valid.reduce((s, m) => s + m.spend, 0);
    const totalActions = valid.reduce((s, m) => s + m.actions, 0);
    return totalActions > 0 ? totalSpend / totalActions : 0;
  })();

  if (baselineCpa < 0.01) return null;

  const pctChange = (recentCpa - baselineCpa) / baselineCpa;
  let score = sigmoidScore(pctChange, 0.35, 6);

  // If recent had zero conversions, boost — spend with zero results is acute waste
  const recentActions = recent.reduce((s, m) => s + m.actions, 0);
  const recentSpend = recent.reduce((s, m) => s + m.spend, 0);
  if (recentActions === 0 && recentSpend > 0) score = Math.max(score, 70);

  const changeStr = pctChange > 0 ? `+${(pctChange * 100).toFixed(1)}%` : `${(pctChange * 100).toFixed(1)}%`;

  return {
    name: "cost_per_result",
    label: "Cost Per Result",
    score: Math.round(Math.max(0, Math.min(100, score))),
    weight: 0,
    detail: `CPA ${changeStr} vs baseline ($${baselineCpa.toFixed(2)} → $${recentCpa.toFixed(2)})`,
  };
}

// ---------------------------------------------------------------
// Signal 6: Engagement Decay (post likes/comments/shares per impression)
// ---------------------------------------------------------------
export function calcEngagementSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  _allMetrics: DailyMetric[]
): SignalResult | null {
  const engRate = (m: DailyMetric) =>
    m.impressions > 0 ? (m.inlinePostEngagement / m.impressions) * 1000 : 0;

  const baselineEngRate = trimmedMean(baseline.map(engRate));
  const recentEngRate = ema(recent.map(engRate), 0.6);

  if (baselineEngRate < 0.01) return null;

  const pctChange = (baselineEngRate - recentEngRate) / baselineEngRate;
  const score = sigmoidScore(pctChange, 0.35, 5);

  const changeStr = pctChange > 0 ? `-${(pctChange * 100).toFixed(1)}%` : `+${(Math.abs(pctChange) * 100).toFixed(1)}%`;

  return {
    name: "engagement_decay",
    label: "Engagement",
    score: Math.round(Math.max(0, Math.min(100, score))),
    weight: 0,
    detail: `Engagement rate ${changeStr} vs baseline (${baselineEngRate.toFixed(1)} → ${recentEngRate.toFixed(1)} per 1k impressions)`,
  };
}
