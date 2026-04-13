"use server";

import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { syncAccount } from "@/lib/meta/sync";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";

export async function refreshData() {
  try {
    const session = await auth();
    if (!session) {
      return { error: "Not authenticated. Go to /login first." };
    }
    const providerAccountId = (session as any).accountId as string;
    if (!providerAccountId) {
      return { error: "No account connected. Go to /login first." };
    }

    // Get ALL accounts for this user (they may have multiple ad accounts)
    const allAccountIds: string[] = (session as any).allAccountIds || [providerAccountId];
    const allAccounts = await db.select().from(accounts).all();
    // Filter to accounts that belong to this user's session
    const accountsToSync = allAccounts.filter(a => allAccountIds.includes(a.id));

    console.log(`[refreshData] Session has ${allAccountIds.length} account IDs: ${allAccountIds.join(", ")}`);
    console.log(`[refreshData] Found ${accountsToSync.length} accounts in DB to sync`);

    if (accountsToSync.length === 0) {
      return { error: "No account connected. Go to /login first." };
    }

    let totalAds = 0;
    let totalMetrics = 0;
    let totalAlerts = 0;
    const allErrors: string[] = [];

    // Sync ALL accounts
    for (const account of accountsToSync) {
      if (account.tokenExpiresAt < Date.now()) {
        allErrors.push(`Account ${account.name}: token expired`);
        continue;
      }

      console.log(`[refreshData] Syncing account ${account.id} (${account.name})...`);
      const result = await syncAccount(account.id);
      totalAds += result.adsFound;
      totalMetrics += result.metricsUpserted;
      totalAlerts += result.alertsGenerated;
      if (result.errors.length > 0) {
        allErrors.push(...result.errors.map(e => `${account.name}: ${e}`));
      }

      // If this account found ads, great
      if (result.adsFound > 0) {
        console.log(`[refreshData] Account ${account.name} has ${result.adsFound} ads!`);
      }
    }

    revalidatePath("/dashboard");
    revalidatePath("/alerts");

    return {
      success: totalAds > 0 || allErrors.length === 0,
      adsFound: totalAds,
      metricsUpserted: totalMetrics,
      alertsGenerated: totalAlerts,
      errors: allErrors,
    };
  } catch (err: any) {
    console.error("[refreshData] Error:", err.message);
    return { error: `Sync failed: ${err.message}` };
  }
}
