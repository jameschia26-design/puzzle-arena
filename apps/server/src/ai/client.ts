import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../db/index.js';
import { aiContent, aiProviders, aiTaskProviders } from '../db/schema.js';
import { decrypt } from './crypto.js';
import { logger } from '../logger.js';

export type AiTask = 'wordsearch_theme' | 'mystery_flavour' | 'puzzle_title' | 'bot_move';

export interface ResolvedProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** Null omits `max_tokens` from the request — the provider's own default/model-context cap applies. */
  maxTokens: number | null;
  timeoutMs: number;
}

/**
 * Resolve the provider for a task: an explicit binding in `ai_task_providers`
 * first, otherwise the enabled default. Adding a provider must require zero
 * code changes, which is why everything here is data-driven.
 */
export async function resolveProvider(task: AiTask): Promise<ResolvedProvider | null> {
  const bound = await db
    .select()
    .from(aiTaskProviders)
    .innerJoin(aiProviders, eq(aiTaskProviders.providerId, aiProviders.id))
    .where(and(eq(aiTaskProviders.task, task), eq(aiProviders.enabled, true)))
    .limit(1);

  const row =
    bound[0]?.ai_providers ??
    (
      await db
        .select()
        .from(aiProviders)
        .where(and(eq(aiProviders.isDefault, true), eq(aiProviders.enabled, true)))
        .limit(1)
    )[0];

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl.replace(/\/+$/, ''),
    apiKey: decrypt(row.apiKeyEnc),
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    timeoutMs: row.timeoutMs,
  };
}

/**
 * Pull the first balanced JSON object or array out of a reply.
 *
 * We deliberately do NOT send `response_format` — support for it is
 * inconsistent across providers — so the model is asked for JSON in the system
 * prompt and we extract it here. This also tolerates reasoning models that emit
 * a <think> block before the answer, which MiniMax-M3 does.
 */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = cleaned.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

async function callProvider(
  provider: ResolvedProvider,
  system: string,
  user: string,
  maxTokens?: number,
): Promise<string> {
  const effectiveMaxTokens = maxTokens ?? provider.maxTokens ?? undefined;
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: provider.temperature,
      ...(effectiveMaxTokens !== undefined ? { max_tokens: effectiveMaxTokens } : {}),
    }),
    signal: AbortSignal.timeout(provider.timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Provider ${provider.name} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? '';
}

export interface CompleteOptions<T> {
  task: AiTask;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  fallback: T;
  /** Skip the cache — used by the admin Test button. */
  noCache?: boolean;
}

/**
 * One retry on network error, timeout or schema failure; on the second failure
 * return the bundled fallback and log a warning. Results are cached in
 * `ai_content` keyed by (task, sha256(model + system + user)).
 */
export async function complete<T>(opts: CompleteOptions<T>): Promise<{
  value: T;
  source: 'cache' | 'provider' | 'fallback';
}> {
  const provider = await resolveProvider(opts.task);
  if (!provider) {
    logger.warn({ task: opts.task }, 'No AI provider configured; using fallback');
    return { value: opts.fallback, source: 'fallback' };
  }

  const promptHash = createHash('sha256')
    .update(`${provider.model}${opts.system}${opts.user}`)
    .digest('hex');

  if (!opts.noCache) {
    const cached = await db
      .select()
      .from(aiContent)
      .where(and(eq(aiContent.task, opts.task), eq(aiContent.promptHash, promptHash)))
      .limit(1);
    const hit = cached[0];
    if (hit) {
      const parsed = opts.schema.safeParse(hit.payload);
      if (parsed.success) return { value: parsed.data, source: 'cache' };
    }
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callProvider(provider, opts.system, opts.user);
      const extracted = extractJson(text);
      const parsed = opts.schema.safeParse(extracted);
      if (!parsed.success) {
        lastError = parsed.error;
        continue;
      }
      await db
        .insert(aiContent)
        .values({
          task: opts.task,
          promptHash,
          payload: parsed.data as unknown as object,
          providerId: provider.id,
        })
        .onConflictDoNothing();
      return { value: parsed.data, source: 'provider' };
    } catch (err) {
      lastError = err;
    }
  }

  logger.warn(
    { task: opts.task, provider: provider.name, err: String(lastError) },
    'AI provider failed; falling back to bundled content',
  );
  return { value: opts.fallback, source: 'fallback' };
}

/** Admin "Test" button: a tiny completion that proves the credentials work. */
export async function testProvider(
  provider: ResolvedProvider,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    // Reasoning models spend tokens thinking before answering, so a 5-token
    // budget can come back empty even on success. Ask for a little more.
    await callProvider(provider, 'Reply with the single word OK.', 'Say OK', 64);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: String(err) };
  }
}
