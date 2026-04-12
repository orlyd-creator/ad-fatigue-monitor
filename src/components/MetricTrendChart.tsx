"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface Props {
  data: { date: string; value: number }[];
  label: string; color?: string; prefix?: string; suffix?: string;
  baselineStart?: string; baselineEnd?: string; recentStart?: string; recentEnd?: string;
  warningThreshold?: number;
  dangerThreshold?: number;
  invertThreshold?: boolean; // true = higher is worse (frequency, CPM), false = lower is worse (CTR)
}

export default function MetricTrendChart({
  data, label, color = "#6B93D8", prefix = "", suffix = "",
  warningThreshold, dangerThreshold, invertThreshold = false,
}: Props) {
  if (data.length === 0) return (
    <div className="lv-card p-5">
      <h4 className="text-[13px] font-semibold text-foreground mb-2">{label}</h4>
      <div className="h-44 flex items-center justify-center text-[13px] text-muted">No data yet</div>
    </div>
  );

  const currentValue = data[data.length - 1]?.value ?? 0;
  const firstValue = data[0]?.value ?? 0;
  const changePercent = firstValue > 0 ? ((currentValue - firstValue) / firstValue) * 100 : 0;

  // Determine if change is good or bad
  const isGoodChange = invertThreshold ? changePercent < 0 : changePercent > 0;
  const changeColor = Math.abs(changePercent) < 2 ? "#9ca3af" : isGoodChange ? "#22c55e" : "#ef4444";
  const changeArrow = changePercent > 0 ? "+" : "";

  return (
    <div className="lv-card p-5">
      <div className="flex items-start justify-between mb-1">
        <h4 className="text-[13px] font-semibold text-foreground">{label}</h4>
        <div className="text-right">
          <span className="text-[15px] font-bold tabular-nums" style={{ color }}>
            {prefix}{currentValue.toFixed(2)}{suffix}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-end mb-3">
        <span className="text-[11px] font-medium tabular-nums" style={{ color: changeColor }}>
          {changeArrow}{changePercent.toFixed(1)}% over this period
        </span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(d: string) => {
            const parts = d.split("-");
            return `${parts[1]}/${parts[2]}`;
          }}
            axisLine={{ stroke: "#E8E8E4" }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} width={45} axisLine={false} tickLine={false}
            tickFormatter={(v: number) => `${prefix}${v % 1 === 0 ? v : v.toFixed(1)}${suffix}`} />
          <Tooltip contentStyle={{ backgroundColor: "white", border: "none", borderRadius: 16, fontSize: 12,
            padding: "10px 14px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
            formatter={(value: number) => [`${prefix}${value.toFixed(2)}${suffix}`, label]}
            labelFormatter={(d: string) => {
              const parts = d.split("-");
              return `${parts[1]}/${parts[2]}/${parts[0]}`;
            }}
            labelStyle={{ color: "#9ca3af", fontSize: 11 }} />
          {warningThreshold !== undefined && (
            <ReferenceLine y={warningThreshold} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
          )}
          {dangerThreshold !== undefined && (
            <ReferenceLine y={dangerThreshold} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
          )}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false}
            activeDot={{ r: 5, fill: color, stroke: "white", strokeWidth: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
