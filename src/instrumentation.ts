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
    console.log("[instrumentation] Schema ensured");
  } catch (err) {
    // Don't crash the app, log and continue. The app still boots without this.
    console.error("[instrumentation] Schema bootstrap failed:", err);
  }

  // ── 10-minute auto-sync ──
  // Railway doesn't read vercel.json crons, so this in-process interval keeps
  // Meta data close to live. Orly asked for ~live numbers, 10 min is the
  // sweet spot between freshness and API rate limits (Meta's insights have
  // 6-12h lag for same-day spend anyway, so tighter than 10 min doesn't help).
  // Guarded on a global to survive Next.js hot-reload in dev.
  try {
    const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 min (was 1 hour)
    const g = globalThis as any;
    if (!g.__metaAutoSyncStarted) {
      g.__metaAutoSyncStarted = true;
      // First run 60s after boot so we don't fight deploy warm-up, then every
      // SYNC_INTERVAL_MS.
      let firstRun = true;
      const schedule = () => {
        setTimeout(runAutoSync, firstRun ? 60000 : SYNC_INTERVAL_MS);
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
      console.log("[instrumentation] 10-min auto-sync registered");
    }
  } catch (err) {
    console.error("[instrumentation] Auto-sync registration failed:", err);
  }
}
