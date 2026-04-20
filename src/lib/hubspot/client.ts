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

/** Stored config for how this business counts leads */
export interface HubSpotFilterConfig {
  atmProperty: string;              // e.g. "agreed_to_meet_date___test_"
  leadSourceProperty: string;       // e.g. "lead_source"
  leadSourceValue: string;          // e.g. "Inbound"
  excludeSegmentProperty: string;   // e.g. "number_of_employees__segmented_"
  excludeSegmentValues: string[];   // e.g. ["1-10"] (micro SMB)
  sqlStatuses: string[];            // e.g. ["SQL", "OPEN_DEAL"]
  sqlStages: string[];              // e.g. ["opportunity", "customer"]
  mqlProperty: string;              // e.g. "mql"
  mqlValue: string;                 // e.g. "true"
}

const DEFAULT_CONFIG: HubSpotFilterConfig = {
  atmProperty: "agreed_to_meet_date___test_",
  leadSourceProperty: "lead_source",
  leadSourceValue: "Inbound",
  excludeSegmentProperty: "number_of_employees__segmented_",
  excludeSegmentValues: ["1-10"],
  sqlStatuses: ["SQL", "OPEN_DEAL"],
  sqlStages: ["salesqualifiedlead", "opportunity", "customer"],
  mqlProperty: "mql",
  mqlValue: "true",
};

