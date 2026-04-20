import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, settings, accounts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import type { ScoringSettings } from "@/lib/fatigue/types";
import { DEFAULT_SETTINGS } from "@/lib/fatigue/types";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";

/**
 * If the DB row is missing the caption / headline / link (common for Dynamic
 * Creative ads synced before commit d64a70a's extractor upgrade), pull the
 * creative live from Meta. Saves the result back so it's populated on the
 * next request without another Meta call.
 */
async function ensureCopy(adRow: typeof ads.$inferSelect): Promise<typeof adRow> {
  if (adRow.adBody && adRow.adHeadline && adRow.adLinkUrl) return adRow;
  const acct = await db.select().from(accounts).where(eq(accounts.id, adRow.accountId)).get();
  if (!acct?.accessToken) return adRow;
  try {
    const fields = "creative{body,title,link_url,object_story_spec,asset_feed_spec,call_to_action_type}";
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${adRow.id}?fields=${encodeURIComponent(fields)}&access_token=${acct.accessToken}`,
    );
    if (!r.ok) return adRow;
    const data = await r.json();
    const c = data.creative || {};
    const assetBody = c.asset_feed_spec?.bodies?.[0]?.text;
    const assetTitle = c.asset_feed_spec?.titles?.[0]?.text;
    const assetLink = c.asset_feed_spec?.link_urls?.[0]?.website_url
      || c.asset_feed_spec?.link_urls?.[0]?.display_url;
    const adBody = adRow.adBody
      || c.body
      || c.object_story_spec?.link_data?.message
      || c.object_story_spec?.video_data?.message
      || assetBody
      || null;
    const adHeadline = adRow.adHeadline
      || c.title
      || c.object_story_spec?.link_data?.name
      || c.object_story_spec?.video_data?.title
      || assetTitle
      || null;
    const adLinkUrl = adRow.adLinkUrl
      || c.link_url
      || c.object_story_spec?.link_data?.link
      || assetLink
      || null;
    if (adBody || adHeadline || adLinkUrl) {
      await db.update(ads).set({ adBody, adHeadline, adLinkUrl }).where(eq(ads.id, adRow.id));
      return { ...adRow, adBody, adHeadline, adLinkUrl };
    }
  } catch (e) {
    console.error(`[ads/${adRow.id}] live copy fetch failed:`, e);
  }
  return adRow;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ adId: string }> }
) {
  const session = await getSessionOrPublic();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = session.accountId;
  const allAccountIds: string[] = session.allAccountIds;
  if (!accountId) return NextResponse.json({ error: "No account connected" }, { status: 400 });

  const { adId } = await params;

  const adRow = await db.select().from(ads).where(eq(ads.id, adId)).get();
  if (!adRow) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  // Verify this ad belongs to one of the user's accounts
  if (!allAccountIds.includes(adRow.accountId)) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  // Fills in caption/headline/link live from Meta if the DB row is empty
  // (happens for Dynamic Creative ads synced before the extractor upgrade).
  const ad = await ensureCopy(adRow);

  const userSettings = await db.select().from(settings).where(eq(settings.id, 1)).get();
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

  const metrics = await db
    .select()
    .from(dailyMetrics)
    .where(eq(dailyMetrics.adId, adId))
    .orderBy(dailyMetrics.date)
    .all();

  const fatigue = calculateFatigueScore(metrics, scoringSettings);

  const adAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.adId, adId))
    .orderBy(desc(alerts.createdAt))
    .limit(20)
    .all();

  return NextResponse.json({
    ad,
    fatigue,
    metrics,
    alerts: adAlerts,
  });
}
