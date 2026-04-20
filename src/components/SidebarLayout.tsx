"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";

export default function SidebarLayout({
  children,
  isPublic = false,
}: {
  children: React.ReactNode;
  isPublic?: boolean;
}) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login" || pathname === "/";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer on route change so it doesn't stay open behind
  // the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close drawer on Escape, a11y nicety.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen md:h-screen relative">
      {/* Mobile hamburger: only renders below md */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed top-3 left-3 z-[70] w-10 h-10 rounded-xl bg-white/95 border border-gray-200 shadow-sm flex items-center justify-center active:scale-95 transition-transform"
      >
        <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-[64] bg-black/30 backdrop-blur-[2px]"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar: sticky on desktop, slides in from the left on mobile */}
      <div
        className={`md:static md:translate-x-0 fixed inset-y-0 left-0 z-[65] transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          onMobileClose={() => setMobileOpen(false)}
          isPublic={isPublic}
        />
      </div>

      <main className="flex-1 overflow-y-auto w-full pt-14 md:pt-0 px-0">
        {children}
      </main>
    </div>
  );
}
