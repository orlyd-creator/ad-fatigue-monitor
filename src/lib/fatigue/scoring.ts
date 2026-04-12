import type { DailyMetric } from "@/lib/db/schema";
import type { FatigueResult, ScoringSettings } from "./types";
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
    };
  }

  // Weighted average (normalize weights for skipped signals)
  const weightedSum = results.reduce(
    (sum, r) => sum + r.score * (r.weight / totalWeight),
    0
  );

  // Interaction bonus: if frequency AND CTR both score > 50, add 10 points
  const freqScore = results.find((r) => r.name === "frequency")?.score ?? 0;
  const ctrScore = results.find((r) => r.name === "ctr_decline")?.score ?? 0;
  const interactionBonus = freqScore > 50 && ctrScore > 50 ? 10 : 0;

  const fatigueScore = Math.min(100, Math.round(weightedSum + interactionBonus));

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
  };
}
