import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { EV, type RoomSnapshot } from '@puzzle-arena/shared';
import { buildServer } from './index.js';
import { attachSocket, setRoomLookup } from './socket.js';
import { getRoom, rooms_registry } from './rooms/runtime.js';
import { db, sql } from './db/index.js';

/**
 * Full-stack integration: a real Fastify + socket.io server against the real
 * Postgres, exercising the flow the plan's manual verification describes —
 * admin registers, hosts a room, a guest joins with the passcode, play starts,
 * moves commit, and the room finalises with scores.
 *
 * The anti-cheat invariants are the point of this file.
 */

let app: FastifyInstance;
let base: string;
let adminCookie = '';
const SIGNUP_CODE = process.env['ADMIN_SIGNUP_CODE'] ?? 'letmein';

async function api(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: any; setCookie: string | null }> {
  const headers = new Headers(init.headers);
  // Only claim a JSON body when there is one — Fastify 400s on an empty body
  // that advertises application/json.
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.cookie) headers.set('cookie', init.cookie);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}

/** Extract just the "name=value" pairs from a Set-Cookie header. */
function cookieValues(setCookie: string | null): string {
  if (!setCookie) return '';
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function connect(cookie: string): Socket {
  return ioClient(base, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: { cookie },
    forceNew: true,
  });
}

function emit<T = any>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 20_000);
    socket.emit(event, payload ?? {}, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function waitFor<T = any>(socket: Socket, event: string, timeoutMs = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`waiting for ${event} timed out`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Wait out the 3-2-1-GO countdown; actions are rejected before it clears. */
async function awaitStart(roomId: string): Promise<void> {
  const room = getRoom(roomId);
  const startsAt = room?.startedAt ?? Date.now();
  await new Promise((r) => setTimeout(r, Math.max(0, startsAt - Date.now()) + 150));
}

const connected = (socket: Socket): Promise<void> =>
  new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });

beforeAll(async () => {
  app = await buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const io = attachSocket(app);
  app.io = io;
  setRoomLookup(getRoom);

  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;

  // A fresh admin per run, so repeated runs do not collide.
  const email = `admin_${Date.now()}@test.local`;
  const reg = await api('/api/admin/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'password123', name: 'Admin', signupCode: SIGNUP_CODE }),
  });
  expect(reg.status).toBe(200);
  adminCookie = cookieValues(reg.setCookie);
  expect(adminCookie).not.toBe('');
}, 60_000);

afterAll(async () => {
  rooms_registry.clear();
  // Close socket.io first: open websockets keep the HTTP server alive.
  app?.io?.close();
  await app?.close();
  await sql.end({ timeout: 5 });
}, 30_000);

/* ================================================================== */

describe('admin auth', () => {
  it('404s the raw Better Auth sign-up route', async () => {
    const res = await api('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'x@y.z', password: 'password123', name: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('refuses registration without the signup code', async () => {
    const res = await api('/api/admin/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `nope_${Date.now()}@test.local`,
        password: 'password123',
        name: 'Nope',
        signupCode: 'definitely-wrong',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('recognises the admin session', async () => {
    const res = await api('/api/admin/me', { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toContain('admin_');
  });

  it('refuses room creation without a session', async () => {
    const res = await api('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'sudoku' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('rooms', () => {
  it('creates a room with a 6-character passcode from the safe alphabet', async () => {
    const res = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ gameId: 'sudoku', config: { difficulty: 'easy' }, timeLimitSec: 300 }),
    });
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    // No 0/O/1/I/L/U anywhere.
    expect(res.body.code).not.toMatch(/[01OILU]/);
  });

  it('rejects an unknown game', async () => {
    const res = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ gameId: 'chess' }),
    });
    expect(res.status).toBe(400);
  });

  it('serves lobby metadata by code', async () => {
    const created = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ gameId: 'nonogram', config: { size: 10 }, timeLimitSec: 300 }),
    });
    const res = await api(`/api/rooms/${created.body.code}`);
    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe('nonogram');
    expect(res.body.title).toBe('Nonogram');
  });

  it('404s an unknown code', async () => {
    expect((await api('/api/rooms/ZZZZZZ')).status).toBe(404);
  });
});

