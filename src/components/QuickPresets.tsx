"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition, useState, useEffect } from "react";
import { format, startOfMonth, endOfMonth, subMonths, subDays, startOfYear } from "date-fns";

/**
 * Inline quick-preset chip row. Pairs with DateRangePicker (the dropdown)
 * but surfaces the most-used ranges as a single click so Orly doesn't have
 * to open the dropdown just to jump between months.
 *
 * Writes the same ?from=&to=&preset= URL params as DateRangePicker.
 * Optimistic UI: clicked preset flips to active immediately, then clears
 * once the URL catches up, so even slow Server Component re-renders feel
 * responsive.
 */

type Preset = "this-month" | "last-month" | "last-30" | "3m" | "6m" | "ytd" | "12m";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-30", label: "Last 30d" },
  { key: "3m", label: "3m" },
  { key: "6m", label: "6m" },
  { key: "ytd", label: "YTD" },
  { key: "12m", label: "12m" },
];

function resolvePreset(key: Preset, now: Date): { from: Date; to: Date } {
  switch (key) {
    case "this-month": return { from: startOfMonth(now), to: now };
    case "last-month": {
      const lm = subMonths(now, 1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
    case "last-30": return { from: subDays(now, 29), to: now };
    case "3m":       return { from: startOfMonth(subMonths(now, 2)), to: now };
    case "6m":       return { from: startOfMonth(subMonths(now, 5)), to: now };
    case "ytd":      return { from: startOfYear(now), to: now };
    case "12m":      return { from: startOfMonth(subMonths(now, 11)), to: now };
  }
}

export default function QuickPresets() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<Preset | null>(null);

  const activePreset = (sp.get("preset") as Preset) || "this-month";
  const displayActive = optimistic || activePreset;

  useEffect(() => {
    if (!pending) {
      const t = setTimeout(() => setOptimistic(null), 100);
      return () => clearTimeout(t);
    }
  }, [pending, activePreset]);

  const handleClick = (key: Preset) => {
    setOptimistic(key);
    const { from, to } = resolvePreset(key, new Date());
    const p = new URLSearchParams(Array.from(sp.entries()));
    p.set("from", format(from, "yyyy-MM-dd"));
    p.set("to", format(to, "yyyy-MM-dd"));
    p.set("preset", key);
    start(() => {
      router.push(`${pathname}?${p.toString()}`, { scroll: false });
    });
  };

  return (
    <div className={`inline-flex items-center gap-1 p-1 rounded-full bg-white/80 backdrop-blur-sm border border-gray-100 shadow-sm transition-opacity ${pending ? "opacity-80" : ""}`}>
      {PRESETS.map((p) => {
        const active = displayActive === p.key;
        return (
          <button
            key={p.key}
            onClick={() => handleClick(p.key)}
            className={`text-[12px] font-medium px-3 py-1.5 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9B7ED0]/40 ${
              active
                ? "bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] text-white shadow-sm"
                : "text-gray-600 hover:text-foreground hover:bg-gray-50"
            } ${pending && active ? "animate-pulse" : ""}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
