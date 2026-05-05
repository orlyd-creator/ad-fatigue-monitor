import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, accounts } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Bulk drift audit: for every ad currently flagged ACTIVE in our DB, ask
 * Meta directly (via the batch /?ids=A,B,C endpoint, 50 IDs per request)
 * whether it's still active. Returns mismatches with how stale they are.
 *
 * Two operating modes:
 *   GET /api/debug/status-drift          → audit only (read-only JSON)
 *   GET /api/debug/status-drift?fix=1    → audit + write live Meta status
 *                                          back to the DB for any drifted ads
 *
 * Use this whenever something feels off in the dashboard. If the
 * `staleMinutes` for any drifted ad is >5 minutes, the auto-refresh path
 * isn't doing its job and we should investigate.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionOrPublic();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const allAccountIds: string[] = session.allAccountIds;
  if (!allAccountIds || allAccountIds.length === 0) {
    return NextResponse.json({ error: "no accounts on session" }, { status: 400 });
  }

  const fix = req.nextUrl.searchParams.get("fix") === "1";
  const now = Date.now();

  // Pull every ACTIVE ad in DB across the user's accounts.
  const activeRows = await db
    .select({
      id: ads.id,
      adName: ads.adName,
      campaignName: ads.campaignName,
      status: ads.status,
      accountId: ads.accountId,
      lastSyncedAt: ads.lastSyncedAt,
    })
    .from(ads)
    .where(inArray(ads.accountId, allAccountIds))
    .all();
  const dbActive = activeRows.filter(
    (a) => a.status === "ACTIVE" && !a.id.startsWith("__unattributed_"),
  );
  if (dbActive.length === 0) {
    return NextResponse.json({
      summary: {
        checkedAt: new Date(now).toISOString(),
        accountsChecked: allAccountIds,
        dbActiveCount: 0,
        driftedCount: 0,
        archivedCount: 0,
        errorCount: 0,
        fixedCount: 0,
      },
      drifted: [],
      archived: [],
      errors: [],
    });
  }

  // Group by accountId so each batch uses the right access token.
  const byAccount = new Map<string, typeof dbActive>();
  for (const ad of dbActive) {
    const arr = byAccount.get(ad.accountId);
    if (arr) arr.push(ad);
    else byAccount.set(ad.accountId, [ad]);
  }

  const acctRows = await db
    .select()
    .from(accounts)
    .where(inArray(accounts.id, Array.from(byAccount.keys())))
    .all();
  const tokenByAccount = new Map(acctRows.map((a) => [a.id, a]));

  type Drift = {
    id: string;
    adName: string;
    campaignName: string;
    accountId: string;
    dbStatus: string;
    metaStatus: string;
    lastSyncedAt: number | null;
    staleMinutes: number | null;
    fixed?: boolean;
  };
  const drifted: Drift[] = [];
  const archived: Drift[] = [];
  const errors: Array<{ accountId?: string; message: string }> = [];
  let fixedCount = 0;

  for (const [acctId, adsForAcct] of byAccount.entries()) {
    const acct = tokenByAccount.get(acctId);
    if (!acct) {
      errors.push({ accountId: acctId, message: "account row missing" });
      continue;
    }
    if (acct.tokenExpiresAt < now) {
      errors.push({ accountId: acctId, message: "token expired, reconnect at /login" });
      continue;
    }
    const token = acct.accessToken;

    for (let i = 0; i < adsForAcct.length; i += 50) {
      const chunk = adsForAcct.slice(i, i + 50);
      const idsParam = encodeURIComponent(chunk.map((a) => a.id).join(","));
      const url = `https://graph.facebook.com/v21.0/?ids=${idsParam}&fields=id,status,effective_status&access_token=${token}`;

      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch(url).catch(() => null);
        if (r && r.ok) { res = r; break; }
        if (r && r.status !== 429 && r.status < 500) { res = r; break; }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
      if (!res) {
        errors.push({ accountId: acctId, message: `network error on chunk ${i / 50 + 1}` });
        continue;
      }

      if (!res.ok) {
        // One bad ID can make the whole batch 400. Re-query each individually
        // so we still capture drift for the live ones.
        for (const ad of chunk) {
          const single = await fetch(
            `https://graph.facebook.com/v21.0/${ad.id}?fields=id,status,effective_status&access_token=${token}`,
          ).catch(() => null);
          if (!single) { errors.push({ accountId: acctId, message: `network error on ${ad.id}` }); continue; }
          if (!single.ok) {
            const stale = ad.lastSyncedAt ? Math.round((now - ad.lastSyncedAt) / 60000) : null;
            const drift: Drift = {
              id: ad.id, adName: ad.adName, campaignName: ad.campaignName,
              accountId: acctId, dbStatus: ad.status, metaStatus: "DELETED_OR_GONE",
              lastSyncedAt: ad.lastSyncedAt, staleMinutes: stale,
            };
            archived.push(drift);
            if (fix) {
              await db.update(ads).set({ status: "ARCHIVED", lastSyncedAt: now }).where(eq(ads.id, ad.id));
              drift.fixed = true; fixedCount++;
            }
            continue;
          }
          const sb: { status?: string; effective_status?: string } = await single.json();
          const liveStatus = sb.effective_status || sb.status || "UNKNOWN";
          if (liveStatus !== "ACTIVE") {
            const stale = ad.lastSyncedAt ? Math.round((now - ad.lastSyncedAt) / 60000) : null;
            const drift: Drift = {
              id: ad.id, adName: ad.adName, campaignName: ad.campaignName,
              accountId: acctId, dbStatus: ad.status, metaStatus: liveStatus,
              lastSyncedAt: ad.lastSyncedAt, staleMinutes: stale,
            };
            drifted.push(drift);
            if (fix) {
              await db.update(ads).set({ status: liveStatus, lastSyncedAt: now }).where(eq(ads.id, ad.id));
              drift.fixed = true; fixedCount++;
            }
          }
        }
        continue;
      }

      const body: Record<string, { id?: string; status?: string; effective_status?: string }> = await res.json();
      const returnedKeys = new Set(Object.keys(body || {}));
      for (const ad of chunk) {
        if (!returnedKeys.has(ad.id)) {
          const stale = ad.lastSyncedAt ? Math.round((now - ad.lastSyncedAt) / 60000) : null;
          const drift: Drift = {
            id: ad.id, adName: ad.adName, campaignName: ad.campaignName,
            accountId: acctId, dbStatus: ad.status, metaStatus: "DELETED_OR_GONE",
            lastSyncedAt: ad.lastSyncedAt, staleMinutes: stale,
          };
          archived.push(drift);
          if (fix) {
            await db.update(ads).set({ status: "ARCHIVED", lastSyncedAt: now }).where(eq(ads.id, ad.id));
            drift.fixed = true; fixedCount++;
          }
          continue;
        }
        const row = body[ad.id];
        const liveStatus = row?.effective_status || row?.status || "UNKNOWN";
        if (liveStatus !== "ACTIVE") {
          const stale = ad.lastSyncedAt ? Math.round((now - ad.lastSyncedAt) / 60000) : null;
          const drift: Drift = {
            id: ad.id, adName: ad.adName, campaignName: ad.campaignName,
            accountId: acctId, dbStatus: ad.status, metaStatus: liveStatus,
            lastSyncedAt: ad.lastSyncedAt, staleMinutes: stale,
          };
          drifted.push(drift);
          if (fix) {
            await db.update(ads).set({ status: liveStatus, lastSyncedAt: now }).where(eq(ads.id, ad.id));
            drift.fixed = true; fixedCount++;
          }
        }
      }
    }
  }

  if (fixedCount > 0) {
    revalidatePath("/dashboard");
    revalidatePath("/alerts");
    revalidatePath("/strategy");
    revalidatePath("/forecast");
    revalidatePath("/executive");
  }

  return NextResponse.json({
    summary: {
      checkedAt: new Date(now).toISOString(),
      accountsChecked: allAccountIds,
      dbActiveCount: dbActive.length,
      driftedCount: drifted.length,
      archivedCount: archived.length,
      errorCount: errors.length,
      fixedCount,
      mode: fix ? "audit+fix" : "audit",
    },
    drifted: drifted.sort((a, b) => (b.staleMinutes ?? 0) - (a.staleMinutes ?? 0)),
    archived: archived.sort((a, b) => (b.staleMinutes ?? 0) - (a.staleMinutes ?? 0)),
    errors,
  });
}
