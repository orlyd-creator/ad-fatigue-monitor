import type { DailyMetric } from "@/lib/db/schema";
import type { FatigueResult, ScoringSettings, TrendDirection } from "./types";
import { getStage, DEFAULT_SETTINGS } from "./types";
import {
  calcCtrSignal,
  calcCpmSignal,
  calcFrequencySignal,
  calcConversionSignal,
  calcCostPerResultSignal,
  calcEngagementSignal,
} from "./signals";

/**
 * Find the best-performing 7-day window (highest avg CTR) as the baseline.
 * Falls back to the first N days if not enough data for a sliding window.
 */
function findBaselineWindow(
  metrics: DailyMetric[],
  windowSize: number
): DailyMetric[] {
  if (metrics.length <= windowSize) {
    return metrics;
  }

  // Not enough data for a sliding window comparison
  if (metrics.length < windowSize + 3) {
    return metrics.slice(0, windowSize);
  }

  let bestWindow: DailyMetric[] = metrics.slice(0, windowSize);
  let bestCtr = -1;

  for (let i = 0; i <= metrics.length - windowSize; i++) {
    const window = metrics.slice(i, i + windowSize);
    const avgCtr =
      window.reduce((sum, m) => sum + m.ctr, 0) / window.length;
    if (avgCtr > bestCtr) {
      bestCtr = avgCtr;
      bestWindow = window;
    }
  }

  return bestWindow;
}

/**
 * Compute a fatigue score for a 3-day rolling window starting at `startIdx`.
 * Uses a simplified weighted average of the same signals (without bonuses).
 */
