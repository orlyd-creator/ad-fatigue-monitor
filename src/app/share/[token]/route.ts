import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shareTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Share-link entry point. Validates the token, sets an httpOnly cookie
 * so the signIn callback can auto-grant access, and redirects to /login.
 *
 * Implemented as a Route Handler (GET) rather than a Server Component
 * because cookies().set() is not allowed inside Server Components in
 * Next.js 16, only in Route Handlers and Server Actions.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;

  // On Railway (and most proxied hosts) req.nextUrl.origin reports the internal
  // origin (e.g. localhost:8080). Use the forwarded headers to reconstruct the
  // public origin so redirects stay on the same domain the user arrived from.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const host = forwardedHost || req.headers.get("host") || req.nextUrl.host;
  const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  try {
    const record = await db
      .select()
      .from(shareTokens)
      .where(eq(shareTokens.token, token))
      .get();

    if (!record) {
      console.warn(`[share-link] token not found: ${token}`);
      return NextResponse.redirect(new URL("/login?share=invalid&reason=not_found", origin));
    }
    if (record.revokedAt !== null) {
      console.warn(`[share-link] token revoked: ${token}`);
      return NextResponse.redirect(new URL("/login?share=invalid&reason=revoked", origin));
    }
    if (record.expiresAt != null && record.expiresAt <= Date.now()) {
      console.warn(`[share-link] token expired: ${token}`);
      return NextResponse.redirect(new URL("/login?share=invalid&reason=expired", origin));
    }

    console.log(`[share-link] token accepted: ${token}`);
    const res = NextResponse.redirect(new URL("/login?share=pending", origin));
    res.cookies.set("share_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 30,
    });
    return res;
  } catch (err) {
    console.error("[share-link] validation threw:", err);
    return NextResponse.redirect(new URL("/login?share=invalid&reason=error", origin));
  }
}
