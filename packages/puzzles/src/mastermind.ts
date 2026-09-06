import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import type { PuzzleMeta } from './sudoku.js';

export interface MastermindPuzzle {
  colors: number;
  slots: number;
  maxTries: number;
}

export interface MastermindSolution {
  code: number[];
}

export interface MastermindGuess {
  code: number[];
  exact: number;
  color: number;
}

export interface MastermindPlayerState {
  guesses: MastermindGuess[];
  solved: boolean;
  exhausted: boolean;
}

export interface MastermindGrade {
  progress: number;
  accuracy: number;
  filledFraction: number;
  complete: boolean;
  terminal: boolean;
  assetValue: number;
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Evaluates a guess against a secret code.
 * 1. Count and exclude exact-position matches.
 * 2. Frequency-count colors in the unmatched positions.
 * 3. Sum min(secretCount[color], guessCount[color]) for color-only matches.
 * Guarantees exact + color <= slots even with duplicates.
 */
export function evaluateGuess(
  guess: number[],
  secret: number[],
): { exact: number; color: number } {
  const slots = Math.min(guess.length, secret.length);
  let exact = 0;
  const secretCounts = new Map<number, number>();
  const guessCounts = new Map<number, number>();

  for (let i = 0; i < slots; i++) {
    const g = guess[i]!;
    const s = secret[i]!;
    if (g === s) {
      exact++;
    } else {
      secretCounts.set(s, (secretCounts.get(s) ?? 0) + 1);
      guessCounts.set(g, (guessCounts.get(g) ?? 0) + 1);
    }
  }

  let color = 0;
  for (const [col, gCount] of guessCounts.entries()) {
    const sCount = secretCounts.get(col) ?? 0;
    color += Math.min(sCount, gCount);
  }

  return { exact, color };
}

/* ------------------------------------------------------------------ */
/* Generator                                                          */
/* ------------------------------------------------------------------ */

export function generate(opts: {
  seed?: number;
  colors?: number;
  slots?: number;
  maxTries?: number;
}): { puzzle: MastermindPuzzle; solution: MastermindSolution; meta: PuzzleMeta } {
  const t0 = Date.now();
  const seed = opts.seed ?? 42;
  const colors = opts.colors ?? 8;
  const slots = opts.slots ?? 4;
  const maxTries = opts.maxTries ?? 10;

  if (
    !Number.isInteger(colors) ||
    colors < 7 ||
    colors > 12 ||
    !Number.isInteger(slots) ||
    slots < 4 ||
    slots > 8 ||
    !Number.isInteger(maxTries) ||
    maxTries < 6 ||
    maxTries > 30
  ) {
    throw new Error(
      `Invalid Mastermind config: colors=${colors} (7-12), slots=${slots} (4-8), maxTries=${maxTries} (6-30)`,
    );
  }

  const rng = mulberry32(seed);
  const code: number[] = [];
  for (let i = 0; i < slots; i++) {
    code.push(rng.int(colors));
  }

  return {
    puzzle: { colors, slots, maxTries },
    solution: { code },
    meta: {
      actualDifficulty: 'medium',
      generationMs: Date.now() - t0,
      seed,
    },
  };
}

/* ------------------------------------------------------------------ */
/* State Transitions                                                  */
/* ------------------------------------------------------------------ */

export function applyGuess(
  puzzle: MastermindPuzzle,
  solution: MastermindSolution,
  state: MastermindPlayerState,
  code: number[],
): MastermindPlayerState | null {
  if (state.solved || state.exhausted) return null;
  if (state.guesses.length >= puzzle.maxTries) return null;

  if (!Array.isArray(code) || code.length !== puzzle.slots) return null;
  for (let i = 0; i < code.length; i++) {
    const val = code[i];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val >= puzzle.colors) {
      return null;
    }
  }

  const { exact, color } = evaluateGuess(code, solution.code);
  const nextGuesses = [...state.guesses, { code: [...code], exact, color }];
  const solved = exact === puzzle.slots;
  const exhausted = !solved && nextGuesses.length >= puzzle.maxTries;

  return {
    guesses: nextGuesses,
    solved,
    exhausted,
  };
}

/* ------------------------------------------------------------------ */
/* Grading                                                            */
/* ------------------------------------------------------------------ */

export function grade(state: unknown, puzzle: MastermindPuzzle): MastermindGrade {
  let guesses: MastermindGuess[] = [];
  let solved = false;
  let exhausted = false;

  if (state && typeof state === 'object') {
    const ps = state as Partial<MastermindPlayerState>;
    if (Array.isArray(ps.guesses)) guesses = ps.guesses;
    if (typeof ps.solved === 'boolean') solved = ps.solved;
    if (typeof ps.exhausted === 'boolean') exhausted = ps.exhausted;
  }

  const slots = Math.max(1, puzzle.slots);
  const maxTries = Math.max(1, puzzle.maxTries);

  let bestExact = 0;
  let bestTotal = 0;
  for (const g of guesses) {
    if (g.exact > bestExact) bestExact = g.exact;
    const total = g.exact + g.color;
    if (total > bestTotal) bestTotal = total;
  }

  const complete = solved;
  const terminal = solved || exhausted;
  const progress = solved ? 1 : bestExact / slots;
  const accuracy = guesses.length > 0 ? bestTotal / slots : 0;
  const filledFraction = Math.min(1, guesses.length / maxTries);
  const assetValue = solved
    ? 10000 - (guesses.length - 1) * 300
    : Math.round((bestExact / slots) * 200);

  return {
    progress,
    accuracy,
    filledFraction,
    complete,
    terminal,
    assetValue,
  };
}

/* ------------------------------------------------------------------ */
/* Bot Simulation                                                     */
/* ------------------------------------------------------------------ */

export function generateBotGuesses(
  puzzle: MastermindPuzzle,
  solution: MastermindSolution,
  botDifficulty: BotDifficulty,
  seed: number,
): number[][] {
  const rng = mulberry32(seed);

  let targetTries: number;
  switch (botDifficulty) {
    case 'easy':
      targetTries = 7 + rng.int(3); // 7, 8, 9
      break;
    case 'normal':
      targetTries = 5 + rng.int(3); // 5, 6, 7
      break;
    case 'hard':
    default:
      targetTries = 3 + rng.int(3); // 3, 4, 5
      break;
  }

  targetTries = Math.max(1, Math.min(puzzle.maxTries, targetTries));

  if (targetTries === 1) {
    return [[...solution.code]];
  }

  const guesses: number[][] = [];
  const slots = puzzle.slots;
  const colors = puzzle.colors;

  // Intermediate guesses: 0 .. targetTries - 2
  for (let t = 0; t < targetTries - 1; t++) {
    const fraction = (t + 1) / targetTries;
    // At least 1 position must be wrong before the final attempt
    const maxCopy = slots - 1;
    const numToCopy = Math.min(maxCopy, Math.floor(fraction * slots));

    // Choose indices to copy
    const indices = Array.from({ length: slots }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const tmp = indices[i]!;
      indices[i] = indices[j]!;
      indices[j] = tmp;
    }
    const copiedIndices = new Set(indices.slice(0, numToCopy));

    const guessCode = new Array<number>(slots);
    for (let i = 0; i < slots; i++) {
      if (copiedIndices.has(i)) {
        guessCode[i] = solution.code[i]!;
      } else {
        // Guaranteed wrong color for this slot
        const secretCol = solution.code[i]!;
        guessCode[i] = (secretCol + 1 + rng.int(colors - 1)) % colors;
      }
    }
    guesses.push(guessCode);
  }

  // Final guess is always the secret
  guesses.push([...solution.code]);

  return guesses;
}
