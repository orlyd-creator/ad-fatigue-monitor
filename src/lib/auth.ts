import NextAuth from "next-auth";
import Facebook from "next-auth/providers/facebook";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { exchangeForLongLivedToken, getAdAccounts } from "@/lib/meta/client";
import { eq } from "drizzle-orm";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Facebook({
      clientId: process.env.META_APP_ID!,
      clientSecret: process.env.META_APP_SECRET!,
      authorization: {
        params: {
          scope: "ads_read,ads_management,read_insights,business_management",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account }) {
      if (!account?.access_token) return false;

      try {
        // Exchange for long-lived token
        const longLived = await exchangeForLongLivedToken(
          account.access_token,
          process.env.META_APP_ID!,
          process.env.META_APP_SECRET!
        );

        // Log granted permissions for debugging
        try {
          const permsRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${longLived.access_token}`);
          const permsData = await permsRes.json();
          const granted = (permsData.data || []).filter((p: any) => p.status === "granted").map((p: any) => p.permission);
          console.log(`[auth] Granted permissions: ${granted.join(", ")}`);
        } catch { /* ignore */ }

        // Discover ad accounts
        const adAccounts = await getAdAccounts(longLived.access_token);
        if (adAccounts.length === 0) {
          console.error("[auth] No ad accounts found for this user");
          return false;
        }

        // Store the first ad account for this user
        const adAccount = adAccounts[0];
        const accountId = adAccount.account_id || adAccount.id.replace("act_", "");

        console.log(`[auth] Storing account ${accountId} (${adAccount.name}) for user ${account.providerAccountId}`);

        await db.insert(accounts)
          .values({
            id: accountId,
            name: adAccount.name || "My Ad Account",
            accessToken: longLived.access_token,
            tokenExpiresAt: Date.now() + longLived.expires_in * 1000,
            userId: account.providerAccountId || "default",
          })
          .onConflictDoUpdate({
            target: accounts.id,
            set: {
              accessToken: longLived.access_token,
              tokenExpiresAt: Date.now() + longLived.expires_in * 1000,
              userId: account.providerAccountId || "default",
              updatedAt: Date.now(),
            },
          })
          .run();

        return true;
      } catch (err) {
        console.error("[auth] OAuth callback error:", err);
        return false;
      }
    },
    async jwt({ token, account }) {
      // On initial sign-in, persist the provider account ID in the JWT
      if (account?.providerAccountId) {
        token.providerAccountId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      // Look up the account belonging to THIS user via their provider ID
      const providerAccountId = token.providerAccountId as string | undefined;
      if (providerAccountId) {
        const account = await db
          .select()
          .from(accounts)
          .where(eq(accounts.userId, providerAccountId))
          .limit(1)
          .get();
        if (account) {
          (session as any).accountId = account.id;
          (session as any).accountName = account.name;
          (session as any).tokenExpiring =
            account.tokenExpiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
