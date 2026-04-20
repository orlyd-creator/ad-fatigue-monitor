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
 * Next.js 16 — only in Route Handlers and Server Actions.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const origin = req.nextUrl.origin;

  try {
    const record = await db
      .select()
      .from(shareTokens)
      .where(eq(shareTokens.token, token))
      .get();

    const isValid =
      !!record &&
      record.revokedAt === null &&
      (record.expiresAt == null || record.expiresAt > Date.now());

    if (!isValid) {
      return NextResponse.redirect(new URL("/login?share=invalid", origin));
    }

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
    console.error("[share-link] validation failed:", err);
    return NextResponse.redirect(new URL("/login?share=invalid", origin));
  }
}
