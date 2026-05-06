import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { refreshLongLivedToken } from "@/lib/meta/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REFRESH_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "META_APP_ID / META_APP_SECRET not configured" },
      { status: 500 },
    );
  }

  const all = await db.select().from(accounts).all();
  const now = Date.now();
  const cutoff = now + REFRESH_WINDOW_DAYS * DAY_MS;

  const results: Array<{
    accountId: string;
    name: string;
    daysLeftBefore: number;
    refreshed: boolean;
    daysLeftAfter?: number;
    error?: string;
  }> = [];

  for (const a of all) {
    const daysLeftBefore = Math.floor((a.tokenExpiresAt - now) / DAY_MS);
    if (a.tokenExpiresAt > cutoff) {
      results.push({
        accountId: a.id,
        name: a.name,
        daysLeftBefore,
        refreshed: false,
      });
      continue;
    }
    if (a.tokenExpiresAt < now) {
      results.push({
        accountId: a.id,
        name: a.name,
        daysLeftBefore,
        refreshed: false,
        error: "Token already expired, manual reconnect required at /login",
      });
      continue;
    }
    try {
      const refreshed = await refreshLongLivedToken(a.accessToken, appId, appSecret);
      if (!refreshed) {
        results.push({
          accountId: a.id,
          name: a.name,
          daysLeftBefore,
          refreshed: false,
          error: "Meta returned no token (likely invalid)",
        });
        continue;
      }
      const newExpiresAt = now + refreshed.expires_in * 1000;
      await db
        .update(accounts)
        .set({
          accessToken: refreshed.access_token,
          tokenExpiresAt: newExpiresAt,
          updatedAt: now,
        })
        .where(eq(accounts.id, a.id));
      results.push({
        accountId: a.id,
        name: a.name,
        daysLeftBefore,
        refreshed: true,
        daysLeftAfter: Math.floor((newExpiresAt - now) / DAY_MS),
      });
    } catch (err: any) {
      results.push({
        accountId: a.id,
        name: a.name,
        daysLeftBefore,
        refreshed: false,
        error: err?.message || String(err),
      });
    }
  }

  const refreshedCount = results.filter((r) => r.refreshed).length;
  const errorCount = results.filter((r) => r.error).length;

  return NextResponse.json({
    finishedAt: new Date().toISOString(),
    accountsChecked: all.length,
    refreshedCount,
    errorCount,
    results,
  });
}
