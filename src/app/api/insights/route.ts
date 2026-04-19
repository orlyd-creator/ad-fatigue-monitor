import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, dailyMetrics, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import { auth } from "@/lib/auth";

interface Insight {
  id: string;
  type: "critical" | "warning" | "opportunity" | "info";
  title: string;
  body: string;
  action: string;
  adName?: string;
  campaignName?: string;
  impact?: string;
}

interface AdData {
  adName: string;
  campaignName: string;
  adsetName: string;
  status: string;
  fatigueScore: number;
  fatigueStage: string;
  signals: Array<{ name: string; label: string; score: number; detail: string }>;
  totalDays: number;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalActions: number;
  recentAvgCTR: number;
  recentAvgCPM: number;
  recentAvgFrequency: number;
  recentAvgCPC: number;
  dailySpend: number;
  baselineCPM: number;
  recentCTRs: number[];
}

async function loadAdDataForInsights(accountIds: string[]): Promise<AdData[]> {
  const userSettings = await db
    .select()
    .from(settings)
    .where(eq(settings.id, 1))
    .get();

  const scoringSettings: ScoringSettings = userSettings
    ? {
        ctrWeight: userSettings.ctrWeight,
        cpmWeight: userSettings.cpmWeight,
        frequencyWeight: userSettings.frequencyWeight,
        conversionWeight: userSettings.conversionWeight,
        costPerResultWeight: userSettings.costPerResultWeight,
        engagementWeight: userSettings.engagementWeight,
        baselineWindowDays: userSettings.baselineWindowDays,
        recentWindowDays: userSettings.recentWindowDays,
        minDataDays: userSettings.minDataDays,
      }
    : DEFAULT_SETTINGS;

  const allAds = await db
    .select()
    .from(ads)
    .where(inArray(ads.accountId, accountIds))
    .all();

  const activeAds = allAds.filter((a) => a.status === "ACTIVE");

  const adDataList: AdData[] = await Promise.all(
    activeAds.map(async (ad) => {
      const metrics = await db
        .select()
        .from(dailyMetrics)
        .where(eq(dailyMetrics.adId, ad.id))
        .orderBy(dailyMetrics.date)
        .all();

      const fatigue = calculateFatigueScore(metrics, scoringSettings);

      const recent = metrics.slice(-7);
      const baseline = metrics.slice(0, Math.max(7, Math.floor(metrics.length / 2)));
      const totalSpend = metrics.reduce((sum, m) => sum + m.spend, 0);
      const totalImpressions = metrics.reduce((sum, m) => sum + m.impressions, 0);
      const totalClicks = metrics.reduce((sum, m) => sum + m.clicks, 0);
      const totalActions = metrics.reduce((sum, m) => sum + m.actions, 0);
      const avgCTR =
        recent.length > 0
          ? recent.reduce((sum, m) => sum + m.ctr, 0) / recent.length
          : 0;
      const avgCPM =
        recent.length > 0
          ? recent.reduce((sum, m) => sum + m.cpm, 0) / recent.length
          : 0;
      const avgFrequency =
        recent.length > 0
          ? recent.reduce((sum, m) => sum + m.frequency, 0) / recent.length
          : 0;
      const avgCPC =
        recent.length > 0
          ? recent.reduce((sum, m) => sum + m.cpc, 0) / recent.length
          : 0;
      const baselineCPM =
        baseline.length > 0
          ? baseline.reduce((sum, m) => sum + m.cpm, 0) / baseline.length
          : 0;
      const dailySpend =
        metrics.length > 0 ? totalSpend / metrics.length : 0;

      // Get last 5 days of CTR for decay detection
      const recentCTRs = metrics.slice(-5).map((m) => m.ctr);

      return {
        adName: ad.adName,
        campaignName: ad.campaignName,
        adsetName: ad.adsetName,
        status: ad.status,
        fatigueScore: fatigue.fatigueScore,
        fatigueStage: fatigue.stage,
        signals: fatigue.signals,
        totalDays: metrics.length,
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalImpressions,
        totalClicks,
        totalActions,
        recentAvgCTR: Math.round(avgCTR * 100) / 100,
        recentAvgCPM: Math.round(avgCPM * 100) / 100,
        recentAvgFrequency: Math.round(avgFrequency * 100) / 100,
        recentAvgCPC: Math.round(avgCPC * 100) / 100,
        dailySpend: Math.round(dailySpend * 100) / 100,
        baselineCPM: Math.round(baselineCPM * 100) / 100,
        recentCTRs,
      };
    })
  );

  return adDataList;
}

