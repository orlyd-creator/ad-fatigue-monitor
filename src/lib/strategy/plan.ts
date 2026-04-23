/**
 * Per-campaign aggregation used by the Forecast & Plan feature.
 *
 * Produces a compact JSON payload Claude can reason over: one row per
 * campaign with spend, CTR, CPM, leads, CPL, fatigue avg, top/bottom ads.
 * All calculation lives server-side so the UI stays thin.
 */
import type { Ad, DailyMetric } from "@/lib/db/schema";

export type CampaignSnapshot = {
  campaignName: string;
  campaignId: string;
  activeAdCount: number;
  totalAdCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctrPct: number;
  cpm: number;
  frequency: number;
  avgFatigueScore: number;
  leads: number;
  cpl: number | null;
  topAd: { adName: string; ctrPct: number; spend: number } | null;
  bottomAd: { adName: string; ctrPct: number; spend: number } | null;
};

// Normaliser used to match Meta campaign names to HubSpot's
// hs_analytics_source_data_2 values, which are lowercased + may have
// stripped punctuation.
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function buildCampaignSnapshots(params: {
  ads: Ad[];
  metrics: DailyMetric[]; // already scoped to the date range
  fatigueByAdId: Map<string, number>;
  leadsByCampaign: Array<{ campaign: string; count: number }>;
}): CampaignSnapshot[] {
  const { ads, metrics, fatigueByAdId, leadsByCampaign } = params;

  // Group ads by campaign
  const adsByCampaign = new Map<string, Ad[]>();
  for (const ad of ads) {
    if (ad.id.startsWith("__unattributed_")) continue;
    const key = ad.campaignId || ad.campaignName || "(unknown)";
    if (!adsByCampaign.has(key)) adsByCampaign.set(key, []);
    adsByCampaign.get(key)!.push(ad);
  }

  // Roll up metrics per ad for the range
  type AdAgg = { spend: number; impressions: number; clicks: number; reach: number };
  const byAd = new Map<string, AdAgg>();
  for (const m of metrics) {
    const a = byAd.get(m.adId) ?? { spend: 0, impressions: 0, clicks: 0, reach: 0 };
    a.spend += m.spend ?? 0;
    a.impressions += m.impressions ?? 0;
    a.clicks += m.clicks ?? 0;
    a.reach += m.reach ?? 0;
    byAd.set(m.adId, a);
  }

  // Match HS leads to Meta campaigns (substring with longest-wins claim)
  const utmNormMap = new Map(leadsByCampaign.map(u => [normalize(u.campaign), u] as const));
  const utmClaimed = new Set<string>();
  const leadsByCampaignName = new Map<string, number>();
  const campaignNames = new Set<string>();
  for (const list of adsByCampaign.values()) {
    for (const ad of list) if (ad.campaignName) campaignNames.add(ad.campaignName);
  }
  for (const name of Array.from(campaignNames).sort((a, b) => b.length - a.length)) {
    const n = normalize(name);
    const exact = utmNormMap.get(n);
    if (exact && !utmClaimed.has(exact.campaign)) {
      leadsByCampaignName.set(name, exact.count);
      utmClaimed.add(exact.campaign);
      continue;
    }
    for (const [utmNorm, u] of utmNormMap) {
      if (utmClaimed.has(u.campaign)) continue;
      if (n.length >= 6 && utmNorm.length >= 6 && (n.includes(utmNorm) || utmNorm.includes(n))) {
        leadsByCampaignName.set(name, u.count);
        utmClaimed.add(u.campaign);
        break;
      }
    }
  }

  const snapshots: CampaignSnapshot[] = [];
  for (const [, list] of adsByCampaign) {
    if (list.length === 0) continue;
    const campaignName = list[0].campaignName || "(unknown)";
    const campaignId = list[0].campaignId || "";
    const activeAdCount = list.filter(a => a.status === "ACTIVE").length;

    let spend = 0, impressions = 0, clicks = 0, reach = 0, fatigueSum = 0, fatigueCount = 0;
    const adPerf: Array<{ adName: string; ctrPct: number; spend: number }> = [];
    for (const ad of list) {
      const agg = byAd.get(ad.id);
      if (agg) {
        spend += agg.spend;
        impressions += agg.impressions;
        clicks += agg.clicks;
        reach += agg.reach;
      }
      const fs = fatigueByAdId.get(ad.id);
      if (fs !== undefined && ad.status === "ACTIVE") {
        fatigueSum += fs;
        fatigueCount++;
      }
      if (agg && agg.impressions > 0 && ad.status === "ACTIVE") {
        adPerf.push({
          adName: ad.adName,
          ctrPct: (agg.clicks / agg.impressions) * 100,
          spend: agg.spend,
        });
      }
    }
    const ctrPct = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const frequency = reach > 0 ? impressions / reach : 0;
    const avgFatigueScore = fatigueCount > 0 ? Math.round(fatigueSum / fatigueCount) : 0;
    const leads = leadsByCampaignName.get(campaignName) ?? 0;
    const cpl = leads > 0 ? spend / leads : null;
    adPerf.sort((a, b) => b.ctrPct - a.ctrPct);
    snapshots.push({
      campaignName,
      campaignId,
      activeAdCount,
      totalAdCount: list.length,
      spend: Math.round(spend * 100) / 100,
      impressions,
      clicks,
      ctrPct: Math.round(ctrPct * 100) / 100,
      cpm: Math.round(cpm * 100) / 100,
      frequency: Math.round(frequency * 100) / 100,
      avgFatigueScore,
      leads,
      cpl: cpl ? Math.round(cpl * 100) / 100 : null,
      topAd: adPerf[0] ?? null,
      bottomAd: adPerf.length > 1 ? adPerf[adPerf.length - 1] : null,
    });
  }

  // Sort by spend descending — most important campaigns first
  snapshots.sort((a, b) => b.spend - a.spend);
  return snapshots;
}

export type PlanRecommendation = {
  campaignName: string;
  currentCpl: number | null;
  targetCpl: number | null;
  headline: string;
  actions: Array<{
    priority: "high" | "medium" | "low";
    type: "pause" | "scale" | "new-adset" | "creative-test" | "optimization-event" | "budget-shift" | "audience" | "other";
    text: string;
  }>;
};