describe('guest identity', () => {
  it('mints a signed guest cookie', async () => {
    const res = await api('/api/guest', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.setCookie).toContain('pa_guest');
    // Signed, so the raw value is not simply the guest id.
    expect(res.body.guestId).toBeTruthy();
  });

  it('rejects a socket with no identity at all', async () => {
    const socket = connect('');
    await expect(connected(socket)).rejects.toThrow();
    socket.close();
  });
});

/* ================================================================== */
/* The full puzzle flow, and the anti-cheat invariants                 */
/* ================================================================== */

describe('a sudoku room end to end', () => {
  it('plays from lobby to results without ever leaking the solution', async () => {
    // --- host creates the room ---
    const created = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({
        gameId: 'sudoku',
        config: { difficulty: 'easy', instantFeedback: false },
        timeLimitSec: 300,
      }),
    });
    const { id: roomId, code } = created.body;

    // --- two identities: the admin host, and a guest ---
    const guestRes = await api('/api/guest', { method: 'POST' });
    const guestCookie = cookieValues(guestRes.setCookie);

    const hostSocket = connect(adminCookie);
    const guestSocket = connect(guestCookie);
    await Promise.all([connected(hostSocket), connected(guestSocket)]);

    const hostJoin = await emit(hostSocket, EV.roomJoin, { code, displayName: 'Host' });
    expect(hostJoin.error).toBeUndefined();
    expect(hostJoin.snapshot.you.isHost).toBe(true);

    const guestJoin = await emit(guestSocket, EV.roomJoin, { code, displayName: 'Guest' });
    expect(guestJoin.error).toBeUndefined();
    expect(guestJoin.snapshot.you.isHost).toBe(false);
    // Distinct seats.
    expect(guestJoin.snapshot.you.seat).not.toBe(hostJoin.snapshot.you.seat);

    // --- a non-host cannot start ---
    const badStart = await emit(guestSocket, EV.roomStart);
    expect(badStart.error).toMatch(/host/i);

    // --- host starts ---
    const started = waitFor(guestSocket, EV.roomStarted);
    const startAck = await emit(hostSocket, EV.roomStart);
    expect(startAck.error).toBeUndefined();
    const startPayload: any = await started;
    // startsAt is in the future so every client runs 3-2-1-GO in step.
    expect(startPayload.startsAt).toBeGreaterThan(Date.now() - 1000);
    expect(startPayload.endsAt).toBeGreaterThan(startPayload.startsAt);

    const room = getRoom(roomId);
    expect(room).toBeDefined();
    const solution = room!.puzzle!.solution as number[];

    // Play is gated until the 3-2-1-GO overlay clears, so nobody gets a head
    // start and no finish time can come out negative.
    const tooEarly = await emit(guestSocket, EV.puzzleCommit, { path: '0,0', value: 1 });
    expect(tooEarly.accepted).toBe(false);
    expect(tooEarly.error).toMatch(/not started/i);
    await new Promise((r) =>
      setTimeout(r, Math.max(0, startPayload.startsAt - Date.now()) + 150),
    );

    // --- ANTI-CHEAT: the snapshot carries the puzzle but never the solution ---
    const snap = room!.snapshotFor(guestJoin.snapshot.you.playerId) as RoomSnapshot;
    const snapJson = JSON.stringify(snap);
    expect((snap.state as any).puzzle).toBeDefined();
    expect((snap.state as any).solution).toBeNull();
    // The solved grid must not appear anywhere in the payload.
    expect(snapJson).not.toContain(solution.join(','));

    // --- both players see the identical puzzle ---
    const hostSnap = room!.snapshotFor(hostJoin.snapshot.you.playerId) as RoomSnapshot;
    expect((hostSnap.state as any).puzzle).toEqual((snap.state as any).puzzle);

    // --- commits ---
    const guestId = guestJoin.snapshot.you.playerId as string;
    const givens = (snap.state as any).puzzle.givens as number[];
    const firstBlank = givens.findIndex((v) => v === 0);
    const r = Math.floor(firstBlank / 9);
    const c = firstBlank % 9;

    const commit = await emit(guestSocket, EV.puzzleCommit, {
      path: `${r},${c}`,
      value: solution[firstBlank],
    });
    expect(commit.accepted).toBe(true);
    // instantFeedback is off, so correctness must NOT be disclosed.
    expect(commit.correct).toBeUndefined();

    // Overwriting a given is illegal.
    const givenIdx = givens.findIndex((v) => v !== 0);
    const bad = await emit(guestSocket, EV.puzzleCommit, {
      path: `${Math.floor(givenIdx / 9)},${givenIdx % 9}`,
      value: 5,
    });
    expect(bad.accepted).toBe(false);

    // --- ANTI-CHEAT: the leaderboard shows FILLED, not CORRECT ---
    const board = room!.leaderboard();
    const guestRow = board.find((e) => e.playerId === guestId);
    expect(guestRow).toBeDefined();
    const blanks = givens.filter((v) => v === 0).length;
    // One cell filled out of all the blanks.
    expect(guestRow!.progress).toBeCloseTo(1 / blanks, 5);

    // --- a hint costs a penalty ---
    const hint = await emit(guestSocket, EV.puzzleHint);
    expect(hint.hint).toBeTruthy();
    expect(room!.player(guestId)!.penalties).toBeGreaterThan(0);

    // --- the guest solves the whole grid ---
    for (let i = 0; i < 81; i++) {
      if (givens[i] !== 0) continue;
      await emit(guestSocket, EV.puzzleCommit, {
        path: `${Math.floor(i / 9)},${i % 9}`,
        value: solution[i],
      });
    }
    expect(room!.player(guestId)!.completed).toBe(true);
    expect(room!.player(guestId)!.completedAtMs).toBeGreaterThanOrEqual(0);

    // --- host ends the room early; results are computed ---
    const ended = waitFor(guestSocket, EV.roomEnded);
    await emit(hostSocket, EV.roomEndEarly);
    const endPayload: any = await ended;

    expect(endPayload.results).toBeInstanceOf(Array);
    const guestResult = endPayload.results.find((x: any) => x.playerId === guestId);
    expect(guestResult.completed).toBe(true);
    expect(guestResult.rank).toBe(1); // the finisher ranks first
    expect(guestResult.score).toBeGreaterThan(0);

    // The unfinished host still scores on partial progress rules (0 here, but
    // present in the table rather than dropped).
    const hostResult = endPayload.results.find(
      (x: any) => x.playerId === hostJoin.snapshot.you.playerId,
    );
    expect(hostResult).toBeDefined();
    expect(hostResult.rank).toBe(2);

    // --- the solution is revealed only now ---
    const afterSnap = room!.snapshotFor(guestId) as RoomSnapshot;
    expect((afterSnap.state as any).solution).toEqual(solution);

    // --- results persisted ---
    const persisted = await api(`/api/rooms/${roomId}/results`);
    expect(persisted.body.results.length).toBeGreaterThanOrEqual(2);

    hostSocket.close();
    guestSocket.close();
  }, 120_000);
});

