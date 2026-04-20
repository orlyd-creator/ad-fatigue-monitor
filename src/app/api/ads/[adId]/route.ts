import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, settings, accounts } from "@/lib/db/schema";
import { eq, desc, gte, inArray } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { format, startOfMonth } from "date-fns";
import { getLeadsFunnelLite, getATMLeadsByCampaign, getClosedWonRevenue } from "@/lib/hubspot/client";
import { computeAdQuality, type AdInput } from "@/lib/strategy/recommendations";

/**
 * If the DB row is missing the caption / headline / link (common for Dynamic
 * Creative ads synced before commit d64a70a's extractor upgrade), pull the
 * creative live from Meta. Saves the result back so it's populated on the
 * next request without another Meta call.
 */
async function ensureCopy(adRow: typeof ads.$inferSelect): Promise<typeof adRow> {
  if (adRow.adBody && adRow.adHeadline && adRow.adLinkUrl) return adRow;
  const acct = await db.select().from(accounts).where(eq(accounts.id, adRow.accountId)).get();
  if (!acct?.accessToken) return adRow;
  try {
    const fields = "creative{body,title,link_url,object_story_spec,asset_feed_spec,call_to_action_type}";
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${adRow.id}?fields=${encodeURIComponent(fields)}&access_token=${acct.accessToken}`,
    );
    if (!r.ok) return adRow;
    const data = await r.json();
    const c = data.creative || {};
    const assetBody = c.asset_feed_spec?.bodies?.[0]?.text;
    const assetTitle = c.asset_feed_spec?.titles?.[0]?.text;
    const assetLink = c.asset_feed_spec?.link_urls?.[0]?.website_url
      || c.asset_feed_spec?.link_urls?.[0]?.display_url;
    const adBody = adRow.adBody
      || c.body
      || c.object_story_spec?.link_data?.message
      || c.object_story_spec?.video_data?.message
      || assetBody
      || null;
    const adHeadline = adRow.adHeadline
      || c.title
      || c.object_story_spec?.link_data?.name
      || c.object_story_spec?.video_data?.title
      || assetTitle
      || null;
    const adLinkUrl = adRow.adLinkUrl
      || c.link_url
      || c.object_story_spec?.link_data?.link
      || assetLink
      || null;
    if (adBody || adHeadline || adLinkUrl) {
      await db.update(ads).set({ adBody, adHeadline, adLinkUrl }).where(eq(ads.id, adRow.id));
      return { ...adRow, adBody, adHeadline, adLinkUrl };
    }
  } catch (e) {
    console.error(`[ads/${adRow.id}] live copy fetch failed:`, e);
  }
  return adRow;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ adId: string }> }
) {
  const session = await getSessionOrPublic();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = session.accountId;
  const allAccountIds: string[] = session.allAccountIds;
  if (!accountId) return NextResponse.json({ error: "No account connected" }, { status: 400 });

  const { adId } = await params;

  const adRow = await db.select().from(ads).where(eq(ads.id, adId)).get();
  if (!adRow) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  // Verify this ad belongs to one of the user's accounts
  if (!allAccountIds.includes(adRow.accountId)) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  // Fills in caption/headline/link live from Meta if the DB row is empty
  // (happens for Dynamic Creative ads synced before the extractor upgrade).
  const ad = await ensureCopy(adRow);

  const userSettings = await db.select().from(settings).where(eq(settings.id, 1)).get();
  const scoringSettings: ScoringSettings = userSettings
    ? {
        ctrWeight: userSettings.ctrWeight,
        cpmWeight: userSettings.cpmWeight,
        frequencyWeight: userSettings.frequencyWeight,
        conversionWeight: userSettings.conversionWeight,
        costPerResultWeight: userSettings.costPerResultWeight,
        engagementWeight: userSettings.engagementWeight,
        baselineWindowDays: userSettings.baselineWindowDays,
        recentWindowDays: userSettings.recentWindowDays,
        minDataDays: userSettings.minDataDays,
      }
    : DEFAULT_SETTINGS;

  const metrics = await db
    .select()
    .from(dailyMetrics)
    .where(eq(dailyMetrics.adId, adId))
    .orderBy(dailyMetrics.date)
    .all();

  const fatigue = calculateFatigueScore(metrics, scoringSettings);

  const adAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.adId, adId))
    .orderBy(desc(alerts.createdAt))
    .limit(20)
    .all();

  // ── Per-ad quality + rotation signal ──
  // Pull HS attribution for THIS ad's campaign + all ads in the account so we
  // can compute account CPL + this ad's CPL (attributed via campaign).
  const now = new Date();
  const rangeStart = format(startOfMonth(now), "yyyy-MM-dd");
  const rangeEnd = format(now, "yyyy-MM-dd");
  const [funnel, utmLeads, won, allAcctAdsMetrics, allAcctAds] = await Promise.all([
    getLeadsFunnelLite(rangeStart, rangeEnd).catch(() => null),
    getATMLeadsByCampaign(rangeStart, rangeEnd).catch(() => [] as Array<{ campaign: string; count: number }>),
    getClosedWonRevenue(rangeStart, rangeEnd).catch(() => ({ totalRevenue: 0, wonCount: 0, revenueByUtm: [] as Array<{ campaign: string; revenue: number; deals: number }> })),
    db.select().from(dailyMetrics).where(gte(dailyMetrics.date, rangeStart)).all(),
    db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all(),
  ]);

  // Dedupe (adId, date) rows picking max spend per pair, matching Dashboard /
  // Executive / Strategy. Legacy Turso duplicates can otherwise double-count
  // per-ad CPL on this detail page while Dashboard shows a different number.
  const acctAdIds = new Set(allAcctAds.map(a => a.id));
  const adDetailDedupe = new Map<string, typeof allAcctAdsMetrics[number]>();
  for (const m of allAcctAdsMetrics) {
    if (m.date > rangeEnd) continue;
    if (!acctAdIds.has(m.adId)) continue;
    const key = `${m.adId}:${m.date}`;
    const existing = adDetailDedupe.get(key);
    if (!existing || (m.spend ?? 0) > (existing.spend ?? 0)) adDetailDedupe.set(key, m);
  }
  const dedupedAcctMetrics = Array.from(adDetailDedupe.values());

  // Account CPL = total spend / total ATM for this month
  const accountSpend = dedupedAcctMetrics.reduce((s, m) => s + (m.spend ?? 0), 0);
  const accountCPL = funnel && funnel.totalATM > 0 ? accountSpend / funnel.totalATM : null;

  // This-ad range-scoped totals
  const adRangeMetrics = metrics.filter(m => m.date >= rangeStart && m.date <= rangeEnd);
  const adSpend = adRangeMetrics.reduce((s, m) => s + (m.spend ?? 0), 0);
  const adClicks = adRangeMetrics.reduce((s, m) => s + (m.clicks ?? 0), 0);
  const adImpressions = adRangeMetrics.reduce((s, m) => s + (m.impressions ?? 0), 0);
  const adReach = adRangeMetrics.reduce((s, m) => s + (m.reach ?? 0), 0);
  const adCtr = adRangeMetrics.length ? adRangeMetrics.reduce((s, m) => s + m.ctr, 0) / adRangeMetrics.length : 0;
  const adCpm = adRangeMetrics.length ? adRangeMetrics.reduce((s, m) => s + m.cpm, 0) / adRangeMetrics.length : 0;
  const adFrequency = adRangeMetrics.length ? adRangeMetrics.reduce((s, m) => s + m.frequency, 0) / adRangeMetrics.length : 0;
  const adCpc = adRangeMetrics.length ? adRangeMetrics.reduce((s, m) => s + m.cpc, 0) / adRangeMetrics.length : 0;

  // Best-effort lead + revenue attribution for this ad's campaign.
  // Normalized substring match against hs_analytics_source_data_2 values.
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const campNorm = normalize(ad.campaignName);
  const matchedUtm = utmLeads.find(u => {
    const un = normalize(u.campaign);
    return un === campNorm || un.includes(campNorm) || campNorm.includes(un);
  });
  const matchedRev = won.revenueByUtm.find(u => {
    const un = normalize(u.campaign);
    return un === campNorm || un.includes(campNorm) || campNorm.includes(un);
  });
  const campaignLeads = matchedUtm?.count || 0;
  const campaignRevenue = matchedRev?.revenue || 0;

  // Pro-rate campaign-level leads/revenue to THIS ad by spend share within
  // the campaign. Uses the deduped set so Turso duplicates can't inflate the
  // denominator and starve this ad's share.
  const campaignSpendTotal = dedupedAcctMetrics
    .filter(m => m.date >= rangeStart)
    .filter(m => {
      const a = allAcctAds.find(x => x.id === m.adId);
      return a && a.campaignName === ad.campaignName;
    })
    .reduce((s, m) => s + (m.spend ?? 0), 0);
  const spendShare = campaignSpendTotal > 0 ? adSpend / campaignSpendTotal : 0;
  const adAtmLeads = Math.round(campaignLeads * spendShare);
  const adRevenue = Math.round(campaignRevenue * spendShare * 100) / 100;

  const adInput: AdInput = {
    id: ad.id, adName: ad.adName, campaignName: ad.campaignName, status: ad.status,
    fatigue, spend: adSpend, clicks: adClicks, impressions: adImpressions,
    reach: adReach, conversions: 0,
    ctr: adCtr, cpm: adCpm, frequency: adFrequency, cpc: adCpc,
    atmLeads: adAtmLeads,
    closedWonRevenue: adRevenue,
  };
  const quality = computeAdQuality(adInput, accountCPL);

  return NextResponse.json({
    ad,
    fatigue,
    metrics,
    alerts: adAlerts,
    quality,
    context: {
      accountCPL: accountCPL !== null ? Math.round(accountCPL * 100) / 100 : null,
      adSpendThisMonth: Math.round(adSpend * 100) / 100,
      adCPLThisMonth: adAtmLeads > 0 ? Math.round((adSpend / adAtmLeads) * 100) / 100 : null,
      adLeadsThisMonth: adAtmLeads,
      adRevenueThisMonth: adRevenue,
      adROASThisMonth: adSpend > 0 ? Math.round((adRevenue / adSpend) * 100) / 100 : null,
      attributionNote: "Leads + revenue are pro-rated from campaign totals by this ad's spend share.",
    },
  });
}
