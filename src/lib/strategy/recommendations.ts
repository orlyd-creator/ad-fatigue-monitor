/**
 * Meta ads Strategy Engine
 *
 * Input: raw DB data (ads, dailyMetrics, leadContacts from HubSpot).
 * Output: ranked, numeric, actionable recommendations.
 *
 * Design rules:
 *   - Every recommendation has a NUMBER (spend, CPL, days, %). No vibes.
 *   - Every recommendation has an ACTION (pause / swap / reallocate / scale).
 *   - Every recommendation has a REASON (signal + threshold).
 *   - Each is scored by impact (projected $ or leads), sort desc.
 *
 * Grounded in Meta lead-gen industry benchmarks:
 *   - Healthy frequency: 1.5–3.0 for prospecting, up to 5 for retargeting.
 *   - CTR: ≥ 1.0% is strong for lead-gen; < 0.7% is weak.
 *   - CPM spike > 30% vs account avg usually means auction pressure or fatigue.
 *   - CPL acceptable band: within 1.5× account average (tier-dependent).
 */
import type { FatigueResult } from "@/lib/fatigue/types";

export type RecommendationSeverity = "critical" | "warning" | "opportunity" | "info";
export type RecommendationAction =
  | "pause"          // stop spending immediately
  | "swap_creative"  // new creative needed
  | "scale_up"       // healthy performer, more budget
  | "narrow_audience" // frequency too high, tighten targeting
  | "reallocate"     // shift budget between ads
  | "refresh_soon"   // prep replacement within N days
  | "investigate"    // data is weird, human look needed
  | "monitor";       // no action, keep watching

export interface Recommendation {
  id: string;            // stable key for dedup & React list
  adId?: string;         // if ad-specific
  campaignName?: string; // if campaign-specific
  severity: RecommendationSeverity;
  action: RecommendationAction;
  title: string;         // one-line headline (max ~70 chars)
  body: string;          // 1-2 sentences explaining WHY
  action_copy: string;   // specific instruction, e.g. "Pause by Fri, shift $150 to X"
  impact_usd?: number;   // projected monthly $ saved or gained
  impact_leads?: number; // projected incremental leads/month (positive or negative)
  confidence: "low" | "medium" | "high"; // how sure are we?
  metrics?: Record<string, number | string | null | undefined>; // supporting numbers
}

export interface AdInput {
  id: string;
  adName: string;
  campaignName: string;
  status: string;
  fatigue: FatigueResult;
  // range-scoped totals (typically this month)
  spend: number;
  clicks: number;
  impressions: number;
  reach: number;
  conversions: number;
  ctr: number;
  cpm: number;
  frequency: number;
  cpc: number;
  // lead attribution (optional, supplied when HS data is joined)
  atmLeads?: number;
  sqls?: number;
  closedWonRevenue?: number;
  closedWonDeals?: number;
}

export interface AccountInput {
  ads: AdInput[];
  /** Account average CPL for tier-blind comparison (this month). */
  accountCPL: number | null;
  /** Account average cost per SQL. */
  accountCostPerSQL: number | null;
  /** Total spend in the range. */
  totalSpend: number;
  totalATM: number;
  totalSQLs: number;
}

// ─────────────────────────────────────────────────────────────────
// Thresholds (Meta lead-gen benchmarks). Centralised so we can tune.
// ─────────────────────────────────────────────────────────────────
const T = {
  MIN_SPEND_FOR_SIGNAL: 50,    // below this, data is too noisy for strong recs
  FREQUENCY_HEAVY: 3.0,        // cold prospecting threshold
  FREQUENCY_CRITICAL: 5.0,
  CTR_WEAK: 0.7,               // %, below this means creative isn't landing
  CTR_CRITICAL: 0.4,
  CPL_OVER_AVG: 1.5,           // if ad CPL > 1.5× account CPL, flag
  CPL_BLOWOUT: 2.5,
  ZERO_CONVERSION_SPEND: 100,  // spending $100+ with 0 ATM is a hard pause
  SCALE_UP_CPL_RATIO: 0.7,     // if ad CPL < 0.7× account CPL, scale candidate
  SCALE_UP_MIN_ATM: 3,
  FATIGUE_CRITICAL: 75,
  FATIGUE_WARN: 50,
  DAYS_FATIGUE_ACTIONABLE: 7,
};

