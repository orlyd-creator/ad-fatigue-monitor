"use client";

import { useRouter } from "next/navigation";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, LineChart, ReferenceLine, Legend,
} from "recharts";
import type { ForecastResult, DailyPoint } from "@/lib/strategy/forecast";
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
  spendHistory: DailyPoint[];
  atmHistory: DailyPoint[];
  sqlHistory: DailyPoint[];
  cplHistory: DailyPoint[];
  spendForecast: ForecastResult;
  atmForecast: ForecastResult;
  sqlsForecast: ForecastResult;
  cplForecast: ForecastResult;
  outlook: string[];
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

export default function ForecastClient({
  spendHistory, atmHistory, sqlHistory, cplHistory,
  spendForecast, atmForecast, sqlsForecast, cplForecast,
  outlook, atRisk, rising,
}: Props) {
  const router = useRouter();

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-1">
          Forecast
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#F04E80] bg-clip-text text-transparent">
            30-day projection
          </span>
        </h1>
        <p className="text-[13.5px] text-gray-600 mt-1.5 max-w-2xl">
          Projections use linear regression on the last 30 days, weekly seasonality from the last 90, and a widening 80% confidence band as uncertainty grows.
        </p>
      </div>

      {/* Outlook narration */}
      {outlook.length > 0 && (
        <div className="lv-card p-6 relative overflow-hidden">
          <div
            className="absolute top-0 left-0 right-0 h-[3px]"
            style={{ background: "linear-gradient(90deg, #6B93D8, #9B7ED0, #D06AB8, #F04E80)" }}
          />
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#6B93D8]/20 via-[#9B7ED0]/20 to-[#D06AB8]/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-[#7E69AB]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-foreground mb-1">Outlook</h2>
              <ul className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed">
                {outlook.map((line, i) => (
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

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Projected ATMs"
          value={atmForecast.monthEndProjection.toFixed(0)}
          sub="by end of month"
          accent="#6B93D8"
        />
        <SummaryCard
          label="Projected Spend"
          value={formatMoney(spendForecast.monthEndProjection)}
          sub="by end of month"
          accent="#9B7ED0"
        />
        <SummaryCard
          label="Projected SQLs"
          value={sqlsForecast.monthEndProjection.toFixed(0)}
          sub="by end of month"
          accent="#D06AB8"
        />
        <SummaryCard
          label="Projected CPL"
          value={
            cplForecast.points.length > 0
              ? `$${cplForecast.points[cplForecast.points.length - 1].predicted.toFixed(0)}`
              : "-"
          }
          sub="30 days out"
          accent="#F04E80"
        />
      </div>

      {/* CPL projection */}
      <ForecastChart
        title="CPL projection"
        subtitle="Cost per lead trajectory, 30 days out"
        history={cplHistory}
        forecast={cplForecast}
        valueFormatter={(v) => `$${v.toFixed(0)}`}
        color="#D06AB8"
      />

      {/* ATM projection */}
      <ForecastChart
        title="ATM leads projection"
        subtitle="Inbound demos booked, daily + 30-day projection"
        history={atmHistory}
        forecast={atmForecast}
        valueFormatter={(v) => v.toFixed(0)}
        color="#6B93D8"
      />

      {/* Spend projection */}
      <ForecastChart
        title="Spend projection"
        subtitle="Daily Meta spend, 30 days out"
        history={spendHistory}
        forecast={spendForecast}
        valueFormatter={(v) => `$${v.toFixed(0)}`}
        color="#9B7ED0"
      />

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

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="lv-card p-5 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</div>
      <div className="text-[26px] font-semibold tabular-nums text-foreground leading-none">{value}</div>
      <div className="text-[11px] text-gray-400 mt-1">{sub}</div>
    </div>
  );
}

function ForecastChart({
  title, subtitle, history, forecast, valueFormatter, color,
}: {
  title: string;
  subtitle: string;
  history: DailyPoint[];
  forecast: ForecastResult;
  valueFormatter: (v: number) => string;
  color: string;
}) {
  // Merge history + forecast into one chart series
  const historyData: Array<{
    date: string;
    actual?: number;
    predicted?: number;
    lower?: number;
    upper?: number;
  }> = history.slice(-45).map((p) => ({
    date: p.date,
    actual: p.value,
  }));
  const forecastData = forecast.points.map((p) => ({
    date: p.date,
    predicted: p.predicted,
    lower: p.lower,
    upper: p.upper,
  }));
  const data = [...historyData, ...forecastData];
  const forecastStart = forecast.points[0]?.date;

  return (
    <div className="lv-card p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Trend</div>
          <div
            className="text-[13px] font-semibold tabular-nums"
            style={{
              color:
                forecast.slope > 0.05 ? "#F04E80" :
                forecast.slope < -0.05 ? "#059669" : "#7E69AB",
            }}
          >
            {forecast.slope > 0 ? "+" : ""}{valueFormatter(forecast.slope).replace(/[$]/g, "$")}/day
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">R² {forecast.r2.toFixed(2)}</div>
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 10 }}>
            <defs>
              <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => valueFormatter(v)} width={50} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const actual = payload.find((p) => p.dataKey === "actual")?.value as number | undefined;
                const predicted = payload.find((p) => p.dataKey === "predicted")?.value as number | undefined;
                const lower = payload.find((p) => p.dataKey === "lower")?.value as number | undefined;
                const upper = payload.find((p) => p.dataKey === "upper")?.value as number | undefined;
                return (
                  <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 text-[12px]">
                    <div className="font-semibold mb-1">{label}</div>
                    {actual !== undefined && <div>Actual: <span className="font-mono">{valueFormatter(actual)}</span></div>}
                    {predicted !== undefined && (
                      <>
                        <div>Predicted: <span className="font-mono">{valueFormatter(predicted)}</span></div>
                        {lower !== undefined && upper !== undefined && (
                          <div className="text-gray-400">
                            Range: <span className="font-mono">{valueFormatter(lower)} - {valueFormatter(upper)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              }}
            />
            {/* Confidence band */}
            <Area type="monotone" dataKey="upper" stroke="none" fill={color} fillOpacity={0.08} isAnimationActive={false} />
            <Area type="monotone" dataKey="lower" stroke="none" fill="#ffffff" fillOpacity={1} isAnimationActive={false} />
            {/* Actual history line */}
            <Area type="monotone" dataKey="actual" stroke={color} strokeWidth={2} fill={`url(#grad-${title})`} connectNulls={false} />
            {/* Forecast line (dashed) */}
            <Area type="monotone" dataKey="predicted" stroke={color} strokeDasharray="4 4" strokeWidth={2} fill="none" connectNulls={false} />
            {forecastStart && (
              <ReferenceLine x={forecastStart} stroke="#9CA3AF" strokeDasharray="2 2" label={{ value: "Today", fill: "#9CA3AF", fontSize: 10, position: "top" }} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
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
