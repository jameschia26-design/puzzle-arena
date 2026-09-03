import { describe, expect, it, vi } from 'vitest';
import { LiveRoom, type LivePlayer, rehydrateChessClocks } from './runtime.js';
import { scheduleBots, stopBots } from './bots.js';
import { nextFreeSeat } from '../routes/rooms.js';
import { roomPlayers } from '../db/schema.js';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { generatePuzzle, gradePuzzle } from '../games/puzzle-adapter.js';

/**
 * These exercise `LiveRoom`'s timer bookkeeping in isolation, without a real
 * database or socket.io server: `armTurnTimer`, `pause`/`resume`, and
 * `markDisconnected` never touch the DB directly, and `applyGameAction` is
 * stubbed out wherever a test would otherwise let a real auto-play action
 * reach the (unavailable, in this environment) persistence layer.
 */

/** A narrow view onto `LiveRoom`'s private timer internals, for test-only introspection/invocation. */
interface LiveRoomInternals {
  startTimer: unknown;
  clockSince: number | null;
  scheduleStartCountdown(delay: number): void;
  armChessClock(actorId: string, actor: LivePlayer): void;
  arcadeTickTimer: NodeJS.Timeout | null;
}

/** Casts to the private-member view above; the shape is verified by the room's own source, not runtime data. */
function internals(room: LiveRoom): LiveRoomInternals {
  return room as unknown as LiveRoomInternals;
}

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

/** A running 2-player Connect 4 board room, wired up without any DB or socket.io. */
function makeConnect4Room(config: Record<string, unknown> = { turnTimeLimitSec: 60 }): LiveRoom {
  const room = new LiveRoom({
    id: 'room1',
    code: 'ABCDEF',
    gameId: 'connect4',
    config,
    timeLimitSec: 0,
    status: 'lobby',
    startedAt: null,
    endsAt: null,
  });
  room.players = [makePlayer('p1', { seat: 0, isHost: true }), makePlayer('p2', { seat: 1 })];
  room.gameState = room.engine().setup(['p1', 'p2'], 1, room.config);
  room.status = 'running';
  return room;
}

