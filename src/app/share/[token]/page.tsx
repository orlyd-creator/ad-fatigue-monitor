import { db } from "@/lib/db";
import { shareTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Share-link entry point. Visiting /share/<token> validates the token,
 * sets an httpOnly cookie so the signIn callback can auto-grant access,
 * and redirects to /login. After the teammate signs in with Facebook,
 * the cookie is consumed and they're in — no email allowlist needed.
 */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const record = await db
    .select()
    .from(shareTokens)
    .where(eq(shareTokens.token, token))
    .get();

  const isValid =
    !!record && record.revokedAt === null && (record.expiresAt == null || record.expiresAt > Date.now());

  if (!isValid) {
    // Surface a friendly error on the login page.
    redirect("/login?share=invalid");
  }

  const jar = await cookies();
  jar.set("share_token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 30, // 30 minutes — enough time to complete the FB OAuth round trip
  });

  redirect("/login?share=pending");
}
