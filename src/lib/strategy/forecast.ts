/**
 * Forecast engine, v2 (strategic).
 *
 * The v1 engine was pure linear regression, which looked like noise because
 * it ignored the two numbers that matter most to Orly:
 *   1. Our CURRENT month-to-date CPL (the rate she's actually paying right now)
 *   2. Last month's final CPL (the benchmark)
 *
 * v2 reframes forecasting as a budget calculator + pace analysis:
 *
 *   projected_month_end_leads = MTD_leads + (remaining_budget / current_CPL)
 *
 * plus optional scenarios ("if CPL improves 10%, +N leads").
 *
 * We still compute a regression trend for the daily chart but the MONEY numbers
 * come from the budget calculator, not the regression projection.
 */

export interface DailyPoint {
  date: string;   // YYYY-MM-DD
  value: number;
}

export interface ForecastPoint {
  date: string;
  predicted: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  horizon: number;
  points: ForecastPoint[];
  slope: number;
  intercept: number;
  r2: number;
  residualStd: number;
  dailyAvg: number;
  weekdaySeasonality: number[];
  monthEndProjection: number;
  explanation: string;
}

/**
 * Main strategic forecast object the Forecast page consumes.
 * Structured so the UI can render "what you'll do", "how it compares to
 * last month", and "if you change X, how much does Y move".
 */
export interface StrategicForecast {
  // Where we are RIGHT NOW in the current month
  mtd: {
    spend: number;          // total spend this month so far
    atmLeads: number;       // total ATM leads this month so far
    sqls: number;
    cpl: number | null;     // spend / atmLeads (null if no leads)
    costPerSQL: number | null;
    dayOfMonth: number;     // 1..31
    daysInMonth: number;    // 28..31
    daysRemaining: number;  // daysInMonth - dayOfMonth + 1 (including today)
  };

  // Where we ended last month (the benchmark)
  lastMonth: {
    label: string;          // e.g. "March 2026"
    spend: number;
    atmLeads: number;
    sqls: number;
    cpl: number | null;
    costPerSQL: number | null;
  };

  // Pace: are we tracking ahead or behind last month at this point in time?
  pace: {
    // If current daily run-rates hold, where will we land at month end?
    projectedSpend: number;
    projectedATM: number;
    projectedSQLs: number;
    projectedCPL: number | null;
    // Delta vs last month final numbers (positive = ahead, negative = behind)
    deltaSpendVsLast: number;
    deltaATMVsLast: number;
    deltaSQLVsLast: number;
    deltaCPLVsLast: number | null;
  };

  // The budget calculator is the core strategic tool
  budgetCalc: {
    dailyRunRate: number;           // avg daily spend so far this month (what you ACTUALLY spent per day)
    metaDailyBudget: number | null; // sum of Meta active daily_budget, null if we couldn't fetch
    effectiveDaily: number;         // whichever we used for the projection
    remainingBudget: number;        // effectiveDaily * daysRemaining
    budgetSource: "meta" | "run-rate";
    scenarios: Array<{
      label: string;
      cpl: number;
      newLeads: number;
      totalLeads: number;
      vsLastMonth: number;
    }>;
  };

  // Narrated outlook (short, direct)
  narrative: string[];

  // Daily series for the chart: history + projected continuation
  chart: {
    cplDaily: DailyPoint[];
    spendDaily: DailyPoint[];
    atmDaily: DailyPoint[];
    cplMTD: DailyPoint[];       // running MTD CPL, smoother trend line
    projectedCplPath: ForecastPoint[];  // from today to month end
  };
}

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
      horizon, points: [], slope: 0, intercept: 0, r2: 0, residualStd: 0,
      dailyAvg: 0, weekdaySeasonality: [1, 1, 1, 1, 1, 1, 1],
      monthEndProjection: 0,
      explanation: `Not enough ${label} data yet to forecast.`,
    };
  }
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const trendWindow = sorted.slice(-30);
  const ys = trendWindow.map((p) => p.value);
  const { slope, intercept, r2, residualStd } = linReg(ys);
  const dailyAvg = ys.reduce((a, b) => a + b, 0) / ys.length;
  const seasonWindow = sorted.slice(-90);
  const seasonality = weekdaySeasonality(seasonWindow);
  const lastDate = new Date(sorted[sorted.length - 1].date + "T12:00:00");
  const startX = ys.length - 1;
  const points: ForecastPoint[] = [];
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(lastDate);
    date.setDate(date.getDate() + i);
    const dow = date.getDay();
    const base = slope * (startX + i) + intercept;
    const adjusted = Math.max(0, base * seasonality[dow]);
    const sigma = residualStd * (1 + i / 60);
    points.push({
      date: date.toISOString().slice(0, 10),
      predicted: Math.round(adjusted * 100) / 100,
      lower: Math.max(0, Math.round((adjusted - 1.28 * sigma) * 100) / 100),
      upper: Math.round((adjusted + 1.28 * sigma) * 100) / 100,
    });
  }
  const today = new Date();
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  let monthEndProjection = 0;
  for (const p of points) {
    const d = new Date(p.date + "T12:00:00");
    if (d <= monthEnd) monthEndProjection += p.predicted;
  }
  monthEndProjection = Math.round(monthEndProjection * 100) / 100;
  const direction = slope > 0.05 ? "rising" : slope < -0.05 ? "falling" : "flat";
  const confidenceLabel = r2 > 0.5 ? "high" : r2 > 0.2 ? "moderate" : "low";
  const explanation =
    `Recent ${label} trend is ${direction} (slope ${slope.toFixed(2)}/day, ${confidenceLabel} fit, R²=${r2.toFixed(2)}).`;
  return {
    horizon, points, slope, intercept, r2, residualStd,
    dailyAvg: Math.round(dailyAvg * 100) / 100,
    weekdaySeasonality: seasonality,
    monthEndProjection, explanation,
  };
}

