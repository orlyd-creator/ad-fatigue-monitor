"use client";

import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useState, useTransition, useEffect } from "react";
import { refreshData } from "@/app/dashboard/actions";
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
    href: "/strategy",
    label: "Analytics",
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
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncDone, setSyncDone] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState<string | null>(null);

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
    if (pathname === href) return;
    setNavigating(href);
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
          setTimeout(() => setSyncError(null), 15000);
          return;
        }
        if (result.errors && result.errors.length > 0) {
          setSyncError(`Synced ${result.adsFound} ads but: ${result.errors[0]}`);
          setTimeout(() => setSyncError(null), 10000);
        }
        setSyncDone(true);
        setTimeout(() => {
          setSyncDone(false);
          router.refresh();
        }, 1500);
      } catch {
        setSyncError("Something went wrong");
        setTimeout(() => setSyncError(null), 5000);
      }
    });
  };

  return (
    <aside
      className={clsx(
        "h-screen sticky top-0 flex flex-col border-r border-gray-100 z-50 bg-[#FAFAFA] overflow-hidden",
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

        {/* Refresh */}
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

        {/* Share workspace */}
        <button
          onClick={() => handleNav("/team")}
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

        {/* Logout */}
        <div className="pt-1 border-t border-gray-100">
          <form action={signOutUser}>
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
  );
}