describe('instant feedback, when the host turns it on', () => {
  it('discloses correctness on commit', async () => {
    const created = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({
        gameId: 'sudoku',
        config: { difficulty: 'easy', instantFeedback: true },
        timeLimitSec: 300,
      }),
    });
    const { code, id: roomId } = created.body;

    const hostSocket = connect(adminCookie);
    await connected(hostSocket);
    await emit(hostSocket, EV.roomJoin, { code, displayName: 'Host' });
    await emit(hostSocket, EV.roomStart);
    await awaitStart(roomId);

    const room = getRoom(roomId)!;
    const solution = room.puzzle!.solution as number[];
    const givens = (room.puzzle!.puzzle as { givens: number[] }).givens;
    const blank = givens.findIndex((v) => v === 0);

    const right = await emit(hostSocket, EV.puzzleCommit, {
      path: `${Math.floor(blank / 9)},${blank % 9}`,
      value: solution[blank],
    });
    expect(right.correct).toBe(true);

    const wrongValue = ((solution[blank] as number) % 9) + 1;
    const wrong = await emit(hostSocket, EV.puzzleCommit, {
      path: `${Math.floor(blank / 9)},${blank % 9}`,
      value: wrongValue,
    });
    expect(wrong.correct).toBe(false);

    await emit(hostSocket, EV.roomEndEarly);
    hostSocket.close();
  }, 60_000);
});

