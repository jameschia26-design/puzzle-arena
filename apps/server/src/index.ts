import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Server as IOServer } from 'socket.io';
import { auth } from './auth.js';
import { db } from './db/index.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { registerAdminRoutes, seedDefaultProvider } from './routes/admin.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { getRoom, rehydrateRunningRooms } from './rooms/runtime.js';
import { attachSocket, setRoomLookup } from './socket.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: IOServer;
  }
}

const here = dirname(fileURLToPath(import.meta.url));

export async function buildServer() {
  const app = Fastify({ logger: false, trustProxy: true });

  // Fastify refuses new decorators after listen(), but socket.io needs a
  // listening server. Reserve the slot now and fill it in after attach.
  app.decorate('io', null as unknown as IOServer);

  await app.register(cookie, { secret: env.cookieSecret });
  await app.register(rateLimit, { global: false });

  // 20 req/min on the routes that are worth abusing.
  const limited = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  /**
   * Gate signup without touching Better Auth internals: 404 the raw sign-up
   * route. Our own /api/admin/register checks the signup code and then calls
   * Better Auth server-side. Sign-in, sign-out and session stay untouched.
   */
  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'POST' && req.url.startsWith('/api/auth/sign-up')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (req.method === 'POST' && req.url.startsWith('/api/auth/sign-in/social')) {
      const body = req.body as { requestSignUp?: boolean } | undefined;
      if (body?.requestSignUp) {
        return reply.code(403).send({
          error: 'Social registration must use /api/admin/sign-up/google with a valid signup code',
        });
      }
    }
  });

  // Better Auth owns everything under /api/auth/*.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    ...limited,
    handler: async (req, reply) => {
      const url = new URL(req.url, env.betterAuthUrl);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const request = new Request(url, {
        method: req.method,
        headers,
        ...(req.method === 'POST' ? { body: JSON.stringify(req.body ?? {}) } : {}),
      });
      if (req.url.includes('/sign-in') || req.url.includes('/callback') || req.url.includes('/social')) {
        logger.info({ method: req.method, url: req.url, ip: req.ip, userAgent: req.headers['user-agent'] }, 'Auth request received');
      }
      const response = await auth.handler(request);
      reply.status(response.status);
      for (const [key, value] of response.headers.entries()) {
        if (key.toLowerCase() === 'set-cookie') reply.header('set-cookie', value);
        else reply.header(key, value);
      }
      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.get('/api/health', async () => ({ ok: true, status: 'up' }));

  registerAdminRoutes(app);
  registerRoomRoutes(app);

  // Serve the built SPA in production, with an index fallback for client routes.
  const webDist = env.webDist
    ? resolve(env.webDist)
    : resolve(here, '../../../apps/web/dist');
  if (existsSync(join(webDist, 'index.html'))) {
    // wildcard must stay on: with it off, @fastify/static resolves the file
    // list at startup, so a rebuild's newly-hashed assets fall through to the
    // SPA fallback and the browser is handed HTML where it expected JavaScript.
    await app.register(fastifyStatic, { root: webDist, wildcard: true });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
    logger.info({ webDist }, 'serving SPA');
  } else {
    logger.info({ webDist }, 'no built SPA found; API only (run the Vite dev server)');
  }

  return app;
}

async function main(): Promise<void> {
  // Migrations run on boot, before the server listens.
  try {
    await migrate(db, { migrationsFolder: resolve(here, '../drizzle') });
    logger.info('migrations up to date');
  } catch (err) {
    logger.error({ err }, 'migration failed');
  }

  await seedDefaultProvider();

  const app = await buildServer();
  await app.listen({ port: env.port, host: env.host });

  // socket.io attaches after listen, so app.server exists.
  const io = attachSocket(app);
  app.io = io;
  setRoomLookup(getRoom);

  await rehydrateRunningRooms(io);

  logger.info({ port: env.port }, 'Puzzle Arena is up');
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    logger.error({ err }, 'fatal startup error');
    process.exit(1);
  });
}
