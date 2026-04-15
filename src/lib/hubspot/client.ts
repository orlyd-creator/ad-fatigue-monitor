import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const BASE_URL = "https://api.hubapi.com";

interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
}

interface SearchResponse {
  total: number;
  results: HubSpotContact[];
  paging?: { next?: { after: string } };
}

/** Get the API key: env var first, then DB fallback */
async function getApiKey(): Promise<string> {
  if (process.env.HUBSPOT_API_KEY) return process.env.HUBSPOT_API_KEY;
  try {
    const row = await db.get<{ api_key: string }>(sql`SELECT api_key FROM hubspot_config WHERE id = 1`);
    if (row?.api_key) return row.api_key;
  } catch {
    // table may not exist yet
  }
  throw new Error("HUBSPOT_API_KEY not configured");
}

async function hubspotFetch(path: string, options?: RequestInit): Promise<any> {
  const apiKey = await getApiKey();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API error ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * Get the full lead funnel: MQLs (inbound form fills), ATM (demos booked), SQLs (qualified).
 *
 * Funnel:
 *   MQL = filled inbound form (has createdate, lifecyclestage = lead/marketingqualifiedlead, NO ATM date)
 *   ATM = booked a demo (has agreed_to_meet_date___test_ set)
 *   SQL = qualified after demo (hs_lead_status = SQL/OPEN_DEAL or lifecyclestage = opportunity/customer)
 */
export async function getLeadsFunnel(
  fromDate: string, // YYYY-MM-DD
  toDate: string     // YYYY-MM-DD
): Promise<{
  dailyATM: { date: string; atm: number; sqls: number; contacts: Array<{ id: string; name: string; email: string; company: string; stage: string; leadStatus: string; date: string; tier: string; type: "atm" | "sql" }> }[];
  dailyMQLs: { date: string; mqls: number; contacts: Array<{ id: string; name: string; email: string; company: string; stage: string; date: string; type: "mql" }> }[];
  totalATM: number;
  totalSQLs: number;
  totalMQLs: number;
}> {
  const fromTs = new Date(fromDate + "T00:00:00Z").getTime();
  const toTs = new Date(toDate + "T23:59:59Z").getTime();

  // Query 1: ATM leads (demos booked) — contacts with agreed_to_meet_date in range
  const atmContacts = await paginateHubSpotSearch({
    filterGroups: [{
      filters: [
        { propertyName: "agreed_to_meet_date___test_", operator: "GTE", value: String(fromTs) },
        { propertyName: "agreed_to_meet_date___test_", operator: "LTE", value: String(toTs) },
      ],
    }],
    properties: ["firstname", "lastname", "email", "lifecyclestage", "agreed_to_meet_date___test_", "hs_lead_status", "company", "hs_predictivescoringtier"],
  });

  // Query 2: MQLs — contacts created in date range that are leads/MQLs (no ATM date)
  const mqlContacts = await paginateHubSpotSearch({
    filterGroups: [{
      filters: [
        { propertyName: "createdate", operator: "GTE", value: String(fromTs) },
        { propertyName: "createdate", operator: "LTE", value: String(toTs) },
        { propertyName: "lifecyclestage", operator: "IN", value: "lead;marketingqualifiedlead" },
      ],
    }],
    properties: ["firstname", "lastname", "email", "lifecyclestage", "createdate", "agreed_to_meet_date___test_", "company", "hs_predictivescoringtier"],
  });

  // Filter MQLs: exclude those who already have an ATM date (they graduated to ATM)
  const atmContactIds = new Set(atmContacts.map(c => c.id));
  const pureMQLs = mqlContacts.filter(c => {
    if (atmContactIds.has(c.id)) return false;
    const atm = c.properties.agreed_to_meet_date___test_;
    return !atm || atm === "" || atm === "null";
  });

  // Group ATM contacts by date
  const atmDateMap = new Map<string, { atm: number; sqls: number; contacts: Array<any> }>();
  for (const contact of atmContacts) {
    const atmDate = contact.properties.agreed_to_meet_date___test_;
    if (!atmDate) continue;
    const parsed = new Date(atmDate);
    if (isNaN(parsed.getTime())) continue;
    const dateStr = parsed.toISOString().split("T")[0];

    const stage = contact.properties.lifecyclestage || "";
    const leadStatus = contact.properties.hs_lead_status || "";
    const isSQL = leadStatus === "SQL" || leadStatus === "OPEN_DEAL" || stage === "opportunity" || stage === "customer";
    const tier = contact.properties.hs_predictivescoringtier || "";
    const company = contact.properties.company || "";

    if (!atmDateMap.has(dateStr)) atmDateMap.set(dateStr, { atm: 0, sqls: 0, contacts: [] });
    const day = atmDateMap.get(dateStr)!;
    day.atm++;
    if (isSQL) day.sqls++;
    day.contacts.push({
      id: contact.id,
      name: `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`.trim(),
      email: contact.properties.email || "",
      company,
      stage,
      leadStatus,
      date: dateStr,
      tier,
      type: isSQL ? "sql" : "atm",
    });
  }

  // Group MQLs by create date
  const mqlDateMap = new Map<string, { mqls: number; contacts: Array<any> }>();
  for (const contact of pureMQLs) {
    const createDate = contact.properties.createdate;
    if (!createDate) continue;
    const parsed = new Date(createDate);
    if (isNaN(parsed.getTime())) continue;
    const dateStr = parsed.toISOString().split("T")[0];

    if (!mqlDateMap.has(dateStr)) mqlDateMap.set(dateStr, { mqls: 0, contacts: [] });
    const day = mqlDateMap.get(dateStr)!;
    day.mqls++;
    day.contacts.push({
      id: contact.id,
      name: `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`.trim(),
      email: contact.properties.email || "",
      company: contact.properties.company || "",
      stage: contact.properties.lifecyclestage || "",
      date: dateStr,
      type: "mql" as const,
    });
  }

  const dailyATM = Array.from(atmDateMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const dailyMQLs = Array.from(mqlDateMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalATM = dailyATM.reduce((s, d) => s + d.atm, 0);
  const totalSQLs = dailyATM.reduce((s, d) => s + d.sqls, 0);
  const totalMQLs = dailyMQLs.reduce((s, d) => s + d.mqls, 0);

  return { dailyATM, dailyMQLs, totalATM, totalSQLs, totalMQLs };
}

/** Backward-compatible wrapper — returns ATM data in the old format */
export async function getLeadsByAgreedToMeetDate(
  fromDate: string,
  toDate: string
): Promise<{ date: string; mqls: number; sqls: number; contacts: Array<{ id: string; name: string; email: string; stage: string; date: string; tier: string }> }[]> {
  const { dailyATM } = await getLeadsFunnel(fromDate, toDate);
  return dailyATM.map(d => ({
    date: d.date,
    mqls: d.atm,
    sqls: d.sqls,
    contacts: d.contacts.map(c => ({ id: c.id, name: c.name, email: c.email, stage: c.stage, date: c.date, tier: c.tier })),
  }));
}

/** Paginate through HubSpot CRM search results */
async function paginateHubSpotSearch(searchBody: {
  filterGroups: any[];
  properties: string[];
}): Promise<HubSpotContact[]> {
  const allContacts: HubSpotContact[] = [];
  let after: string | undefined;

  do {
    const body = { ...searchBody, limit: 100, ...(after ? { after } : {}) };
    const data: SearchResponse = await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    allContacts.push(...data.results);
    after = data.paging?.next?.after;
  } while (after);

  return allContacts;
}

/**
 * Check if HubSpot is configured and accessible
 */
export async function checkHubSpotConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    await getApiKey(); // throws if not configured
    await hubspotFetch("/crm/v3/objects/contacts?limit=1");
    return { connected: true };
  } catch (err: any) {
    return { connected: false, error: err.message };
  }
}
