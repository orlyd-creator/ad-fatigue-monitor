import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { syncAccount } from "@/lib/meta/sync";

export async function GET(req: NextRequest) {
  // Verify cron secret (skip in development if no secret set)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get the stored account (created by OAuth login)
  const account = await db.select().from(accounts).limit(1).get();
  if (!account) {
    return NextResponse.json(
      { error: "No account connected. Please click 'Connect with Facebook' on the login page first." },
      { status: 400 }
    );
  }

  // Check token expiry
  if (account.tokenExpiresAt < Date.now()) {
    return NextResponse.json(
      { error: "Your Meta token has expired. Please reconnect your account on the login page." },
      { status: 401 }
    );
  }

  const result = await syncAccount(account.id);

  return NextResponse.json({
    success: result.errors.length === 0,
    ...result,
  });
}

// Also allow POST for manual sync from the UI
export async function POST(req: NextRequest) {
  return GET(req);
}
