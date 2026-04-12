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

  const res = await fetch(u.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(`Meta API Error: ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

async function paginateAll(url: string, token: string, params: Record<string, string> = {}) {
  const all: any[] = [];
  const first = await metaFetch(url, token, { ...params, limit: "500" });
  all.push(...(first.data || []));
  let next = first.paging?.next;
  while (next) {
    await delay(500);
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

  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) { result.errors.push("Account not found"); return result; }

  const token = account.accessToken;
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const now = new Date();

  // First sync = 30 days, subsequent = 3 days
  const existingMetrics = db.select({ id: dailyMetrics.id }).from(dailyMetrics).limit(1).all();
  const isFirstSync = existingMetrics.length === 0;
  const lookbackDays = isFirstSync ? 30 : 3;
  const since = format(subDays(now, lookbackDays), "yyyy-MM-dd");
  const until = format(now, "yyyy-MM-dd");

  console.log(`[sync] ${isFirstSync ? "First sync (30 days)" : "Incremental (3 days)"}: ${since} → ${until}`);

  try {
    // Step 1: Get ALL ads at the account level in ONE call (instead of campaign→adset→ad)
    console.log("[sync] Fetching ads from account...");
    const allAds = await paginateAll(`/${actId}/ads`, token, {
      fields: "id,name,status,effective_status,campaign{id,name},adset{id,name},created_time,creative{thumbnail_url}",
      effective_status: JSON.stringify(["ACTIVE"]),
    });

    console.log(`[sync] Found ${allAds.length} active ads`);

    // Save ad records — only truly active ads (effective_status = ACTIVE)
    const trulyActive = allAds.filter(ad => ad.effective_status === "ACTIVE");
    console.log(`[sync] ${trulyActive.length} truly active (filtered from ${allAds.length})`);

    for (const ad of trulyActive) {
      result.adsFound++;
      db.insert(ads)
        .values({
          id: ad.id,
          accountId,
          campaignId: ad.campaign?.id || "",
          campaignName: ad.campaign?.name || "Unknown",
          adsetId: ad.adset?.id || "",
          adsetName: ad.adset?.name || "Unknown",
          adName: ad.name,
          status: "ACTIVE",
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
            status: "ACTIVE",
            lastSyncedAt: Date.now(),
            thumbnailUrl: ad.creative?.thumbnail_url || null,
          },
        })
        .run();
    }

    // Mark any ads in DB that are no longer active
    const activeIds = new Set(trulyActive.map(a => a.id));
    const dbAds = db.select().from(ads).where(eq(ads.accountId, accountId)).all();
    for (const dbAd of dbAds) {
      if (!activeIds.has(dbAd.id)) {
        db.update(ads).set({ status: "PAUSED" }).where(eq(ads.id, dbAd.id)).run();
      }
    }

    // Step 2: Get insights at account level with ad-level breakdown (ONE call)
    console.log("[sync] Fetching insights...");
    await delay(2000); // breathing room for rate limits

    const insights = await paginateAll(`/${actId}/insights`, token, {
      fields: [
        "ad_id", "ad_name", "impressions", "reach", "clicks", "spend",
        "frequency", "ctr", "cpm", "cpc", "actions", "cost_per_action_type",
        "inline_post_engagement",
      ].join(","),
      time_range: JSON.stringify({ since, until }),
      time_increment: "1",
      level: "ad",
      filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] }]),
    });

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

      db.insert(dailyMetrics)
        .values(row)
        .onConflictDoUpdate({ target: [dailyMetrics.adId, dailyMetrics.date], set: row })
        .run();
      result.metricsUpserted++;
    }

    // Step 3: Run fatigue scoring
    console.log("[sync] Running fatigue scoring...");
    const activeAds = db.select().from(ads).where(eq(ads.status, "ACTIVE")).all();

    for (const ad of activeAds) {
      const metrics = db.select().from(dailyMetrics).where(eq(dailyMetrics.adId, ad.id)).orderBy(dailyMetrics.date).all();
      const fatigueResult = calculateFatigueScore(metrics);
      if (fatigueResult.dataStatus !== "sufficient") continue;

      const lastAlert = db.select().from(alerts).where(eq(alerts.adId, ad.id)).orderBy(desc(alerts.createdAt)).limit(1).get();
      const stageOrder = { healthy: 0, early_warning: 1, fatiguing: 2, fatigued: 3 } as const;
      const previousStage = (lastAlert?.stage as keyof typeof stageOrder) ?? "healthy";

      if (stageOrder[fatigueResult.stage] > stageOrder[previousStage]) {
        db.insert(alerts).values({
          adId: ad.id,
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
    console.error("[sync] Error:", err.message);
  }

  return result;
}
