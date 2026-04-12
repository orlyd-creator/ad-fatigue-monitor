export type FatigueStage = "healthy" | "early_warning" | "fatiguing" | "fatigued";

export interface SignalResult {
  name: string;
  label: string;
  score: number; // 0-100
  weight: number;
  detail: string; // Human-readable explanation
}

export interface FatigueResult {
  fatigueScore: number; // 0-100
  stage: FatigueStage;
  signals: SignalResult[];
  baselineWindow: { start: string; end: string } | null;
  recentWindow: { start: string; end: string } | null;
  dataStatus: "sufficient" | "collecting" | "no_data";
}

export interface ScoringSettings {
  ctrWeight: number;
  cpmWeight: number;
  frequencyWeight: number;
  conversionWeight: number;
  costPerResultWeight: number;
  engagementWeight: number;
  baselineWindowDays: number;
  recentWindowDays: number;
  minDataDays: number;
}

export const DEFAULT_SETTINGS: ScoringSettings = {
  ctrWeight: 0.20,
  cpmWeight: 0.15,
  frequencyWeight: 0.25,
  conversionWeight: 0.20,
  costPerResultWeight: 0.10,
  engagementWeight: 0.10,
  baselineWindowDays: 7,
  recentWindowDays: 3,
  minDataDays: 5,
};

export const STAGE_THRESHOLDS = {
  healthy: 25,
  early_warning: 50,
  fatiguing: 75,
} as const;

export function getStage(score: number): FatigueStage {
  if (score < STAGE_THRESHOLDS.healthy) return "healthy";
  if (score < STAGE_THRESHOLDS.early_warning) return "early_warning";
  if (score < STAGE_THRESHOLDS.fatiguing) return "fatiguing";
  return "fatigued";
}

export const STAGE_COLORS: Record<FatigueStage, string> = {
  healthy: "#22c55e",
  early_warning: "#f59e0b",
  fatiguing: "#f97316",
  fatigued: "#ea384c",
};

export const STAGE_BG: Record<FatigueStage, string> = {
  healthy: "#f0fdf4",
  early_warning: "#fffbeb",
  fatiguing: "#fff7ed",
  fatigued: "#fef2f2",
};

export const STAGE_GLOW: Record<FatigueStage, string> = {
  healthy: "glow-green",
  early_warning: "glow-yellow",
  fatiguing: "glow-orange",
  fatigued: "glow-red",
};

export const STAGE_LABELS: Record<FatigueStage, string> = {
  healthy: "Looking Good",
  early_warning: "Watch This",
  fatiguing: "Needs Attention",
  fatigued: "Swap It Out",
};

export const STAGE_EMOJI: Record<FatigueStage, string> = {
  healthy: "",
  early_warning: "",
  fatiguing: "",
  fatigued: "",
};
