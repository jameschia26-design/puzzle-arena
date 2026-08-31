import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/index.js';
import * as schema from './db/schema.js';
import { env } from './env.js';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  basePath: '/api/auth',
  // The same server is reachable on localhost, a LAN/Tailscale IP and a MagicDNS
  // name; without these, sign-in from anything but baseURL is rejected.
  trustedOrigins: env.trustedOrigins,
  emailAndPassword: { enabled: true },
  socialProviders: {
    ...(env.googleClientId && env.googleClientSecret
      ? {
          google: {
            clientId: env.googleClientId,
            clientSecret: env.googleClientSecret,
            disableImplicitSignUp: true,
          },
        }
      : {}),
  },
  advanced: {
    // Same origin for API and SPA, so no cross-site cookie work is needed.
    defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: env.isProd },
  },
});

export type Auth = typeof auth;