function generateInsights(adData: AdData[]): Insight[] {
  const insights: Insight[] = [];
  let idCounter = 0;
  const nextId = () => `insight-${++idCounter}`;

  // Severely fatigued (score 75+) — take action NOW
  const severelyFatigued = adData.filter((a) => a.fatigueScore >= 75).sort((a, b) => b.fatigueScore - a.fatigueScore);
  // Fatiguing (score 50-74) — heading south
  const fatiguing = adData.filter((a) => a.fatigueScore >= 50 && a.fatigueScore < 75);
  // All at-risk
  const fatigued = adData.filter((a) => a.fatigueScore >= 50);
  const earlyWarning = adData.filter((a) => a.fatigueScore >= 25 && a.fatigueScore < 50);
  const healthy = adData
    .filter((a) => a.fatigueScore < 25)
    .sort((a, b) => b.recentAvgCTR - a.recentAvgCTR);

  // 0. SEVERE FATIGUE — top priority, spending $/day on dead ads
  if (severelyFatigued.length > 0) {
    const wastedDaily = severelyFatigued.reduce((s, a) => s + a.dailySpend, 0);
    const worst = severelyFatigued[0];
    insights.push({
      id: nextId(),
      type: "critical",
      title: `🚨 ${severelyFatigued.length} Ad${severelyFatigued.length > 1 ? "s" : ""} Severely Fatigued`,
      body: `"${worst.adName}" is scoring ${worst.fatigueScore}/100 (${worst.fatigueStage}) — CTR ${worst.recentAvgCTR}%, freq ${worst.recentAvgFrequency}x. You're burning ~$${wastedDaily.toFixed(0)}/day on dead creative.`,
      action: `Pause ${severelyFatigued.slice(0, 3).map((a) => `"${a.adName}"`).join(", ")} immediately. Move budget to winners.`,
      adName: worst.adName,
      campaignName: worst.campaignName,
      impact: `Save $${wastedDaily.toFixed(0)}/day`,
    });
  }

  // 1. Budget Waste Alert — fatiguing but not yet severe
  if (fatiguing.length > 0) {
    const wastedDaily = fatiguing.reduce((s, a) => s + a.dailySpend, 0);
    if (wastedDaily > 0) {
      insights.push({
        id: nextId(),
        type: "warning",
        title: "Budget Leak",
        body: `${fatiguing.length} ad${fatiguing.length > 1 ? "s are" : " is"} fatiguing (score 50-74) — performance actively declining. ~$${wastedDaily.toFixed(0)}/day is working harder than it needs to.`,
        action: `Queue replacement creative for ${fatiguing.slice(0, 3).map((a) => `"${a.adName}"`).join(", ")}. Plan the swap within 3-5 days.`,
        impact: `At risk: $${wastedDaily.toFixed(0)}/day`,
      });
    }
  }

  // 2. Creative Refresh Needed — ads running 30+ days with high frequency
  for (const ad of adData) {
    if (ad.totalDays >= 30 && ad.recentAvgFrequency > 3) {
      insights.push({
        id: nextId(),
        type: "warning",
        title: "Creative Refresh Needed",
        body: `Ad "${ad.adName}" has been running for ${ad.totalDays} days with frequency above ${ad.recentAvgFrequency.toFixed(1)}x. Time for new creative.`,
        action: `Create a fresh variant of "${ad.adName}" with a new hook, visual, or format (if video, try static or carousel).`,
        adName: ad.adName,
        campaignName: ad.campaignName,
      });
    }
  }

  // 3. Winning Ad Scale Opportunity — only truly healthy ads (score < 20, stage = healthy)
  for (const ad of healthy) {
    if (ad.recentAvgCTR >= 1.2 && ad.fatigueScore < 20 && ad.fatigueStage === "healthy") {
      // Double-check: don't recommend scaling an ad that appears in fatigued/warning lists
      const isFatiguing = fatigued.some(f => f.adName === ad.adName);
      if (isFatiguing) continue;
      insights.push({
        id: nextId(),
        type: "opportunity",
        title: "Winning Ad — Scale Opportunity",
        body: `Ad "${ad.adName}" has ${ad.recentAvgCTR}% CTR and low fatigue (score ${ad.fatigueScore}) — increase budget 15-20%.`,
        action: `Increase daily budget on "${ad.adName}" by 15-20%. Avoid more than 30% to stay in Meta's learning phase.`,
        adName: ad.adName,
        campaignName: ad.campaignName,
        impact: `Grow conversions at $${ad.recentAvgCPC.toFixed(2)} CPC`,
      });
    }
  }

  // 4. Audience Saturation Warning — campaign with multiple high-frequency ads
  const campaignGroups: Record<string, AdData[]> = {};
  for (const ad of adData) {
    if (!campaignGroups[ad.campaignName]) campaignGroups[ad.campaignName] = [];
    campaignGroups[ad.campaignName].push(ad);
  }
  for (const [campaignName, campaignAds] of Object.entries(campaignGroups)) {
    const highFreqAds = campaignAds.filter((a) => a.recentAvgFrequency > 3);
    if (highFreqAds.length >= 3) {
      insights.push({
        id: nextId(),
        type: "warning",
        title: "Audience Saturation Warning",
        body: `Campaign "${campaignName}" has ${highFreqAds.length} ads all with frequency above 3x — your audience is saturated. Expand targeting.`,
        action: `Add new interest-based or lookalike audiences to "${campaignName}". Consider broadening age/geo targeting.`,
        campaignName,
      });
    }
  }

  // 5. CPM Spike Alert — CPM jumped 40%+ vs baseline
  for (const ad of adData) {
    if (ad.baselineCPM > 0 && ad.recentAvgCPM > 0) {
      const cpmChange =
        ((ad.recentAvgCPM - ad.baselineCPM) / ad.baselineCPM) * 100;
      if (cpmChange >= 40) {
        insights.push({
          id: nextId(),
          type: "warning",
          title: "CPM Spike Alert",
          body: `CPM on "${ad.adName}" jumped ${Math.round(cpmChange)}% vs baseline ($${ad.baselineCPM} -> $${ad.recentAvgCPM}). Meta is charging more to reach your audience.`,
          action: `Review audience overlap in "${ad.campaignName}" and consider refreshing creative or expanding targeting.`,
          adName: ad.adName,
          campaignName: ad.campaignName,
          impact: `CPM up ${Math.round(cpmChange)}%`,
        });
      }
    }
  }

  // 6. CTR Decay Pattern — CTR dropping 3+ days in a row
  for (const ad of adData) {
    if (ad.recentCTRs.length >= 3) {
      const last3 = ad.recentCTRs.slice(-3);
      const isDecaying =
        last3[0] > last3[1] && last3[1] > last3[2] && last3[0] > 0;
      if (isDecaying) {
        const dropPct =
          last3[0] > 0
            ? Math.round(((last3[0] - last3[2]) / last3[0]) * 100)
            : 0;
        if (dropPct >= 10) {
          insights.push({
            id: nextId(),
            type: "info",
            title: "CTR Decay Pattern",
            body: `CTR on "${ad.adName}" has dropped ${dropPct}% over 3 days in a row (${last3[0].toFixed(2)}% -> ${last3[2].toFixed(2)}%). Classic fatigue pattern starting.`,
            action: `Start prepping a replacement creative for "${ad.adName}" now. You have a few days before it fully fatigues.`,
            adName: ad.adName,
            campaignName: ad.campaignName,
          });
        }
      }
    }
  }

  // 7. Quick Win — pair a bad ad with a truly healthy ad for budget reallocation
  if (fatigued.length > 0 && healthy.length > 0) {
    const worst = fatigued.sort((a, b) => b.fatigueScore - a.fatigueScore)[0];
    const best = healthy.find(a => a.fatigueStage === "healthy" && a.fatigueScore < 20);
    if (worst && best && worst.dailySpend > 0) {
      insights.push({
        id: nextId(),
        type: "opportunity",
        title: "Quick Win",
        body: `Pause "${worst.adName}" (score ${worst.fatigueScore}) and move its ~$${worst.dailySpend.toFixed(0)}/day budget to "${best.adName}" (score ${best.fatigueScore}, ${best.recentAvgCTR}% CTR).`,
        action: `Pause "${worst.adName}" in Ads Manager and increase "${best.adName}" budget by $${worst.dailySpend.toFixed(0)}/day.`,
        impact: `Save ~$${worst.dailySpend.toFixed(0)}/day`,
      });
    }
  }

  // 8. Signal-level insights — use individual signals to explain WHY
  for (const ad of [...severelyFatigued, ...fatiguing].slice(0, 5)) {
    const top = [...ad.signals].sort((a, b) => b.score - a.score).slice(0, 2);
    if (top.length === 0 || top[0].score < 50) continue;
    const worst = top[0];
    const second = top[1];
    const why = second && second.score >= 40 ? `${worst.label} and ${second.label}` : worst.label;

    insights.push({
      id: nextId(),
      type: ad.fatigueScore >= 75 ? "critical" : "warning",
      title: `Why "${ad.adName.slice(0, 40)}${ad.adName.length > 40 ? "..." : ""}" is Fatiguing`,
      body: `Primary drivers: ${why}. ${worst.detail}.`,
      action: `${ad.recentAvgFrequency > 3.5 ? "Audience is saturated — launch new creative or expand targeting." : worst.name === "ctr_decline" ? "Hook is stale — try a new opening 3 seconds, different thumbnail, or punchier headline." : worst.name === "cpm_rising" ? "Meta is penalizing relevance. Refresh creative or pause and relaunch." : worst.name === "frequency" ? "Audience saturated — broaden to lookalikes or a new interest stack." : "Rework creative hook or expand audience."}`,
      adName: ad.adName,
      campaignName: ad.campaignName,
    });
  }

  // 9. Early warning — ads trending toward fatigue (score 25-49)
  const earlyWarningBad = earlyWarning.filter((a) => {
    const topSignal = [...a.signals].sort((x, y) => y.score - x.score)[0];
    return topSignal && topSignal.score >= 50;
  });
  for (const ad of earlyWarningBad.slice(0, 3)) {
    const topSignal = [...ad.signals].sort((a, b) => b.score - a.score)[0];
    insights.push({
      id: nextId(),
      type: "info",
      title: "Early Warning",
      body: `"${ad.adName}" isn't fatigued yet (score ${ad.fatigueScore}) but ${topSignal.label.toLowerCase()} is elevated. ${topSignal.detail}.`,
      action: `Start prepping replacement creative now — you've got ~${ad.fatigueScore < 35 ? "7-10" : "3-5"} days before this needs to rotate.`,
      adName: ad.adName,
      campaignName: ad.campaignName,
    });
  }

  // 10. Zero-conversion spenders — burning budget with no results
  const zeroConv = adData.filter((a) => a.totalActions === 0 && a.totalSpend > 50 && a.totalDays >= 7);
  if (zeroConv.length > 0) {
    const totalBurn = zeroConv.reduce((s, a) => s + a.totalSpend, 0);
    insights.push({
      id: nextId(),
      type: "critical",
      title: "Zero-Conversion Money Pit",
      body: `${zeroConv.length} ad${zeroConv.length > 1 ? "s have" : " has"} spent $${totalBurn.toFixed(0)}+ with 0 conversions over 7+ days. This is pure burn.`,
      action: `Pause ${zeroConv.slice(0, 3).map((a) => `"${a.adName}"`).join(", ")} and kill any that haven't converted after $100 spend.`,
      impact: `Recover $${totalBurn.toFixed(0)}`,
    });
  }

  // Sort by priority: critical > warning > opportunity > info
  const priorityOrder: Record<string, number> = {
    critical: 0,
    warning: 1,
    opportunity: 2,
    info: 3,
  };
  insights.sort(
    (a, b) => (priorityOrder[a.type] ?? 4) - (priorityOrder[b.type] ?? 4)
  );

  return insights;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const accountId = (session as any).accountId as string;
    const allAccountIds: string[] =
      (session as any).allAccountIds || [accountId];
    if (!accountId) {
      return NextResponse.json(
        { error: "No account connected" },
        { status: 400 }
      );
    }

    const adData = await loadAdDataForInsights(allAccountIds);
    const insights = generateInsights(adData);

    return NextResponse.json({ insights });
  } catch (error: unknown) {
    console.error("Insights API error:", error);
    return NextResponse.json(
      { error: "Failed to generate insights" },
      { status: 500 }
    );
  }
}
