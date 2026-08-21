import { mulberry32, type Rng } from '@puzzle-arena/shared';
import {
  CELLS,
  DIFFICULTY_ORDER,
  type Difficulty,
  type Grid,
  bit,
  candidatesFrom,
  countSolutions,
  maskDigits,
  popcount,
  rateDifficulty,
} from './core/solver.js';

export interface SudokuPuzzle {
  /** 81 entries; 0 = blank. Givens are the non-zero entries. */
  givens: Grid;
}
export type SudokuSolution = Grid;

export interface PuzzleMeta {
  actualDifficulty: Difficulty;
  generationMs: number;
  seed: number;
}

export interface GradeResult {
  cellsTotal: number;
  cellsFilled: number;
  cellsCorrect: number;
  complete: boolean;
}

/** Randomised backtracking fill — a complete, valid solution grid. */
export function generateFullGrid(rng: Rng): Grid {
  const grid: Grid = new Array<number>(CELLS).fill(0);

  const fill = (pos: number): boolean => {
    if (pos === CELLS) return true;
    const cands = candidatesFrom(grid);
    if (!cands) return false;
    const mask = cands[pos] as number;
    if (popcount(mask) === 0) return false;
    const digits = rng.shuffle(maskDigits(mask));
    for (const d of digits) {
      grid[pos] = d;
      if (fill(pos + 1)) return true;
      grid[pos] = 0;
    }
    return false;
  };

  if (!fill(0)) throw new Error('sudoku: failed to build a full grid');
  return grid;
}

/**
 * Minimum holes per tier. Without this floor the dig stops on the very first
 * removal — one blank cell is already "tier 1 / easy", which rates correctly
 * but is not a puzzle. An easy Sudoku still has to be a Sudoku.
 */
const MIN_HOLES: Record<Difficulty, number> = {
  easy: 36,
  medium: 42,
  hard: 48,
  expert: 52,
};

/**
 * Dig holes from a full grid, restoring any removal that costs uniqueness.
 * A removal that pushes the rating above the requested tier is also reverted,
 * so an "easy" board stays solvable with singles alone while still being
 * properly hollowed out.
 */
function dig(
  solution: Grid,
  target: Difficulty,
  rng: Rng,
): { givens: Grid; difficulty: Difficulty } {
  const givens: Grid = [...solution];
  const positions = rng.shuffle(Array.from({ length: CELLS }, (_, i) => i));
  const minHoles = MIN_HOLES[target];
  let difficulty: Difficulty = 'easy';
  let holes = 0;

  for (const pos of positions) {
    const saved = givens[pos] as number;
    if (saved === 0) continue;

    givens[pos] = 0;
    if (countSolutions(givens, 2) !== 1) {
      givens[pos] = saved; // uniqueness lost — put it back
      continue;
    }

    const rating = rateDifficulty(givens);
    if (DIFFICULTY_ORDER[rating] > DIFFICULTY_ORDER[target]) {
      // Too hard for the requested tier. Revert and try a different cell —
      // another removal may keep us inside the tier.
      givens[pos] = saved;
      continue;
    }

    holes++;
    difficulty = rating;
    if (holes >= minHoles && DIFFICULTY_ORDER[difficulty] >= DIFFICULTY_ORDER[target]) break;
  }

  return { givens, difficulty };
}

export function generate(opts: { difficulty: Difficulty; seed: number }): {
  puzzle: SudokuPuzzle;
  solution: SudokuSolution;
  meta: PuzzleMeta;
} {
  const started = Date.now();
  let best: { givens: Grid; solution: Grid; difficulty: Difficulty } | null = null;

  // Retry with a fresh seed up to 20 times; keep the closest tier reached.
  for (let attempt = 0; attempt < 20; attempt++) {
    const rng = mulberry32(opts.seed + attempt * 7919);
    const solution = generateFullGrid(rng);
    const { givens, difficulty } = dig(solution, opts.difficulty, rng);

    if (
      best === null ||
      Math.abs(DIFFICULTY_ORDER[difficulty] - DIFFICULTY_ORDER[opts.difficulty]) <
        Math.abs(DIFFICULTY_ORDER[best.difficulty] - DIFFICULTY_ORDER[opts.difficulty])
    ) {
      best = { givens, solution, difficulty };
    }
    if (difficulty === opts.difficulty) break;
  }

  const chosen = best as { givens: Grid; solution: Grid; difficulty: Difficulty };
  return {
    puzzle: { givens: chosen.givens },
    solution: chosen.solution,
    meta: {
      actualDifficulty: chosen.difficulty,
      generationMs: Date.now() - started,
      seed: opts.seed,
    },
  };
}

/** Player state is the full 81-cell board including the givens. */
export function grade(playerState: unknown, solution: SudokuSolution, puzzle: SudokuPuzzle): GradeResult {
  const board = Array.isArray(playerState) ? (playerState as number[]) : [];
  let cellsTotal = 0;
  let cellsFilled = 0;
  let cellsCorrect = 0;

  for (let i = 0; i < CELLS; i++) {
    if ((puzzle.givens[i] as number) !== 0) continue; // only blank-at-start cells count
    cellsTotal++;
    const v = board[i] ?? 0;
    if (v !== 0) {
      cellsFilled++;
      if (v === solution[i]) cellsCorrect++;
    }
  }

  return { cellsTotal, cellsFilled, cellsCorrect, complete: cellsTotal > 0 && cellsCorrect === cellsTotal };
}

export interface HintResult {
  path: string;
  value: number;
}

/** Reveal one correct cell — chosen server-side, costs a penalty. */
export function hint(
  puzzle: SudokuPuzzle,
  solution: SudokuSolution,
  playerState: unknown,
  rng: Rng,
): HintResult | null {
  const board = Array.isArray(playerState) ? (playerState as number[]) : [];
  const open: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    if ((puzzle.givens[i] as number) !== 0) continue;
    if ((board[i] ?? 0) !== solution[i]) open.push(i);
  }
  if (open.length === 0) return null;
  const pick = open[rng.int(open.length)] as number;
  return { path: `${(pick / 9) | 0},${pick % 9}`, value: solution[pick] as number };
}

/** Conflicts computed from the visible board only — never from the solution. */
export function conflicts(board: number[]): number[] {
  const bad = new Set<number>();
  for (let i = 0; i < CELLS; i++) {
    const v = board[i] ?? 0;
    if (v === 0) continue;
    const r = (i / 9) | 0;
    const c = i % 9;
    for (let j = 0; j < CELLS; j++) {
      if (j === i) continue;
      if ((board[j] ?? 0) !== v) continue;
      const r2 = (j / 9) | 0;
      const c2 = j % 9;
      const sameBox = ((r / 3) | 0) === ((r2 / 3) | 0) && ((c / 3) | 0) === ((c2 / 3) | 0);
      if (r === r2 || c === c2 || sameBox) {
        bad.add(i);
        bad.add(j);
      }
    }
  }
  return [...bad];
}

export { bit };
