"use client";

import { useState } from "react";
import type { Recommendation, RecommendationSeverity, RecommendationAction } from "@/lib/strategy/recommendations";

/**
 * Recommendations panel, renders the output of generateCampaignRecommendations.
 * Each card has: severity stripe, title, body, numeric action_copy, confidence,
 * and an expand for supporting metrics.
 *
 * Palette: keeps the OD gradient accents (purple/pink/blue), no calmer pivots.
 */

interface Props {
  recommendations: Recommendation[];
  rangeLabel: string;
}

const SEVERITY_STYLE: Record<
  RecommendationSeverity,
  { bar: string; chip: string; chipBg: string; label: string }
> = {
  critical: {
    bar: "linear-gradient(180deg, #F04E80 0%, #D06AB8 100%)",
    chip: "#F04E80",
    chipBg: "rgba(240,78,128,0.1)",
    label: "Critical",
  },
  warning: {
    bar: "linear-gradient(180deg, #D06AB8 0%, #9B7ED0 100%)",
    chip: "#D06AB8",
    chipBg: "rgba(208,106,184,0.1)",
    label: "Attention",
  },
  opportunity: {
    bar: "linear-gradient(180deg, #6B93D8 0%, #9B7ED0 100%)",
    chip: "#6B93D8",
    chipBg: "rgba(107,147,216,0.1)",
    label: "Opportunity",
  },
  info: {
    bar: "linear-gradient(180deg, #9B7ED0 0%, #7E69AB 100%)",
    chip: "#7E69AB",
    chipBg: "rgba(126,105,171,0.1)",
    label: "FYI",
  },
};

const ACTION_ICON: Record<RecommendationAction, string> = {
  pause: "⏸",
  swap_creative: "🎨",
  scale_up: "📈",
  narrow_audience: "🎯",
  reallocate: "💸",
  refresh_soon: "⚡",
  investigate: "🔍",
  monitor: "👀",
};

function formatUSD(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export default function RecommendationsPanel({ recommendations, rangeLabel }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | RecommendationSeverity>("all");

  const filtered = filter === "all"
    ? recommendations
    : recommendations.filter(r => r.severity === filter);

  const counts = {
    critical: recommendations.filter(r => r.severity === "critical").length,
    warning: recommendations.filter(r => r.severity === "warning").length,
    opportunity: recommendations.filter(r => r.severity === "opportunity").length,
  };

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  if (recommendations.length === 0) return null;

  return (
    <div className="lv-card p-6 relative overflow-hidden">
      {/* Gradient accent header */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: "linear-gradient(90deg, #6B93D8, #9B7ED0, #D06AB8, #F04E80)" }}
      />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4 pt-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#F04E80]" />
            <h2 className="text-[16px] font-semibold text-foreground tracking-tight">
              Strategic recommendations
            </h2>
          </div>
          <p className="text-[12px] text-gray-500 leading-relaxed">
            {recommendations.length} action{recommendations.length === 1 ? "" : "s"} based on {rangeLabel}.
            Each is ranked by severity and projected impact.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === "all"} onClick={() => setFilter("all")} label={`All · ${recommendations.length}`} />
          {counts.critical > 0 && (
            <Chip active={filter === "critical"} onClick={() => setFilter("critical")} label={`Critical · ${counts.critical}`} color="#F04E80" />
          )}
          {counts.warning > 0 && (
            <Chip active={filter === "warning"} onClick={() => setFilter("warning")} label={`Attention · ${counts.warning}`} color="#D06AB8" />
          )}
          {counts.opportunity > 0 && (
            <Chip active={filter === "opportunity"} onClick={() => setFilter("opportunity")} label={`Opportunities · ${counts.opportunity}`} color="#6B93D8" />
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        {filtered.map((rec) => {
          const style = SEVERITY_STYLE[rec.severity];
          const isOpen = expanded.has(rec.id);
          return (
            <div
              key={rec.id}
              className="relative rounded-xl border border-gray-100 bg-white/60 hover:bg-white transition-colors cursor-pointer overflow-hidden"
              onClick={() => toggle(rec.id)}
            >
              {/* Left severity stripe */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1"
                style={{ background: style.bar }}
              />
              <div className="pl-5 pr-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0 leading-none pt-0.5" aria-hidden>
                    {ACTION_ICON[rec.action]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider px-2 py-[2px] rounded-full"
                        style={{ color: style.chip, backgroundColor: style.chipBg }}
                      >
                        {style.label}
                      </span>
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                        {rec.action.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-gray-400">· {rec.confidence} confidence</span>
                    </div>
                    <h3 className="text-[14px] font-semibold text-foreground leading-snug">
                      {rec.title}
                    </h3>
                    <p className="text-[12.5px] text-gray-600 leading-relaxed mt-1">
                      {rec.body}
                    </p>
                    <p className="text-[12.5px] font-medium mt-2" style={{ color: style.chip }}>
                      → {rec.action_copy}
                    </p>
                    {(rec.impact_usd || rec.impact_leads) && (
                      <div className="flex gap-3 mt-2 text-[11px] text-gray-500">
                        {rec.impact_usd !== undefined && rec.impact_usd !== 0 && (
                          <span>
                            Est. impact: <span className="font-semibold text-foreground">{formatUSD(rec.impact_usd)}/mo</span>
                          </span>
                        )}
                        {rec.impact_leads !== undefined && rec.impact_leads !== 0 && (
                          <span>
                            Est. leads: <span className="font-semibold text-foreground">{rec.impact_leads > 0 ? "+" : ""}{rec.impact_leads}</span>
                          </span>
                        )}
                      </div>
                    )}
                    {isOpen && rec.metrics && (
                      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                        {Object.entries(rec.metrics).map(([k, v]) => (
                          <div key={k} className="text-[11px]">
                            <span className="text-gray-400 uppercase tracking-wide mr-1.5">{k}:</span>
                            <span className="font-mono text-foreground">
                              {typeof v === "number"
                                ? (v % 1 === 0 ? v.toString() : v.toFixed(2))
                                : v ?? "-"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    className="text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0 p-1 -m-1"
                    aria-label={isOpen ? "Collapse" : "Expand"}
                    onClick={(e) => { e.stopPropagation(); toggle(rec.id); }}
                  >
                    <svg className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-foreground text-white border-foreground"
          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
      }`}
      style={active && color ? { background: color, borderColor: color } : undefined}
    >
      {label}
    </button>
  );
}
