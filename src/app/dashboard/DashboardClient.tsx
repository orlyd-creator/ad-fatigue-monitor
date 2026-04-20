"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, startOfMonth } from "date-fns";
import AdCard from "@/components/AdCard";
import SparklineChart from "@/components/SparklineChart";
import DateRangePicker from "@/components/DateRangePicker";
import QuickPresets from "@/components/QuickPresets";
import type { FatigueStage } from "@/lib/fatigue/types";

interface SpendData {
  totalSpendRange: number;
  totalImpressionsRange: number;
  totalClicksRange: number;
  overallCTR: number;
  dailySpend: Array<{ date: string; spend: number }>;
  rangeDays: number;
  // Period comparison
  prevSpend: number;
  prevImpressions: number;
  prevClicks: number;
  prevCTR: number;
  spendChange: number;
  impressionChange: number;
  clickChange: number;
  ctrChange: number;
  // Wasted spend
  wastedSpend: number;
  wastedPct: number;
  fatigueAdCount: number;
  // Top/bottom
  topAdId: string | null;
  topAdName: string | null;
  topAdCTR: number;
  bottomAdId: string | null;
  bottomAdName: string | null;
  bottomAdCTR: number;
}

interface AdData {
  id: string; adName: string; campaignName: string; adsetName?: string; status: string;
  fatigue: { fatigueScore: number; stage: FatigueStage; signals: any[]; dataStatus: string;
    baselineWindow?: { start: string; end: string } | null; recentWindow?: { start: string; end: string } | null;
    predictedDaysToFatigue?: number | null; fatigueVelocity?: number; trendDirection?: string; };
  recentMetrics: Array<{ ctr: number; cpm: number; frequency: number }>; totalDays: number;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  adBody?: string | null;
  adHeadline?: string | null;
  rangeSpend?: number;
  rangeImpressions?: number;
  rangeClicks?: number;
  rangeAvgCTR?: number;
}

const STAGE_META: Record<string, { color: string; bg: string; label: string; desc: string }> = {
  healthy:       { color: "#22c55e", bg: "#f0fdf4", label: "Looking Good",     desc: "No action needed" },
  early_warning: { color: "#f59e0b", bg: "#fffbeb", label: "Watch These",      desc: "Keep an eye on" },
  fatiguing:     { color: "#f97316", bg: "#fff7ed", label: "Needs Attention",   desc: "Act soon" },
  fatigued:      { color: "#ea384c", bg: "#fef2f2", label: "Swap It Out",       desc: "Replace ASAP" },
};


type ViewMode = "grid" | "campaign";

interface CampaignGroup {
  campaignName: string;
  avgScore: number;
  adCount: number;
  adsets: { adsetName: string; ads: AdData[] }[];
}