describe('turn timer disconnect handling', () => {
  it('does not reset an already-armed turn deadline when the acting player disconnects', () => {
    vi.useFakeTimers();
    try {
      const room = makeConnect4Room();
      room.armTurnTimer();
      const originalDeadline = room.turnEndsAt;
      expect(originalDeadline).not.toBeNull();
      expect(room.actorToAct()).toBe('p1');

      vi.advanceTimersByTime(2000);
      room.markDisconnected('p1');

      // The deadline set while p1 was still connected must survive the drop
      // untouched — not get reset to "now" (an instant timeout).
      expect(room.turnEndsAt).toBe(originalDeadline);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-play the disconnected actor before their original 60s deadline elapses', () => {
    vi.useFakeTimers();
    try {
      const room = makeConnect4Room();
      room.armTurnTimer();
      const applyGameAction = vi.spyOn(room, 'applyGameAction').mockReturnValue({ accepted: true });

      room.markDisconnected('p1');
      vi.advanceTimersByTime(59_000);
      expect(applyGameAction).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2_000); // total 61s > the 60s limit
      expect(applyGameAction).toHaveBeenCalledWith('p1', expect.anything(), true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives an already-disconnected actor a 15s grace window instead of an instant timeout', () => {
    vi.useFakeTimers();
    try {
      const room = makeConnect4Room({ turnTimeLimitSec: 90 });
      const p1 = room.players.find((p) => p.id === 'p1')!;
      p1.connected = false;

      room.armTurnTimer();

      expect(room.turnEndsAt).not.toBeNull();
      const delay = room.turnEndsAt! - Date.now();
      expect(delay).toBeGreaterThan(14_000);
      expect(delay).toBeLessThanOrEqual(15_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps the disconnected grace window at the turn limit when the limit is shorter than 15s', () => {
    vi.useFakeTimers();
    try {
      const room = makeConnect4Room({ turnTimeLimitSec: 5 });
      const p1 = room.players.find((p) => p.id === 'p1')!;
      p1.connected = false;

      room.armTurnTimer();

      expect(room.turnEndsAt! - Date.now()).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('chess clock re-arm defends against free thinking time', () => {
  it('deducts already-elapsed draining time before resetting clockSince on a re-arm', () => {
    vi.useFakeTimers();
    try {
      const room = new LiveRoom({
        id: 'room2',
        code: 'CHESS1',
        gameId: 'chess',
        config: { clockMinutes: 10 },
        timeLimitSec: 0,
        status: 'lobby',
        startedAt: null,
        endsAt: null,
      });
      room.players = [makePlayer('p1'), makePlayer('p2')];
      room.gameState = room.engine().setup(['p1', 'p2'], 1, room.config);
      room.clocks = new Map([
        ['p1', 600_000],
        ['p2', 600_000],
      ]);
      room.status = 'running';

      const roomInternals = internals(room);
      const p1 = room.players[0]!;
      roomInternals.armChessClock('p1', p1);
      expect(room.clockActor).toBe('p1');
      const initialSince = roomInternals.clockSince;

      vi.advanceTimersByTime(5_000); // 5s of thinking elapses

      // Re-arming while the same actor's clock is already draining must not
      // grant them free time on top of what they already used.
      roomInternals.armChessClock('p1', p1);

      expect(room.clocks!.get('p1')).toBe(600_000 - 5_000);
      expect(roomInternals.clockSince).not.toBe(initialSince);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pause during the pre-game start countdown', () => {
  it('freezes the countdown while paused and resumes it with only the remaining time on resume', () => {
    vi.useFakeTimers();
    try {
      const room = makeConnect4Room();
      const roomInternals = internals(room);
      // Simulate `start()` having just armed the "get ready" countdown,
      // without going through the async, DB-touching `start()` itself.
      room.turnEndsAt = null;
      room.startedAt = Date.now() + 2200;
      roomInternals.scheduleStartCountdown(2200);
      expect(roomInternals.startTimer).not.toBeNull();

      vi.advanceTimersByTime(1000); // 1s into the 2.2s countdown
      room.pause();
      expect(room.paused).toBe(true);
      expect(roomInternals.startTimer).toBeNull();

      // Advance well past when the original (unpaused) countdown would have
      // fired — it must not have armed turn timers/bots while paused.
      vi.advanceTimersByTime(5000);
      expect(room.turnEndsAt).toBeNull();

      room.resume();
      expect(room.paused).toBe(false);
      // The countdown itself resumes rather than firing immediately.
      expect(roomInternals.startTimer).not.toBeNull();
      expect(room.turnEndsAt).toBeNull();

      // Advance past the ~1.2s that remained on the countdown.
      vi.advanceTimersByTime(1300);
      expect(room.turnEndsAt).not.toBeNull();
      expect(room.actorToAct()).toBe('p1');
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not proceed to arm timers/bots if paused right as the countdown's own callback fires", () => {
    vi.useFakeTimers();
    const room = makeConnect4Room();
    try {
      const roomInternals = internals(room);
      room.turnEndsAt = null;
      room.startedAt = Date.now() + 2200;
      roomInternals.scheduleStartCountdown(2200);

      // Pause is recorded, but the countdown callback races in before pause()
      // gets a chance to clear it (e.g. both scheduled in the same tick).
      room.paused = true;
      vi.advanceTimersByTime(2200);

      expect(room.turnEndsAt).toBeNull();
    } finally {
      vi.useRealTimers();
      room.paused = false;
    }
  });
});

describe('concurrent arcade games wiring (space-invaders & bomberman)', () => {
  it('wires space-invaders runtime invariants correctly', () => {
    const room = new LiveRoom({
      id: 'si-room',
      code: 'SI1234',
      gameId: 'space-invaders',
      config: { tickMs: 60, startWave: 1, assist: false },
      timeLimitSec: 0,
      status: 'lobby',
      startedAt: null,
      endsAt: null,
    });
    room.players = [makePlayer('p1', { seat: 0, isHost: true }), makePlayer('p2', { seat: 1, isBot: true })];
    room.gameState = room.engine().setup(['p1', 'p2'], 42, room.config);
    room.status = 'running';

    expect(room.actorToAct()).toBeNull();
    expect(room.engine().id).toBe('space-invaders');
    const score = room.scoreInputFor(room.players[0]!);
    expect(score.assetValue).toBeDefined();

    // Watchdog
    vi.useFakeTimers();
    try {
      const applySpy = vi.spyOn(room, 'applyGameAction').mockReturnValue({ accepted: true });
      room.armArcadeTickWatchdog();
      vi.advanceTimersByTime(1100);
      expect(applySpy).toHaveBeenCalledWith('p1', { type: 'tick' });
    } finally {
      clearInterval(internals(room).arcadeTickTimer);
      vi.useRealTimers();
    }
  });

  it('wires bomberman runtime invariants correctly', () => {
    const room = new LiveRoom({
      id: 'bm-room',
      code: 'BM1234',
      gameId: 'bomberman',
      config: { tickMs: 60, softDensity: 65 },
      timeLimitSec: 0,
      status: 'lobby',
      startedAt: null,
      endsAt: null,
    });
    room.players = [makePlayer('p1', { seat: 0, isHost: true }), makePlayer('p2', { seat: 1, isBot: true })];
    room.gameState = room.engine().setup(['p1', 'p2'], 42, room.config);
    room.status = 'running';

    expect(room.actorToAct()).toBeNull();
    expect(room.engine().id).toBe('bomberman');
    const score = room.scoreInputFor(room.players[0]!);
    expect(score.assetValue).toBeDefined();

    // Watchdog
    vi.useFakeTimers();
    try {
      const applySpy = vi.spyOn(room, 'applyGameAction').mockReturnValue({ accepted: true });
      room.armArcadeTickWatchdog();
      vi.advanceTimersByTime(1100);
      expect(applySpy).toHaveBeenCalledWith('p1', { type: 'tick' });
    } finally {
      clearInterval(internals(room).arcadeTickTimer);
      vi.useRealTimers();
    }
  });

  it('schedules concurrent bots for space-invaders and bomberman without error', () => {
    vi.useFakeTimers();
    try {
      const room = new LiveRoom({
        id: 'si-bots',
        code: 'SIBOTS',
        gameId: 'space-invaders',
        config: { tickMs: 60, startWave: 1, assist: false },
        timeLimitSec: 0,
        status: 'lobby',
        startedAt: null,
        endsAt: null,
      });
      room.players = [makePlayer('b1', { seat: 0, isBot: true })];
      room.gameState = room.engine().setup(['b1'], 42, room.config);
      room.status = 'running';

      const applySpy = vi.spyOn(room, 'applyGameAction').mockReturnValue({ accepted: true });
      scheduleBots(room);
      vi.advanceTimersByTime(2000);
      expect(applySpy).toHaveBeenCalledWith('b1', expect.anything());
    } finally {
      stopBots('si-bots');
      vi.useRealTimers();
    }

    vi.useFakeTimers();
    try {
      const room = new LiveRoom({
        id: 'bm-bots',
        code: 'BMBOTS',
        gameId: 'bomberman',
        config: { tickMs: 60, softDensity: 65 },
        timeLimitSec: 0,
        status: 'lobby',
        startedAt: null,
        endsAt: null,
      });
      room.players = [makePlayer('b1', { seat: 0, isBot: true })];
      room.gameState = room.engine().setup(['b1'], 42, room.config);
      room.status = 'running';

      const applySpy = vi.spyOn(room, 'applyGameAction').mockReturnValue({ accepted: true });
      scheduleBots(room);
      vi.advanceTimersByTime(2000);
      expect(applySpy).toHaveBeenCalledWith('b1', expect.anything());
    } finally {
      stopBots('bm-bots');
      vi.useRealTimers();
    }
  });
  it('advances bot pac position in a bot-only pacman room', () => {
    vi.useFakeTimers();
    try {
      const room = new LiveRoom({
        id: 'pac-bots',
        code: 'PACBOT',
        gameId: 'pacman',
        config: { turnTimeLimitSec: 90, startLevel: 1 },
        timeLimitSec: 0,
        status: 'lobby',
        startedAt: null,
        endsAt: null,
      });
      room.players = [makePlayer('b1', { seat: 0, isBot: true })];
      room.gameState = room.engine().setup(['b1'], 42, room.config);
      room.status = 'running';

      const initialPos = { ...(room.gameState as any).players[0].pacPos };
      expect(initialPos).toEqual({ x: 14, y: 23 });

      scheduleBots(room);
      vi.advanceTimersByTime(2000);

      const updatedPos = (room.gameState as any).players[0].pacPos;
      expect(updatedPos.x).not.toBe(initialPos.x);
    } finally {
      stopBots('pac-bots');
      vi.useRealTimers();
    }
  });

  it('advances remaining bot actor movement after human is gameOver', () => {
    vi.useFakeTimers();
    try {
      const room = new LiveRoom({
        id: 'pac-human-bot',
        code: 'PACHB',
        gameId: 'pacman',
        config: { turnTimeLimitSec: 90, startLevel: 1 },
        timeLimitSec: 0,
        status: 'lobby',
        startedAt: null,
        endsAt: null,
      });
      room.players = [
        makePlayer('h1', { seat: 0, isBot: false }),
        makePlayer('b1', { seat: 1, isBot: true }),
      ];
      room.gameState = room.engine().setup(['h1', 'b1'], 42, room.config);
      room.status = 'running';

      (room.gameState as any).players[0].gameOver = true;

      const initialBotPos = { ...(room.gameState as any).players[1].pacPos };
      expect(initialBotPos).toEqual({ x: 14, y: 23 });

      scheduleBots(room);
      vi.advanceTimersByTime(2000);

      const updatedBotPos = (room.gameState as any).players[1].pacPos;
      expect(updatedBotPos.x).not.toBe(initialBotPos.x);
    } finally {
      stopBots('pac-human-bot');
      vi.useRealTimers();
    }
  });
});
describe('chess/xiangqi host pause clock freezing (Fix A)', () => {
  it('freezes active clock during pause: 10s actual thinking + 60s paused results in exactly 10s consumed after resume', () => {
    vi.useFakeTimers();
    try {
      const room = new LiveRoom({
        id: 'chess-pause',
        code: 'CHESS1',
        gameId: 'chess',
        config: { clockMinutes: 10, incrementSec: 0 },
        timeLimitSec: 0,
        status: 'lobby',
        startedAt: null,
        endsAt: null,
      });
      room.players = [makePlayer('p1', { seat: 0, isHost: true }), makePlayer('p2', { seat: 1 })];
      room.gameState = room.engine().setup(['p1', 'p2'], 1, room.config);
      room.clocks = new Map([
        ['p1', 600_000],
        ['p2', 600_000],
      ]);
      room.status = 'running';

      // Turn starts for p1
      room.armTurnTimer();
      expect(room.clockActor).toBe('p1');

      // 10s of actual thinking
      vi.advanceTimersByTime(10_000);

      // Host pauses game
      room.pause();
      expect(room.paused).toBe(true);

      // While paused, elapsed pre-pause time was debited from bank, clockSince is neutralized
      expect(room.clocks.get('p1')).toBe(590_000);

      // 60s passes while paused
      vi.advanceTimersByTime(60_000);

      // Host resumes game
      room.resume();
      expect(room.paused).toBe(false);

      // Immediately after resume, exactly 10s has been consumed (600s - 590s = 10s)
      expect(room.clocks.get('p1')).toBe(590_000);

      // If p1 continues thinking for another 5s, only that 5s is added to the 10s
      vi.advanceTimersByTime(5_000);
      const res = room.applyGameAction('p1', { type: 'move', from: 12, to: 28 }); // e2 to e4
      expect(res.accepted).toBe(true);
      expect(room.clocks.get('p1')).toBe(585_000); // 600k - 10k - 5k
    } finally {
      vi.useRealTimers();
    }
  });

  it('freezes xiangqi clock during pause and does not debit pause duration', () => {
    vi.useFakeTimers();
    try {
      const room = new LiveRoom({
        id: 'xiangqi-pause',
        code: 'XIANG1',
        gameId: 'xiangqi',
        config: { clockMinutes: 5, incrementSec: 2 },
        timeLimitSec: 0,
        status: 'lobby',
        startedAt: null,
        endsAt: null,
      });
      room.players = [makePlayer('r1', { seat: 0, isHost: true }), makePlayer('b1', { seat: 1 })];
      room.gameState = room.engine().setup(['r1', 'b1'], 1, room.config);
      room.clocks = new Map([
        ['r1', 300_000],
        ['b1', 300_000],
      ]);
      room.status = 'running';

      room.armTurnTimer();
      expect(room.clockActor).toBe('r1');

      vi.advanceTimersByTime(10_000);
      room.pause();
      expect(room.clocks.get('r1')).toBe(290_000);

      vi.advanceTimersByTime(60_000);
      room.resume();
      expect(room.clocks.get('r1')).toBe(290_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('xiangqi actor routing (Fix F)', () => {
  it('correctly routes actorToAct for xiangqi to xiangqiRules.actorToAct', () => {
    const room = new LiveRoom({
      id: 'xq-actor',
      code: 'XQACT',
      gameId: 'xiangqi',
      config: { clockMinutes: 10 },
      timeLimitSec: 0,
      status: 'lobby',
      startedAt: null,
      endsAt: null,
    });
    room.players = [makePlayer('red', { seat: 0 }), makePlayer('black', { seat: 1 })];
    room.gameState = room.engine().setup(['red', 'black'], 1, room.config);
    room.status = 'running';

    // In Xiangqi, Red (player 0) moves first
    expect(room.actorToAct()).toBe('red');
  });
});

describe('persistent/replayable board-game seed (Fix B)', () => {
  it('replays a randomized board game before first snapshot and matches original state', () => {
    const originalSeed = 987654321;
    const room = new LiveRoom({
      id: 'scrabble-seed-room',
      code: 'SCRAB1',
      gameId: 'scrabble',
      config: { turnTimeLimitSec: 60 },
      timeLimitSec: 0,
      seed: originalSeed,
      status: 'running',
      startedAt: new Date(1000),
      endsAt: null,
    });
    room.players = [makePlayer('p1', { seat: 0 }), makePlayer('p2', { seat: 1 })];
    // Setup using exact seed
    room.gameState = room.engine().setup(['p1', 'p2'], room.seed!, room.config);

    // Initial state with originalSeed is deterministic
    const originalInitialState = structuredClone(room.gameState);

    // Compare with default seed 1 to prove seed matters
    const seed1State = room.engine().setup(['p1', 'p2'], 1, room.config);
    expect(originalInitialState).not.toEqual(seed1State);

    // Apply a few moves before any snapshot (seq < 50)
    const actor1 = room.actorToAct()!;
    const passAction = { type: 'pass' };
    const r1 = room.applyGameAction(actor1, passAction);
    expect(r1.accepted).toBe(true);

    const actor2 = room.actorToAct()!;
    const r2 = room.applyGameAction(actor2, passAction);
    expect(r2.accepted).toBe(true);

    const liveStateAfterMoves = structuredClone(room.gameState);

    // Simulate recovery before first snapshot (fromSeq = 0):
    // Must use room.seed, not default seed 1
    const recoveredRoom = new LiveRoom({
      id: 'scrabble-seed-room',
      code: 'SCRAB1',
      gameId: 'scrabble',
      config: { turnTimeLimitSec: 60 },
      timeLimitSec: 0,
      seed: originalSeed,
      status: 'running',
      startedAt: new Date(1000),
      endsAt: null,
    });
    recoveredRoom.players = [makePlayer('p1', { seat: 0 }), makePlayer('p2', { seat: 1 })];
    const active = recoveredRoom.players.filter((p) => !p.left);
    recoveredRoom.gameState = recoveredRoom.engine().setup(
      active.map((p) => p.id),
      Number(recoveredRoom.seed ?? 1),
      recoveredRoom.config,
    );
    expect(recoveredRoom.gameState).toEqual(originalInitialState);

    // Replay the recorded events:
    const events = [
      { seq: 1, actorPlayerId: actor1, action: passAction },
      { seq: 2, actorPlayerId: actor2, action: passAction },
    ];
    for (const ev of events) {
      const r = recoveredRoom.engine().reduce(recoveredRoom.gameState as never, ev.actorPlayerId, ev.action as never);
      expect(r.ok).toBe(true);
      recoveredRoom.gameState = r.state;
    }

    // Recovered state must strictly match original state
    expect(recoveredRoom.gameState).toEqual(liveStateAfterMoves);
  });
});

describe('word search recovery (Fix C)', () => {
  it('recovered player state retains found words after replaying commit events', async () => {
    const puzzle = await generatePuzzle('word-search', 42, { theme: 'animals' });
    const room = new LiveRoom({
      id: 'ws-room',
      code: 'WORDS1',
      gameId: 'word-search',
      config: { theme: 'animals' },
      timeLimitSec: 300,
      status: 'running',
      startedAt: new Date(),
      endsAt: null,
    });
    room.puzzle = puzzle;
    room.players = [makePlayer('p1', { seat: 0 })];
    const p1 = room.players[0]!;
    p1.state = structuredClone(puzzle.initialState);

    // Find the first word in puzzle solution
    const sol = puzzle.solution as { placements: Array<{ word: string; x: number; y: number; dx: number; dy: number }> };
    expect(sol.placements.length).toBeGreaterThan(0);
    const targetWord = sol.placements[0]!;
    const x1 = targetWord.x;
    const y1 = targetWord.y;
    const x2 = targetWord.x + targetWord.dx * (targetWord.word.length - 1);
    const y2 = targetWord.y + targetWord.dy * (targetWord.word.length - 1);
    const path = `${y1},${x1},${y2},${x2}`;

    // Live commit
    const ack = room.commit('p1', path, null);
    expect(ack.accepted).toBe(true);
    expect(ack.foundWord).toBe(targetWord.word);
    expect((p1.state as any).found).toContain(targetWord.word);
    const liveProgress = ack.progress;
    expect(liveProgress).toBeGreaterThan(0);

    // Now simulate recovery: blank initial state + replay commit event
    const recoveredRoom = new LiveRoom({
      id: 'ws-room',
      code: 'WORDS1',
      gameId: 'word-search',
      config: { theme: 'animals' },
      timeLimitSec: 300,
      status: 'running',
      startedAt: new Date(),
      endsAt: null,
    });
    recoveredRoom.puzzle = puzzle;
    recoveredRoom.players = [makePlayer('p1', { seat: 0 })];
    const recP1 = recoveredRoom.players[0]!;
    recP1.state = structuredClone(puzzle.initialState);

    // Replay commit event
    recoveredRoom.replayCommit('p1', { path, value: null });

    // Assert that recovered player state retains the found word and selections
    expect((recP1.state as any).found).toContain(targetWord.word);
    expect((recP1.state as any).selections).toBe(1);

    // Grade puzzle on recovered state
    const grade = gradePuzzle(recoveredRoom.gameId, recP1.state, recoveredRoom.puzzle.puzzle, recoveredRoom.puzzle.solution);
    expect(grade.progress).toBe(liveProgress);

    // Verify snapshotFor does not expose hidden solution while running
    const snap = recoveredRoom.snapshotFor('p1');
    expect(snap.state).toBeDefined();
    expect((snap.state as any).solution).toBeNull();
    expect((snap.state as any).board.found).toContain(targetWord.word);
  });
});

describe('chess-clock increment recovery (Fix E)', () => {
  it('correctly accumulates increment after rehydrate/replay for accepted moves only', () => {
    const p1 = 'white-player';
    const p2 = 'black-player';
    const players = [
      { id: p1, isBot: false },
      { id: p2, isBot: false },
    ];
    const config = { clockMinutes: 5, incrementSec: 3 }; // 300,000 ms bank, 3,000 ms increment
    const startedAt = new Date(1_000_000);

    // Scenario:
    // Started at 1,000,000.
    // 1. Move 1 by p1 at 1,010,000 (spent 10s thinking). Action: move.
    //    p1: 300,000 - 10,000 + 3,000 = 293,000 ms.
    // 2. Move 2 by p2 at 1,015,000 (spent 5s thinking). Action: move.
    //    p2: 300,000 - 5,000 + 3,000 = 298,000 ms.
    // 3. Move 3 by p1 at 1,020,000 (spent 5s thinking). Action: move.
    //    p1: 293,000 - 5,000 + 3,000 = 291,000 ms.
    // 4. Offer draw by p2 at 1,022,000 (spent 2s). Action: offer_draw (NOT a move!).
    //    p2: 298,000 - 2,000 = 296,000 ms (NO increment!).
    // 5. Current time is 1,025,000. Next actor is p1 (who has been thinking 3s since 1,022,000).
    //    p1: 291,000 - 3,000 = 288,000 ms.
    const events = [
      { actorPlayerId: p1, action: { type: 'move', from: 12, to: 28 }, at: new Date(1_010_000) },
      { actorPlayerId: p2, action: { type: 'move', from: 52, to: 36 }, at: new Date(1_015_000) },
      { actorPlayerId: p1, action: { type: 'move', from: 28, to: 36 }, at: new Date(1_020_000) },
      { actorPlayerId: p2, action: { type: 'offer_draw' }, at: new Date(1_022_000) },
    ];

    const clocks = rehydrateChessClocks(
      config,
      players,
      startedAt,
      events,
      p1,
      1_025_000,
    );

    expect(clocks.get(p1)).toBe(288_000);
    expect(clocks.get(p2)).toBe(296_000);
  });

  it('does not grant increment for resign or forfeit events during live play or replay', () => {
    const room = new LiveRoom({
      id: 'chess-inc',
      code: 'CHINC1',
      gameId: 'chess',
      config: { clockMinutes: 5, incrementSec: 5 },
      timeLimitSec: 0,
      status: 'lobby',
      startedAt: null,
      endsAt: null,
    });
    room.players = [makePlayer('p1'), makePlayer('p2')];
    room.gameState = room.engine().setup(['p1', 'p2'], 1, room.config);
    room.clocks = new Map([
      ['p1', 300_000],
      ['p2', 300_000],
    ]);
    room.status = 'running';

    room.armTurnTimer();
    // Resign action should NOT receive increment
    const res = room.applyGameAction('p1', { type: 'resign' });
    expect(res.accepted).toBe(true);
    // p1 bank should not exceed 300,000
    expect(room.clocks.get('p1')!).toBeLessThanOrEqual(300_000);

    // Replay with resign event
    const events = [
      { actorPlayerId: 'p1', action: { type: 'resign' }, at: new Date(Date.now() + 5000) },
    ];
    const rehydrated = rehydrateChessClocks(
      room.config as any,
      room.players,
      new Date(),
      events,
      null,
    );
    // Bank had 5s deducted and 0s increment added
    expect(rehydrated.get('p1')).toBe(295_000);
  });
});

describe('seat reuse after kick/leave (Fix D)', () => {
  it('nextFreeSeat reuses the seat of a player who has left', () => {
    const room = new LiveRoom({
      id: 'seat-reuse',
      code: 'SEAT12',
      gameId: 'connect4',
      config: {},
      timeLimitSec: 0,
      status: 'lobby',
      startedAt: null,
      endsAt: null,
    });
    const p1 = makePlayer('p1', { seat: 0, isHost: true });
    const p2 = makePlayer('p2', { seat: 1, isHost: false });
    room.players = [p1, p2];

    expect(nextFreeSeat(room)).toBe(2);

    // p2 is kicked / leaves
    p2.left = true;
    expect(nextFreeSeat(room)).toBe(1);

    // p1 leaves, p2 rejoins on seat 1
    p1.left = true;
    p2.left = false;
    expect(nextFreeSeat(room)).toBe(0);
  });

  it('defines room_players partial unique index where left_at is null in schema', () => {
    // Verify Drizzle schema definitions for roomPlayers
    const { indexes } = getTableConfig(roomPlayers);
    expect(indexes).toBeDefined();
    const seatIdx = indexes.find((idx) => idx.config.name === 'room_players_seat');
    expect(seatIdx).toBeDefined();
    expect(seatIdx!.config.unique).toBe(true);
    expect(seatIdx!.config.where).toBeDefined();
  });
});
