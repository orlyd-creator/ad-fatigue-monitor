import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicLinks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Public platform entry: /public/<token>
 * Validates the token, sets a `public_view` cookie (24h), and redirects to /dashboard.
 * Every subsequent page load reads the cookie via getSessionOrPublic() and grants
 * read-only access to the whole platform using the owner's ad accounts.
 *
 * Revoking the token invalidates the cookie immediately — next request to any
 * protected page returns a "link unavailable" state via the session helper.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Build an absolute URL that respects Railway's proxy (x-forwarded-*)
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = host ? `${proto}://${host}` : req.nextUrl.origin;

  const link = await db
    .select()
    .from(publicLinks)
    .where(eq(publicLinks.token, token))
    .get();

  if (!link || link.revokedAt) {
    const dest = new URL("/public/invalid", origin);
    return NextResponse.redirect(dest);
  }

  const dest = new URL("/dashboard", origin);
  const res = NextResponse.redirect(dest);
  // Cookie lifetime: 24 hours. Re-clicking the link refreshes it.
  res.cookies.set("public_view", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
  return res;
}