function buildCampaignGroups(ads: AdData[]): CampaignGroup[] {
  const campaignMap = new Map<string, AdData[]>();
  for (const ad of ads) {
    const key = ad.campaignName || "Uncategorized";
    if (!campaignMap.has(key)) campaignMap.set(key, []);
    campaignMap.get(key)!.push(ad);
  }

  const groups: CampaignGroup[] = [];
  for (const [campaignName, campaignAds] of Array.from(campaignMap.entries())) {
    const avgScore = campaignAds.reduce((sum, a) => sum + a.fatigue.fatigueScore, 0) / campaignAds.length;

    const adsetMap = new Map<string, AdData[]>();
    for (const ad of campaignAds) {
      const key = ad.adsetName || "Default Adset";
      if (!adsetMap.has(key)) adsetMap.set(key, []);
      adsetMap.get(key)!.push(ad);
    }

    const adsets = Array.from(adsetMap.entries()).map(([adsetName, ads]) => ({ adsetName, ads }));
    groups.push({ campaignName, avgScore, adCount: campaignAds.length, adsets });
  }

  groups.sort((a, b) => b.avgScore - a.avgScore);
  return groups;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "#ea384c";
  if (score >= 50) return "#f97316";
  if (score >= 30) return "#f59e0b";
  return "#22c55e";
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CampaignSection({ group, filter }: { group: CampaignGroup; filter: FatigueStage | "all" }) {
  const [expanded, setExpanded] = useState(true);
  const scoreColor = getScoreColor(group.avgScore);

  const visibleCount = filter === "all"
    ? group.adCount
    : group.adsets.reduce((sum, as) => sum + as.ads.filter(a => a.fatigue.stage === filter).length, 0);

  if (visibleCount === 0) return null;

  return (
    <div className="mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 transition-colors lv-card"
      >
        <ChevronIcon expanded={expanded} />
        <div className="flex-1 text-left min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground truncate">{group.campaignName}</h2>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <span className="text-[12px] text-muted-foreground">{visibleCount} ad{visibleCount !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: `${scoreColor}12` }}>
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: scoreColor }} />
            <span className="text-[12px] font-semibold tabular-nums" style={{ color: scoreColor }}>
              {Math.round(group.avgScore)}
            </span>
            <span className="text-[10px] text-muted-foreground">avg</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 ml-4 pl-4 border-l-2 border-gray-100 space-y-4">
          {group.adsets.map((adset) => {
            const filteredAds = filter === "all" ? adset.ads : adset.ads.filter(a => a.fatigue.stage === filter);
            if (filteredAds.length === 0) return null;
            return (
              <div key={adset.adsetName}>
                {group.adsets.length > 1 && (
                  <div className="flex items-center gap-2 mb-2 ml-1">
                    <svg className="w-3.5 h-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6A1.125 1.125 0 012.25 10.875v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
                    </svg>
                    <span className="text-[12px] font-medium text-muted-foreground">{adset.adsetName}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredAds.map((ad) => (
                    <AdCard key={ad.id} id={ad.id} adName={ad.adName} campaignName={ad.campaignName}
                      status={ad.status} fatigue={ad.fatigue} recentMetrics={ad.recentMetrics} thumbnailUrl={ad.thumbnailUrl} imageUrl={ad.imageUrl} adBody={ad.adBody} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function MetricCard({ label, value, change, invertColor }: { label: string; value: string; change: number; invertColor?: boolean }) {
  const isPositive = change > 0;
  // For spend, positive change = bad (spending more). For others, positive = good.
  const isGood = invertColor ? !isPositive : isPositive;
  const changeColor = Math.abs(change) < 1 ? "text-muted" : isGood ? "text-green-600" : "text-red-500";
  const arrow = isPositive ? "↑" : "↓";

  return (
    <div className="glass rounded-xl px-4 py-3">
      <div className="text-[10px] text-muted uppercase tracking-wider font-medium mb-1">{label}</div>
      <div className="text-xl font-bold text-foreground tabular-nums">{value}</div>
      {Math.abs(change) >= 0.1 && (
        <div className={`text-[11px] font-medium mt-1 ${changeColor} tabular-nums`}>
          {arrow} {Math.abs(change).toFixed(1)}% vs prev period
        </div>
      )}
    </div>
  );
}

export default function DashboardClient({ ads, spendData, range, lastSyncedAt }: { ads: AdData[]; spendData: SpendData; range: string; lastSyncedAt?: number }) {
  const router = useRouter();
  const [filter, setFilter] = useState<FatigueStage | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("campaign");
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // statusFiltered = base dataset for all stats (active only by default)
  // searchFiltered = further narrowed for the ad grid only, does NOT affect stats/counts/insights
  const statusFiltered = showActiveOnly ? ads.filter((a) => a.status === "ACTIVE") : ads;
  const searchFiltered = searchQuery.trim()
    ? statusFiltered.filter((a) =>
        a.adName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.campaignName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.adsetName || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : statusFiltered;
  // Stage filter + search for the grid display
  const filtered = filter === "all" ? searchFiltered : searchFiltered.filter((a) => a.fatigue.stage === filter);

  // Counts and stats always use statusFiltered (unaffected by search)
  const counts = {
    healthy: statusFiltered.filter((a) => a.fatigue.stage === "healthy").length,
    early_warning: statusFiltered.filter((a) => a.fatigue.stage === "early_warning").length,
    fatiguing: statusFiltered.filter((a) => a.fatigue.stage === "fatiguing").length,
    fatigued: statusFiltered.filter((a) => a.fatigue.stage === "fatigued").length,
  };
  const urgentCount = counts.fatiguing + counts.fatigued;
  const activeCount = ads.filter((a) => a.status === "ACTIVE").length;
  const totalCount = ads.length;

  const campaignGroups = useMemo(() => buildCampaignGroups(searchFiltered), [searchFiltered]);

  const lastSynced = useMemo(() => {
    if (!lastSyncedAt || lastSyncedAt === 0) return null;
    return new Date(lastSyncedAt).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  }, [lastSyncedAt]);

  const insights = useMemo(() => {
    if (statusFiltered.length === 0) return [];
    const items: Array<{ color: string; text: string; adId?: string; filterToFatigued?: boolean }> = [];

    // 1. Wasted spend, filter dashboard to show all fatigued ads (plural)
    const fatiguedAdsFiltered = statusFiltered.filter(a => a.fatigue.fatigueScore >= 50);
    if (spendData.wastedSpend > 0 && fatiguedAdsFiltered.length > 0) {
      const worstFatigued = fatiguedAdsFiltered.sort((a, b) => b.fatigue.fatigueScore - a.fatigue.fatigueScore)[0];
      items.push({
        color: "#ea384c",
        text: `You're burning $${spendData.wastedSpend.toLocaleString("en-US", {maximumFractionDigits: 0})} on ${spendData.fatigueAdCount} fatigued ad${spendData.fatigueAdCount === 1 ? "" : "s"} (${spendData.wastedPct.toFixed(0)}% of spend). Worst offender: "${worstFatigued.adName}" at score ${worstFatigued.fatigue.fatigueScore}.`,
        filterToFatigued: true,
      });
    }

    // 2. Fastest declining ad, the one losing CTR the quickest
    const decliningAds = statusFiltered.filter(a => {
      if (a.recentMetrics.length < 4) return false;
      const recent = a.recentMetrics.slice(-2);
      const older = a.recentMetrics.slice(0, 2);
      const recentCtr = recent.reduce((s, m) => s + m.ctr, 0) / recent.length;
      const olderCtr = older.reduce((s, m) => s + m.ctr, 0) / older.length;
      return olderCtr > 0 && ((recentCtr - olderCtr) / olderCtr) < -0.15;
    });
    if (decliningAds.length > 0) {
      const worst = decliningAds.sort((a, b) => b.fatigue.fatigueScore - a.fatigue.fatigueScore)[0];
      items.push({
        color: "#f97316",
        text: `"${worst.adName}" CTR is dropping fast (score: ${worst.fatigue.fatigueScore}). Prep a replacement creative with a new hook before it tanks your CPA.`,
        adId: worst.id,
      });
    }

    // 3. Predicted fatigue, ads about to fatigue soon
    const aboutToFatigue = statusFiltered.filter(a =>
      a.fatigue.predictedDaysToFatigue != null && a.fatigue.predictedDaysToFatigue > 0 && a.fatigue.predictedDaysToFatigue <= 5 && a.fatigue.fatigueScore < 75
    ).sort((a, b) => (a.fatigue.predictedDaysToFatigue ?? 99) - (b.fatigue.predictedDaysToFatigue ?? 99));
    if (aboutToFatigue.length > 0) {
      const first = aboutToFatigue[0];
      items.push({
        color: "#f97316",
        text: `"${first.adName}" is predicted to fatigue in ~${first.fatigue.predictedDaysToFatigue}d based on current velocity. Start preparing a replacement now.`,
        adId: first.id,
      });
    }

    // 4. Budget reallocation, link to both ads
    const topAd = statusFiltered.find(a => a.adName === spendData.topAdName);
    const bottomAd = statusFiltered.find(a => a.adName === spendData.bottomAdName);
    if (topAd && bottomAd && spendData.topAdCTR > spendData.bottomAdCTR * 1.5) {
      items.push({
        color: "#22c55e",
        text: `Move budget from "${bottomAd.adName}" (${spendData.bottomAdCTR.toFixed(2)}% CTR) to "${topAd.adName}" (${spendData.topAdCTR.toFixed(2)}% CTR), ${((spendData.topAdCTR / Math.max(spendData.bottomAdCTR, 0.01)) * 100 - 100).toFixed(0)}% more efficient.`,
        adId: topAd.id,
      });
    }

    // 5. High frequency = audience burnout
    const highFreqAds = statusFiltered.filter(a => {
      const lastFreq = a.recentMetrics.length > 0 ? a.recentMetrics[a.recentMetrics.length - 1].frequency : 0;
      return lastFreq > 3;
    }).sort((a, b) => {
      const aF = a.recentMetrics[a.recentMetrics.length - 1]?.frequency ?? 0;
      const bF = b.recentMetrics[b.recentMetrics.length - 1]?.frequency ?? 0;
      return bF - aF;
    });
    if (highFreqAds.length > 0) {
      const worstFreq = highFreqAds[0];
      const freq = worstFreq.recentMetrics[worstFreq.recentMetrics.length - 1]?.frequency ?? 0;
      items.push({
        color: "#f59e0b",
        text: `"${worstFreq.adName}" hit ${freq.toFixed(1)}x frequency, your audience is seeing it too many times. Expand targeting or swap the creative.`,
        adId: worstFreq.id,
      });
    }

    // 6. Accelerating fatigue, ads getting worse fast
    const accelerating = statusFiltered.filter(a => a.fatigue.trendDirection === "accelerating" && a.fatigue.fatigueScore > 30)
      .sort((a, b) => (b.fatigue.fatigueVelocity ?? 0) - (a.fatigue.fatigueVelocity ?? 0));
    if (accelerating.length > 0 && items.length < 6) {
      const worst = accelerating[0];
      items.push({
        color: "#ea384c",
        text: `"${worst.adName}" fatigue is accelerating at +${worst.fatigue.fatigueVelocity?.toFixed(1)}/day. This ad is declining fast, act before it wastes more budget.`,
        adId: worst.id,
      });
    }

    // 7. Account-level CTR trend
    if (spendData.ctrChange < -10) {
      items.push({
        color: "#ea384c",
        text: `Account CTR dropped ${Math.abs(spendData.ctrChange).toFixed(0)}% vs last period. Your ads are losing relevance, time for fresh creative across the board.`,
      });
    } else if (spendData.ctrChange > 10 && items.length < 6) {
      items.push({
        color: "#22c55e",
        text: `Account CTR is up ${spendData.ctrChange.toFixed(0)}% vs last period. Creative is resonating, consider scaling spend while momentum is strong.`,
      });
    }

    // 8. If everything is healthy
    if (items.length === 0) {
      const healthyPct = Math.round((statusFiltered.filter(a => a.fatigue.stage === "healthy").length / Math.max(statusFiltered.length, 1)) * 100);
      items.push({
        color: "#22c55e",
        text: `${healthyPct}% of ads are healthy with no urgent issues. Focus on testing new angles and scaling your top performers.`,
      });
    }

    return items.slice(0, 6);
  }, [statusFiltered, spendData]);

  // Account Health Score: 100 - weighted average fatigue score of active ads
  const healthScore = useMemo(() => {
    const activeAds = ads.filter((a) => a.status === "ACTIVE");
    if (activeAds.length === 0) return null;
    const avgFatigue = activeAds.reduce((sum, a) => sum + a.fatigue.fatigueScore, 0) / activeAds.length;
    return Math.max(0, Math.min(100, Math.round(100 - avgFatigue)));
  }, [ads]);

  const healthMeta = useMemo(() => {
    if (healthScore === null) return null;
    if (healthScore >= 80) return { label: "Excellent", color: "#22c55e", bg: "#f0fdf4", track: "#dcfce7" };
    if (healthScore >= 60) return { label: "Good", color: "#eab308", bg: "#fefce8", track: "#fef9c3" };
    if (healthScore >= 40) return { label: "Needs Work", color: "#f97316", bg: "#fff7ed", track: "#fed7aa" };
    return { label: "Critical", color: "#ea384c", bg: "#fef2f2", track: "#fecaca" };
  }, [healthScore]);

  const searchParamsObj = useSearchParams();
  const [customFrom, setCustomFrom] = useState(() => searchParamsObj.get("from") || format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(() => searchParamsObj.get("to") || format(new Date(), "yyyy-MM-dd"));
  const [dateChanged, setDateChanged] = useState(false);

  // Auto-apply dates after a short debounce when either date changes
  useEffect(() => {
    if (!dateChanged) return;
    if (!customFrom || !customTo) return;
    const timer = setTimeout(() => {
      router.push(`/dashboard?range=custom&from=${customFrom}&to=${customTo}`);
    }, 600);
    return () => clearTimeout(timer);
  }, [customFrom, customTo, dateChanged, router]);

  const handleCustomDateApply = () => {
    if (customFrom && customTo) {
      router.push(`/dashboard?range=custom&from=${customFrom}&to=${customTo}`);
    }
  };


  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Hero + Date Range */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Your Ads</h1>
            <p className="text-[14px] text-muted-foreground mt-1">
              {ads.length > 0
                ? urgentCount > 0
                  ? `${urgentCount} active ad${urgentCount > 1 ? "s" : ""} need${urgentCount === 1 ? "s" : ""} your attention right now`
                  : `${activeCount} active ads, everything is looking healthy`
                : "Hit 'Refresh Data' to pull your ads in"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <QuickPresets />
            <DateRangePicker />
          </div>
        </div>
        {ads.length > 0 && (
          <div className="flex items-center gap-4 mt-3">
            {lastSynced && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                <span className="text-[11px]">Last synced {lastSynced}</span>
              </div>
            )}
            {/* Active / All toggle */}
            <button
              onClick={() => setShowActiveOnly(!showActiveOnly)}
              className={`cursor-pointer text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                showActiveOnly
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-gray-50 text-gray-600 border border-gray-200"
              }`}
            >
              {showActiveOnly ? `Active only (${activeCount})` : `All ads (${totalCount})`}
            </button>
            {/* Search */}
            <div className="relative">
              <svg className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ads..."
                className="text-[12px] pl-8 pr-3 py-1.5 rounded-full bg-white/60 border border-gray-200 text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#6B93D8]/30 focus:border-[#6B93D8] w-48"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="cursor-pointer absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-transform">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Account Health Score */}
      {healthScore !== null && healthMeta && (
        <div className="rounded-2xl lv-card p-5 mb-6 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: healthMeta.bg }}>
                <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke={healthMeta.color} strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-foreground">Account Health</h2>
                <p className="text-[11px] text-muted-foreground">Based on active ad fatigue levels</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold tabular-nums" style={{ color: healthMeta.color }}>{healthScore}</span>
              <div className="text-right">
                <span className="text-[11px] text-muted-foreground">/100</span>
                <div className="text-[12px] font-semibold px-2 py-0.5 rounded-full mt-0.5" style={{ backgroundColor: healthMeta.bg, color: healthMeta.color }}>
                  {healthMeta.label}
                </div>
              </div>
            </div>
          </div>
          <div className="w-full h-3 rounded-full overflow-hidden" style={{ backgroundColor: healthMeta.track }}>
            <div
              className="h-full rounded-full transition-colors duration-700 ease-out"
              style={{ width: `${healthScore}%`, background: `linear-gradient(90deg, ${healthMeta.color}cc, ${healthMeta.color})` }}
            />
          </div>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {(["healthy", "early_warning", "fatiguing", "fatigued"] as const).map((stage) => {
          const meta = STAGE_META[stage];
          const count = counts[stage];
          const isActive = filter === stage;
          return (
            <button key={stage} onClick={() => setFilter(filter === stage ? "all" : stage)}
              className={`cursor-pointer rounded-2xl p-5 min-h-[120px] text-left transition-all duration-100 active:scale-[0.97] status-card-hover animate-fade-in animate-delay-${(["healthy", "early_warning", "fatiguing", "fatigued"] as const).indexOf(stage) + 1} ${
                isActive ? "ring-2 ring-[#6B93D8] shadow-lg shadow-blue-100" : "lv-card"
              }`}
              style={{ backgroundColor: isActive ? meta.bg : "rgba(255,255,255,0.55)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
              <div className="flex items-center gap-2 mb-3 pointer-events-none">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                <span className="text-[12px] font-medium text-muted-foreground">{meta.label}</span>
              </div>
              <div className="text-3xl font-bold text-foreground tabular-nums pointer-events-none">{count}</div>
              <div className="text-[11px] text-muted mt-1 pointer-events-none">{meta.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Performance Overview with Period Comparison */}
      {ads.length > 0 && (
        <div className="rounded-2xl lv-card p-6 mb-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-[#6B93D8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              <h2 className="text-[15px] font-semibold text-foreground">Performance</h2>
            </div>
            <span className="text-[11px] text-muted-foreground bg-white/30 px-2.5 py-1 rounded-full">vs previous period</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <MetricCard label="Spend" value={`$${spendData.totalSpendRange.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} change={spendData.spendChange} invertColor />
            <MetricCard label="Impressions" value={fmtNum(spendData.totalImpressionsRange)} change={spendData.impressionChange} />
            <MetricCard label="Clicks" value={fmtNum(spendData.totalClicksRange)} change={spendData.clickChange} />
            <MetricCard label="Avg CTR" value={`${spendData.overallCTR.toFixed(2)}%`} change={spendData.ctrChange} />
          </div>
          <div>
            <div className="text-[10px] text-muted uppercase tracking-wider font-medium mb-1">Daily spend</div>
            <SparklineChart data={spendData.dailySpend.map((d) => d.spend)} color="#6B93D8" height={48} />
          </div>
        </div>
      )}

      {/* Action Cards Row */}
      {ads.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Wasted Spend */}
          <div onClick={() => { if (spendData.fatigueAdCount > 0) setFilter("fatigued"); }} className="rounded-2xl lv-card p-5 cursor-pointer">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
                </svg>
              </div>
              <div className="text-[12px] font-semibold text-foreground">Wasted Spend</div>
            </div>
            {spendData.fatigueAdCount > 0 ? (
              <>
                <div className="text-2xl font-bold text-red-500 tabular-nums mb-1">
                  ${spendData.wastedSpend.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {spendData.wastedPct.toFixed(0)}% of your budget on {spendData.fatigueAdCount} fatigued ad{spendData.fatigueAdCount > 1 ? "s" : ""}. Pause and reallocate.
                </p>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-green-500 tabular-nums mb-1">$0</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">No spend being wasted on fatigued ads. You&apos;re efficient.</p>
              </>
            )}
          </div>

          {/* Top Performer */}
          <div onClick={() => { if (spendData.topAdId) router.push(`/ad/${spendData.topAdId}`); }} className="rounded-2xl lv-card p-5 cursor-pointer">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                </svg>
              </div>
              <div className="text-[12px] font-semibold text-foreground">Top Performer</div>
            </div>
            {spendData.topAdName ? (
              <>
                <div className="text-[14px] font-bold text-foreground truncate mb-1">{spendData.topAdName}</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <span className="text-green-600 font-semibold">{spendData.topAdCTR.toFixed(2)}% CTR</span>. Scale this ad&apos;s budget while it&apos;s winning.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Not enough data yet</p>
            )}
          </div>

          {/* Weakest Ad */}
          <div onClick={() => { if (spendData.bottomAdId) router.push(`/ad/${spendData.bottomAdId}`); }} className="rounded-2xl lv-card p-5 cursor-pointer">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" />
                </svg>
              </div>
              <div className="text-[12px] font-semibold text-foreground">Weakest Ad</div>
            </div>
            {spendData.bottomAdName ? (
              <>
                <div className="text-[14px] font-bold text-foreground truncate mb-1">{spendData.bottomAdName}</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <span className="text-orange-600 font-semibold">{spendData.bottomAdCTR.toFixed(2)}% CTR</span>. Test new creative or pause this one.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Need 2+ ads to compare</p>
            )}
          </div>
        </div>
      )}

      {/* What You Should Do */}
      {insights.length > 0 && (
        <div className="rounded-2xl lv-card p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#6B93D8] via-[#D06AB8] to-[#F04E80] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
            </div>
            <h2 className="text-[15px] font-semibold text-foreground">What You Should Do</h2>
          </div>
          <div className="space-y-2.5">
            {insights.map((insight, i) => {
              const isClickable = !!insight.adId;
              const Wrapper = isClickable ? "a" : "div";
              return (
                <Wrapper
                  key={i}
                  {...(isClickable ? { href: `/ad/${insight.adId}` } : {})}
                  className={`flex items-start gap-3 px-4 py-3 rounded-xl bg-white/30 transition-colors ${
                    isClickable ? "hover:bg-white/50 hover:shadow-sm cursor-pointer group" : "hover:bg-white/40"
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: insight.color }} />
                  <p className="text-[13px] text-foreground leading-relaxed flex-1">{insight.text}</p>
                  {isClickable && (
                    <svg className="w-4 h-4 text-gray-400 group-hover:text-foreground flex-shrink-0 mt-1 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  )}
                </Wrapper>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter pill + View toggle */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {filter !== "all" && (
            <>
              <span className="text-[13px] text-muted">Showing:</span>
              <button onClick={() => setFilter("all")}
                className="cursor-pointer text-[12px] px-3 py-1.5 rounded-full bg-gradient-to-r from-[#6B93D8]/15 via-[#9B7ED0]/15 to-[#D06AB8]/15 text-[#6B78C8] hover:from-[#6B93D8]/25 hover:via-[#9B7ED0]/25 hover:to-[#D06AB8]/25 transition-colors flex items-center gap-1.5 font-medium">
                {STAGE_META[filter]?.label}
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>

        {ads.length > 0 && (
          <div className="flex items-center glass rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                viewMode === "grid"
                  ? "bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/40"
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              Grid
            </button>
            <button
              onClick={() => setViewMode("campaign")}
              className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                viewMode === "campaign"
                  ? "bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/40"
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              Campaign
            </button>
          </div>
        )}
      </div>

      {ads.length === 0 ? (
        <div className="text-center py-24">
          <div className="w-20 h-20 rounded-3xl bg-accent-light flex items-center justify-center mx-auto mb-5">
            <svg className="w-9 h-9 text-[#6B93D8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">You&apos;re connected</h2>
          <p className="text-[14px] text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
            Your Meta account is linked. Click <strong>&quot;Refresh Data&quot;</strong> in the sidebar to pull your ads in.
          </p>
          <div className="flex items-center justify-center gap-3">
            <svg className="w-5 h-5 text-foreground animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="text-[14px] font-bold text-foreground">Hit &quot;Refresh Data&quot; in the sidebar</span>
          </div>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((ad, i) => (
            <div key={ad.id} className={`animate-fade-in animate-delay-${Math.min(i % 6 + 1, 6)}`}>
              <AdCard id={ad.id} adName={ad.adName} campaignName={ad.campaignName}
                status={ad.status} fatigue={ad.fatigue} recentMetrics={ad.recentMetrics} thumbnailUrl={ad.thumbnailUrl} imageUrl={ad.imageUrl} adBody={ad.adBody} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {campaignGroups.map((group) => (
            <CampaignSection key={group.campaignName} group={group} filter={filter} />
          ))}
        </div>
      )}
    </main>
  );
}
