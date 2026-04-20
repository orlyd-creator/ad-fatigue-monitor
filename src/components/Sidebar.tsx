"use client";

import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useState, useTransition, useEffect } from "react";
import { signOutUser } from "@/app/login/actions";

const links = [
  {
    href: "/executive",
    label: "Executive",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
  },
  {
    href: "/forecast",
    label: "Forecast",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18l7.5-7.5 4.5 4.5 7.5-7.5" />
      </svg>
    ),
  },
  {
    href: "/strategy",
    label: "Leads & Analytics",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onMobileClose?: () => void;
  isPublic?: boolean;
}

export default function Sidebar({ collapsed, onToggle, onMobileClose, isPublic = false }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncDone, setSyncDone] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Dedicated overlay state: stays visible for the whole sync AND shows a
  // brief "Synced" confirmation afterwards. Prevents the flicker where the
  // overlay would disappear the instant fetch resolved.
  const [showOverlay, setShowOverlay] = useState<"syncing" | "done" | null>(null);
  const [navigating, setNavigating] = useState<string | null>(null);
  // Public viewers clicking write-actions get a permissions prompt instead
  // of a confusing auth error.
  const [showPermPrompt, setShowPermPrompt] = useState(false);

  // Clear the "navigating" highlight as soon as the route actually changes.
  // Without this, clicking a button set navigating forever → the old page's
  // link AND the target link both showed as active during the transition.
  useEffect(() => {
    if (navigating && pathname.startsWith(navigating)) {
      setNavigating(null);
    }
  }, [pathname, navigating]);

  if (pathname === "/login" || pathname === "/") return null;

  const handleNav = (href: string) => {
    // Block navigation while a sync is in flight, Orly kept losing mid-sync
    // state by clicking into Dashboard/Executive before the overlay cleared.
    if (showOverlay === "syncing") return;
    if (pathname === href) return;
    setNavigating(href);
    onMobileClose?.();
    // Use startTransition for instant visual feedback while navigating
    startTransition(() => {
      router.push(href);
    });
  };

  // Prefetch all routes on mount for instant navigation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prefetched = useState(() => {
    if (typeof window !== "undefined") {
      links.forEach(l => router.prefetch(l.href));
    }
    return true;
  })[0];

  // Refresh uses a plain fetch to /api/sync (not a server action) so the
  // transport can't be killed by navigation / Next.js action-stream quirks.
  // The AbortController is intentionally NOT tied to navigation, the sync
  // keeps running even if the user leaves the page.
  // Verify a sync actually succeeded by checking lastSyncedAt. Used whenever
  // the client can't trust the response (502 from the gateway, stream drop,
  // network blip). If any ad was synced in the last 3 min, the backend
  // finished the work, we just lost the response.
  const didSyncActuallySucceed = async (startedAt: number) => {
    try {
      const check = await fetch("/api/ads?cb=" + Date.now(), { cache: "no-store" });
      if (!check.ok) return false;
      const data = await check.json();
      const mostRecent = Array.isArray(data?.ads)
        ? data.ads.reduce((m: number, a: any) => Math.max(m, a.lastSyncedAt ?? 0), 0)
        : 0;
      // Accept either (a) anything synced after the click, or (b) anything
      // synced in the last 3 min (for when the backend was already partway).
      return mostRecent >= startedAt - 5000 || Date.now() - mostRecent < 180000;
    } catch {
      return false;
    }
  };

  const markSyncSuccess = () => {
    setSyncDone(true);
    setShowOverlay("done");
    setTimeout(() => {
      setSyncDone(false);
      setShowOverlay(null);
      router.refresh();
    }, 1800);
  };

  const handleSync = () => {
    if (isPublic) {
      setShowPermPrompt(true);
      return;
    }
    setSyncError(null);
    setShowOverlay("syncing");
    const startedAt = Date.now();
    startTransition(async () => {
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          keepalive: true,
        });
        let body: any = {};
        try { body = await res.json(); } catch {}

        if (!res.ok) {
          // 401 is unambiguous, don't second-guess.
          if (res.status === 401 || body?.error?.match?.(/token|expired|reconnect/i)) {
            setSyncError("Meta token expired, reconnect");
            setShowOverlay(null);
            setTimeout(() => setSyncError(null), 10000);
            return;
          }
          // 5xx often means the gateway timed out WHILE the backend finished
          // successfully (we see this as 502 Bad Gateway on Railway). Verify
          // by checking lastSyncedAt before showing a scary error.
          if (await didSyncActuallySucceed(startedAt)) {
            markSyncSuccess();
            return;
          }
          setSyncError(body?.error || `Sync failed (HTTP ${res.status})`);
          setShowOverlay(null);
          setTimeout(() => setSyncError(null), 8000);
          return;
        }

        if (body.errors && body.errors.length > 0 && body.adsFound === 0) {
          setSyncError(body.errors[0]);
          setShowOverlay(null);
          setTimeout(() => setSyncError(null), 15000);
          return;
        }
        if (body.errors && body.errors.length > 0) {
          setSyncError(`Synced ${body.adsFound} ads, but: ${body.errors[0]}`);
          setTimeout(() => setSyncError(null), 10000);
        }
        markSyncSuccess();
      } catch (err: any) {
        if (await didSyncActuallySucceed(startedAt)) {
          markSyncSuccess();
          return;
        }
        setSyncError(err?.message?.includes("abort") ? "Cancelled" : "Couldn't reach sync. Try again.");
        setShowOverlay(null);
        setTimeout(() => setSyncError(null), 6000);
      }
    });
  };

  return (
    <>
      {/* Permissions prompt, shown when a public viewer clicks Refresh /
          Share workspace / Switch Account. Guides them back to the owner. */}
      {showPermPrompt && (
        <div
          className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[4px] flex items-center justify-center p-5"
          onClick={() => setShowPermPrompt(false)}
        >
          <div
            className="relative bg-white rounded-3xl shadow-2xl max-w-[380px] w-[calc(100vw-40px)] overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: "permFade 200ms ease-out" }}
          >
            {/* Close button top-right */}
            <button
              onClick={() => setShowPermPrompt(false)}
              aria-label="Close"
              className="absolute top-3 right-3 w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Icon + gradient halo, centered at top */}
            <div className="pt-8 pb-5 flex flex-col items-center px-8">
              <div className="relative mb-5">
                <div className="absolute inset-0 rounded-full blur-2xl opacity-40 bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8]" />
                <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-[#6B93D8]/15 via-[#9B7ED0]/15 to-[#D06AB8]/15 ring-1 ring-[#9B7ED0]/25 flex items-center justify-center">
                  <svg className="w-6 h-6 text-[#7E69AB]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
              </div>
              <h3 className="text-[18px] font-bold text-foreground tracking-tight text-center leading-tight">
                This is view-only
              </h3>
              <p className="text-[13.5px] text-muted-foreground mt-2 leading-relaxed text-center max-w-[300px]">
                You're viewing a shared link. Ask the person who sent it if you need this action.
              </p>
            </div>

            {/* Action button */}
            <div className="px-6 pb-6">
              <button
                onClick={() => setShowPermPrompt(false)}
                className="w-full py-3 rounded-xl bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] text-white text-[14px] font-semibold shadow-sm hover:shadow-md active:scale-[0.98] transition"
              >
                Got it
              </button>
            </div>
          </div>
          <style jsx>{`
            @keyframes permFade {
              from { opacity: 0; transform: scale(0.96) translateY(4px); }
              to { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>
        </div>
      )}

      {/* Sync lock overlay, covers the page (but not the sidebar) while a
          sync is running. Stays visible until markSyncSuccess flips to 'done'
          then holds for ~1.8s so users see confirmation. */}
      {showOverlay && (
        <div
          className="fixed inset-0 z-[75] bg-black/30 backdrop-blur-[4px] flex items-center justify-center p-5 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative bg-white rounded-3xl shadow-2xl max-w-[380px] w-[calc(100vw-40px)] overflow-hidden"
            style={{ animation: "permFade 200ms ease-out" }}
          >
            <div className="pt-8 pb-6 flex flex-col items-center px-8">
              <div className="relative mb-5">
                <div className="absolute inset-0 rounded-full blur-2xl opacity-40 bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8]" />
                {showOverlay === "done" ? (
                  <div className="relative w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center ring-4 ring-emerald-500/15">
                    <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                ) : (
                  <div
                    className="relative w-14 h-14 rounded-full"
                    style={{
                      background:
                        "conic-gradient(from 0deg, #6B93D8, #9B7ED0, #D06AB8, #F04E80, #6B93D8)",
                      animation: "spin 1.2s linear infinite",
                      mask: "radial-gradient(closest-side, transparent 55%, black 56%)",
                      WebkitMask:
                        "radial-gradient(closest-side, transparent 55%, black 56%)",
                    }}
                  />
                )}
              </div>
              <div className="text-[18px] font-bold text-foreground tracking-tight text-center leading-tight">
                {showOverlay === "done" ? "Synced" : "Refreshing your data"}
              </div>
              <div className="text-[13.5px] text-muted-foreground mt-2 leading-relaxed text-center max-w-[300px]">
                {showOverlay === "done"
                  ? "Fresh Meta + HubSpot data is loading."
                  : "Takes 30 to 60 seconds. Please wait, clicking around will cancel the sync."}
              </div>
            </div>
          </div>
          <style jsx>{`
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}
      <aside
        className={clsx(
          "h-screen sticky top-0 flex flex-col border-r border-gray-100 z-[60] bg-[#FAFAFA] overflow-hidden",
          collapsed ? "w-[52px] min-w-[52px]" : "w-[200px] min-w-[200px]"
        )}
      >
      {/* Logo */}
      <div className={clsx("flex items-center gap-2 pt-5 pb-4", collapsed ? "px-2 justify-center" : "px-4")}>
        <button onClick={() => handleNav("/dashboard")} className="flex items-center gap-2 cursor-pointer">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#6B93D8] via-[#D06AB8] to-[#F04E80] flex items-center justify-center text-white font-semibold text-[11px] flex-shrink-0">
            OD
          </div>
          {!collapsed && (
            <span className="font-semibold text-[13px] text-gray-900 tracking-tight">OD</span>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className={clsx("flex-1 py-1 space-y-0.5", collapsed ? "px-1.5" : "px-2.5")}>
        {/* During a navigation transition, treat the destination as active
            rather than the current path, so the UI never shows two buttons
            highlighted at the same time. Falls back to pathname once the
            navigation finishes (navigating is cleared by the effect above). */}
        {links.map((link) => {
          const effectivePath = navigating || pathname;
          const isActive = effectivePath === link.href || effectivePath.startsWith(link.href + "/");
          const isNavigating = navigating === link.href;
          return (
            <button
              key={link.href}
              onClick={() => handleNav(link.href)}
              title={collapsed ? link.label : undefined}
              className={clsx(
                "cursor-pointer w-full flex items-center gap-2.5 rounded-lg text-[13px] font-medium text-left select-none transition-all duration-75 active:scale-[0.97]",
                collapsed ? "justify-center px-0 py-3.5 min-h-[44px]" : "px-3 py-3 min-h-[44px]",
                isActive || isNavigating
                  ? "bg-gray-200/70 text-gray-900"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-200/40"
              )}
            >
              <span className={clsx("pointer-events-none flex-shrink-0", isActive || isNavigating ? "text-gray-900" : "text-gray-400")}>
                {link.icon}
              </span>
              {!collapsed && <span className="pointer-events-none">{link.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className={clsx("pb-3 space-y-1", collapsed ? "px-1.5" : "px-2")}>
        {/* Sync error */}
        {syncError && !collapsed && (
          <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-100">
            <span className="text-[11px] text-red-600 leading-tight block">
              {syncError.includes("expired") || syncError.includes("No account") ? (
                <a href="/login" className="underline hover:text-red-800">Reconnect</a>
              ) : syncError}
            </span>
          </div>
        )}

        {/* Refresh, visible to everyone including public viewers */}
        <button
          onClick={handleSync}
          disabled={isPending}
          title={collapsed ? (isPending ? "Syncing..." : "Refresh") : undefined}
          className={clsx(
            "cursor-pointer w-full flex items-center gap-2 rounded-lg text-[12px] font-medium select-none min-h-[40px]",
            collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
            syncDone
              ? "text-green-600 bg-green-50"
              : syncError
              ? "text-red-600 bg-red-50 hover:bg-red-100"
              : isPending
              ? "text-gray-400"
              : "text-gray-500 hover:text-gray-900 hover:bg-gray-200/40"
          )}
        >
          {isPending && !syncDone ? (
            <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          )}
          {!collapsed && (
            syncDone ? "Synced" : isPending ? "Syncing..." : syncError ? "Retry" : "Refresh"
          )}
        </button>

        {/* Share workspace, visible to everyone (public viewers get a prompt) */}
        <button
          onClick={() => {
            if (isPublic) { setShowPermPrompt(true); return; }
            handleNav("/team");
          }}
          title={collapsed ? "Share workspace" : undefined}
          className={clsx(
            "cursor-pointer w-full flex items-center gap-2 rounded-md text-[12px] font-medium text-gray-400 hover:text-gray-900 hover:bg-gray-200/40",
            collapsed ? "justify-center px-0 py-2" : "px-2.5 py-[7px]"
          )}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72M18 18.72v-.094c0-1.34-.296-2.61-.826-3.748M18 18.72v.002A12 12 0 0112 21a12 12 0 01-6-1.278v-.002m0 0a3 3 0 00-4.681-2.72 9.094 9.094 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M6 18.719a5.971 5.971 0 01.94-3.197m5.06-1.523a3 3 0 11-6 0 3 3 0 016 0zm6-3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          {!collapsed && "Share workspace"}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          title={collapsed ? "Expand" : "Collapse"}
          className={clsx(
            "cursor-pointer w-full flex items-center gap-2 rounded-md text-[12px] font-medium text-gray-400 hover:text-gray-900 hover:bg-gray-200/40",
            collapsed ? "justify-center px-0 py-2" : "px-2.5 py-[7px]"
          )}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            {collapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            )}
          </svg>
          {!collapsed && "Collapse"}
        </button>

        {/* Switch Account, visible to everyone (public viewers get a prompt) */}
        <div className="pt-1 border-t border-gray-100">
          <form action={isPublic ? undefined : signOutUser} onSubmit={isPublic ? (e) => { e.preventDefault(); setShowPermPrompt(true); } : undefined}>
            <button
              type="submit"
              title={collapsed ? "Switch Account" : undefined}
              className={clsx(
                "cursor-pointer w-full flex items-center gap-2 rounded-md text-[12px] font-medium text-gray-400 hover:text-gray-900 hover:bg-gray-200/40",
                collapsed ? "justify-center px-0 py-2" : "px-2.5 py-[7px]"
              )}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              {!collapsed && "Switch Account"}
            </button>
          </form>
        </div>
      </div>
    </aside>
    </>
  );
}
