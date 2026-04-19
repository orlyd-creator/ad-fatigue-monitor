import type { DailyMetric } from "@/lib/db/schema";
import type { FatigueResult, ScoringSettings, SignalResult, TrendDirection } from "./types";
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
 * Find the best-performing 7-day window to use as baseline.
 * Scoring combines CTR (primary) and conversion rate (if available) so we pick
 * the true peak — not a fluke day with one click-happy user.
 */
function findBaselineWindow(
  metrics: DailyMetric[],
  windowSize: number
): DailyMetric[] {
  if (metrics.length <= windowSize) return metrics;
  if (metrics.length < windowSize + 3) return metrics.slice(0, windowSize);

  let best: DailyMetric[] = metrics.slice(0, windowSize);
  let bestScore = -Infinity;

  // Only search windows NOT in the most recent `recentWindowDays` — we want baseline vs recent
  const searchEnd = metrics.length - Math.max(3, Math.floor(windowSize / 2));

  for (let i = 0; i <= searchEnd - windowSize; i++) {
    const window = metrics.slice(i, i + windowSize);
    // Require minimum impressions — skip sparse windows
    const totalImpressions = window.reduce((s, m) => s + m.impressions, 0);
    if (totalImpressions < 100) continue;

    const avgCtr = window.reduce((s, m) => s + m.ctr, 0) / window.length;
    const totalActions = window.reduce((s, m) => s + m.actions, 0);
    const totalClicks = window.reduce((s, m) => s + m.clicks, 0);
    const cvr = totalClicks > 0 ? totalActions / totalClicks : 0;
    // Weight CTR higher because conversions are sparse/noisy on most accounts
    const score = avgCtr * 0.7 + cvr * 30 * 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = window;
    }
  }

  return best;
}

/**
 * Compute a simplified fatigue score for a single rolling window — used for velocity.
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

  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

/**
 * Fatigue velocity — slope of score over the last 7 days of rolling 3-day windows.
 * Positive = getting worse, negative = recovering.
 */
