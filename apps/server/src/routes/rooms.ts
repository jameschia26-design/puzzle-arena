import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  BOT_NAME_POOL,
  GAME_REGISTRY,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  botDifficultySchema,
  gameIdSchema,
} from '@puzzle-arena/shared';
import { db } from '../db/index.js';
import { roomPlayers, roomResults, rooms } from '../db/schema.js';
import { auth } from '../auth.js';
import { LiveRoom, getRoom, loadRoom, registerRoom, rooms_registry } from '../rooms/runtime.js';
import { logger } from '../logger.js';

const GUEST_COOKIE = 'pa_guest';

/** Mint or read the signed guest cookie. A guest is never an auth user. */
export function ensureGuest(req: any, reply: any): string {
  const raw = req.cookies?.[GUEST_COOKIE];
  if (raw) {
    const unsigned = req.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) return unsigned.value;
  }
  const guestId = nanoid(21);
  reply.setCookie(GUEST_COOKIE, guestId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    maxAge: 60 * 60 * 24 * 30,
  });
  return guestId;
}

export async function requireAdmin(req: any, reply: any): Promise<string | null> {
  const session = await auth.api.getSession({ headers: toHeaders(req.headers) });
  if (!session?.user?.id) {
    reply.code(401).send({ error: 'Admin session required' });
    return null;
  }
  return session.user.id;
}

export function toHeaders(raw: Record<string, unknown>): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  return headers;
}

function makeCode(): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

const createRoomSchema = z.object({
  gameId: gameIdSchema,
  config: z.unknown().optional(),
  timeLimitSec: z.number().int().min(30).max(14_400).optional(),
});

