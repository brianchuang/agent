import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getObservabilityStore } from "@agent/observability";
import { encrypt } from "@agent/core/src/security/encryption";
import type { NextAuthConfig } from "next-auth";

export const config = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: "openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send"
        }
      }
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      console.log("SignIn Callback:", { userId: user.id, email: user.email, hasAccount: !!account });
      
      if (!user.email || !user.id || !account) {
          console.error("SignIn failed: Missing required fields", { user, account });
          return false;
      }

      try {
          const store = getObservabilityStore();
          
          // 1. Upsert User
          console.log("Upserting user...", user.id);
          const dbUser = await store.upsertUser({ 
            id: user.id, 
            email: user.email, 
            name: user.name ?? undefined, 
            image: user.image ?? undefined 
          });
          
          if (dbUser.id !== user.id) {
              console.log(`User ID mismatch (DB: ${dbUser.id}, Auth: ${user.id}). Syncing...`);
              user.id = dbUser.id;
          }
          
          // 2. Upsert Connection (Store tokens)
          if (account.provider === 'google') {
              console.log("Upserting Google connection...");
              // Encrypt tokens
              const encryptedAccessToken = account.access_token ? encrypt(account.access_token) : undefined;
              const encryptedRefreshToken = account.refresh_token ? encrypt(account.refresh_token) : undefined;
    
              await store.upsertConnection({
                userId: dbUser.id, // Use the DB ID
                providerId: 'google',
                providerAccountId: account.providerAccountId,
                accessToken: encryptedAccessToken,
                refreshToken: encryptedRefreshToken,
                expiresAt: account.expires_at,
                scope: account.scope,
                tokenType: account.token_type
              });
              console.log("Connection upserted successfully.");
          }
          
          return true;
      } catch (error) {
          console.error("SignIn Error:", error);
          return false;
      }
    },
    async session({ session, token }) {
        if (session.user && token.sub) {
            session.user.id = token.sub;
        }
        return session;
    }
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
