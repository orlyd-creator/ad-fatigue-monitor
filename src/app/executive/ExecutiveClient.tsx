"use client";

import { useRouter } from "next/navigation";
import DateRangePicker from "@/components/DateRangePicker";
import QuickPresets from "@/components/QuickPresets";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar,
} from "recharts";

type TopAd = {
  adId: string;
  adName: string;
  campaignName: string;
  thumbnailUrl: string;
  spend: number;
  conversions: number;
  cpConv: number | null;
} | null;

type Campaign = {
  name: string;
  spend: number;
  conversions: number;
  costPerConv: number | null;
};

type MonthRow = {
  label: string;
  spend: number;
  atm: number;
  sqls: number;
  cpl: number;
  costPerSQL: number;
};

type TrendRow = MonthRow & { sqlRate: number };

type Props = {
  basePath?: string;
  monthLabel: string;
  rangeLabel: string;
  rangeFrom: string;
  rangeTo: string;
  preset: string;
  presets: Record<string, { from: string; to: string }>;
  thisMonth: { spend: number; atm: number; sqls: number; cpl: number | null };
  lastMonthLabel: string;
  deltas: {
    spend: number | null;
    atm: number | null;
    sqls: number | null;
    cpl: number | null;
  };
  rangeTotals: {
    spend: number;
    atm: number;
    sqls: number;
    cpl: number | null;
    costPerSQL: number | null;
  };
  trend: TrendRow[];
  monthlyTable: MonthRow[];
  topCampaigns: Campaign[];
  topAdByConversions: TopAd;
  topAdBySpend: TopAd;
};