/* ================================================================== */
/* Solo play against bots                                              */
/* ================================================================== */

describe('solo play against computer players', () => {
  it('refuses to start Property Tycoon with one human and no bots, and plays with bots', async () => {
    const created = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({
        gameId: 'property-tycoon',
        config: { turnTimeLimitSec: 30 },
        timeLimitSec: 600,
      }),
    });
    const { id: roomId, code } = created.body;

    const hostSocket = connect(adminCookie);
    await connected(hostSocket);
    await emit(hostSocket, EV.roomJoin, { code, displayName: 'Solo' });

    // 1 human, 0 bots: below the 2-player minimum.
    const tooFew = await emit(hostSocket, EV.roomStart);
    expect(tooFew.error).toMatch(/at least 2 players/i);

    // Seat two bots of different difficulty.
    const easy = await api(`/api/rooms/${roomId}/bots`, {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ difficulty: 'easy' }),
    });
    expect(easy.status).toBe(200);
    const hard = await api(`/api/rooms/${roomId}/bots`, {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ difficulty: 'hard' }),
    });
    expect(hard.status).toBe(200);
    // Bots take real, distinct seats and names from the pool.
    expect(hard.body.seat).not.toBe(easy.body.seat);
    expect(easy.body.displayName).toBeTruthy();

    const ok = await emit(hostSocket, EV.roomStart);
    expect(ok.error).toBeUndefined();
    await awaitStart(roomId);

    const room = getRoom(roomId)!;

    // The first player must be able to act the moment the game starts. This
    // regressed once: legalActions shipped only on `game:state`, which does not
    // fire until somebody moves, so every button was disabled forever.
    const hostId = room.players.find((p) => !p.isBot)!.id;
    const firstSnapshot = room.snapshotFor(hostId);
    expect(firstSnapshot.legalActions).toContain('roll');

    // The same snapshot carries the deadline the server will act on. Without
    // it the client cannot warn that a turn is about to be auto-played, and a
    // purchase decision silently becomes a decline.
    expect(firstSnapshot.turnEndsAt).not.toBeNull();
    expect(firstSnapshot.turnEndsAt!).toBeGreaterThan(Date.now());

    // Bots are seated as real players and appear on the leaderboard.
    expect(room.players.filter((p) => p.isBot)).toHaveLength(2);
    expect(room.leaderboard().filter((e) => e.isBot)).toHaveLength(2);

    // The human is on seat 0 and the table waits on them, so play the human
    // turn first; the bots then take over on their own.
    const hostPlayerId = room.players.find((p) => !p.isBot)!.id;
    for (let i = 0; i < 12 && room.actorToAct() === hostPlayerId; i++) {
      const action = room.engine().autoAction(room.gameState as never, hostPlayerId);
      const ack = await emit(hostSocket, EV.gameAction, action);
      if (!ack.accepted) break;
    }
    const seqAfterHuman = room.seq;

    // Let the bot scheduler run: BOT_THINK_MS=0 in tests makes this quick.
    await new Promise((r) => setTimeout(r, 6000));
    // Bots advanced the game with no further human input.
    expect(room.seq).toBeGreaterThan(seqAfterHuman);
    expect(seqAfterHuman).toBeGreaterThan(0);

    await emit(hostSocket, EV.roomEndEarly);
    const results = room.results!;
    // Every seat, bots included, is scored through the identical path.
    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.isBot)).toHaveLength(2);
    for (const r of results) expect(r.score).toBeGreaterThanOrEqual(0);

    hostSocket.close();
  }, 120_000);

  it('refuses to seat a bot once the room has started', async () => {
    const created = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ gameId: 'sudoku', config: {}, timeLimitSec: 300 }),
    });
    const { id: roomId, code } = created.body;
    const hostSocket = connect(adminCookie);
    await connected(hostSocket);
    await emit(hostSocket, EV.roomJoin, { code, displayName: 'Host' });
    await emit(hostSocket, EV.roomStart);

    const res = await api(`/api/rooms/${roomId}/bots`, {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ difficulty: 'easy' }),
    });
    expect(res.status).toBe(409);

    await emit(hostSocket, EV.roomEndEarly);
    hostSocket.close();
  }, 60_000);
});

