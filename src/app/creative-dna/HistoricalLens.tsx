"use client";

import { useState } from "react";
import type { AdScored } from "@/lib/creative/dna";

interface ThemeWinner {
  theme: string;
  avgCtr: number;
  ctrIndex: number;
  adCount: number;
  totalSpend: number;
}

export default function HistoricalLens({
  winners,
  losers,
  themeWinners,
  portfolioCtr,
}: {
  winners: AdScored[];
  losers: AdScored[];
  themeWinners: ThemeWinner[];
  portfolioCtr: number;
}) {
  const [tab, setTab] = useState<"winners" | "losers" | "themes">("winners");

  return (
    <div>
      {/* Tab strip */}
      <div className="flex items-center gap-1.5 mb-3 text-[11.5px]">
        <TabButton active={tab === "winners"} onClick={() => setTab("winners")}>
          Top historical winners
        </TabButton>
        <TabButton active={tab === "losers"} onClick={() => setTab("losers")}>
          Costly losers
        </TabButton>
        <TabButton active={tab === "themes"} onClick={() => setTab("themes")}>
          Theme leaderboard
        </TabButton>
      </div>

      {tab === "winners" && (
        <div className="lv-card-solid divide-y divide-gray-100">
          {winners.length === 0 && <Empty>No paused/archived ads with enough spend to rank yet.</Empty>}
          {winners.map((a) => (
            <HistoricalRow key={a.ad.id} ad={a} portfolioCtr={portfolioCtr} side="winner" />
          ))}
        </div>
      )}
      {tab === "losers" && (
        <div className="lv-card-solid divide-y divide-gray-100">
          {losers.length === 0 && <Empty>No clear historical losers yet — keep running.</Empty>}
          {losers.map((a) => (
            <HistoricalRow key={a.ad.id} ad={a} portfolioCtr={portfolioCtr} side="loser" />
          ))}
        </div>
      )}
      {tab === "themes" && (
        <div className="lv-card-solid p-4 sm:p-5">
          {themeWinners.length === 0 ? (
            <Empty>No theme has enough ads behind it to call yet (minimum 2).</Empty>
          ) : (
            <div className="grid gap-3">
              {themeWinners.map((t) => (
                <ThemeRow key={t.theme} t={t} portfolioCtr={portfolioCtr} />
              ))}
            </div>
          )}
          <p className="text-[12.5px] leading-[1.65] text-foreground/75 mt-4 pt-4 border-t border-gray-100">
            <span className="font-medium text-foreground">How to use this:</span>{" "}
            The themes at the top of this list are the ones the audience has voted for with their clicks across every ad you've ever shipped.
            When you brief the next round, bias toward those framings — and treat themes near the bottom as caution flags, not just dead patterns.
            One ad can lose; a whole theme losing across multiple tries is a real signal.
          </p>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full transition ${
        active ? "bg-foreground text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="lv-card p-6 text-[13px] text-muted-foreground">{children}</div>;
}

function HistoricalRow({ ad, portfolioCtr, side }: { ad: AdScored; portfolioCtr: number; side: "winner" | "loser" }) {
  const accent = side === "winner" ? "#16a34a" : "#be185d";
  const ctrIndex = portfolioCtr > 0 ? ad.recentCtr / portfolioCtr : 1;
  const halfLife = ad.halfLife.halfLifeDays;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {(ad.ad.imageUrl || ad.ad.thumbnailUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.ad.imageUrl || ad.ad.thumbnailUrl || ""} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate" title={ad.ad.adName}>{ad.ad.adName}</div>
        <div className="text-[10.5px] text-gray-500 truncate">
          {ad.cls.themeLabel} · {ad.cls.audienceLabel} · {ad.ad.campaignName}
        </div>
      </div>
      <div className="hidden sm:flex flex-col items-end text-[11px] tabular-nums w-20">
        <div className="text-[9.5px] uppercase tracking-wider text-gray-500">CTR</div>
        <div className="font-semibold" style={{ color: accent }}>{ad.recentCtr.toFixed(2)}%</div>
        <div className="text-[9.5px] text-gray-500">{ctrIndex.toFixed(1)}× port.</div>
      </div>
      <div className="hidden md:flex flex-col items-end text-[11px] tabular-nums w-20">
        <div className="text-[9.5px] uppercase tracking-wider text-gray-500">Half-life</div>
        <div className="font-semibold text-foreground">{halfLife ? `${halfLife}d` : "—"}</div>
      </div>
      <div className="flex flex-col items-end text-[11px] tabular-nums w-24">
        <div className="text-[9.5px] uppercase tracking-wider text-gray-500">Spent</div>
        <div className="font-semibold text-foreground">${Math.round(ad.totalSpend).toLocaleString()}</div>
      </div>
    </div>
  );
}

function ThemeRow({ t, portfolioCtr }: { t: ThemeWinner; portfolioCtr: number }) {
  const tone = t.ctrIndex >= 1.1 ? "#16a34a" : t.ctrIndex >= 0.9 ? "#475569" : "#be185d";
  const barPct = Math.min(100, Math.max(15, t.ctrIndex * 50));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="text-[13.5px] font-medium text-foreground">{t.theme}</div>
        <div className="text-[11.5px] tabular-nums text-foreground/70">
          {t.avgCtr.toFixed(2)}% CTR · {t.ctrIndex.toFixed(1)}× portfolio · {t.adCount} ads · ${Math.round(t.totalSpend).toLocaleString()}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: tone }} />
      </div>
    </div>
  );
}
