"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FatigueScoreBadge from "./FatigueScoreBadge";
import SparklineChart from "./SparklineChart";
import { STAGE_GLOW, type FatigueStage } from "@/lib/fatigue/types";

interface RecentMetric { ctr: number; cpm: number; frequency: number; }
interface FatigueData {
  fatigueScore: number; stage: FatigueStage; dataStatus: string;
  signals?: any[]; baselineWindow?: { start: string; end: string } | null; recentWindow?: { start: string; end: string } | null;
  predictedDaysToFatigue?: number | null;
  fatigueVelocity?: number;
  trendDirection?: string;
}
interface Props {
  id: string; adName: string; campaignName: string; status: string;
  fatigue: FatigueData; recentMetrics: RecentMetric[];
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  adBody?: string | null;
}

export default function AdCard({ id, adName, campaignName, status, fatigue, recentMetrics, thumbnailUrl, imageUrl, adBody }: Props) {
  const router = useRouter();
  const [imgFailed, setImgFailed] = useState(false);
  // Route through our server-side image proxy. Resolves the freshest URL
  // from Meta on demand so signed-URL expiry never shows broken images.
  // ?v=3 busts the browser cache after the image-proxy quality upgrade
  // (image_hash permalink_url is now priority-1). Bump when ladder changes.
  const src = `/api/ad-image/${id}?v=3`;
  const showImage = !imgFailed;
  const isCollecting = fatigue.dataStatus !== "sufficient";
  const glowClass = !isCollecting ? STAGE_GLOW[fatigue.stage] : "";

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
    <div onClick={() => router.push(`/ad/${id}`)} className={`group cursor-pointer lv-card p-6 ${glowClass}`}>
      <div className="mb-4 -mx-6 -mt-6 relative overflow-hidden pointer-events-none">
        {showImage ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="w-full h-36 object-cover rounded-t-2xl bg-gray-100"
          />
        ) : (
          // Gradient placeholder when image is missing or 404'd, avoids
          // the ugly broken-image icon + alt text fallback.
          <div className="w-full h-36 rounded-t-2xl bg-gradient-to-br from-[#6B93D8]/20 via-[#9B7ED0]/20 to-[#D06AB8]/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          </div>
        )}
        {showImage && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent rounded-t-2xl" />
        )}
      </div>
      <div className="flex items-start justify-between gap-4 pointer-events-none">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] text-foreground truncate group-hover:text-[#6B93D8]">
            {adName}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider ${
              status === "ACTIVE" ? "bg-green-50 text-green-600" : status === "PAUSED" ? "bg-yellow-50 text-yellow-600" : "bg-gray-100 text-gray-500"
            }`}>{status}</span>
            <p className="text-[12px] text-muted-foreground truncate">{campaignName}</p>
            {trendInsight && (
              <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: trendInsight.color, backgroundColor: trendInsight.bg }}>
                {trendInsight.text}
              </span>
            )}
          </div>
          {adBody && (
            <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">{adBody}</p>
          )}
        </div>
        {isCollecting ? (
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="w-14 h-14 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
            </div>
            <span className="text-[9px] text-muted uppercase tracking-wider font-medium">Collecting</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="relative">
              <FatigueScoreBadge score={fatigue.fatigueScore} stage={fatigue.stage} size="md" />
              {fatigue.trendDirection && fatigue.trendDirection !== "stable" && (
                <span className="absolute -right-4 top-1/2 -translate-y-1/2 text-[12px] font-bold">
                  {fatigue.trendDirection === "improving" && <span className="text-green-500">↓</span>}
                  {fatigue.trendDirection === "declining" && <span className="text-orange-500">↑</span>}
                  {fatigue.trendDirection === "accelerating" && <span className="text-red-500">⇈</span>}
                </span>
              )}
            </div>
            {fatigue.predictedDaysToFatigue != null && fatigue.predictedDaysToFatigue > 0 && fatigue.predictedDaysToFatigue < 14 && (
              <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                fatigue.predictedDaysToFatigue <= 3
                  ? "bg-red-50 text-red-600"
                  : fatigue.predictedDaysToFatigue <= 7
                    ? "bg-orange-50 text-orange-600"
                    : "bg-yellow-50 text-yellow-600"
              }`}>
                {fatigue.predictedDaysToFatigue <= 3
                  ? `Fatigues in ~${fatigue.predictedDaysToFatigue}d`
                  : fatigue.predictedDaysToFatigue <= 7
                    ? `~${fatigue.predictedDaysToFatigue}d to fatigue`
                    : `~${fatigue.predictedDaysToFatigue}d left`}
              </span>
            )}
          </div>
        )}
      </div>

      {!isCollecting && recentMetrics.length > 0 && (
        <div className="mt-5 pt-4 border-t border-blue-100 grid grid-cols-3 gap-4 pointer-events-none">
          <MiniMetric label="CTR" value={`${recentMetrics[recentMetrics.length - 1]?.ctr?.toFixed(2) ?? 0}%`}
            data={recentMetrics.map((m) => m.ctr)} color="#6B93D8" />
          <MiniMetric label="Frequency" value={recentMetrics[recentMetrics.length - 1]?.frequency?.toFixed(1) ?? "0"}
            data={recentMetrics.map((m) => m.frequency)}
            color={(recentMetrics[recentMetrics.length - 1]?.frequency ?? 0) > 4 ? "#ea384c" : (recentMetrics[recentMetrics.length - 1]?.frequency ?? 0) > 2.5 ? "#f59e0b" : "#22c55e"} />
          <MiniMetric label="CPM" value={`$${recentMetrics[recentMetrics.length - 1]?.cpm?.toFixed(0) ?? 0}`}
            data={recentMetrics.map((m) => m.cpm)} color="#f59e0b" />
        </div>
      )}
    </div>
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
