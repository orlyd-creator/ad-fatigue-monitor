import { db } from "@/lib/db";
import { ads, dailyMetrics, alerts, accounts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
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
    await delay(500);
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

  // Determine lookback window
  const existingMetrics = await db.select({ id: dailyMetrics.id }).from(dailyMetrics).limit(1).all();
  const isFirstSync = existingMetrics.length === 0;
  const lookbackDays = isFirstSync ? 30 : 3;
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
      console.log(`[sync] Account verified: "${accountInfo.name}" | Status: ${accountInfo.account_status} | Total spent: ${accountInfo.amount_spent} ${accountInfo.currency}`);
    } catch (e: any) {
      result.errors.push(`Cannot access ad account ${actId}: ${e.message}. Make sure ads_read permission is granted.`);
      return result;
    }

    // ── Step 2: Fetch ALL ads (no status filter — get everything) ─
    console.log("[sync] Step 2: Fetching all ads...");
    let allAds: any[] = [];

    // Try without effective_status filter first (gets everything)
    try {
      allAds = await paginateAll(`/${actId}/ads`, token, {
        fields: "id,name,status,effective_status,campaign{id,name},adset{id,name},created_time,creative{thumbnail_url}",
      });
      console.log(`[sync] Found ${allAds.length} ads (no filter)`);
    } catch (e: any) {
      console.error(`[sync] Ads fetch failed: ${e.message}`);
      // Fallback: try with explicit statuses
      try {
        console.log("[sync] Trying with explicit status filter...");
        allAds = await paginateAll(`/${actId}/ads`, token, {
          fields: "id,name,status,effective_status,campaign{id,name},adset{id,name},created_time,creative{thumbnail_url}",
          effective_status: JSON.stringify(["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]),
        });
        console.log(`[sync] Fallback found ${allAds.length} ads`);
      } catch (e2: any) {
        result.errors.push(`Failed to fetch ads: ${e2.message}`);
        return result;
      }
    }

    if (allAds.length === 0) {
      // One more fallback: try fetching via campaigns
      console.log("[sync] 0 ads found. Trying campaign-level fetch...");
      try {
        const campaigns = await paginateAll(`/${actId}/campaigns`, token, {
          fields: "id,name,status,effective_status",
        });
        console.log(`[sync] Found ${campaigns.length} campaigns`);

        if (campaigns.length === 0) {
          result.errors.push(`No campaigns or ads found in account ${actId}. Account status: ${accountInfo?.account_status}. Make sure you have ads_read permission and at least one campaign.`);
          return result;
        }

        // Fetch ads from each campaign
        for (const campaign of campaigns.slice(0, 20)) {
          await delay(500);
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
        result.errors.push(`Campaign fetch also failed: ${e.message}`);
      }
    }

    if (allAds.length === 0) {
      result.errors.push("No ads found. This could mean: (1) Your ad account has no ads, (2) The ads_read permission isn't granted — check Meta Developer Console → App Review → Permissions, or (3) Your app is in Development mode and needs to be switched to Live.");
      return result;
    }

    // Save ad records
    console.log(`[sync] Saving ${allAds.length} ads to database...`);
    for (const ad of allAds) {
      result.adsFound++;
      const adStatus = ad.effective_status || ad.status || "UNKNOWN";
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
          thumbnailUrl: ad.creative?.thumbnail_url || null,
        })
        .onConflictDoUpdate({
          target: ads.id,
          set: {
            campaignName: ad.campaign?.name || "Unknown",
            adsetName: ad.adset?.name || "Unknown",
            adName: ad.name,
            status: adStatus,
            lastSyncedAt: Date.now(),
            thumbnailUrl: ad.creative?.thumbnail_url || null,
          },
        })
        .run();
    }

    // ── Step 3: Fetch insights (metrics) ─────────────────────────
    console.log("[sync] Step 3: Fetching insights...");
    await delay(1000);

    let insights: any[] = [];
    try {
      insights = await paginateAll(`/${actId}/insights`, token, {
        fields: [
          "ad_id", "ad_name", "impressions", "reach", "clicks", "spend",
          "frequency", "ctr", "cpm", "cpc", "actions", "cost_per_action_type",
          "inline_post_engagement",
        ].join(","),
        time_range: JSON.stringify({ since, until }),
        time_increment: "1",
        level: "ad",
      });
    } catch (e: any) {
      console.error(`[sync] Insights fetch failed: ${e.message}`);
      result.errors.push(`Insights fetch failed: ${e.message}`);
    }

    console.log(`[sync] Got ${insights.length} insight rows`);

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

    // ── Step 4: Run fatigue scoring ──────────────────────────────
    console.log("[sync] Step 4: Fatigue scoring...");
    const allDbAds = await db.select().from(ads).where(eq(ads.accountId, accountId)).all();

    for (const ad of allDbAds) {
      const metrics = await db.select().from(dailyMetrics).where(eq(dailyMetrics.adId, ad.id)).orderBy(dailyMetrics.date).all();
      const fatigueResult = calculateFatigueScore(metrics);
      if (fatigueResult.dataStatus !== "sufficient") continue;

      const lastAlert = await db.select().from(alerts).where(eq(alerts.adId, ad.id)).orderBy(desc(alerts.createdAt)).limit(1).get();
      const stageOrder = { healthy: 0, early_warning: 1, fatiguing: 2, fatigued: 3 } as const;
      const previousStage = (lastAlert?.stage as keyof typeof stageOrder) ?? "healthy";

      if (stageOrder[fatigueResult.stage] > stageOrder[previousStage]) {
        await db.insert(alerts).values({
          adId: ad.id,
          fatigueScore: fatigueResult.fatigueScore,
          stage: fatigueResult.stage,
          signals: JSON.stringify(fatigueResult.signals),
        }).run();
        result.alertsGenerated++;
      }
    }

    console.log(`[sync] ✅ Done! ${result.adsFound} ads, ${result.metricsUpserted} metrics, ${result.alertsGenerated} alerts`);
  } catch (err: any) {
    result.errors.push(`Sync failed: ${err.message}`);
    console.error("[sync] ❌ Error:", err.message, err.stack);
  }

  return result;
}