function calculateFatigueVelocity(
  metrics: DailyMetric[],
  settings: ScoringSettings
): number {
  const rollingWindowSize = 3;
  const lookbackDays = 7;

  if (metrics.length < settings.baselineWindowDays + rollingWindowSize + 1) return 0;

  const startOffset = Math.max(0, metrics.length - lookbackDays);
  const windowScores: { day: number; score: number }[] = [];

  for (let i = startOffset; i <= metrics.length - rollingWindowSize; i++) {
    const score = scoreForWindow(metrics, i, rollingWindowSize, settings);
    windowScores.push({ day: i - startOffset, score });
  }

  if (windowScores.length < 2) return 0;

  const n = windowScores.length;
  const sumX = windowScores.reduce((s, p) => s + p.day, 0);
  const sumY = windowScores.reduce((s, p) => s + p.score, 0);
  const sumXY = windowScores.reduce((s, p) => s + p.day * p.score, 0);
  const sumX2 = windowScores.reduce((s, p) => s + p.day * p.day, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

function classifyTrend(velocity: number): TrendDirection {
  if (velocity < -2) return "improving";
  if (Math.abs(velocity) <= 1.5) return "stable";
  if (velocity > 4) return "accelerating";
  return "declining";
}

/**
 * Core fatigue scoring. Combines 6 weighted signals, then applies multiple
 * correlated-signal bonuses (real fatigue shows up in multiple metrics at once).
 */
export function calculateFatigueScore(
  metrics: DailyMetric[],
  settings: ScoringSettings = DEFAULT_SETTINGS
): FatigueResult {
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

  const baseline = findBaselineWindow(metrics, settings.baselineWindowDays);
  const recent = metrics.slice(-settings.recentWindowDays);

  const signalDefs = [
    { calc: calcCtrSignal, weight: settings.ctrWeight },
    { calc: calcCpmSignal, weight: settings.cpmWeight },
    { calc: calcFrequencySignal, weight: settings.frequencyWeight },
    { calc: calcConversionSignal, weight: settings.conversionWeight },
    { calc: calcCostPerResultSignal, weight: settings.costPerResultWeight },
    { calc: calcEngagementSignal, weight: settings.engagementWeight },
  ];

  const results: SignalResult[] = [];
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
    return {
      fatigueScore: 0,
      stage: "healthy",
      signals: [],
      baselineWindow: { start: baseline[0].date, end: baseline[baseline.length - 1].date },
      recentWindow: { start: recent[0].date, end: recent[recent.length - 1].date },
      dataStatus: "sufficient",
      predictedDaysToFatigue: null,
      fatigueVelocity: velocity,
      trendDirection: classifyTrend(velocity),
    };
  }

  // Weighted average (renormalize in case some signals returned null)
  const weightedSum = results.reduce((sum, r) => sum + r.score * (r.weight / totalWeight), 0);

  // --- Correlated-signal bonuses (real fatigue shows in multiple metrics) ---
  let bonus = 0;
  const reasons: string[] = [];
  const getScore = (name: string) => results.find((r) => r.name === name)?.score ?? 0;

  const ctrScore = getScore("ctr_decline");
  const cpmScore = getScore("cpm_rising");
  const freqScore = getScore("frequency");
  const convScore = getScore("conversion_drop");
  const cprScore = getScore("cost_per_result");
  const engScore = getScore("engagement_decay");

  // 1) Classic fatigue pattern: CTR down + frequency up (audience has seen it enough)
  if (freqScore >= 50 && ctrScore >= 50) {
    bonus += 12;
    reasons.push("classic fatigue pattern");
  }

  // 2) Auction pressure: CTR down + CPM up (Meta charges more for worse-performing creative)
  if (ctrScore >= 50 && cpmScore >= 50) {
    bonus += 15;
    reasons.push("auction penalty");
  }

  // 3) Funnel collapse: frequency high + conversion down (users exhausted)
  const currentFreq = recent[recent.length - 1]?.frequency ?? 0;
  if (currentFreq > 3 && convScore >= 40) {
    bonus += 12;
    reasons.push("funnel collapse");
  }

  // 4) Unit economics broken: CPR up + conversion down together
  if (cprScore >= 50 && convScore >= 50) {
    bonus += 10;
    reasons.push("unit economics broken");
  }

  // 5) Multi-signal confirmation: 3+ signals flagging high is a big deal
  const highSignalCount = results.filter((r) => r.score >= 50).length;
  if (highSignalCount >= 4) { bonus += 12; reasons.push(`${highSignalCount} signals high`); }
  else if (highSignalCount >= 3) { bonus += 8; reasons.push(`${highSignalCount} signals high`); }

  // 6) Engagement collapse: both CTR and engagement down → creative losing relevance
  if (ctrScore >= 40 && engScore >= 40) {
    bonus += 8;
    reasons.push("engagement collapsing");
  }

  // 7) Recent acceleration — if last 3 days show a sharp decline trend vs 7-day
  const last3CtrSlope = (() => {
    if (metrics.length < 3) return 0;
    const last3 = metrics.slice(-3).map((m) => m.ctr);
    return last3[2] - last3[0];
  })();
  const baselineCtrMean = baseline.reduce((s, m) => s + m.ctr, 0) / baseline.length;
  if (baselineCtrMean > 0 && last3CtrSlope / baselineCtrMean < -0.25) {
    bonus += 6;
    reasons.push("accelerating CTR drop");
  }

  const fatigueScore = Math.min(100, Math.round(weightedSum + bonus));

  // --- Predictive metrics ---
  const velocity = calculateFatigueVelocity(metrics, settings);
  const trendDirection = classifyTrend(velocity);

  let predictedDaysToFatigue: number | null;
  if (fatigueScore >= 75) {
    predictedDaysToFatigue = 0;
  } else if (velocity > 0.5) {
    predictedDaysToFatigue = Math.min(30, Math.max(1, Math.round((75 - fatigueScore) / velocity)));
  } else {
    predictedDaysToFatigue = null;
  }

  return {
    fatigueScore,
    stage: getStage(fatigueScore),
    signals: results,
    baselineWindow: { start: baseline[0].date, end: baseline[baseline.length - 1].date },
    recentWindow: { start: recent[0].date, end: recent[recent.length - 1].date },
    dataStatus: "sufficient",
    predictedDaysToFatigue,
    fatigueVelocity: Math.round(velocity * 100) / 100,
    trendDirection,
  };
}
