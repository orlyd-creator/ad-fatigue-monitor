"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useState, useTransition } from "react";
import { refreshData } from "@/app/dashboard/actions";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings", label: "Settings" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncDone, setSyncDone] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = () => {
    setSyncError(null);
    startTransition(async () => {
      try {
        const result = await refreshData();
        if (result.error) {
          setSyncError(result.error);
          setTimeout(() => setSyncError(null), 5000);
          return;
        }
        if (result.errors && result.errors.length > 0 && result.adsFound === 0) {
          setSyncError(result.errors[0]);
          setTimeout(() => setSyncError(null), 5000);
          return;
        }
        setSyncDone(true);
        setTimeout(() => {
          setSyncDone(false);
          router.refresh();
        }, 1000);
      } catch {
        setSyncError("Something went wrong");
        setTimeout(() => setSyncError(null), 5000);
      }
    });
  };

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-2xl border-b border-pink-100/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-10">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#EC4899] to-[#8B5CF6] flex items-center justify-center text-white font-bold text-sm shadow-md shadow-pink-200/50">
                AF
              </div>
              <span className="font-semibold text-foreground tracking-tight">
                Fatigue Monitor
              </span>
            </Link>
            <div className="flex gap-1">
              {links.map((link) => {
                const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={clsx(
                      "px-4 py-2 rounded-full text-[13px] font-medium transition-all nav-link-animated",
                      isActive
                        ? "bg-accent-light text-[#DB2777]"
                        : "text-muted-foreground hover:text-foreground hover:bg-surface"
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {syncError && (
              <span className="text-[11px] text-red-500 max-w-[180px] truncate" title={syncError}>
                {syncError.includes("expired") || syncError.includes("No account")
                  ? <a href="/login" className="underline hover:text-red-700">Reconnect →</a>
                  : syncError}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={isPending}
              className={clsx(
                "px-4 py-2 rounded-full text-[13px] font-medium transition-all btn-hover-scale",
                syncDone
                  ? "bg-green-50 text-green-600"
                  : syncError
                  ? "bg-red-50 text-red-500 border border-red-200"
                  : isPending
                  ? "sync-border-spin text-muted-foreground"
                  : "bg-white text-muted-foreground hover:text-foreground shadow-sm border border-black/[0.06] hover:shadow-md"
              )}
            >
              {isPending && !syncDone && (
                <svg className="w-3.5 h-3.5 animate-spin inline mr-1.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {syncDone ? "Synced!" : isPending ? "Pulling data..." : syncError ? "Try Again" : "Refresh Data"}
            </button>
            <a href="/login" className="px-3 py-2 rounded-full text-[12px] text-muted-foreground hover:text-foreground hover:bg-surface transition-all" title="Switch account or logout">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
