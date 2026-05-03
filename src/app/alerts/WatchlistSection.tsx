"use client";

import { useState } from "react";
import type { AdWithFatigue } from "@/lib/alerts/briefing";

const STAGE_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  fatigued:       { bg: "rgba(239,68,68,0.10)",  fg: "#be123c", label: "Fatigued" },
  fatiguing:      { bg: "rgba(249,115,22,0.10)", fg: "#c2410c", label: "Fatiguing" },
  early_warning:  { bg: "rgba(245,158,11,0.10)", fg: "#b45309", label: "Early warning" },
  healthy:        { bg: "rgba(34,197,94,0.08)",  fg: "#15803d", label: "Healthy" },
};

export default function WatchlistSection({ items }: { items: AdWithFatigue[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (items.length === 0) return null;

  return (
    <div className="lv-card-solid divide-y divide-gray-100">
      {items.map((it) => {
        const tone = STAGE_TONE[it.fatigue.stage] || STAGE_TONE.healthy;
        const isOpen = expanded === it.ad.id;
        return (
          <div key={it.ad.id}>
            <button
              onClick={() => setExpanded(isOpen ? null : it.ad.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/60 transition"
            >
              {(it.ad.imageUrl || it.ad.thumbnailUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.ad.imageUrl || it.ad.thumbnailUrl || ""}
                  alt=""
                  className="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{it.ad.adName}</div>
                <div className="text-[10.5px] text-gray-500 truncate">{it.ad.campaignName}</div>
              </div>
              <div
                className="text-[10.5px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                style={{ background: tone.bg, color: tone.fg }}
              >
                {tone.label} · {Math.round(it.fatigue.fatigueScore)}
              </div>
              <div className="hidden sm:block text-[11px] tabular-nums text-foreground/70 w-20 text-right">
                {it.recentCtr7.toFixed(2)}% CTR
              </div>
              <div className="hidden md:block text-[11px] tabular-nums text-foreground/70 w-24 text-right">
                {it.recentFreq7.toFixed(1)}× freq
              </div>
              <div className="text-gray-300 text-[14px]">{isOpen ? "−" : "+"}</div>
            </button>
            {isOpen && (
              <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11.5px]">
                  <KV label="Score" value={`${Math.round(it.fatigue.fatigueScore)}/100`} />
                  <KV label="Stage" value={tone.label} />
                  <KV label="Days running" value={String(it.metrics.length)} />
                  <KV label="Daily spend" value={`$${it.dailySpendNow.toFixed(0)}`} />
                  <KV label="Recent CTR" value={`${it.recentCtr7.toFixed(2)}%`} />
                  <KV label="Recent CPM" value={`$${it.recentCpm7.toFixed(2)}`} />
                  <KV label="Recent freq" value={`${it.recentFreq7.toFixed(1)}×`} />
                  <KV label="Spend last 7d" value={`$${Math.round(it.recentSpend7).toLocaleString()}`} />
                </div>
                {it.fatigue.signals.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Signals</div>
                    <div className="grid gap-1.5">
                      {it.fatigue.signals.slice(0, 5).map((s, i) => (
                        <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                          <span className="text-foreground/70 w-32 flex-shrink-0">{s.label}</span>
                          <span className="text-foreground/85 flex-1">{s.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-[12px] font-medium text-foreground tabular-nums">{value}</div>
    </div>
  );
}
