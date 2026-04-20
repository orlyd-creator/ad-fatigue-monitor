/**
 * Next.js instrumentation, runs once when the server boots.
 * Applies lightweight, idempotent schema changes that must exist on every deploy.
 * We intentionally avoid Drizzle's full migrator here because the production DB
 * was bootstrapped without migration tracking (migrator would try to recreate
 * already-existing tables on every boot).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { createClient } = await import("@libsql/client");
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:sqlite.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // team_invites: added 2026-04-20 for in-app team workspace sharing.
    await client.execute(`
      CREATE TABLE IF NOT EXISTS team_invites (
        email TEXT PRIMARY KEY,
        invited_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        invited_by TEXT,
        last_seen_at INTEGER
      )
    `);
    // share_tokens: shareable links, click URL → FB login → auto access.
    await client.execute(`
      CREATE TABLE IF NOT EXISTS share_tokens (
        token TEXT PRIMARY KEY,
        label TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        created_by TEXT,
        expires_at INTEGER,
        revoked_at INTEGER,
        uses_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    // public_links: anonymous view-only links to executive dashboard.
    // No login required, anyone with the URL sees the live executive view.
    // Added 2026-04-20.
    await client.execute(`
      CREATE TABLE IF NOT EXISTS public_links (
        token TEXT PRIMARY KEY,
        label TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        created_by TEXT,
        revoked_at INTEGER,
        views_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    // HARDENING: remove any legacy duplicate (ad_id, date) rows in
    // daily_metrics left over from pre-unique-index syncs. The app's JS
    // dedupe handles this at read time, but keeping the DB clean prevents
    // surprises in ad-hoc SQL / diagnostics.
    try {
      const delRes = await client.execute(`
        DELETE FROM daily_metrics WHERE id NOT IN (
          SELECT MAX(id) FROM daily_metrics GROUP BY ad_id, date
        )
      `);
      if (delRes.rowsAffected && delRes.rowsAffected > 0) {
        console.log(`[instrumentation] Removed ${delRes.rowsAffected} duplicate daily_metrics rows`);
      }
    } catch (e) {
      console.warn("[instrumentation] daily_metrics dedupe failed (non-fatal):", e);
    }

    console.log("[instrumentation] Schema ensured");
  } catch (err) {
    // Don't crash the app, log and continue. The app still boots without this.
    console.error("[instrumentation] Schema bootstrap failed:", err);
  }

  // ── Two-tier auto-sync ──
  // Tier 1 (every 2 min): syncTodayOnly, pulls TODAY's insights only, ~3s
  //   per account. Keeps today's spend / CTR / CPM as close to live as Meta
  //   allows (Meta itself has 6-12h same-day lag on spend, so tighter than
  //   2 min is pointless).
  // Tier 2 (every 10 min): syncAccount, full 180-day window + ad metadata
  //   + fatigue scoring. Catches historical corrections Meta publishes
  //   after the fact.
  // Guarded on a global to survive Next.js hot-reload in dev.
  try {
    const FULL_SYNC_MS = 10 * 60 * 1000;    // 10 min
    const TODAY_SYNC_MS = 2 * 60 * 1000;    // 2 min
    const g = globalThis as any;
    if (!g.__metaAutoSyncStarted) {
      g.__metaAutoSyncStarted = true;
      // First full run 60s after boot so we don't fight deploy warm-up.
      let firstRun = true;
      const schedule = () => {
        setTimeout(runAutoSync, firstRun ? 60000 : FULL_SYNC_MS);
        firstRun = false;
      };
      const runAutoSync = async () => {
        try {
          const { db } = await import("@/lib/db");
          const { accounts } = await import("@/lib/db/schema");
          const { syncAccount } = await import("@/lib/meta/sync");
          const { clearHubSpotCache } = await import("@/lib/hubspot/client");
          const rows = await db.select().from(accounts).all();
          console.log(`[auto-sync] starting, ${rows.length} accounts`);
          for (const account of rows) {
            if (account.tokenExpiresAt < Date.now()) {
              console.warn(`[auto-sync] skipping ${account.id} (token expired)`);
              continue;
            }
            try {
              const res = await syncAccount(account.id);
              console.log(`[auto-sync] ${account.id}: ${res.adsFound} ads, ${res.metricsUpserted} metrics`);
            } catch (err: any) {
              console.error(`[auto-sync] ${account.id} failed:`, err?.message || err);
            }
          }
          clearHubSpotCache();
        } catch (err: any) {
          console.error("[auto-sync] tick failed:", err?.message || err);
        } finally {
          schedule();
        }
      };
      schedule();
      console.log("[instrumentation] 10-min full auto-sync registered");

      // Tier 2: today-only micro-sync every 2 min.
      const scheduleToday = () => setTimeout(runTodaySync, TODAY_SYNC_MS);
      const runTodaySync = async () => {
        try {
          const { db } = await import("@/lib/db");
          const { accounts } = await import("@/lib/db/schema");
          const { syncTodayOnly } = await import("@/lib/meta/sync");
          const rows = await db.select().from(accounts).all();
          for (const account of rows) {
            if (account.tokenExpiresAt < Date.now()) continue;
            try {
              const res = await syncTodayOnly(account.id);
              if (res.rowsUpdated > 0) {
                console.log(`[today-sync] ${account.id}: ${res.rowsUpdated} rows`);
              }
            } catch (err: any) {
              console.error(`[today-sync] ${account.id} failed:`, err?.message || err);
            }
          }
        } catch (err: any) {
          console.error("[today-sync] tick failed:", err?.message || err);
        } finally {
          scheduleToday();
        }
      };
      // First today-sync 90s after boot (after the full-sync warmup).
      setTimeout(runTodaySync, 90000);
      console.log("[instrumentation] 2-min today-only auto-sync registered");
    }
  } catch (err) {
    console.error("[instrumentation] Auto-sync registration failed:", err);
  }
}
