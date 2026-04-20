"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { STAGE_COLORS, STAGE_BG, type FatigueStage } from "@/lib/fatigue/types";
import { format, formatDistanceToNowStrict } from "date-fns";

interface AlertItem {
  id: number;
  adId: string;
  adName?: string;
  campaignName?: string;
  adsetName?: string;
  createdAt: number;
  fatigueScore: number;
  stage: string;
  signals: string;
  dismissed: number;
}

type Filter = "all" | "fatigued" | "fatiguing" | "early_warning";

const STAGE_ACTION: Record<FatigueStage, string> = {
  healthy: "No action. This ad is holding up.",
  early_warning: "Prep a replacement creative within 7 days.",
  fatiguing: "Swap the creative or narrow the audience now.",
  fatigued: "Pause or replace immediately. Every day = wasted spend.",
};

const STAGE_SHORT: Record<FatigueStage, string> = {
  healthy: "Healthy",
  early_warning: "Early",
  fatiguing: "Fatiguing",
  fatigued: "Fatigued",
};

export default function AlertFeed({ alerts }: { alerts: AlertItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  const uniqByAd = useMemo(() => {
    const seen = new Map<string, AlertItem>();
    for (const a of alerts) {
      if (!seen.has(a.adId)) seen.set(a.adId, a);
    }
    return Array.from(seen.values()).sort((a, b) => b.fatigueScore - a.fatigueScore);
  }, [alerts]);

  const filtered = useMemo(() => {
    if (filter === "all") return uniqByAd;
    return uniqByAd.filter(a => a.stage === filter);
  }, [uniqByAd, filter]);

  const counts = {
    all: uniqByAd.length,
    fatigued: uniqByAd.filter(a => a.stage === "fatigued").length,
    fatiguing: uniqByAd.filter(a => a.stage === "fatiguing").length,
    early_warning: uniqByAd.filter(a => a.stage === "early_warning").length,
  };

  if (uniqByAd.length === 0) {
    return (
      <div className="lv-card p-10 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6B93D8]/15 via-[#9B7ED0]/15 to-[#D06AB8]/15 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#7E69AB]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-[16px] font-semibold text-foreground">All quiet</p>
        <p className="text-[13px] text-muted-foreground mt-1">
          Every active ad is in healthy shape. Alerts appear here the moment fatigue signals show up.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`All · ${counts.all}`} />
        {counts.fatigued > 0 && (
          <FilterChip active={filter === "fatigued"} onClick={() => setFilter("fatigued")} label={`Fatigued · ${counts.fatigued}`} color="#ef4444" />
        )}
        {counts.fatiguing > 0 && (
          <FilterChip active={filter === "fatiguing"} onClick={() => setFilter("fatiguing")} label={`Fatiguing · ${counts.fatiguing}`} color="#f97316" />
        )}
        {counts.early_warning > 0 && (
          <FilterChip active={filter === "early_warning"} onClick={() => setFilter("early_warning")} label={`Early warning · ${counts.early_warning}`} color="#f59e0b" />
        )}
      </div>

      <div className="space-y-2.5">
        {filtered.map((alert) => {
          const stage = alert.stage as FatigueStage;
          const color = STAGE_COLORS[stage] || "#9ca3af";
          const bg = STAGE_BG[stage] || "#f8f8f6";
          const stageShort = STAGE_SHORT[stage] || alert.stage;
          const actionCopy = STAGE_ACTION[stage] || "";

          let parsedSignals: Array<{ name: string; label: string; score: number }> = [];
          try { parsedSignals = JSON.parse(alert.signals); } catch {}
          const topSignals = parsedSignals.filter(s => s.score >= 30).sort((a, b) => b.score - a.score).slice(0, 3);

          return (
            <div
              key={alert.id}
              onClick={() => router.push(`/ad/${alert.adId}`)}
              className="group relative rounded-2xl overflow-hidden border border-gray-100 bg-white/70 hover:bg-white hover:border-gray-200 transition-colors cursor-pointer"
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-1"
                style={{ background: `linear-gradient(180deg, ${color}ff, ${color}88)` }}
              />
              <div className="pl-5 pr-4 py-4 flex items-start gap-4">
                <div className="flex-shrink-0 flex items-center justify-center">
                  <ScoreRing score={alert.fatigueScore} color={color} bg={bg} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-[14px] font-semibold text-foreground truncate group-hover:text-[#7E69AB] transition-colors">
                      {alert.adName || `Ad ${alert.adId}`}
                    </h3>
                    <span
                      className="text-[9.5px] font-semibold uppercase tracking-wider px-2 py-[1px] rounded-full flex-shrink-0"
                      style={{ color, backgroundColor: bg }}
                    >
                      {stageShort}
                    </span>
                  </div>
                  {(alert.campaignName || alert.adsetName) && (
                    <div className="text-[11px] text-gray-500 mb-2 truncate">
                      {alert.campaignName}
                      {alert.adsetName && <span className="text-gray-300 mx-1.5">·</span>}
                      {alert.adsetName}
                    </div>
                  )}
                  {topSignals.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {topSignals.map(s => (
                        <span
                          key={s.name}
                          className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                          style={{ background: `${color}15`, color }}
                        >
                          {s.label} {s.score}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[12px] font-medium" style={{ color }}>
                    → {actionCopy}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] text-gray-400 tabular-nums">
                    {formatDistanceToNowStrict(new Date(alert.createdAt), { addSuffix: true })}
                  </div>
                  <div className="text-[9.5px] text-gray-300 tabular-nums mt-0.5">
                    {format(new Date(alert.createdAt), "MMM d, h:mm a")}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({
  active, onClick, label, color,
}: {
  active: boolean; onClick: () => void; label: string; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "text-white border-transparent"
          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
      }`}
      style={active ? { background: color || "#111827", borderColor: color || "#111827" } : undefined}
    >
      {label}
    </button>
  );
}

function ScoreRing({ score, color, bg }: { score: number; color: string; bg: string }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = circumference * (1 - pct);
  return (
    <div className="relative w-12 h-12 flex items-center justify-center" style={{ background: bg, borderRadius: 14 }}>
      <svg width={48} height={48} className="absolute inset-0 -rotate-90">
        <circle cx={24} cy={24} r={radius} stroke={color} strokeOpacity={0.2} strokeWidth={4} fill="none" />
        <circle
          cx={24} cy={24} r={radius}
          stroke={color}
          strokeWidth={4}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 400ms ease-out" }}
        />
      </svg>
      <span className="text-[13px] font-bold tabular-nums" style={{ color }}>{score}</span>
    </div>
  );
}
