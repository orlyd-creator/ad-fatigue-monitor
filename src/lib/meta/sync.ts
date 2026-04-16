import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, accounts } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import { format, subDays } from "date-fns";

const META_API = "https://graph.facebook.com/v21.0";

interface SyncResult {
  adsFound: number;
  metricsUpserted: number;
  alertsGenerated: number;
  errors: string[];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function metaFetch(url: string, token: string, params: Record<string, string> = {}) {
  const u = new URL(url.startsWith("http") ? url : `${META_API}${url}`);
  u.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  console.log(`[meta] GET ${u.pathname}${u.search.replace(/access_token=[^&]+/, "access_token=***")}`);

  const res = await fetch(u.toString());
  const body = await res.json().catch(() => ({ error: { message: res.statusText } }));

  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    console.error(`[meta] ERROR ${res.status}: ${msg}`);
    throw new Error(`Meta API ${res.status}: ${msg}`);
  }

  console.log(`[meta] OK — ${Array.isArray(body?.data) ? body.data.length + " items" : "object"}`);
  return body;
}

async function paginateAll(url: string, token: string, params: Record<string, string> = {}) {
  const all: any[] = [];
  const first = await metaFetch(url, token, { ...params, limit: "500" });
  all.push(...(first.data || []));
  let next = first.paging?.next;
  let page = 1;
  while (next && page < 20) {
    await delay(300);
    page++;
    console.log(`[meta] Paginating page ${page}...`);
    const res = await fetch(next);
    if (!res.ok) break;
    const data = await res.json();
    all.push(...(data.data || []));
    next = data.paging?.next;
  }
  return all;
}

