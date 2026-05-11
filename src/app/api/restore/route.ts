// One-shot SQL restore. Used during the Turso → Railway volume migration
// to replay a `turso db shell .dump` into the new SQLite file. Auth gated
// behind CRON_SECRET so it can't be hit anonymously even with the route
// shipped. Safe to leave in tree — does nothing without the secret + body.
import { NextRequest, NextResponse } from "next/server";
import { createRawDbClient } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = await req.text();
  if (!sql || sql.length < 10) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }

  const client = createRawDbClient();

  // Drop existing user tables so the dump's CREATE/INSERTs apply cleanly.
  // /data/app.db is just-bootstrapped (instrumentation ensured schema) so
  // there's nothing to preserve — we'd rather start from the dump's truth.
  const tables = [
    "accounts",
    "ads",
    "alerts",
    "daily_metrics",
    "settings",
    "sync_runs",
    "hubspot_config",
    "team_invites",
    "share_tokens",
    "public_links",
    "__drizzle_migrations",
  ];
  for (const t of tables) {
    try { await client.execute(`DROP TABLE IF EXISTS ${t}`); } catch {}
  }

  // The .dump output puts each statement on its own line and uses CREATE
  // TABLE IF NOT EXISTS plus single-line INSERTs. Split on lines, skip
  // pragmas/transactions we don't want, execute the rest.
  const skip = /^(PRAGMA|BEGIN|COMMIT|ROLLBACK|--)/i;
  const stmts: string[] = [];
  let buf = "";
  for (const line of sql.split("\n")) {
    if (!buf && skip.test(line.trim())) continue;
    buf += (buf ? "\n" : "") + line;
    if (buf.trimEnd().endsWith(";")) {
      stmts.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) stmts.push(buf);

  let ok = 0;
  const errors: string[] = [];
  for (const s of stmts) {
    try {
      await client.execute(s);
      ok++;
    } catch (e: any) {
      errors.push(`${e?.message || String(e)}: ${s.slice(0, 120)}`);
      if (errors.length > 10) break;
    }
  }

  return NextResponse.json({
    statementsExecuted: ok,
    statementsAttempted: stmts.length,
    errors,
  });
}
