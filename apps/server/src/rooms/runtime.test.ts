import { describe, expect, it, vi } from 'vitest';
import { LiveRoom, type LivePlayer } from './runtime.js';

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
