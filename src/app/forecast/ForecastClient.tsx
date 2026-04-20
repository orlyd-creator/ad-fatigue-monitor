"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
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
}

interface Props {
  forecast: StrategicForecast;
  atRisk: AdProjection[];
  rising: AdProjection[];
}

function formatMoney(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatDelta(n: number, prefix = ""): { label: string; color: string } {
  if (n === 0) return { label: "even", color: "#7E69AB" };
  const sign = n > 0 ? "+" : "";
  return {
    label: `${sign}${prefix}${Math.abs(n).toLocaleString()}`,
    color: n > 0 ? "#059669" : "#dc2626",
  };
}

export default function ForecastClient({ forecast, atRisk, rising }: Props) {
  const router = useRouter();
  const { mtd, lastMonth, pace, budgetCalc, narrative, chart } = forecast;

  // Budget override state (user can tweak remaining budget in the calculator)
  const [budgetOverride, setBudgetOverride] = useState<number | null>(null);
  const [cplOverride, setCplOverride] = useState<number | null>(null);

  const activeBudget = budgetOverride ?? budgetCalc.remainingBudget;
  const activeCpl = cplOverride ?? mtd.cpl ?? lastMonth.cpl ?? 0;
  const whatIfLeads = activeCpl > 0 ? Math.floor(activeBudget / activeCpl) : 0;
  const whatIfTotal = mtd.atmLeads + whatIfLeads;
  const whatIfVsLast = whatIfTotal - lastMonth.atmLeads;

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-1">
          Forecast
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#F04E80] bg-clip-text text-transparent">
            Month-end outlook
          </span>
        </h1>
        <p className="text-[13.5px] text-gray-600 mt-1.5 max-w-2xl">
          Based on your MTD CPL, remaining budget, and {lastMonth.label}'s benchmark. Numbers update as data comes in.
        </p>
      </div>

      {/* Narrative */}
      {narrative.length > 0 && (
        <div className="lv-card p-6 relative overflow-hidden">
          <div
            className="absolute top-0 left-0 right-0 h-[3px]"
            style={{ background: "linear-gradient(90deg, #6B93D8, #9B7ED0, #D06AB8, #F04E80)" }}
          />
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#6B93D8]/20 via-[#9B7ED0]/20 to-[#D06AB8]/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-[#7E69AB]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.354a15.053 15.053 0 01-3 0M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-3.75-9.75l-1.9 9.5a2.25 2.25 0 01-2.2 1.75h-2.3a2.25 2.25 0 01-2.2-1.75l-1.9-9.5m10.5 0c.621 0 1.125-.504 1.125-1.125V4.5A1.125 1.125 0 0018 3.375h-1.5a1.125 1.125 0 00-1.125 1.125v1.125c0 .621.504 1.125 1.125 1.125m-9.75 0h9.75" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Where you're headed</h2>
              <ul className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed">
                {narrative.map((line, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-[#9B7ED0] mt-[5px] text-[8px]">●</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Pace vs last month */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <PaceCard
          label="Projected ATMs"
          value={pace.projectedATM.toString()}
          vsLabel={`${lastMonth.label} ${lastMonth.atmLeads}`}
          delta={pace.deltaATMVsLast}
          sub={`day ${mtd.dayOfMonth} of ${mtd.daysInMonth}`}
          accent="#6B93D8"
        />
        <PaceCard
          label="Projected Spend"
          value={formatMoney(pace.projectedSpend)}
          vsLabel={`${lastMonth.label} ${formatMoney(lastMonth.spend)}`}
          delta={pace.deltaSpendVsLast}
          deltaIsMoney
          sub={`~${formatMoney(budgetCalc.dailyRunRate)}/day pace`}
          accent="#9B7ED0"
        />
        <PaceCard
          label="Projected CPL"
          value={pace.projectedCPL !== null ? `$${pace.projectedCPL.toFixed(0)}` : "-"}
          vsLabel={lastMonth.cpl !== null ? `${lastMonth.label} $${lastMonth.cpl.toFixed(0)}` : ""}
          delta={pace.deltaCPLVsLast ?? 0}
          deltaIsMoney
          invertDelta
          sub={mtd.cpl !== null ? `MTD $${mtd.cpl.toFixed(0)}` : "no leads yet"}
          accent="#D06AB8"
        />
        <PaceCard
          label="Projected SQLs"
          value={pace.projectedSQLs.toString()}
          vsLabel={`${lastMonth.label} ${lastMonth.sqls}`}
          delta={pace.deltaSQLVsLast}
          sub={`${mtd.sqls} so far`}
          accent="#F04E80"
        />
      </div>

      {/* Budget Calculator */}
      <div className="lv-card p-6">
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h2 className="text-[16px] font-semibold text-foreground">Budget calculator</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Remaining budget ÷ CPL = new leads. Tweak the inputs to see what-if.
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Days remaining</div>
            <div className="text-[18px] font-semibold text-foreground tabular-nums">{mtd.daysRemaining}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          <CalcInput
            label="Remaining budget"
            prefix="$"
            value={activeBudget}
            defaultValue={budgetCalc.remainingBudget}
            onChange={(v) => setBudgetOverride(v)}
          />
          <CalcInput
            label="Assumed CPL"
            prefix="$"
            value={activeCpl}
            defaultValue={mtd.cpl ?? lastMonth.cpl ?? 0}
            onChange={(v) => setCplOverride(v)}
          />
          <div className="rounded-xl bg-gradient-to-br from-[#6B93D8]/10 via-[#9B7ED0]/10 to-[#D06AB8]/15 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">New leads this budget buys</div>
            <div className="text-[28px] font-semibold text-foreground tabular-nums leading-none mt-1">
              {whatIfLeads.toLocaleString()}
            </div>
            <div className="text-[11px] text-gray-500 mt-1.5">
              month-end total: <span className="font-semibold text-foreground tabular-nums">{whatIfTotal}</span>
              {lastMonth.atmLeads > 0 && (
                <span className="ml-1.5" style={{ color: whatIfVsLast >= 0 ? "#059669" : "#dc2626" }}>
                  ({whatIfVsLast >= 0 ? "+" : ""}{whatIfVsLast} vs {lastMonth.label})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Preset scenarios */}
        {budgetCalc.scenarios.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Scenarios</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {budgetCalc.scenarios.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    setCplOverride(s.cpl);
                    setBudgetOverride(null);
                  }}
                  className="text-left rounded-xl border border-gray-100 bg-white/60 hover:bg-white hover:border-[#9B7ED0]/40 transition-colors p-3"
                >
                  <div className="text-[11px] text-gray-500">{s.label}</div>
                  <div className="text-[13px] font-semibold text-foreground tabular-nums mt-0.5">
                    ${s.cpl.toFixed(0)} CPL
                  </div>
                  <div className="text-[11px] text-gray-600 mt-1">
                    +{s.newLeads} leads ({s.totalLeads} total)
                    {lastMonth.atmLeads > 0 && (
                      <span className="ml-1" style={{ color: s.vsLastMonth >= 0 ? "#059669" : "#dc2626" }}>
                        {s.vsLastMonth >= 0 ? "+" : ""}{s.vsLastMonth}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Running MTD CPL chart */}
      {chart.cplMTD.length > 0 && (
        <div className="lv-card p-6">
          <h2 className="text-[15px] font-semibold text-foreground">CPL trend (running month-to-date)</h2>
          <p className="text-[12px] text-gray-500 mt-0.5 mb-4">
            Each point is cumulative spend ÷ cumulative ATMs through that day. Smooths daily noise, shows true trajectory.
          </p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[...chart.cplMTD, ...chart.projectedCplPath.map(p => ({ date: p.date, value: p.predicted, projected: true }))]}
                margin={{ top: 5, right: 10, left: 0, bottom: 10 }}
              >
                <defs>
                  <linearGradient id="grad-mtd-cpl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D06AB8" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#D06AB8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} width={50} />
                <Tooltip
                  content={({ payload, label }) => {
                    if (!payload?.length) return null;
                    const v = payload[0].value as number;
                    const projected = payload[0].payload?.projected;
                    return (
                      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 text-[12px]">
                        <div className="font-semibold mb-1">{label}</div>
                        <div>{projected ? "Projected CPL" : "Running CPL"}: <span className="font-mono">${v.toFixed(2)}</span></div>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="value" stroke="#D06AB8" strokeWidth={2} fill="url(#grad-mtd-cpl)" />
                {lastMonth.cpl !== null && (
                  <ReferenceLine
                    y={lastMonth.cpl}
                    stroke="#9B7ED0"
                    strokeDasharray="4 4"
                    label={{ value: `${lastMonth.label} $${lastMonth.cpl.toFixed(0)}`, fill: "#7E69AB", fontSize: 10, position: "right" }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* At-risk + Rising */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AdListCard
          title="At risk of fatiguing"
          subtitle="Highest-spend ads projected to fatigue soon"
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
    </main>
  );
}

function PaceCard({
  label, value, vsLabel, delta, deltaIsMoney, invertDelta, sub, accent,
}: {
  label: string;
  value: string;
  vsLabel: string;
  delta: number;
  deltaIsMoney?: boolean;
  invertDelta?: boolean;
  sub: string;
  accent: string;
}) {
  // For CPL / cost-per-X, "down is good" -- so invertDelta flips the color logic.
  const goodDir = invertDelta ? delta < 0 : delta > 0;
  const color = delta === 0 ? "#7E69AB" : goodDir ? "#059669" : "#dc2626";
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const absDelta = Math.abs(delta);
  const deltaStr = deltaIsMoney
    ? `${sign}$${absDelta.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `${sign}${absDelta.toLocaleString()}`;

  return (
    <div className="lv-card p-5 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</div>
      <div className="text-[26px] font-semibold tabular-nums text-foreground leading-none">{value}</div>
      <div className="text-[11px] text-gray-400 mt-1.5">{sub}</div>
      {vsLabel && (
        <div className="flex items-baseline gap-1.5 mt-2 pt-2 border-t border-gray-100">
          <span className="text-[10px] text-gray-500">{vsLabel}</span>
          <span className="text-[10px] font-semibold ml-auto" style={{ color }}>{deltaStr}</span>
        </div>
      )}
    </div>
  );
}

function CalcInput({
  label, prefix, value, defaultValue, onChange,
}: {
  label: string;
  prefix?: string;
  value: number;
  defaultValue: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1">
        {prefix && <span className="text-[16px] text-gray-400">{prefix}</span>}
        <input
          type="number"
          value={Math.round(value)}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            onChange(isNaN(parsed) ? null : parsed);
          }}
          className="w-full text-[22px] font-semibold tabular-nums text-foreground bg-transparent border-none outline-none focus:ring-0 p-0"
        />
      </div>
      <button
        onClick={() => onChange(null)}
        className="text-[10px] text-gray-400 hover:text-gray-700 mt-1"
      >
        reset to ${Math.round(defaultValue).toLocaleString()}
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
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      <p className="text-[12px] text-gray-500 mt-0.5 mb-4">{subtitle}</p>
      {ads.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-6 text-center">
          {mode === "risk" ? "No at-risk ads right now." : "No clear scale candidates yet."}
        </div>
      ) : (
        <div className="space-y-2">
          {ads.map((ad) => (
            <button
              key={ad.id}
              onClick={() => onClick(ad.id)}
              className="w-full text-left p-3 rounded-xl border border-gray-100 bg-white/60 hover:bg-white hover:border-gray-200 transition-colors flex items-center gap-3"
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
                {mode === "risk" ? (
                  <>
                    <div className="text-[13px] font-semibold tabular-nums" style={{ color: STAGE_COLORS[ad.stage] }}>
                      {ad.fatigueScore}/100
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {ad.predictedDaysToFatigue !== null
                        ? `~${ad.predictedDaysToFatigue}d to fatigue`
                        : `${formatMoney(ad.monthSpend)} this mo`}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[13px] font-semibold tabular-nums text-[#059669]">
                      {formatMoney(ad.monthSpend)}
                    </div>
                    <div className="text-[10px] text-gray-400">fatigue {ad.fatigueScore}/100</div>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
