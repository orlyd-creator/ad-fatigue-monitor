import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, settings } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";

interface AdSummary {
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
}

function loadAdData() {
  const userSettings = db
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

  const allAds = db.select().from(ads).all();

  const adSummaries: AdSummary[] = allAds.map((ad) => {
    const metrics = db
      .select()
      .from(dailyMetrics)
      .where(eq(dailyMetrics.adId, ad.id))
      .orderBy(dailyMetrics.date)
      .all();

    const fatigue = calculateFatigueScore(metrics, scoringSettings);

    const recent = metrics.slice(-7);
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
    };
  });

  const recentAlerts = db
    .select()
    .from(alerts)
    .orderBy(desc(alerts.createdAt))
    .limit(20)
    .all();

  return { adSummaries, recentAlerts };
}

// --- Intent detection and response generation ---

type Intent =
  | "pause"
  | "best"
  | "budget"
  | "fatigue"
  | "creative"
  | "summary"
  | "compare"
  | "spend_efficiency"
  | "recommendation"
  | "default";

function detectIntent(message: string): Intent {
  const lower = message.toLowerCase();

  const patterns: [Intent, string[]][] = [
    ["pause", ["pause", "stop", "turn off", "kill", "shut down", "disable"]],
    ["best", ["best", "top", "winner", "performing", "strongest", "highest ctr"]],
    ["spend_efficiency", ["waste", "wasted", "efficient", "efficiency", "save", "saving", "optimize", "optimiz"]],
    ["recommendation", ["should", "recommend", "suggestion", "next step", "action", "priority", "priorities", "plan", "strategy", "what do"]],
    ["budget", ["budget", "spend", "money", "cost", "cpm", "cpc", "roi", "roas", "expensive", "cheap"]],
    ["fatigue", ["fatigue", "tired", "dying", "stale", "declining", "dropping", "worse", "deteriorat"]],
    ["creative", ["creative", "refresh", "new", "idea", "copy", "angle", "hook", "image", "video", "ad copy"]],
    ["summary", ["summary", "overview", "how", "report", "status", "dashboard", "what's going on", "update"]],
    ["compare", ["compare", "versus", "vs", "difference", "between"]],
  ];

  for (const [intent, keywords] of patterns) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return intent;
    }
  }
  return "default";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtDollar(n: number): string {
  return "$" + fmt(n);
}

function fmtPct(n: number): string {
  return n.toFixed(2) + "%";
}

function activeAds(summaries: AdSummary[]): AdSummary[] {
  return summaries.filter((a) => a.status === "ACTIVE");
}

