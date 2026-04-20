/**
 * Forecast engine.
 *
 * Projects CPL, ATM, SQL, and spend forward using:
 *   - Linear regression on the last 30 days of daily values (trend)
 *   - Weekly seasonality factor from the last 90 days (day-of-week)
 *   - Confidence bands from the residual std deviation
 *
 * Not black-box ML. Simple, inspectable math that surfaces a reasonable
 * projection + explicit uncertainty. Meta itself has 6-12h lag so ultra-
 * precise forecasts aren't achievable anyway.
 */

export interface DailyPoint {
  date: string;   // YYYY-MM-DD
  value: number;
}

export interface ForecastPoint {
  date: string;
  predicted: number;
  lower: number;   // 80% confidence band lower
  upper: number;   // 80% confidence band upper
}

export interface ForecastResult {
  horizon: number;            // days forecasted
  points: ForecastPoint[];
  slope: number;              // per-day change
  intercept: number;
  r2: number;                 // goodness of fit (0-1)
  residualStd: number;        // std of residuals, used for bands
  dailyAvg: number;
  weekdaySeasonality: number[]; // length 7, multiplier per day-of-week (Sun..Sat), 1.0 = average
  monthEndProjection: number; // total from today to end of current month
  explanation: string;        // plain-English outlook
}

/**
 * Fits y = slope * x + intercept where x is days since start.
 * Returns slope, intercept, r2, residualStd.
 */
function linReg(ys: number[]): {
  slope: number; intercept: number; r2: number; residualStd: number;
} {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0, residualStd: 0 };
  const xs = ys.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  const residualStd = Math.sqrt(ssRes / Math.max(1, n - 2));
  return { slope, intercept, r2, residualStd };
}

/**
 * Build weekday seasonality multiplier from a history of points.
 * Returns length-7 array (Sun..Sat) with 1.0 = average.
 */
function weekdaySeasonality(points: DailyPoint[]): number[] {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = new Date(p.date + "T12:00:00");
    const dow = d.getDay();
    sums[dow] += p.value;
    counts[dow] += 1;
  }
  const dowAvg = sums.map((s, i) => counts[i] > 0 ? s / counts[i] : 0);
  const overallAvg = dowAvg.reduce((a, b) => a + b, 0) / 7;
  // If the whole window is zero (or near-zero), return flat 1.0 multipliers
  // so the caller still gets a valid array. Avoids NaN propagation.
  if (overallAvg <= 0) return [1, 1, 1, 1, 1, 1, 1];
  return dowAvg.map((v) => v / overallAvg);
}

export function forecastSeries(
  history: DailyPoint[],
  options: { horizonDays?: number; label?: string } = {},
): ForecastResult {
  const horizon = options.horizonDays ?? 30;
  const label = options.label || "value";

  if (history.length === 0) {
    return {
      horizon,
      points: [],
      slope: 0, intercept: 0, r2: 0, residualStd: 0,
      dailyAvg: 0, weekdaySeasonality: [1, 1, 1, 1, 1, 1, 1],
      monthEndProjection: 0,
      explanation: `Not enough ${label} data yet to forecast.`,
    };
  }

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  // Use last 30 points for trend fit
  const trendWindow = sorted.slice(-30);
  const ys = trendWindow.map((p) => p.value);
  const { slope, intercept, r2, residualStd } = linReg(ys);
  const dailyAvg = ys.reduce((a, b) => a + b, 0) / ys.length;

  // Seasonality from last 90 days (more signal)
  const seasonWindow = sorted.slice(-90);
  const seasonality = weekdaySeasonality(seasonWindow);

  // Generate forecast
  const lastDate = new Date(sorted[sorted.length - 1].date + "T12:00:00");
  const startX = ys.length - 1; // x-coord of last known point
  const points: ForecastPoint[] = [];
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(lastDate);
    date.setDate(date.getDate() + i);
    const dow = date.getDay();
    const base = slope * (startX + i) + intercept;
    const adjusted = Math.max(0, base * seasonality[dow]);
    // 80% confidence band: +/- 1.28 sigma of residuals, widens slightly with time
    const sigma = residualStd * (1 + i / 60);
    points.push({
      date: date.toISOString().slice(0, 10),
      predicted: Math.round(adjusted * 100) / 100,
      lower: Math.max(0, Math.round((adjusted - 1.28 * sigma) * 100) / 100),
      upper: Math.round((adjusted + 1.28 * sigma) * 100) / 100,
    });
  }

  // End-of-month projection: sum predicted values from now until end of THIS month.
  const today = new Date();
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  let monthEndProjection = 0;
  for (const p of points) {
    const d = new Date(p.date + "T00:00:00");
    if (d <= monthEnd) monthEndProjection += p.predicted;
  }
  monthEndProjection = Math.round(monthEndProjection * 100) / 100;

  // Plain-English outlook
  const direction = slope > 0.05 ? "rising" : slope < -0.05 ? "falling" : "flat";
  const confidenceLabel = r2 > 0.5 ? "high" : r2 > 0.2 ? "moderate" : "low";
  const explanation =
    `Recent ${label} trend is ${direction} (slope ${slope.toFixed(2)}/day, ${confidenceLabel} fit, R²=${r2.toFixed(2)}).`;

  return {
    horizon,
    points,
    slope, intercept, r2, residualStd,
    dailyAvg: Math.round(dailyAvg * 100) / 100,
    weekdaySeasonality: seasonality,
    monthEndProjection,
    explanation,
  };
}

/**
 * Build a narrated outlook from multiple forecasts.
 * Uses deterministic templating, no LLM required.
 */
export function narrateOutlook(forecasts: {
  spend: ForecastResult;
  atm: ForecastResult;
  sqls: ForecastResult;
  cpl: ForecastResult;
}): string[] {
  const lines: string[] = [];
  const { spend, atm, sqls, cpl } = forecasts;

  if (spend.monthEndProjection > 0 || atm.monthEndProjection > 0) {
    lines.push(
      `Month-end projection: ${atm.monthEndProjection.toFixed(0)} ATM leads and $${spend.monthEndProjection.toLocaleString(undefined, { maximumFractionDigits: 0 })} spend at current pace.`,
    );
  }

  if (cpl.slope > 0.5) {
    lines.push(
      `CPL is trending up ($${cpl.slope.toFixed(2)}/day). If this holds, by end of month CPL will be ~$${cpl.points[cpl.points.length - 1]?.predicted.toFixed(0) || "?"}.`,
    );
  } else if (cpl.slope < -0.5) {
    lines.push(
      `CPL is trending down ($${Math.abs(cpl.slope).toFixed(2)}/day improvement). Keep going.`,
    );
  } else {
    lines.push(`CPL is stable around $${cpl.dailyAvg.toFixed(0)}.`);
  }

  if (sqls.slope < -0.05 && sqls.r2 > 0.2) {
    lines.push(
      `SQL rate is declining. Investigate whether lead quality is dropping or sales cycle is slowing.`,
    );
  }

  if (spend.slope > 20 && atm.slope < 0.1) {
    lines.push(
      `Warning: spend is rising faster than leads. Efficiency is degrading, audit targeting.`,
    );
  }

  return lines;
}
