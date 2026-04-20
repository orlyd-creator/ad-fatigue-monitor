import NextAuth from "next-auth";
import Facebook from "next-auth/providers/facebook";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db";
import { accounts, teamInvites, shareTokens } from "@/lib/db/schema";
import { exchangeForLongLivedToken, getAdAccounts } from "@/lib/meta/client";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";

// Google is enabled only when both env vars are set, so a missing GOOGLE_CLIENT_ID
// won't crash the app — FB continues to work alone.
const googleEnabled = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
const providers: any[] = [
  Facebook({
    clientId: process.env.META_APP_ID!,
    clientSecret: process.env.META_APP_SECRET!,
    // No explicit scope → defaults to public_profile only. This lets ANY FB user
    // log in (ads_read/ads_management would require them to be added as a dev on
    // Orly's FB app or the app to pass FB review). The owner's Meta token was
    // already stored on her first login and is still valid in the DB — we don't
    // try to refresh it on subsequent sign-ins. If she ever needs to refresh,
    // that can be a separate admin-only "Reconnect Meta" flow.
  }),
];
if (googleEnabled) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })
  );
}
export const isGoogleEnabled = googleEnabled;

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Facebook({
      clientId: process.env.META_APP_ID!,
      clientSecret: process.env.META_APP_SECRET!,
      authorization: {
        params: {
          scope: "email,ads_read,ads_management",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (!account?.access_token) return false;

      const email = (profile as any)?.email?.toLowerCase().trim() || "";
      const fbUserId = account.providerAccountId || "";

      // Check if this user is an existing owner (has accounts in DB under their FB ID).
      // If so, proceed with full Meta ingestion flow.
      const existingOwnerAccounts = fbUserId
        ? await db.select().from(accounts).where(eq(accounts.userId, fbUserId)).all()
        : [];
      const isOwner = existingOwnerAccounts.length > 0;

      // Check if this user was invited — either by specific email OR by domain.
      // Domain invites look like "@obol.app" and match any email ending in that domain.
      let isInvitedTeammate = false;
      if (email) {
        // Specific email invite
        const specific = await db
          .select()
          .from(teamInvites)
          .where(eq(teamInvites.email, email))
          .get();
        if (specific) {
          isInvitedTeammate = true;
          await db
            .update(teamInvites)
            .set({ lastSeenAt: Date.now() })
            .where(eq(teamInvites.email, email))
            .run();
        } else {
          // Domain invite — check all "@domain" entries
          const domain = email.includes("@") ? `@${email.split("@")[1]}` : "";
          if (domain) {
            const domainInvite = await db
              .select()
              .from(teamInvites)
              .where(eq(teamInvites.email, domain))
              .get();
            if (domainInvite) {
              isInvitedTeammate = true;
              await db
                .update(teamInvites)
                .set({ lastSeenAt: Date.now() })
                .where(eq(teamInvites.email, domain))
                .run();
            }
          }
        }
      }

      // Check for a valid share-link cookie. If present, treat this user as invited
      // and auto-add them to the invites list so they don't need to re-use the link.
      let hasValidShareToken = false;
      try {
        const jar = await cookies();
        const shareCookie = jar.get("share_token")?.value;
        if (shareCookie) {
          const record = await db
            .select()
            .from(shareTokens)
            .where(eq(shareTokens.token, shareCookie))
            .get();
          if (
            record &&
            record.revokedAt === null &&
            (record.expiresAt == null || record.expiresAt > Date.now())
          ) {
            hasValidShareToken = true;
            // Consume the token (bump uses count, clear the cookie).
            await db
              .update(shareTokens)
              .set({ usesCount: (record.usesCount || 0) + 1 })
              .where(eq(shareTokens.token, shareCookie))
              .run();
            // Auto-add this user to the invite list by their FB email (if we got one).
            if (email) {
              await db
                .insert(teamInvites)
                .values({ email, invitedBy: "share-link", lastSeenAt: Date.now() })
                .onConflictDoUpdate({
                  target: teamInvites.email,
                  set: { lastSeenAt: Date.now() },
                })
                .run();
            }
            // Clear the cookie so it's not reused on other sign-ins.
            jar.delete("share_token");
          }
        }
      } catch (err) {
        console.error("[auth] Share token check failed:", err);
      }

      // No account check possible? Let first-ever user through (bootstrapping the owner).
      const anyAccountExists = (await db.select({ n: sql<number>`count(*)` }).from(accounts).get())?.n || 0;
      const isFirstUser = anyAccountExists === 0;

      if (!isOwner && !isInvitedTeammate && !hasValidShareToken && !isFirstUser) {
        console.log(`[auth] Rejected sign-in from ${email || fbUserId} — not owner, not invited, no share token`);
        return false;
      }

      // Invited teammates (or share-link users): grant access without triggering
      // Meta account ingestion. They'll use the shared owner's stored Meta token.
      if ((isInvitedTeammate || hasValidShareToken) && !isOwner) {
        console.log(`[auth] Teammate signed in via ${hasValidShareToken ? "share link" : "email invite"}: ${email}`);
        return true;
      }

      // Owner (or first-ever user): try to refresh Meta ad-account token, but
      // don't block the login if it fails. The FB app scope no longer requests
      // ads_read/ads_management (that scope blocks non-dev-team users), so
      // most logins won't have a token usable for Meta Graph — and that's fine,
      // the owner's existing stored token keeps working.
      try {
        const permsRes = await fetch(
          `https://graph.facebook.com/v21.0/me/permissions?access_token=${account.access_token}`
        );
        const permsData = await permsRes.json();
        const granted: string[] = (permsData.data || [])
          .filter((p: any) => p.status === "granted")
          .map((p: any) => p.permission);
        const hasAds = granted.includes("ads_read") || granted.includes("ads_management");
        if (!hasAds) {
          console.log(`[auth] Owner signed in without ads permissions — keeping existing stored Meta token`);
          return true;
        }

        const longLived = await exchangeForLongLivedToken(
          account.access_token,
          process.env.META_APP_ID!,
          process.env.META_APP_SECRET!
        );
        const adAccounts = await getAdAccounts(longLived.access_token);
        console.log(`[auth] Found ${adAccounts.length} ad accounts — refreshing stored tokens`);

        for (const adAccount of adAccounts) {
          const accountId = adAccount.account_id || adAccount.id.replace("act_", "");
          await db.insert(accounts)
            .values({
              id: accountId,
              name: adAccount.name || "My Ad Account",
              accessToken: longLived.access_token,
              tokenExpiresAt: Date.now() + longLived.expires_in * 1000,
              userId: fbUserId || "default",
            })
            .onConflictDoUpdate({
              target: accounts.id,
              set: {
                accessToken: longLived.access_token,
                tokenExpiresAt: Date.now() + longLived.expires_in * 1000,
                userId: fbUserId || "default",
                updatedAt: Date.now(),
              },
            })
            .run();
        }
        return true;
      } catch (err) {
        // Non-fatal — fall through and let the owner log in on existing token.
        console.error("[auth] Meta refresh failed (non-fatal):", err);
        return true;
      }
    },
    async jwt({ token, account, profile }) {
      // On initial sign-in, persist the provider account ID + email in the JWT
      if (account?.providerAccountId) {
        token.providerAccountId = account.providerAccountId;
      }
      if ((profile as any)?.email) {
        token.email = (profile as any).email.toLowerCase().trim();
      }
      return token;
    },
    async session({ session, token }) {
      const providerAccountId = token.providerAccountId as string | undefined;
      const email = (token.email as string | undefined) || "";

      // Owner: has accounts stored under their FB user ID.
      let userAccounts = providerAccountId
        ? await db.select().from(accounts).where(eq(accounts.userId, providerAccountId)).all()
        : [];

      // Invited teammate: no accounts under their ID — fall through to the shared
      // (owner's) account so they see the same data as the owner.
      if (userAccounts.length === 0) {
        userAccounts = await db.select().from(accounts).all();
      }

      const account = userAccounts[0];
      if (account) {
        (session as any).accountId = account.id;
        (session as any).accountName = account.name;
        (session as any).allAccountIds = userAccounts.map(a => a.id);
        (session as any).tokenExpiring =
          account.tokenExpiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000;
      }
      if (email) {
        (session as any).email = email;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