export async function syncAccount(accountId: string): Promise<SyncResult> {
  const result: SyncResult = { adsFound: 0, metricsUpserted: 0, alertsGenerated: 0, errors: [] };

  // Step 0: Load account from DB
  const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) {
    result.errors.push("Account not found in database");
    return result;
  }

  const token = account.accessToken;
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const now = new Date();

  // Check token expiry
  if (account.tokenExpiresAt < Date.now()) {
    result.errors.push("Token expired. Please reconnect your Meta account.");
    return result;
  }

  // Determine lookback window — always pull from start of current month minimum
  // This ensures spend data is complete for the current period even if ads were paused mid-month
  const existingAds = await db.select({ id: ads.id }).from(ads).where(eq(ads.accountId, accountId)).limit(1).all();
  const isFirstSync = existingAds.length === 0;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysSinceMonthStart = Math.ceil((now.getTime() - startOfMonth.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const lookbackDays = isFirstSync ? 60 : Math.max(daysSinceMonthStart, 7);
  const since = format(subDays(now, lookbackDays), "yyyy-MM-dd");
  const until = format(now, "yyyy-MM-dd");

  console.log(`[sync] Account: ${actId} | ${isFirstSync ? "First sync (30d)" : "Incremental (3d)"}: ${since} → ${until}`);

  try {
    // ── Step 1: Verify account access ────────────────────────────
    console.log("[sync] Step 1: Verifying account access...");
    let accountInfo;
    try {
      accountInfo = await metaFetch(`/${actId}`, token, {
        fields: "name,account_status,amount_spent,currency",
      });
      console.log(`[sync] Account verified: "${accountInfo.name}" | Status: ${accountInfo.account_status}`);
    } catch (e: any) {
      result.errors.push(`Cannot access ad account ${actId}: ${e.message}`);
      return result;
    }

    // ── Step 2: Fetch ACTIVE ads only (fast — typically 5-50 ads) ─
    console.log("[sync] Step 2: Fetching active ads...");
    let activeAds: any[] = [];

    try {
      // Only get ads that are actually running (ACTIVE effective_status)
      // Pull creative details: full image, body text, headline
      activeAds = await paginateAll(`/${actId}/ads`, token, {
        fields: "id,name,status,effective_status,campaign{id,name},adset{id,name},created_time,creative{thumbnail_url,image_url,body,title,link_url,object_story_spec}",
        effective_status: JSON.stringify(["ACTIVE"]),
      });
      console.log(`[sync] Found ${activeAds.length} ACTIVE ads`);
    } catch (e: any) {
      console.error(`[sync] Active ads fetch failed: ${e.message}`);
    }

    // Also grab recently paused ads (they might have just been paused and still need scoring)
    let recentPausedAds: any[] = [];
    try {
      recentPausedAds = await paginateAll(`/${actId}/ads`, token, {
        fields: "id,name,status,effective_status,campaign{id,name},adset{id,name},created_time,creative{thumbnail_url,image_url,body,title,link_url,object_story_spec}",
        effective_status: JSON.stringify(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]),
      });
      console.log(`[sync] Found ${recentPausedAds.length} paused ads`);
    } catch (e: any) {
      console.error(`[sync] Paused ads fetch failed: ${e.message}`);
    }

    const allAds = [...activeAds, ...recentPausedAds];

    if (allAds.length === 0) {
      // Fallback: try campaign-level fetch
      console.log("[sync] 0 ads found. Trying campaign-level fetch...");
      try {
        const campaigns = await paginateAll(`/${actId}/campaigns`, token, {
          fields: "id,name,status,effective_status",
        });
        console.log(`[sync] Found ${campaigns.length} campaigns`);

        if (campaigns.length === 0) {
          result.errors.push(`No campaigns or ads found in account ${actId}. Make sure you have active campaigns.`);
          return result;
        }

        for (const campaign of campaigns.slice(0, 10)) {
          await delay(300);
          try {
            const campaignAds = await paginateAll(`/${campaign.id}/ads`, token, {
              fields: "id,name,status,effective_status,adset{id,name},created_time,creative{thumbnail_url}",
            });
            for (const ad of campaignAds) {
              ad.campaign = { id: campaign.id, name: campaign.name };
            }
            allAds.push(...campaignAds);
          } catch {
            console.error(`[sync] Failed to fetch ads for campaign ${campaign.id}`);
          }
        }
        console.log(`[sync] Campaign-level fetch got ${allAds.length} ads total`);
      } catch (e: any) {
        result.errors.push(`Campaign fetch failed: ${e.message}`);
      }
    }

    if (allAds.length === 0) {
      result.errors.push("No ads found. Check that ads_read permission is granted and you have at least one campaign.");
      return result;
    }

    // Save ad records
    console.log(`[sync] Saving ${allAds.length} ads to database...`);
    for (const ad of allAds) {
      result.adsFound++;
      const adStatus = ad.effective_status || ad.status || "UNKNOWN";
      const creative = ad.creative || {};
      // Extract body text from creative or object_story_spec
      const adBody = creative.body || creative.object_story_spec?.link_data?.message || creative.object_story_spec?.video_data?.message || null;
      const adHeadline = creative.title || creative.object_story_spec?.link_data?.name || creative.object_story_spec?.video_data?.title || null;
      const imageUrl = creative.image_url || null;
      const adLinkUrl = creative.link_url || creative.object_story_spec?.link_data?.link || null;

      await db.insert(ads)
        .values({
          id: ad.id,
          accountId,
          campaignId: ad.campaign?.id || "",
          campaignName: ad.campaign?.name || "Unknown",
          adsetId: ad.adset?.id || "",
          adsetName: ad.adset?.name || "Unknown",
          adName: ad.name,
          status: adStatus,
          createdAt: ad.created_time ? new Date(ad.created_time).getTime() : null,
          lastSyncedAt: Date.now(),
          thumbnailUrl: creative.thumbnail_url || null,
          imageUrl,
          adBody,
          adHeadline,
          adLinkUrl,
        })
        .onConflictDoUpdate({
          target: ads.id,
          set: {
            campaignName: ad.campaign?.name || "Unknown",
            adsetName: ad.adset?.name || "Unknown",
            adName: ad.name,
            status: adStatus,
            lastSyncedAt: Date.now(),
            thumbnailUrl: creative.thumbnail_url || null,
            imageUrl,
            adBody,
            adHeadline,
            adLinkUrl,
          },
        })
        .run();
    }

    // ── Step 3: Fetch insights for ALL synced ads (active + paused) ─
    // Paused ads may have had spend earlier in the month — must include them
    console.log("[sync] Step 3: Fetching insights for all synced ads...");
    await delay(500);

    let insights: any[] = [];
    const insightFields = [
      "ad_id", "ad_name", "impressions", "reach", "clicks", "spend",
      "frequency", "ctr", "cpm", "cpc", "actions", "cost_per_action_type",
      "inline_post_engagement",
    ].join(",");

    try {
      // Fetch account-level insights for active + paused ads
      insights = await paginateAll(`/${actId}/insights`, token, {
        fields: insightFields,
        time_range: JSON.stringify({ since, until }),
        time_increment: "1",
        level: "ad",
        filtering: JSON.stringify([{
          field: "ad.effective_status",
          operator: "IN",
          value: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"],
        }]),
      });
    } catch (e: any) {
      console.error(`[sync] Filtered insights failed, trying unfiltered: ${e.message}`);
      try {
        insights = await paginateAll(`/${actId}/insights`, token, {
          fields: insightFields,
          time_range: JSON.stringify({ since, until }),
          time_increment: "1",
          level: "ad",
        });
      } catch (e2: any) {
        result.errors.push(`Insights fetch failed: ${e2.message}`);
      }
    }

    console.log(`[sync] Got ${insights.length} insight rows`);

    // Batch process insights
    for (const insight of insights) {
      const adId = insight.ad_id;
      if (!adId) continue;

      const totalActions = insight.actions?.reduce((sum: number, a: any) => sum + parseInt(a.value, 10), 0) ?? 0;
      const clicks = parseInt(insight.clicks || "0", 10);
      const costPerAction =
        insight.cost_per_action_type?.find((a: any) => a.action_type === "link_click" || a.action_type === "offsite_conversion")?.value ??
        insight.cost_per_action_type?.[0]?.value ?? "0";

      const row = {
        adId,
        date: insight.date_start,
        impressions: parseInt(insight.impressions || "0", 10),
        reach: parseInt(insight.reach || "0", 10),
        clicks,
        spend: parseFloat(insight.spend || "0"),
        frequency: parseFloat(insight.frequency || "0"),
        ctr: parseFloat(insight.ctr || "0"),
        cpm: parseFloat(insight.cpm || "0"),
        cpc: parseFloat(insight.cpc || "0"),
        actions: totalActions,
        costPerAction: parseFloat(costPerAction),
        conversionRate: clicks > 0 ? totalActions / clicks : 0,
        inlinePostEngagement: parseInt(insight.inline_post_engagement || "0", 10),
        postReactions: 0,
        postComments: 0,
        postShares: 0,
      };

      await db.insert(dailyMetrics)
        .values(row)
        .onConflictDoUpdate({ target: [dailyMetrics.adId, dailyMetrics.date], set: row })
        .run();
      result.metricsUpserted++;
    }

    // ── Step 4: Run fatigue scoring (only active + recently paused ads) ──
    console.log("[sync] Step 4: Fatigue scoring...");
    const syncedAdIds = allAds.filter((a: any) => a.effective_status === "ACTIVE" || a.status === "ACTIVE").map((a: any) => a.id);

    // Only score the ads we just synced, not all 1100+ in the DB
    for (const adId of syncedAdIds) {
      const metrics = await db.select().from(dailyMetrics).where(eq(dailyMetrics.adId, adId)).orderBy(dailyMetrics.date).all();
      const fatigueResult = calculateFatigueScore(metrics);
      if (fatigueResult.dataStatus !== "sufficient") continue;

      const lastAlert = await db.select().from(alerts).where(eq(alerts.adId, adId)).orderBy(desc(alerts.createdAt)).limit(1).get();
      const stageOrder = { healthy: 0, early_warning: 1, fatiguing: 2, fatigued: 3 } as const;
      const previousStage = (lastAlert?.stage as keyof typeof stageOrder) ?? "healthy";

      if (stageOrder[fatigueResult.stage] > stageOrder[previousStage]) {
        await db.insert(alerts).values({
          adId,
          fatigueScore: fatigueResult.fatigueScore,
          stage: fatigueResult.stage,
          signals: JSON.stringify(fatigueResult.signals),
        }).run();
        result.alertsGenerated++;
      }
    }

    console.log(`[sync] Done! ${result.adsFound} ads, ${result.metricsUpserted} metrics, ${result.alertsGenerated} alerts`);
  } catch (err: any) {
    result.errors.push(`Sync failed: ${err.message}`);
    console.error("[sync] Error:", err.message, err.stack);
  }

  return result;
}