/**
 * Strategic forecast. Expects MTD (this month) + last-month data already
 * computed by the caller, so we can do budget math and pace comparison.
 */
export function buildStrategicForecast(input: {
  now: Date;
  // This-month-to-date
  mtdSpend: number;
  mtdATM: number;
  mtdSQLs: number;
  // Last month totals
  lastMonthLabel: string;
  lastMonthSpend: number;
  lastMonthATM: number;
  lastMonthSQLs: number;
  // Daily history for chart + trend
  dailySpend: DailyPoint[];
  dailyATM: DailyPoint[];
  dailySQLs: DailyPoint[];
  // Meta's live daily budget cap (sum across active campaigns/adsets). Pass
  // null / undefined if unavailable and we'll fall back to run-rate.
  metaDailyBudget?: number | null;
}): StrategicForecast {
  const {
    now,
    mtdSpend, mtdATM, mtdSQLs,
    lastMonthLabel, lastMonthSpend, lastMonthATM, lastMonthSQLs,
    dailySpend, dailyATM, dailySQLs,
  } = input;

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = Math.max(0, daysInMonth - dayOfMonth); // full days after today
  const daysElapsedIncludingToday = dayOfMonth;

  const mtdCPL = mtdATM > 0 ? Math.round((mtdSpend / mtdATM) * 100) / 100 : null;
  const mtdCostPerSQL = mtdSQLs > 0 ? Math.round((mtdSpend / mtdSQLs) * 100) / 100 : null;
  const lastCPL = lastMonthATM > 0 ? Math.round((lastMonthSpend / lastMonthATM) * 100) / 100 : null;
  const lastCostPerSQL = lastMonthSQLs > 0 ? Math.round((lastMonthSpend / lastMonthSQLs) * 100) / 100 : null;

  // Projection logic: pick the BEST estimate of forward daily spend.
  //   Meta daily_budget cap (if known) > MTD run-rate > lastMonth average
  // Then project: EOM spend = MTD + (forward daily × days remaining)
  // This is more accurate than straight-line extrapolation (mtdSpend / progress)
  // because early-month spikes don't inflate the projection.
  const lastMonthDailyAvg = lastMonthSpend / (new Date(now.getFullYear(), now.getMonth(), 0).getDate() || 30);
  const forwardDaily =
    input.metaDailyBudget && input.metaDailyBudget > 0
      ? input.metaDailyBudget
      : (daysElapsedIncludingToday >= 3 ? mtdSpend / daysElapsedIncludingToday : lastMonthDailyAvg);

  const projectedSpend = Math.round((mtdSpend + forwardDaily * daysRemaining) * 100) / 100;
  // Lead pace: use MTD lead rate per $ spent (not per day). If each $100 of
  // spend so far has produced X leads, expect the same efficiency forward.
  const leadsPerDollar = mtdSpend > 0 ? mtdATM / mtdSpend : (lastMonthATM / Math.max(1, lastMonthSpend));
  const sqlsPerDollar = mtdSpend > 0 ? mtdSQLs / mtdSpend : (lastMonthSQLs / Math.max(1, lastMonthSpend));
  const forwardSpend = forwardDaily * daysRemaining;
  const projectedATM = Math.round(mtdATM + leadsPerDollar * forwardSpend);
  const projectedSQLs = Math.round(mtdSQLs + sqlsPerDollar * forwardSpend);
  let projectedCPL = projectedATM > 0 ? Math.round((projectedSpend / projectedATM) * 100) / 100 : null;
  // Sanity ceiling: low-data days (e.g. 1 ATM off $500 spend) previously
  // produced $500 CPL forecasts that had never occurred in this account.
  // Cap the projection at 2x the historical last-month CPL when we have
  // little enough data that the math is noisy. Below 3 ATMs, explicitly
  // return null so the UI shows a "not enough data yet" badge instead.
  const hasEnoughData = mtdATM >= 3;
  if (!hasEnoughData) projectedCPL = null;
  else if (projectedCPL !== null && lastCPL !== null) {
    projectedCPL = Math.min(projectedCPL, Math.round(lastCPL * 2 * 100) / 100);
  }

  const deltaSpendVsLast = Math.round((projectedSpend - lastMonthSpend) * 100) / 100;
  const deltaATMVsLast = projectedATM - lastMonthATM;
  const deltaSQLVsLast = projectedSQLs - lastMonthSQLs;
  const deltaCPLVsLast = projectedCPL !== null && lastCPL !== null
    ? Math.round((projectedCPL - lastCPL) * 100) / 100
    : null;

  // Budget calculator. If the caller passed a real Meta daily_budget total,
  // use that (it's the authoritative cap). Otherwise fall back to the MTD
  // run-rate, which is a reasonable guess when we can't read Meta budgets.
  const dailyRunRate = daysElapsedIncludingToday > 0 ? mtdSpend / daysElapsedIncludingToday : 0;
  const metaDailyBudget = input.metaDailyBudget ?? null;
  // "Effective" daily: use Meta's cap when known, otherwise run-rate.
  // Usually Meta's cap is the hard ceiling and run-rate is lower.
  const effectiveDaily = metaDailyBudget !== null && metaDailyBudget > 0
    ? metaDailyBudget
    : dailyRunRate;
  const remainingBudget = Math.round(effectiveDaily * daysRemaining * 100) / 100;

  const cplForScenarios = mtdCPL ?? lastCPL ?? 0;
  const scenarios = cplForScenarios > 0 ? [
    { label: "If CPL stays the same", cplMultiplier: 1.0 },
    { label: "If CPL improves 10%", cplMultiplier: 0.9 },
    { label: "If CPL improves 20%", cplMultiplier: 0.8 },
    { label: "If CPL worsens 10%", cplMultiplier: 1.1 },
  ].map((s) => {
    const scenarioCPL = Math.round(cplForScenarios * s.cplMultiplier * 100) / 100;
    const newLeads = scenarioCPL > 0 ? Math.floor(remainingBudget / scenarioCPL) : 0;
    const totalLeads = mtdATM + newLeads;
    return {
      label: s.label,
      cpl: scenarioCPL,
      newLeads,
      totalLeads,
      vsLastMonth: totalLeads - lastMonthATM,
    };
  }) : [];

  // Running MTD CPL: for each date, (cumulative_spend_to_date / cumulative_atm_to_date)
  const sortedSpend = [...dailySpend].sort((a, b) => a.date.localeCompare(b.date));
  const sortedATM = [...dailyATM].sort((a, b) => a.date.localeCompare(b.date));
  const spendByDate = new Map(sortedSpend.map((p) => [p.date, p.value]));
  const atmByDate = new Map(sortedATM.map((p) => [p.date, p.value]));
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const dates = Array.from(new Set([...sortedSpend.map(p => p.date), ...sortedATM.map(p => p.date)]))
    .filter((d) => d >= monthStart && d <= now.toISOString().slice(0, 10))
    .sort();
  let cumSpend = 0;
  let cumATM = 0;
  const cplMTD: DailyPoint[] = [];
  for (const d of dates) {
    cumSpend += spendByDate.get(d) || 0;
    cumATM += atmByDate.get(d) || 0;
    cplMTD.push({
      date: d,
      value: cumATM > 0 ? Math.round((cumSpend / cumATM) * 100) / 100 : 0,
    });
  }

  // Projected CPL path forward: constant at current MTD CPL until month end
  const projectedCplPath: ForecastPoint[] = [];
  if (mtdCPL !== null && daysRemaining > 0) {
    const currentCpl = mtdCPL;
    for (let i = 1; i <= daysRemaining; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      projectedCplPath.push({
        date: d.toISOString().slice(0, 10),
        predicted: currentCpl,
        lower: Math.round(currentCpl * 0.85 * 100) / 100,
        upper: Math.round(currentCpl * 1.15 * 100) / 100,
      });
    }
  }

  // Narrative, short and specific
  const narrative: string[] = [];

  // Headline: where we'll land vs last month
  if (mtdCPL !== null && lastCPL !== null) {
    const cplDelta = mtdCPL - lastCPL;
    const cplDeltaPct = lastCPL > 0 ? (cplDelta / lastCPL) * 100 : 0;
    const betterWorse = cplDelta < 0 ? "better than" : cplDelta > 0 ? "worse than" : "matching";
    narrative.push(
      `Current CPL $${mtdCPL.toFixed(0)} is ${betterWorse} ${lastMonthLabel} ($${lastCPL.toFixed(0)}), ${Math.abs(cplDeltaPct).toFixed(0)}% ${cplDelta < 0 ? "down" : "up"}.`,
    );
  } else if (mtdCPL !== null) {
    narrative.push(`Current CPL is $${mtdCPL.toFixed(0)}.`);
  }

  // Explicit EOM CPL prediction
  if (projectedCPL !== null) {
    narrative.push(
      `Projected end-of-month CPL: $${projectedCPL.toFixed(0)} (assumes current rate holds for the remaining ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}).`,
    );
  }

  if (projectedATM > 0 && lastMonthATM > 0) {
    const leadDelta = projectedATM - lastMonthATM;
    const ahead = leadDelta > 0 ? "ahead of" : leadDelta < 0 ? "behind" : "matching";
    narrative.push(
      `At this pace you'll finish the month at ${projectedATM} ATMs, ${ahead} ${lastMonthLabel} (${lastMonthATM}).`,
    );
  }

  if (remainingBudget > 0 && mtdCPL !== null) {
    const expectedNewLeads = Math.floor(remainingBudget / mtdCPL);
    narrative.push(
      `You have $${remainingBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })} of planned spend left this month. At current CPL that buys ~${expectedNewLeads} more demos.`,
    );
  }

  if (mtdCPL !== null && lastCPL !== null && mtdCPL > lastCPL * 1.1) {
    const savingsIfMatched = remainingBudget * (1 - lastCPL / mtdCPL);
    narrative.push(
      `If you can bring CPL back to ${lastMonthLabel}'s level, you'd save ~$${Math.round(savingsIfMatched).toLocaleString()} on the remaining budget or add ~${Math.floor(remainingBudget / lastCPL) - Math.floor(remainingBudget / mtdCPL)} demos for the same spend.`,
    );
  }

  return {
    mtd: {
      spend: Math.round(mtdSpend * 100) / 100,
      atmLeads: mtdATM,
      sqls: mtdSQLs,
      cpl: mtdCPL,
      costPerSQL: mtdCostPerSQL,
      dayOfMonth,
      daysInMonth,
      daysRemaining,
    },
    lastMonth: {
      label: lastMonthLabel,
      spend: Math.round(lastMonthSpend * 100) / 100,
      atmLeads: lastMonthATM,
      sqls: lastMonthSQLs,
      cpl: lastCPL,
      costPerSQL: lastCostPerSQL,
    },
    pace: {
      projectedSpend, projectedATM, projectedSQLs, projectedCPL,
      deltaSpendVsLast, deltaATMVsLast, deltaSQLVsLast, deltaCPLVsLast,
    },
    budgetCalc: {
      dailyRunRate: Math.round(dailyRunRate * 100) / 100,
      metaDailyBudget: metaDailyBudget !== null ? Math.round(metaDailyBudget * 100) / 100 : null,
      effectiveDaily: Math.round(effectiveDaily * 100) / 100,
      remainingBudget,
      budgetSource: metaDailyBudget !== null && metaDailyBudget > 0 ? "meta" : "run-rate",
      scenarios,
    },
    narrative,
    chart: {
      cplDaily: dailyATM
        .map((p) => {
          const spend = spendByDate.get(p.date) || 0;
          return p.value > 0 ? { date: p.date, value: Math.round((spend / p.value) * 100) / 100 } : null;
        })
        .filter((x): x is DailyPoint => x !== null),
      spendDaily: dailySpend,
      atmDaily: dailyATM,
      cplMTD,
      projectedCplPath,
    },
  };
}

// Legacy, still used by deterministic narration elsewhere.
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
    lines.push(`CPL is trending down ($${Math.abs(cpl.slope).toFixed(2)}/day improvement). Keep going.`);
  } else {
    lines.push(`CPL is stable around $${cpl.dailyAvg.toFixed(0)}.`);
  }
  if (sqls.slope < -0.05 && sqls.r2 > 0.2) {
    lines.push(`SQL rate is declining. Investigate whether lead quality is dropping or sales cycle is slowing.`);
  }
  if (spend.slope > 20 && atm.slope < 0.1) {
    lines.push(`Warning: spend is rising faster than leads. Efficiency is degrading, audit targeting.`);
  }
  return lines;
}
