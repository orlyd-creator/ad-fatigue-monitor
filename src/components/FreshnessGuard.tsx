"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps data live. On mount, if the last Meta sync is older than
 * the threshold, it fires a background /api/sync and refreshes the
 * Server Component tree when it finishes. Shows a subtle banner.
 *
 * Drop one of these into every data-facing page so users never see
 * stale ad statuses / spend without having to click Refresh manually.
 */
export default function FreshnessGuard({
  lastSyncedAt,
  staleAfterMinutes = 10,
  isPublic = false,
}: {
  lastSyncedAt: number | null;
  staleAfterMinutes?: number;
  isPublic?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [ageMin, setAgeMin] = useState<number | null>(null);

  useEffect(() => {
    if (!lastSyncedAt) {
      setAgeMin(null);
      return;
    }
    const minutes = Math.floor((Date.now() - lastSyncedAt) / 60000);
    setAgeMin(minutes);

    // Public viewers don't trigger sync — keep it owner-only so we don't
    // burn Meta rate limits on every anonymous link click.
    if (isPublic) return;
    if (minutes < staleAfterMinutes) return;
    if (status !== "idle") return;

    setStatus("syncing");
    fetch("/api/sync", { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        setStatus("done");
        router.refresh();
      })
      .catch(() => setStatus("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSyncedAt]);

  if (status === "idle" && ageMin !== null && ageMin < staleAfterMinutes) {
    // Fresh — quiet indicator only
    return (
      <div className="text-[11px] text-muted-foreground px-4 py-1">
        Updated {ageMin === 0 ? "just now" : `${ageMin}m ago`}
      </div>
    );
  }

  if (status === "syncing") {
    return (
      <div className="px-4 py-2 rounded-xl bg-[#9B7ED0]/10 border border-[#9B7ED0]/20 text-[12px] text-[#7E69AB] mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        Refreshing Meta data…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="px-4 py-2 rounded-xl bg-red-50 border border-red-100 text-[12px] text-red-700 mb-4">
        Couldn't auto-refresh. Click the Refresh button in the sidebar to retry.
      </div>
    );
  }

  return null;
}