/* ================================================================== */
/* Manor Mystery privacy over the wire                                 */
/* ================================================================== */

describe('manor mystery over the wire', () => {
  it('never sends another player cards or the case file to a client', async () => {
    const created = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({
        gameId: 'manor-mystery',
        config: { turnTimeLimitSec: 30 },
        timeLimitSec: 600,
      }),
    });
    const { id: roomId, code } = created.body;

    const hostSocket = connect(adminCookie);
    await connected(hostSocket);
    await emit(hostSocket, EV.roomJoin, { code, displayName: 'Host' });

    for (const difficulty of ['normal', 'hard']) {
      await api(`/api/rooms/${roomId}/bots`, {
        method: 'POST',
        cookie: adminCookie,
        body: JSON.stringify({ difficulty }),
      });
    }
    const ok = await emit(hostSocket, EV.roomStart);
    expect(ok.error).toBeUndefined();

    const room = getRoom(roomId)!;
    const state = room.gameState as {
      caseFile: { suspect: string; weapon: string; room: string };
      players: { id: string; hand: string[] }[];
    };
    const hostPlayerId = room.players.find((p) => !p.isBot)!.id;

    // What the host's socket would actually receive.
    const view = room.stateFor(hostPlayerId) as any;
    expect(view.caseFile).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('caseFile');

    const knowable = new Set<string>([
      ...(view.you?.hand ?? []),
      ...(view.you?.eliminated ?? []),
      ...((view.you?.revelations ?? []) as { card: string }[]).map((x) => x.card),
    ]);
    // No case-file card, and no other player's card, is knowable.
    for (const secret of [state.caseFile.suspect, state.caseFile.weapon, state.caseFile.room]) {
      expect(knowable.has(secret)).toBe(false);
    }
    for (const other of state.players.filter((p) => p.id !== hostPlayerId)) {
      for (const card of other.hand) expect(knowable.has(card)).toBe(false);
    }
    // Public player records carry hand SIZE only.
    for (const p of view.players) {
      expect(p.hand).toBeUndefined();
      expect(typeof p.handSize).toBe('number');
    }

    await emit(hostSocket, EV.roomEndEarly);
    hostSocket.close();
  }, 120_000);
});

/* ================================================================== */
/* Crash recovery                                                      */
/* ================================================================== */

describe('event log', () => {
  it('appends an event per accepted move, so a replay has something to read', async () => {
    const created = await api('/api/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ gameId: 'sudoku', config: {}, timeLimitSec: 300 }),
    });
    const { id: roomId, code } = created.body;

    const hostSocket = connect(adminCookie);
    await connected(hostSocket);
    await emit(hostSocket, EV.roomJoin, { code, displayName: 'Host' });
    await emit(hostSocket, EV.roomStart);
    await awaitStart(roomId);

    const room = getRoom(roomId)!;
    const givens = (room.puzzle!.puzzle as { givens: number[] }).givens;
    const solution = room.puzzle!.solution as number[];

    let applied = 0;
    for (let i = 0; i < 81 && applied < 5; i++) {
      if (givens[i] !== 0) continue;
      await emit(hostSocket, EV.puzzleCommit, {
        path: `${Math.floor(i / 9)},${i % 9}`,
        value: solution[i],
      });
      applied++;
    }
    expect(room.seq).toBe(5);

    // Give the async inserts a moment, then confirm they landed.
    await new Promise((r) => setTimeout(r, 800));
    const { roomEvents } = await import('./db/schema.js');
    const events = await db.select().from(roomEvents).where(eq(roomEvents.roomId, roomId));
    expect(events.length).toBe(5);

    await emit(hostSocket, EV.roomEndEarly);
    hostSocket.close();
  }, 60_000);
});
