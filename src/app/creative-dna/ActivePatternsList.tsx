"use client";

import { useMemo, useState } from "react";
import type { AdScored } from "@/lib/creative/dna";

/**
 * Live ads, grouped or sorted with their pattern + how that pattern is doing
 * historically. Helps the operator see at a glance whether their currently
 * spending money sits on winning or losing patterns.
 */
export default function ActivePatternsList({
  scoredAds,
  portfolioCtr,
}: {
  scoredAds: AdScored[];
  portfolioCtr: number;
}) {
  const [sortBy, setSortBy] = useState<"spend" | "ctr" | "fatigue">("spend");

  const sorted = useMemo(() => {
    const arr = [...scoredAds];
    if (sortBy === "spend") arr.sort((a, b) => b.dailySpend - a.dailySpend);
    if (sortBy === "ctr") arr.sort((a, b) => b.recentCtr - a.recentCtr);
    if (sortBy === "fatigue") arr.sort((a, b) => (b.halfLife.decayedBy || 0) - (a.halfLife.decayedBy || 0));
    return arr;
  }, [scoredAds, sortBy]);

  if (scoredAds.length === 0) {
    return (
      <div className="lv-card p-6 text-[13px] text-muted-foreground">
        No active ads to show right now.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 text-[11px]">
        <span className="text-gray-500 mr-1">Sort:</span>
        {(["spend", "ctr", "fatigue"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`px-2.5 py-1 rounded-full transition ${
              sortBy === s ? "bg-foreground text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s === "spend" ? "Daily spend" : s === "ctr" ? "Recent CTR" : "Most decayed"}
          </button>
        ))}
      </div>

      <div className="lv-card-solid divide-y divide-gray-100">
        {sorted.map((a) => {
          const ctrVsPort = portfolioCtr > 0 ? a.recentCtr / portfolioCtr : 1;
          const ctrTone = ctrVsPort >= 1.1 ? "good" : ctrVsPort >= 0.9 ? "neutral" : "bad";
          const ctrColor = ctrTone === "good" ? "#16a34a" : ctrTone === "bad" ? "#be185d" : "#475569";
          const decayPct = Math.round((a.halfLife.decayedBy || 0) * 100);
          return (
            <div key={a.ad.id} className="flex items-center gap-3 px-4 py-3">
              {(a.ad.imageUrl || a.ad.thumbnailUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.ad.imageUrl || a.ad.thumbnailUrl || ""}
                  alt=""
                  className="w-12 h-12 rounded object-cover bg-gray-100 flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{a.ad.adName}</div>
                <div className="text-[10.5px] text-gray-500 truncate">
                  {a.cls.patternLabel} · {a.ad.campaignName}
                </div>
              </div>
              <div className="hidden sm:flex flex-col items-end text-[11px] tabular-nums w-24">
                <div className="text-gray-500 text-[9.5px] uppercase">CTR</div>
                <div className="font-semibold" style={{ color: ctrColor }}>
                  {a.recentCtr.toFixed(2)}%
                </div>
              </div>
              <div className="hidden md:flex flex-col items-end text-[11px] tabular-nums w-28">
                <div className="text-gray-500 text-[9.5px] uppercase">Daily spend</div>
                <div className="font-semibold text-foreground">${a.dailySpend.toFixed(0)}</div>
              </div>
              <div className="flex flex-col items-end text-[11px] tabular-nums w-24">
                <div className="text-gray-500 text-[9.5px] uppercase">Decay</div>
                <div className="font-semibold" style={{ color: decayPct >= 30 ? "#be185d" : decayPct >= 15 ? "#c2410c" : "#475569" }}>
                  {decayPct}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
