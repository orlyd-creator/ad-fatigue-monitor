import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, settings } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import { auth } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

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

async function loadAdData(accountId: string) {
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

  const allAds = await db.select().from(ads).where(eq(ads.accountId, accountId)).all();

  const adSummaries: AdSummary[] = await Promise.all(allAds.map(async (ad) => {
    const metrics = await db
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
  }));

  const userAdIds = allAds.map(a => a.id);
  const recentAlerts = userAdIds.length > 0
    ? await db
        .select()
        .from(alerts)
        .where(inArray(alerts.adId, userAdIds))
        .orderBy(desc(alerts.createdAt))
        .limit(20)
        .all()
    : [];

  return { adSummaries, recentAlerts };
}

function formatAdContext(
  adSummaries: AdSummary[],
  recentAlerts: Array<{ id: number; createdAt: number; adId: string; fatigueScore: number; stage: string; signals: string; dismissed: number }>
): string {
  if (adSummaries.length === 0) {
    return "No ads in the account yet. The user has not connected or synced any ad data.";
  }

  const active = adSummaries.filter((a) => a.status === "ACTIVE");
  const paused = adSummaries.filter((a) => a.status !== "ACTIVE");

  const totalSpend = active.reduce((s, a) => s + a.totalSpend, 0);
  const totalImpressions = active.reduce((s, a) => s + a.totalImpressions, 0);
  const totalClicks = active.reduce((s, a) => s + a.totalClicks, 0);
  const totalActions = active.reduce((s, a) => s + a.totalActions, 0);
  const overallCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  // Calculate account health
  const activeScores = active.map(a => a.fatigueScore);
  const avgFatigue = activeScores.length > 0 ? activeScores.reduce((s, v) => s + v, 0) / activeScores.length : 0;
  const accountHealth = Math.round(100 - avgFatigue);
  const fatiguedCount = active.filter(a => a.fatigueScore >= 50).length;
  const wastedSpend = active.filter(a => a.fatigueScore >= 50).reduce((s, a) => s + (a.totalDays > 0 ? a.totalSpend / a.totalDays : 0), 0);

  let context = `ACCOUNT OVERVIEW:\n`;
  context += `- ${active.length} active ads, ${paused.length} paused/inactive\n`;
  context += `- Account Health: ${accountHealth}/100 | Avg Fatigue: ${avgFatigue.toFixed(0)}/100\n`;
  context += `- ${fatiguedCount} ads fatiguing or worse (score 50+), burning ~$${wastedSpend.toFixed(0)}/day\n`;
  context += `- Overall CTR: ${overallCTR.toFixed(2)}% | Total spend (period): $${totalSpend.toFixed(0)} | ${totalActions} conversions\n\n`;

  context += `ACTIVE ADS (sorted worst fatigue first):\n`;
  const sorted = [...active].sort((a, b) => b.fatigueScore - a.fatigueScore);

  sorted.forEach((ad, i) => {
    const dailySpend = ad.totalDays > 0 ? (ad.totalSpend / ad.totalDays) : 0;
    const keySignals = ad.signals
      .filter((s) => s.score > 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.detail)
      .join("; ");

    context += `${i + 1}. "${ad.adName}" [${ad.campaignName} / ${ad.adsetName}]\n`;
    context += `   Fatigue: ${ad.fatigueScore}/100 (${ad.fatigueStage}) | CTR: ${ad.recentAvgCTR}% | CPC: $${ad.recentAvgCPC} | CPM: $${ad.recentAvgCPM} | Freq: ${ad.recentAvgFrequency}x\n`;
    context += `   Spend: ~$${dailySpend.toFixed(2)}/day ($${ad.totalSpend} total, ${ad.totalDays} days) | ${ad.totalClicks} clicks, ${ad.totalActions} conversions\n`;
    if (keySignals) context += `   Signals: ${keySignals}\n`;
    context += `\n`;
  });

  if (paused.length > 0) {
    context += `PAUSED/INACTIVE ADS (${paused.length} total):\n`;
    paused.slice(0, 10).forEach((ad) => {
      context += `- "${ad.adName}" (${ad.campaignName}) | Fatigue: ${ad.fatigueScore} | CTR: ${ad.recentAvgCTR}% | Spend: $${ad.totalSpend}\n`;
    });
    if (paused.length > 10) context += `... and ${paused.length - 10} more paused ads\n`;
    context += `\n`;
  }

  if (recentAlerts.length > 0) {
    context += `RECENT ALERTS:\n`;
    recentAlerts.slice(0, 10).forEach((alert) => {
      const timeAgo = Math.round((Date.now() - alert.createdAt) / (1000 * 60 * 60));
      context += `- Ad ${alert.adId} crossed into ${alert.stage} (score: ${alert.fatigueScore}) — ${timeAgo}h ago\n`;
    });
  }

  return context;
}

