"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps data live. On mount, if the last Meta sync is older than
 * the threshold, fire a synchronous quick-sync (~5s, today's metrics
 * + ad statuses) and refresh the Server Component tree when it
 * actually finishes. Re-checks every minute so a tab left open for
 * an hour stays fresh too.
 *
 * Quick mode is used here on purpose — full mode returns immediately
 * with `{started: true}` and runs in the background, which means a
 * router.refresh() right after the fetch re-fetches the same stale
 * data and never retries. The 10-min server-side auto-sync in
 * instrumentation.ts handles the historical 180-day window.
 */
export default function FreshnessGuard({
  lastSyncedAt,
  staleAfterMinutes = 5,
  isPublic = false,
}: {
  lastSyncedAt: number | null;
  staleAfterMinutes?: number;
  isPublic?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [ageMin, setAgeMin] = useState<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (isPublic) {
      if (lastSyncedAt) {
        setAgeMin(Math.floor((Date.now() - lastSyncedAt) / 60000));
      }
      return;
    }

    const tryRefresh = async () => {
      const ts = lastSyncedAt ?? 0;
      const minutes = ts ? Math.floor((Date.now() - ts) / 60000) : null;
      setAgeMin(minutes);

      if (ts && minutes !== null && minutes < staleAfterMinutes) return;
      if (inFlight.current) return;
      inFlight.current = true;
      setStatus("syncing");
      try {
        const res = await fetch("/api/sync?mode=quick", { method: "POST" });
        if (!res.ok) throw new Error(String(res.status));
        setStatus("done");
        router.refresh();
      } catch {
        setStatus("error");
      } finally {
        inFlight.current = false;
      }
    };

    tryRefresh();
    // Re-check every minute while the tab is open. The guard inside
    // tryRefresh skips the fetch unless data is actually stale.
    const interval = setInterval(tryRefresh, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSyncedAt, isPublic, staleAfterMinutes]);

  // Traffic-light color for Meta freshness
  const metaColor =
    ageMin === null ? "bg-gray-300" :
    ageMin < 15 ? "bg-emerald-500" :
    ageMin < 60 ? "bg-amber-400" :
    "bg-rose-500";

  const metaLabel =
    ageMin === null ? "never synced" :
    ageMin === 0 ? "just now" :
    ageMin < 60 ? `${ageMin}m ago` :
    `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 text-[12px]">
      {/* Meta freshness pill */}
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 border border-border">
        <span className={`w-2 h-2 rounded-full ${metaColor}`} />
        <span className="text-muted-foreground">Meta</span>
        <span className="font-medium text-foreground">{metaLabel}</span>
      </div>

      {/* HubSpot freshness pill, fetched live on every page load */}
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 border border-border">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-muted-foreground">HubSpot</span>
        <span className="font-medium text-foreground">live</span>
      </div>

      {status === "syncing" && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#9B7ED0]/10 border border-[#9B7ED0]/20 text-[#7E69AB]">
          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          <span>Refreshing Meta…</span>
        </div>
      )}

      {status === "error" && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-100 text-red-700">
          Auto-refresh failed, click Refresh in the sidebar
        </div>
      )}
    </div>
  );
}
