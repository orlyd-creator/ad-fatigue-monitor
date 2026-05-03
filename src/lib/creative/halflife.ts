/**
 * Creative half-life: days from an ad's first day of meaningful spend until
 * its CTR has decayed by `decayThreshold` (default 30%) from its peak.
 *
 * If an ad never decays, returns null (still healthy / lifetime undetermined).
 * If it decays before the minimum baseline period, we return null too — too
 * little data to call it.
 */

import type { DailyMetric } from "@/lib/db/schema";

export interface HalfLifeResult {
  adId: string;
  // null = no peak yet, no decay yet, or insufficient data
  halfLifeDays: number | null;
  peakCtr: number;
  peakDate: string | null;
  currentCtr: number;
  totalDaysActive: number;
  decayedBy: number; // 0..1, fraction of CTR lost from peak (>=0)
  status: "decayed" | "decaying" | "stable" | "early";
}

export function computeHalfLife(
  adId: string,
  metrics: DailyMetric[],
  decayThreshold: number = 0.3,
): HalfLifeResult {
  // Sort ascending by date.
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));

  // Throw out days with no impressions — they distort CTR.
  const live = sorted.filter((m) => m.impressions >= 100);

  if (live.length < 5) {
    const cur = sorted.length ? sorted[sorted.length - 1].ctr : 0;
    return {
      adId,
      halfLifeDays: null,
      peakCtr: 0,
      peakDate: null,
      currentCtr: cur,
      totalDaysActive: sorted.length,
      decayedBy: 0,
      status: "early",
    };
  }

  // Smooth daily CTR with a 3-day rolling avg so a single fluky day doesn't
  // become "the peak".
  const smooth: { date: string; ctr: number }[] = [];
  for (let i = 0; i < live.length; i++) {
    const window = live.slice(Math.max(0, i - 1), i + 2);
    const avg = window.reduce((s, m) => s + m.ctr, 0) / window.length;
    smooth.push({ date: live[i].date, ctr: avg });
  }

  // Find peak — but only in the first ~70% of the run, so a creative that
  // happened to spike yesterday doesn't get classified as still-peaking.
  const peakSearchEnd = Math.max(3, Math.ceil(smooth.length * 0.7));
  let peakIdx = 0;
  for (let i = 1; i < peakSearchEnd; i++) {
    if (smooth[i].ctr > smooth[peakIdx].ctr) peakIdx = i;
  }
  const peakCtr = smooth[peakIdx].ctr;
  const peakDate = smooth[peakIdx].date;
  const currentCtr = smooth[smooth.length - 1].ctr;
  const decayedBy = peakCtr > 0 ? Math.max(0, (peakCtr - currentCtr) / peakCtr) : 0;
  const totalDaysActive = sorted.length;

  // Walk forward from peak — find first day where smoothed CTR is at or below
  // (1 - decayThreshold) × peak.
  const target = peakCtr * (1 - decayThreshold);
  let decayIdx: number | null = null;
  for (let i = peakIdx + 1; i < smooth.length; i++) {
    if (smooth[i].ctr <= target) {
      decayIdx = i;
      break;
    }
  }

  if (decayIdx === null) {
    return {
      adId,
      halfLifeDays: null,
      peakCtr,
      peakDate,
      currentCtr,
      totalDaysActive,
      decayedBy,
      status: decayedBy > 0.15 ? "decaying" : "stable",
    };
  }

  // Days between first live day and the decay day.
  const firstDate = new Date(smooth[0].date + "T00:00:00Z");
  const decayDate = new Date(smooth[decayIdx].date + "T00:00:00Z");
  const halfLifeDays = Math.round(
    (decayDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  return {
    adId,
    halfLifeDays,
    peakCtr,
    peakDate,
    currentCtr,
    totalDaysActive,
    decayedBy,
    status: "decayed",
  };
}

export function computeHalfLifeBatch(
  metricsByAdId: Map<string, DailyMetric[]>,
  decayThreshold: number = 0.3,
): Map<string, HalfLifeResult> {
  const out = new Map<string, HalfLifeResult>();
  for (const [adId, metrics] of metricsByAdId) {
    out.set(adId, computeHalfLife(adId, metrics, decayThreshold));
  }
  return out;
}
