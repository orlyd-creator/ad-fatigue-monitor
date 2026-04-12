"use client";

import { STAGE_COLORS, STAGE_LABELS, STAGE_BG, type FatigueStage } from "@/lib/fatigue/types";

interface Props {
  score: number;
  stage: FatigueStage;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export default function FatigueScoreBadge({ score, stage, size = "md", showLabel = true }: Props) {
  const color = STAGE_COLORS[stage];
  const label = STAGE_LABELS[stage];
  const bg = STAGE_BG[stage];

  const sizes = {
    sm: { ring: 44, stroke: 3, font: "text-xs font-bold", labelFont: "text-[9px]" },
    md: { ring: 64, stroke: 3, font: "text-lg font-bold", labelFont: "text-[10px]" },
    lg: { ring: 120, stroke: 4, font: "text-4xl font-bold", labelFont: "text-xs" },
  };
  const s = sizes[size];
  const radius = (s.ring - s.stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;

  const pulseClass = stage === "early_warning" ? "ring-pulse-warning"
    : stage === "fatiguing" ? "ring-pulse-fatiguing"
    : stage === "fatigued" ? "ring-pulse-fatigued"
    : "";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`relative ${pulseClass}`} style={{ width: s.ring, height: s.ring }}>
        <svg width={s.ring} height={s.ring} className="-rotate-90">
          <circle cx={s.ring / 2} cy={s.ring / 2} r={radius} fill="none" stroke="#FCE7F3" strokeWidth={s.stroke} />
          <circle cx={s.ring / 2} cy={s.ring / 2} r={radius} fill="none" stroke={color} strokeWidth={s.stroke}
            strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round"
            className="transition-all duration-1000 ease-out" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={s.font} style={{ color }}>{score}</span>
        </div>
      </div>
      {showLabel && (
        <span className={`${s.labelFont} font-semibold px-3 py-1 rounded-full`}
          style={{ color, backgroundColor: bg }}>
          {label}
        </span>
      )}
    </div>
  );
}
