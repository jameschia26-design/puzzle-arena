import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { aiProviders, aiTaskProviders } from '../db/schema.js';
import { auth } from '../auth.js';
import { env } from '../env.js';
import { decrypt, encrypt, keyLast4, safeEqual } from '../ai/crypto.js';
import { testProvider } from '../ai/client.js';
import { requireAdmin, toHeaders } from './rooms.js';
import { logger } from '../logger.js';

const providerBodySchema = z.object({
  name: z.string().min(1).max(60),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(16).max(32_000).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
});

const AI_TASKS = ['wordsearch_theme', 'mystery_flavour', 'puzzle_title'] as const;

/** Keys never leave the server; the API exposes only the last four characters. */
const publicProvider = (row: typeof aiProviders.$inferSelect) => ({
  id: row.id,
  name: row.name,
  baseUrl: row.baseUrl,
  model: row.model,
  enabled: row.enabled,
  isDefault: row.isDefault,
  temperature: row.temperature,
  maxTokens: row.maxTokens,
  timeoutMs: row.timeoutMs,
  keyLast4: keyLast4(row.apiKeyEnc),
  createdAt: row.createdAt,
});

export function registerAdminRoutes(app: FastifyInstance): void {
  /**
   * Signup is gated without relying on Better Auth hook internals: the raw
   * sign-up route is 404'd by a preHandler (see index.ts), and this route
   * checks the code before delegating to Better Auth server-side.
   */
  app.post('/api/admin/register', async (req, reply) => {
    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string().min(8).max(200),
        name: z.string().min(1).max(60),
        signupCode: z.string(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid registration', detail: parsed.error.issues });
    }
    if (!safeEqual(parsed.data.signupCode, env.adminSignupCode)) {
      return reply.code(403).send({ error: 'Invalid signup code' });
    }

    try {
      const response = await auth.api.signUpEmail({
        body: {
          email: parsed.data.email,
          password: parsed.data.password,
          name: parsed.data.name,
        },
        asResponse: true,
      });
      // Forward the session cookie Better Auth issued.
      for (const [key, value] of response.headers.entries()) {
        if (key.toLowerCase() === 'set-cookie') reply.header('set-cookie', value);
      }
      const body = await response.json().catch(() => ({}));
      return reply.code(response.status).send(body);
    } catch (err) {
      logger.error({ err }, 'admin registration failed');
      return reply.code(400).send({ error: 'Registration failed', detail: String(err) });
    }
  });

  app.get('/api/admin/me', async (req, reply) => {
    const session = await auth.api.getSession({ headers: toHeaders(req.headers) });
    if (!session?.user) return reply.code(401).send({ error: 'Not signed in' });
    return reply.send({ user: { id: session.user.id, email: session.user.email, name: session.user.name } });
  });

  /* ---------------- AI providers ---------------- */

  app.get('/api/admin/ai/providers', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = await db.select().from(aiProviders);
    const bindings = await db.select().from(aiTaskProviders);
    return reply.send({
      providers: rows.map(publicProvider),
      tasks: AI_TASKS.map((task) => ({
        task,
        providerId: bindings.find((b) => b.task === task)?.providerId ?? null,
      })),
    });
  });

  app.post('/api/admin/ai/providers', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = providerBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid provider', detail: parsed.error.issues });
    }
    const d = parsed.data;
    if (d.isDefault) {
      await db.update(aiProviders).set({ isDefault: false });
    }
    const inserted = (
      await db
        .insert(aiProviders)
        .values({
          name: d.name,
          baseUrl: d.baseUrl,
          apiKeyEnc: encrypt(d.apiKey),
          model: d.model,
          enabled: d.enabled ?? true,
          isDefault: d.isDefault ?? false,
          temperature: d.temperature ?? 0.8,
          maxTokens: d.maxTokens ?? null,
          timeoutMs: d.timeoutMs ?? 30000,
        })
        .returning()
    )[0];
    if (!inserted) return reply.code(500).send({ error: 'Could not create provider' });
    return reply.send({ provider: publicProvider(inserted) });
  });

  app.patch('/api/admin/ai/providers/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = String((req.params as { id: string }).id);
    const parsed = providerBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid provider', detail: parsed.error.issues });
    }
    const d = parsed.data;
    if (d.isDefault) await db.update(aiProviders).set({ isDefault: false });

    const patch: Record<string, unknown> = {};
    for (const key of ['name', 'baseUrl', 'model', 'enabled', 'isDefault', 'temperature', 'maxTokens', 'timeoutMs'] as const) {
      if (d[key] !== undefined) patch[key] = d[key];
    }
    if (d.apiKey) patch['apiKeyEnc'] = encrypt(d.apiKey);

    const updated = (
      await db.update(aiProviders).set(patch).where(eq(aiProviders.id, id)).returning()
    )[0];
    if (!updated) return reply.code(404).send({ error: 'No such provider' });
    return reply.send({ provider: publicProvider(updated) });
  });

  app.delete('/api/admin/ai/providers/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = String((req.params as { id: string }).id);
    await db.delete(aiProviders).where(eq(aiProviders.id, id));
    return reply.send({ ok: true });
  });

  /** Fires a tiny completion and reports latency — the configurability proof. */
  app.post('/api/admin/ai/providers/:id/test', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = String((req.params as { id: string }).id);
    const row = (await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1))[0];
    if (!row) return reply.code(404).send({ error: 'No such provider' });

    const result = await testProvider({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl.replace(/\/+$/, ''),
      apiKey: decrypt(row.apiKeyEnc),
      model: row.model,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
      timeoutMs: row.timeoutMs,
    });
    return reply.send(result);
  });

  /** Bind one task to one provider. */
  app.put('/api/admin/ai/tasks/:task', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const task = String((req.params as { task: string }).task);
    if (!AI_TASKS.includes(task as (typeof AI_TASKS)[number])) {
      return reply.code(400).send({ error: 'Unknown task' });
    }
    const parsed = z.object({ providerId: z.string().uuid().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid binding' });

    if (parsed.data.providerId === null) {
      await db.delete(aiTaskProviders).where(eq(aiTaskProviders.task, task));
      return reply.send({ task, providerId: null });
    }
    await db
      .insert(aiTaskProviders)
      .values({ task, providerId: parsed.data.providerId })
      .onConflictDoUpdate({
        target: aiTaskProviders.task,
        set: { providerId: parsed.data.providerId },
      });
    return reply.send({ task, providerId: parsed.data.providerId });
  });
}

/**
 * On boot, seed one enabled default provider from env when the table is empty.
 * This is what makes MiniMax the out-of-the-box default.
 */
export async function seedDefaultProvider(): Promise<void> {
  if (!env.ai.baseUrl || !env.ai.apiKey) return;
  const existing = await db.select().from(aiProviders).limit(1);
  if (existing.length > 0) return;

  await db.insert(aiProviders).values({
    name: env.ai.providerName,
    baseUrl: env.ai.baseUrl,
    apiKeyEnc: encrypt(env.ai.apiKey),
    model: env.ai.model,
    enabled: true,
    isDefault: true,
  });
  logger.info({ provider: env.ai.providerName, model: env.ai.model }, 'seeded default AI provider');
}
