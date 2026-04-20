/**
 * Live Meta budget fetcher.
 *
 * Rather than cache budgets in our DB (which would drift when Orly adjusts
 * them in Meta UI), we call Meta at render time when Forecast needs them.
 * Cached in-process for 5 min so we don't re-fetch on every page load.
 *
 * Budget logic:
 *   - Campaign-level CBO: campaign has daily_budget, children adsets don't
 *   - Ad-set level: each adset has its own daily_budget
 *   - Lifetime budgets: exist too, but we prefer daily for monthly pace calc
 *
 * The function returns a PER-ACCOUNT total of effective daily spend ceiling
 * across all ACTIVE campaigns + adsets. Pausing a campaign in Meta removes
 * it from this total within 5 min (cache TTL).
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: AccountBudget }>();

export interface AccountBudget {
  /** Sum of daily budgets across active campaigns + adsets. */
  dailyBudget: number;
  /** Currency code, usually USD. */
  currency: string;
  /** Per-campaign breakdown of active daily budgets. */
  campaigns: Array<{
    id: string;
    name: string;
    dailyBudget: number;
    status: string;
    source: "campaign" | "adset-sum"; // where the number came from
  }>;
  /** Any errors surfaced while fetching (non-fatal). */
  errors: string[];
}

/**
 * Meta returns budgets in minor units (cents) as strings. This parses them.
 * Returns 0 on missing / empty / invalid.
 */
function parseMinor(v: unknown): number {
  if (!v) return 0;
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  if (isNaN(n) || n <= 0) return 0;
  return n / 100;
}

export async function getAccountBudget(
  accountId: string,
  token: string,
): Promise<AccountBudget> {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const errors: string[] = [];
  const campaignsOut: AccountBudget["campaigns"] = [];
  let currency = "USD";

  try {
    // 1) Account currency
    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${actId}?fields=currency&access_token=${token}`,
      );
      if (r.ok) {
        const body = await r.json();
        if (body.currency) currency = body.currency;
      }
    } catch {
      /* currency is cosmetic */
    }

    // 2) Active campaigns with their daily_budget / lifetime_budget
    const campaignRes = await fetch(
      `https://graph.facebook.com/v21.0/${actId}/campaigns?fields=id,name,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time&effective_status=["ACTIVE"]&limit=200&access_token=${token}`,
    );
    if (!campaignRes.ok) {
      errors.push(`campaigns fetch ${campaignRes.status}`);
      const result: AccountBudget = { dailyBudget: 0, currency, campaigns: [], errors };
      cache.set(accountId, { at: Date.now(), value: result });
      return result;
    }
    const campaignBody = await campaignRes.json();
    const campaigns: any[] = campaignBody.data || [];

    // 3) For each active campaign: if it has its own daily_budget (CBO), use it.
    //    Otherwise fetch the adsets and sum their daily budgets.
    for (const c of campaigns) {
      const campaignDaily = parseMinor(c.daily_budget);
      if (campaignDaily > 0) {
        campaignsOut.push({
          id: c.id,
          name: c.name,
          dailyBudget: campaignDaily,
          status: c.effective_status || c.status,
          source: "campaign",
        });
        continue;
      }

      // Sum active adsets
      try {
        const asRes = await fetch(
          `https://graph.facebook.com/v21.0/${c.id}/adsets?fields=id,name,status,effective_status,daily_budget,lifetime_budget&effective_status=["ACTIVE"]&limit=200&access_token=${token}`,
        );
        if (!asRes.ok) {
          errors.push(`adsets ${c.id} ${asRes.status}`);
          continue;
        }
        const asBody = await asRes.json();
        let sum = 0;
        for (const as of asBody.data || []) {
          sum += parseMinor(as.daily_budget);
        }
        if (sum > 0) {
          campaignsOut.push({
            id: c.id,
            name: c.name,
            dailyBudget: sum,
            status: c.effective_status || c.status,
            source: "adset-sum",
          });
        }
      } catch (e: any) {
        errors.push(`adsets ${c.id}: ${e?.message || e}`);
      }
    }
  } catch (e: any) {
    errors.push(`unexpected: ${e?.message || e}`);
  }

  const dailyBudget = Math.round(
    campaignsOut.reduce((s, c) => s + c.dailyBudget, 0) * 100,
  ) / 100;

  const result: AccountBudget = { dailyBudget, currency, campaigns: campaignsOut, errors };
  cache.set(accountId, { at: Date.now(), value: result });
  return result;
}

/**
 * Aggregate across multiple ad accounts (a user may have >1).
 */
export async function getTotalBudget(
  accounts: Array<{ id: string; accessToken: string; tokenExpiresAt: number }>,
): Promise<AccountBudget> {
  const live = accounts.filter((a) => a.tokenExpiresAt > Date.now());
  const perAcct = await Promise.all(
    live.map((a) => getAccountBudget(a.id, a.accessToken).catch(() => ({
      dailyBudget: 0,
      currency: "USD",
      campaigns: [],
      errors: [`account ${a.id} failed`],
    } as AccountBudget))),
  );
  const combined: AccountBudget = {
    dailyBudget: perAcct.reduce((s, a) => s + a.dailyBudget, 0),
    currency: perAcct[0]?.currency || "USD",
    campaigns: perAcct.flatMap((a) => a.campaigns),
    errors: perAcct.flatMap((a) => a.errors),
  };
  combined.dailyBudget = Math.round(combined.dailyBudget * 100) / 100;
  return combined;
}
