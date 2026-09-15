import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, sql } from '../db/index.js';
import { gameLeaderboardEntries, rooms, user } from '../db/schema.js';
import { buildServer } from '../index.js';

/** Boots the real Fastify app (routes only — no socket.io needed for a plain
 * REST GET) against the real Postgres, per AGENTS.md's DB-touching tests. */

let app: FastifyInstance;
let base: string;
const userIds: string[] = [];
const roomIds: string[] = [];

async function seedEntry(gameId: string, name: string, email: string, score: number): Promise<void> {
  const userId = randomUUID();
  await db.insert(user).values({ id: userId, name, email, emailVerified: true });
  userIds.push(userId);

  const roomId = randomUUID();
  await db.insert(rooms).values({
    id: roomId,
    code: roomId.slice(0, 6).toUpperCase(),
    gameId,
    hostUserId: userId,
    status: 'finished',
    config: {},
    timeLimitSec: 0,
  });
  roomIds.push(roomId);

  await db.insert(gameLeaderboardEntries).values({ gameId, userId, displayName: name, score, roomId });
}

beforeAll(async () => {
  app = await buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;

  await seedEntry('pacman', 'Low Scorer', 'lowscorer@example.com', 100);
  await seedEntry('pacman', 'High Scorer', 'highscorer@example.com', 900);
  await seedEntry('pacman', 'Mid Scorer', 'midscorer@example.com', 500);
}, 30_000);

afterAll(async () => {
  await app?.close();
  for (const id of roomIds) await db.delete(rooms).where(eq(rooms.id, id));
  for (const id of userIds) await db.delete(user).where(eq(user.id, id));
  await sql.end();
}, 30_000);

describe('GET /api/leaderboard/:gameId', () => {
  it('rejects a game id outside the leaderboard scope', async () => {
    const res = await fetch(`${base}/api/leaderboard/sudoku`);
    expect(res.status).toBe(400);
  });

  it('returns entries ordered by score descending and never leaks a raw email', async () => {
    const res = await fetch(`${base}/api/leaderboard/pacman`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ rank: number; displayName: string; email: string; score: number }> };
    expect(body.entries.map((e) => e.score)).toEqual([900, 500, 100]);
    expect(body.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(body.entries.map((e) => e.displayName)).toEqual(['High Scorer', 'Mid Scorer', 'Low Scorer']);
    for (const entry of body.entries) {
      expect(entry.email).toMatch(/^.\*{3}@example\.com$/);
    }
  });

  it('respects a smaller limit', async () => {
    const res = await fetch(`${base}/api/leaderboard/pacman?limit=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ score: number }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.score).toBe(900);
  });
});