/** Load filter config from DB, fall back to defaults */
async function getFilterConfig(): Promise<HubSpotFilterConfig> {
  try {
    const row = await db.get<{
      atm_property: string;
      sql_classification: string;
      mql_definition: string;
      lead_source_property?: string;
      lead_source_value?: string;
      exclude_segment_property?: string;
      exclude_segment_values?: string;
    }>(sql`SELECT * FROM hubspot_config WHERE id = 1`);

    if (row) {
      return {
        atmProperty: row.atm_property || DEFAULT_CONFIG.atmProperty,
        leadSourceProperty: row.lead_source_property || DEFAULT_CONFIG.leadSourceProperty,
        leadSourceValue: row.lead_source_value || DEFAULT_CONFIG.leadSourceValue,
        excludeSegmentProperty: row.exclude_segment_property || DEFAULT_CONFIG.excludeSegmentProperty,
        excludeSegmentValues: row.exclude_segment_values ? row.exclude_segment_values.split(",") : DEFAULT_CONFIG.excludeSegmentValues,
        sqlStatuses: DEFAULT_CONFIG.sqlStatuses,
        sqlStages: DEFAULT_CONFIG.sqlStages,
        mqlProperty: DEFAULT_CONFIG.mqlProperty,
        mqlValue: DEFAULT_CONFIG.mqlValue,
      };
    }
  } catch {
    // table may not exist
  }
  return DEFAULT_CONFIG;
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

/** HS returns company date properties as "YYYY-MM-DD" strings OR millisecond timestamps — handle both. */
function parseCompanyDate(val: string | null | undefined): string {
  if (!val) return "";
  if (val.includes("-")) return val.slice(0, 10);
  const n = parseInt(val, 10);
  if (!n || isNaN(n)) return "";
  return new Date(n).toISOString().split("T")[0];
}

// Company-level property internal names for Obol's HS portal (verified 2026-04-20).
// These drive the native "Inbounds YTD Monthly Leads By Tier" report and are the
// source of truth for ATM counts. Do NOT change without re-verifying property names
// against /crm/v3/properties/companies.
const COMPANY_ATM_PROP = "willing_to_meet";            // label: "Agreed to Meet Date"
const COMPANY_LEAD_SOURCE_PROP = "lead_source__cloned_"; // label: "Lead Source " (trailing space)
const COMPANY_TIER_PROP = "tier";
const COMPANY_TIER_ALLOWLIST = ["SMB", "Mid-Market", "Enterprise"];

/**
 * Config-driven lead funnel. Matches HubSpot's native "Inbounds YTD Monthly Leads By Tier"
 * report exactly by querying Companies (primary) with the same 3 filters:
 *   - Company.willing_to_meet (ATM date) in [from, to]
 *   - Company.lead_source__cloned_ = Inbound
 *   - Company.tier ∈ {SMB, Mid-Market, Enterprise}
 *
 * For each matching company, the earliest associated contact supplies
 * attribution (UTMs, source, ad). SQL/MQL classifications come from contact-level
 * lifecycle and lead status.
 */
export async function getLeadsFunnel(
  fromDate: string,
  toDate: string
): Promise<{
  dailyATM: { date: string; atm: number; sqls: number; contacts: Array<{ id: string; name: string; email: string; company: string; stage: string; leadStatus: string; date: string; tier: string; segment: string; leadSource: string; type: "atm" | "sql" }> }[];
  dailyMQLs: { date: string; mqls: number; contacts: Array<{ id: string; name: string; email: string; company: string; stage: string; date: string; type: "mql" }> }[];
  totalATM: number;
  totalSQLs: number;
  totalMQLs: number;
}> {
  const config = await getFilterConfig();
  const fromTs = new Date(fromDate + "T00:00:00Z").getTime();
  const toTs = new Date(toDate + "T23:59:59Z").getTime();

  // === ATM: query Companies directly (matches native "Inbounds YTD Monthly Leads By Tier" report) ===
  const companySearchBody = {
    filterGroups: [{
      filters: [
        { propertyName: COMPANY_ATM_PROP, operator: "GTE", value: String(fromTs) },
        { propertyName: COMPANY_ATM_PROP, operator: "LTE", value: String(toTs) },
        { propertyName: COMPANY_LEAD_SOURCE_PROP, operator: "EQ", value: "Inbound" },
        { propertyName: COMPANY_TIER_PROP, operator: "IN", values: COMPANY_TIER_ALLOWLIST },
      ],
    }],
    properties: ["name", COMPANY_TIER_PROP, COMPANY_LEAD_SOURCE_PROP, COMPANY_ATM_PROP, "domain", "lifecyclestage", "hs_lead_status"],
    limit: 100,
  };

  const atmCompanies: Array<{ id: string; properties: Record<string, string | null> }> = [];
  let compAfter: string | undefined;
  do {
    const r = await hubspotFetch("/crm/v3/objects/companies/search", {
      method: "POST",
      body: JSON.stringify({ ...companySearchBody, ...(compAfter ? { after: compAfter } : {}) }),
    });
    atmCompanies.push(...(r.results || []));
    compAfter = r.paging?.next?.after;
  } while (compAfter);
  console.log(`[hubspot] ATM companies matching native report filters (${fromDate}→${toDate}): ${atmCompanies.length}`);

  // For each matching company, fetch associated contacts for attribution (UTMs, ad, source)
  // and lifecycle/lead status (to classify SQL vs ATM).
  const companyToContacts = new Map<string, HubSpotContact[]>();
  const contactDetails = new Map<string, HubSpotContact>();
  try {
    for (let i = 0; i < atmCompanies.length; i += 100) {
      const batch = atmCompanies.slice(i, i + 100);
      const assocData = await hubspotFetch("/crm/v4/associations/companies/contacts/batch/read", {
        method: "POST",
        body: JSON.stringify({ inputs: batch.map(c => ({ id: c.id })) }),
      });
      const contactIdsForCompanies = new Map<string, string[]>();
      const allContactIds = new Set<string>();
      for (const r of (assocData.results || [])) {
        const companyId = String(r.from?.id || "");
        const cids = (r.to || []).map((t: any) => String(t.toObjectId)).filter(Boolean);
        if (companyId && cids.length) {
          contactIdsForCompanies.set(companyId, cids);
          cids.forEach((cid: string) => allContactIds.add(cid));
        }
      }
      // Batch fetch contact details (UTMs + lifecycle + status)
      const contactIdArr = Array.from(allContactIds);
      for (let j = 0; j < contactIdArr.length; j += 100) {
        const compBatch = contactIdArr.slice(j, j + 100);
        const contactData = await hubspotFetch("/crm/v3/objects/contacts/batch/read", {
          method: "POST",
          body: JSON.stringify({
            inputs: compBatch.map(id => ({ id })),
            properties: [
              "firstname", "lastname", "email", "lifecyclestage",
              "hs_lead_status", "hs_analytics_source", "hs_analytics_source_data_1",
              "hs_analytics_source_data_2", "utm_campaign", "utm_content", "utm_term",
              "utm_medium", "utm_source", "hs_predictivescoringtier",
              config.atmProperty, "createdate",
            ],
          }),
        });
        for (const c of (contactData.results || [])) {
          contactDetails.set(String(c.id), c);
        }
      }
      for (const [companyId, cids] of contactIdsForCompanies.entries()) {
        const contacts = cids.map(cid => contactDetails.get(cid)).filter(Boolean) as HubSpotContact[];
        companyToContacts.set(companyId, contacts);
      }
    }
  } catch (err) {
    console.error("Company → contacts lookup failed (attribution data will be partial):", err);
  }

  // Query 2: MQLs (optional — non-fatal)
  let mqlContacts: HubSpotContact[] = [];
  try {
    const mqlFilters: any[] = [
      { propertyName: "createdate", operator: "GTE", value: String(fromTs) },
      { propertyName: "createdate", operator: "LTE", value: String(toTs) },
    ];
    mqlContacts = await paginateHubSpotSearch({
      filterGroups: [
        { filters: [...mqlFilters, { propertyName: "lifecyclestage", operator: "EQ", value: "lead" }] },
        { filters: [...mqlFilters, { propertyName: "lifecyclestage", operator: "EQ", value: "marketingqualifiedlead" }] },
      ],
      properties: ["firstname", "lastname", "email", "lifecyclestage", "createdate", config.atmProperty, "company", config.excludeSegmentProperty, config.leadSourceProperty, "hs_analytics_source", "hs_analytics_source_data_1", "hs_analytics_source_data_2", "hs_lead_status"],
    });
  } catch (err) {
    console.error("MQL query failed (non-fatal):", err);
  }

  // Collect contact IDs across all matching companies so we can dedupe MQLs against them.
  // Any contact belonging to a matched ATM company is NOT counted as an MQL.
  const atmContactIds = new Set<string>();
  for (const contacts of companyToContacts.values()) {
    for (const c of contacts) atmContactIds.add(c.id);
  }

  // Filter MQLs: exclude contacts already attached to an ATM company and contacts with their own ATM date.
  const pureMQLs = mqlContacts.filter(c => {
    if (atmContactIds.has(c.id)) return false;
    const atm = c.properties[config.atmProperty];
    if (atm && atm !== "" && atm !== "null") return false;
    return true;
  });

  // Group ATM by Company.willing_to_meet date. One entry per company (not per contact).
  // Attribution (UTMs/source/ad) comes from the earliest associated contact.
  const atmDateMap = new Map<string, { atm: number; sqls: number; contacts: Array<any> }>();
  for (const company of atmCompanies) {
    const atmRaw = company.properties[COMPANY_ATM_PROP] || "";
    const dateStr = parseCompanyDate(atmRaw);
    if (!dateStr) continue;

    const contacts = companyToContacts.get(company.id) || [];
    // Pick the earliest-created contact as the representative for attribution
    const primary = contacts.slice().sort((a, b) => {
      const aT = parseInt(a.properties.createdate || "0", 10) || 0;
      const bT = parseInt(b.properties.createdate || "0", 10) || 0;
      return aT - bT;
    })[0];

    // Company is SQL if EITHER:
    //   (a) company's own lifecycle/status qualifies, OR
    //   (b) any associated contact has SQL lifecycle/status.
    // Native HS reports typically use the company's lifecycle stage directly.
    const companyStage = company.properties.lifecyclestage || "";
    const companyLeadStatus = company.properties.hs_lead_status || "";
    const companyIsSQL = config.sqlStatuses.includes(companyLeadStatus) || config.sqlStages.includes(companyStage);
    const contactIsSQL = contacts.some(c => {
      const stage = c.properties.lifecyclestage || "";
      const leadStatus = c.properties.hs_lead_status || "";
      return config.sqlStatuses.includes(leadStatus) || config.sqlStages.includes(stage);
    });
    const isSQL = companyIsSQL || contactIsSQL;

    const tier = company.properties[COMPANY_TIER_PROP] || "";
    const leadSource = company.properties[COMPANY_LEAD_SOURCE_PROP] || "";
    const companyName = company.properties.name || primary?.properties.company || "";

    if (!atmDateMap.has(dateStr)) atmDateMap.set(dateStr, { atm: 0, sqls: 0, contacts: [] });
    const day = atmDateMap.get(dateStr)!;
    day.atm++;
    if (isSQL) day.sqls++;

    const utmCampaign = primary?.properties.utm_campaign || "";
    const utmContent = primary?.properties.utm_content || "";
    const utmTerm = primary?.properties.utm_term || "";
    day.contacts.push({
      id: primary?.id || company.id,
      name: primary ? `${primary.properties.firstname || ""} ${primary.properties.lastname || ""}`.trim() : "",
      email: primary?.properties.email || "",
      company: companyName,
      stage: primary?.properties.lifecyclestage || "",
      leadStatus: primary?.properties.hs_lead_status || "",
      date: dateStr,
      tier,
      segment: "",
      leadSource,
      type: isSQL ? "sql" as const : "atm" as const,
      source: primary?.properties.hs_analytics_source || "",
      sourcePlatform: primary?.properties.hs_analytics_source_data_1 || "",
      campaign: utmCampaign || primary?.properties.hs_analytics_source_data_2 || "",
      adset: utmTerm || "",
      ad: utmContent || "",
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
    const utmCampaignM = contact.properties.utm_campaign || "";
    const utmContentM = contact.properties.utm_content || "";
    const utmTermM = contact.properties.utm_term || "";
    day.contacts.push({
      id: contact.id,
      name: `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`.trim(),
      email: contact.properties.email || "",
      company: contact.properties.company || "",
      stage: contact.properties.lifecyclestage || "",
      date: dateStr,
      type: "mql" as const,
      source: contact.properties.hs_analytics_source || "",
      sourcePlatform: contact.properties.hs_analytics_source_data_1 || "",
      campaign: utmCampaignM || contact.properties.hs_analytics_source_data_2 || "",
      adset: utmTermM || "",
      ad: utmContentM || "",
    });
  }

  const dailyATM = Array.from(atmDateMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dailyMQLs = Array.from(mqlDateMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    dailyATM, dailyMQLs,
    totalATM: dailyATM.reduce((s, d) => s + d.atm, 0),
    totalSQLs: dailyATM.reduce((s, d) => s + d.sqls, 0),
    totalMQLs: dailyMQLs.reduce((s, d) => s + d.mqls, 0),
  };
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

/** Check if HubSpot is configured and accessible */
export async function checkHubSpotConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    await getApiKey();
    await hubspotFetch("/crm/v3/objects/contacts?limit=1");
    return { connected: true };
  } catch (err: any) {
    return { connected: false, error: err.message };
  }
}
