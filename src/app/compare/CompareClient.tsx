"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type AdStat = {
  adId: string;
  adName: string;
  campaignName: string;
  status: string;
  thumbnailUrl: string;
  spend: number;
  conversions: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  costPerConv: number | null;
};

type Props = {
  rangeFrom: string;
  rangeTo: string;
  range: string;
  winners: AdStat[];
  losers: AdStat[];
  totalSpend: number;
  totalConversions: number;
  adCount: number;
  isPublic: boolean;
};

function fmtMoney(n: number): string {
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtMoneyPrecise(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function AdCompareCard({
  ad,
  verdict,
  rank,
  isPublic,
}: {
  ad: AdStat;
  verdict: "winner" | "loser";
  rank: number;
  isPublic: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = ad.thumbnailUrl;
  const showImage = !!src && !imgFailed;
  const isWinner = verdict === "winner";
  const accent = isWinner ? "from-emerald-100 to-emerald-50 border-emerald-200" : "from-rose-100 to-rose-50 border-rose-200";
  const badge = isWinner ? "bg-emerald-500 text-white" : "bg-rose-500 text-white";
  const statColor = isWinner ? "text-emerald-700" : "text-rose-700";
  const label = isWinner ? "Scaling opportunity" : ad.conversions === 0 ? "Spending with no results" : "High cost per lead";

  const body = (
    <div className={`lv-card relative overflow-hidden bg-gradient-to-br ${accent} border-2 hover:shadow-lg transition-shadow`}>
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <span className={`${badge} text-[11px] font-bold px-2 py-0.5 rounded-full shadow-sm`}>
          #{rank}
        </span>
        <span className="text-[11px] font-medium text-foreground bg-white/80 px-2 py-0.5 rounded-full">
          {label}
        </span>
      </div>
      {showImage ? (
        <img
          src={src}
          alt=""
          onError={() => setImgFailed(true)}
          className="w-full aspect-video object-cover"
        />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-[#6B93D8]/20 via-[#9B7ED0]/20 to-[#D06AB8]/20 flex items-center justify-center">
          <svg className="w-10 h-10 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
        </div>
      )}
      <div className="p-4">
        <div className="text-[14px] font-semibold text-foreground truncate" title={ad.adName}>
          {ad.adName}
        </div>
        <div className="text-[11px] text-muted-foreground truncate mb-3">
          {ad.campaignName} · {ad.status}
        </div>

        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spend</div>
            <div className="font-semibold text-foreground tabular-nums">{fmtMoney(ad.spend)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Conversions</div>
            <div className={`font-semibold tabular-nums ${ad.conversions === 0 ? "text-rose-600" : "text-foreground"}`}>
              {ad.conversions}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost / result</div>
            <div className={`font-semibold tabular-nums ${statColor}`}>
              {ad.costPerConv !== null ? fmtMoneyPrecise(ad.costPerConv) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">CTR</div>
            <div className="font-semibold text-foreground tabular-nums">{ad.ctr.toFixed(2)}%</div>
          </div>
        </div>
      </div>
    </div>
  );

  if (isPublic) return body;
  return (
    <Link href={`/ad/${ad.adId}`} className="block">
      {body}
    </Link>
  );
}

export default function CompareClient({
  rangeFrom,
  rangeTo,
  range,
  winners,
  losers,
  totalSpend,
  totalConversions,
  adCount,
  isPublic,
}: Props) {
  const router = useRouter();
  const blendedCPL = totalConversions > 0 ? totalSpend / totalConversions : null;

  const setRange = (r: string) => {
    router.push(`/compare?range=${r}`);
  };

  const presets = [
    { key: "7d", label: "Last 7 days" },
    { key: "14d", label: "Last 14 days" },
    { key: "30d", label: "Last 30 days" },
    { key: "90d", label: "Last 90 days" },
  ];

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
          Compare
        </div>
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Winners vs losers
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Top and bottom ads by spend efficiency. Scale the left column, cut or refresh the right.
        </p>
      </div>

      {/* Range selector */}
      <div className="lv-card p-4 mb-6 flex flex-wrap gap-2 items-center">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => setRange(p.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
              range === p.key
                ? "bg-[#9B7ED0] text-white shadow-sm"
                : "bg-white/60 text-muted-foreground hover:bg-white hover:text-foreground border border-border"
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-[11px] text-muted-foreground ml-auto">
          {rangeFrom} → {rangeTo}
        </span>
      </div>

      {/* Summary bar */}
      <div className="lv-card p-6 mb-6 bg-gradient-to-br from-[#6B93D8]/5 via-[#9B7ED0]/5 to-[#D06AB8]/5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ads in range</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">{adCount}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total spend</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">{fmtMoney(totalSpend)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total conversions</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">{totalConversions}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Blended cost/result</div>
            <div className="text-[22px] font-bold text-foreground tabular-nums">
              {blendedCPL !== null ? fmtMoneyPrecise(blendedCPL) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Two-column: winners vs losers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Winners */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <h2 className="text-[15px] font-semibold text-foreground">Top winners</h2>
            <span className="text-[12px] text-muted-foreground">— lowest cost per result</span>
          </div>
          {winners.length === 0 ? (
            <div className="lv-card p-6 text-[13px] text-muted-foreground italic">
              No ads with meaningful spend and conversions in this range.
            </div>
          ) : (
            <div className="space-y-4">
              {winners.map((ad, i) => (
                <AdCompareCard
                  key={ad.adId}
                  ad={ad}
                  verdict="winner"
                  rank={i + 1}
                  isPublic={isPublic}
                />
              ))}
            </div>
          )}
        </div>

        {/* Losers */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            <h2 className="text-[15px] font-semibold text-foreground">Biggest losers</h2>
            <span className="text-[12px] text-muted-foreground">— zero results or highest cost</span>
          </div>
          {losers.length === 0 ? (
            <div className="lv-card p-6 text-[13px] text-muted-foreground italic">
              Nothing obviously wasting spend — good sign.
            </div>
          ) : (
            <div className="space-y-4">
              {losers.map((ad, i) => (
                <AdCompareCard
                  key={ad.adId}
                  ad={ad}
                  verdict="loser"
                  rank={i + 1}
                  isPublic={isPublic}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 text-[12px] text-muted-foreground leading-relaxed">
        Only ads with at least $50 spend in the range are considered — so we don't label a $10 ad with 1 lead
        as your top winner. {isPublic ? "" : "Click any card to see the full ad detail page."}
      </div>
    </main>
  );
}
