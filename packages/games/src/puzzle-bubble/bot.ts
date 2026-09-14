import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import { findDetached, matchingCluster, resolveLanding, scoreShot, slotKey, traceShot } from './rules.js';

export interface PuzzleBubbleBotView {
  you: {
    board: { row: number; col: number; color: string }[];
    rowParity: 0 | 1;
    current: string;
    next: string;
    gameOver: boolean;
  } | null;
  players: unknown[];
  config: unknown;
}

export type PuzzleBubbleBotAction = { type: 'shoot'; angleDeg: number };

type BotCell = { row: number; col: number; color: string };
/** rules.ts is generic over the colour string; the bot never learns the colour union. */
type RulesBoard = Parameters<typeof traceShot>[0];

const MAX_ANGLE = 80;
const LOOKAHEAD_CANDIDATES = 6;
const LOOKAHEAD_STEP = 6;
const LOOKAHEAD_WEIGHT = 0.6;

function clampAngle(angle: number): number {
  return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));
}

function angleGrid(step: number): number[] {
  const angles: number[] = [];
  for (let angle = -MAX_ANGLE; angle <= MAX_ANGLE; angle += step) angles.push(angle);
  return angles;
}

type Outcome = {
  angle: number;
  board: BotCell[];
  gained: number;
  dropped: number;
  /** How far the stack now reaches towards the danger row. */
  height: number;
};

/** Replays the engine's shot resolution on the visible board only. */
function simulate(board: BotCell[], rowParity: 0 | 1, angle: number, color: string): Outcome | null {
  const trace = traceShot(board as RulesBoard, rowParity, angle);
  const landing = resolveLanding(board as RulesBoard, rowParity, trace);
  if (!landing) return null;
  let next: BotCell[] = [...board, { ...landing, color }];
  let popped = 0;
  let dropped = 0;
  const cluster = matchingCluster(next as RulesBoard, landing, rowParity);
  if (cluster.length >= 3) {
    const removed = new Set(cluster.map(slotKey));
    next = next.filter((cell) => !removed.has(slotKey(cell)));
    popped = cluster.length;
    const detached = findDetached(next as RulesBoard, rowParity);
    if (detached.length > 0) {
      const gone = new Set(detached.map(slotKey));
      next = next.filter((cell) => !gone.has(slotKey(cell)));
      dropped = detached.length;
    }
  }
  const height = next.reduce((max, cell) => Math.max(max, cell.row), 0);
  return { angle, board: next, gained: scoreShot(popped, dropped), dropped, height };
}

function outcomes(board: BotCell[], rowParity: 0 | 1, color: string, step: number): Outcome[] {
  const found: Outcome[] = [];
  for (const angle of angleGrid(step)) {
    const outcome = simulate(board, rowParity, angle, color);
    if (outcome) found.push(outcome);
  }
  return found;
}

/** Points won, a bonus for detaching hanging clusters, and a stack-height penalty. */
function immediateValue(outcome: Outcome, dropBonus: number, heightWeight: number): number {
  return outcome.gained + dropBonus * outcome.dropped - heightWeight * outcome.height;
}

function pickBest(candidates: Array<{ angle: number; value: number }>): number {
  let best = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.value > bestValue) {
      bestValue = candidate.value;
      best = candidate.angle;
    }
  }
  return best;
}

export const puzzleBubbleBot: BotPolicy<PuzzleBubbleBotView, PuzzleBubbleBotAction> = {
  chooseAction(view, _selfId, rng: Rng, difficulty: BotDifficulty) {
    const you = view.you;
    if (!you || you.gameOver) return { type: 'shoot', angleDeg: 0 };

    if (difficulty === 'easy') {
      // Coarse sampling plus seeded aim error: plausible shots, frequent misses.
      const coarse = outcomes(you.board, you.rowParity, you.current, 16);
      const aim = pickBest(coarse.map((outcome) => ({ angle: outcome.angle, value: immediateValue(outcome, 10, 8) })));
      return { type: 'shoot', angleDeg: clampAngle(aim + rng.int(25) - 12) };
    }

    if (difficulty === 'normal') {
      const found = outcomes(you.board, you.rowParity, you.current, 4);
      return { type: 'shoot', angleDeg: pickBest(found.map((outcome) => ({ angle: outcome.angle, value: outcome.gained - outcome.height }))) };
    }

    // Hard: every two degrees, weighted towards detaching whole hanging clusters,
    // with one-bubble lookahead using the visible next colour.
    const found = outcomes(you.board, you.rowParity, you.current, 2);
    const ranked = found
      .map((outcome) => ({ outcome, value: immediateValue(outcome, 30, 2) }))
      .sort((a, b) => b.value - a.value);
    const scored = ranked.map(({ outcome, value }, index) => {
      if (index >= LOOKAHEAD_CANDIDATES) return { angle: outcome.angle, value };
      const follow = outcomes(outcome.board, you.rowParity, you.next, LOOKAHEAD_STEP);
      const best = follow.reduce((max, candidate) => Math.max(max, immediateValue(candidate, 30, 2)), Number.NEGATIVE_INFINITY);
      return { angle: outcome.angle, value: value + (Number.isFinite(best) ? LOOKAHEAD_WEIGHT * best : 0) };
    });
    return { type: 'shoot', angleDeg: pickBest(scored) };
  },
};
