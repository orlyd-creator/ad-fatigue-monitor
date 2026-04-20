import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts, publicLinks } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Public-view synthetic session shape.
 * Pages that are safe for public viewing (dashboard, leads, executive, ads,
 * alerts, strategy) should use this instead of `auth()` directly so that
 * someone holding a valid public token can browse the whole platform
 * without logging in.
 *
 * Mutating endpoints (sync, settings, invites, share-links, public-links,
 * chat) must keep using `auth()` so public viewers can't change anything.
 */
export type SessionLike = {
  userId: string;
  email: string;
  accountId: string;
  allAccountIds: string[];
  isPublic?: boolean;
};

/** Try real auth first, then fall back to a synthetic session from public_view cookie. */
export async function getSessionOrPublic(): Promise<SessionLike | null> {
  const realSession = await auth();
  if (realSession) {
    const anySess = realSession as any;
    return {
      userId: anySess.userId || anySess.user?.id || "",
      email: anySess.email || anySess.user?.email || "",
      accountId: anySess.accountId || "",
      allAccountIds: anySess.allAccountIds || (anySess.accountId ? [anySess.accountId] : []),
      isPublic: false,
    };
  }

  // No real session — check the public token cookie
  const jar = await cookies();
  const token = jar.get("public_view")?.value;
  if (!token) return null;

  const link = await db
    .select()
    .from(publicLinks)
    .where(eq(publicLinks.token, token))
    .get();
  if (!link || link.revokedAt) return null;

  const accountRows = await db.select().from(accounts).all();
  if (accountRows.length === 0) return null;

  // Best-effort: bump view counter. Non-blocking.
  db.update(publicLinks)
    .set({ viewsCount: sql`${publicLinks.viewsCount} + 1` })
    .where(eq(publicLinks.token, token))
    .run();

  const ids = accountRows.map((r) => r.id);
  return {
    userId: `public:${token}`,
    email: "public-viewer",
    accountId: ids[0],
    allAccountIds: ids,
    isPublic: true,
  };
}
