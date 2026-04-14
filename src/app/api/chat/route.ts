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

    // Build message history (last 10 messages for context)
    const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    if (history && Array.isArray(history)) {
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          conversationMessages.push({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          });
        }
      }
    }

    // Add the current message with ad data context
    conversationMessages.push({
      role: "user",
      content: `[AD ACCOUNT DATA]\n${context}\n\n[USER QUESTION]\n${message}`,
    });

    // Ensure messages alternate properly (Anthropic API requirement)
    // If first message is assistant, drop it
    if (conversationMessages.length > 0 && conversationMessages[0].role === "assistant") {
      conversationMessages.shift();
    }

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

    // Extract text from the response
    const textBlock = response.content.find((block) => block.type === "text");
    const responseText = textBlock && textBlock.type === "text" ? textBlock.text : "I wasn't able to generate a response. Please try again.";

    return NextResponse.json({ response: responseText });
  } catch (error: unknown) {
    console.error("Chat API error:", error);

    // Provide a helpful fallback if the Anthropic API fails
    if (error instanceof Error) {
      if (error.message.includes("401") || error.message.includes("authentication")) {
        return NextResponse.json(
          { response: "The AI service isn't configured yet. Please set your ANTHROPIC_API_KEY environment variable and restart the app." },
          { status: 200 }
        );
      }
      if (error.message.includes("429") || error.message.includes("rate")) {
        return NextResponse.json(
          { response: "I'm getting too many requests right now. Give me a moment and try again." },
          { status: 200 }
        );
      }
    }

    return NextResponse.json(
      { response: "Something went wrong on my end. Try again in a moment, and if it keeps happening, check that your API key is set correctly." },
      { status: 200 }
    );
  }
}
