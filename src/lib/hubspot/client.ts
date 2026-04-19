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
  sqlStages: ["opportunity", "customer"],
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

/**
 * Config-driven lead funnel. Reads filter rules from DB so any business can customize.
 *
 * Filters applied:
 *   - ATM property in date range
 *   - Lead source = configured value (e.g. "Inbound")
 *   - Exclude configured segments (e.g. micro SMB "1-10" employees)
 *   - SQL = configured lead statuses + lifecycle stages
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

  // Properties to fetch — includes all filter-relevant fields
  const atmProps = [
    "firstname", "lastname", "email", "lifecyclestage",
    config.atmProperty, "hs_lead_status", "company",
    "hs_predictivescoringtier", config.leadSourceProperty,
    config.excludeSegmentProperty, config.mqlProperty,
    "hs_analytics_source", "hs_analytics_source_data_1",
    "hs_analytics_source_data_2", "inbound_outbound",
    "qualified_lead",
    // Paid ad attribution
    "hs_latest_source", "hs_latest_source_data_1", "hs_latest_source_data_2",
    "hs_analytics_first_url", "hs_analytics_first_referrer",
    "utm_campaign", "utm_content", "utm_term", "utm_medium", "utm_source",
    "first_conversion_event_name", "recent_conversion_event_name",
  ];

  // Query 1: ATM leads — contacts with ATM date in range + lead source filter
  const atmFilters: any[] = [
    { propertyName: config.atmProperty, operator: "GTE", value: String(fromTs) },
    { propertyName: config.atmProperty, operator: "LTE", value: String(toTs) },
  ];
  // Add lead source filter if configured
  if (config.leadSourceValue) {
    atmFilters.push({ propertyName: config.leadSourceProperty, operator: "EQ", value: config.leadSourceValue });
  }

  const atmContacts = await paginateHubSpotSearch({
    filterGroups: [{ filters: atmFilters }],
    properties: [...new Set(atmProps)],
  });

  // Fetch associated company tiers for all ATM contacts
  // The Company "tier" property (SMB/Mid-Market/Enterprise) is the real filter,
  // not employee count — micro SMBs get re-tiered to SMB when qualified
  const companyTierMap = new Map<string, string>();
  try {
    // Batch fetch company associations + tier for contacts
    const contactIds = atmContacts.map(c => c.id);
    for (let i = 0; i < contactIds.length; i += 100) {
      const batch = contactIds.slice(i, i + 100);
      const batchBody = {
        inputs: batch.map(id => ({ id })),
      };
      const assocData = await hubspotFetch("/crm/v4/associations/contacts/companies/batch/read", {
        method: "POST",
        body: JSON.stringify(batchBody),
      });
      // Collect company IDs
      const companyIds = new Set<string>();
      const contactToCompany = new Map<string, string>();
      for (const result of (assocData.results || [])) {
        const contactId = result.from?.id;
        const companyId = result.to?.[0]?.toObjectId;
        if (contactId && companyId) {
          contactToCompany.set(String(contactId), String(companyId));
          companyIds.add(String(companyId));
        }
      }
      // Fetch tier for these companies
      if (companyIds.size > 0) {
        const compIds = Array.from(companyIds);
        for (let j = 0; j < compIds.length; j += 100) {
          const compBatch = compIds.slice(j, j + 100);
          const compData = await hubspotFetch("/crm/v3/objects/companies/batch/read", {
            method: "POST",
            body: JSON.stringify({
              inputs: compBatch.map(id => ({ id })),
              properties: ["tier"],
            }),
          });
          for (const comp of (compData.results || [])) {
            const tier = comp.properties?.tier || "";
            // Map back to contacts
            for (const [cId, coId] of contactToCompany.entries()) {
              if (coId === comp.id) companyTierMap.set(cId, tier);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Company tier lookup failed (non-fatal, skipping tier filter):", err);
  }

  // Apply tier-based exclusion: only keep contacts with a valid company tier (SMB/Mid-Market/Enterprise)
  // If tier lookup succeeded, filter by tier. If it failed, fall back to no exclusion.
  const validTiers = ["SMB", "Mid-Market", "Enterprise"];
  const filteredATM = companyTierMap.size > 0
    ? atmContacts.filter(c => {
        const tier = companyTierMap.get(c.id);
        if (!tier) return true; // no company or no tier set — keep (benefit of the doubt)
        return validTiers.includes(tier); // exclude Micro SMB or unknown tiers
      })
    : atmContacts; // tier lookup failed — don't exclude anything

  // Query 2: MQLs (optional — non-fatal)
  let mqlContacts: HubSpotContact[] = [];
  try {
    const mqlFilters: any[] = [
      { propertyName: "createdate", operator: "GTE", value: String(fromTs) },
      { propertyName: "createdate", operator: "LTE", value: String(toTs) },
    ];
    if (config.leadSourceValue) {
      mqlFilters.push({ propertyName: config.leadSourceProperty, operator: "EQ", value: config.leadSourceValue });
    }
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

  // Filter MQLs: exclude ATM contacts
  const atmContactIds = new Set(filteredATM.map(c => c.id));
  const pureMQLs = mqlContacts.filter(c => {
    if (atmContactIds.has(c.id)) return false;
    const atm = c.properties[config.atmProperty];
    if (atm && atm !== "" && atm !== "null") return false;
    return true;
  });

  // Group ATM contacts by date
  const atmDateMap = new Map<string, { atm: number; sqls: number; contacts: Array<any> }>();
  for (const contact of filteredATM) {
    const atmDate = contact.properties[config.atmProperty];
    if (!atmDate) continue;
    const parsed = new Date(atmDate);
    if (isNaN(parsed.getTime())) continue;
    const dateStr = parsed.toISOString().split("T")[0];

    const stage = contact.properties.lifecyclestage || "";
    const leadStatus = contact.properties.hs_lead_status || "";
    const isSQL = config.sqlStatuses.includes(leadStatus) || config.sqlStages.includes(stage);
    const tier = contact.properties.hs_predictivescoringtier || "";
    const company = contact.properties.company || "";
    const segment = contact.properties[config.excludeSegmentProperty] || "";
    const leadSource = contact.properties[config.leadSourceProperty] || contact.properties.hs_analytics_source || "";

    if (!atmDateMap.has(dateStr)) atmDateMap.set(dateStr, { atm: 0, sqls: 0, contacts: [] });
    const day = atmDateMap.get(dateStr)!;
    day.atm++;
    if (isSQL) day.sqls++;
    // UTMs often hold the most precise paid-ad attribution (campaign/ad)
    const utmCampaign = contact.properties.utm_campaign || "";
    const utmContent = contact.properties.utm_content || ""; // usually the ad
    const utmTerm = contact.properties.utm_term || ""; // usually the adset
    day.contacts.push({
      id: contact.id,
      name: `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`.trim(),
      email: contact.properties.email || "",
      company, stage, leadStatus, date: dateStr, tier, segment, leadSource,
      type: isSQL ? "sql" as const : "atm" as const,
      source: contact.properties.hs_analytics_source || "",
      sourcePlatform: contact.properties.hs_analytics_source_data_1 || "",
      campaign: utmCampaign || contact.properties.hs_analytics_source_data_2 || "",
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
