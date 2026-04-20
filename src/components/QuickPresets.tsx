"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { format, startOfMonth, endOfMonth, subMonths, subDays, startOfYear } from "date-fns";

/**
 * Inline quick-preset chip row. Pairs with DateRangePicker (the dropdown)
 * but surfaces the most-used ranges as a single click so Orly doesn't have
 * to open the dropdown just to jump between months.
 *
 * Writes the same ?from=&to=&preset= URL params as DateRangePicker.
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
  const activePreset = (sp.get("preset") as Preset) || "this-month";

  const apply = (preset: Preset) => {
    const { from, to } = resolvePreset(preset, new Date());
    const p = new URLSearchParams(Array.from(sp.entries()));
    p.set("from", format(from, "yyyy-MM-dd"));
    p.set("to", format(to, "yyyy-MM-dd"));
    p.set("preset", preset);
    start(() => router.push(`${pathname}?${p.toString()}`));
  };

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/80 backdrop-blur-sm border border-gray-100 shadow-sm">
      {PRESETS.map((p) => {
        const active = activePreset === p.key;
        return (
          <button
            key={p.key}
            onClick={() => apply(p.key)}
            disabled={pending}
            className={`text-[12px] font-medium px-3 py-1.5 rounded-full transition-all ${
              active
                ? "bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] text-white shadow-sm"
                : "text-gray-600 hover:text-foreground hover:bg-gray-50"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
