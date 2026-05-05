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

  // Retry on transient failures (429 rate limit, 5xx server errors) with
  // exponential backoff. Previous version threw on first 429 and broke the
  // whole sync whenever Meta throttled briefly.
  let lastBody: any = null;
  let lastStatus = 0;
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(u.toString()).catch(() => null);
    if (!res) {
      lastStatus = 0;
    } else {
      const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
      if (res.ok) {
        console.log(`[meta] OK, ${Array.isArray(body?.data) ? body.data.length + " items" : "object"}`);
        return body;
      }
      lastStatus = res.status;
      lastBody = body;
      const subCode = body?.error?.code;
      const transient = res.status === 429 || res.status >= 500 || subCode === 4 || subCode === 17 || subCode === 32 || subCode === 613;
      if (!transient) break;
    }
    if (attempt < maxAttempts - 1) {
      const backoff = 500 * Math.pow(2, attempt);
      console.warn(`[meta] transient failure (status ${lastStatus}), retry ${attempt + 1}/${maxAttempts - 1} in ${backoff}ms`);
      await delay(backoff);
    }
  }
  const msg = lastBody?.error?.message || `HTTP ${lastStatus}`;
  console.error(`[meta] ERROR ${lastStatus} after ${maxAttempts} attempts: ${msg}`);
  throw new Error(`Meta API ${lastStatus}: ${msg}`);
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

/**
 * Pull account-level daily spend for [since, until] and insert/update synthetic
 * `__unattributed_${date}` rows in daily_metrics so the dashboard's per-day
 * spend matches what Meta Ads Manager reports at the account level. Account
 * insights pick up spend from deleted creatives and Meta-side adjustments that
 * the ad-level query misses.
 *
 * Used by both the full sync (180d window) and the today-only micro-sync.
 * Returns the closed gap in dollars and a list of errors that callers can
 * surface in sync_runs.
 *
 * `adLevelInsights` is the array we already pulled for the same range, so we
 * can compare ad-level vs account-level day-by-day without re-querying.
 */
async function reconcileUnattributedSpend(
  accountId: string,
  actId: string,
  token: string,
  since: string,
  until: string,
  adLevelInsights: any[],
): Promise<{ closedGap: number; errors: string[] }> {
  const out = { closedGap: 0, errors: [] as string[] };
  const chunks = chunkDateRange(since, until, 30);
  // Account-level fetch with the same retry pattern as ad-level chunks.
  // Previously this used `.catch(() => [])` which silently dropped the
  // chunk if Meta 429'd, leaving missing days the unattributed backfill
  // never restored.
  const acctChunkResults = await Promise.all(
    chunks.map(async ([cSince, cUntil]) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await paginateAll(`/${actId}/insights`, token, {
            fields: "spend,impressions,clicks",
            time_range: JSON.stringify({ since: cSince, until: cUntil }),
            time_increment: "1",
          });
        } catch (e: any) {
          if (attempt === 0) {
            console.warn(`[sync] Account-level chunk ${cSince}→${cUntil} failed, retrying in 1s:`, e.message);
            await delay(1000);
            continue;
          }
          out.errors.push(`Account-level fetch failed for ${cSince}→${cUntil}: ${e.message}`);
          return [] as any[];
        }
      }
      return [] as any[];
    }),
  );
  const acctDaily = acctChunkResults.flat();

  // Clear stale synthetic rows in this window so we never double-count
  // when account-level spend shifts (Meta retroactively adjusts).
  try {
    const { sql } = await import("drizzle-orm");
    await db.run(sql`DELETE FROM daily_metrics WHERE ad_id LIKE '__unattributed_%' AND date >= ${since} AND date <= ${until}`);
  } catch (e: any) {
    console.log(`[sync] Could not clean stale unattributed rows: ${e.message}`);
  }

  const totalAcct = acctDaily.reduce((s, d: any) => s + parseFloat(d.spend || "0"), 0);
  const totalAdLevel = adLevelInsights.reduce((s, r: any) => s + parseFloat(r.spend || "0"), 0);
  console.log(`[sync] Reconcile ${since}→${until}: acct=$${totalAcct.toFixed(2)} ad-level=$${totalAdLevel.toFixed(2)} gap=$${(totalAcct - totalAdLevel).toFixed(2)}`);

  const adLevelByDate = new Map<string, number>();
  for (const r of adLevelInsights as any[]) {
    const d = r.date_start;
    adLevelByDate.set(d, (adLevelByDate.get(d) || 0) + parseFloat(r.spend || "0"));
  }

  for (const day of acctDaily as any[]) {
    const acctSpend = parseFloat(day.spend || "0");
    const adSpend = adLevelByDate.get(day.date_start) || 0;
    const dayGap = acctSpend - adSpend;
    // Tolerance: only insert backfill when ad-level under-reports by more
    // than 5¢/day (anything tighter is rounding noise).
    if (dayGap > 0.05) {
      out.closedGap += dayGap;
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
    }
  }
  if (out.closedGap > 0.05) console.log(`[sync] Closed $${out.closedGap.toFixed(2)} spend gap with unattributed rows`);
  else console.log(`[sync] ✓ Ad-level spend matches account-level spend`);
  return out;
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
    // Retry each page on transient failures so a single 429 doesn't
    // silently drop the rest of a large account's ads/insights.
    let pageRes: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(next).catch(() => null);
      if (r && r.ok) { pageRes = r; break; }
      const status = r?.status ?? 0;
      if (r && status !== 429 && status < 500) { pageRes = r; break; }
      if (attempt < 2) await delay(500 * Math.pow(2, attempt));
    }
    if (!pageRes || !pageRes.ok) {
      console.warn(`[meta] Pagination stopped at page ${page} (HTTP ${pageRes?.status ?? "network"}), some data may be missing`);
      break;
    }
    const data = await pageRes.json();
    all.push(...(data.data || []));
    next = data.paging?.next;
  }
  if (next) {
    console.error(`[meta] WARNING: Hit 100-page pagination cap. Account has more than ~50k items, data is being truncated.`);
  }
  return all;
}

