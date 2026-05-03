/**
 * Heuristic creative classifier. No LLM call — pattern matching on the copy
 * and ad/adset/campaign names we already store. Cheap, fast, deterministic.
 *
 * Buckets are deliberately coarse so cluster sizes stay meaningful when you
 * only have ~50-200 ads in the account.
 */

import type { Ad } from "@/lib/db/schema";

export type Format =
  | "video"
  | "static"
  | "carousel"
  | "collection"
  | "unknown";

export type Hook =
  | "price"        // discount, %, $, "save", "free"
  | "problem"      // "tired of", "struggling", "stop"
  | "social_proof" // "trusted by", "join", "loved by", "rated", reviews
  | "urgency"      // "today", "limited", "ends", "now", "last chance"
  | "question"     // copy starts with or contains a leading question
  | "story"        // first-person narrative, "I", "we", "our journey"
  | "feature"      // default for product/feature-led copy
  | "unclassified";

export type CTA =
  | "book"      // book a demo, schedule, meet
  | "try"       // try free, start trial
  | "buy"       // buy, shop, order
  | "learn"     // learn more, see how, read
  | "signup"    // sign up, join, get started
  | "download"  // download, get the app
  | "other";

export type Length = "short" | "medium" | "long" | "none";

export interface ClassifiedAd {
  adId: string;
  format: Format;
  hook: Hook;
  cta: CTA;
  length: Length;
  bodyChars: number;
  audience: string;       // parsed from adsetName
  objective: string;      // parsed from campaignName
  patternKey: string;     // canonical key like "video|price"
  patternLabel: string;   // human label for the pattern
}

const lc = (s: string | null | undefined) => (s || "").toLowerCase();

function detectFormat(ad: Ad): Format {
  const name = lc(ad.adName);
  // Common naming conventions in Meta accounts.
  if (/\b(vid|video|reel|tiktok|ugc|movie|mp4)\b/.test(name)) return "video";
  if (/\b(carousel|carousels|carou|slide)\b/.test(name)) return "carousel";
  if (/\b(static|image|img|jpeg|jpg|png|graphic)\b/.test(name)) return "static";
  if (/\b(collection|catalog|cat)\b/.test(name)) return "collection";

  // Soft tells from headline/body length: very short body + image url often = static
  const hasImage = !!(ad.imageUrl || ad.thumbnailUrl);
  const body = ad.adBody || "";
  if (hasImage && body.length < 40) return "static";
  return "unknown";
}

