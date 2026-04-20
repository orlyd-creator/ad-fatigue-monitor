"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

type TopAd = {
  adId: string;
  adName: string;
  campaignName: string;
  thumbnailUrl: string;
  spend: number;
  conversions: number;
  cpConv: number | null;
} | null;

type Props = {
  monthLabel: string;
  thisMonth: {
    spend: number;
    atm: number;
    sqls: number;
    cpl: number | null;
  };
  lastMonthLabel: string;
  deltas: {
    spend: number | null;
    atm: number | null;
    sqls: number | null;
    cpl: number | null;
  };
  trend: Array<{ label: string; spend: number; atm: number; sqls: number; cpl: number }>;
  topAdByConversions: TopAd;
  topAdBySpend: TopAd;
};

function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function DeltaBadge({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct == null) {
    return <span className="text-[12px] text-muted-foreground">no data last month</span>;
  }
  // For CPL, "down" is good (green); for everything else, "up" is good.
  const isPositive = invert ? pct < 0 : pct > 0;
  const isNeutral = Math.abs(pct) < 0.5;
  const color = isNeutral
    ? "text-muted-foreground"
    : isPositive
      ? "text-green-600"
      : "text-red-600";
  const arrow = isNeutral ? "→" : pct > 0 ? "↑" : "↓";
  return (
    <span className={`text-[12px] font-medium ${color}`}>
      {arrow} {Math.abs(pct).toFixed(1)}% vs last month
    </span>
  );
}

function StatCard({
  label,
  value,
  delta,
  invertDelta = false,
}: {
  label: string;
  value: string;
  delta: number | null;
  invertDelta?: boolean;
}) {
  return (
    <div className="lv-card p-6 flex flex-col gap-2">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-[32px] font-bold text-foreground leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <DeltaBadge pct={delta} invert={invertDelta} />
    </div>
  );
}

function TopAdCard({ title, ad, metric }: { title: string; ad: TopAd; metric: "spend" | "conversions" }) {
  if (!ad) {
    return (
      <div className="lv-card p-6">
        <div className="text-[13px] text-muted-foreground font-medium mb-2">{title}</div>
        <div className="text-[14px] text-muted-foreground italic">No data yet this month.</div>
      </div>
    );
  }
  return (
    <div className="lv-card p-6">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium mb-3">{title}</div>
      <div className="flex gap-4">
        {ad.thumbnailUrl ? (
          <img
            src={ad.thumbnailUrl}
            alt=""
            className="w-20 h-20 rounded-xl object-cover border border-border flex-shrink-0"
          />
        ) : (
          <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-[#6B93D8]/20 to-[#D06AB8]/20 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-foreground truncate" title={ad.adName}>{ad.adName}</div>
          <div className="text-[12px] text-muted-foreground truncate mb-2">{ad.campaignName}</div>
          <div className="flex gap-4 text-[13px]">
            <div>
              <span className="text-muted-foreground">Spend</span>{" "}
              <span className="font-semibold text-foreground tabular-nums">{formatMoney(ad.spend)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{metric === "conversions" ? "Conversions" : "Cost/result"}</span>{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {metric === "conversions"
                  ? ad.conversions.toLocaleString()
                  : ad.cpConv != null
                    ? formatMoney(ad.cpConv)
                    : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExecutiveClient({
  monthLabel,
  thisMonth,
  lastMonthLabel,
  deltas,
  trend,
  topAdByConversions,
  topAdBySpend,
}: Props) {
  const hasTrendData = trend.some(t => t.spend > 0 || t.atm > 0);

  return (
    <main className="exec-root max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
            Executive view
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">{monthLabel}</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            Your ad spend, demos booked, and qualified pipeline at a glance.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="exec-no-print flex-shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-medium text-white
            bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8]
            shadow-md shadow-purple-100 hover:shadow-lg transition-all flex items-center gap-2"
          title="Export a PDF you can share with your CEO or attach to an email"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Top 4 stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Ad spend" value={formatMoney(thisMonth.spend)} delta={deltas.spend} />
        <StatCard label="Demos booked" value={thisMonth.atm.toLocaleString()} delta={deltas.atm} />
        <StatCard label="SQLs" value={thisMonth.sqls.toLocaleString()} delta={deltas.sqls} />
        <StatCard
          label="Cost per demo"
          value={thisMonth.cpl != null ? formatMoney(thisMonth.cpl) : "—"}
          delta={deltas.cpl}
          invertDelta
        />
      </div>

      {/* Trend chart */}
      <div className="lv-card p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Six-month trend</h2>
            <p className="text-[12px] text-muted-foreground">Spend, demos booked, and SQLs over time.</p>
          </div>
        </div>
        {hasTrendData ? (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={50} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={50} />
                <Tooltip
                  contentStyle={{
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value: any, name: any) => {
                    if (name === "Spend") return [formatMoney(Number(value)), name];
                    return [Number(value).toLocaleString(), name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Line yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="#6B93D8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line yAxisId="right" type="monotone" dataKey="atm" name="Demos booked" stroke="#9B7ED0" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line yAxisId="right" type="monotone" dataKey="sqls" name="SQLs" stroke="#D06AB8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-[13px] text-muted-foreground italic">
            No trend data yet. Check back after the first month's data syncs.
          </div>
        )}
      </div>

      {/* Top performing ads */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <TopAdCard title="Top ad by demos this month" ad={topAdByConversions} metric="conversions" />
        <TopAdCard title="Biggest spend this month" ad={topAdBySpend} metric="spend" />
      </div>

      <div className="text-[12px] text-muted-foreground leading-relaxed">
        This view strips technical signals (CTR, fatigue scores, engagement rates) and shows the numbers that matter for decision-making.
        Compared to <strong>{lastMonthLabel}</strong>.
      </div>
    </main>
  );
}
