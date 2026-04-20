import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Diagnostic: compares what's in the DB for a given ad to what Meta says right now.
 *
 * Usage: /api/debug/ad-sync?adId=120214XXX OR ?adName=cash%20flow
 *
 * Returns the DB row + live Meta status so we can see in one response:
 *   - was the ad ever synced (lastSyncedAt)
 *   - what status Meta currently reports
 *   - whether our DB row matches
 *
 * Motivating case (2026-04-20): Orly paused an ad in Meta but it still shows
 * ACTIVE in the dashboard + appears in "recommend to remove" lists. This
 * endpoint tells us whether sync is broken or just hasn't run.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionOrPublic();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const adIdParam = req.nextUrl.searchParams.get("adId");
  const adNameParam = req.nextUrl.searchParams.get("adName");
  if (!adIdParam && !adNameParam) {
    return NextResponse.json({ error: "provide ?adId= or ?adName=" }, { status: 400 });
  }

  const rows = await db.select().from(ads).all();
  const match = adIdParam
    ? rows.find((r) => r.id === adIdParam)
    : rows.find((r) => r.adName.toLowerCase().includes(adNameParam!.toLowerCase()));
  if (!match) {
    return NextResponse.json(
      { error: "ad not found in DB", searchedFor: adIdParam || adNameParam },
      { status: 404 },
    );
  }

  const acct = await db.select().from(accounts).where(eq(accounts.id, match.accountId)).get();
  const token = acct?.accessToken;

  const now = Date.now();
  const syncAge = match.lastSyncedAt ? now - match.lastSyncedAt : null;
  const base = {
    db: {
      id: match.id,
      adName: match.adName,
      campaignName: match.campaignName,
      status: match.status,
      lastSyncedAt: match.lastSyncedAt,
      lastSyncedAtHuman: match.lastSyncedAt
        ? new Date(match.lastSyncedAt).toISOString()
        : null,
      syncAgeMinutes: syncAge !== null ? Math.round(syncAge / 60000) : null,
    },
    account: acct
      ? {
          id: acct.id,
          name: acct.name,
          tokenExpiresAt: acct.tokenExpiresAt,
          tokenExpiresHuman: new Date(acct.tokenExpiresAt).toISOString(),
          tokenExpiresInDays: Math.round((acct.tokenExpiresAt - now) / (24 * 60 * 60 * 1000)),
          tokenExpired: acct.tokenExpiresAt < now,
        }
      : null,
  };

  if (!token) {
    return NextResponse.json({ ...base, live: { error: "no access token on account" } });
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${match.id}?fields=id,name,status,effective_status,updated_time&access_token=${token}`,
    );
    const body = await r.json();
    if (!r.ok) {
      return NextResponse.json({
        ...base,
        live: { error: body?.error?.message || "meta error", status: r.status },
      });
    }
    const dbStatus = match.status;
    const liveStatus = body.effective_status || body.status;
    return NextResponse.json({
      ...base,
      live: {
        id: body.id,
        name: body.name,
        status: body.status,
        effectiveStatus: body.effective_status,
        updatedTime: body.updated_time,
      },
      match: {
        inSync: dbStatus === liveStatus,
        dbSaysActive: dbStatus === "ACTIVE",
        metaSaysActive:
          liveStatus === "ACTIVE" || body.effective_status === "ACTIVE",
        diagnosis:
          dbStatus === liveStatus
            ? "OK — DB matches Meta"
            : `DRIFT — DB='${dbStatus}' but Meta='${liveStatus}'. Click Refresh in sidebar to resync.`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ...base, live: { error: err.message } });
  }
}