function detectHook(ad: Ad): Hook {
  const text = `${ad.adHeadline || ""} ${ad.adBody || ""}`.toLowerCase().trim();
  if (!text) return "unclassified";

  // Order matters — first match wins. Price/urgency are most distinctive.
  if (/(\d+\s*%\s*off|save\s+\$?\d|\$\d+\s*off|discount|free\s+trial|free\s+for|no\s+cost)/.test(text)) return "price";
  if (/(today\s+only|limited\s+time|ends\s+(today|tonight|soon)|last\s+chance|act\s+now|while\s+supplies)/.test(text)) return "urgency";
  if (/(tired\s+of|struggling\s+with|stop\s+(wasting|losing|paying)|fed\s+up|frustrated)/.test(text)) return "problem";
  if (/(trusted\s+by|loved\s+by|rated\s+\d|join\s+\d|\d+\s*\+\s*(customers|users|teams|companies)|over\s+\d+\s+(customers|users|companies))/.test(text)) return "social_proof";

  // Question hook: copy leads with or contains a clear leading question.
  const firstSentence = text.split(/[.!?]/)[0] || "";
  if (firstSentence.includes("?") || /^(what|why|how|are\s+you|do\s+you|ever\s+wonder)\b/.test(firstSentence)) return "question";

  if (/^(i\s+|we\s+|when\s+i\s+|our\s+journey|my\s+story|here'?s\s+how\s+(i|we))/.test(text)) return "story";

  return "feature";
}

function detectCTA(ad: Ad): CTA {
  const text = lc(`${ad.adHeadline || ""} ${ad.adBody || ""}`);
  if (!text) return "other";
  if (/(book\s+a\s+(demo|call|meeting)|schedule\s+a|meet\s+with)/.test(text)) return "book";
  if (/(try\s+(it\s+)?free|start\s+(your\s+)?(free\s+)?trial|start\s+free)/.test(text)) return "try";
  if (/(buy\s+now|shop\s+(now|today)|order\s+now|add\s+to\s+cart)/.test(text)) return "buy";
  if (/(sign\s+up|get\s+started|create\s+(an\s+|your\s+)?account|join\s+(now|today|us))/.test(text)) return "signup";
  if (/(download|get\s+the\s+app|install)/.test(text)) return "download";
  if (/(learn\s+more|see\s+how|read\s+more|find\s+out)/.test(text)) return "learn";
  return "other";
}

function detectLength(ad: Ad): { length: Length; chars: number } {
  const body = ad.adBody || "";
  const chars = body.length;
  if (chars === 0) return { length: "none", chars };
  if (chars < 80) return { length: "short", chars };
  if (chars < 220) return { length: "medium", chars };
  return { length: "long", chars };
}

function detectAudience(ad: Ad): string {
  // Try to extract a meaningful audience from the adset name: most accounts
  // encode audience like "US | SMB | Lookalike 1%" or "Retargeting - 30d".
  const adset = ad.adsetName || "";
  if (!adset) return "unspecified";
  // Common buckets we look for first.
  const lc = adset.toLowerCase();
  if (/(retarget|rtg|warm|website\s+visitor)/.test(lc)) return "retargeting";
  if (/(lookalike|laL|lal\s*\d|1%|2%)/.test(lc)) return "lookalike";
  if (/(broad|advantage\+|advantage plus|aa\b)/.test(lc)) return "broad";
  if (/(interest|aud)/.test(lc)) return "interest";
  if (/(custom\s+audience|ca\s*-)/.test(lc)) return "custom";
  return "other";
}

function detectObjective(ad: Ad): string {
  const c = lc(ad.campaignName);
  if (!c) return "unspecified";
  if (/(lead|leadgen|leads)/.test(c)) return "leadgen";
  if (/(conv|conversion|purchase|sale|sales)/.test(c)) return "conversion";
  if (/(traffic|click)/.test(c)) return "traffic";
  if (/(awareness|reach|video\s+view|views)/.test(c)) return "awareness";
  if (/(messages|engagement|engage)/.test(c)) return "engagement";
  return "other";
}

const FORMAT_LABEL: Record<Format, string> = {
  video: "Video",
  static: "Static image",
  carousel: "Carousel",
  collection: "Collection",
  unknown: "Unknown format",
};

const HOOK_LABEL: Record<Hook, string> = {
  price: "Price-led",
  problem: "Problem-led",
  social_proof: "Social proof",
  urgency: "Urgency",
  question: "Question hook",
  story: "Story",
  feature: "Feature-led",
  unclassified: "No clear hook",
};

const CTA_LABEL: Record<CTA, string> = {
  book: "Book a demo",
  try: "Try free",
  buy: "Buy now",
  learn: "Learn more",
  signup: "Sign up",
  download: "Download",
  other: "Other CTA",
};

const LENGTH_LABEL: Record<Length, string> = {
  none: "No body copy",
  short: "Short copy",
  medium: "Medium copy",
  long: "Long copy",
};

export function formatLabel(f: Format) { return FORMAT_LABEL[f]; }
export function hookLabel(h: Hook) { return HOOK_LABEL[h]; }
export function ctaLabel(c: CTA) { return CTA_LABEL[c]; }
export function lengthLabel(l: Length) { return LENGTH_LABEL[l]; }

export function classify(ad: Ad): ClassifiedAd {
  const format = detectFormat(ad);
  const hook = detectHook(ad);
  const cta = detectCTA(ad);
  const { length, chars } = detectLength(ad);
  const audience = detectAudience(ad);
  const objective = detectObjective(ad);
  const patternKey = `${format}|${hook}`;
  const patternLabel = `${FORMAT_LABEL[format]} · ${HOOK_LABEL[hook]}`;

  return {
    adId: ad.id,
    format,
    hook,
    cta,
    length,
    bodyChars: chars,
    audience,
    objective,
    patternKey,
    patternLabel,
  };
}

export function classifyAll(ads: Ad[]): ClassifiedAd[] {
  return ads.map(classify);
}
