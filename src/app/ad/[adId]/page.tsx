"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import FatigueScoreBadge from "@/components/FatigueScoreBadge";
import MetricTrendChart from "@/components/MetricTrendChart";
import SignalBreakdown from "@/components/SignalBreakdown";
import AlertFeed from "@/components/AlertFeed";
import { STAGE_COLORS, STAGE_BG, type FatigueResult, type FatigueStage } from "@/lib/fatigue/types";

interface Metric {
  date: string; ctr: number; cpm: number; frequency: number;
  conversionRate: number; costPerAction: number; inlinePostEngagement: number;
  impressions: number; spend: number; clicks: number; actions: number;
}
interface AdDetail {
  ad: { id: string; adName: string; campaignName: string; adsetName: string; status: string };
  fatigue: FatigueResult; metrics: Metric[]; alerts: any[];
}

const REC: Record<string, { title: string; body: string; action: string }> = {
  healthy: { title: "This ad is performing well", body: "No signs of fatigue. Your audience is still engaging and costs are stable.", action: "Keep running it and check back in a few days." },
  early_warning: { title: "Early signs of wear", body: "Some metrics are starting to dip. Not urgent yet, but start prepping a fresh creative.", action: "Prepare a replacement to swap in within 5-7 days." },
  fatiguing: { title: "This ad needs a refresh", body: "Multiple signals show declining performance. Your audience is getting tired of this ad, which drives up costs.", action: "Swap the creative, narrow your audience, or reduce budget now." },
  fatigued: { title: "Time to replace this ad", body: "This ad has clearly fatigued. Every day it runs is wasted spend.", action: "Replace the creative immediately or pause this ad." },
};

