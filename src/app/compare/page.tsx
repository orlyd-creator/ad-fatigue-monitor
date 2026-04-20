import { db } from "@/lib/db";
import { ads, dailyMetrics } from "@/lib/db/schema";
import { inArray, gte } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { redirect } from "next/navigation";
import { format, subDays, startOfMonth } from "date-fns";
import CompareClient from "./CompareClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Ad creative comparison (roadmap #7).
 * Side-by-side winners vs losers on spend efficiency so Orly can see at a
 * glance which creatives to scale and which to cut. Winners = lowest cost
 * per conversion (with minimum spend threshold so we don't celebrate a $10
 * ad with 1 lead). Losers = highest cost per conversion OR significant spend
 * with zero conversions.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const session = await getSessionOrPublic();
  if (!session) redirect("/login");
  const allAccountIds = session.allAccountIds;

  const params = await searchParams;
  const now = new Date();
  const range = params.range || "30d";
  const rangeDays = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 }[range] || 30;
  const rangeFrom =
    params.from || format(subDays(now, rangeDays), "yyyy-MM-dd");
  const rangeTo = params.to || format(now, "yyyy-MM-dd");

  const [allAdsRaw, metricsRaw] = await Promise.all([
    db.select().from(ads).where(inArray(ads.accountId, allAccountIds)).all(),
    db.select().from(dailyMetrics).where(gte(dailyMetrics.date, rangeFrom)).all(),
  ]);
  // Exclude synthetic __unattributed_* reconciliation rows — they are the sync's
  // gap-filler for account-level vs ad-level drift, not real ads, and should
  // never appear in Winners/Losers.
  const allAds = allAdsRaw.filter((a) => !a.id.startsWith("__unattributed_"));
  const realAdIds = new Set(allAds.map((a) => a.id));
  const metrics = metricsRaw.filter((m) => m.date <= rangeTo && realAdIds.has(m.adId));

  // Aggregate per-ad stats
  type AdStat = {
    adId: string;
    adName: string;
    campaignName: string;
    status: string;
    thumbnailUrl: string;
    spend: number;
    conversions: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpm: number;
    costPerConv: number | null;
  };

  const agg = new Map<string, {
    spend: number; conversions: number; impressions: number; clicks: number;
  }>();
  for (const m of metrics) {
    const cur = agg.get(m.adId) ?? {
      spend: 0, conversions: 0, impressions: 0, clicks: 0,
    };
    cur.spend += m.spend ?? 0;
    cur.conversions += m.actions ?? 0;
    cur.impressions += m.impressions ?? 0;
    cur.clicks += m.clicks ?? 0;
    agg.set(m.adId, cur);
  }

  const adStats: AdStat[] = Array.from(agg.entries()).map(([adId, s]) => {
    const ad = allAds.find((a) => a.id === adId);
    return {
      adId,
      adName: ad?.adName || "Unknown",
      campaignName: ad?.campaignName || "(unknown)",
      status: ad?.status || "UNKNOWN",
      thumbnailUrl: ad?.imageUrl || ad?.thumbnailUrl || "",
      spend: Math.round(s.spend * 100) / 100,
      conversions: s.conversions,
      impressions: s.impressions,
      clicks: s.clicks,
      ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
      cpm: s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0,
      costPerConv: s.conversions > 0 ? Math.round((s.spend / s.conversions) * 100) / 100 : null,
    };
  });

  // Winners: at least $50 spend (meaningful sample), conversions > 0, lowest cost per conversion
  const MIN_SPEND_FOR_WINNER = 50;
  const winners = adStats
    .filter((a) => a.conversions > 0 && a.spend >= MIN_SPEND_FOR_WINNER && a.costPerConv !== null)
    .sort((a, b) => (a.costPerConv ?? Infinity) - (b.costPerConv ?? Infinity))
    .slice(0, 5);

  // Losers: ads with significant spend ($50+) and either zero conversions OR
  // highest cost per conversion. Prioritize zero-conversion losers.
  const MIN_SPEND_FOR_LOSER = 50;
  const zeroConvLosers = adStats
    .filter((a) => a.spend >= MIN_SPEND_FOR_LOSER && a.conversions === 0)
    .sort((a, b) => b.spend - a.spend);
  const highCostLosers = adStats
    .filter((a) => a.conversions > 0 && a.spend >= MIN_SPEND_FOR_LOSER && a.costPerConv !== null)
    .sort((a, b) => (b.costPerConv ?? 0) - (a.costPerConv ?? 0))
    .slice(0, 5);
  // Combine: zero-conv first (worst), then high-cost ones that aren't already winners
  const winnerIds = new Set(winners.map((w) => w.adId));
  const losers = [
    ...zeroConvLosers,
    ...highCostLosers.filter((l) => !winnerIds.has(l.adId)),
  ].slice(0, 5);

  // Totals for context
  const totalSpend = adStats.reduce((s, a) => s + a.spend, 0);
  const totalConversions = adStats.reduce((s, a) => s + a.conversions, 0);

  return (
    <div className="min-h-screen">
      <CompareClient
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        range={range}
        winners={winners}
        losers={losers}
        totalSpend={Math.round(totalSpend * 100) / 100}
        totalConversions={totalConversions}
        adCount={adStats.length}
        isPublic={!!session.isPublic}
      />
    </div>
  );
}
