import { db } from "@/lib/db";
import { ads, dailyMetrics } from "@/lib/db/schema";
import { eq, inArray, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { format, startOfMonth } from "date-fns";
import { getLeadsFunnel } from "@/lib/hubspot/client";
import LeadsClient from "./LeadsClient";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const accountId = (session as any).accountId as string;
  if (!accountId) redirect("/login");
  const allAccountIds: string[] = (session as any).allAccountIds || [accountId];

  const params = await searchParams;
  const now = new Date();
  const rangeFrom = params.from || format(startOfMonth(now), "yyyy-MM-dd");
  const rangeTo = params.to || format(now, "yyyy-MM-dd");

  // Parallel: fetch ads, metrics, and HubSpot data simultaneously
  const [allAds, metricsRaw, hubspotResult] = await Promise.all([
    db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all(),
    db.select().from(dailyMetrics).where(gte(dailyMetrics.date, rangeFrom)).all(),
    getLeadsFunnel(rangeFrom, rangeTo).catch((err) => { console.error("HubSpot fetch failed:", err); return null; }),
  ]);
  const allAdIds = new Set(allAds.map(a => a.id));
  const activeAds = allAds.filter(a => a.status === "ACTIVE");
  const metrics = metricsRaw.filter(m => m.date <= rangeTo && allAdIds.has(m.adId));

  // Aggregate totals
  const totalSpend = metrics.reduce((s, m) => s + (m.spend ?? 0), 0);
  const totalClicks = metrics.reduce((s, m) => s + (m.clicks ?? 0), 0);
  const totalImpressions = metrics.reduce((s, m) => s + (m.impressions ?? 0), 0);
  const totalConversions = metrics.reduce((s, m) => s + (m.actions ?? 0), 0);
  const totalReach = metrics.reduce((s, m) => s + (m.reach ?? 0), 0);

  // Daily breakdown for chart
  const dailyMap = new Map<string, { spend: number; clicks: number; conversions: number; impressions: number }>();
  const startDate = new Date(rangeFrom + "T00:00:00");
  const endDate = new Date(rangeTo + "T00:00:00");
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dailyMap.set(format(d, "yyyy-MM-dd"), { spend: 0, clicks: 0, conversions: 0, impressions: 0 });
  }
  for (const m of metrics) {
    const day = dailyMap.get(m.date);
    if (day) {
      day.spend += m.spend ?? 0;
      day.clicks += m.clicks ?? 0;
      day.conversions += m.actions ?? 0;
      day.impressions += m.impressions ?? 0;
    }
  }
  const dailyData = Array.from(dailyMap.entries()).map(([date, d]) => ({
    date,
    spend: Math.round(d.spend * 100) / 100,
    clicks: d.clicks,
    conversions: d.conversions,
    impressions: d.impressions,
  }));

  // Per-campaign breakdown
  const campaignMap = new Map<string, { spend: number; clicks: number; conversions: number; impressions: number; reach: number }>();
  for (const m of metrics) {
    const ad = allAds.find(a => a.id === m.adId);
    if (!ad) continue;
    const key = ad.campaignName;
    const c = campaignMap.get(key) ?? { spend: 0, clicks: 0, conversions: 0, impressions: 0, reach: 0 };
    c.spend += m.spend ?? 0;
    c.clicks += m.clicks ?? 0;
    c.conversions += m.actions ?? 0;
    c.impressions += m.impressions ?? 0;
    c.reach += m.reach ?? 0;
    campaignMap.set(key, c);
  }
  const campaignBreakdown = Array.from(campaignMap.entries())
    .map(([name, c]) => ({
      campaignName: name,
      spend: Math.round(c.spend * 100) / 100,
      clicks: c.clicks,
      conversions: c.conversions,
      impressions: c.impressions,
      reach: c.reach,
      cpc: c.clicks > 0 ? Math.round((c.spend / c.clicks) * 100) / 100 : 0,
      conversionRate: c.clicks > 0 ? Math.round((c.conversions / c.clicks) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend);

  // Daily spend by campaign (for stacked area chart)
  const dailyCampaignMap = new Map<string, Map<string, { spend: number; clicks: number; reach: number; impressions: number }>>();
  for (const m of metrics) {
    const ad = allAds.find(a => a.id === m.adId);
    if (!ad) continue;
    const campaign = ad.campaignName;
    if (!dailyCampaignMap.has(m.date)) dailyCampaignMap.set(m.date, new Map());
    const dayMap = dailyCampaignMap.get(m.date)!;
    const c = dayMap.get(campaign) ?? { spend: 0, clicks: 0, reach: 0, impressions: 0 };
    c.spend += m.spend ?? 0;
    c.clicks += m.clicks ?? 0;
    c.reach += m.reach ?? 0;
    c.impressions += m.impressions ?? 0;
    dayMap.set(campaign, c);
  }
  const campaignNames = campaignBreakdown.map(c => c.campaignName);
  const dailyByCampaign = Array.from(dailyMap.keys()).map(date => {
    const dayMap = dailyCampaignMap.get(date);
    const row: Record<string, any> = { date };
    for (const name of campaignNames) {
      const d = dayMap?.get(name);
      row[`${name}_spend`] = d ? Math.round(d.spend * 100) / 100 : 0;
      row[`${name}_clicks`] = d ? d.clicks : 0;
      row[`${name}_reach`] = d ? d.reach : 0;
    }
    return row;
  });

  // Process HubSpot data (already fetched in parallel above)
  let hubspotATM: { date: string; atm: number; sqls: number }[] = [];
  let hubspotMQLs: { date: string; mqls: number }[] = [];
  let allLeadContacts: Array<{ id: string; name: string; email: string; company: string; stage: string; date: string; type: string }> = [];
  let totalATM = 0;
  let totalSQLs = 0;
  let totalMQLs = 0;
  if (hubspotResult) {
    hubspotATM = hubspotResult.dailyATM.map(d => ({ date: d.date, atm: d.atm, sqls: d.sqls }));
    hubspotMQLs = hubspotResult.dailyMQLs.map(d => ({ date: d.date, mqls: d.mqls }));
    totalATM = hubspotResult.totalATM;
    totalSQLs = hubspotResult.totalSQLs;
    totalMQLs = hubspotResult.totalMQLs;
    for (const d of hubspotResult.dailyATM) allLeadContacts.push(...d.contacts);
    for (const d of hubspotResult.dailyMQLs) allLeadContacts.push(...d.contacts);
  }

  return (
    <div className="min-h-screen">
      <LeadsClient
        totalSpend={Math.round(totalSpend * 100) / 100}
        totalClicks={totalClicks}
        totalImpressions={totalImpressions}
        totalConversions={totalConversions}
        totalReach={totalReach}
        dailyData={dailyData}
        campaignBreakdown={campaignBreakdown}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        activeAdCount={activeAds.length}
        hubspotATM={hubspotATM.length > 0 ? hubspotATM : undefined}
        hubspotMQLs={hubspotMQLs.length > 0 ? hubspotMQLs : undefined}
        totalATM={totalATM > 0 ? totalATM : undefined}
        totalSQLs={totalSQLs > 0 ? totalSQLs : undefined}
        totalMQLs={totalMQLs > 0 ? totalMQLs : undefined}
        campaignNames={campaignNames}
        dailyByCampaign={dailyByCampaign}
        leadContacts={allLeadContacts.length > 0 ? allLeadContacts : undefined}
      />
    </div>
  );
}
