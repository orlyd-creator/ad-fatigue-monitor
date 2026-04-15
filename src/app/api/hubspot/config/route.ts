import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";

const CONFIG_PATH = `${process.cwd()}/.hubspot-config.json`;

interface HubSpotConfig {
  apiKey: string;
  atmProperty: string;
  sqlClassification: string[];
  mqlDefinition: string;
  updatedAt: string;
}

const DEFAULT_CONFIG: HubSpotConfig = {
  apiKey: "",
  atmProperty: "agreed_to_meet_date___test_",
  sqlClassification: ["hs_lead_status_sql"],
  mqlDefinition: "form_fill",
  updatedAt: "",
};

async function readConfig(): Promise<HubSpotConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function writeConfig(config: HubSpotConfig): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function GET() {
  const config = await readConfig();
  // Mask the API key for GET responses
  const masked = config.apiKey
    ? config.apiKey.slice(0, 10) + "..." + config.apiKey.slice(-4)
    : "";

  return NextResponse.json({
    success: true,
    config: {
      ...config,
      apiKey: masked,
      hasApiKey: !!config.apiKey,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, atmProperty, sqlClassification, mqlDefinition } = body;

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json(
        { success: false, error: "API key is required." },
        { status: 400 }
      );
    }

    const config: HubSpotConfig = {
      apiKey,
      atmProperty: atmProperty || DEFAULT_CONFIG.atmProperty,
      sqlClassification: Array.isArray(sqlClassification)
        ? sqlClassification
        : DEFAULT_CONFIG.sqlClassification,
      mqlDefinition: mqlDefinition || DEFAULT_CONFIG.mqlDefinition,
      updatedAt: new Date().toISOString(),
    };

    await writeConfig(config);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Failed to save config: ${message}` },
      { status: 500 }
    );
  }
}
