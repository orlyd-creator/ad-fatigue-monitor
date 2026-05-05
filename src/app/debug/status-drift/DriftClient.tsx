"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Drift {
  id: string;
  adName: string;
  campaignName: string;
  accountId: string;
  dbStatus: string;
  metaStatus: string;
  lastSyncedAt: number | null;
  staleMinutes: number | null;
  fixed?: boolean;
}

interface DriftData {
  summary: {
    checkedAt: string;
    accountsChecked: string[];
    dbActiveCount: number;
    driftedCount: number;
    archivedCount: number;
    errorCount: number;
    fixedCount: number;
    mode?: string;
  };
  drifted: Drift[];
  archived: Drift[];
  errors: Array<{ accountId?: string; message: string }>;
}

interface Props {
  initialData: DriftData | null;
  initialError: string | null;
}

const HEALTH = {
  perfect:  { label: "All in sync",        color: "#22c55e", bg: "#f0fdf4", track: "#dcfce7" },
  warm:     { label: "Minor drift",        color: "#f59e0b", bg: "#fffbeb", track: "#fef3c7" },
  hot:      { label: "Drifted",            color: "#f97316", bg: "#fff7ed", track: "#fed7aa" },
  critical: { label: "Sync is broken",     color: "#ea384c", bg: "#fef2f2", track: "#fecaca" },
};

function pickHealth(data: DriftData) {
  const total = data.summary.driftedCount + data.summary.archivedCount;
  if (total === 0) return HEALTH.perfect;
  // Anything stale > 10 min is the sync path failing, not just "we haven't checked yet"
  const worst = [...data.drifted, ...data.archived].reduce(
    (m, d) => Math.max(m, d.staleMinutes ?? 0), 0,
  );
  if (worst > 30) return HEALTH.critical;
  if (worst > 10) return HEALTH.hot;
  return HEALTH.warm;
}

function staleColor(min: number | null) {
  if (min === null) return "#64748b";
  if (min > 30) return "#ea384c";
  if (min > 10) return "#f97316";
  if (min > 5) return "#f59e0b";
  return "#22c55e";
}

