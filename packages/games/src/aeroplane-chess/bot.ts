import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';

/**
 * Self-contained, like every other game's bot.ts — see checkers/bot.ts for
 * why this reimplements rather than imports from ./state.js or ./rules.js.
 */

const RING_SIZE = 52;
const LAST_RING_REL = 50;
const HOME_STEP = 57;
const SAFE_SQUARES = new Set([0, 13, 26, 39]);
const FLY_MAP: Record<number, number> = { 4: 16, 17: 29, 30: 42, 43: 3 };

interface BotToken {
  steps: number;
}

export interface AeroplaneChessBotPublicPlayer {
  id: string;
  seat: number;
  quadrant: number;
  tokens: [BotToken, BotToken, BotToken, BotToken];
}

export interface AeroplaneChessBotView {
  players: AeroplaneChessBotPublicPlayer[];
  current: string | null;
  phase: 'awaiting_roll' | 'awaiting_move' | 'game_over';
  dice: number | null;
  you: {
    id: string;
    quadrant: number;
    legalTokens: number[];
  } | null;
}

function entrySquare(quadrant: number): number {
  return quadrant * 13;
}

function absoluteSquare(quadrant: number, relSteps: number): number {
  return (entrySquare(quadrant) + relSteps) % RING_SIZE;
}

function relativeFromAbsolute(quadrant: number, abs: number): number {
  return ((abs - entrySquare(quadrant)) % RING_SIZE + RING_SIZE) % RING_SIZE;
}

interface SimResult {
  newSteps: number;
  released: boolean;
  flew: boolean;
  reachedHome: boolean;
  captures: number;
  landsOnSafe: boolean;
}

/** Pure preview of what moving one token would do, without mutating the view. */
function simulateMove(
  view: AeroplaneChessBotView,
  quadrant: number,
  token: BotToken,
  diceValue: number,
): SimResult {
  const from = token.steps;
  let steps = from === -1 ? 0 : from + diceValue;
  const released = from === -1;

  let flew = false;
  if (steps >= 0 && steps <= LAST_RING_REL) {
    const abs = absoluteSquare(quadrant, steps);
    const dest = FLY_MAP[abs];
    if (dest !== undefined) {
      steps = relativeFromAbsolute(quadrant, dest);
      flew = true;
    }
  }

  let captures = 0;
  let landsOnSafe = false;
  if (steps >= 0 && steps <= LAST_RING_REL) {
    const abs = absoluteSquare(quadrant, steps);
    landsOnSafe = SAFE_SQUARES.has(abs);
    if (!landsOnSafe) {
      for (const other of view.players) {
        if (other.quadrant === quadrant) continue;
        for (const ot of other.tokens) {
          if (ot.steps >= 0 && ot.steps <= LAST_RING_REL && absoluteSquare(other.quadrant, ot.steps) === abs) {
            captures++;
          }
        }
      }
    }
  }

  return { newSteps: steps, released, flew, reachedHome: steps === HOME_STEP, captures, landsOnSafe };
}

/** True when the token, after landing, sits where an opponent's very next
 *  roll (1-6) could capture it back — a rough one-ply vulnerability check. */
function isExposed(view: AeroplaneChessBotView, quadrant: number, steps: number): boolean {
  if (steps < 0 || steps > LAST_RING_REL) return false;
  const abs = absoluteSquare(quadrant, steps);
  if (SAFE_SQUARES.has(abs)) return false;
  for (const other of view.players) {
    if (other.quadrant === quadrant) continue;
    for (const ot of other.tokens) {
      if (ot.steps < 0 || ot.steps > LAST_RING_REL) continue;
      for (let r = 1; r <= 6; r++) {
        if (ot.steps + r > LAST_RING_REL) continue;
        if (absoluteSquare(other.quadrant, ot.steps + r) === abs) return true;
      }
    }
  }
  return false;
}

function scoreMove(
  view: AeroplaneChessBotView,
  quadrant: number,
  tokenIndex: number,
  diceValue: number,
  difficulty: BotDifficulty,
): number {
  const me = view.players.find((p) => p.quadrant === quadrant);
  const token = me?.tokens[tokenIndex];
  if (!token) return -Infinity;
  const sim = simulateMove(view, quadrant, token, diceValue);

  let score = 0;
  score += sim.captures * 50;
  if (sim.reachedHome) score += 100;
  score += sim.newSteps; // general progress
  if (sim.released) score += 10;
  if (difficulty !== 'easy') {
    if (sim.flew) score += 20;
    if (sim.landsOnSafe) score += 8;
    if (isExposed(view, quadrant, sim.newSteps)) score -= difficulty === 'hard' ? 25 : 12;
  }
  if (difficulty === 'hard') {
    // Races a token that's already close to home rather than spreading
    // progress evenly — a real strategic push normal bots don't make.
    if (sim.newSteps >= 45 && sim.newSteps <= HOME_STEP) score += (sim.newSteps - 44) * 2;
  }
  return score;
}

export const aeroplaneChessBot: BotPolicy<
  AeroplaneChessBotView,
  { type: 'roll' } | { type: 'movePlane'; tokenIndex: number }
> = {
  chooseAction(view, selfId, rng: Rng, difficulty: BotDifficulty) {
    if (view.phase !== 'awaiting_move') return { type: 'roll' };

    const quadrant = view.you?.quadrant ?? view.players.find((p) => p.id === selfId)?.quadrant ?? 0;
    const legal = view.you?.legalTokens ?? [];
    if (legal.length === 0) return { type: 'roll' };

    if (difficulty === 'easy' && rng.next() < 0.5) {
      return { type: 'movePlane', tokenIndex: rng.pick(legal) };
    }

    const dice = view.dice ?? 1;
    let best = legal[0] as number;
    let bestScore = -Infinity;
    for (const idx of legal) {
      const s = scoreMove(view, quadrant, idx, dice, difficulty) + rng.next() * 0.01;
      if (s > bestScore) {
        bestScore = s;
        best = idx;
      }
    }
    return { type: 'movePlane', tokenIndex: best };
  },
};
