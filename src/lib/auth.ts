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
          scope: "ads_read,ads_management",
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

        // Discover ad accounts
        const adAccounts = await getAdAccounts(longLived.access_token);
        if (adAccounts.length === 0) {
          console.error("[auth] No ad accounts found for this user");
          return false;
        }

        // Store the first ad account (single-account app)
        const adAccount = adAccounts[0];
        const accountId = adAccount.account_id || adAccount.id.replace("act_", "");

        console.log(`[auth] Storing account ${accountId} (${adAccount.name})`);

        db.insert(accounts)
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
    async session({ session }) {
      // Attach account ID to the session
      const account = db.select().from(accounts).limit(1).get();
      if (account) {
        (session as any).accountId = account.id;
        (session as any).accountName = account.name;
        (session as any).tokenExpiring =
          account.tokenExpiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