const SYSTEM_PROMPT = `You are a senior paid media strategist embedded in an ad fatigue monitoring tool. You have access to the user's real-time ad account data, which is provided below each message.

Your job is to give direct, actionable advice based on the actual numbers. You are NOT a generic chatbot. You are a sharp, battle-tested performance marketer who has managed millions in ad spend and can smell fatigue before the numbers fully show it.

Core Rules:
- Be direct and specific. Never say "consider optimizing." Say exactly what to do, to which ad, and why. Name names.
- Always reference specific ad names, numbers, and fatigue scores from the data. "Pause 'Summer Sale Video' — fatigue score 82, CTR tanked to 0.45%, you're burning ~$45/day on it."
- Give dollar amounts for waste and savings. "That's roughly $X/day you could reallocate to your winners."
- Prioritize with numbered steps. Most impactful action first.
- Be conversational but sharp. Like a smart colleague on Slack who doesn't waste words.
- Keep it focused: 3-8 sentences for simple questions, structured for action plans. Never ramble.
- Use ONLY the provided data. Never invent numbers. If data is insufficient, say so.

Fatigue Detection (be a hawk):
- Score 0-24 = healthy. 25-49 = early warning (start prepping replacements NOW). 50-74 = actively fatiguing (swap creative this week). 75+ = burned out (pause immediately, every hour is wasted money).
- Frequency above 2.5x = audience getting tired. Above 4x = severely saturated, creative swap is urgent.
- CTR dropping more than 15% from baseline = early fatigue signal even if score is still low.
- Rising CPM + declining CTR at the same time = classic fatigue pattern. Flag it aggressively.
- If frequency is climbing AND conversions are dropping, that ad is done. Don't sugarcoat it.
- CTR below 0.8% on most campaigns is underperforming. Below 0.5% is dead.

Strategic Advice:
- When recommending budget moves, give specific percentages. Warn about Meta's learning phase (max 20-30% increase at a time, avoid changes during low-data hours).
- Always suggest what creative angle to try next based on what's fatiguing (if video is dying, suggest static or carousel; if one hook failed, suggest a different opening).
- If multiple ads in the same campaign are fatiguing, the issue might be audience saturation, not just creative. Say so.
- Connect the dots between signals: "Your frequency hit 4.2x AND CTR dropped 30% — that's textbook fatigue. The audience has seen this too many times."

Tone: Direct, confident, no hedging. You're the expert they hired. If an ad needs to be killed, say it plainly.`;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const accountId = (session as any).accountId as string;
    const allAccountIds: string[] = (session as any).allAccountIds || [accountId];
    if (!accountId) {
      return NextResponse.json({ error: "No account connected" }, { status: 400 });
    }

    const body = await request.json();
    const { message, history } = body as {
      message: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Load data from ALL accounts
    let allAdSummaries: AdSummary[] = [];
    let allRecentAlerts: any[] = [];
    for (const accId of allAccountIds) {
      const { adSummaries, recentAlerts } = await loadAdData(accId);
      allAdSummaries.push(...adSummaries);
      allRecentAlerts.push(...recentAlerts);
    }
    const adSummaries = allAdSummaries;
    const recentAlerts = allRecentAlerts;
    const context = formatAdContext(adSummaries, recentAlerts);

    // Try Anthropic API first, fall back to smart built-in responses
    let responseText: string;

    try {
      // Build message history (last 10 messages for context)
      const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (history && Array.isArray(history)) {
        for (const msg of history.slice(-10)) {
          if (msg.role === "user" || msg.role === "assistant") {
            conversationMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
          }
        }
      }
      conversationMessages.push({ role: "user", content: `[AD ACCOUNT DATA]\n${context}\n\n[USER QUESTION]\n${message}` });
      if (conversationMessages[0]?.role === "assistant") conversationMessages.shift();

      // Merge consecutive same-role messages
      const mergedMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const msg of conversationMessages) {
        if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
          mergedMessages[mergedMessages.length - 1].content += "\n\n" + msg.content;
        } else {
          mergedMessages.push({ ...msg });
        }
      }

      const response = await anthropic.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: mergedMessages,
      });

      const textBlock = response.content.find((block) => block.type === "text");
      responseText = textBlock && textBlock.type === "text" ? textBlock.text : generateSmartResponse(message, adSummaries);
    } catch {
      // Anthropic API failed — use smart built-in response engine
      responseText = generateSmartResponse(message, adSummaries);
    }

    return NextResponse.json({ response: responseText });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { response: "Something went wrong loading your ad data. Try refreshing the page." },
      { status: 200 }
    );
  }
}