// ─────────────────────────────────────────────────────────────────
// Per-ad quality score (0-100). Weights volume × conversion × close.
// Used for the "top ads" panel and for budget reallocation picks.
// ─────────────────────────────────────────────────────────────────
export interface AdQualityScore {
  adId: string;
  adName: string;
  score: number;
  cpl: number | null;
  costPerSQL: number | null;
  leadToSQLRate: number | null;
  roas: number | null;
  dominantSignal: string;
}

export function computeAdQuality(
  ad: AdInput,
  accountCPL: number | null,
): AdQualityScore {
  const cpl = ad.atmLeads && ad.atmLeads > 0 ? ad.spend / ad.atmLeads : null;
  const costPerSQL = ad.sqls && ad.sqls > 0 ? ad.spend / ad.sqls : null;
  const leadToSQLRate =
    ad.atmLeads && ad.atmLeads > 0 && ad.sqls !== undefined
      ? ad.sqls / ad.atmLeads
      : null;
  const roas =
    ad.closedWonRevenue && ad.spend > 0 ? ad.closedWonRevenue / ad.spend : null;

  // Score components, each 0..1, then weighted
  let cplScore = 0.5;
  let dominantSignal = "insufficient data";
  if (cpl !== null && accountCPL && accountCPL > 0) {
    // Lower CPL than avg = higher score. Clamped: 0.25 → 1.5× avg band.
    const ratio = cpl / accountCPL;
    cplScore = Math.max(0, Math.min(1, 1.5 - ratio));
    dominantSignal =
      ratio < 0.7
        ? "cheap CPL"
        : ratio > 1.5
          ? "expensive CPL"
          : "average CPL";
  }

  // SQL conversion rate, 40% is exceptional for lead-gen, 10% is poor
  let conversionScore = 0.5;
  if (leadToSQLRate !== null) {
    conversionScore = Math.max(0, Math.min(1, leadToSQLRate / 0.4));
    if (leadToSQLRate > 0.35) dominantSignal = "high SQL rate";
  }

  // Volume bonus, an ad with 15+ ATMs beats one with 2, even at same CPL
  const volumeScore =
    ad.atmLeads && ad.atmLeads > 0 ? Math.min(1, Math.log2(ad.atmLeads + 1) / 5) : 0;

  // ROAS bonus (0 if no revenue data)
  const roasScore = roas !== null ? Math.min(1, roas / 3) : 0;

  // Fatigue penalty, a "great CPL but burning out" ad isn't a scale candidate
  const fatiguePenalty = Math.max(0, 1 - ad.fatigue.fatigueScore / 100);

  // Weighted: CPL 35 · conversion 25 · volume 15 · ROAS 15 · fatigueHealth 10
  const raw =
    cplScore * 0.35 +
    conversionScore * 0.25 +
    volumeScore * 0.15 +
    roasScore * 0.15 +
    fatiguePenalty * 0.10;

  return {
    adId: ad.id,
    adName: ad.adName,
    score: Math.round(raw * 100),
    cpl: cpl !== null ? Math.round(cpl * 100) / 100 : null,
    costPerSQL: costPerSQL !== null ? Math.round(costPerSQL * 100) / 100 : null,
    leadToSQLRate:
      leadToSQLRate !== null ? Math.round(leadToSQLRate * 10000) / 100 : null,
    roas: roas !== null ? Math.round(roas * 100) / 100 : null,
    dominantSignal,
  };
}

