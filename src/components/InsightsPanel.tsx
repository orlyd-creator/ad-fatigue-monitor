"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Insight {
  id: string;
  type: "critical" | "warning" | "opportunity" | "info";
  title: string;
  body: string;
  action: string;
  adName?: string;
  adId?: string;
  campaignName?: string;
  adsetName?: string;
  impact?: string;
}

const TYPE_CONFIG: Record<
  Insight["type"],
  { borderColor: string; iconBg: string; iconColor: string; label: string }
> = {
  critical: {
    borderColor: "border-red-400",
    iconBg: "bg-red-50",
    iconColor: "text-red-500",
    label: "Critical",
  },
  warning: {
    borderColor: "border-orange-400",
    iconBg: "bg-orange-50",
    iconColor: "text-orange-500",
    label: "Warning",
  },
  opportunity: {
    borderColor: "border-green-400",
    iconBg: "bg-green-50",
    iconColor: "text-green-500",
    label: "Opportunity",
  },
  info: {
    borderColor: "border-blue-400",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-500",
    label: "Info",
  },
};

function InsightIcon({ type }: { type: Insight["type"] }) {
  const config = TYPE_CONFIG[type];
  return (
    <div
      className={`w-10 h-10 rounded-xl ${config.iconBg} flex items-center justify-center flex-shrink-0`}
    >
      {type === "critical" && (
        <svg
          className={`w-5 h-5 ${config.iconColor}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          <path d="M12.5 2.1C11.3 4 10.6 5.5 10.6 6.6c0 1.1.9 2 1.9 2s1.9-.9 1.9-2c0-1.1-.7-2.6-1.9-4.5zM8.2 6.3C7 8.2 6.3 9.7 6.3 10.8c0 1.1.9 2 1.9 2s1.9-.9 1.9-2c0-1.1-.7-2.6-1.9-4.5zm8.6 0c-1.2 1.9-1.9 3.4-1.9 4.5 0 1.1.9 2 1.9 2s1.9-.9 1.9-2c0-1.1-.7-2.6-1.9-4.5zM12.5 11C11.3 12.9 10.6 14.4 10.6 15.5c0 1.1.9 2 1.9 2s1.9-.9 1.9-2c0-1.1-.7-2.6-1.9-4.5z" />
        </svg>
      )}
      {type === "warning" && (
        <svg
          className={`w-5 h-5 ${config.iconColor}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
        </svg>
      )}
      {type === "opportunity" && (
        <svg
          className={`w-5 h-5 ${config.iconColor}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2.5L4.5 20.3l.7.2L12 17.8l6.8 2.7.7-.2L12 2.5zM12 5.8l5.5 13.7L12 17l-5.5 2.5L12 5.8z" />
          <path d="M12 2L4 20l8-3.5L20 20 12 2zm0 4l5 12.5L12 16l-5 2.5L12 6z" />
        </svg>
      )}
      {type === "info" && (
        <svg
          className={`w-5 h-5 ${config.iconColor}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
        </svg>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="lv-card p-5 border-l-4 border-gray-200 animate-pulse">
      <div className="flex gap-4">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="h-4 bg-gray-100 rounded w-1/3" />
          <div className="h-3 bg-gray-100 rounded w-full" />
          <div className="h-3 bg-gray-100 rounded w-2/3" />
        </div>
      </div>
    </div>
  );
}

export default function InsightsPanel() {
  const router = useRouter();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights");
      if (!res.ok) throw new Error("Failed to load insights");
      const data = await res.json();
      setInsights(data.insights || []);
    } catch {
      setError("Could not load insights. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const criticalCount = insights.filter((i) => i.type === "critical").length;
  const warningCount = insights.filter((i) => i.type === "warning").length;
  const opportunityCount = insights.filter(
    (i) => i.type === "opportunity"
  ).length;

  return (
    <div className="mb-8">
      {/* Summary Banner */}
      {!loading && !error && insights.length > 0 && (
        <div className="lv-card p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {criticalCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1 rounded-full bg-red-50 text-red-600">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {criticalCount} Critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1 rounded-full bg-orange-50 text-orange-600">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                {warningCount} Warning{warningCount > 1 ? "s" : ""}
              </span>
            )}
            {opportunityCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1 rounded-full bg-green-50 text-green-600">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {opportunityCount} Opportunit{opportunityCount > 1 ? "ies" : "y"}
              </span>
            )}
          </div>
          <button
            onClick={fetchInsights}
            className="text-[12px] font-medium text-[#7E69AB] hover:text-[#6E59A5] transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh Insights
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="lv-card p-5 text-center">
          <p className="text-[14px] text-muted-foreground">{error}</p>
          <button
            onClick={fetchInsights}
            className="mt-3 text-[13px] font-medium text-[#7E69AB] hover:text-[#6E59A5] cursor-pointer"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && insights.length === 0 && (
        <div className="lv-card p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-5 h-5 text-green-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-[14px] font-medium text-foreground">
            All clear — no issues detected
          </p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Your ads are running smoothly. Check back later for new insights.
          </p>
        </div>
      )}

      {/* Insight Cards */}
      {!loading && !error && insights.length > 0 && (
        <div className="space-y-3">
          {insights.map((insight) => {
            const config = TYPE_CONFIG[insight.type];
            const clickable = !!insight.adId;
            return (
              <div
                key={insight.id}
                onClick={clickable ? () => router.push(`/ad/${insight.adId}`) : undefined}
                className={`lv-card p-5 border-l-4 ${config.borderColor} ${clickable ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
              >
                <div className="flex gap-4">
                  <InsightIcon type={insight.type} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-foreground">
                        {insight.title}
                      </span>
                      {insight.impact && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F0FB] text-[#7E69AB]">
                          {insight.impact}
                        </span>
                      )}
                    </div>
                    {(insight.campaignName || insight.adsetName) && (
                      <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5">
                        {insight.campaignName && (
                          <span><span className="uppercase tracking-wide opacity-70">Campaign</span> <span className="font-medium text-foreground">{insight.campaignName}</span></span>
                        )}
                        {insight.campaignName && insight.adsetName && <span className="opacity-40">·</span>}
                        {insight.adsetName && (
                          <span><span className="uppercase tracking-wide opacity-70">Ad Set</span> <span className="font-medium text-foreground">{insight.adsetName}</span></span>
                        )}
                      </div>
                    )}
                    <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
                      {insight.body}
                    </p>
                    <p className="text-[12px] font-medium text-[#7E69AB] mt-2 leading-relaxed">
                      {insight.action}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
