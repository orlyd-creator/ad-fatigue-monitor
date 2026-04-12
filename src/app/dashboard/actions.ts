"use server";

import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { syncAccount } from "@/lib/meta/sync";
import { revalidatePath } from "next/cache";

export async function refreshData() {
  try {
    const account = db.select().from(accounts).limit(1).get();
    if (!account) {
      return { error: "No account connected. Go to /login first." };
    }
    if (account.tokenExpiresAt < Date.now()) {
      return { error: "Token expired. Reconnect on /login." };
    }

    const result = await syncAccount(account.id);

    revalidatePath("/dashboard");
    revalidatePath("/alerts");

    return {
      success: result.errors.length === 0,
      adsFound: result.adsFound,
      metricsUpserted: result.metricsUpserted,
      alertsGenerated: result.alertsGenerated,
      errors: result.errors,
    };
  } catch (err: any) {
    console.error("[refreshData] Error:", err.message);
    return { error: `Sync failed: ${err.message}` };
  }
}
