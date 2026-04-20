"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, subDays, addDays, differenceInDays } from "date-fns";

/**
 * Global date range picker with comparison.
 *
 * URL contract (every page reads these):
 *   ?from=YYYY-MM-DD       — range start (defaults to startOfMonth today)
 *   ?to=YYYY-MM-DD         — range end   (defaults to today)
 *   ?compareFrom=YYYY-MM-DD  — comparison start (optional)
 *   ?compareTo=YYYY-MM-DD    — comparison end   (optional)
 *   ?preset=this-month|last-month|3m|6m|ytd|12m|custom
 *
 * Any page that reads `from/to` from searchParams automatically picks up
 * the selected range. Pass compareFrom/To as well to render side-by-side
 * comparison lines on any chart.
 *
 * Common preset + comparison combos Orly asked for:
 *   - This month + last month (Apr vs Mar)
 *   - Last 30 days + previous 30 days
 *   - Custom range + "previous period of same length"
 */

type Preset = "this-month" | "last-month" | "last-30" | "3m" | "6m" | "ytd" | "12m" | "custom";

const PRESET_OPTIONS: { key: Preset; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-30", label: "Last 30 days" },
  { key: "3m", label: "Last 3 months" },
  { key: "6m", label: "Last 6 months" },
  { key: "ytd", label: "Year to date" },
  { key: "12m", label: "Last 12 months" },
];

function presetRange(preset: Preset, now: Date): { from: Date; to: Date } | null {
  switch (preset) {
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
    case "custom":   return null;
  }
}

// Returns the "previous period of the same length" immediately before the given range.
// Example: Apr 1-20 (20 days) -> Mar 12-31 (20 days).
function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const days = differenceInDays(to, from) + 1;
  const prevTo = subDays(from, 1);
  const prevFrom = subDays(prevTo, days - 1);
  return { from: prevFrom, to: prevTo };
}

// Returns the "same period last month" — swaps month-of-year down by one.
function sameRangeLastMonth(from: Date, to: Date): { from: Date; to: Date } {
  return { from: subMonths(from, 1), to: subMonths(to, 1) };
}

type CompareMode = "off" | "prev-period" | "prev-month" | "custom";

