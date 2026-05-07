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
    const { createRawDbClient } = await import("@/lib/db");
    const client = createRawDbClient();

    // Bootstrap the original schema. Idempotent (IF NOT EXISTS) so this
    // is safe for both fresh DBs (e.g. a brand-new SQLite file on a Railway
    // volume after migrating off Turso) AND the existing prod DB. Mirrors
    // drizzle/0000_*.sql so we do not have to run the migrator on boot.
    await client.execute(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        access_token TEXT NOT NULL,
        token_expires_at INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS ads (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        campaign_name TEXT NOT NULL,
        adset_id TEXT NOT NULL,
        adset_name TEXT NOT NULL,
        ad_name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER,
        first_seen_at INTEGER NOT NULL,
        last_synced_at INTEGER,
        thumbnail_url TEXT,
        image_url TEXT,
        ad_body TEXT,
        ad_headline TEXT,
        ad_link_url TEXT
      )
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ad_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        fatigue_score REAL NOT NULL,
        stage TEXT NOT NULL,
        signals TEXT NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS daily_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ad_id TEXT NOT NULL,
        date TEXT NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0,
        reach INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        spend REAL NOT NULL DEFAULT 0,
        frequency REAL NOT NULL DEFAULT 0,
        ctr REAL NOT NULL DEFAULT 0,
        cpm REAL NOT NULL DEFAULT 0,
        cpc REAL NOT NULL DEFAULT 0,
        actions INTEGER NOT NULL DEFAULT 0,
        cost_per_action REAL NOT NULL DEFAULT 0,
        conversion_rate REAL NOT NULL DEFAULT 0,
        inline_post_engagement INTEGER NOT NULL DEFAULT 0,
        post_reactions INTEGER NOT NULL DEFAULT 0,
        post_comments INTEGER NOT NULL DEFAULT 0,
        post_shares INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS daily_metrics_ad_date_idx ON daily_metrics (ad_id, date)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS daily_metrics_ad_date_desc_idx ON daily_metrics (ad_id, date)`);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL,
        sensitivity_preset TEXT NOT NULL DEFAULT 'medium',
        ctr_weight REAL NOT NULL DEFAULT 0.2,
        cpm_weight REAL NOT NULL DEFAULT 0.15,
        frequency_weight REAL NOT NULL DEFAULT 0.25,
        conversion_weight REAL NOT NULL DEFAULT 0.2,
        cost_per_result_weight REAL NOT NULL DEFAULT 0.1,
        engagement_weight REAL NOT NULL DEFAULT 0.1,
        baseline_window_days INTEGER NOT NULL DEFAULT 7,
        recent_window_days INTEGER NOT NULL DEFAULT 3,
        min_data_days INTEGER NOT NULL DEFAULT 5
      )
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS hubspot_config (
        id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        atm_property TEXT NOT NULL DEFAULT 'agreed_to_meet_date___test_',
        sql_classification TEXT NOT NULL DEFAULT 'hs_lead_status_sql',
        mql_definition TEXT NOT NULL DEFAULT 'form_fill',
        updated_at INTEGER
      )
    `);

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

  // Auto-sync is driven by the external GitHub Actions cron in
  // .github/workflows/meta-sync.yml (quick every 5 min, full hourly). It
  // hits GET /api/sync with `Authorization: Bearer $CRON_SECRET`, which
  // does NOT depend on whether the Next.js process is awake or whether
  // anyone is looking at the dashboard. The previous in-process setTimeout
  // loop died any time Railway restarted, slept, or OOM'd the container,
  // which produced the recurring "Meta 17h ago" stale-data bug.
  // Token refresh is also external: .github/workflows/refresh-tokens.yml
  // hits /api/refresh-tokens daily.
}