// ─────────────────────────────────────────────────────────────────
// Recommendation generator
// ─────────────────────────────────────────────────────────────────
export function generateRecommendations(
  account: AccountInput,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const activeAds = account.ads.filter(
    (a) => a.status === "ACTIVE" && !a.id.startsWith("__unattributed_"),
  );

  // ── Per-ad checks ──
  for (const ad of activeAds) {
    const cpl = ad.atmLeads && ad.atmLeads > 0 ? ad.spend / ad.atmLeads : null;

    // 1. Zero-conversion blowout, highest severity
    if (
      ad.spend >= T.ZERO_CONVERSION_SPEND &&
      (ad.atmLeads === undefined || ad.atmLeads === 0)
    ) {
      recs.push({
        id: `pause-zero-${ad.id}`,
        adId: ad.id,
        campaignName: ad.campaignName,
        severity: "critical",
        action: "pause",
        title: `Pause "${truncate(ad.adName, 38)}", $${ad.spend.toFixed(0)} spent, 0 demos`,
        body: `This ad burned through $${ad.spend.toFixed(0)} in the range without generating a single ATM lead. Every additional dollar is waste.`,
        action_copy: `Pause today. Save ~$${Math.round(dailyRun(ad.spend) * 30)} / month.`,
        impact_usd: Math.round(dailyRun(ad.spend) * 30),
        confidence: "high",
        metrics: { spend: ad.spend, atm: ad.atmLeads ?? 0, ctr: ad.ctr, frequency: ad.frequency },
      });
      continue; // if we're pausing, no need for softer recs on this ad
    }

    // 2. CPL blowout, spending 2.5× avg
    if (
      cpl !== null &&
      account.accountCPL &&
      cpl > account.accountCPL * T.CPL_BLOWOUT &&
      ad.spend >= T.MIN_SPEND_FOR_SIGNAL
    ) {
      recs.push({
        id: `blowout-${ad.id}`,
        adId: ad.id,
        campaignName: ad.campaignName,
        severity: "critical",
        action: "pause",
        title: `"${truncate(ad.adName, 34)}" CPL $${cpl.toFixed(0)} (avg $${account.accountCPL.toFixed(0)})`,
        body: `CPL is ${(cpl / account.accountCPL).toFixed(1)}× the account average. At this rate, every 10 leads you could have gotten elsewhere is costing you ${(cpl * 10 - account.accountCPL * 10).toFixed(0)}$ extra.`,
        action_copy: `Pause or cap daily spend at $${Math.min(25, Math.round(ad.spend / 10))}. Move budget to a cheaper performer.`,
        impact_usd: Math.round(dailyRun(ad.spend) * 30 * 0.6),
        confidence: "high",
        metrics: { cpl, avgCPL: account.accountCPL, atm: ad.atmLeads },
      });
      continue;
    }

    // 3. Fatigue, critical stage
    if (
      ad.fatigue.fatigueScore >= T.FATIGUE_CRITICAL &&
      ad.fatigue.dataStatus === "sufficient"
    ) {
      recs.push({
        id: `fatigue-crit-${ad.id}`,
        adId: ad.id,
        campaignName: ad.campaignName,
        severity: "critical",
        action: "swap_creative",
        title: `Replace "${truncate(ad.adName, 32)}", fatigue ${ad.fatigue.fatigueScore}/100`,
        body: `Multiple signals show this creative has worn out its audience. ${ad.fatigue.signals.slice(0, 2).map(s => s.label).join(" and ")} are the biggest drags.`,
        action_copy: `Swap the creative by ${dateInDays(2)}. Target new hook, same offer.`,
        impact_leads: ad.atmLeads ? Math.round(ad.atmLeads * 0.3) : undefined,
        confidence: "high",
        metrics: { fatigueScore: ad.fatigue.fatigueScore, atm: ad.atmLeads, cpl },
      });
      continue;
    }

    // 4. Fatigue, prep replacement
    if (
      ad.fatigue.fatigueScore >= T.FATIGUE_WARN &&
      ad.fatigue.predictedDaysToFatigue !== null &&
      ad.fatigue.predictedDaysToFatigue <= T.DAYS_FATIGUE_ACTIONABLE
    ) {
      recs.push({
        id: `fatigue-warn-${ad.id}`,
        adId: ad.id,
        campaignName: ad.campaignName,
        severity: "warning",
        action: "refresh_soon",
        title: `Prep replacement for "${truncate(ad.adName, 30)}", ${ad.fatigue.predictedDaysToFatigue}d to fatigue`,
        body: `Trajectory projects full fatigue in ${ad.fatigue.predictedDaysToFatigue} days. Start sketching a new variant now so you can swap before CPL climbs.`,
        action_copy: `Draft new creative by ${dateInDays(ad.fatigue.predictedDaysToFatigue - 2)}.`,
        confidence: "medium",
        metrics: { fatigueScore: ad.fatigue.fatigueScore, predictedDays: ad.fatigue.predictedDaysToFatigue },
      });
    }

    // 5. Frequency too high, narrow audience
    if (ad.frequency >= T.FREQUENCY_CRITICAL && ad.spend >= T.MIN_SPEND_FOR_SIGNAL) {
      recs.push({
        id: `freq-crit-${ad.id}`,
        adId: ad.id,
        campaignName: ad.campaignName,
        severity: "warning",
        action: "narrow_audience",
        title: `Frequency ${ad.frequency.toFixed(1)}× on "${truncate(ad.adName, 28)}", audience burned`,
        body: `Each person in your audience has seen this ad ${ad.frequency.toFixed(1)} times. Above 5× you typically see CPM spike and CTR crater.`,
        action_copy: `Tighten targeting (remove broad interests) or increase audience size by 2×.`,
        confidence: "medium",
        metrics: { frequency: ad.frequency, cpm: ad.cpm, ctr: ad.ctr },
      });
    }

    // 6. Weak CTR, creative isn't landing
    if (
      ad.ctr > 0 &&
      ad.ctr < T.CTR_CRITICAL &&
      ad.spend >= T.MIN_SPEND_FOR_SIGNAL
    ) {
      recs.push({
        id: `ctr-crit-${ad.id}`,
        adId: ad.id,
        campaignName: ad.campaignName,
        severity: "warning",
        action: "swap_creative",
        title: `"${truncate(ad.adName, 32)}" CTR ${ad.ctr.toFixed(2)}%, creative not hooking`,
        body: `CTR below 0.4% for a lead-gen campaign means the hook isn't landing. Headline, opening line, or visual need a rethink.`,
        action_copy: `Test a new hook. Keep offer same, change the first 3 seconds / first line.`,
        confidence: "medium",
        metrics: { ctr: ad.ctr, spend: ad.spend },
      });
    }

    // 7. Scale-up candidate, cheap CPL, healthy fatigue, decent volume
    if (
      cpl !== null &&
      account.accountCPL &&
      cpl < account.accountCPL * T.SCALE_UP_CPL_RATIO &&
      ad.atmLeads && ad.atmLeads >= T.SCALE_UP_MIN_ATM &&
      ad.fatigue.fatigueScore < T.FATIGUE_WARN
    ) {
      const projIncrementalLeads = Math.round(ad.atmLeads * 0.5);
      recs.push({
        id: `scale-${ad.id}`,
        adId: ad.id,
        campaignName: ad.campaignName,
        severity: "opportunity",
        action: "scale_up",
        title: `Scale "${truncate(ad.adName, 36)}", CPL $${cpl.toFixed(0)} (avg $${account.accountCPL.toFixed(0)})`,
        body: `This ad converts ${((1 - cpl / account.accountCPL) * 100).toFixed(0)}% below account average and fatigue is healthy. Room to push 20–50% more budget before efficiency drops.`,
        action_copy: `Raise daily budget 30% step. Re-evaluate in 7 days.`,
        impact_leads: projIncrementalLeads,
        confidence: "medium",
        metrics: { cpl, avgCPL: account.accountCPL, fatigueScore: ad.fatigue.fatigueScore, atm: ad.atmLeads },
      });
    }
  }

  // ── Account-level reallocation ──
  // Find: worst spend-hog (high spend, bad CPL) + best cheap performer.
  // Recommend shifting budget between them.
  if (account.accountCPL && activeAds.length >= 2) {
    const worstHog = [...activeAds]
      .filter((a) => a.atmLeads !== undefined && a.spend >= T.MIN_SPEND_FOR_SIGNAL)
      .map((a) => ({
        ad: a,
        cpl: a.atmLeads! > 0 ? a.spend / a.atmLeads! : Infinity,
      }))
      .filter((x) => x.cpl > account.accountCPL! * T.CPL_OVER_AVG)
      .sort((a, b) => b.ad.spend - a.ad.spend)[0];

    const bestCheap = [...activeAds]
      .filter(
        (a) =>
          a.atmLeads !== undefined &&
          a.atmLeads >= T.SCALE_UP_MIN_ATM &&
          a.spend >= T.MIN_SPEND_FOR_SIGNAL,
      )
      .map((a) => ({
        ad: a,
        cpl: a.spend / a.atmLeads!,
      }))
      .filter((x) => x.cpl < account.accountCPL! * T.SCALE_UP_CPL_RATIO)
      .sort((a, b) => a.cpl - b.cpl)[0];

    if (worstHog && bestCheap && worstHog.ad.id !== bestCheap.ad.id) {
      const shiftAmount = Math.round(worstHog.ad.spend * 0.5);
      const expectedNewLeads = Math.round(shiftAmount / bestCheap.cpl);
      const lostLeads = Math.round(shiftAmount / worstHog.cpl);
      const netLeadGain = expectedNewLeads - lostLeads;
      if (netLeadGain > 0) {
        recs.push({
          id: `realloc-${worstHog.ad.id}-${bestCheap.ad.id}`,
          severity: "opportunity",
          action: "reallocate",
          title: `Shift $${shiftAmount} from "${truncate(worstHog.ad.adName, 22)}" → "${truncate(bestCheap.ad.adName, 22)}" = +${netLeadGain} demos`,
          body: `"${worstHog.ad.adName}" CPL $${worstHog.cpl.toFixed(0)} vs "${bestCheap.ad.adName}" CPL $${bestCheap.cpl.toFixed(0)}. Same budget, better math.`,
          action_copy: `Lower "${truncate(worstHog.ad.adName, 22)}" daily budget by 50% ($${shiftAmount}/mo). Raise "${truncate(bestCheap.ad.adName, 22)}" by same amount.`,
          impact_leads: netLeadGain,
          impact_usd: 0,
          confidence: "medium",
          metrics: {
            fromCPL: worstHog.cpl,
            toCPL: bestCheap.cpl,
            shiftAmount,
          },
        });
      }
    }
  }

  // ── Rank by severity + impact ──
  const severityRank: Record<RecommendationSeverity, number> = {
    critical: 0, warning: 1, opportunity: 2, info: 3,
  };
  recs.sort((a, b) => {
    const sev = severityRank[a.severity] - severityRank[b.severity];
    if (sev !== 0) return sev;
    const aImpact = (a.impact_usd ?? 0) + (a.impact_leads ?? 0) * (account.accountCPL || 100);
    const bImpact = (b.impact_usd ?? 0) + (b.impact_leads ?? 0) * (account.accountCPL || 100);
    return bImpact - aImpact;
  });
  return recs;
}