function scoreForWindow(
  metrics: DailyMetric[],
  startIdx: number,
  windowSize: number,
  settings: ScoringSettings
): number {
  const windowMetrics = metrics.slice(startIdx, startIdx + windowSize);
  if (windowMetrics.length < windowSize) return 0;

  const baseline = findBaselineWindow(metrics.slice(0, startIdx + windowSize), settings.baselineWindowDays);

  const signalDefs = [
    { calc: calcCtrSignal, weight: settings.ctrWeight },
    { calc: calcCpmSignal, weight: settings.cpmWeight },
    { calc: calcFrequencySignal, weight: settings.frequencyWeight },
    { calc: calcConversionSignal, weight: settings.conversionWeight },
    { calc: calcCostPerResultSignal, weight: settings.costPerResultWeight },
    { calc: calcEngagementSignal, weight: settings.engagementWeight },
  ];

  let totalWeight = 0;
  let weightedSum = 0;

  for (const { calc, weight } of signalDefs) {
    const result = calc(baseline, windowMetrics, metrics.slice(0, startIdx + windowSize));
    if (result !== null) {
      weightedSum += result.score * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

/**
 * Calculate fatigue velocity by computing scores for rolling 3-day windows
 * over the last 7 days, then finding the slope (score change per day).
 */
function calculateFatigueVelocity(
  metrics: DailyMetric[],
  settings: ScoringSettings
): number {
  const rollingWindowSize = 3;
  const lookbackDays = 7;

  // We need at least baselineWindowDays + rollingWindowSize + a few windows
  if (metrics.length < settings.baselineWindowDays + rollingWindowSize + 1) {
    return 0;
  }

  // Take the last `lookbackDays` metrics (or all if fewer)
  const startOffset = Math.max(0, metrics.length - lookbackDays);
  const windowScores: { day: number; score: number }[] = [];

  for (let i = startOffset; i <= metrics.length - rollingWindowSize; i++) {
    const score = scoreForWindow(metrics, i, rollingWindowSize, settings);
    windowScores.push({ day: i - startOffset, score });
  }

  if (windowScores.length < 2) return 0;

  // Linear regression to find slope (score change per day)
  const n = windowScores.length;
  const sumX = windowScores.reduce((s, p) => s + p.day, 0);
  const sumY = windowScores.reduce((s, p) => s + p.score, 0);
  const sumXY = windowScores.reduce((s, p) => s + p.day * p.score, 0);
  const sumX2 = windowScores.reduce((s, p) => s + p.day * p.day, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  return slope;
}

/**
 * Classify the trend direction based on fatigue velocity.
 */
function classifyTrend(velocity: number): TrendDirection {
  if (velocity < -2) return "improving";
  if (Math.abs(velocity) <= 2) return "stable";
  if (velocity > 5) return "accelerating";
  return "declining";
}

/**
 * Core fatigue scoring algorithm.
 * Takes daily metrics for a single ad (sorted by date ASC) and returns a fatigue result.
 */
export function calculateFatigueScore(
  metrics: DailyMetric[],
  settings: ScoringSettings = DEFAULT_SETTINGS
): FatigueResult {
  // Not enough data
  if (metrics.length === 0) {
    return {
      fatigueScore: 0,
      stage: "healthy",
      signals: [],
      baselineWindow: null,
      recentWindow: null,
      dataStatus: "no_data",
      predictedDaysToFatigue: null,
      fatigueVelocity: 0,
      trendDirection: "stable",
    };
  }

  if (metrics.length < settings.minDataDays) {
    return {
      fatigueScore: 0,
      stage: "healthy",
      signals: [],
      baselineWindow: null,
      recentWindow: null,
      dataStatus: "collecting",
      predictedDaysToFatigue: null,
      fatigueVelocity: 0,
      trendDirection: "stable",
    };
  }

  // Find windows
  const baseline = findBaselineWindow(metrics, settings.baselineWindowDays);
  const recent = metrics.slice(-settings.recentWindowDays);

  // Define signal calculators with their weights
  const signalDefs = [
    { calc: calcCtrSignal, weight: settings.ctrWeight },
    { calc: calcCpmSignal, weight: settings.cpmWeight },
    { calc: calcFrequencySignal, weight: settings.frequencyWeight },
    { calc: calcConversionSignal, weight: settings.conversionWeight },
    { calc: calcCostPerResultSignal, weight: settings.costPerResultWeight },
    { calc: calcEngagementSignal, weight: settings.engagementWeight },
  ];

  // Calculate each signal
  const results = [];
  let totalWeight = 0;

  for (const { calc, weight } of signalDefs) {
    const result = calc(baseline, recent, metrics);
    if (result !== null) {
      result.weight = weight;
      results.push(result);
      totalWeight += weight;
    }
  }

  if (results.length === 0 || totalWeight === 0) {
    const velocity = calculateFatigueVelocity(metrics, settings);
    const trendDirection = classifyTrend(velocity);
    return {
      fatigueScore: 0,
      stage: "healthy",
      signals: [],
      baselineWindow: {
        start: baseline[0].date,
        end: baseline[baseline.length - 1].date,
      },
      recentWindow: {
        start: recent[0].date,
        end: recent[recent.length - 1].date,
      },
      dataStatus: "sufficient",
      predictedDaysToFatigue: null,
      fatigueVelocity: velocity,
      trendDirection,
    };
  }

  // Weighted average (normalize weights for skipped signals)
  const weightedSum = results.reduce(
    (sum, r) => sum + r.score * (r.weight / totalWeight),
    0
  );

  // --- Scoring bonuses ---
  let bonus = 0;

  // Original interaction bonus: if frequency AND CTR both score > 50, add 10 points
  const freqScore = results.find((r) => r.name === "frequency")?.score ?? 0;
  const ctrScore = results.find((r) => r.name === "ctr_decline")?.score ?? 0;
  const cpmScore = results.find((r) => r.name === "cpm_rising")?.score ?? 0;
  const conversionScore = results.find((r) => r.name === "conversion_drop")?.score ?? 0;

  if (freqScore > 50 && ctrScore > 50) {
    bonus += 10;
  }

  // New bonus: CTR declining AND CPM rising simultaneously
  if (ctrScore > 50 && cpmScore > 50) {
    bonus += 15;
  }

  // New bonus: frequency > 3 AND conversion rate dropped > 30%
  const currentFreq = recent[recent.length - 1]?.frequency ?? 0;
  const baselineCr = baseline.reduce((s, m) => s + m.conversionRate, 0) / baseline.length;
  const recentCr = recent.reduce((s, m) => s + m.conversionRate, 0) / recent.length;
  const crDropPct = baselineCr > 0 ? (baselineCr - recentCr) / baselineCr : 0;
  if (currentFreq > 3 && crDropPct > 0.3) {
    bonus += 10;
  }

  // New bonus: 3+ signals score above 50 = multi-signal bonus
  const highSignalCount = results.filter((r) => r.score > 50).length;
  if (highSignalCount >= 3) {
    bonus += 8;
  }

  const fatigueScore = Math.min(100, Math.round(weightedSum + bonus));

  // --- Predictive metrics ---
  const velocity = calculateFatigueVelocity(metrics, settings);
  const trendDirection = classifyTrend(velocity);

  let predictedDaysToFatigue: number | null;
  if (fatigueScore >= 75) {
    predictedDaysToFatigue = 0;
  } else if (velocity > 0) {
    predictedDaysToFatigue = Math.min(30, Math.round((75 - fatigueScore) / velocity));
  } else {
    predictedDaysToFatigue = null;
  }

  return {
    fatigueScore,
    stage: getStage(fatigueScore),
    signals: results,
    baselineWindow: {
      start: baseline[0].date,
      end: baseline[baseline.length - 1].date,
    },
    recentWindow: {
      start: recent[0].date,
      end: recent[recent.length - 1].date,
    },
    dataStatus: "sufficient",
    predictedDaysToFatigue,
    fatigueVelocity: Math.round(velocity * 100) / 100, // round to 2 decimal places
    trendDirection,
  };
}
