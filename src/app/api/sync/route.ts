import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { syncAccount, syncTodayOnly } from "@/lib/meta/sync";
import { auth } from "@/lib/auth";
import { clearHubSpotCache } from "@/lib/hubspot/client";
import { revalidatePath } from "next/cache";

// Sync pulls ads + metrics + insights for potentially 90 days, chunked. On
// large accounts that takes 60-90s. Railway's default request timeout is low,
// so we raise it here. Route Handlers respect this.
export const maxDuration = 300;

// Global lock: if a sync is already in progress for an account, new requests
// wait on the existing promise instead of kicking off a parallel sync. Prevents
// row-lock contention in Turso when user mashes Refresh + auto-sync fires.
const activeSyncs = new Map<string, Promise<any>>();

async function runSync(accountIds: string[], mode: "full" | "quick" = "full") {
  const lockKey = `${mode}:${accountIds.slice().sort().join(",")}`;
  const existing = activeSyncs.get(lockKey);
  if (existing) {
    console.log(`[sync] Joining in-flight ${mode} sync for ${lockKey}`);
    return existing;
  }
  const p = _runSyncInner(accountIds, mode).finally(() => activeSyncs.delete(lockKey));
  activeSyncs.set(lockKey, p);
  return p;
}

async function _runSyncInner(accountIds: string[], mode: "full" | "quick" = "full") {
  const allAccounts = await db
    .select()
    .from(accounts)
    .where(inArray(accounts.id, accountIds))
    .all();

  if (allAccounts.length === 0) {
    return {
      success: false,
      error: "No account connected. Please click 'Connect with Facebook' on the login page first.",
    } as const;
  }

  let totalAds = 0;
  let totalMetrics = 0;
  let totalAlerts = 0;
  const perAccount: Array<{
    accountId: string;
    accountName: string;
    adsFound: number;
    metricsUpserted: number;
    errors: string[];
    tokenExpired?: boolean;
  }> = [];
  const allErrors: string[] = [];

  // Process accounts in parallel, isolated try/catch per account so a single
  // broken account doesn't kill the whole refresh.
  await Promise.all(
    allAccounts.map(async (account) => {
      const entry = {
        accountId: account.id,
        accountName: account.name,
        adsFound: 0,
        metricsUpserted: 0,
        errors: [] as string[],
      };
      perAccount.push(entry);

      if (account.tokenExpiresAt < Date.now()) {
        entry.errors.push("Meta token expired, reconnect on login page.");
        Object.assign(entry, { tokenExpired: true });
        return;
      }

      try {
        // "quick" mode: only pull today's insights + refresh ad statuses.
        // Takes ~3-5s vs 30-60s for the full 180-day sync. The 10-min
        // auto-sync in instrumentation.ts keeps the historical window fresh.
        if (mode === "quick") {
          const result = await syncTodayOnly(account.id);
          entry.metricsUpserted = result.rowsUpdated;
          totalMetrics += result.rowsUpdated;
          const realErrors = (result.errors || []).filter(
            (e) => !/no campaigns|no ads found|make sure you have active campaigns/i.test(e),
          );
          entry.errors.push(...realErrors);
          allErrors.push(...realErrors.map((e) => `${account.name}: ${e}`));
          return;
        }
        const result = await syncAccount(account.id);
        entry.adsFound = result.adsFound;
        entry.metricsUpserted = result.metricsUpserted;
        totalAds += result.adsFound;
        totalMetrics += result.metricsUpserted;
        totalAlerts += result.alertsGenerated;
        const realErrors = (result.errors || []).filter(
          (e) => !/no campaigns|no ads found|make sure you have active campaigns/i.test(e),
        );
        entry.errors.push(...realErrors);
        allErrors.push(...realErrors.map((e) => `${account.name}: ${e}`));
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.error(`[sync] Account ${account.id} threw:`, msg);
        entry.errors.push(`Sync crashed: ${msg}`);
        allErrors.push(`${account.name}: ${msg}`);
      }
    }),
  );

  // Always clear HS cache + revalidate pages so subsequent page loads are fresh.
  clearHubSpotCache();
  revalidatePath("/dashboard");
  revalidatePath("/alerts");
  revalidatePath("/leads");
  revalidatePath("/strategy");
  revalidatePath("/executive");
  revalidatePath("/ads");

  return {
    success: totalAds > 0 || allErrors.length === 0,
    adsFound: totalAds,
    metricsUpserted: totalMetrics,
    alertsGenerated: totalAlerts,
    errors: allErrors,
    perAccount,
    finishedAt: new Date().toISOString(),
  } as const;
}

// Cron entrypoint (GET with CRON_SECRET), syncs ALL connected accounts.
// Can also be hit by Railway cron / GitHub Actions / cron-job.org.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    const allAccounts = await db.select().from(accounts).all();
    const accountIds = allAccounts.map((a) => a.id);
    const result = await runSync(accountIds, "full");
    return NextResponse.json({ ...result, source: "cron" });
  }

  // Otherwise require a user session, sync all THEIR accounts.
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const allAccountIds: string[] =
    (session as any).allAccountIds ||
    ((session as any).accountId ? [(session as any).accountId] : []);
  if (allAccountIds.length === 0) {
    return NextResponse.json(
      { error: "No account connected. Please click 'Connect with Facebook' on the login page first." },
      { status: 400 },
    );
  }

  // Default mode for user-triggered Refresh = "quick" (today-only, ~5s).
  // Full 180-day sync still runs automatically every 10 min via
  // instrumentation.ts, so historical data stays fresh without making the
  // user wait a minute on every manual click.
  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  const mode: "full" | "quick" = modeParam === "full" ? "full" : "quick";

  const result = await runSync(allAccountIds, mode);
  // Kick off a full sync in the background after a quick refresh so the
  // next page load has fresh historical data too. Fire-and-forget, doesn't
  // block the response.
  if (mode === "quick") {
    runSync(allAccountIds, "full").catch(() => {});
  }
  return NextResponse.json({ ...result, mode });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
