"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = {
  priority: "high" | "medium" | "low";
  type: "pause" | "scale" | "new-adset" | "creative-test" | "optimization-event" | "budget-shift" | "audience" | "other";
  text: string;
};

type Recommendation = {
  campaignName: string;
  currentCpl: number | null;
  targetCpl: number | null;
  headline: string;
  actions: Action[];
};

type Response = {
  range: string;
  rangeStart: string;
  rangeEnd: string;
  generatedAt: number;
  snapshotsUsed?: number;
  recommendations: Recommendation[];
  note?: string;
  error?: string;
  needsCredits?: boolean;
};

const PRIORITY_COLORS: Record<Action["priority"], string> = {
  high: "bg-rose-50 text-rose-700 ring-rose-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

const TYPE_LABELS: Record<Action["type"], string> = {
  pause: "Pause",
  scale: "Scale",
  "new-adset": "New adset",
  "creative-test": "Test creative",
  "optimization-event": "Change event",
  "budget-shift": "Shift budget",
  audience: "Audience",
  other: "Action",
};

export default function ForecastPlanSection({ isPublic = false }: { isPublic?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [range, setRange] = useState<"mtd" | "30d" | "7d">("mtd");
  const router = useRouter();

  const generate = async () => {
    if (isPublic) return;
    setLoading(true);
    setError(null);
    setNeedsCredits(false);
    try {
      const res = await fetch(`/api/strategy/plan?range=${range}`, {
        method: "POST",
        cache: "no-store",
      });
      const json = (await res.json()) as Response;
      if (!res.ok) {
        setError(json.error || `Request failed (HTTP ${res.status})`);
        if (json.needsCredits) setNeedsCredits(true);
      } else {
        setData(json);
      }
    } catch (e: any) {
      setError(e?.message || "Couldn't reach the plan generator");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-10 rounded-3xl bg-white/90 backdrop-blur-sm ring-1 ring-black/5 shadow-sm p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] text-white">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <h2 className="text-[20px] font-bold tracking-tight text-foreground">Forecast & Plan</h2>
          </div>
          <p className="mt-1 text-[13.5px] text-muted-foreground max-w-xl">
            Claude reviews your Meta + HubSpot data and recommends per-campaign moves to lower CPL — new adsets, creative tests, optimization events, or budget shifts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full bg-gray-100 p-1 text-[12px] font-medium">
            {(["mtd", "30d", "7d"] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-full transition ${range === r ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                type="button"
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={generate}
            disabled={loading || isPublic}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            type="button"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Thinking…
              </>
            ) : data ? "Regenerate plan" : "Generate plan"}
          </button>
        </div>
      </div>

      {isPublic && (
        <div className="mt-6 rounded-2xl bg-gray-50 px-4 py-3 text-[13px] text-muted-foreground">
          Shared view — ask the owner to run the plan.
        </div>
      )}

      {error && !needsCredits && (
        <div className="mt-6 rounded-2xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-[13px] text-rose-700">
          {error}
        </div>
      )}

      {needsCredits && (
        <div className="mt-6 rounded-2xl ring-1 ring-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <svg className="h-5 w-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-[14px] font-semibold text-foreground">Anthropic credits are empty</div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                Top up once and this feature is live for every future plan. ~$0.03 per generation, so even $5 covers months.
              </div>
              <a
                href="https://console.anthropic.com/settings/billing"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:shadow-md active:scale-[0.98]"
              >
                Add credits → Anthropic Console
              </a>
            </div>
          </div>
        </div>
      )}

      {!isPublic && !data && !loading && !error && (
        <div className="mt-8 rounded-2xl bg-gradient-to-br from-white to-gray-50 ring-1 ring-black/5 px-5 py-6 text-center">
          <div className="mx-auto h-10 w-10 rounded-full bg-gradient-to-br from-[#6B93D8]/10 via-[#9B7ED0]/10 to-[#D06AB8]/10 ring-1 ring-[#9B7ED0]/20 flex items-center justify-center">
            <svg className="h-5 w-5 text-[#7E69AB]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <p className="mt-3 text-[13.5px] text-muted-foreground">
            Pick a range, hit Generate plan. Claude will analyse every live campaign and return ranked actions.
          </p>
        </div>
      )}

      {loading && (
        <div className="mt-8 space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="animate-pulse rounded-2xl bg-gray-100 h-24" />
          ))}
        </div>
      )}

      {data && data.recommendations.length === 0 && !loading && (
        <div className="mt-6 rounded-2xl bg-gray-50 px-4 py-3 text-[13px] text-muted-foreground">
          {data.note ?? "No recommendations returned. Try again or widen the range."}
        </div>
      )}

      {data && data.recommendations.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="text-[12px] text-muted-foreground">
            Plan for {data.rangeStart} → {data.rangeEnd} · {data.snapshotsUsed ?? data.recommendations.length} campaigns analysed · generated {new Date(data.generatedAt).toLocaleTimeString()}
          </div>
          {data.recommendations.map((rec, idx) => (
            <div key={idx} className="rounded-2xl ring-1 ring-black/5 bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[15px] font-semibold text-foreground truncate max-w-[70%]">{rec.campaignName}</h3>
                <div className="flex items-center gap-3 text-[12.5px]">
                  <span className="text-muted-foreground">
                    CPL: <span className="font-semibold text-foreground">{rec.currentCpl != null ? `$${rec.currentCpl.toFixed(2)}` : "n/a"}</span>
                  </span>
                  {rec.targetCpl != null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-0.5 font-semibold">
                      → ${rec.targetCpl.toFixed(2)} target
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-1 text-[13.5px] text-muted-foreground">{rec.headline}</p>
              <ul className="mt-3 space-y-2">
                {rec.actions.map((a, j) => (
                  <li key={j} className="flex items-start gap-3">
                    <span className={`shrink-0 mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${PRIORITY_COLORS[a.priority]}`}>
                      {a.priority.toUpperCase()}
                    </span>
                    <span className="shrink-0 mt-0.5 inline-flex items-center rounded-full bg-gray-50 ring-1 ring-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      {TYPE_LABELS[a.type] || "Action"}
                    </span>
                    <span className="text-[13.5px] text-foreground">{a.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
