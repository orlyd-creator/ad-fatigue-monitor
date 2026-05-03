"use client";

import { useMemo, useState } from "react";
import type { PatternStats } from "@/lib/creative/dna";

/**
 * Format × Hook matrix. Each cell shows the dominant pattern stat at a glance,
 * color-graded by CTR vs portfolio. Click a cell to expand the ads in it.
 */
export default function CreativeDNAMatrix({
  patterns,
  portfolioCtr,
}: {
  patterns: PatternStats[];
  portfolioCtr: number;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const formats = useMemo(() => {
    const set = new Set(patterns.map((p) => p.formatLabel));
    return Array.from(set);
  }, [patterns]);
  const hooks = useMemo(() => {
    const set = new Set(patterns.map((p) => p.hookLabel));
    return Array.from(set);
  }, [patterns]);

  const byKey = useMemo(() => {
    const m = new Map<string, PatternStats>();
    for (const p of patterns) m.set(`${p.formatLabel}__${p.hookLabel}`, p);
    return m;
  }, [patterns]);

  if (patterns.length === 0) {
    return (
      <div className="lv-card p-6 text-[13px] text-muted-foreground">
        No patterns to display yet.
      </div>
    );
  }

  return (
    <div className="lv-card-solid p-4 sm:p-5">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-wider text-gray-500 font-semibold py-2 pr-4 sticky left-0 bg-[var(--card-strong)]">
                Hook ↓ / Format →
              </th>
              {formats.map((f) => (
                <th key={f} className="text-left text-[10px] uppercase tracking-wider text-gray-500 font-semibold py-2 px-3">
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hooks.map((h) => (
              <tr key={h} className="border-t border-gray-100">
                <td className="py-2 pr-4 text-[12px] font-medium text-foreground/80 sticky left-0 bg-[var(--card-strong)] whitespace-nowrap">
                  {h}
                </td>
                {formats.map((f) => {
                  const p = byKey.get(`${f}__${h}`);
                  return (
                    <td key={f} className="py-2 px-2 align-top">
                      {p ? (
                        <Cell
                          pattern={p}
                          portfolioCtr={portfolioCtr}
                          open={openKey === p.patternKey}
                          onClick={() => setOpenKey(openKey === p.patternKey ? null : p.patternKey)}
                        />
                      ) : (
                        <div className="text-[11px] text-gray-300">—</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openKey && (() => {
        const expanded = patterns.find((p) => p.patternKey === openKey);
        return expanded ? <ExpandedPatternRow pattern={expanded} /> : null;
      })()}
    </div>
  );
}

function Cell({
  pattern,
  portfolioCtr,
  open,
  onClick,
}: {
  pattern: PatternStats;
  portfolioCtr: number;
  open: boolean;
  onClick: () => void;
}) {
  // Background color graded by ctrIndex.
  const idx = pattern.ctrIndex;
  let bg = "rgba(148,163,184,0.08)"; // gray default
  let fg = "#475569";
  if (idx >= 1.3) { bg = "rgba(34,197,94,0.14)"; fg = "#15803d"; }
  else if (idx >= 1.1) { bg = "rgba(34,197,94,0.08)"; fg = "#16a34a"; }
  else if (idx >= 0.9) { bg = "rgba(148,163,184,0.10)"; fg = "#475569"; }
  else if (idx >= 0.7) { bg = "rgba(249,115,22,0.10)"; fg = "#c2410c"; }
  else { bg = "rgba(240,78,128,0.14)"; fg = "#be185d"; }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-md px-3 py-2 transition-all ${open ? "ring-2 ring-offset-1" : ""}`}
      style={{ background: bg, color: fg, ...(open ? { boxShadow: "0 0 0 2px rgba(155,126,208,0.4)" } : {}) }}
    >
      <div className="text-[13px] font-semibold tabular-nums">{pattern.avgCtr.toFixed(2)}%</div>
      <div className="text-[10px] opacity-80 mt-0.5 tabular-nums">
        {pattern.adCount} ads · ${Math.round(pattern.totalSpend).toLocaleString()}
      </div>
      {pattern.activeAdCount > 0 && (
        <div className="text-[9.5px] opacity-70 mt-0.5">{pattern.activeAdCount} live</div>
      )}
    </button>
  );
}

function ExpandedPatternRow({ pattern }: { pattern: PatternStats }) {
  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-baseline gap-3 mb-3">
        <div className="text-[14px] font-semibold text-foreground">{pattern.patternLabel}</div>
        <div className="text-[11.5px] text-gray-500 tabular-nums">
          {pattern.avgCtr.toFixed(2)}% CTR · {pattern.avgCpm > 0 ? `$${pattern.avgCpm.toFixed(2)} CPM · ` : ""}
          {pattern.avgHalfLifeDays ? `${pattern.avgHalfLifeDays}-day half-life · ` : ""}
          ${Math.round(pattern.totalSpend).toLocaleString()} spent
        </div>
      </div>
      <div className="grid gap-2">
        {pattern.ads.slice(0, 6).map((a) => (
          <div key={a.ad.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
            {(a.ad.imageUrl || a.ad.thumbnailUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.ad.imageUrl || a.ad.thumbnailUrl || ""} alt="" className="w-10 h-10 rounded object-cover bg-gray-100" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] text-foreground truncate">{a.ad.adName}</div>
              <div className="text-[10.5px] text-gray-500 truncate">{a.ad.campaignName}</div>
            </div>
            <div className="text-[11.5px] tabular-nums text-foreground/80 whitespace-nowrap">
              {a.recentCtr.toFixed(2)}% · ${Math.round(a.totalSpend).toLocaleString()}
              {a.isActive && <span className="ml-2 text-[10px] text-green-600">live</span>}
            </div>
          </div>
        ))}
        {pattern.ads.length > 6 && (
          <div className="text-[11px] text-gray-500 pt-1">+ {pattern.ads.length - 6} more in this pattern</div>
        )}
      </div>
    </div>
  );
}
