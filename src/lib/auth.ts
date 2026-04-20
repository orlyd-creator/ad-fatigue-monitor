import NextAuth from "next-auth";
import Facebook from "next-auth/providers/facebook";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db";
import { accounts, teamInvites } from "@/lib/db/schema";
import { exchangeForLongLivedToken, getAdAccounts } from "@/lib/meta/client";
import { eq, sql } from "drizzle-orm";

// Google is enabled only when both env vars are set, so a missing GOOGLE_CLIENT_ID
// won't crash the app — FB continues to work alone.
const googleEnabled = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
const providers: any[] = [
  Facebook({
    clientId: process.env.META_APP_ID!,
    clientSecret: process.env.META_APP_SECRET!,
    authorization: {
      params: {
        scope: "email,ads_read,ads_management",
      },
    },
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

      // No account check possible? Let first-ever user through (bootstrapping the owner).
      const anyAccountExists = (await db.select({ n: sql<number>`count(*)` }).from(accounts).get())?.n || 0;
      const isFirstUser = anyAccountExists === 0;

      if (!isOwner && !isInvitedTeammate && !isFirstUser) {
        console.log(`[auth] Rejected sign-in from ${email || fbUserId} — not owner, not invited`);
        return false;
      }

      // Invited teammates: grant access without triggering Meta account ingestion.
      // They'll use the shared owner's stored Meta token.
      if (isInvitedTeammate && !isOwner) {
        console.log(`[auth] Invited teammate signed in: ${email}`);
        return true;
      }

      // Owner (or first-ever user): run full Meta ingestion flow.
      try {
        const longLived = await exchangeForLongLivedToken(
          account.access_token,
          process.env.META_APP_ID!,
          process.env.META_APP_SECRET!
        );

        try {
          const permsRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${longLived.access_token}`);
          const permsData = await permsRes.json();
          const granted = (permsData.data || []).filter((p: any) => p.status === "granted").map((p: any) => p.permission);
          console.log(`[auth] Granted permissions: ${granted.join(", ")}`);
        } catch { /* ignore */ }

        const adAccounts = await getAdAccounts(longLived.access_token);
        console.log(`[auth] Found ${adAccounts.length} ad accounts`);

        if (adAccounts.length === 0) {
          console.error("[auth] No ad accounts found for this user");
          return false;
        }

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
        console.error("[auth] OAuth callback error:", err);
        return false;
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
