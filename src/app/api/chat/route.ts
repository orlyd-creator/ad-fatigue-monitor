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

  const totalSpend = adSummaries.reduce((s, a) => s + a.totalSpend, 0);
  const totalImpressions = adSummaries.reduce((s, a) => s + a.totalImpressions, 0);
  const totalClicks = adSummaries.reduce((s, a) => s + a.totalClicks, 0);
  const totalActions = adSummaries.reduce((s, a) => s + a.totalActions, 0);

  let context = `Active Ads (${active.length} total, ${paused.length} paused):\n`;

  const sorted = [...active].sort((a, b) => b.fatigueScore - a.fatigueScore);

  sorted.forEach((ad, i) => {
    const dailySpend = ad.totalDays > 0 ? (ad.totalSpend / ad.totalDays) : 0;
    const keySignals = ad.signals
      .filter((s) => s.score > 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.detail)
      .join(", ");

    context += `${i + 1}. "${ad.adName}" (${ad.campaignName} / ${ad.adsetName}) | Fatigue: ${ad.fatigueScore} (${ad.fatigueStage}) | CTR: ${ad.recentAvgCTR}% | CPC: $${ad.recentAvgCPC} | CPM: $${ad.recentAvgCPM} | Freq: ${ad.recentAvgFrequency}x | Spend: ~$${dailySpend.toFixed(2)}/day ($${ad.totalSpend} total over ${ad.totalDays} days) | ${ad.totalClicks} clicks, ${ad.totalActions} conversions | Key signals: ${keySignals || "none significant"}\n`;
  });

  if (paused.length > 0) {
    context += `\nPaused Ads:\n`;
    paused.forEach((ad) => {
      context += `- "${ad.adName}" (${ad.campaignName}) | Fatigue: ${ad.fatigueScore} (${ad.fatigueStage}) | Last CTR: ${ad.recentAvgCTR}% | Total spend: $${ad.totalSpend}\n`;
    });
  }

  // Map ad IDs to names for alerts
  const adNameMap = new Map(adSummaries.map(a => [a.adName, a]));
  const adIdToName = new Map(adSummaries.map(a => [a.adName, a.adName])); // placeholder

  if (recentAlerts.length > 0) {
    context += `\nRecent Alerts:\n`;
    recentAlerts.slice(0, 10).forEach((alert) => {
      const ad = adSummaries.find(a => a.adName); // find matching ad
      const adName = adSummaries.find(a => true)?.adName || alert.adId;
      const timeAgo = Math.round((Date.now() - alert.createdAt) / (1000 * 60 * 60));
      context += `- "${alert.adId}" crossed into ${alert.stage} stage (score: ${alert.fatigueScore}) - ${timeAgo}h ago\n`;
    });
  }

  context += `\nAccount Totals: $${totalSpend.toFixed(2)} total spend, ${totalImpressions.toLocaleString()} impressions, ${totalClicks.toLocaleString()} clicks, ${totalActions.toLocaleString()} conversions`;

  return context;
}

const SYSTEM_PROMPT = `You are a senior paid media strategist embedded in an ad fatigue monitoring tool. You have access to the user's real-time ad account data, which is provided below each message.

Your job is to give direct, actionable advice based on the actual numbers. You are NOT a generic chatbot. You are a sharp, experienced colleague who manages millions in ad spend.

Rules:
- Be direct and actionable. Never give vague advice like "consider optimizing your ads." Say exactly what to do, to which ad, and why.
- Always reference specific ad names and numbers from the data. Say "Pause 'Summer Sale Video' — its fatigue score is 82 and CTR dropped to 0.45%" not "you might want to pause some underperforming ads."
- Give dollar amounts when talking about waste or savings. "You're burning roughly $45/day on fatigued ads" is better than "you're wasting money."
- Prioritize recommendations. If someone asks what to do, number your steps: what to do first, second, third.
- Be conversational but professional. Like a smart colleague on Slack, not a corporate report. No bullet-point dumps unless the user asks for a list.
- Keep responses focused. 3-8 sentences for simple questions. Longer (with structure) for action plans or deep dives. Never ramble.
- Use ONLY the data provided. Never make up numbers, CTRs, spend amounts, or ad names. If you don't have enough data to answer, say so.
- Fatigue score ranges: 0-25 = healthy, 25-50 = early warning, 50-75 = actively fatiguing, 75+ = burned out and wasting budget.
- Frequency above 3x usually means the audience is saturated. CTR below 0.5% on B2B is critically low.
- When recommending budget reallocation, suggest specific percentages and warn about Meta's learning phase (don't increase more than 20-30% at a time).
- If there are no ads in the account, help the user understand they need to connect their Meta Ads account and sync data first.`;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const accountId = (session as any).accountId as string;
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

    const { adSummaries, recentAlerts } = await loadAdData(accountId);
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
