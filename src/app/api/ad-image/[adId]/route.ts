import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ads, accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionOrPublic } from "@/lib/sessionOrPublic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-side ad image proxy.
 *
 * Why: Meta's thumbnail_url.width(X).height(Y) returns a SIGNED URL that
 * expires within hours. Storing it in the DB means the image 404s once the
 * row ages past the URL's lifetime. Other URL paths (asset_feed_spec, etc.)
 * are often missing or low-res.
 *
 * This endpoint fetches the ad's creative fresh from Meta on every call,
 * resolves the best available URL, and proxies the image bytes through with
 * aggressive HTTP caching so the browser + CDN do the heavy lifting. The
 * result: images ALWAYS work and look sharp, even if the DB hasn't been
 * synced recently.
 *
 * Usage: <img src="/api/ad-image/{adId}" />
 */

// In-memory cache keyed by adId → resolved image URL + timestamp.
// Keeps Meta API calls cheap for repeat loads.
const urlCache = new Map<string, { url: string; fetchedAt: number }>();
const URL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function resolveImageUrl(
  adId: string,
  accountId: string,
  token: string,
): Promise<string | null> {
  const hit = urlCache.get(adId);
  if (hit && Date.now() - hit.fetchedAt < URL_CACHE_TTL) return hit.url;

  try {
    const fields =
      "creative{thumbnail_url.width(1920).height(1920),image_url,image_hash,asset_feed_spec,object_story_spec}";
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${adId}?fields=${encodeURIComponent(fields)}&access_token=${token}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const creative = data.creative || {};

    // HIGHEST PRIORITY: image_hash -> adimages permalink_url.
    // This is the original uploaded image at full resolution, stable URL,
    // doesn't expire. Meta's thumbnail_url can upscale a low-res source;
    // permalink_url returns the exact bytes Orly uploaded.
    const hash = creative.image_hash;
    if (hash && accountId) {
      try {
        const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        const imgRes = await fetch(
          `https://graph.facebook.com/v21.0/${actId}/adimages?hashes=${encodeURIComponent(JSON.stringify([hash]))}&fields=permalink_url,url,url_128&access_token=${token}`,
        );
        if (imgRes.ok) {
          const imgData = await imgRes.json();
          const permalink = imgData.data?.[0]?.permalink_url || imgData.data?.[0]?.url;
          if (permalink) {
            urlCache.set(adId, { url: permalink, fetchedAt: Date.now() });
            return permalink;
          }
        }
      } catch (e) {
        console.error(`[ad-image] adimages lookup failed for ${adId}:`, e);
      }
    }

    // SECONDARY: asset_feed_spec uploads are usually hi-res originals too.
    const assetFeed = creative.asset_feed_spec?.images?.[0]?.url;
    if (assetFeed) {
      urlCache.set(adId, { url: assetFeed, fetchedAt: Date.now() });
      return assetFeed;
    }

    // FALLBACK: explicitly-sized thumbnail (may upscale a low-res source).
    const thumb = creative.thumbnail_url;
    if (thumb) {
      urlCache.set(adId, { url: thumb, fetchedAt: Date.now() });
      return thumb;
    }

    // LAST RESORT: stable but often small (400px) CDN URLs.
    const storyLink = creative.object_story_spec?.link_data?.picture;
    const storyPhoto = creative.object_story_spec?.photo_data?.picture;
    const url = storyLink || storyPhoto || creative.image_url || null;
    if (url) {
      urlCache.set(adId, { url, fetchedAt: Date.now() });
      return url;
    }
  } catch (err) {
    console.error(`[ad-image] resolve failed for ${adId}:`, err);
  }
  return null;
}

// Placeholder SVG returned when no image can be found. Matches app brand gradient.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6B93D8" stop-opacity="0.2"/>
      <stop offset="0.5" stop-color="#9B7ED0" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#D06AB8" stop-opacity="0.2"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <path d="M140 240l40-40a15 15 0 0120 0l40 40m-10-10l10-10a15 15 0 0120 0l20 20M120 270h160a10 10 0 0010-10V140a10 10 0 00-10-10H120a10 10 0 00-10 10v120a10 10 0 0010 10z" stroke="#aaa" stroke-width="3" fill="none" opacity="0.5"/>
</svg>`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ adId: string }> },
) {
  const session = await getSessionOrPublic();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { adId } = await params;

  // Synthetic unattributed rows have no real creative
  if (adId.startsWith("__unattributed_")) {
    return new NextResponse(PLACEHOLDER_SVG, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
    });
  }

  const ad = await db.select().from(ads).where(eq(ads.id, adId)).get();
  if (!ad) return new NextResponse("Not found", { status: 404 });

  // Get the Meta token for this ad's account
  const acct = await db.select().from(accounts).where(eq(accounts.id, ad.accountId)).get();
  const token = acct?.accessToken;

  let resolved: string | null = null;
  if (token) {
    resolved = await resolveImageUrl(adId, ad.accountId, token);
  }
  // Fallback to whatever's stored in the DB if live fetch failed.
  if (!resolved) resolved = ad.imageUrl || ad.thumbnailUrl || null;

  if (!resolved) {
    return new NextResponse(PLACEHOLDER_SVG, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
    });
  }

  // Proxy the image bytes through. Redirects would re-expose the signed URL
  // to the browser which then caches it and breaks once it expires.
  try {
    const imgRes = await fetch(resolved);
    if (!imgRes.ok) throw new Error(`upstream ${imgRes.status}`);
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buf = await imgRes.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentType,
        // Cache for an hour in the browser + CDN. Bust by changing adId.
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error(`[ad-image] proxy fetch failed for ${adId}:`, err);
    // If proxy fails, fall through to placeholder rather than a broken image.
    return new NextResponse(PLACEHOLDER_SVG, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
    });
  }
}