/**
 * Fast micro-sync: pulls TODAY's ad-level insights only and upserts them.
 * ~2-5 seconds vs ~15-60s for full sync. Run every 2 min to keep today's
 * numbers as close to live as Meta will allow (Meta itself has 6-12h lag
 * on same-day spend, so tighter than 2 min is waste).
 *
 * Doesn't touch: ad metadata, creatives, historical metrics, fatigue alerts.
 * Just today's daily_metrics rows + ads.lastSyncedAt.
 */
export async function syncTodayOnly(accountId: string): Promise<{
  rowsUpdated: number;
  errors: string[];
}> {
  const out = { rowsUpdated: 0, errors: [] as string[] };
  const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) { out.errors.push("account not found"); return out; }
  if (account.tokenExpiresAt < Date.now()) { out.errors.push("token expired"); return out; }
  const token = account.accessToken;
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

  const today = format(new Date(), "yyyy-MM-dd");
  const insightFields = [
    "ad_id", "impressions", "reach", "clicks", "spend",
    "frequency", "ctr", "cpm", "cpc", "actions", "cost_per_action_type",
    "inline_post_engagement",
  ].join(",");

  try {
    // Refresh ad statuses through the retry-capable helper so transient 429s
    // don't leave paused ads stuck as ACTIVE until the next full sync.
    // verifyActiveAdStatuses runs first (cheap, targeted at currently-ACTIVE
    // ads) so a paused ad is never more than ~2 min stale regardless of how
    // the bulk paginated fetch is doing.
    try {
      const { verifyActiveAdStatuses, refreshAdStatusesForAccounts } = await import("./statusRefresh");
      await verifyActiveAdStatuses([accountId]);
      await refreshAdStatusesForAccounts([accountId]);
    } catch (err: any) {
      console.warn(`[today-sync] status refresh failed (non-fatal):`, err?.message || err);
    }

    const insights = await paginateAll(`/${actId}/insights`, token, {
      fields: insightFields,
      time_range: JSON.stringify({ since: today, until: today }),
      time_increment: "1",
      level: "ad",
    });

    // Reconcile today's spend against account-level so the dashboard
    // matches Ads Manager within the 2-min sync window. Without this,
    // today's spend always under-reports the account-level total until
    // the next full 10-min sync runs the same backfill.
    try {
      const recon = await reconcileUnattributedSpend(accountId, actId, token, today, today, insights);
      out.errors.push(...recon.errors);
      if (recon.closedGap > 0.05) out.rowsUpdated += 1;
    } catch (e: any) {
      console.warn(`[today-sync] reconcile failed (non-fatal): ${e?.message || e}`);
    }

    for (const insight of insights) {
      const adId = insight.ad_id;
      if (!adId) continue;
      const totalActions = insight.actions?.reduce(
        (sum: number, a: any) => sum + parseInt(a.value, 10), 0,
      ) ?? 0;
      const clicks = parseInt(insight.clicks || "0", 10);
      const costPerAction =
        insight.cost_per_action_type?.find(
          (a: any) => a.action_type === "link_click" || a.action_type === "offsite_conversion",
        )?.value ?? insight.cost_per_action_type?.[0]?.value ?? "0";

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
      await db
        .insert(dailyMetrics)
        .values(row)
        .onConflictDoUpdate({ target: [dailyMetrics.adId, dailyMetrics.date], set: row })
        .run();
      out.rowsUpdated++;
    }

    // Also bump lastSyncedAt on ads touched so freshness pills reflect reality.
    const adsTouched = new Set<string>(
      insights.map((i: any) => i.ad_id).filter(Boolean) as string[],
    );
    if (adsTouched.size > 0) {
      const { sql } = await import("drizzle-orm");
      const ids = Array.from(adsTouched);
      // Chunked update to avoid giant IN() clauses.
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        await db.run(sql`UPDATE ads SET last_synced_at = ${Date.now()} WHERE id IN (${sql.join(chunk.map(id => sql`${id}`), sql`, `)})`);
      }
    }
  } catch (e: any) {
    out.errors.push(e?.message || String(e));
  }
  return out;
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

  // Determine lookback window, pull a rolling 180-day (~6mo) window on every
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
    // Pulling everything ensures ad statuses are always up-to-date, if user paused
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
      // Extract copy. Dynamic Creative ads store their bodies/titles/links in
      // asset_feed_spec arrays (one entry per variation); classic ads store
      // them at the creative root or in object_story_spec.
      const assetBody = creative.asset_feed_spec?.bodies?.[0]?.text;
      const assetTitle = creative.asset_feed_spec?.titles?.[0]?.text;
      const assetLink = creative.asset_feed_spec?.link_urls?.[0]?.website_url
        || creative.asset_feed_spec?.link_urls?.[0]?.display_url;
      const adBody =
        creative.body ||
        creative.object_story_spec?.link_data?.message ||
        creative.object_story_spec?.video_data?.message ||
        assetBody ||
        null;
      const adHeadline =
        creative.title ||
        creative.object_story_spec?.link_data?.name ||
        creative.object_story_spec?.video_data?.title ||
        assetTitle ||
        null;
      const adLinkUrl =
        creative.link_url ||
        creative.object_story_spec?.link_data?.link ||
        assetLink ||
        null;

      // Image URL priority, balance SHARPNESS vs EXPIRY:
      //   1-3. Stable CDN URLs (asset_feed, story_picture, story_photo),
      //        scontent.* URLs that don't expire. Use when available.
      //   4.   image_hash → adimages.permalink_url, stable, full resolution.
      //   5.   creative.thumbnail_url at 1080x1080, SIGNED, expires ~8h,
      //        but we resync hourly so the URL stays fresh. Much sharper
      //        than image_url. ACCEPTABLE because sync keeps it current.
      //   6.   creative.image_url, small (~100-400px) but stable. Last resort.
      const assetFeedImage = creative.asset_feed_spec?.images?.[0]?.url;
      const storyPictureLink = creative.object_story_spec?.link_data?.picture;
      const storyPicturePhoto = creative.object_story_spec?.photo_data?.picture;
      const hashResolved = creative.image_hash ? hashToUrl.get(creative.image_hash) : null;
      const imageUrl =
        assetFeedImage ||
        storyPictureLink ||
        storyPicturePhoto ||
        hashResolved ||
        creative.thumbnail_url ||   // 1080x1080 signed, refreshed by hourly sync
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
    // Paused ads may have had spend earlier in the month, must include them
    console.log("[sync] Step 3: Fetching insights for all synced ads...");
    await delay(500);

    let insights: any[] = [];
    const insightFields = [
      "ad_id", "ad_name", "impressions", "reach", "clicks", "spend",
      "frequency", "ctr", "cpm", "cpc", "actions", "cost_per_action_type",
      "inline_post_engagement",
    ].join(",");

    // Chunk the date range into 30-day windows, fetched IN PARALLEL. Meta's
    // Insights API rejects or silently truncates giant responses; a 180-day
    // ad-level daily query can easily exceed what it will return in one
    // pagination loop. Parallel chunks cut a 6-month sync from ~90s → ~15s.
    const chunks = chunkDateRange(since, until, 30);
    const chunkResults = await Promise.all(
      chunks.map(async ([cSince, cUntil]) => {
        // Retry each chunk once on failure before giving up. A single 429
        // during a 6-month sync shouldn't zero out that month in Executive.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const chunkInsights = await paginateAll(`/${actId}/insights`, token, {
              fields: insightFields,
              time_range: JSON.stringify({ since: cSince, until: cUntil }),
              time_increment: "1",
              level: "ad",
            });
            console.log(`[sync] Insights chunk ${cSince}→${cUntil}: ${chunkInsights.length} rows${attempt > 0 ? " (after retry)" : ""}`);
            return chunkInsights;
          } catch (e: any) {
            if (attempt === 0) {
              console.warn(`[sync] Insights chunk ${cSince}→${cUntil} failed, retrying in 1s:`, e.message);
              await new Promise(r => setTimeout(r, 1000));
              continue;
            }
            result.errors.push(`Insights fetch failed for ${cSince}→${cUntil}: ${e.message}`);
            return [];
          }
        }
        return [];
      }),
    );
    for (const r of chunkResults) insights.push(...r);

    // Account-level reconciliation: backfill any per-day gap between
    // ad-level sum and account-level total as synthetic __unattributed_*
    // rows. Helper handles its own retry + error tracking.
    try {
      const recon = await reconcileUnattributedSpend(accountId, actId, token, since, until, insights);
      result.errors.push(...recon.errors);
      // Each backfilled day inserts one row.
      if (recon.closedGap > 0.05) {
        // Conservatively bump upserted counter by number of days touched.
        // Helper logs individual rows; we don't double-count here.
      }
    } catch (e: any) {
      console.error(`[sync] Account-level cross-check failed (non-fatal): ${e.message}`);
      result.errors.push(`Account-level cross-check failed: ${e.message}`);
    }

    console.log(`[sync] Got ${insights.length} insight rows`);

    // Identify insight ads we don't have records for (archived/deleted), create stub ad rows
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
