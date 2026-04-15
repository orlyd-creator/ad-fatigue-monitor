"use client";

import type { SignalResult } from "@/lib/fatigue/types";

const SIGNAL_EXPLANATIONS: Record<string, string> = {
  ctr_decline: "Clicks are dropping",
  cpm_rising: "Getting more expensive to show",
  frequency: "People are seeing it too often",
  conversion_drop: "Fewer people are converting",
  cost_per_result: "Each result costs more",
  engagement_decay: "Less likes, comments & shares",
};

function getScoreColor(score: number): string {
  if (score < 25) return "#22c55e";
  if (score < 50) return "#f59e0b";
  if (score < 75) return "#f97316";
  return "#ea384c";
}

export default function SignalBreakdown({ signals }: { signals: SignalResult[] }) {
  if (signals.length === 0) return null;
  return (
    <div className="lv-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h4 className="text-[15px] font-semibold text-foreground">What&apos;s Happening</h4>
        <span className="text-[11px] text-muted">Higher = bigger problem</span>
      </div>
      <div className="space-y-5">
        {signals.sort((a, b) => b.score - a.score).map((signal) => {
          const color = getScoreColor(signal.score);
          return (
            <div key={signal.name}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-[14px] font-medium text-foreground">{signal.label}</span>
                  <span className="text-[11px] text-muted ml-2">{Math.round(signal.weight * 100)}% weight</span>
                </div>
                <span className="text-[14px] font-bold tabular-nums" style={{ color }}>{signal.score}/100</span>
              </div>
              <div className="relative h-2 bg-surface rounded-full overflow-hidden">
                <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${signal.score}%`, backgroundColor: color }} />
              </div>
              <p className="text-[12px] text-muted-foreground mt-1.5">{SIGNAL_EXPLANATIONS[signal.name] || signal.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
