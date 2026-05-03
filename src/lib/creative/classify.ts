/**
 * Creative classifier for OD's account specifically. Reads signal from
 * ad/adset/campaign NAMES (not body/headline, because the Meta sync isn't
 * populating those fields for this account).
 *
 * Dimensions tuned to the actual naming convention seen in OD's account:
 *   - "claude for cash flow dark design broad"
 *   - "GPT, now for cash flow"
 *   - "UGC ad-Okay, wait"
 *   - "if this is how ur tracking cash flow, upgrade"
 *   - "Cfos run on Obol ad"
 *   - "from 2 hours to 2 min"
 */

import type { Ad } from "@/lib/db/schema";

export type Theme =
  | "ai_brand"        // GPT / Claude / Gemini / ChatGPT — "tool-led" framing
  | "outcome"         // "from X to Y", replace, automate, save, "in minutes"
  | "ugc"             // creator content, person name, "okay wait"
  | "product"         // Obol / Cfos / qbo / specific product term
  | "problem"         // "if this is how", "you're missing", "tired of"
  | "other";

export type Treatment =
  | "dark"
  | "studio"
  | "plain"          // "no design"
  | "ugc"            // overlap with theme but tracked separately
  | "default";

export type CtaStyle =
  | "get_started"    // GET STARTED, start using, start
  | "demo"           // get a demo, book a demo
  | "upgrade"        // upgrade, replace, switch
  | "form_test"      // explicit "form test" / "A/B test with form"
  | "default";

export type Audience =
  | "broad"
  | "retargeting"
  | "lookalike"
  | "custom"
  | "interest"
  | "other";

export interface ClassifiedAd {
  adId: string;
  theme: Theme;
  treatment: Treatment;
  ctaStyle: CtaStyle;
  audience: Audience;
  isCopy: boolean;          // names ending with "Copy" / "Copy 2" — duplicate of a winner
  themeLabel: string;
  treatmentLabel: string;
  ctaLabel: string;
  audienceLabel: string;
  patternKey: string;       // theme|treatment — the primary cluster key
  patternLabel: string;
}

const THEME_LABEL: Record<Theme, string> = {
  ai_brand: "AI-tool-led",
  outcome: "Outcome-led",
  ugc: "UGC / creator",
  product: "Product-led",
  problem: "Problem-led",
  other: "Other",
};

const TREATMENT_LABEL: Record<Treatment, string> = {
  dark: "Dark design",
  studio: "Studio shot",
  plain: "No-design / raw",
  ugc: "UGC visual",
  default: "Default visual",
};

const CTA_LABEL: Record<CtaStyle, string> = {
  get_started: "Get started",
  demo: "Book a demo",
  upgrade: "Upgrade / replace",
  form_test: "Form A/B test",
  default: "No explicit CTA",
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  broad: "Broad",
  retargeting: "Retargeting",
  lookalike: "Lookalike",
  custom: "Custom audience",
  interest: "Interest",
  other: "Unspecified",
};

const lc = (s: string | null | undefined) => (s || "").toLowerCase();

function detectTheme(name: string): Theme {
  // AI-tool-led wins if it's literally the headline of the ad name.
  if (/(\bgpt\b|\bclaude\b|\bgemini\b|chatgpt|\bai\b for|\bai\b powered)/i.test(name)) return "ai_brand";
  if (/\bugc\b|okay,?\s*wait|orly\s+ugc|mich\s+#?\d|narrator/i.test(name)) return "ugc";
  if (/(from\s+\d+\s+\w+\s+to\s+\d+|replace\s|automate\s|in\s+minutes|save\s+\d|upgrade\s|stop\s+\w+ing)/i.test(name)) return "outcome";
  if (/\bobol\b|\bcfos\b|\bcfo\b|qbo\s|qbo$|netsuite|quickbooks/i.test(name)) return "product";
  if (/(if\s+this\s+is\s+how|you'?re\s+missing|tired\s+of|fed\s+up|are\s+you\s+still)/i.test(name)) return "problem";
  return "other";
}

function detectTreatment(name: string): Treatment {
  const n = name.toLowerCase();
  if (/\bdark\b|dark\s+design|dark\s+new/.test(n)) return "dark";
  if (/\bstudio\b/.test(n)) return "studio";
  if (/no\s+design|raw|plain/.test(n)) return "plain";
  if (/\bugc\b/.test(n)) return "ugc";
  return "default";
}

function detectCtaStyle(name: string): CtaStyle {
  const n = name.toLowerCase();
  if (/get\s+started|start\s+using|start\s+free|started/.test(n)) return "get_started";
  if (/get\s+a\s+demo|book\s+a\s+demo|book\s+a\s+call/.test(n)) return "demo";
  if (/upgrade|replace|switch/.test(n)) return "upgrade";
  if (/form\s+test|a\/b\s+test|ab\s+test/.test(n)) return "form_test";
  return "default";
}

function detectAudience(adsetName: string | null | undefined, campaignName: string | null | undefined): Audience {
  const t = `${adsetName || ""} ${campaignName || ""}`.toLowerCase();
  if (!t.trim()) return "other";
  if (/retarget|rtg|warm|website\s+visitor|engagers?/.test(t)) return "retargeting";
  if (/lookalike|\blal\b|\blal\s*\d|\bla[l1]\s*%|1%|2%/.test(t)) return "lookalike";
  if (/broad|advantage\+|advantage plus|\baa\b|general\s+ad/.test(t)) return "broad";
  if (/custom\s+audience|customer\s+list|email\s+list/.test(t)) return "custom";
  if (/interest|\bint\b|aud\s*-/.test(t)) return "interest";
  return "other";
}

function detectIsCopy(name: string): boolean {
  return /\bcopy\b|copy\s*\d/i.test(name);
}

export function classify(ad: Ad): ClassifiedAd {
  const adName = ad.adName || "";
  const theme = detectTheme(adName);
  const treatment = detectTreatment(adName);
  const ctaStyle = detectCtaStyle(adName);
  const audience = detectAudience(ad.adsetName, ad.campaignName);
  const isCopy = detectIsCopy(adName);

  const themeLabel = THEME_LABEL[theme];
  const treatmentLabel = TREATMENT_LABEL[treatment];
  const ctaLabel = CTA_LABEL[ctaStyle];
  const audienceLabel = AUDIENCE_LABEL[audience];

  return {
    adId: ad.id,
    theme,
    treatment,
    ctaStyle,
    audience,
    isCopy,
    themeLabel,
    treatmentLabel,
    ctaLabel,
    audienceLabel,
    patternKey: `${theme}|${treatment}`,
    patternLabel: `${themeLabel} · ${treatmentLabel}`,
  };
}

export function classifyAll(ads: Ad[]): ClassifiedAd[] {
  return ads.map(classify);
}

export const THEME_LABELS = THEME_LABEL;
export const TREATMENT_LABELS = TREATMENT_LABEL;
export const CTA_LABELS = CTA_LABEL;
export const AUDIENCE_LABELS = AUDIENCE_LABEL;