export default function DriftClient({ initialData, initialError }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<DriftData | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState<"audit" | "fix" | null>(null);

  const runAudit = (fix: boolean) => {
    setBusy(fix ? "fix" : "audit");
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/debug/status-drift${fix ? "?fix=1" : ""}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setError(`Audit failed: HTTP ${res.status}`);
          setBusy(null);
          return;
        }
        const body = await res.json();
        setData(body);
        setBusy(null);
        if (fix && body.summary.fixedCount > 0) {
          router.refresh();
        }
      } catch (err: any) {
        setError(err?.message || String(err));
        setBusy(null);
      }
    });
  };

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
      });
    } catch {
      return iso;
    }
  };

  const health = data ? pickHealth(data) : null;
  const totalDrift = data ? data.summary.driftedCount + data.summary.archivedCount : 0;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-8">
        <div className="display-label mb-1.5">Diagnostics</div>
        <h1 className="display-heading mb-1.5">Status drift audit</h1>
        <p className="text-[13.5px] text-muted-foreground">
          Checks every ACTIVE ad in your DB against Meta&apos;s live view. If anything&apos;s drifted for more than 5 minutes, the auto-refresh is sleeping on the job.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700">
          {error}
        </div>
      )}

      {data && health && (
        <div className="rounded-2xl lv-card p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: health.bg }}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={health.color} strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-foreground">Sync health</h2>
                <p className="text-[11px] text-muted-foreground">Last checked {fmtDate(data.summary.checkedAt)}</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: health.bg, color: health.color }}>
                {health.label}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <Stat label="DB ACTIVE" value={data.summary.dbActiveCount} />
            <Stat label="Drifted" value={data.summary.driftedCount} valueColor={data.summary.driftedCount > 0 ? "#f97316" : undefined} />
            <Stat label="Archived in Meta" value={data.summary.archivedCount} valueColor={data.summary.archivedCount > 0 ? "#ea384c" : undefined} />
            <Stat label="Errors" value={data.summary.errorCount} valueColor={data.summary.errorCount > 0 ? "#ea384c" : undefined} />
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => runAudit(false)}
          disabled={isPending}
          className="cursor-pointer rounded-xl px-4 py-2.5 text-[13px] font-semibold border border-gray-200 bg-white text-foreground hover:bg-gray-50 disabled:opacity-60 transition"
        >
          {busy === "audit" ? "Auditing..." : "Re-run audit"}
        </button>
        {totalDrift > 0 && (
          <button
            onClick={() => runAudit(true)}
            disabled={isPending}
            className="cursor-pointer rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-60 transition"
          >
            {busy === "fix" ? "Fixing..." : `Fix ${totalDrift} drifted ad${totalDrift !== 1 ? "s" : ""} now`}
          </button>
        )}
      </div>

      {data && data.drifted.length > 0 && (
        <Section title="Drifted (paused/archived in Meta but ACTIVE in DB)" count={data.drifted.length}>
          <DriftTable rows={data.drifted} />
        </Section>
      )}

      {data && data.archived.length > 0 && (
        <Section title="Deleted in Meta but ACTIVE in DB" count={data.archived.length}>
          <DriftTable rows={data.archived} />
        </Section>
      )}

      {data && data.errors.length > 0 && (
        <div className="rounded-2xl lv-card p-5 mb-6">
          <h3 className="text-[14px] font-semibold text-foreground mb-3">Errors during audit</h3>
          <ul className="space-y-1.5">
            {data.errors.map((e, i) => (
              <li key={i} className="text-[12px] text-rose-700">
                {e.accountId ? <span className="font-mono">{e.accountId}: </span> : null}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && totalDrift === 0 && data.summary.errorCount === 0 && (
        <div className="rounded-2xl lv-card p-8 text-center">
          <div className="text-[48px] mb-3">{"✨"}</div>
          <h3 className="text-[16px] font-semibold text-foreground mb-1">Everything is in sync</h3>
          <p className="text-[13px] text-muted-foreground max-w-sm mx-auto">
            All {data.summary.dbActiveCount} ACTIVE ads in your DB match Meta&apos;s view. Auto-refresh is doing its job.
          </p>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, valueColor }: { label: string; value: number; valueColor?: string }) {
  return (
    <div className="glass rounded-xl px-4 py-3">
      <div className="text-[10px] text-muted uppercase tracking-wider font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl lv-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        <span className="text-[11px] font-semibold text-muted-foreground bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
      </div>
      {children}
    </div>
  );
}

function DriftTable({ rows }: { rows: Drift[] }) {
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-gray-100">
            <th className="px-2 py-2 font-medium">Ad</th>
            <th className="px-2 py-2 font-medium">Campaign</th>
            <th className="px-2 py-2 font-medium">DB</th>
            <th className="px-2 py-2 font-medium">Meta</th>
            <th className="px-2 py-2 font-medium text-right">Stale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-50">
              <td className="px-2 py-2.5 max-w-[260px]">
                <a href={`/ad/${r.id}`} className="text-foreground hover:text-[#6B93D8] truncate block font-medium">
                  {r.adName}
                </a>
                {r.fixed && (
                  <span className="text-[10px] text-emerald-600 font-semibold">Fixed</span>
                )}
              </td>
              <td className="px-2 py-2.5 text-muted-foreground truncate max-w-[200px]">{r.campaignName}</td>
              <td className="px-2 py-2.5">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider bg-green-50 text-green-600">
                  {r.dbStatus}
                </span>
              </td>
              <td className="px-2 py-2.5">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider bg-rose-50 text-rose-600">
                  {r.metaStatus}
                </span>
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: staleColor(r.staleMinutes) }}>
                {r.staleMinutes === null ? "never synced" : `${r.staleMinutes}m`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