function generateResponse(intent: Intent, adSummaries: AdSummary[]): string {
  const active = activeAds(adSummaries);

  if (adSummaries.length === 0) {
    return "No ads in the account yet. Connect your Meta Ads account and sync some campaigns to get started. Once you have data flowing in, I can help you spot fatigue, optimize budget, and plan creative refreshes.";
  }

  const sorted = [...active].sort((a, b) => b.fatigueScore - a.fatigueScore);
  const sortedByCTR = [...active].sort((a, b) => b.recentAvgCTR - a.recentAvgCTR);
  const sortedByCPC = [...active].sort((a, b) => a.recentAvgCPC - b.recentAvgCPC);

  switch (intent) {
    case "pause": {
      const toPause = sorted.filter((a) => a.fatigueScore >= 50).slice(0, 5);
      if (toPause.length === 0) {
        const closest = sorted[0];
        return `All ${active.length} active ads are in decent shape right now. Your highest fatigue score is ${closest?.fatigueScore ?? 0} on "${closest?.adName ?? "N/A"}", which is still below the danger zone.\n\nThat said, keep an eye on anything above 40. Once an ad crosses 50, performance drops fast and you start burning budget on impressions that aren't converting.\n\nNext step: Check back in 2-3 days, or ask me about fatigue trends to see if anything is creeping up.`;
      }

      const totalWastedDaily = toPause.reduce((s, a) => s + (a.totalSpend / Math.max(a.totalDays, 1)), 0);
      const lines = toPause.map((a) => {
        const dailySpend = a.totalSpend / Math.max(a.totalDays, 1);
        const reasons: string[] = [];
        if (a.recentAvgFrequency > 3) reasons.push(`frequency is at ${fmt(a.recentAvgFrequency)}x, meaning your audience has seen this ad ${fmt(a.recentAvgFrequency)} times on average. After 3x, CTR typically drops 30-50%`);
        if (a.recentAvgCTR < 0.5) reasons.push(`CTR has collapsed to ${fmtPct(a.recentAvgCTR)}, which is well below the 1% benchmark for healthy B2B ads`);
        if (a.recentAvgCPM > 20) reasons.push(`CPM has spiked to ${fmtDollar(a.recentAvgCPM)}, meaning Meta's algorithm is struggling to find new people to show this to`);
        if (reasons.length === 0) reasons.push(`fatigue score hit ${a.fatigueScore}, indicating overall performance decline across multiple signals`);

        return `\n"${a.adName}" (fatigue: ${a.fatigueScore}, spending ~${fmtDollar(dailySpend)}/day)\nWhy pause: ${reasons.join(". Also, ")}.`;
      });

      let resp = `I'd pause these ${toPause.length} ads today. They're actively wasting roughly ${fmtDollar(totalWastedDaily)}/day combined:\n${lines.join("\n")}`;
      resp += `\n\nWhat to do with that budget: Reallocate it to your top performers. ${sortedByCTR[0] ? `"${sortedByCTR[0].adName}" is currently your strongest ad at ${fmtPct(sortedByCTR[0].recentAvgCTR)} CTR.` : ""} Increase budget on winners by 20-30% max to avoid resetting the learning phase.`;
      resp += `\n\nNext step: Pause these ads now, then prep 2-3 new creative variations based on what's working in your top performers. Ask me about creative recommendations for specific ideas.`;
      return resp;
    }

    case "best": {
      const top = sortedByCTR.slice(0, 5);
      if (top.length === 0) return "No active ads to rank right now. Sync your campaigns and I'll break down your winners.";

      const lines = top.map((a, i) => {
        const dailySpend = a.totalSpend / Math.max(a.totalDays, 1);
        const healthNote = a.fatigueScore < 25
          ? "Healthy, still has runway"
          : a.fatigueScore < 50
            ? `Watch closely, fatigue score is ${a.fatigueScore} and climbing`
            : `Warning: fatigue score is ${a.fatigueScore}, this winner is getting tired`;

        return `\n${i + 1}. "${a.adName}"\n   CTR: ${fmtPct(a.recentAvgCTR)} | CPC: ${fmtDollar(a.recentAvgCPC)} | Frequency: ${fmt(a.recentAvgFrequency)}x | ${fmt(a.totalActions)} conversions\n   Spending ~${fmtDollar(dailySpend)}/day over ${a.totalDays} days (${fmtDollar(a.totalSpend)} total)\n   Status: ${healthNote}`;
      });

      const freshWinners = top.filter(a => a.fatigueScore < 30 && a.recentAvgFrequency < 2.5);
      let scalingAdvice = "";
      if (freshWinners.length > 0) {
        scalingAdvice = `\n\nScaling opportunity: ${freshWinners.map(a => `"${a.adName}"`).join(" and ")} ${freshWinners.length > 1 ? "have" : "has"} low frequency and strong CTR, which means the creative is resonating and your audience isn't tired of it yet. You can safely increase budget 20-30% every 3 days on ${freshWinners.length > 1 ? "these" : "this one"}. Don't jump more than 30% at once or you'll reset Meta's learning phase.`;
      }

      const tiredWinners = top.filter(a => a.fatigueScore >= 40);
      let fatigueWarning = "";
      if (tiredWinners.length > 0) {
        fatigueWarning = `\n\nFatigue warning: ${tiredWinners.map(a => `"${a.adName}" (score: ${a.fatigueScore})`).join(" and ")} ${tiredWinners.length > 1 ? "are" : "is"} still performing well on CTR but showing fatigue signals. You probably have 5-7 days before performance drops noticeably. Start building replacement creative now so you're not scrambling.`;
      }

      return `Here are your top performers ranked by recent CTR:\n${lines.join("\n")}${scalingAdvice}${fatigueWarning}\n\nNext step: Scale the healthy winners gradually, and start creating variations of your top 2 ads so you have replacements ready when they fatigue.`;
    }

    case "budget": {
      const totalSpend = adSummaries.reduce((s, a) => s + a.totalSpend, 0);
      const activeSpend = active.reduce((s, a) => s + a.totalSpend, 0);
      const avgCPM = active.length > 0 ? active.reduce((s, a) => s + a.recentAvgCPM, 0) / active.length : 0;
      const avgCPC = active.length > 0 ? active.reduce((s, a) => s + a.recentAvgCPC, 0) / active.length : 0;

      const mostExpensive = [...active].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 3);
      const cheapestClicks = sortedByCPC.slice(0, 3);
      const fatigued = sorted.filter(a => a.fatigueScore >= 50);
      const fatiguedSpend = fatigued.reduce((s, a) => s + (a.totalSpend / Math.max(a.totalDays, 1)), 0);

      let resp = `Here's your budget breakdown across ${active.length} active ads.\n`;
      resp += `\nTotal spend: ${fmtDollar(totalSpend)} (${fmtDollar(activeSpend)} on active ads). Average CPM: ${fmtDollar(avgCPM)}, average CPC: ${fmtDollar(avgCPC)}.`;

      if (mostExpensive.length > 0) {
        resp += `\n\nBiggest spenders:`;
        mostExpensive.forEach(a => {
          const dailySpend = a.totalSpend / Math.max(a.totalDays, 1);
          const verdict = a.fatigueScore >= 50
            ? `PROBLEM. Fatigue score is ${a.fatigueScore}. You're spending ${fmtDollar(dailySpend)}/day on a tired ad.`
            : a.fatigueScore >= 30
              ? `Keep watching. Fatigue score is ${a.fatigueScore}, not critical yet but trending up.`
              : `Good investment. Fatigue score is only ${a.fatigueScore} and CTR is ${fmtPct(a.recentAvgCTR)}.`;
          resp += `\n  "${a.adName}": ${fmtDollar(a.totalSpend)} total (~${fmtDollar(dailySpend)}/day). ${verdict}`;
        });
      }

      if (cheapestClicks.length > 0) {
        resp += `\n\nBest cost-per-click:`;
        cheapestClicks.forEach(a => {
          resp += `\n  "${a.adName}": ${fmtDollar(a.recentAvgCPC)} CPC, ${fmtPct(a.recentAvgCTR)} CTR`;
        });
      }

      if (fatigued.length > 0) {
        resp += `\n\nBudget leak: You're spending roughly ${fmtDollar(fatiguedSpend)}/day on ${fatigued.length} fatigued ad${fatigued.length > 1 ? "s" : ""}. That's money going to ads people are scrolling past. Move that budget to ${cheapestClicks[0] ? `"${cheapestClicks[0].adName}"` : "your best CPC performers"} where every dollar works harder.`;
      }

      resp += `\n\nNext step: ${fatigued.length > 0 ? "Pause the fatigued ads, redistribute that daily budget to your lowest-CPC performers, and monitor for 48 hours." : "Your budget allocation looks reasonable. Consider shifting 10-15% more toward your top CPC performers to maximize click volume."}`;
      return resp;
    }

    case "fatigue": {
      const fatigued = sorted.filter((a) => a.fatigueScore >= 50);
      const warning = sorted.filter((a) => a.fatigueScore >= 30 && a.fatigueScore < 50);

      if (fatigued.length === 0 && warning.length === 0) {
        return `Good news. None of your ${active.length} active ads are showing significant fatigue. Your highest score is ${sorted[0]?.fatigueScore ?? 0} on "${sorted[0]?.adName ?? "N/A"}".\n\nFor context, fatigue scores work like this: 0-25 is healthy, 25-50 means early warning signs, 50-75 means the ad is actively fatiguing and performance is dropping, 75+ means it's burned out and wasting budget.\n\nEven though things look good now, this can change fast. An ad can go from healthy to fatigued in a week if your audience is small. Start prepping your next round of creative now so you're ready.\n\nNext step: Check back in 3-4 days. If any ad crosses 30, it's time to start working on replacements.`;
      }

      let resp = "";

      if (fatigued.length > 0) {
        resp += `${fatigued.length} ad${fatigued.length > 1 ? "s are" : " is"} actively fatiguing and losing you money:\n`;
        fatigued.slice(0, 5).forEach(a => {
          const topSignals = a.signals
            .filter((s) => s.score > 30)
            .sort((x, y) => y.score - x.score)
            .slice(0, 3);

          resp += `\n"${a.adName}" (score: ${a.fatigueScore}, stage: ${a.fatigueStage})`;
          resp += `\n  Frequency: ${fmt(a.recentAvgFrequency)}x.${a.recentAvgFrequency > 3 ? ` Your audience has seen this ad ${fmt(a.recentAvgFrequency)} times on average. After 3x, CTR typically drops 30-50% because people tune it out.` : ` Not extreme yet, but climbing.`}`;
          resp += `\n  CTR: ${fmtPct(a.recentAvgCTR)}.${a.recentAvgCTR < 0.5 ? " This is critically low. Healthy B2B ads sit around 1-2% CTR." : a.recentAvgCTR < 1 ? " Below average, the decline is real." : " Still okay, but watch the trend."}`;
          resp += `\n  CPM: ${fmtDollar(a.recentAvgCPM)}.${a.recentAvgCPM > 25 ? " This is expensive. Meta is charging you more because the ad isn't engaging people anymore." : ""}`;
          if (topSignals.length > 0) {
            resp += `\n  Key signals: ${topSignals.map(s => s.detail).join(". ")}.`;
          }
        });
      }

      if (warning.length > 0) {
        resp += `\n\n${warning.length} more ad${warning.length > 1 ? "s are" : " is"} in the early warning zone (score 30-50): ${warning.slice(0, 3).map(a => `"${a.adName}" (${a.fatigueScore})`).join(", ")}. These aren't emergencies yet, but they'll likely need replacement within 1-2 weeks at current pace.`;
      }

      resp += `\n\nTimeline estimate: Ads in the 50-70 range typically have 3-5 days of usable life left. Above 70, you're actively wasting budget every day they run.`;
      resp += `\n\nNext step: Pause anything above 70 today. For ads in the 50-70 range, start building replacement creative immediately and plan to swap them within the week.`;
      return resp;
    }

    case "creative": {
      const healthy = sortedByCTR.filter((a) => a.fatigueScore < 40).slice(0, 3);
      const tired = sorted.filter((a) => a.fatigueScore >= 50).slice(0, 3);
      const topPerformer = sortedByCTR[0];

      let resp = "Here's your creative strategy based on what the data is telling me.\n";

      if (healthy.length > 0) {
        resp += `\nWhat's working right now:`;
        healthy.forEach(a => {
          resp += `\n  "${a.adName}": ${fmtPct(a.recentAvgCTR)} CTR, ${fmt(a.recentAvgFrequency)}x frequency, fatigue score ${a.fatigueScore}`;
        });
        resp += `\n\nThese are your creative DNA. Whatever hook, visual style, and CTA these ads use, that's your formula. Build variations, not reinventions:`;
        resp += `\n  1. Same visual style, different opening hook. If your top ad leads with a question, try leading with a stat or a bold claim.`;
        resp += `\n  2. Same hook, different format. If it's a static image, try a carousel or short video with the same message.`;
        resp += `\n  3. Same message, different social proof. Swap in a testimonial, a case study number, or a "trusted by X companies" badge.`;
        resp += `\n  4. Test a completely different CTA. If you're using "Learn More," try "See How It Works" or "Get the Guide."`;
      }

      if (tired.length > 0) {
        resp += `\n\nAds that need replacement ASAP:`;
        tired.forEach(a => {
          resp += `\n  "${a.adName}" (fatigue: ${a.fatigueScore}, frequency: ${fmt(a.recentAvgFrequency)}x)`;
        });
        resp += `\n\nFor replacements, don't just tweak these. The audience is saturated on this exact creative. You need a noticeably different look and feel while keeping the core offer the same.`;
      }

      if (topPerformer) {
        resp += `\n\nQuick win: Take your best ad "${topPerformer.adName}" and create 3 variations. Change the first line of copy in each one. This is the lowest-effort, highest-impact creative test you can run because the first line is what stops the scroll.`;
      }

      resp += `\n\nNext step: Create 3-5 new variations this week. Prioritize replacing the fatigued ads first, then build on what's winning.`;
      return resp;
    }

    case "compare": {
      if (active.length < 2) return "Need at least 2 active ads to compare. You currently have " + active.length + ". Sync more campaigns and I'll break down the differences.";

      const best = sortedByCTR[0];
      const worst = sortedByCTR[sortedByCTR.length - 1];
      const bestDaily = best.totalSpend / Math.max(best.totalDays, 1);
      const worstDaily = worst.totalSpend / Math.max(worst.totalDays, 1);
      const ctrGap = best.recentAvgCTR - worst.recentAvgCTR;

      let resp = `Here's your best vs. worst side by side:\n`;
      resp += `\n                    | Best                  | Worst`;
      resp += `\n  Ad Name           | "${best.adName}"      | "${worst.adName}"`;
      resp += `\n  CTR (7-day avg)   | ${fmtPct(best.recentAvgCTR)}               | ${fmtPct(worst.recentAvgCTR)}`;
      resp += `\n  CPC               | ${fmtDollar(best.recentAvgCPC)}               | ${fmtDollar(worst.recentAvgCPC)}`;
      resp += `\n  CPM               | ${fmtDollar(best.recentAvgCPM)}               | ${fmtDollar(worst.recentAvgCPM)}`;
      resp += `\n  Frequency         | ${fmt(best.recentAvgFrequency)}x              | ${fmt(worst.recentAvgFrequency)}x`;
      resp += `\n  Fatigue Score     | ${best.fatigueScore}                  | ${worst.fatigueScore}`;
      resp += `\n  Daily Spend       | ~${fmtDollar(bestDaily)}             | ~${fmtDollar(worstDaily)}`;
      resp += `\n  Total Conversions | ${fmt(best.totalActions)}              | ${fmt(worst.totalActions)}`;

      resp += `\n\nThe takeaway: There's a ${fmtPct(ctrGap)} CTR gap between your best and worst ad. `;
      if (worst.recentAvgCPC > best.recentAvgCPC) {
        const cpcDiff = worst.recentAvgCPC - best.recentAvgCPC;
        resp += `You're paying ${fmtDollar(cpcDiff)} more per click on the underperformer. `;
      }
      if (worstDaily > 5) {
        resp += `The bottom ad is still spending ~${fmtDollar(worstDaily)}/day. That's budget that would perform better on "${best.adName}."`;
      }

      if (active.length > 2) {
        const middle = sortedByCTR.slice(1, -1);
        const midAvgCTR = middle.reduce((s, a) => s + a.recentAvgCTR, 0) / middle.length;
        resp += `\n\nFor context, your ${middle.length} other active ads average ${fmtPct(midAvgCTR)} CTR.`;
      }

      resp += `\n\nNext step: Shift budget from "${worst.adName}" to "${best.adName}." If the worst ad has been underperforming for more than 5 days, just pause it. Don't wait for a miracle.`;
      return resp;
    }

    case "summary": {
      const totalSpend = adSummaries.reduce((s, a) => s + a.totalSpend, 0);
      const totalActions = adSummaries.reduce((s, a) => s + a.totalActions, 0);
      const totalClicks = adSummaries.reduce((s, a) => s + a.totalClicks, 0);
      const fatiguedCount = active.filter((a) => a.fatigueScore >= 50).length;
      const warningCount = active.filter((a) => a.fatigueScore >= 30 && a.fatigueScore < 50).length;
      const healthyCount = active.filter((a) => a.fatigueScore < 30).length;
      const topAd = sortedByCTR[0];
      const avgCTR = active.length > 0 ? active.reduce((s, a) => s + a.recentAvgCTR, 0) / active.length : 0;
      const avgCPC = active.length > 0 ? active.reduce((s, a) => s + a.recentAvgCPC, 0) / active.length : 0;

      // Health score: weighted by how many ads are in each bucket
      const healthScore = active.length > 0
        ? Math.round(((healthyCount * 100 + warningCount * 50 + fatiguedCount * 10) / active.length))
        : 0;

      let healthLabel = "Critical";
      if (healthScore >= 80) healthLabel = "Strong";
      else if (healthScore >= 60) healthLabel = "Good";
      else if (healthScore >= 40) healthLabel = "Needs Attention";

      let resp = `ACCOUNT HEALTH: ${healthScore}/100 (${healthLabel})\n`;
      resp += `\nThe numbers: ${adSummaries.length} total ads (${active.length} active, ${adSummaries.length - active.length} paused). Total spend: ${fmtDollar(totalSpend)}. Total clicks: ${fmt(totalClicks)}. Total conversions: ${fmt(totalActions)}. Avg CTR: ${fmtPct(avgCTR)}. Avg CPC: ${fmtDollar(avgCPC)}.`;

      resp += `\n\nAd health breakdown:`;
      resp += `\n  Healthy (score under 30): ${healthyCount} ad${healthyCount !== 1 ? "s" : ""}`;
      resp += `\n  Warning (score 30-50): ${warningCount} ad${warningCount !== 1 ? "s" : ""}`;
      resp += `\n  Fatigued (score 50+): ${fatiguedCount} ad${fatiguedCount !== 1 ? "s" : ""}`;

      if (topAd) {
        resp += `\n\nTop performer: "${topAd.adName}" at ${fmtPct(topAd.recentAvgCTR)} CTR, ${fmtDollar(topAd.recentAvgCPC)} CPC, fatigue score ${topAd.fatigueScore}.`;
      }

      // Risks
      const risks: string[] = [];
      if (fatiguedCount > 0) risks.push(`${fatiguedCount} fatigued ad${fatiguedCount > 1 ? "s" : ""} actively burning budget`);
      const highFreq = active.filter(a => a.recentAvgFrequency > 3);
      if (highFreq.length > 0) risks.push(`${highFreq.length} ad${highFreq.length > 1 ? "s" : ""} with frequency above 3x`);
      if (active.length < 3) risks.push("Low ad diversity. If one ad fatigues you have limited backup");

      if (risks.length > 0) {
        resp += `\n\nTop risks: ${risks.join(". ")}.`;
      }

      // Opportunities
      const scalable = active.filter(a => a.fatigueScore < 25 && a.recentAvgCTR > avgCTR);
      if (scalable.length > 0) {
        resp += `\n\nOpportunity: ${scalable.length} ad${scalable.length > 1 ? "s are" : " is"} healthy and above-average CTR. ${scalable.length > 1 ? "These are" : "This is"} safe to scale up.`;
      }

      resp += `\n\nNext step: ${fatiguedCount > 0 ? `Ask me "which ads should I pause?" to get the specific list and replacement strategy.` : warningCount > 0 ? `Keep an eye on your ${warningCount} warning-zone ads. Ask me about fatigue details to see what's driving the decline.` : `Things are looking good. Focus on creative testing to build your library of winners before anything starts to fatigue.`}`;
      return resp;
    }

    case "spend_efficiency": {
      const fatigued = sorted.filter(a => a.fatigueScore >= 50);
      const totalSpend = active.reduce((s, a) => s + a.totalSpend, 0);
      const totalDailySpend = active.reduce((s, a) => s + (a.totalSpend / Math.max(a.totalDays, 1)), 0);
      const avgCPC = active.length > 0 ? active.reduce((s, a) => s + a.recentAvgCPC, 0) / active.length : 0;

      if (fatigued.length === 0) {
        const bestEfficiency = sortedByCPC[0];
        const worstEfficiency = sortedByCPC[sortedByCPC.length - 1];
        let resp = `Your spend efficiency is solid right now. No fatigued ads burning budget.\n`;
        resp += `\nTotal active spend: ${fmtDollar(totalSpend)} across ${active.length} ads (~${fmtDollar(totalDailySpend)}/day). Average CPC: ${fmtDollar(avgCPC)}.`;
        if (bestEfficiency && worstEfficiency && active.length > 1) {
          resp += `\n\nMost efficient: "${bestEfficiency.adName}" at ${fmtDollar(bestEfficiency.recentAvgCPC)} CPC. Least efficient: "${worstEfficiency.adName}" at ${fmtDollar(worstEfficiency.recentAvgCPC)} CPC.`;
          if (worstEfficiency.recentAvgCPC > avgCPC * 1.5) {
            resp += ` That bottom one is costing ${fmtPct((worstEfficiency.recentAvgCPC / bestEfficiency.recentAvgCPC - 1) * 100)} more per click than your best. Consider shifting some of its budget.`;
          }
        }
        resp += `\n\nNext step: Even though things are efficient, always be testing. Launch 1-2 new creatives per week to maintain a healthy pipeline.`;
        return resp;
      }

      const fatiguedDailySpend = fatigued.reduce((s, a) => s + (a.totalSpend / Math.max(a.totalDays, 1)), 0);
      const wasteEstimate = fatiguedDailySpend * 0.4; // ~40% of fatigued ad spend is wasted
      const monthlyWaste = wasteEstimate * 30;
      const wastePct = totalDailySpend > 0 ? ((fatiguedDailySpend / totalDailySpend) * 100).toFixed(1) : "0";

      const topHealthy = sortedByCTR.filter(a => a.fatigueScore < 30).slice(0, 3);
      const avgHealthyCTR = topHealthy.length > 0 ? topHealthy.reduce((s, a) => s + a.recentAvgCTR, 0) / topHealthy.length : 0;
      const avgFatiguedCTR = fatigued.length > 0 ? fatigued.reduce((s, a) => s + a.recentAvgCTR, 0) / fatigued.length : 0;

      // Estimate additional clicks from reallocation
      const additionalClicksPerDay = avgHealthyCTR > 0 && avgFatiguedCTR > 0
        ? Math.round((fatiguedDailySpend / 1000) * (avgHealthyCTR - avgFatiguedCTR) * 10)
        : 0;

      let resp = `You have a spend efficiency problem. Here's the math.\n`;
      resp += `\nYou're spending ~${fmtDollar(fatiguedDailySpend)}/day on ${fatigued.length} fatigued ad${fatigued.length > 1 ? "s" : ""}. That's ${wastePct}% of your daily budget going to ads past their prime. Conservatively, about ${fmtDollar(wasteEstimate)}/day of that is wasted, which is ~${fmtDollar(monthlyWaste)}/month down the drain.`;

      resp += `\n\nThe fatigued ads:`;
      fatigued.slice(0, 4).forEach(a => {
        const dailySpend = a.totalSpend / Math.max(a.totalDays, 1);
        resp += `\n  "${a.adName}": ~${fmtDollar(dailySpend)}/day, ${fmtPct(a.recentAvgCTR)} CTR, fatigue score ${a.fatigueScore}`;
      });

      if (topHealthy.length > 0) {
        resp += `\n\nIf you reallocated that ${fmtDollar(fatiguedDailySpend)}/day to your top ${topHealthy.length} healthy performers (averaging ${fmtPct(avgHealthyCTR)} CTR vs. ${fmtPct(avgFatiguedCTR)} on the fatigued ones), you'd get approximately ${additionalClicksPerDay > 0 ? additionalClicksPerDay + " more" : "significantly more"} clicks per day for the same spend.`;
      }

      resp += `\n\nNext step: Pause the fatigued ads today and redistribute their budget to ${topHealthy[0] ? `"${topHealthy[0].adName}"` : "your top performers"}. You'll see the efficiency improvement within 48 hours.`;
      return resp;
    }

    case "recommendation": {
      const fatigued = sorted.filter(a => a.fatigueScore >= 70);
      const fatiguing = sorted.filter(a => a.fatigueScore >= 50 && a.fatigueScore < 70);
      const warning = sorted.filter(a => a.fatigueScore >= 30 && a.fatigueScore < 50);
      const topPerformers = sortedByCTR.filter(a => a.fatigueScore < 30).slice(0, 3);
      const highFreq = active.filter(a => a.recentAvgFrequency > 3);
      const fatiguedDailySpend = [...fatigued, ...fatiguing].reduce((s, a) => s + (a.totalSpend / Math.max(a.totalDays, 1)), 0);

      if (fatigued.length === 0 && fatiguing.length === 0 && warning.length === 0) {
        let resp = `Your account is in good shape. No urgent fires to put out. Here's what I'd focus on:\n`;
        resp += `\n1. CREATIVE PIPELINE (this week): You have ${active.length} active ads, all healthy. But ads always fatigue eventually. Start building your next 3-5 creatives now based on what's working in your top performers.`;
        if (topPerformers.length > 0) {
          resp += ` Your winners are ${topPerformers.map(a => `"${a.adName}" (${fmtPct(a.recentAvgCTR)} CTR)`).join(", ")}.`;
        }
        resp += `\n\n2. SCALING (next 3 days): If any ad has been running with consistent performance for 5+ days, you can safely bump budget 20-30%.`;
        resp += `\n\n3. TESTING: Launch at least one new creative per week to keep your pipeline fresh. Test different hooks, formats, and CTAs.`;
        resp += `\n\nNext step: Ask me about creative recommendations for specific ideas based on your winning ads.`;
        return resp;
      }

      let resp = `Here's your prioritized action plan:\n`;
      let priority = 1;

      if (fatigued.length > 0) {
        resp += `\n${priority}. PAUSE TODAY (saves ~${fmtDollar(fatigued.reduce((s, a) => s + (a.totalSpend / Math.max(a.totalDays, 1)) * 0.4, 0))}/day in waste)`;
        fatigued.forEach(a => {
          resp += `\n   "${a.adName}" (score: ${a.fatigueScore}, frequency: ${fmt(a.recentAvgFrequency)}x, CTR: ${fmtPct(a.recentAvgCTR)})`;
        });
        resp += `\n   These are past the point of recovery. Pause them and reallocate budget immediately.`;
        priority++;
      }

      if (fatiguing.length > 0) {
        resp += `\n\n${priority}. REPLACE THIS WEEK (3-5 day window)`;
        fatiguing.forEach(a => {
          resp += `\n   "${a.adName}" (score: ${a.fatigueScore}, frequency: ${fmt(a.recentAvgFrequency)}x, CTR: ${fmtPct(a.recentAvgCTR)})`;
        });
        resp += `\n   These still have some life but are declining. Start building replacement creative now. You have about a week before they need to be pulled.`;
        priority++;
      }

      if (topPerformers.length > 0) {
        resp += `\n\n${priority}. SCALE YOUR WINNERS (increase budget 20-30% every 3 days)`;
        topPerformers.forEach(a => {
          const dailySpend = a.totalSpend / Math.max(a.totalDays, 1);
          resp += `\n   "${a.adName}" (CTR: ${fmtPct(a.recentAvgCTR)}, CPC: ${fmtDollar(a.recentAvgCPC)}, ~${fmtDollar(dailySpend)}/day)`;
        });
        resp += `\n   Low fatigue, strong CTR. These can absorb the budget from paused ads.`;
        priority++;
      }

      if (highFreq.length > 0) {
        resp += `\n\n${priority}. EXPAND TARGETING on ${highFreq.length} high-frequency ad${highFreq.length > 1 ? "s" : ""}`;
        highFreq.slice(0, 3).forEach(a => {
          resp += `\n   "${a.adName}" (frequency: ${fmt(a.recentAvgFrequency)}x)`;
        });
        resp += `\n   Frequency above 3x means your audience is too small or has seen the ad too many times. Try broadening your targeting, adding lookalike audiences, or refreshing the creative.`;
        priority++;
      }

      if (warning.length > 0) {
        resp += `\n\n${priority}. MONITOR (check in 3-4 days)`;
        warning.slice(0, 3).forEach(a => {
          resp += `\n   "${a.adName}" (score: ${a.fatigueScore})`;
        });
        resp += `\n   Not urgent yet, but these are trending toward fatigue. Have backup creative ready.`;
      }

      if (fatiguedDailySpend > 0) {
        resp += `\n\nExpected impact: Pausing fatigued ads and reallocating saves you roughly ${fmtDollar(fatiguedDailySpend * 0.4)}/day in wasted spend, which is ~${fmtDollar(fatiguedDailySpend * 0.4 * 30)}/month.`;
      }

      resp += `\n\nNext step: Start with item 1. The biggest ROI comes from stopping the bleeding on fatigued ads first, then scaling what's working.`;
      return resp;
    }

    default: {
      const fatiguedCount = active.filter((a) => a.fatigueScore >= 50).length;
      const warningCount = active.filter((a) => a.fatigueScore >= 30 && a.fatigueScore < 50).length;
      const healthyCount = active.filter((a) => a.fatigueScore < 30).length;
      const totalSpend = active.reduce((s, a) => s + a.totalSpend, 0);
      const avgCTR = active.length > 0 ? active.reduce((s, a) => s + a.recentAvgCTR, 0) / active.length : 0;
      const topAd = sortedByCTR[0];

      let resp = `Here's a quick snapshot of your ${active.length} active ads.\n`;
      resp += `\nTotal spend: ${fmtDollar(totalSpend)}. Average CTR: ${fmtPct(avgCTR)}. Health breakdown: ${healthyCount} healthy, ${warningCount} in warning zone, ${fatiguedCount} fatigued.`;

      if (topAd) {
        resp += `\n\nYour strongest ad right now is "${topAd.adName}" at ${fmtPct(topAd.recentAvgCTR)} CTR with a fatigue score of ${topAd.fatigueScore}.`;
      }

      if (fatiguedCount > 0) {
        const fatiguedAds = sorted.filter(a => a.fatigueScore >= 50).slice(0, 2);
        const fatiguedDaily = fatiguedAds.reduce((s, a) => s + (a.totalSpend / Math.max(a.totalDays, 1)), 0);
        resp += `\n\nHeads up: ${fatiguedCount} ad${fatiguedCount > 1 ? "s are" : " is"} fatigued and likely wasting ~${fmtDollar(fatiguedDaily * 0.4)}/day. The worst ${fatiguedCount > 1 ? "offenders are" : "offender is"} ${fatiguedAds.map(a => `"${a.adName}" (score: ${a.fatigueScore})`).join(" and ")}.`;
        resp += `\n\nI'd recommend asking me:`;
        resp += `\n  "Which ads should I pause?" for a specific kill list with reasoning`;
        resp += `\n  "What should I do next?" for a prioritized action plan`;
        resp += `\n  "Where am I wasting money?" for a spend efficiency breakdown`;
      } else if (warningCount > 0) {
        resp += `\n\nNothing on fire, but ${warningCount} ad${warningCount > 1 ? "s are" : " is"} showing early fatigue signals. Worth keeping an eye on.`;
        resp += `\n\nTry asking me:`;
        resp += `\n  "Show me fatigue details" for a deep dive on what's declining`;
        resp += `\n  "Give me creative ideas" for refresh recommendations`;
        resp += `\n  "How's my budget allocation?" for spend optimization`;
      } else {
        resp += `\n\nEverything looks healthy. No fatigued ads, no urgent issues.`;
        resp += `\n\nTo get the most out of this, try asking:`;
        resp += `\n  "Who are my top performers?" to see what's winning and why`;
        resp += `\n  "Give me creative ideas" for proactive refresh strategies`;
        resp += `\n  "Compare my ads" for a head-to-head breakdown`;
      }

      return resp;
    }
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message } = body as {
      message: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const { adSummaries } = loadAdData();
    const intent = detectIntent(message);
    const response = generateResponse(intent, adSummaries);

    return NextResponse.json({ response });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Chat failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
