import type { GameId, LogEntry, RngState, ScoreInput } from '@puzzle-arena/shared';

export type ReduceResult<S> =
  | { ok: true; state: S; log: LogEntry[] }
  | { ok: false; error: string };

/**
 * Every turn-based game implements exactly this. `reduce` must be pure: all
 * randomness comes from `s.rng` ({ seed, calls }) and is advanced inside the
 * returned state, which is what makes replaying `room_events` reproduce a game
 * bit-for-bit after a crash.
 *
 * NOTHING derived from the wall clock may be written into state. `Date.now()`
 * inside a reducer silently destroys replay equality — the state diverges on
 * every rerun even though the game is identical. Timing that genuinely matters
 * (when the winner finished) is stamped by the runtime, which owns the
 * authoritative clock and the recorded event timestamps.
 */
export interface GameEngine<S, A> {
  id: GameId;
  setup(playerIds: string[], seed: number, config: unknown): S;
  reduce(s: S, playerId: string, action: A): ReduceResult<S>;
  /** Played on turn-timeout or disconnect. Must always be legal. */
  autoAction(s: S, playerId: string): A;
  /** The restricted view a given player may see. `null` = spectator. */
  view(s: S, playerId: string | null): unknown;
  score(s: S, playerId: string): ScoreInput;
  isOver(s: S): { over: boolean; winner?: string };
  /** Actions the given player may legally take right now — drives the client's
   *  disabled states so the client never re-derives the rules. */
  legalActions(s: S, playerId: string): string[];
}

export interface BaseState {
  rng: RngState;
  seq: number;
  /** Monotonic counter for log entries. Logical, never a timestamp. */
  logSeq: number;
  /**
   * ms from room start at which the winner finished, stamped by the runtime
   * from the recorded event time. Null until somebody wins.
   */
  winnerAtMs: number | null;
}

/**
 * Build an unstamped log entry. `seq` and `at` are filled in by `stampLogs`
 * from state, never from the clock — see the note on GameEngine.
 */
export function makeLog(text: string, playerId: string | null = null): LogEntry {
  return { seq: -1, at: -1, text, playerId };
}

/**
 * Assign logical sequence numbers to a batch of log entries, advancing the
 * state's counter. `at` mirrors `seq` so ordering is preserved without the
 * clock; the runtime attaches wall-clock time when it broadcasts.
 */
export function stampLogs<S extends { logSeq: number }>(s: S, entries: LogEntry[]): LogEntry[] {
  return entries.map((e) => {
    const seq = s.logSeq++;
    return { ...e, seq, at: seq };
  });
}
