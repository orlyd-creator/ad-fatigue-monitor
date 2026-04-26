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

    // sync_runs: durable record of every auto-sync tick so the dashboard
    // can show "last refresh succeeded / failed at HH:MM" and the actual
    // error message instead of a silent empty state.
    await client.execute(`
      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        account_id TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        success INTEGER NOT NULL,
        ads_found INTEGER NOT NULL DEFAULT 0,
        metrics_upserted INTEGER NOT NULL DEFAULT 0,
        errors TEXT
      )
    `);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_sync_runs_finished ON sync_runs(finished_at DESC)`);

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

    // ads: backfill creative columns onto pre-existing local dev databases
    // bootstrapped before the schema added them. Prod (Turso) already has
    // these. We catch "duplicate column" errors so this stays idempotent.
    for (const col of [
      `image_url TEXT`,
      `ad_body TEXT`,
      `ad_headline TEXT`,
      `ad_link_url TEXT`,
    ]) {
      try {
        await client.execute(`ALTER TABLE ads ADD COLUMN ${col}`);
        console.log(`[instrumentation] Added ads.${col.split(" ")[0]}`);
      } catch (e: any) {
        if (!/duplicate column/i.test(e?.message ?? "")) {
          console.warn(`[instrumentation] ALTER TABLE ads ADD ${col} failed:`, e?.message || e);
        }
      }
    }
    // ACCOUNT HYGIENE + BOOTSTRAP: if META_AD_ACCOUNT_ID is set and it's
    // NOT in the DB yet, we use whatever valid token we already have
    // stored (from a previous OAuth on any of the user's other accounts)
    // to call /me/adaccounts, confirm the configured account exists, and
    // insert it with that same long-lived token. A single long-lived
    // token is valid for every ad account the user admins, so swapping
    // the row over is enough — no re-OAuth required.
    //
    // Then: delete any stored account rows that don't match the
    // configured ID, so auto-sync stops hitting the empty personal
    // account and silently failing.
    try {
      const configured = (process.env.META_AD_ACCOUNT_ID || "").replace(/^act_/, "").trim();
      if (configured) {
        const check = await client.execute({
          sql: `SELECT id FROM accounts WHERE id = ? LIMIT 1`,
          args: [configured],
        });
        if (check.rows.length === 0) {
          // Configured account missing — try to bootstrap it from any
          // existing token row.
          const tokenRow = await client.execute(
            `SELECT id, access_token, token_expires_at, user_id FROM accounts ORDER BY updated_at DESC LIMIT 1`,
          );
          const t = tokenRow.rows[0] as any;
          if (t && t.access_token && Number(t.token_expires_at) > Date.now()) {
            try {
              const res = await fetch(
                `https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_id,account_status&limit=200&access_token=${t.access_token}`,
              );
              const data: any = await res.json();
              if (Array.isArray(data?.data)) {
                const match = data.data.find(
                  (a: any) => String(a.account_id || "").replace(/^act_/, "") === configured,
                );
                if (match) {
                  await client.execute({
                    sql: `INSERT INTO accounts (id, name, access_token, token_expires_at, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, token_expires_at = excluded.token_expires_at, updated_at = excluded.updated_at`,
                    args: [
                      configured,
                      match.name || "Ad Account",
                      t.access_token,
                      Number(t.token_expires_at),
                      t.user_id,
                      Date.now(),
                      Date.now(),
                    ],
                  });
                  console.log(`[instrumentation] Bootstrapped configured account act_${configured} from existing token`);
                } else {
                  console.warn(`[instrumentation] Configured act_${configured} NOT in /me/adaccounts for this token. Owner probably not admin on that account.`);
                }
              }
            } catch (e: any) {
              console.warn("[instrumentation] bootstrap /me/adaccounts failed:", e?.message || e);
            }
          }
        }
        // Re-check after possible bootstrap, then delete mismatched rows
        const recheck = await client.execute({
          sql: `SELECT id FROM accounts WHERE id = ? LIMIT 1`,
          args: [configured],
        });
        if (recheck.rows.length > 0) {
          const del = await client.execute({
            sql: `DELETE FROM accounts WHERE id != ?`,
            args: [configured],
          });
          if (del.rowsAffected && del.rowsAffected > 0) {
            console.log(`[instrumentation] Removed ${del.rowsAffected} stale account row(s), kept only act_${configured}`);
          }
        } else {
          console.log(`[instrumentation] Configured account ${configured} still not in DB after bootstrap attempt`);
        }
      }
    } catch (e) {
      console.warn("[instrumentation] account hygiene failed (non-fatal):", e);
    }

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
      const recordRun = async (
        mode: string,
        source: string,
        accountId: string | null,
        startedAt: number,
        success: boolean,
        adsFound: number,
        metricsUpserted: number,
        errors: string[],
      ) => {
        try {
          const { createClient } = await import("@libsql/client");
          const c = createClient({
            url: process.env.TURSO_DATABASE_URL || "file:sqlite.db",
            authToken: process.env.TURSO_AUTH_TOKEN,
          });
          await c.execute({
            sql: `INSERT INTO sync_runs (mode, source, account_id, started_at, finished_at, success, ads_found, metrics_upserted, errors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [mode, source, accountId, startedAt, Date.now(), success ? 1 : 0, adsFound, metricsUpserted, errors.length ? JSON.stringify(errors) : null],
          });
        } catch (e) {
          console.error("[sync_runs] insert failed:", e);
        }
      };
      const runAutoSync = async () => {
        const tickStarted = Date.now();
        try {
          const { db } = await import("@/lib/db");
          const { accounts } = await import("@/lib/db/schema");
          const { syncAccount } = await import("@/lib/meta/sync");
          const { clearHubSpotCache } = await import("@/lib/hubspot/client");
          const rows = await db.select().from(accounts).all();
          console.log(`[auto-sync] starting, ${rows.length} accounts`);
          for (const account of rows) {
            const accStart = Date.now();
            if (account.tokenExpiresAt < Date.now()) {
              console.warn(`[auto-sync] skipping ${account.id} (token expired)`);
              await recordRun("full", "auto", account.id, accStart, false, 0, 0, ["Token expired, reconnect Meta at /login"]);
              continue;
            }
            try {
              const res = await syncAccount(account.id);
              console.log(`[auto-sync] ${account.id}: ${res.adsFound} ads, ${res.metricsUpserted} metrics`);
              const ok = (res.errors?.length ?? 0) === 0;
              await recordRun("full", "auto", account.id, accStart, ok, res.adsFound, res.metricsUpserted, res.errors || []);
            } catch (err: any) {
              console.error(`[auto-sync] ${account.id} failed:`, err?.message || err);
              await recordRun("full", "auto", account.id, accStart, false, 0, 0, [err?.message || String(err)]);
            }
          }
          clearHubSpotCache();
        } catch (err: any) {
          console.error("[auto-sync] tick failed:", err?.message || err);
          await recordRun("full", "auto", null, tickStarted, false, 0, 0, [err?.message || String(err)]);
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
