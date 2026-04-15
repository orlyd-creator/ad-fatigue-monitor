import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hubspotConfig } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

// Ensure table exists (runs once)
async function ensureTable() {
  try {
    await db.run(sql`CREATE TABLE IF NOT EXISTS hubspot_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      api_key TEXT NOT NULL DEFAULT '',
      atm_property TEXT NOT NULL DEFAULT 'agreed_to_meet_date___test_',
      sql_classification TEXT NOT NULL DEFAULT 'hs_lead_status_sql',
      mql_definition TEXT NOT NULL DEFAULT 'form_fill',
      updated_at INTEGER
    )`);
  } catch {
    // table likely already exists
  }
}

export async function GET() {
  await ensureTable();
  const config = await db.select().from(hubspotConfig).where(eq(hubspotConfig.id, 1)).get();

  if (!config || !config.apiKey) {
    return NextResponse.json({
      success: true,
      config: { hasApiKey: false, atmProperty: "agreed_to_meet_date___test_", sqlClassification: "hs_lead_status_sql", mqlDefinition: "form_fill" },
    });
  }

  return NextResponse.json({
    success: true,
    config: {
      hasApiKey: true,
      apiKey: config.apiKey.slice(0, 10) + "..." + config.apiKey.slice(-4),
      atmProperty: config.atmProperty,
      sqlClassification: config.sqlClassification,
      mqlDefinition: config.mqlDefinition,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { apiKey, atmProperty, sqlClassification, mqlDefinition } = body;

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ success: false, error: "API key is required." }, { status: 400 });
    }

    const sqlClass = Array.isArray(sqlClassification) ? sqlClassification.join(",") : (sqlClassification || "hs_lead_status_sql");

    // Upsert: try insert, if exists update
    const existing = await db.select().from(hubspotConfig).where(eq(hubspotConfig.id, 1)).get();
    if (existing) {
      await db.run(sql`UPDATE hubspot_config SET
        api_key = ${apiKey},
        atm_property = ${atmProperty || "agreed_to_meet_date___test_"},
        sql_classification = ${sqlClass},
        mql_definition = ${mqlDefinition || "form_fill"},
        updated_at = ${Date.now()}
      WHERE id = 1`);
    } else {
      await db.run(sql`INSERT INTO hubspot_config (id, api_key, atm_property, sql_classification, mql_definition, updated_at)
        VALUES (1, ${apiKey}, ${atmProperty || "agreed_to_meet_date___test_"}, ${sqlClass}, ${mqlDefinition || "form_fill"}, ${Date.now()})`);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: `Failed to save: ${message}` }, { status: 500 });
  }
}
