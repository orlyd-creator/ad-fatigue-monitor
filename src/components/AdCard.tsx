"use client";

import Link from "next/link";
import FatigueScoreBadge from "./FatigueScoreBadge";
import SparklineChart from "./SparklineChart";
import { STAGE_GLOW, type FatigueStage } from "@/lib/fatigue/types";

interface RecentMetric { ctr: number; cpm: number; frequency: number; }
interface FatigueData {
  fatigueScore: number; stage: FatigueStage; dataStatus: string;
  signals?: any[]; baselineWindow?: { start: string; end: string } | null; recentWindow?: { start: string; end: string } | null;
}
interface Props {
  id: string; adName: string; campaignName: string; status: string;
  fatigue: FatigueData; recentMetrics: RecentMetric[];
  thumbnailUrl?: string | null;
}

export default function AdCard({ id, adName, campaignName, fatigue, recentMetrics, thumbnailUrl }: Props) {
  const isCollecting = fatigue.dataStatus !== "sufficient";
  const glowClass = !isCollecting ? STAGE_GLOW[fatigue.stage] : "";

  // Compute trend insight
  const trendInsight = !isCollecting && recentMetrics.length >= 3 ? (() => {
    const recent = recentMetrics.slice(-3);
    const older = recentMetrics.slice(0, Math.max(1, recentMetrics.length - 3));
    const recentAvgCtr = recent.reduce((s, m) => s + m.ctr, 0) / recent.length;
    const olderAvgCtr = older.reduce((s, m) => s + m.ctr, 0) / older.length;
    const ctrChange = olderAvgCtr > 0 ? ((recentAvgCtr - olderAvgCtr) / olderAvgCtr) * 100 : 0;
    const freq = recentMetrics[recentMetrics.length - 1]?.frequency ?? 0;

    if (freq > 4) return { text: "High frequency", color: "#ea384c", bg: "#fef2f2" };
    if (ctrChange < -20) return { text: `CTR ↓${Math.abs(Math.round(ctrChange))}%`, color: "#f97316", bg: "#fff7ed" };
    if (ctrChange > 15) return { text: `CTR ↑${Math.round(ctrChange)}%`, color: "#22c55e", bg: "#f0fdf4" };
    if (freq > 2.5) return { text: "Watch frequency", color: "#f59e0b", bg: "#fffbeb" };
    return null;
  })() : null;

  return (
    <Link href={`/ad/${id}`} className={`group block lv-card p-6 ${glowClass}`}>
      {thumbnailUrl && (
        <div className="mb-4 -mx-6 -mt-6 relative overflow-hidden">
          <img
            src={thumbnailUrl}
            alt={`${adName} creative`}
            loading="lazy"
            className="w-full h-36 object-cover rounded-t-2xl group-hover:scale-105 transition-transform duration-500 bg-gray-100"
            style={{ imageRendering: "auto" }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent rounded-t-2xl" />
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] text-foreground truncate group-hover:text-[#DB2777] transition-colors">
            {adName}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[12px] text-muted-foreground truncate">{campaignName}</p>
            {trendInsight && (
              <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: trendInsight.color, backgroundColor: trendInsight.bg }}>
                {trendInsight.text}
              </span>
            )}
          </div>
        </div>
        {isCollecting ? (
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="w-14 h-14 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
            </div>
            <span className="text-[9px] text-muted uppercase tracking-wider font-medium">Collecting</span>
          </div>
        ) : (
          <FatigueScoreBadge score={fatigue.fatigueScore} stage={fatigue.stage} size="md" />
        )}
      </div>

      {!isCollecting && recentMetrics.length > 0 && (
        <div className="mt-5 pt-4 border-t border-pink-100 grid grid-cols-3 gap-4">
          <MiniMetric label="CTR" value={`${recentMetrics[recentMetrics.length - 1]?.ctr?.toFixed(2) ?? 0}%`}
            data={recentMetrics.map((m) => m.ctr)} color="#EC4899" />
          <MiniMetric label="Frequency" value={recentMetrics[recentMetrics.length - 1]?.frequency?.toFixed(1) ?? "0"}
            data={recentMetrics.map((m) => m.frequency)}
            color={(recentMetrics[recentMetrics.length - 1]?.frequency ?? 0) > 4 ? "#ea384c" : (recentMetrics[recentMetrics.length - 1]?.frequency ?? 0) > 2.5 ? "#f59e0b" : "#22c55e"} />
          <MiniMetric label="CPM" value={`$${recentMetrics[recentMetrics.length - 1]?.cpm?.toFixed(0) ?? 0}`}
            data={recentMetrics.map((m) => m.cpm)} color="#f59e0b" />
        </div>
      )}
    </Link>
  );
}

function MiniMetric({ label, value, data, color }: { label: string; value: string; data: number[]; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10px] text-muted uppercase tracking-wider font-medium">{label}</span>
        <span className="text-[12px] font-semibold text-foreground tabular-nums">{value}</span>
      </div>
      <SparklineChart data={data} color={color} height={24} />
    </div>
  );
}
