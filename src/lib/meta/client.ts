const META_API_BASE = "https://graph.facebook.com/v21.0";

interface MetaApiOptions {
  accessToken: string;
}

interface RateLimitState {
  usagePercent: number;
  lastCheck: number;
}

let rateLimitState: RateLimitState = { usagePercent: 0, lastCheck: 0 };

async function metaFetch(
  endpoint: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<any> {
  const url = new URL(`${META_API_BASE}${endpoint}`);
  url.searchParams.set("access_token", accessToken);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  // Rate limit check
  if (rateLimitState.usagePercent > 90) {
    throw new Error("Meta API rate limit exceeded (>90%). Sync aborted. Try again in 1 hour.");
  }
  if (rateLimitState.usagePercent > 75) {
    await new Promise((r) => setTimeout(r, 60000)); // 60s cooldown
  }

  const res = await fetch(url.toString());

  // Parse rate limit headers
  const usageHeader = res.headers.get("x-business-use-case-usage");
  if (usageHeader) {
    try {
      const usage = JSON.parse(usageHeader);
      const values = Object.values(usage) as any[];
      if (values[0]?.[0]?.estimated_time_to_regain_access !== undefined) {
        rateLimitState.usagePercent = values[0][0].call_count || 0;
      }
    } catch {
      // ignore parse errors
    }
    rateLimitState.lastCheck = Date.now();
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(`Meta API Error: ${error.error?.message || res.statusText}`);
  }

  return res.json();
}

/** Paginate through all results from a Meta API endpoint */
async function paginateAll(
  endpoint: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<any[]> {
  const allData: any[] = [];
  let url: string | null = null;

  // First request
  const firstResult = await metaFetch(endpoint, accessToken, { ...params, limit: "100" });
  allData.push(...(firstResult.data || []));
  url = firstResult.paging?.next || null;

  // Follow pagination
  while (url) {
    const res = await fetch(url);
    if (!res.ok) break;
    const result = await res.json();
    allData.push(...(result.data || []));
    url = result.paging?.next || null;
  }

  return allData;
}

export async function getAdAccounts(accessToken: string) {
  const data = await metaFetch("/me/adaccounts", accessToken, {
    fields: "name,account_id,account_status",
  });
  return data.data || [];
}

export async function getCampaigns(accountId: string, accessToken: string) {
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  return paginateAll(`/${actId}/campaigns`, accessToken, {
    fields: "id,name,status,objective",
    effective_status: JSON.stringify(["ACTIVE"]),
  });
}

export async function getAdsets(campaignId: string, accessToken: string) {
  return paginateAll(`/${campaignId}/adsets`, accessToken, {
    fields: "id,name,status",
  });
}

export async function getAds(adsetId: string, accessToken: string) {
  return paginateAll(`/${adsetId}/ads`, accessToken, {
    fields: "id,name,status,created_time",
  });
}

export interface MetaInsight {
  date_start: string;
  date_stop: string;
  impressions: string;
  reach: string;
  clicks: string;
  spend: string;
  frequency: string;
  ctr: string;
  cpm: string;
  cpc: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  inline_post_engagement?: string;
  inline_link_clicks?: string;
}

export async function getAdInsights(
  adId: string,
  accessToken: string,
  since: string,
  until: string
): Promise<MetaInsight[]> {
  return paginateAll(`/${adId}/insights`, accessToken, {
    fields: [
      "impressions",
      "reach",
      "clicks",
      "spend",
      "frequency",
      "ctr",
      "cpm",
      "cpc",
      "actions",
      "cost_per_action_type",
      "inline_post_engagement",
    ].join(","),
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
  });
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
  appId: string,
  appSecret: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(
    `${META_API_BASE}/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${appId}&` +
      `client_secret=${appSecret}&` +
      `fb_exchange_token=${shortLivedToken}`
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.error?.message || res.statusText}`);
  }
  return res.json();
}
