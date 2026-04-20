import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, accounts } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { calculateFatigueScore } from "@/lib/fatigue/scoring";
import { format, subDays } from "date-fns";
import { refreshLongLivedToken } from "@/lib/meta/client";

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

/** Split [since, until] (YYYY-MM-DD inclusive) into consecutive windows of up to `days` days. */
function chunkDateRange(since: string, until: string, days: number): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  const start = new Date(since + "T00:00:00Z");
  const end = new Date(until + "T00:00:00Z");
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + days - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push([
      cursor.toISOString().slice(0, 10),
      chunkEnd.toISOString().slice(0, 10),
    ]);
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

async function paginateAll(url: string, token: string, params: Record<string, string> = {}) {
  const all: any[] = [];
  const first = await metaFetch(url, token, { ...params, limit: "500" });
  all.push(...(first.data || []));
  let next = first.paging?.next;
  let page = 1;
  // Safety cap raised to 100 pages (50k items at limit=500). Previous hard cap
  // of 20 would silently drop ads on accounts with >10k items. If we hit 100,
  // log loudly so we notice before data gets missed.
  while (next && page < 100) {
    await delay(300);
    page++;
    console.log(`[meta] Paginating page ${page}...`);
    const res = await fetch(next);
    if (!res.ok) {
      console.warn(`[meta] Pagination stopped at page ${page} (HTTP ${res.status}) — some data may be missing`);
      break;
    }
    const data = await res.json();
    all.push(...(data.data || []));
    next = data.paging?.next;
  }
  if (next) {
    console.error(`[meta] WARNING: Hit 100-page pagination cap. Account has more than ~50k items — data is being truncated.`);
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

  let token = account.accessToken;
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const now = new Date();

  // Auto-refresh token if expiring within 7 days or already expired
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (account.tokenExpiresAt - Date.now() < sevenDays) {
    console.log(`[sync] Token expiring soon or expired for ${actId}, attempting refresh...`);
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (appId && appSecret) {
      const refreshed = await refreshLongLivedToken(token, appId, appSecret);
      if (refreshed) {
        token = refreshed.access_token;
        await db.update(accounts).set({
          accessToken: refreshed.access_token,
          tokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
          updatedAt: Date.now(),
        }).where(eq(accounts.id, accountId)).run();
        console.log(`[sync] Token refreshed for ${actId}, new expiry: ${new Date(Date.now() + refreshed.expires_in * 1000).toISOString()}`);
      } else {
        console.error(`[sync] Token refresh failed for ${actId}`);
        if (account.tokenExpiresAt < Date.now()) {
          result.errors.push("Token expired and refresh failed. Please reconnect your Meta account at /login.");
          return result;
        }
      }
    } else if (account.tokenExpiresAt < Date.now()) {
      result.errors.push("Token expired. Please reconnect your Meta account at /login.");
      return result;
    }
  }

  // Determine lookback window — pull a rolling 180-day (~6mo) window on every
  // sync. The Executive view has a "Last 6 months" preset and partial months
  // at the far edge cause investor-facing charts to look wrong (e.g. Jan
  // showing $13.8k when only Jan 20-31 was captured). 180d covers the widest
  // default preset we offer.
  const existingAds = await db.select({ id: ads.id }).from(ads).where(eq(ads.accountId, accountId)).limit(1).all();
  const isFirstSync = existingAds.length === 0;
  const lookbackDays = isFirstSync ? 365 : 180;
  const since = format(subDays(now, lookbackDays), "yyyy-MM-dd");
  const until = format(now, "yyyy-MM-dd");

  console.log(`[sync] Account: ${actId} | ${isFirstSync ? "First sync (365d)" : "Incremental (180d)"}: ${since} → ${until}`);

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

    // ── Step 2: Fetch ALL ads regardless of status ─
    // Pulling everything ensures ad statuses are always up-to-date — if user paused
    // an ad in Meta, we'll see the new status on next sync.
    console.log("[sync] Step 2: Fetching all ads (all statuses)...");
    let allAdsFetch: any[] = [];

    try {
      allAdsFetch = await paginateAll(`/${actId}/ads`, token, {
        fields: "id,name,status,effective_status,campaign{id,name},adset{id,name},created_time,creative{thumbnail_url.width(1080).height(1080),image_url,image_hash,body,title,link_url,object_story_spec,asset_feed_spec,effective_object_story_id}",
        effective_status: JSON.stringify([
          "ACTIVE", "PAUSED", "DELETED", "PENDING_REVIEW", "DISAPPROVED",
          "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ARCHIVED",
          "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES",
        ]),
      });
      console.log(`[sync] Found ${allAdsFetch.length} ads total`);
    } catch (e: any) {
      console.error(`[sync] All-status ads fetch failed: ${e.message}`);
    }

    const allAds = allAdsFetch;

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

    // Resolve image_hash → permanent_url for ads that only expose image_hash
    // (common for broad/awareness static image ads where asset_feed_spec is
    // empty and creative.image_url is a tiny thumbnail).
    const hashesToResolve = new Set<string>();
    for (const ad of allAds) {
      const h = ad.creative?.image_hash;
      const hasGoodUrl =
        ad.creative?.asset_feed_spec?.images?.[0]?.url ||
        ad.creative?.object_story_spec?.link_data?.picture ||
        ad.creative?.object_story_spec?.photo_data?.picture;
      if (h && !hasGoodUrl) hashesToResolve.add(h);
    }
    const hashToUrl = new Map<string, string>();
    if (hashesToResolve.size > 0) {
      try {
        const hashArr = Array.from(hashesToResolve);
        // adimages endpoint accepts a JSON array of hashes
        const imgRes = await metaFetch(`/${actId}/adimages`, token, {
          hashes: JSON.stringify(hashArr),
          fields: "hash,permalink_url,url,url_128",
        });
        for (const img of imgRes.data || []) {
          const stable = img.permalink_url || img.url;
          if (img.hash && stable) hashToUrl.set(img.hash, stable);
        }
        console.log(`[sync] Resolved ${hashToUrl.size}/${hashesToResolve.size} image_hash lookups for sharper thumbnails`);
      } catch (e: any) {
        console.error(`[sync] adimages hash lookup failed (non-fatal): ${e.message}`);
      }
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
      const adLinkUrl = creative.link_url || creative.object_story_spec?.link_data?.link || null;

      // Prefer STABLE Facebook CDN URLs over Meta's parameterized thumbnail_url.
      // thumbnail_url.width(1080).height(1080) returns a signed URL that expires
      // within hours, so once the DB row ages the image 404s. asset_feed_spec
      // and object_story_spec URLs are long-lived scontent.* CDN URLs.
      // creative.image_url is smaller (~100-400px) but also stable.
      const assetFeedImage = creative.asset_feed_spec?.images?.[0]?.url;
      const storyPictureLink = creative.object_story_spec?.link_data?.picture;
      const storyPicturePhoto = creative.object_story_spec?.photo_data?.picture;
      // Resolved stable URL from the image_hash → adimages lookup above.
      const hashResolved = creative.image_hash ? hashToUrl.get(creative.image_hash) : null;
      const imageUrl =
        assetFeedImage ||
        storyPictureLink ||
        storyPicturePhoto ||
        hashResolved ||
        creative.image_url ||
        null;
      // thumbnailUrl is ONLY used if imageUrl is missing. It's signed/expiring,
      // so refreshed on every sync.

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

    // Chunk the date range into 30-day windows. Meta's Insights API rejects or
    // silently truncates giant responses; a 90-day ad-level daily query can
    // easily exceed what it will return in one pagination loop. Chunking also
    // gives us resilience — one failed chunk doesn't lose the whole sync.
    const chunks = chunkDateRange(since, until, 30);
    for (const [cSince, cUntil] of chunks) {
      try {
        const chunkInsights = await paginateAll(`/${actId}/insights`, token, {
          fields: insightFields,
          time_range: JSON.stringify({ since: cSince, until: cUntil }),
          time_increment: "1",
          level: "ad",
        });
        insights.push(...chunkInsights);
        console.log(`[sync] Insights chunk ${cSince}→${cUntil}: ${chunkInsights.length} rows`);
      } catch (e: any) {
        result.errors.push(`Insights fetch failed for ${cSince}→${cUntil}: ${e.message}`);
      }
    }

    // First, clear any stale synthetic "unattributed" rows from previous syncs in this window.
    // We'll re-derive them from the current fetch so we never double-count.
    try {
      const { sql } = await import("drizzle-orm");
      await db.run(sql`DELETE FROM daily_metrics WHERE ad_id LIKE '__unattributed_%' AND date >= ${since} AND date <= ${until}`);
    } catch (e: any) {
      console.log(`[sync] Could not clean stale unattributed rows: ${e.message}`);
    }

    // Ground-truth cross-check: account-level spend vs ad-level spend sum.
    // Account-level is what Ads Manager shows; ad-level can miss rows for deleted creative.
    try {
      const acctDaily: any[] = [];
      for (const [cSince, cUntil] of chunks) {
        const chunkDaily = await paginateAll(`/${actId}/insights`, token, {
          fields: "spend,impressions,clicks",
          time_range: JSON.stringify({ since: cSince, until: cUntil }),
          time_increment: "1",
        });
        acctDaily.push(...chunkDaily);
      }
      console.log(`[sync] Account-level daily spend rows: ${acctDaily.length}`);
      const totalAcct = acctDaily.reduce((s: number, d: any) => s + parseFloat(d.spend || "0"), 0);
      const totalAdLevel = insights.reduce((s: number, r: any) => s + parseFloat(r.spend || "0"), 0);
      console.log(`[sync] Account-level total: $${totalAcct.toFixed(2)} | Ad-level total: $${totalAdLevel.toFixed(2)} | Gap: $${(totalAcct - totalAdLevel).toFixed(2)}`);
      const adLevelByDate = new Map<string, number>();
      for (const r of insights) {
        const d = r.date_start;
        adLevelByDate.set(d, (adLevelByDate.get(d) || 0) + parseFloat(r.spend || "0"));
      }
      let gap = 0;
      for (const day of acctDaily) {
        const acctSpend = parseFloat(day.spend || "0");
        const adSpend = adLevelByDate.get(day.date_start) || 0;
        const dayGap = acctSpend - adSpend;
        if (dayGap > 0.5) {
          gap += dayGap;
          console.log(`[sync] ⚠️  Gap on ${day.date_start}: acct=$${acctSpend.toFixed(2)} vs ad-level=$${adSpend.toFixed(2)} (missing $${dayGap.toFixed(2)})`);
          // Insert synthetic "unattributed" daily row so the totals match the account
          const syntheticId = `__unattributed_${day.date_start}`;
          await db.insert(ads).values({
            id: syntheticId,
            accountId,
            campaignId: "",
            campaignName: "Unattributed",
            adsetId: "",
            adsetName: "Unattributed",
            adName: "Unattributed spend",
            status: "ARCHIVED",
            createdAt: null,
            lastSyncedAt: Date.now(),
            thumbnailUrl: null,
            imageUrl: null,
            adBody: null,
            adHeadline: null,
            adLinkUrl: null,
          }).onConflictDoNothing().run();
          await db.insert(dailyMetrics).values({
            adId: syntheticId,
            date: day.date_start,
            impressions: 0,
            reach: 0,
            clicks: 0,
            spend: dayGap,
            frequency: 0,
            ctr: 0,
            cpm: 0,
            cpc: 0,
            actions: 0,
            costPerAction: 0,
            conversionRate: 0,
            inlinePostEngagement: 0,
            postReactions: 0,
            postComments: 0,
            postShares: 0,
          }).onConflictDoUpdate({ target: [dailyMetrics.adId, dailyMetrics.date], set: { spend: dayGap } }).run();
          result.metricsUpserted++;
        }
      }
      if (gap > 0.5) console.log(`[sync] Closed $${gap.toFixed(2)} spend gap with unattributed rows`);
      else console.log(`[sync] ✓ Ad-level spend matches account-level spend`);
    } catch (e: any) {
      console.error(`[sync] Account-level cross-check failed (non-fatal): ${e.message}`);
    }

    console.log(`[sync] Got ${insights.length} insight rows`);

    // Identify insight ads we don't have records for (archived/deleted) — create stub ad rows
    // so their spend isn't dropped by join filters on the leads page
    const knownAdIds = new Set(allAds.map((a: any) => a.id));
    const orphanAdIds = new Set<string>();
    for (const insight of insights) {
      if (insight.ad_id && !knownAdIds.has(insight.ad_id)) {
        orphanAdIds.add(insight.ad_id);
      }
    }
    if (orphanAdIds.size > 0) {
      console.log(`[sync] Creating stub records for ${orphanAdIds.size} archived/deleted ads so their spend is preserved`);
      for (const orphanId of orphanAdIds) {
        const insightRow = insights.find((i: any) => i.ad_id === orphanId);
        await db.insert(ads)
          .values({
            id: orphanId,
            accountId,
            campaignId: "",
            campaignName: "Archived/Deleted",
            adsetId: "",
            adsetName: "Archived/Deleted",
            adName: insightRow?.ad_name || `Archived Ad ${orphanId}`,
            status: "ARCHIVED",
            createdAt: null,
            lastSyncedAt: Date.now(),
            thumbnailUrl: null,
            imageUrl: null,
            adBody: null,
            adHeadline: null,
            adLinkUrl: null,
          })
          .onConflictDoNothing()
          .run();
        result.adsFound++;
      }
    }

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