export default function AdDetailPage() {
  const params = useParams();
  const adId = params.adId as string;
  const [data, setData] = useState<AdDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/ads/${adId}`).then((r) => r.json()).then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [adId]);

  if (loading) return (
    <div className="min-h-screen bg-transparent">
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="animate-pulse space-y-4"><div className="h-4 bg-surface rounded-lg w-48" /><div className="h-8 bg-surface rounded-lg w-72" /><div className="h-64 bg-surface rounded-2xl mt-6" /></div>
      </main>
    </div>
  );

  if (!data?.ad) return (
    <div className="min-h-screen bg-transparent">
      <main className="max-w-5xl mx-auto px-6 py-8 text-center">
        <h1 className="text-lg font-semibold">Ad not found</h1>
        <Link href="/dashboard" className="text-[#6B93D8] text-sm mt-4 inline-block hover:underline">Back to Dashboard</Link>
      </main>
    </div>
  );

  const { ad, fatigue, metrics, alerts } = data;
  const rec = REC[fatigue.stage];
  const stageColor = STAGE_COLORS[fatigue.stage as FatigueStage];
  const stageBg = STAGE_BG[fatigue.stage as FatigueStage];

  return (
    <div className="min-h-screen bg-transparent">
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[13px] text-muted mb-6">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
          <span className="text-muted">/</span>
          <span className="text-foreground font-medium">{ad.adName}</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-8 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">{ad.adName}</h1>
            <p className="text-[14px] text-muted-foreground mt-1.5">{ad.campaignName} &middot; {ad.adsetName}</p>
            <span className={`inline-block mt-3 text-[11px] font-semibold px-3 py-1 rounded-full uppercase tracking-wider ${
              ad.status === "ACTIVE" ? "bg-green-50 text-green-600" : "bg-surface text-muted"}`}>
              {ad.status}
            </span>
          </div>
          <FatigueScoreBadge score={fatigue.fatigueScore} stage={fatigue.stage} size="lg" />
        </div>

        {/* Recommendation */}
        <div className="lv-card p-6 mb-6" style={{ backgroundColor: stageBg, border: `1px solid ${stageColor}20` }}>
          <h3 className="text-[15px] font-semibold text-foreground mb-1">{rec.title}</h3>
          <p className="text-[13px] text-muted-foreground leading-relaxed">{rec.body}</p>
          <p className="text-[13px] font-semibold mt-3" style={{ color: stageColor }}>{rec.action}</p>
        </div>

        {/* Fatigue Forecast */}
        <FatigueForecastCard
          fatigueScore={fatigue.fatigueScore}
          predictedDaysToFatigue={fatigue.predictedDaysToFatigue}
          fatigueVelocity={fatigue.fatigueVelocity}
          trendDirection={fatigue.trendDirection}
        />

        {/* Signals */}
        <div className="mb-8"><SignalBreakdown signals={fatigue.signals} /></div>

        {/* Charts */}
        <div className="mb-8">
          <h3 className="text-[16px] font-semibold text-foreground mb-2">Performance Over Time</h3>
          <p className="text-[13px] text-muted-foreground mb-5">Dashed lines show warning (yellow) and danger (red) thresholds where applicable</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricTrendChart label="CTR (Click-Through Rate)" data={metrics.map((m) => ({ date: m.date, value: m.ctr }))} color="#6B93D8" suffix="%"
              warningThreshold={1.0} dangerThreshold={0.5} invertThreshold={false} />
            <MetricTrendChart label="CPC (Cost Per Click)" data={metrics.map((m) => ({ date: m.date, value: m.impressions > 0 && m.clicks > 0 ? m.spend / m.clicks : 0 }))} color="#D06AB8" prefix="$"
              invertThreshold={true} />
            <MetricTrendChart label="CPM (Cost Per 1K Impressions)" data={metrics.map((m) => ({ date: m.date, value: m.cpm }))} color="#F04E80" prefix="$"
              invertThreshold={true} />
            <MetricTrendChart label="Frequency" data={metrics.map((m) => ({ date: m.date, value: m.frequency }))} color="#f97316" suffix="x"
              warningThreshold={2.5} dangerThreshold={4.0} invertThreshold={true} />
            <MetricTrendChart label="Daily Spend" data={metrics.map((m) => ({ date: m.date, value: m.spend }))} color="#7B8AD8" prefix="$"
              invertThreshold={true} />
            <MetricTrendChart label="Conversions" data={metrics.map((m) => ({ date: m.date, value: m.actions ?? 0 }))} color="#22c55e"
              invertThreshold={false} />
          </div>
        </div>

        {/* Alert History */}
        <h3 className="text-[16px] font-semibold text-foreground mb-4">Alert History</h3>
        <AlertFeed alerts={alerts.map((a: any) => ({ ...a, adName: ad.adName }))} />
      </main>
    </div>
  );
}

function FatigueForecastCard({
  fatigueScore,
  predictedDaysToFatigue,
  fatigueVelocity,
  trendDirection,
}: {
  fatigueScore: number;
  predictedDaysToFatigue: number | null;
  fatigueVelocity: number;
  trendDirection: string;
}) {
  const threshold = 75;
  const progressPct = Math.min((fatigueScore / threshold) * 100, 100);

  const trendInfo = (() => {
    if (trendDirection === "improving") return { text: "Improving ↓", color: "text-green-600", bg: "bg-green-50" };
    if (trendDirection === "declining") return { text: "Declining ↑", color: "text-orange-600", bg: "bg-orange-50" };
    if (trendDirection === "accelerating") return { text: "Accelerating ⇈", color: "text-red-600", bg: "bg-red-50" };
    return { text: "Stable", color: "text-muted-foreground", bg: "bg-gray-50" };
  })();

  return (
    <div className="lv-card p-6 mb-6">
      <h3 className="text-[15px] font-semibold text-foreground mb-4">Fatigue Forecast</h3>
      <div className="grid grid-cols-3 gap-6 mb-5">
        <div>
          <span className="text-[11px] text-muted uppercase tracking-wider font-medium">Days to Fatigue</span>
          <p className="text-[20px] font-bold text-foreground mt-1">
            {predictedDaysToFatigue != null && predictedDaysToFatigue > 0
              ? `~${predictedDaysToFatigue}d`
              : fatigueScore >= threshold
                ? "Fatigued"
                : "N/A"}
          </p>
        </div>
        <div>
          <span className="text-[11px] text-muted uppercase tracking-wider font-medium">Velocity</span>
          <p className="text-[20px] font-bold text-foreground mt-1">
            {fatigueVelocity !== 0 ? `${fatigueVelocity > 0 ? "+" : ""}${fatigueVelocity.toFixed(1)}/day` : "0/day"}
          </p>
        </div>
        <div>
          <span className="text-[11px] text-muted uppercase tracking-wider font-medium">Trend</span>
          <p className={`text-[14px] font-semibold mt-1.5 ${trendInfo.color}`}>
            <span className={`inline-block px-2 py-0.5 rounded-full text-[12px] ${trendInfo.bg}`}>{trendInfo.text}</span>
          </p>
        </div>
      </div>

      {/* Progress bar: current score toward fatigue threshold */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-muted mb-1.5">
          <span>Current: {Math.round(fatigueScore)}</span>
          <span>Fatigue threshold: {threshold}</span>
        </div>
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden relative">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progressPct}%`,
              background: fatigueScore >= threshold
                ? "#ea384c"
                : fatigueScore >= 50
                  ? "linear-gradient(90deg, #f59e0b, #ea384c)"
                  : fatigueScore >= 25
                    ? "linear-gradient(90deg, #22c55e, #f59e0b)"
                    : "#22c55e",
            }}
          />
          {predictedDaysToFatigue != null && predictedDaysToFatigue > 0 && fatigueScore < threshold && (
            <span
              className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold text-muted-foreground"
              style={{ left: `${Math.min(progressPct + 2, 90)}%` }}
            >
              ~{predictedDaysToFatigue}d →
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
