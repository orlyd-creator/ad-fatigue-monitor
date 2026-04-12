"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";

interface Props {
  data: { date: string; value: number }[];
  label: string; color?: string; prefix?: string; suffix?: string;
  baselineStart?: string; baselineEnd?: string; recentStart?: string; recentEnd?: string;
}

export default function MetricTrendChart({
  data, label, color = "#9b87f5", prefix = "", suffix = "",
  baselineStart, baselineEnd, recentStart, recentEnd,
}: Props) {
  if (data.length === 0) return (
    <div className="lv-card p-5">
      <h4 className="text-[13px] font-semibold text-foreground mb-2">{label}</h4>
      <div className="h-44 flex items-center justify-center text-[13px] text-muted">No data yet</div>
    </div>
  );

  return (
    <div className="lv-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[13px] font-semibold text-foreground">{label}</h4>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>
          {prefix}{data[data.length - 1]?.value?.toFixed(2)}{suffix}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(d: string) => d.slice(5)}
            axisLine={{ stroke: "#E8E8E4" }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} width={45} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ backgroundColor: "white", border: "none", borderRadius: 16, fontSize: 12,
            padding: "10px 14px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
            formatter={(value: number) => [`${prefix}${value.toFixed(2)}${suffix}`, label]}
            labelStyle={{ color: "#9ca3af", fontSize: 11 }} />
          {baselineStart && baselineEnd && (
            <ReferenceArea x1={baselineStart} x2={baselineEnd} fill="#9b87f5" fillOpacity={0.05}
              label={{ value: "Best period", fill: "#9b87f5", fontSize: 9, position: "insideTopLeft" }} />
          )}
          {recentStart && recentEnd && (
            <ReferenceArea x1={recentStart} x2={recentEnd} fill="#f97316" fillOpacity={0.05}
              label={{ value: "Recent", fill: "#f97316", fontSize: 9, position: "insideTopRight" }} />
          )}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false}
            activeDot={{ r: 5, fill: color, stroke: "white", strokeWidth: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
