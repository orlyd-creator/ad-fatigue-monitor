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
    const accountId = (session as any).accountId as string;
    if (!accountId) {
      return { error: "No account connected. Go to /login first." };
    }

    const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
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