// ── Smart Built-in Response Engine ──────────────────────────────
// Generates intelligent responses from actual ad data without needing any external API
function generateSmartResponse(message: string, ads: AdSummary[]): string {
  const msg = message.toLowerCase();
  const active = ads.filter(a => a.status === "ACTIVE");
  const fatigued = active.filter(a => a.fatigueScore >= 50).sort((a, b) => b.fatigueScore - a.fatigueScore);
  const warning = active.filter(a => a.fatigueScore >= 25 && a.fatigueScore < 50).sort((a, b) => b.fatigueScore - a.fatigueScore);
  const healthy = active.filter(a => a.fatigueScore < 25).sort((a, b) => b.recentAvgCTR - a.recentAvgCTR);
  const totalSpend = active.reduce((s, a) => s + a.totalSpend, 0);
  const fatigueSpend = fatigued.reduce((s, a) => s + a.totalSpend, 0);
  const avgFatigue = active.length > 0 ? active.reduce((s, a) => s + a.fatigueScore, 0) / active.length : 0;
  const healthScore = Math.round(100 - avgFatigue);

  // Kill / pause questions
  if (msg.includes("kill") || msg.includes("pause") || msg.includes("turn off") || msg.includes("stop")) {
    if (fatigued.length === 0) {
      return `Good news — none of your ${active.length} active ads are in critical fatigue territory right now. ${warning.length > 0 ? `Keep an eye on "${warning[0].adName}" though — it's at score ${warning[0].fatigueScore} and trending up.` : "Everything looks healthy."}`;
    }
    let resp = `You should pause these ads immediately:\n\n`;
    fatigued.slice(0, 5).forEach((ad, i) => {
      const dailySpend = ad.totalDays > 0 ? (ad.totalSpend / ad.totalDays) : 0;
      resp += `${i + 1}. "${ad.adName}" — fatigue score ${ad.fatigueScore}, CTR ${ad.recentAvgCTR}%, frequency ${ad.recentAvgFrequency}x. Burning ~$${dailySpend.toFixed(0)}/day.\n`;
    });
    resp += `\nThat's ${fatigued.length} ads wasting budget. Pause them and reallocate to your winners.`;
    return resp;
  }

  // Fatigue / declining questions
  if (msg.includes("fatigu") || msg.includes("declin") || msg.includes("worst") || msg.includes("dying")) {
    const allBad = [...fatigued, ...warning].sort((a, b) => b.fatigueScore - a.fatigueScore);
    if (allBad.length === 0) return `All ${active.length} active ads are healthy with fatigue scores under 25. No declining ads detected.`;
    let resp = `Here's what's fatiguing, worst first:\n\n`;
    allBad.slice(0, 6).forEach((ad, i) => {
      const stage = ad.fatigueScore >= 70 ? "CRITICAL" : ad.fatigueScore >= 50 ? "FATIGUED" : "WARNING";
      resp += `${i + 1}. "${ad.adName}" — ${stage} (score ${ad.fatigueScore}), CTR: ${ad.recentAvgCTR}%, Freq: ${ad.recentAvgFrequency}x\n`;
    });
    return resp;
  }

  // Budget / spend / waste / bleeding questions
  if (msg.includes("budget") || msg.includes("spend") || msg.includes("waste") || msg.includes("bleed") || msg.includes("money")) {
    if (fatigued.length === 0) return `You're spending efficiently. $${totalSpend.toLocaleString()} total across ${active.length} active ads with no significant waste on fatigued ads. Account health: ${healthScore}/100.`;
    const wastedPct = totalSpend > 0 ? ((fatigueSpend / totalSpend) * 100).toFixed(0) : "0";
    let resp = `You're wasting ~$${fatigueSpend.toLocaleString()} (${wastedPct}% of spend) on ${fatigued.length} fatigued ads.\n\nBiggest budget drains:\n`;
    fatigued.slice(0, 4).forEach((ad, i) => {
      resp += `${i + 1}. "${ad.adName}" — $${ad.totalSpend.toLocaleString()} spent, fatigue score ${ad.fatigueScore}\n`;
    });
    if (healthy.length > 0) {
      resp += `\nMove that budget to "${healthy[0].adName}" (${healthy[0].recentAvgCTR}% CTR, score ${healthy[0].fatigueScore}) — it's your best performer right now.`;
    }
    return resp;
  }

  // Action plan / priority / what to do
  if (msg.includes("plan") || msg.includes("priority") || msg.includes("action") || msg.includes("what should") || msg.includes("recommend")) {
    let resp = `Here's your priority action plan:\n\n`;
    let step = 1;
    if (fatigued.length > 0) {
      resp += `${step}. PAUSE NOW: ${fatigued.slice(0, 3).map(a => `"${a.adName}" (score ${a.fatigueScore})`).join(", ")}. These are actively wasting budget.\n\n`;
      step++;
    }
    if (warning.length > 0) {
      resp += `${step}. PREP REPLACEMENTS for: ${warning.slice(0, 3).map(a => `"${a.adName}" (score ${a.fatigueScore})`).join(", ")}. These will fatigue within days.\n\n`;
      step++;
    }
    if (healthy.length > 0) {
      resp += `${step}. SCALE WINNERS: Increase budget 15-20% on "${healthy[0].adName}" (${healthy[0].recentAvgCTR}% CTR). It has room to run.\n\n`;
      step++;
    }
    const highFreq = active.filter(a => a.recentAvgFrequency > 3).sort((a, b) => b.recentAvgFrequency - a.recentAvgFrequency);
    if (highFreq.length > 0) {
      resp += `${step}. EXPAND TARGETING: "${highFreq[0].adName}" has ${highFreq[0].recentAvgFrequency.toFixed(1)}x frequency — your audience is saturated. Add new interests or lookalikes.\n`;
    }
    return resp;
  }

  // Creative / test / new / fresh
  if (msg.includes("creative") || msg.includes("test") || msg.includes("fresh") || msg.includes("new")) {
    let resp = "Creative recommendations:\n\n";
    const highFreq = active.filter(a => a.recentAvgFrequency > 2.5).sort((a, b) => b.recentAvgFrequency - a.recentAvgFrequency);
    if (highFreq.length > 0) {
      resp += `1. "${highFreq[0].adName}" has ${highFreq[0].recentAvgFrequency.toFixed(1)}x frequency. Your audience has seen it too many times. Test a completely different visual style — if it's video, try static. If it's static, try carousel or UGC.\n\n`;
    }
    if (healthy.length > 0) {
      resp += `2. Your best performing ad is "${healthy[0].adName}" at ${healthy[0].recentAvgCTR}% CTR. Duplicate it and test 3 variations: different hook, different CTA, different thumbnail.\n\n`;
    }
    if (fatigued.length > 0) {
      resp += `3. "${fatigued[0].adName}" is fatigued (score ${fatigued[0].fatigueScore}). Don't iterate on it — start completely fresh. New angle, new copy, new visual.\n`;
    }
    return resp;
  }

  // Top / best / winner / scale
  if (msg.includes("top") || msg.includes("best") || msg.includes("winner") || msg.includes("scale") || msg.includes("perform")) {
    if (healthy.length === 0) return "No clear winners right now — most ads are showing fatigue signals. Focus on pausing the worst performers and launching fresh creative.";
    let resp = `Your top performers to scale:\n\n`;
    healthy.slice(0, 5).forEach((ad, i) => {
      resp += `${i + 1}. "${ad.adName}" — CTR: ${ad.recentAvgCTR}%, CPC: $${ad.recentAvgCPC}, Freq: ${ad.recentAvgFrequency}x, Fatigue: ${ad.fatigueScore}\n`;
    });
    resp += `\nScale these by increasing budget 15-20% at a time. Don't go over 30% in one day or you'll reset Meta's learning phase.`;
    return resp;
  }

  // General / greeting / conversational
  if (msg.match(/^(hi|hey|hello|yo|sup|what's up|whats up|hola|howdy)\b/) || msg.length < 10) {
    if (fatigued.length > 0) {
      return `Hey! Quick heads up — you've got ${fatigued.length} ad${fatigued.length > 1 ? "s" : ""} that ${fatigued.length > 1 ? "are" : "is"} looking tired. Your best bet right now is "${healthy.length > 0 ? healthy[0].adName : "none yet"}" at ${healthy.length > 0 ? healthy[0].recentAvgCTR : 0}% CTR. Want me to break down what to do?`;
    }
    if (warning.length > 0) {
      return `Hey! Things are looking decent — ${active.length} active ads, ${healthy.length} healthy. Keep an eye on "${warning[0].adName}" though, it's starting to show early fatigue signs. What do you want to dig into?`;
    }
    return `Hey! Your ads are looking solid — ${active.length} active, all healthy. Account health is ${healthScore}/100. Nothing to worry about right now. Want me to find your top performers or suggest what to test next?`;
  }

  // Catch-all for anything else
  let resp = "";
  if (fatigued.length > 0) {
    resp = `Here's what I'm seeing: ${fatigued.length} of your ${active.length} active ads need attention (fatigue score 50+). Worst is "${fatigued[0].adName}" at ${fatigued[0].fatigueScore}. `;
    if (healthy.length > 0) {
      resp += `On the bright side, "${healthy[0].adName}" is crushing it at ${healthy[0].recentAvgCTR}% CTR. `;
    }
    resp += `\n\nTry asking me: "which ads should I kill?", "give me an action plan", or "where am I wasting budget?"`;
  } else {
    resp = `Your ${active.length} active ads are all looking healthy — account health at ${healthScore}/100. `;
    if (healthy.length > 0) {
      resp += `Top performer is "${healthy[0].adName}" with ${healthy[0].recentAvgCTR}% CTR. `;
    }
    resp += `\n\nI can help you find what to scale, what creative to test next, or break down your spend. Just ask!`;
  }
  return resp;
}
