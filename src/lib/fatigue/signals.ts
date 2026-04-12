import type { DailyMetric } from "@/lib/db/schema";
import type { SignalResult } from "./types";

/** Exponential moving average for smoothing */
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

/** Count consecutive declining days from the end of the series */
function consecutiveDecliningDays(values: number[]): number {
  let count = 0;
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i] < values[i - 1]) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/** Linear interpolation: maps value from 0..threshold to 0..100 */
function linearScore(pctChange: number, threshold: number): number {
  if (pctChange <= 0) return 0;
  if (pctChange >= threshold) return 100;
  return (pctChange / threshold) * 100;
}

// --- Signal 1: CTR Decline ---
export function calcCtrSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  allMetrics: DailyMetric[]
): SignalResult | null {
  const baselineCtr = mean(baseline.map((m) => m.ctr));
  const recentCtr = ema(recent.map((m) => m.ctr));

  if (baselineCtr === 0) return null;

  const pctChange = (baselineCtr - recentCtr) / baselineCtr;
  let score = linearScore(pctChange, 0.5); // 50% drop = 100

  // Trend amplifier: 3+ consecutive declining days
  const ctrValues = allMetrics.slice(-7).map((m) => m.ctr);
  if (consecutiveDecliningDays(ctrValues) >= 3) {
    score = Math.min(100, score * 1.2);
  }

  const changeStr = pctChange > 0 ? `-${(pctChange * 100).toFixed(1)}%` : `+${(Math.abs(pctChange) * 100).toFixed(1)}%`;

  return {
    name: "ctr_decline",
    label: "CTR Decline",
    score: Math.round(score),
    weight: 0, // set by caller
    detail: `CTR ${changeStr} vs baseline (${baselineCtr.toFixed(2)}% → ${recentCtr.toFixed(2)}%)`,
  };
}

// --- Signal 2: CPM Rising ---
export function calcCpmSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  allMetrics: DailyMetric[]
): SignalResult | null {
  const baselineCpm = mean(baseline.map((m) => m.cpm));
  const recentCpm = ema(recent.map((m) => m.cpm));

  if (baselineCpm === 0) return null;

  const pctChange = (recentCpm - baselineCpm) / baselineCpm;
  let score = linearScore(pctChange, 0.6); // 60% rise = 100

  const cpmValues = allMetrics.slice(-7).map((m) => m.cpm);
  if (consecutiveDecliningDays(cpmValues.map((v) => -v)) >= 3) {
    // CPM increasing for 3+ days
    score = Math.min(100, score * 1.2);
  }

  const changeStr = pctChange > 0 ? `+${(pctChange * 100).toFixed(1)}%` : `${(pctChange * 100).toFixed(1)}%`;

  return {
    name: "cpm_rising",
    label: "CPM Rising",
    score: Math.round(score),
    weight: 0,
    detail: `CPM ${changeStr} vs baseline ($${baselineCpm.toFixed(2)} → $${recentCpm.toFixed(2)})`,
  };
}

// --- Signal 3: Frequency Climbing ---
export function calcFrequencySignal(
  _baseline: DailyMetric[],
  recent: DailyMetric[],
  _allMetrics: DailyMetric[]
): SignalResult | null {
  const currentFreq = recent[recent.length - 1]?.frequency ?? 0;

  // Score based on absolute frequency thresholds
  let score: number;
  if (currentFreq <= 2.0) {
    score = 0;
  } else if (currentFreq >= 6.0) {
    score = 100;
  } else {
    score = ((currentFreq - 2.0) / 4.0) * 100;
  }

  // Velocity bonus: frequency increased rapidly in recent window
  if (recent.length >= 2) {
    const freqVelocity = recent[recent.length - 1].frequency - recent[0].frequency;
    if (freqVelocity > 0.5) {
      score = Math.min(100, score * 1.15);
    }
  }

  return {
    name: "frequency",
    label: "Frequency",
    score: Math.round(score),
    weight: 0,
    detail: `Frequency at ${currentFreq.toFixed(1)} (threshold: 2.0-6.0)`,
  };
}

// --- Signal 4: Conversion Rate Drop ---
export function calcConversionSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  _allMetrics: DailyMetric[]
): SignalResult | null {
  const baselineCr = mean(baseline.map((m) => m.conversionRate));
  const recentCr = ema(recent.map((m) => m.conversionRate));

  // Skip if no conversions in baseline
  if (baselineCr === 0) return null;

  const pctChange = (baselineCr - recentCr) / baselineCr;
  const score = linearScore(pctChange, 0.4); // 40% drop = 100

  const changeStr = pctChange > 0 ? `-${(pctChange * 100).toFixed(1)}%` : `+${(Math.abs(pctChange) * 100).toFixed(1)}%`;

  return {
    name: "conversion_drop",
    label: "Conversion Rate",
    score: Math.round(score),
    weight: 0,
    detail: `Conv. rate ${changeStr} vs baseline (${(baselineCr * 100).toFixed(2)}% → ${(recentCr * 100).toFixed(2)}%)`,
  };
}

// --- Signal 5: Cost Per Result Increasing ---
export function calcCostPerResultSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  _allMetrics: DailyMetric[]
): SignalResult | null {
  const baselineCpa = mean(baseline.map((m) => m.costPerAction));
  const recentCpa = ema(recent.map((m) => m.costPerAction));

  if (baselineCpa === 0) return null;

  const pctChange = (recentCpa - baselineCpa) / baselineCpa;
  const score = linearScore(pctChange, 0.5); // 50% rise = 100

  const changeStr = pctChange > 0 ? `+${(pctChange * 100).toFixed(1)}%` : `${(pctChange * 100).toFixed(1)}%`;

  return {
    name: "cost_per_result",
    label: "Cost Per Result",
    score: Math.round(score),
    weight: 0,
    detail: `CPA ${changeStr} vs baseline ($${baselineCpa.toFixed(2)} → $${recentCpa.toFixed(2)})`,
  };
}

// --- Signal 6: Engagement Decay ---
export function calcEngagementSignal(
  baseline: DailyMetric[],
  recent: DailyMetric[],
  _allMetrics: DailyMetric[]
): SignalResult | null {
  // Engagement rate = engagements per 1000 impressions
  const baselineEngRate = mean(
    baseline.map((m) => (m.impressions > 0 ? (m.inlinePostEngagement / m.impressions) * 1000 : 0))
  );
  const recentEngRate = ema(
    recent.map((m) => (m.impressions > 0 ? (m.inlinePostEngagement / m.impressions) * 1000 : 0))
  );

  if (baselineEngRate === 0) return null;

  const pctChange = (baselineEngRate - recentEngRate) / baselineEngRate;
  const score = linearScore(pctChange, 0.5); // 50% drop = 100

  const changeStr = pctChange > 0 ? `-${(pctChange * 100).toFixed(1)}%` : `+${(Math.abs(pctChange) * 100).toFixed(1)}%`;

  return {
    name: "engagement_decay",
    label: "Engagement",
    score: Math.round(score),
    weight: 0,
    detail: `Engagement rate ${changeStr} vs baseline`,
  };
}
