import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The single .env lives at the repo root; resolve it from this file so the
 * server behaves identically no matter which directory it is started from
 * (`npm run dev` inside apps/server, tsx from the root, tests, ...).
 * `override: true` makes the file win over stale vars inherited from a
 * parent shell — inherited env once shadowed APP_TRUSTED_ORIGINS and broke
 * sign-in over the Tailscale funnel.
 */
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
  override: true,
});

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  isProd: process.env['NODE_ENV'] === 'production',
  port: Number(process.env['PORT'] ?? 8080),
  host: process.env['HOST'] ?? '0.0.0.0',

  databaseUrl: required(
    'DATABASE_URL',
    'postgres://postgres:postgres@localhost:5433/puzzlearena',
  ),

  betterAuthSecret: required('BETTER_AUTH_SECRET', 'dev-only-better-auth-secret-change-me'),
  betterAuthUrl: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:8080',
  cookieSecret: required('COOKIE_SECRET', 'dev-only-cookie-secret-change-me'),
  /** 32 raw bytes, base64. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
  appEncryptionKey: required(
    'APP_ENCRYPTION_KEY',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  ),
  adminSignupCode: required('ADMIN_SIGNUP_CODE', 'letmein'),
  googleClientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
  googleClientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
  /**
   * Extra origins Better Auth will accept, comma-separated. Needed whenever the
   * app is reached on something other than BETTER_AUTH_URL — e.g. over Tailscale,
   * where the same server answers on localhost, the 100.x address and the
   * MagicDNS name.
   */
  trustedOrigins: Array.from(
    new Set([
      'http://localhost:5173',
      'http://localhost:8080',
      'http://localhost:8090',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:8080',
      'http://127.0.0.1:8090',
      ...(process.env['APP_TRUSTED_ORIGINS'] ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ]),
  ),

  ai: {
    baseUrl: process.env['AI_BASE_URL'] ?? 'https://api.minimax.io/v1',
    apiKey: process.env['AI_API_KEY'] ?? '',
    model: process.env['AI_MODEL'] ?? 'MiniMax-M3',
    providerName: process.env['AI_PROVIDER_NAME'] ?? 'MiniMax',
  },

  /** Set to 0 in tests so bots act instantly. */
  botThinkMs: process.env['BOT_THINK_MS'] === undefined ? null : Number(process.env['BOT_THINK_MS']),

  /** Where the built SPA lives, served in production. */
  webDist: process.env['WEB_DIST'] ?? '',
} as const;