// ─────────────────────────────────────────────────────────────────
// Campaign-level recommendations. HubSpot attributes leads to the Meta
// campaign (via hs_analytics_source_data_2), so CPL / ROAS recs are most
// reliable at campaign granularity, ad-level attribution isn't available.
// ─────────────────────────────────────────────────────────────────
export interface CampaignInput {
  campaignName: string;
  spend: number;
  leads: number;              // matched ATM via utm
  revenue: number;            // closed-won revenue attributed to this campaign
  roas: number | null;
  cpl: number | null;
  activeAdCount: number;
  avgFatigue: number;         // average fatigue of active ads
}

export function generateCampaignRecommendations(
  campaigns: CampaignInput[],
  accountCPL: number | null,
  totalSpend: number,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const significant = campaigns.filter((c) => c.spend >= T.MIN_SPEND_FOR_SIGNAL);
  if (significant.length === 0 || !accountCPL) return recs;

  // 1. Zero-lead campaign burning >$200, hard pause
  for (const c of significant) {
    if (c.leads === 0 && c.spend >= 200) {
      recs.push({
        id: `camp-zero-${hashCampaign(c.campaignName)}`,
        campaignName: c.campaignName,
        severity: "critical",
        action: "pause",
        title: `Pause campaign "${truncate(c.campaignName, 36)}", $${c.spend.toFixed(0)} / 0 demos`,
        body: `Zero attributed ATM leads this period despite $${c.spend.toFixed(0)} in spend. Even accounting for utm mismatch, this is a non-performer.`,
        action_copy: `Pause the campaign or isolate a single ad to test. Reallocate spend.`,
        impact_usd: Math.round(c.spend),
        confidence: "medium",
        metrics: { spend: c.spend, leads: c.leads },
      });
      continue;
    }

    // 2. CPL blowout at campaign level
    if (c.cpl !== null && c.cpl > accountCPL * T.CPL_BLOWOUT) {
      recs.push({
        id: `camp-blowout-${hashCampaign(c.campaignName)}`,
        campaignName: c.campaignName,
        severity: "warning",
        action: "investigate",
        title: `"${truncate(c.campaignName, 32)}" CPL $${c.cpl.toFixed(0)} (${(c.cpl / accountCPL).toFixed(1)}× avg)`,
        body: `Campaign CPL is ${(c.cpl / accountCPL).toFixed(1)}× the account average of $${accountCPL.toFixed(0)}. Either audience targeting is off, creative is weak, or the offer doesn't match what this traffic wants.`,
        action_copy: `Audit targeting + creative. Consider cutting budget 50% while you diagnose.`,
        impact_usd: Math.round(c.spend * 0.4),
        confidence: "medium",
        metrics: { cpl: c.cpl, accountCPL, leads: c.leads },
      });
    }

    // 3. Scale-up candidate, cheap CPL, decent volume, healthy fatigue
    if (
      c.cpl !== null &&
      c.cpl < accountCPL * T.SCALE_UP_CPL_RATIO &&
      c.leads >= 5 &&
      c.avgFatigue < T.FATIGUE_WARN
    ) {
      const projGain = Math.round(c.leads * 0.4);
      recs.push({
        id: `camp-scale-${hashCampaign(c.campaignName)}`,
        campaignName: c.campaignName,
        severity: "opportunity",
        action: "scale_up",
        title: `Scale "${truncate(c.campaignName, 36)}", CPL $${c.cpl.toFixed(0)} (avg $${accountCPL.toFixed(0)})`,
        body: `Converting ${((1 - c.cpl / accountCPL) * 100).toFixed(0)}% cheaper than account average, fatigue still healthy (${c.avgFatigue}/100 avg). Room to push more budget.`,
        action_copy: `Raise daily budget 30% step. Hold targeting. Re-evaluate in 7 days.`,
        impact_leads: projGain,
        confidence: "high",
        metrics: { cpl: c.cpl, accountCPL, leads: c.leads, avgFatigue: c.avgFatigue },
      });
    }

    // 4. ROAS under 1×, spending more than earning
    if (c.roas !== null && c.roas < 1 && c.revenue > 0 && c.spend >= 500) {
      recs.push({
        id: `camp-roas-${hashCampaign(c.campaignName)}`,
        campaignName: c.campaignName,
        severity: "warning",
        action: "investigate",
        title: `"${truncate(c.campaignName, 30)}" ROAS ${c.roas.toFixed(2)}×, spending > earning`,
        body: `Closed-won revenue is $${c.revenue.toFixed(0)} on $${c.spend.toFixed(0)} spend. Lead quality or deal-size here isn't covering acquisition cost.`,
        action_copy: `Check deal cohort: are these SMB? If so, either raise pricing for this audience or pivot targeting.`,
        confidence: "medium",
        metrics: { roas: c.roas, revenue: c.revenue, spend: c.spend, leads: c.leads },
      });
    }
  }

  // 5. Budget reallocation between campaigns (best → worst)
  const byCPL = [...significant]
    .filter((c) => c.cpl !== null && c.leads >= 3)
    .sort((a, b) => (a.cpl! - b.cpl!));
  if (byCPL.length >= 2) {
    const best = byCPL[0];
    const worst = byCPL[byCPL.length - 1];
    if (
      worst.cpl! > accountCPL * 1.3 &&
      best.cpl! < accountCPL &&
      worst.spend >= 300
    ) {
      const shift = Math.round(worst.spend * 0.3);
      const expectedNewLeads = Math.round(shift / best.cpl!);
      const lostLeads = Math.round(shift / worst.cpl!);
      const net = expectedNewLeads - lostLeads;
      if (net >= 2) {
        recs.push({
          id: `camp-realloc-${hashCampaign(worst.campaignName)}-${hashCampaign(best.campaignName)}`,
          severity: "opportunity",
          action: "reallocate",
          title: `Shift $${shift} "${truncate(worst.campaignName, 18)}" → "${truncate(best.campaignName, 18)}" = +${net} demos`,
          body: `"${worst.campaignName}" CPL $${worst.cpl!.toFixed(0)} vs "${best.campaignName}" CPL $${best.cpl!.toFixed(0)}. Same $${shift}, ${net} more demos.`,
          action_copy: `Cut "${truncate(worst.campaignName, 22)}" daily 30%, add that amount to "${truncate(best.campaignName, 22)}".`,
          impact_leads: net,
          confidence: "high",
          metrics: { fromCPL: worst.cpl, toCPL: best.cpl, shift },
        });
      }
    }
  }

  // 6. Concentration risk, single campaign > 70% of spend
  const topSpender = [...significant].sort((a, b) => b.spend - a.spend)[0];
  if (topSpender && totalSpend > 0 && topSpender.spend / totalSpend > 0.7) {
    recs.push({
      id: `camp-concentration`,
      severity: "info",
      action: "monitor",
      title: `${Math.round((topSpender.spend / totalSpend) * 100)}% of spend is in one campaign`,
      body: `"${topSpender.campaignName}" accounts for $${topSpender.spend.toFixed(0)} of $${totalSpend.toFixed(0)} total. If it fatigues, you have no fallback.`,
      action_copy: `Build a second always-on campaign with a different hook/audience as insurance.`,
      confidence: "medium",
      metrics: { concentration: topSpender.spend / totalSpend, total: totalSpend },
    });
  }

  return recs;
}

function hashCampaign(name: string): string {
  // short deterministic id for React keys
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function dateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
// Daily run-rate from range spend, assumes range is the current month so far
function dailyRun(totalSpend: number): number {
  const daysSoFar = new Date().getDate();
  return totalSpend / Math.max(1, daysSoFar);
}
