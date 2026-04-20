"use client";

import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from "recharts";
import type { StrategicForecast } from "@/lib/strategy/forecast";
import type { FatigueStage } from "@/lib/fatigue/types";
import { STAGE_COLORS } from "@/lib/fatigue/types";

interface AdProjection {
  id: string;
  adName: string;
  campaignName: string;
  fatigueScore: number;
  stage: FatigueStage;
  predictedDaysToFatigue: number | null;
  fatigueVelocity: number;
  monthSpend: number;
  projectedEomSpend?: number;
}

interface BudgetBreakdown {
  total: number;
  currency: string;
  campaigns: Array<{
    id: string;
    name: string;
    dailyBudget: number;
    status: string;
    source: "campaign" | "adset-sum";
  }>;
}

interface Props {
  forecast: StrategicForecast;
  atRisk: AdProjection[];
  rising: AdProjection[];
  budgetBreakdown: BudgetBreakdown | null;
}

function fmtMoney(n: number, sig = 0): string {
  if (n === 0) return "$0";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(sig)}`;
}
function fmtMoneyFull(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function ForecastClient({ forecast, atRisk, rising, budgetBreakdown }: Props) {
  const router = useRouter();
  const { mtd, lastMonth, pace, budgetCalc, narrative, chart } = forecast;

  // Calculator state. Scenarios set these via click.
  const [budget, setBudget] = useState<number>(budgetCalc.remainingBudget);
  const [cpl, setCpl] = useState<number>(mtd.cpl ?? lastMonth.cpl ?? 0);

  const newLeads = cpl > 0 ? Math.floor(budget / cpl) : 0;
  const totalLeads = mtd.atmLeads + newLeads;
  const vsLast = totalLeads - lastMonth.atmLeads;

  // Chart data: real MTD series + projected continuation. Separate dataKeys
  // for actual vs projected so we can style them differently.
  const chartData = useMemo(() => {
    const merged = [
      ...chart.cplMTD.map((p) => ({ date: p.date, actual: p.value, projected: undefined as number | undefined })),
      ...chart.projectedCplPath.map((p) => ({ date: p.date, actual: undefined, projected: p.predicted })),
    ];
    return merged;
  }, [chart.cplMTD, chart.projectedCplPath]);

  const firstProjectedDate = chart.projectedCplPath[0]?.date;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap animate-fade-in">
        <div>
          <div className="display-label mb-1.5">Forecast</div>
          <h1 className="display-heading mb-1.5">
            <span className="gradient-text">Month-end outlook</span>
          </h1>
          <p className="text-[13.5px] text-gray-600 max-w-xl">
            Anchored to your real MTD CPL, live Meta budget caps, and {lastMonth.label}'s benchmark.
          </p>
        </div>
        {budgetBreakdown && (
          <div className="rounded-2xl border border-gray-100 bg-white/70 px-4 py-3 text-right shadow-sm">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Meta daily cap</div>
            <div className="text-[20px] font-semibold tabular-nums">
              {fmtMoneyFull(budgetBreakdown.total)}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              across {budgetBreakdown.campaigns.length} active campaign{budgetBreakdown.campaigns.length === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>

      {/* Narrative */}
      {narrative.length > 0 && (
        <div className="lv-card p-6 relative overflow-hidden">
          <div
            className="absolute top-0 left-0 right-0 h-[3px]"
            style={{ background: "linear-gradient(90deg, #6B93D8, #9B7ED0, #D06AB8, #F04E80)" }}
          />
          <h2 className="text-[14px] font-semibold text-foreground mb-2.5">Outlook</h2>
          <ul className="space-y-1.5 text-[13.5px] text-gray-800 leading-relaxed">
            {narrative.map((line, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-[#9B7ED0] mt-[7px] text-[6px]">●</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Month-end projection cards */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-foreground">
            Projected month-end (day {mtd.dayOfMonth} of {mtd.daysInMonth})
          </h2>
          <div className="text-[11px] text-gray-500">
            {budgetCalc.budgetSource === "meta" ? "Based on live Meta budget" : "Based on current run-rate"}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ProjCard
            label="ATM leads"
            now={mtd.atmLeads}
            projected={pace.projectedATM}
            benchmark={lastMonth.atmLeads}
            benchmarkLabel={lastMonth.label}
            accent="#6B93D8"
          />
          <ProjCard
            label="Spend"
            now={mtd.spend}
            projected={pace.projectedSpend}
            benchmark={lastMonth.spend}
            benchmarkLabel={lastMonth.label}
            accent="#9B7ED0"
            format="money"
          />
          <ProjCard
            label="CPL"
            now={mtd.cpl ?? 0}
            projected={pace.projectedCPL ?? 0}
            benchmark={lastMonth.cpl ?? 0}
            benchmarkLabel={lastMonth.label}
            accent="#D06AB8"
            format="money"
            invertDelta
          />
          <ProjCard
            label="SQLs"
            now={mtd.sqls}
            projected={pace.projectedSQLs}
            benchmark={lastMonth.sqls}
            benchmarkLabel={lastMonth.label}
            accent="#F04E80"
          />
        </div>
      </section>

      {/* CPL trend chart with explicit EOM projection callout */}
      {chartData.length > 0 && (
        <div className="lv-card p-6">
          <div className="flex items-baseline justify-between mb-1 flex-wrap gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-foreground">CPL trajectory, month-to-date</h2>
              <p className="text-[12px] text-gray-500 mt-0.5">
                Running total: cumulative spend ÷ cumulative ATMs through each day.
              </p>
            </div>
            {/* BIG explicit EOM projection callout — answers 'so what's the projected CPL?' */}
            <div className="flex items-center gap-4">
              {mtd.cpl !== null && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Today's CPL</div>
                  <div className="text-[20px] font-semibold tabular-nums text-[#D06AB8] leading-none">
                    ${mtd.cpl.toFixed(0)}
                  </div>
                </div>
              )}
              <div className="w-px h-10 bg-gray-200" />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Projected EOM CPL</div>
                <div className="text-[20px] font-semibold tabular-nums leading-none" style={{ color: pace.projectedCPL !== null ? "#7E69AB" : "#9CA3AF" }}>
                  {pace.projectedCPL !== null ? `$${pace.projectedCPL.toFixed(0)}` : "—"}
                </div>
                {lastMonth.cpl !== null && pace.projectedCPL !== null && (
                  <div className="text-[10px] mt-0.5" style={{ color: pace.projectedCPL < lastMonth.cpl ? "#059669" : pace.projectedCPL > lastMonth.cpl ? "#dc2626" : "#7E69AB" }}>
                    {pace.projectedCPL < lastMonth.cpl ? "↓" : pace.projectedCPL > lastMonth.cpl ? "↑" : ""} vs {lastMonth.label} ${lastMonth.cpl.toFixed(0)}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] mb-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-[2px] rounded-full bg-[#D06AB8]" />
              <span className="text-gray-600">Actual (so far)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-[2px] rounded-full border-t-2 border-dashed border-[#D06AB8]" />
              <span className="text-gray-600">Projected (flat at today's rate)</span>
            </span>
            {lastMonth.cpl !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-[2px] rounded-full bg-[#9B7ED0]" />
                <span className="text-gray-600">{lastMonth.label} final CPL</span>
              </span>
            )}
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 10 }}>
                <defs>
                  <linearGradient id="grad-actual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D06AB8" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#D06AB8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} width={50} />
                <Tooltip
                  content={({ payload, label }) => {
                    if (!payload?.length) return null;
                    const actual = payload.find((p) => p.dataKey === "actual")?.value as number | undefined;
                    const proj = payload.find((p) => p.dataKey === "projected")?.value as number | undefined;
                    return (
                      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-2.5 text-[12px]">
                        <div className="font-semibold mb-1">{label}</div>
                        {actual !== undefined && (
                          <div className="text-[#D06AB8]">Actual CPL <span className="font-mono ml-1">${actual.toFixed(0)}</span></div>
                        )}
                        {proj !== undefined && (
                          <div className="text-gray-500">Projected <span className="font-mono ml-1">${proj.toFixed(0)}</span></div>
                        )}
                      </div>
                    );
                  }}
                />
                {/* Actual MTD line - solid, filled */}
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="#D06AB8"
                  strokeWidth={2.5}
                  fill="url(#grad-actual)"
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {/* Projected line - dashed, no fill */}
                <Area
                  type="monotone"
                  dataKey="projected"
                  stroke="#D06AB8"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  fill="none"
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {firstProjectedDate && (
                  <ReferenceLine
                    x={firstProjectedDate}
                    stroke="#9CA3AF"
                    strokeDasharray="2 2"
                    label={{ value: "Today", fill: "#9CA3AF", fontSize: 10, position: "top" }}
                  />
                )}
                {lastMonth.cpl !== null && (
                  <ReferenceLine
                    y={lastMonth.cpl}
                    stroke="#9B7ED0"
                    strokeDasharray="4 4"
                    label={{
                      value: `${lastMonth.label} avg $${lastMonth.cpl.toFixed(0)}`,
                      fill: "#7E69AB",
                      fontSize: 10,
                      position: "insideRight",
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Budget calculator */}
      <div className="lv-card p-6">
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">Budget calculator</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Tweak remaining budget or assumed CPL. Scenarios below auto-fill both.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span>{mtd.daysRemaining} days remaining</span>
            {budgetBreakdown && budgetBreakdown.total > 0 && (
              <span>· Meta cap <span className="font-semibold text-foreground">{fmtMoneyFull(budgetBreakdown.total)}/day</span></span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <NumberBox
            label="Remaining budget"
            prefix="$"
            value={budget}
            onChange={setBudget}
            resetValue={budgetCalc.remainingBudget}
            resetLabel={`reset to ${fmtMoneyFull(budgetCalc.remainingBudget)} (${budgetCalc.budgetSource === "meta" ? "Meta cap" : "run-rate"})`}
          />
          <NumberBox
            label="Assumed CPL"
            prefix="$"
            value={cpl}
            onChange={setCpl}
            resetValue={mtd.cpl ?? lastMonth.cpl ?? 0}
            resetLabel={mtd.cpl ? `reset to MTD $${mtd.cpl.toFixed(0)}` : `reset to ${lastMonth.label} $${(lastMonth.cpl ?? 0).toFixed(0)}`}
          />
          <div className="rounded-2xl bg-gradient-to-br from-[#6B93D8]/10 via-[#9B7ED0]/10 to-[#D06AB8]/15 border border-[#9B7ED0]/20 p-4 flex flex-col justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500">New leads this buys</div>
              <div className="text-[28px] font-semibold text-foreground tabular-nums leading-none mt-1">
                {newLeads.toLocaleString()}
              </div>
            </div>
            <div className="text-[11px] text-gray-600 mt-2">
              month-end <span className="font-semibold text-foreground tabular-nums">{totalLeads}</span> total
              {lastMonth.atmLeads > 0 && (
                <span className="ml-1" style={{ color: vsLast >= 0 ? "#059669" : "#dc2626" }}>
                  ({vsLast >= 0 ? "+" : ""}{vsLast} vs {lastMonth.label})
                </span>
              )}
            </div>
          </div>
        </div>

        {budgetCalc.scenarios.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Scenarios, click to apply</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {budgetCalc.scenarios.map((s) => {
                const isActive = Math.abs(cpl - s.cpl) < 0.5;
                return (
                  <button
                    key={s.label}
                    onClick={() => {
                      setCpl(s.cpl);
                      setBudget(budgetCalc.remainingBudget);
                    }}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      isActive
                        ? "border-[#9B7ED0] bg-gradient-to-br from-[#6B93D8]/10 via-[#9B7ED0]/10 to-[#D06AB8]/10 shadow-sm"
                        : "border-gray-100 bg-white/60 hover:bg-white hover:border-[#9B7ED0]/40"
                    }`}
                  >
                    <div className="text-[11px] text-gray-600">{s.label}</div>
                    <div className="text-[14px] font-semibold text-foreground tabular-nums mt-0.5">
                      ${s.cpl.toFixed(0)} CPL
                    </div>
                    <div className="text-[11px] text-gray-700 mt-1 flex items-baseline gap-1.5">
                      <span className="font-semibold">+{s.newLeads}</span>
                      <span className="text-gray-400">new</span>
                      {lastMonth.atmLeads > 0 && (
                        <span className="ml-auto text-[10px]" style={{ color: s.vsLastMonth >= 0 ? "#059669" : "#dc2626" }}>
                          {s.vsLastMonth >= 0 ? "+" : ""}{s.vsLastMonth}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Budget breakdown by campaign */}
      {budgetBreakdown && budgetBreakdown.campaigns.length > 0 && (
        <div className="lv-card p-6">
          <h2 className="text-[14px] font-semibold text-foreground mb-1">
            Live Meta budget by campaign
          </h2>
          <p className="text-[12px] text-gray-500 mb-4">
            Fetched directly from Meta. If you change a budget there, it reflects here within 5 minutes.
          </p>
          <div className="space-y-1.5">
            {[...budgetBreakdown.campaigns]
              .sort((a, b) => b.dailyBudget - a.dailyBudget)
              .map((c) => {
                const pct = budgetBreakdown.total > 0 ? (c.dailyBudget / budgetBreakdown.total) * 100 : 0;
                return (
                  <div key={c.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-foreground truncate">{c.name}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {c.source === "campaign" ? "campaign budget (CBO)" : "sum of ad-set budgets"}
                      </div>
                    </div>
                    <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: "linear-gradient(90deg, #6B93D8, #9B7ED0, #D06AB8)",
                        }}
                      />
                    </div>
                    <div className="text-[13px] font-semibold tabular-nums text-foreground w-20 text-right flex-shrink-0">
                      {fmtMoneyFull(c.dailyBudget)}/d
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Per-ad EOM projections */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-foreground">Per-ad month-end projections</h2>
          <div className="text-[11px] text-gray-500">
            Based on each ad's own spend pace, not account-wide.
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AdListCard
            title="At risk of fatiguing"
            subtitle="Highest MTD spend + fatigue signal"
            ads={atRisk}
            mode="risk"
            onClick={(id) => router.push(`/ad/${id}`)}
          />
          <AdListCard
            title="Scale candidates"
            subtitle="Healthy fatigue + real spend, room to push"
            ads={rising}
            mode="rising"
            onClick={(id) => router.push(`/ad/${id}`)}
          />
        </div>
      </section>
    </main>
  );
}

function ProjCard({
  label, now, projected, benchmark, benchmarkLabel, accent, format, invertDelta,
}: {
  label: string;
  now: number;
  projected: number;
  benchmark: number;
  benchmarkLabel: string;
  accent: string;
  format?: "money";
  invertDelta?: boolean;
}) {
  const delta = projected - benchmark;
  const goodDir = invertDelta ? delta < 0 : delta > 0;
  const color = benchmark === 0 || delta === 0 ? "#7E69AB" : goodDir ? "#059669" : "#dc2626";
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const absDelta = Math.abs(delta);
  const deltaStr = format === "money"
    ? `${sign}$${absDelta.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `${sign}${absDelta.toLocaleString()}`;
  const fmt = format === "money" ? (v: number) => fmtMoneyFull(v) : (v: number) => v.toLocaleString();
  const pct = benchmark > 0 ? (delta / benchmark) * 100 : 0;

  return (
    <div className="lv-card p-4 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-[24px] font-semibold tabular-nums text-foreground leading-none">{fmt(projected)}</div>
      <div className="text-[11px] text-gray-500 mt-1">
        so far: <span className="font-medium text-foreground tabular-nums">{fmt(now)}</span>
      </div>
      {benchmark > 0 && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
          <span className="text-[10px] text-gray-500">vs {benchmarkLabel} {fmt(benchmark)}</span>
          <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>
            {deltaStr} <span className="font-normal text-gray-400 ml-0.5">({pct >= 0 ? "+" : ""}{pct.toFixed(0)}%)</span>
          </span>
        </div>
      )}
    </div>
  );
}

function NumberBox({
  label, prefix, value, onChange, resetValue, resetLabel,
}: {
  label: string;
  prefix?: string;
  value: number;
  onChange: (v: number) => void;
  resetValue: number;
  resetLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 p-4 bg-white/40">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1">
        {prefix && <span className="text-[16px] text-gray-400">{prefix}</span>}
        <input
          type="number"
          value={Math.round(value)}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            onChange(isNaN(parsed) ? 0 : parsed);
          }}
          className="w-full text-[22px] font-semibold tabular-nums text-foreground bg-transparent border-none outline-none focus:ring-0 p-0"
        />
      </div>
      <button
        onClick={() => onChange(resetValue)}
        className="text-[10px] text-gray-400 hover:text-foreground mt-1 truncate max-w-full"
        title={resetLabel}
      >
        {resetLabel}
      </button>
    </div>
  );
}

function AdListCard({
  title, subtitle, ads, mode, onClick,
}: {
  title: string;
  subtitle: string;
  ads: AdProjection[];
  mode: "risk" | "rising";
  onClick: (id: string) => void;
}) {
  return (
    <div className="lv-card p-6">
      <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
      <p className="text-[12px] text-gray-500 mt-0.5 mb-3">{subtitle}</p>
      {ads.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-6 text-center">
          {mode === "risk" ? "No at-risk ads right now." : "No clear scale candidates yet."}
        </div>
      ) : (
        <div className="space-y-1.5">
          {ads.map((ad) => (
            <button
              key={ad.id}
              onClick={() => onClick(ad.id)}
              className="w-full text-left p-2.5 rounded-xl border border-gray-100 bg-white/60 hover:bg-white hover:border-gray-200 transition-colors flex items-center gap-3"
            >
              <div
                className="w-1 self-stretch rounded-full"
                style={{ background: STAGE_COLORS[ad.stage] || "#9CA3AF" }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{truncate(ad.adName, 42)}</div>
                <div className="text-[11px] text-gray-500 truncate">{truncate(ad.campaignName, 42)}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[12px] tabular-nums text-gray-500">
                  {fmtMoneyFull(ad.monthSpend)} / <span className="text-foreground font-semibold">{fmtMoneyFull(ad.projectedEomSpend ?? ad.monthSpend)}</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {mode === "risk" ? (
                    <>
                      fatigue <span style={{ color: STAGE_COLORS[ad.stage] }}>{ad.fatigueScore}/100</span>
                      {ad.predictedDaysToFatigue !== null && (
                        <span className="ml-1">· ~{ad.predictedDaysToFatigue}d</span>
                      )}
                    </>
                  ) : (
                    <>fatigue {ad.fatigueScore}/100</>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
