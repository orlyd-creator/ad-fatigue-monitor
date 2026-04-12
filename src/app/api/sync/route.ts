import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { syncAccount } from "@/lib/meta/sync";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // Verify cron secret for automated syncs
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // Cron job: sync ALL accounts
    const allAccounts = await db.select().from(accounts).all();
    if (allAccounts.length === 0) {
      return NextResponse.json(
        { error: "No accounts connected." },
        { status: 400 }
      );
    }

    const results = await Promise.all(allAccounts.map(async (account) => {
      if (account.tokenExpiresAt < Date.now()) {
        return { accountId: account.id, error: "Token expired" };
      }
      const result = await syncAccount(account.id);
      return { accountId: account.id, ...result };
    }));

    return NextResponse.json({ success: true, results });
  }

  // User-initiated sync: require auth and sync only their account
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const accountId = (session as any).accountId as string;
  if (!accountId) {
    return NextResponse.json(
      { error: "No account connected. Please click 'Connect with Facebook' on the login page first." },
      { status: 400 }
    );
  }

  const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
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
