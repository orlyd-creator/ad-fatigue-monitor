"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useState, useTransition } from "react";
import { refreshData } from "@/app/dashboard/actions";

const links = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: (
      <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncDone, setSyncDone] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Don't render sidebar on login page
  if (pathname === "/login" || pathname === "/") return null;

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
        // Show partial errors but still mark as done
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
    <aside className="sidebar-container w-[240px] min-w-[240px] h-screen sticky top-0 flex flex-col border-r border-white/20 z-40">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6B93D8] via-[#D06AB8] to-[#F04E80] flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-200/50">
            AF
          </div>
          <span className="font-semibold text-white tracking-tight text-[15px] drop-shadow-sm">
            Ad Fatigue
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {links.map((link) => {
          const isActive =
            pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all",
                isActive
                  ? "bg-white/20 text-white shadow-sm"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              )}
            >
              {link.icon}
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Refresh Data Button */}
      <div className="px-3 pb-3">
        {syncError && (
          <div className="px-3 py-2 mb-2 rounded-xl bg-red-500/20 border border-red-400/30">
            <span className="text-[11px] text-red-200 leading-tight block">
              {syncError.includes("expired") || syncError.includes("No account") ? (
                <a href="/login" className="underline hover:text-white">
                  Reconnect your account
                </a>
              ) : (
                syncError
              )}
            </span>
          </div>
        )}
        <button
          onClick={handleSync}
          disabled={isPending}
          className={clsx(
            "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all",
            syncDone
              ? "bg-green-500/20 text-green-200 border border-green-400/30"
              : syncError
              ? "bg-red-500/20 text-red-200 border border-red-400/30 hover:bg-red-500/30"
              : isPending
              ? "bg-white/10 text-white/70 border border-white/20"
              : "bg-white/10 text-white/80 border border-white/20 hover:bg-white/20 hover:text-white"
          )}
        >
          {isPending && !syncDone && (
            <svg
              className="w-3.5 h-3.5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}
          {!isPending && !syncDone && !syncError && (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          )}
          {syncDone
            ? "Synced!"
            : isPending
            ? "Pulling data..."
            : syncError
            ? "Try Again"
            : "Refresh Data"}
        </button>
      </div>

      {/* Account / Logout */}
      <div className="px-3 pb-5 pt-1 border-t border-white/10">
        <a
          href="/login"
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] text-white/60 hover:text-white hover:bg-white/10 transition-all"
          title="Switch account or logout"
        >
          <svg
            className="w-[18px] h-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
            />
          </svg>
          Switch Account
        </a>
      </div>
    </aside>
  );
}