export default function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const now = new Date();

  // Parse current selection from URL (defaults: this month)
  const currentFrom = sp.get("from")
    ? new Date(sp.get("from") + "T00:00:00")
    : startOfMonth(now);
  const currentTo = sp.get("to")
    ? new Date(sp.get("to") + "T00:00:00")
    : now;
  const currentCompareFrom = sp.get("compareFrom") ? new Date(sp.get("compareFrom") + "T00:00:00") : null;
  const currentCompareTo = sp.get("compareTo") ? new Date(sp.get("compareTo") + "T00:00:00") : null;
  const urlPreset = (sp.get("preset") as Preset) || "this-month";

  const [draftFrom, setDraftFrom] = useState(format(currentFrom, "yyyy-MM-dd"));
  const [draftTo, setDraftTo] = useState(format(currentTo, "yyyy-MM-dd"));
  const [compareMode, setCompareMode] = useState<CompareMode>(() => {
    if (!currentCompareFrom) return "off";
    // Guess mode: compare period length matches previous period?
    const prev = previousPeriod(currentFrom, currentTo);
    if (
      format(prev.from, "yyyy-MM-dd") === format(currentCompareFrom, "yyyy-MM-dd") &&
      format(prev.to, "yyyy-MM-dd") === format(currentCompareTo!, "yyyy-MM-dd")
    ) return "prev-period";
    const prevM = sameRangeLastMonth(currentFrom, currentTo);
    if (
      format(prevM.from, "yyyy-MM-dd") === format(currentCompareFrom, "yyyy-MM-dd") &&
      format(prevM.to, "yyyy-MM-dd") === format(currentCompareTo!, "yyyy-MM-dd")
    ) return "prev-month";
    return "custom";
  });
  const [draftCompareFrom, setDraftCompareFrom] = useState(
    currentCompareFrom ? format(currentCompareFrom, "yyyy-MM-dd") : "",
  );
  const [draftCompareTo, setDraftCompareTo] = useState(
    currentCompareTo ? format(currentCompareTo, "yyyy-MM-dd") : "",
  );

  const rangeLabel = useMemo(() => {
    return `${format(currentFrom, "MMM d")} - ${format(currentTo, "MMM d, yyyy")}`;
  }, [currentFrom, currentTo]);
  const compareLabel = useMemo(() => {
    if (!currentCompareFrom || !currentCompareTo) return null;
    return `vs ${format(currentCompareFrom, "MMM d")} - ${format(currentCompareTo, "MMM d, yyyy")}`;
  }, [currentCompareFrom, currentCompareTo]);

  const apply = (opts: { from: Date; to: Date; preset?: Preset; mode: CompareMode; compareFrom?: Date | null; compareTo?: Date | null }) => {
    const p = new URLSearchParams(Array.from(sp.entries()));
    p.set("from", format(opts.from, "yyyy-MM-dd"));
    p.set("to", format(opts.to, "yyyy-MM-dd"));
    if (opts.preset) p.set("preset", opts.preset); else p.delete("preset");

    // Compute comparison range based on mode
    let cmpFrom: Date | null = null;
    let cmpTo: Date | null = null;
    if (opts.mode === "prev-period") {
      const prev = previousPeriod(opts.from, opts.to);
      cmpFrom = prev.from; cmpTo = prev.to;
    } else if (opts.mode === "prev-month") {
      const prev = sameRangeLastMonth(opts.from, opts.to);
      cmpFrom = prev.from; cmpTo = prev.to;
    } else if (opts.mode === "custom" && opts.compareFrom && opts.compareTo) {
      cmpFrom = opts.compareFrom; cmpTo = opts.compareTo;
    }
    if (cmpFrom && cmpTo) {
      p.set("compareFrom", format(cmpFrom, "yyyy-MM-dd"));
      p.set("compareTo", format(cmpTo, "yyyy-MM-dd"));
    } else {
      p.delete("compareFrom");
      p.delete("compareTo");
    }

    start(() => {
      router.push(`${pathname}?${p.toString()}`);
      setOpen(false);
    });
  };

  const applyPreset = (preset: Preset) => {
    const range = presetRange(preset, now);
    if (!range) return;
    apply({ from: range.from, to: range.to, preset, mode: compareMode });
  };

  const applyCustom = () => {
    const f = new Date(draftFrom + "T00:00:00");
    const t = new Date(draftTo + "T00:00:00");
    if (isNaN(f.getTime()) || isNaN(t.getTime()) || f > t) return;
    const opts: any = { from: f, to: t, preset: "custom" as Preset, mode: compareMode };
    if (compareMode === "custom") {
      opts.compareFrom = draftCompareFrom ? new Date(draftCompareFrom + "T00:00:00") : null;
      opts.compareTo = draftCompareTo ? new Date(draftCompareTo + "T00:00:00") : null;
    }
    apply(opts);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 bg-white/90 hover:bg-white text-[13px] font-medium text-foreground shadow-sm transition-colors"
      >
        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <div className="flex flex-col items-start leading-tight">
          <span>{rangeLabel}</span>
          {compareLabel && <span className="text-[10px] text-gray-500">{compareLabel}</span>}
        </div>
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[40]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[360px] rounded-2xl border border-gray-100 bg-white shadow-xl z-[50] overflow-hidden">
            <div
              className="h-[3px] w-full"
              style={{ background: "linear-gradient(90deg, #6B93D8, #9B7ED0, #D06AB8, #F04E80)" }}
            />
            <div className="p-4 space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Range</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESET_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => applyPreset(p.key)}
                      className={`text-[12px] font-medium px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                        urlPreset === p.key
                          ? "bg-foreground text-white"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Custom</div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={draftFrom}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="flex-1 text-[12px] px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6B93D8]/40"
                  />
                  <span className="text-[11px] text-gray-400">to</span>
                  <input
                    type="date"
                    value={draftTo}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="flex-1 text-[12px] px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6B93D8]/40"
                  />
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Compare to</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: "off" as CompareMode, label: "Off" },
                    { key: "prev-period" as CompareMode, label: "Previous period" },
                    { key: "prev-month" as CompareMode, label: "Previous month" },
                    { key: "custom" as CompareMode, label: "Custom range" },
                  ].map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setCompareMode(m.key)}
                      className={`text-[12px] font-medium px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                        compareMode === m.key
                          ? "bg-gradient-to-r from-[#6B93D8]/15 via-[#9B7ED0]/15 to-[#D06AB8]/15 text-foreground ring-1 ring-[#9B7ED0]/40"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {compareMode === "custom" && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="date"
                      value={draftCompareFrom}
                      onChange={(e) => setDraftCompareFrom(e.target.value)}
                      className="flex-1 text-[12px] px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6B93D8]/40"
                    />
                    <span className="text-[11px] text-gray-400">to</span>
                    <input
                      type="date"
                      value={draftCompareTo}
                      onChange={(e) => setDraftCompareTo(e.target.value)}
                      className="flex-1 text-[12px] px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#6B93D8]/40"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                <button
                  onClick={() => apply({ from: currentFrom, to: currentTo, mode: compareMode })}
                  className="text-[12px] text-gray-500 hover:text-foreground px-2 py-1"
                >
                  Update comparison only
                </button>
                <button
                  onClick={applyCustom}
                  disabled={pending}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
                  style={{ background: "linear-gradient(90deg, #6B93D8, #9B7ED0, #D06AB8, #F04E80)" }}
                >
                  {pending ? "Applying..." : "Apply custom"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Server-side helper: parses searchParams and returns the active range + compare
 * range with defaults applied. Every server page should use this to read the URL
 * instead of re-implementing parsing everywhere.
 */
export type ActiveRange = {
  from: Date;
  to: Date;
  fromStr: string;
  toStr: string;
  compareFrom: Date | null;
  compareTo: Date | null;
  compareFromStr: string | null;
  compareToStr: string | null;
  preset: string;
};

export function resolveDateRange(searchParams: {
  from?: string;
  to?: string;
  compareFrom?: string;
  compareTo?: string;
  preset?: string;
}): ActiveRange {
  const now = new Date();
  const from = searchParams.from ? new Date(searchParams.from + "T00:00:00") : startOfMonth(now);
  const to = searchParams.to ? new Date(searchParams.to + "T00:00:00") : now;
  const compareFrom = searchParams.compareFrom ? new Date(searchParams.compareFrom + "T00:00:00") : null;
  const compareTo = searchParams.compareTo ? new Date(searchParams.compareTo + "T00:00:00") : null;
  return {
    from, to,
    fromStr: format(from, "yyyy-MM-dd"),
    toStr: format(to, "yyyy-MM-dd"),
    compareFrom, compareTo,
    compareFromStr: compareFrom ? format(compareFrom, "yyyy-MM-dd") : null,
    compareToStr: compareTo ? format(compareTo, "yyyy-MM-dd") : null,
    preset: searchParams.preset || "this-month",
  };
}
