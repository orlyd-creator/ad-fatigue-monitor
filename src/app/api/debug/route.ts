import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts, ads } from "@/lib/db/schema";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const allAccountIds: string[] = (session as any).allAccountIds || [];
    const accountId = (session as any).accountId;

    // Get all accounts in DB
    const allAccounts = await db.select().from(accounts).all();

    // Get all ads in DB
    const allAds = await db.select().from(ads).all();

    // Try to call Meta API directly to see what accounts are available
    let metaAccounts: any[] = [];
    const account = allAccounts.find(a => a.id === accountId);
    if (account) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_id,account_status&limit=100&access_token=${account.accessToken}`
        );
        const data = await res.json();
        metaAccounts = (data.data || []).map((a: any) => ({
          id: a.id,
          account_id: a.account_id,
          name: a.name,
          status: a.account_status,
        }));
      } catch (e: any) {
        metaAccounts = [{ error: e.message }];
      }
    }

    return NextResponse.json({
      session: {
        accountId,
        allAccountIds,
        accountName: (session as any).accountName,
      },
      dbAccounts: allAccounts.map(a => ({
        id: a.id,
        name: a.name,
        userId: a.userId,
        tokenExpires: new Date(a.tokenExpiresAt).toISOString(),
        tokenValid: a.tokenExpiresAt > Date.now(),
      })),
      dbAds: allAds.map(a => ({
        id: a.id,
        name: a.adName,
        accountId: a.accountId,
        status: a.status,
      })),
      metaApiAccounts: metaAccounts,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
