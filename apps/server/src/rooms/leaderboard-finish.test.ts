import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../db/index.js';
import { gameLeaderboardEntries, rooms, user } from '../db/schema.js';
import { LiveRoom, type LivePlayer } from './runtime.js';

/**
 * Exercises `finish()`'s write path against the real Postgres instance (see
 * AGENTS.md — DB-touching tests need `docker compose up -d` first). Unlike
 * `runtime.test.ts`, these deliberately let `finish()` reach the database:
 * that's the only way to prove the `game_leaderboard_entries` upsert.
 */

const createdUserIds: string[] = [];
const createdRoomIds: string[] = [];

afterAll(async () => {
  for (const id of createdRoomIds) await db.delete(rooms).where(eq(rooms.id, id));
  for (const id of createdUserIds) await db.delete(user).where(eq(user.id, id));
  await sql.end();
});

function makePlayer(id: string, overrides: Partial<LivePlayer> = {}): LivePlayer {
  return {
    id,
    guestId: null,
    displayName: id,
    seat: 0,
    isHost: false,
    isBot: false,
    botDifficulty: null,
    avatar: null,
    connected: true,
    left: false,
    state: null,
    penalties: 0,
    completed: false,
    completedAtMs: null,
    ...overrides,
  };
}

async function makeHostUser(name: string): Promise<string> {
  const id = randomUUID();
  const email = `${id}@leaderboard-finish.test`;
  await db.insert(user).values({ id, name, email, emailVerified: true });
  createdUserIds.push(id);
  return id;
}

/** Inserts the `rooms` row `finish()`'s writes are FK-constrained to, and
 * returns the matching in-memory `LiveRoom` (unstarted — caller wires
 * `players`/`gameState`). */
async function makeRoom(gameId: string, hostUserId: string): Promise<LiveRoom> {
  const id = randomUUID();
  const code = id.slice(0, 6).toUpperCase();
  await db.insert(rooms).values({
    id,
    code,
    gameId,
    hostUserId,
    status: 'running',
    config: {},
    timeLimitSec: 0,
  });
  createdRoomIds.push(id);

  return new LiveRoom({
    id,
    code,
    gameId,
    hostUserId,
    config: {},
    timeLimitSec: 0,
    status: 'running',
    startedAt: null,
    endsAt: null,
  });
}

function setBlockBlasterScore(room: LiveRoom, playerId: string, score: number): void {
  const state = room.gameState as { players: Array<{ id: string; score: number }> };
  const p = state.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`no such block-blaster player: ${playerId}`);
  p.score = score;
}

describe('finish() writes the host to the global leaderboard', () => {
  it('records exactly one entry for the host on a target arcade game, keeps the higher of two scores', async () => {
    const hostUserId = await makeHostUser('Leaderboard Host');
    const hostPlayerId = randomUUID();

    const room1 = await makeRoom('block-blaster', hostUserId);
    room1.players = [makePlayer(hostPlayerId, { seat: 0, isHost: true, displayName: 'Leaderboard Host' })];
    room1.gameState = room1.engine().setup([hostPlayerId], 1, room1.config);
    setBlockBlasterScore(room1, hostPlayerId, 100);
    await room1.finish('completed');

    let rows = await db
      .select()
      .from(gameLeaderboardEntries)
      .where(eq(gameLeaderboardEntries.userId, hostUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.gameId).toBe('block-blaster');
    expect(rows[0]!.score).toBe(100);
    expect(rows[0]!.displayName).toBe('Leaderboard Host');

    // A second, lower-scoring run must not overwrite the stored best.
    const room2 = await makeRoom('block-blaster', hostUserId);
    room2.players = [makePlayer(hostPlayerId, { seat: 0, isHost: true, displayName: 'Leaderboard Host' })];
    room2.gameState = room2.engine().setup([hostPlayerId], 1, room2.config);
    setBlockBlasterScore(room2, hostPlayerId, 40);
    await room2.finish('completed');

    rows = await db
      .select()
      .from(gameLeaderboardEntries)
      .where(eq(gameLeaderboardEntries.userId, hostUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(100);

    // A higher-scoring run must overwrite it.
    const room3 = await makeRoom('block-blaster', hostUserId);
    room3.players = [makePlayer(hostPlayerId, { seat: 0, isHost: true, displayName: 'Leaderboard Host' })];
    room3.gameState = room3.engine().setup([hostPlayerId], 1, room3.config);
    setBlockBlasterScore(room3, hostPlayerId, 250);
    await room3.finish('completed');

    rows = await db
      .select()
      .from(gameLeaderboardEntries)
      .where(eq(gameLeaderboardEntries.userId, hostUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(250);
  });

  it('writes no leaderboard row for a non-target game', async () => {
    const hostUserId = await makeHostUser('Reversi Host');
    const hostPlayerId = randomUUID();
    const opponentId = randomUUID();

    const room = await makeRoom('reversi', hostUserId);
    room.players = [
      makePlayer(hostPlayerId, { seat: 0, isHost: true, displayName: 'Reversi Host' }),
      makePlayer(opponentId, { seat: 1 }),
    ];
    room.gameState = room.engine().setup([hostPlayerId, opponentId], 1, room.config);
    await room.finish('completed');

    const rows = await db
      .select()
      .from(gameLeaderboardEntries)
      .where(eq(gameLeaderboardEntries.userId, hostUserId));
    expect(rows).toHaveLength(0);
  });

  it('writes no leaderboard row when no seated player is the host', async () => {
    const hostUserId = await makeHostUser('Absent Host');
    const guestPlayerId = randomUUID();

    // The host account exists (they created the room) but never took a seat
    // as a player themselves — nobody in `players` carries `isHost: true`.
    const room = await makeRoom('block-blaster', hostUserId);
    room.players = [makePlayer(guestPlayerId, { seat: 0, isHost: false })];
    room.gameState = room.engine().setup([guestPlayerId], 1, room.config);
    setBlockBlasterScore(room, guestPlayerId, 999);
    await room.finish('completed');

    const rows = await db
      .select()
      .from(gameLeaderboardEntries)
      .where(eq(gameLeaderboardEntries.userId, hostUserId));
    expect(rows).toHaveLength(0);
  });
});