export function registerRoomRoutes(app: FastifyInstance): void {
  /* -------- create a room (admin only) -------- */
  app.post('/api/rooms', async (req, reply) => {
    const userId = await requireAdmin(req, reply);
    if (!userId) return;

    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid room', detail: parsed.error.issues });
    }
    const { gameId } = parsed.data;
    const meta = GAME_REGISTRY[gameId];

    const configResult = meta.configSchema.safeParse(parsed.data.config ?? {});
    if (!configResult.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid game config', detail: configResult.error.issues });
    }
    const config = configResult.data as Record<string, unknown>;
    const timeLimitSec = parsed.data.timeLimitSec ?? meta.defaultTimeLimitSec;

    // Retry on a unique-index collision — codes are reusable after a room ends.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        const inserted = (
          await db
            .insert(rooms)
            .values({
              code,
              gameId,
              hostUserId: userId,
              status: 'lobby',
              config,
              timeLimitSec,
            })
            .returning()
        )[0];
        if (!inserted) continue;

        const room = new LiveRoom({
          id: inserted.id,
          code: inserted.code,
          gameId: inserted.gameId,
          config: inserted.config,
          timeLimitSec: inserted.timeLimitSec,
          status: inserted.status,
          startedAt: inserted.startedAt,
          endsAt: inserted.endsAt,
        });
        room.attach(app.io);
        registerRoom(room);

        return reply.send({ id: inserted.id, code: inserted.code, gameId, timeLimitSec, config });
      } catch (err) {
        if (attempt === 4) {
          logger.error({ err }, 'failed to allocate a room code');
          return reply.code(500).send({ error: 'Could not allocate a room code' });
        }
      }
    }
    return reply.code(500).send({ error: 'Could not create room' });
  });

  /* -------- lobby metadata for the join screen -------- */
  app.get('/api/rooms/:code', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const code = String((req.params as { code: string }).code).toUpperCase();
    const row = (await db.select().from(rooms).where(eq(rooms.code, code)).limit(1))[0];
    if (!row) return reply.code(404).send({ error: 'No such room' });

    const room = await loadRoom(row.id, app.io);
    const meta = GAME_REGISTRY[row.gameId as keyof typeof GAME_REGISTRY];
    return reply.send({
      id: row.id,
      code: row.code,
      gameId: row.gameId,
      title: meta?.title ?? row.gameId,
      status: row.status,
      timeLimitSec: row.timeLimitSec,
      config: row.config,
      players: room?.playerViews() ?? [],
    });
  });

  /* -------- rooms this admin hosts -------- */
  app.get('/api/rooms', async (req, reply) => {
    const userId = await requireAdmin(req, reply);
    if (!userId) return;
    const rows = await db
      .select()
      .from(rooms)
      .where(eq(rooms.hostUserId, userId))
      .orderBy(desc(rooms.createdAt))
      .limit(50);
    return reply.send({ rooms: rows });
  });

  /* -------- results -------- */
  app.get('/api/rooms/:id/results', async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const live = getRoom(id);
    if (live?.results) return reply.send({ results: live.results });

    const rows = await db.select().from(roomResults).where(eq(roomResults.roomId, id));
    const players = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, id));
    const byId = new Map(players.map((p) => [p.id, p]));
    return reply.send({
      results: rows
        .map((r) => ({
          ...r,
          displayName: byId.get(r.playerId)?.displayName ?? 'Unknown',
          seat: byId.get(r.playerId)?.seat ?? 0,
          isBot: byId.get(r.playerId)?.isBot ?? false,
        }))
        .sort((a, b) => a.rank - b.rank),
    });
  });

  /* -------- guest identity -------- */
  app.post('/api/guest', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const guestId = ensureGuest(req, reply);
    return reply.send({ guestId });
  });

  /* -------- bots (host only, lobby only) -------- */
  app.post('/api/rooms/:id/bots', async (req, reply) => {
    const userId = await requireAdmin(req, reply);
    if (!userId) return;
    const id = String((req.params as { id: string }).id);

    const row = (await db.select().from(rooms).where(eq(rooms.id, id)).limit(1))[0];
    if (!row) return reply.code(404).send({ error: 'No such room' });
    if (row.hostUserId !== userId) return reply.code(403).send({ error: 'Not your room' });
    if (row.status !== 'lobby') {
      return reply.code(409).send({ error: 'Bots can only be seated in the lobby' });
    }

    const parsed = z.object({ difficulty: botDifficultySchema }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid difficulty' });

    const room = await loadRoom(id, app.io);
    if (!room) return reply.code(404).send({ error: 'No such room' });

    const meta = GAME_REGISTRY[room.gameId];
    const seated = room.players.filter((p) => !p.left);
    if (seated.length >= meta.maxPlayers) {
      return reply.code(409).send({ error: `${meta.title} seats at most ${meta.maxPlayers}` });
    }

    const used = new Set(seated.map((p) => p.displayName));
    const name = BOT_NAME_POOL.find((n) => !used.has(n)) ?? `Bot ${seated.length + 1}`;
    const seat = nextFreeSeat(room);

    const inserted = (
      await db
        .insert(roomPlayers)
        .values({
          roomId: id,
          guestId: null,
          displayName: name,
          seat,
          isHost: false,
          isBot: true,
          botDifficulty: parsed.data.difficulty,
        })
        .returning()
    )[0];
    if (!inserted) return reply.code(500).send({ error: 'Could not seat the bot' });

    room.players.push({
      id: inserted.id,
      guestId: null,
      displayName: name,
      seat,
      isHost: false,
      isBot: true,
      botDifficulty: parsed.data.difficulty,
      avatar: null,
      connected: true,
      left: false,
      state: null,
      penalties: 0,
      completed: false,
      completedAtMs: null,
    });
    room.broadcastPlayers();
    room.broadcastSnapshot();
    return reply.send({ playerId: inserted.id, displayName: name, seat });
  });

  app.delete('/api/rooms/:id/bots/:playerId', async (req, reply) => {
    const userId = await requireAdmin(req, reply);
    if (!userId) return;
    const { id, playerId } = req.params as { id: string; playerId: string };

    const row = (await db.select().from(rooms).where(eq(rooms.id, id)).limit(1))[0];
    if (!row) return reply.code(404).send({ error: 'No such room' });
    if (row.hostUserId !== userId) return reply.code(403).send({ error: 'Not your room' });
    if (row.status !== 'lobby') {
      return reply.code(409).send({ error: 'Bots can only be removed in the lobby' });
    }

    const room = await loadRoom(id, app.io);
    const bot = room?.player(playerId);
    if (!room || !bot || !bot.isBot) return reply.code(404).send({ error: 'No such bot' });

    await db.delete(roomPlayers).where(eq(roomPlayers.id, playerId));
    room.players = room.players.filter((p) => p.id !== playerId);
    room.broadcastPlayers();
    room.broadcastSnapshot();
    return reply.send({ ok: true });
  });
}

export function nextFreeSeat(room: LiveRoom): number {
  const taken = new Set(room.players.filter((p) => !p.left).map((p) => p.seat));
  for (let i = 0; i < 200; i++) if (!taken.has(i)) return i;
  return room.players.length;
}
