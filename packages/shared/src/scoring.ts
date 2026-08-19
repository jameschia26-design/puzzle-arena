/**
 * Single definition of the scoring model. Every game — puzzle, board, bot or
 * human — feeds this exact function, so results are comparable across rooms.
 * These constants are deliberately NOT host-configurable.
 */

export interface ScoreInput {
  progress: number; // 0..1, monotonic fraction of the goal reached
  accuracy: number; // 0..1
  completed: boolean;
  completedAtMs: number | null; // ms from room start; null unless completed
  penalties: number; // hints, illegal-move strikes, turn timeouts
  /**
   * Board-game-only escape hatch. Property Tycoon's result is total asset
   * value (cash + property + buildings), not a progress/accuracy/speed
   * blend, so it does not go through `computeScore` at all — see
   * `packages/games/src/property-tycoon/rules.ts` (`assetValue`) and
   * `runtime.ts#finish()`, which uses this field directly as the leaderboard
   * score instead of calling `computeScore`. Absent (undefined) for every
   * other game; `computeScore` itself never reads it.
   */
  assetValue?: number;
}

export const SCORE_WEIGHTS = { progress: 0.55, accuracy: 0.2, speed: 0.25 } as const;
export const PENALTY_POINTS = 15;

export function computeScore(i: ScoreInput, timeLimitMs: number): number {
  const speed =
    i.completed && i.completedAtMs !== null
      ? Math.max(0, (timeLimitMs - i.completedAtMs) / timeLimitMs)
      : 0;
  const raw =
    1000 *
      (SCORE_WEIGHTS.progress * i.progress +
        SCORE_WEIGHTS.accuracy * i.accuracy +
        SCORE_WEIGHTS.speed * speed) -
    PENALTY_POINTS * i.penalties;
  return Math.max(0, Math.min(1000, Math.round(raw)));
}

export interface RankableResult {
  playerId: string;
  score: number;
  completedAtMs: number | null;
  penalties: number;
  seat: number;
}

/** score desc -> completedAtMs asc (nulls last) -> penalties asc -> seat asc */
export function rankResults<T extends RankableResult>(results: T[]): (T & { rank: number })[] {
  const sorted = [...results].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const at = a.completedAtMs ?? Number.POSITIVE_INFINITY;
    const bt = b.completedAtMs ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    if (a.penalties !== b.penalties) return a.penalties - b.penalties;
    return a.seat - b.seat;
  });
  return sorted.map((r, idx) => ({ ...r, rank: idx + 1 }));
}

/** Speed component, exposed for the results table. */
export function speedComponent(i: ScoreInput, timeLimitMs: number): number {
  return i.completed && i.completedAtMs !== null
    ? Math.max(0, (timeLimitMs - i.completedAtMs) / timeLimitMs)
    : 0;
}