function formatMoney(n: number): string {
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function DeltaBadge({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct == null) return <span className="text-[12px] text-muted-foreground">no data last month</span>;
  const isPositive = invert ? pct < 0 : pct > 0;
  const isNeutral = Math.abs(pct) < 0.5;
  const color = isNeutral ? "text-muted-foreground" : isPositive ? "text-green-600" : "text-red-600";
  const arrow = isNeutral ? "→" : pct > 0 ? "↑" : "↓";
  return (
    <span className={`text-[12px] font-medium ${color}`}>
      {arrow} {Math.abs(pct).toFixed(1)}% vs last month
    </span>
  );
}

function StatCard({
  label, value, delta, invertDelta = false,
}: { label: string; value: string; delta: number | null; invertDelta?: boolean }) {
  return (
    <div className="lv-card p-6 flex flex-col gap-2">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-[32px] font-bold text-foreground leading-none tracking-tight tabular-nums">{value}</div>
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
          <img src={ad.thumbnailUrl} alt="" className="w-20 h-20 rounded-xl object-cover border border-border flex-shrink-0" />
        ) : (
          <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-[#6B93D8]/20 to-[#D06AB8]/20 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-foreground truncate" title={ad.adName}>{ad.adName}</div>
          <div className="text-[12px] text-muted-foreground truncate mb-2">{ad.campaignName}</div>
          <div className="flex gap-4 text-[13px]">
            <div><span className="text-muted-foreground">Spend</span>{" "}<span className="font-semibold text-foreground tabular-nums">{formatMoney(ad.spend)}</span></div>
            <div><span className="text-muted-foreground">{metric === "conversions" ? "Conversions" : "Cost/result"}</span>{" "}<span className="font-semibold text-foreground tabular-nums">{metric === "conversions" ? ad.conversions.toLocaleString() : ad.cpConv != null ? formatMoney(ad.cpConv) : "-"}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExecutiveClient({
  basePath = "/executive",
  monthLabel, rangeLabel, rangeFrom, rangeTo, preset, presets,
  thisMonth, lastMonthLabel, deltas, rangeTotals,
  trend, monthlyTable, topCampaigns,
  topAdByConversions, topAdBySpend,
}: Props) {
  const router = useRouter();
  const hasTrendData = trend.some(t => t.spend > 0 || t.atm > 0);

  const applyPreset = (key: string) => {
    const p = presets[key];
    if (!p) return;
    router.push(`${basePath}?preset=${key}&from=${p.from}&to=${p.to}`);
  };
  const applyCustom = (from: string, to: string) => {
    if (!from || !to) return;
    router.push(`${basePath}?preset=custom&from=${from}&to=${to}`);
  };

  return (
    <main className="exec-root max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap animate-fade-in">
        <div>
          <div className="display-label mb-1.5">Executive view</div>
          <h1 className="display-heading mb-1.5">{rangeLabel}</h1>
          <p className="text-[13.5px] text-muted-foreground">
            Ad spend, demos booked, and SQLs for the selected period.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="exec-no-print flex-shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-medium text-white bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] shadow-md shadow-purple-100 hover:shadow-lg transition-all flex items-center gap-2"
          title="Save as PDF, use your browser's print dialog"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Quick presets + custom range dropdown */}
      <div className="exec-no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <QuickPresets />
        <DateRangePicker />
      </div>

      {/* Range-wide totals (the headline for the entire selected period) */}
      <div className="lv-card p-6 mb-6 bg-gradient-to-br from-[#6B93D8]/10 via-[#9B7ED0]/10 to-[#D06AB8]/10">
        <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium mb-3">Period totals</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Ad spend</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">{formatMoney(rangeTotals.spend)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Demos</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">{rangeTotals.atm.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">SQLs</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">{rangeTotals.sqls.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Cost per demo</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">{rangeTotals.cpl != null ? formatMoney(rangeTotals.cpl) : "-"}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Cost per SQL</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">{rangeTotals.costPerSQL != null ? formatMoney(rangeTotals.costPerSQL) : "-"}</div>
          </div>
        </div>
      </div>

      {/* This-month stat cards (for MoM deltas) */}
      <div className="mb-2">
        <div className="text-[13px] font-semibold text-foreground">This month ({monthLabel})</div>
        <div className="text-[12px] text-muted-foreground">Compared to {lastMonthLabel}</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Ad spend" value={formatMoney(thisMonth.spend)} delta={deltas.spend} />
        <StatCard label="Demos booked" value={thisMonth.atm.toLocaleString()} delta={deltas.atm} />
        <StatCard label="SQLs" value={thisMonth.sqls.toLocaleString()} delta={deltas.sqls} />
        <StatCard label="Cost per demo" value={thisMonth.cpl != null ? formatMoney(thisMonth.cpl) : "-"} delta={deltas.cpl} invertDelta />
      </div>

      {/* Main trend chart */}
      <div className="lv-card p-6 mb-6">
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-foreground">Spend, demos + SQLs trend</h2>
          <p className="text-[12px] text-muted-foreground">Monthly totals over the selected period.</p>
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
                  contentStyle={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px" }}
                  formatter={(value: any, name: any) => name === "Spend" ? [formatMoney(Number(value)), name] : [Number(value).toLocaleString(), name]}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Line yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="#6B93D8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line yAxisId="right" type="monotone" dataKey="atm" name="Demos booked" stroke="#9B7ED0" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line yAxisId="right" type="monotone" dataKey="sqls" name="SQLs" stroke="#D06AB8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-[13px] text-muted-foreground italic">No data for this range yet.</div>
        )}
      </div>

      {/* Efficiency charts, CPL + Cost per SQL + SQL rate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="lv-card p-6">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-foreground">Cost per demo over time</h2>
            <p className="text-[12px] text-muted-foreground">Lower is better.</p>
          </div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => formatMoney(Number(v))} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px" }}
                  formatter={(value: any) => [formatMoney(Number(value)), "Cost per demo"]}
                />
                <Line type="monotone" dataKey="cpl" stroke="#F04E80" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="lv-card p-6">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-foreground">Demo → SQL conversion rate</h2>
            <p className="text-[12px] text-muted-foreground">% of demos that became SQLs (same month). Higher is better.</p>
          </div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px" }}
                  formatter={(value: any) => [`${Number(value).toFixed(1)}%`, "SQL rate"]}
                />
                <Line type="monotone" dataKey="sqlRate" stroke="#9B7ED0" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top campaigns */}
      <div className="lv-card p-6 mb-6">
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-foreground">Top campaigns by spend</h2>
          <p className="text-[12px] text-muted-foreground">Where your budget is going this period.</p>
        </div>
        {topCampaigns.length === 0 ? (
          <div className="text-[13px] text-muted-foreground italic">No campaign data for this range.</div>
        ) : (
          <div style={{ width: "100%", height: Math.max(200, topCampaigns.length * 50) }}>
            <ResponsiveContainer>
              <BarChart data={topCampaigns} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatMoney(Number(v))} />
                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px" }}
                  formatter={(value: any, name: any) => name === "spend" ? [formatMoney(Number(value)), "Spend"] : [Number(value).toLocaleString(), name]}
                />
                <Bar dataKey="spend" fill="#9B7ED0" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Monthly comparison table */}
      <div className="lv-card p-6 mb-6 overflow-x-auto">
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-foreground">Month-by-month summary</h2>
          <p className="text-[12px] text-muted-foreground">Full detail for export / sharing.</p>
        </div>
        <table className="w-full min-w-[600px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 font-medium text-muted-foreground">Month</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Spend</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Demos</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">SQLs</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Cost / demo</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Cost / SQL</th>
            </tr>
          </thead>
          <tbody>
            {monthlyTable.map(row => (
              <tr key={row.label} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-4 font-medium text-foreground">{row.label}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(row.spend)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{row.atm.toLocaleString()}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{row.sqls.toLocaleString()}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{row.atm > 0 ? formatMoney(row.cpl) : "-"}</td>
                <td className="py-2 text-right tabular-nums">{row.sqls > 0 ? formatMoney(row.costPerSQL) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top ads */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <TopAdCard title="Top ad by demos this month" ad={topAdByConversions} metric="conversions" />
        <TopAdCard title="Biggest spend this month" ad={topAdBySpend} metric="spend" />
      </div>

      <div className="text-[12px] text-muted-foreground leading-relaxed">
        This view strips technical signals (CTR, fatigue scores, engagement rates) and shows the numbers that matter for decision-making.
      </div>
    </main>
  );
}
