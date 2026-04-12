"use client";

import Link from "next/link";
import { STAGE_COLORS, STAGE_LABELS, STAGE_BG, type FatigueStage } from "@/lib/fatigue/types";
import { format } from "date-fns";

interface AlertItem {
  id: number; adId: string; adName?: string; createdAt: number;
  fatigueScore: number; stage: string; signals: string; dismissed: number;
}

export default function AlertFeed({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) return (
    <div className="text-center py-16">
      <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      </div>
      <p className="text-[16px] font-medium text-foreground">All quiet</p>
      <p className="text-[13px] text-muted-foreground mt-1">Alerts show up here when ads start showing fatigue signals</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {alerts.map((alert) => {
        const stage = alert.stage as FatigueStage;
        const color = STAGE_COLORS[stage] || "#9ca3af";
        const label = STAGE_LABELS[stage] || alert.stage;
        const bg = STAGE_BG[stage] || "#f8f8f6";
        let parsedSignals: Array<{ name: string; label: string; score: number }> = [];
        try { parsedSignals = JSON.parse(alert.signals); } catch {}

        return (
          <Link key={alert.id} href={`/ad/${alert.adId}`} className="flex items-center gap-4 lv-card p-5 group">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: bg }}>
              <span className="text-[14px] font-bold tabular-nums" style={{ color }}>{alert.fatigueScore}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-medium text-foreground group-hover:text-[#7E69AB] transition-colors truncate">
                  {alert.adName || `Ad ${alert.adId}`}
                </span>
                <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wider" style={{ color, backgroundColor: bg }}>
                  {label}
                </span>
              </div>
              {parsedSignals.length > 0 && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {parsedSignals.filter((s) => s.score > 25).slice(0, 3).map((s) => (
                    <span key={s.name} className="text-[10px] px-2 py-0.5 rounded-full bg-surface text-muted-foreground font-medium">
                      {s.label} {s.score}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span className="text-[11px] text-muted flex-shrink-0 tabular-nums">
              {format(new Date(alert.createdAt), "MMM d, h:mm a")}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
