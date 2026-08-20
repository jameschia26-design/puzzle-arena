import { mulberry32, type Rng } from '@puzzle-arena/shared';
import {
  CELLS,
  type Difficulty,
  type Grid,
  cageConstraint,
  colOf,
  countSolutions,
  rowOf,
} from './core/solver.js';
import { generateFullGrid, type GradeResult, type PuzzleMeta } from './sudoku.js';

export interface KillerCage {
  id: number;
  cells: number[];
  sum: number;
}

export interface KillerPuzzle {
  cages: KillerCage[];
  /** Normally all zeros — Killer Sudoku reveals no digits. Non-zero only when
   *  the generator had to reveal a digit to force uniqueness. */
  givens: Grid;
}
export type KillerSolution = Grid;

function neighbours(i: number): number[] {
  const r = rowOf(i);
  const c = colOf(i);
  const out: number[] = [];
  if (r > 0) out.push(i - 9);
  if (r < 8) out.push(i + 9);
  if (c > 0) out.push(i - 1);
  if (c < 8) out.push(i + 1);
  return out;
}

/**
 * Cage size is the difficulty knob for Killer Sudoku, exactly as it is in the
 * published puzzles. Small cages constrain hard — a size-2 cage summing to 4 is
 * almost a given — while a size-5 cage has many digit combinations hitting its
 * total and barely narrows anything. So small cages read as easy and also make
 * uniqueness cheap to prove; large cages read as hard and cost more attempts.
 */
const SIZE_WEIGHTS: Record<Difficulty, [number, number][]> = {
  easy: [
    [2, 55],
    [3, 35],
    [4, 10],
  ],
  medium: [
    [2, 35],
    [3, 40],
    [4, 20],
    [5, 5],
  ],
  hard: [
    [2, 20],
    [3, 35],
    [4, 30],
    [5, 15],
  ],
  expert: [
    [2, 10],
    [3, 30],
    [4, 35],
    [5, 25],
  ],
};

function pickCageSize(rng: Rng, difficulty: Difficulty): number {
  const weights = SIZE_WEIGHTS[difficulty];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let roll = rng.int(total);
  for (const [size, weight] of weights) {
    if (roll < weight) return size;
    roll -= weight;
  }
  return 3;
}

/** Partition all 81 cells into orthogonally-connected cages of size 2..5 with
 *  no digit repeated inside a cage. */
/**
 * One pass of the grow-then-merge algorithm. Returns null if a size-1 cage
 * survives the merge fallbacks with the size-5 cap in place — the caller
 * retries with fresh randomness rather than ever handing out a cage layout
 * that leaks a digit.
 */
function growCagesOnce(
  solution: Grid,
  rng: Rng,
  difficulty: Difficulty,
  allowOversizeMerge: boolean,
): number[][] | null {
  const owner = new Int16Array(CELLS).fill(-1);
  const cages: number[][] = [];

  const order = rng.shuffle(Array.from({ length: CELLS }, (_, i) => i));
  for (const seed of order) {
    if (owner[seed] !== -1) continue;
    const id = cages.length;
    const cells = [seed];
    const digits = new Set<number>([solution[seed] as number]);
    owner[seed] = id;
    const target = pickCageSize(rng, difficulty);

    while (cells.length < target) {
      const options: number[] = [];
      for (const c of cells) {
        for (const n of neighbours(c)) {
          if (owner[n] !== -1) continue;
          if (digits.has(solution[n] as number)) continue;
          if (!options.includes(n)) options.push(n);
        }
      }
      if (options.length === 0) break;
      const pick = options[rng.int(options.length)] as number;
      owner[pick] = id;
      cells.push(pick);
      digits.add(solution[pick] as number);
    }
    cages.push(cells);
  }

  // Merge stragglers: a size-1 cage hands the player a free digit, so it must
  // not survive. First try joining a neighbouring cage outright.
  for (let id = 0; id < cages.length; id++) {
    const cells = cages[id] as number[];
    if (cells.length !== 1) continue;
    const only = cells[0] as number;
    const digit = solution[only] as number;
    const sizeCap = allowOversizeMerge ? Infinity : 5;

    for (const n of neighbours(only)) {
      const otherId = owner[n] as number;
      if (otherId === id) continue;
      const other = cages[otherId] as number[];
      if (other.length >= sizeCap) continue;
      if (other.some((c) => solution[c] === digit)) continue;
      other.push(only);
      owner[only] = otherId;
      cells.length = 0;
      break;
    }
    if (cells.length === 0) continue;

    // Nobody would take it (digit clash or all neighbours full). Steal one cell
    // from a neighbouring cage instead, provided the donor stays connected.
    for (const n of neighbours(only)) {
      const otherId = owner[n] as number;
      if (otherId === id) continue;
      const other = cages[otherId] as number[];
      if (other.length < 3) continue;
      if (solution[n] === digit) continue;
      const remainder = other.filter((c) => c !== n);
      if (!connected(remainder)) continue;
      cages[otherId] = remainder;
      cells.push(n);
      owner[n] = id;
      break;
    }
  }

  const result = cages.filter((c) => c.length > 0);
  // The one invariant that must never be violated: no size-1 cage leaks a
  // digit. If one survived even the merge fallbacks, this whole layout is
  // rejected rather than returned.
  if (result.some((c) => c.length === 1)) return null;
  return result;
}

/**
 * Retry `growCagesOnce` a bounded, small number of times, relaxing the
 * size-5 cap only once the strict attempts are exhausted — guaranteed to
 * succeed eventually because a fully-partitioned grid always has *some*
 * digit-clash-free neighbour once cage size is unconstrained. Only used at
 * the one call site that has no outer retry loop of its own to fall back
 * on; the main generation loop below instead treats a single `null` from
 * `growCagesOnce` as "try the next seed", reusing the retry budget it
 * already has rather than multiplying attempts on top of it.
 */
function growCagesWithFallback(solution: Grid, rng: Rng, difficulty: Difficulty): number[][] {
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = growCagesOnce(solution, rng, difficulty, false);
    if (result) return result;
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = growCagesOnce(solution, rng, difficulty, true);
    if (result) return result;
  }
  // Unreachable in practice (see doc comment), but never hand back a layout
  // with a leaking singleton cage.
  throw new Error('growCages: could not produce a cage layout without a size-1 cage');
}

function connected(cells: number[]): boolean {
  if (cells.length === 0) return false;
  const set = new Set(cells);
  const seen = new Set<number>([cells[0] as number]);
  const stack = [cells[0] as number];
  while (stack.length) {
    const c = stack.pop() as number;
    for (const n of neighbours(c)) {
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === cells.length;
}

/**
 * Split a cage into two connected parts, each of at least `minPart` cells.
 * minPart is 2 because a size-1 cage is a revealed digit by another name —
 * splitting a size-2 cage would hand the player two free digits.
 */
function splitCage(cells: number[], minPart = 2): [number[], number[]] | null {
  const k = cells.length;
  if (k < minPart * 2) return null;
  let best: [number[], number[]] | null = null;
  let bestImbalance = Infinity;

  for (let mask = 1; mask < (1 << k) - 1; mask++) {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < k; i++) (mask & (1 << i) ? a : b).push(cells[i] as number);
    if (a.length < minPart || b.length < minPart) continue;
    if (!connected(a) || !connected(b)) continue;
    const imbalance = Math.abs(a.length - b.length);
    if (imbalance < bestImbalance) {
      bestImbalance = imbalance;
      best = [a, b];
      if (imbalance <= 1) break;
    }
  }
  return best;
}

const sumOf = (cells: number[], solution: Grid): number =>
  cells.reduce((acc, c) => acc + (solution[c] as number), 0);

export function generate(opts: { difficulty: Difficulty; seed: number }): {
  puzzle: KillerPuzzle;
  solution: KillerSolution;
  meta: PuzzleMeta;
} {
  const started = Date.now();
  const noGivens: Grid = new Array<number>(CELLS).fill(0);

  const finish = (
    cageCells: number[][],
    solution: Grid,
    givens: Grid,
    achieved: Difficulty,
  ): { puzzle: KillerPuzzle; solution: KillerSolution; meta: PuzzleMeta } => {
    const cages = cageCells.map((cells, id) => ({ id, cells, sum: sumOf(cells, solution) }));
    // Killer is rated by its cage profile, not by the Sudoku technique tier.
    // With no givens at all, every board needs some guessing under the tier-5
    // technique set, so `rateDifficulty` reports "expert" for all of them and
    // carries no signal. Cage size distribution is the real knob — that is how
    // published Killer puzzles are graded — and it is what SIZE_WEIGHTS sets.
    return {
      puzzle: { cages, givens },
      solution,
      meta: {
        actualDifficulty: achieved,
        generationMs: Date.now() - started,
        seed: opts.seed,
      },
    };
  };

  /**
   * A single pathological layout could otherwise explore for minutes, so each
   * uniqueness proof gets a node budget and the whole search gets a wall-clock
   * budget. Rooms are generated on demand, so latency here is user-visible.
   */
  const NODE_BUDGET = 12_000;
  const BUDGET_PER_TIER_MS = 1_500;

  // Try the requested profile, then step down a tier at a time. This mirrors the
  // Sudoku contingency in the plan: report the tier actually achieved in
  // meta.actualDifficulty rather than failing room creation.
  const ladder: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
  const from = ladder.indexOf(opts.difficulty);
  const profiles = ladder.slice(0, from + 1).reverse(); // requested, then easier

  for (const profile of profiles) {
    const deadline = Date.now() + BUDGET_PER_TIER_MS;

    // A fresh cage layout is cheap, so prefer regenerating over revealing.
    // Only cages of size >= 4 are split, never below size 2 per part, because
    // a size-1 cage is a revealed digit wearing a different hat.
    for (let attempt = 0; attempt < 400 && Date.now() < deadline; attempt++) {
      const rng = mulberry32(opts.seed + attempt * 6151);
      const solution = generateFullGrid(rng);
      // A single strict-cap attempt: on the rare occasion a singleton cage
      // can't be merged, just move on to the next seed rather than retrying
      // in a nested loop — the outer attempt loop already has 400 seeds and
      // its own time budget, and multiplying retries on top of it is what
      // pushed 'hard'/'expert' generation close to the test timeout.
      let cageCells = growCagesOnce(solution, rng, profile, false);
      if (!cageCells) continue;

      for (let round = 0; round < 8; round++) {
        if (Date.now() >= deadline) break;
        const constraint = cageConstraint(
          cageCells.map((cells) => ({ cells, sum: sumOf(cells, solution) })),
        );
        if (countSolutions(noGivens, 2, constraint, 4, NODE_BUDGET) === 1) {
          return finish(cageCells, solution, [...noGivens], profile);
        }
        if (Date.now() >= deadline) break;

        // Split the largest splittable cage — smaller cages constrain harder.
        let bestIdx = -1;
        for (let i = 0; i < cageCells.length; i++) {
          const len = (cageCells[i] as number[]).length;
          if (len < 4) continue;
          if (bestIdx === -1 || len > (cageCells[bestIdx] as number[]).length) bestIdx = i;
        }
        if (bestIdx === -1) break;
        const parts = splitCage(cageCells[bestIdx] as number[], 2);
        if (!parts) break;
        cageCells = [
          ...cageCells.slice(0, bestIdx),
          ...cageCells.slice(bestIdx + 1),
          ...parts,
        ];
      }
    }
  }

  // Last resort: reveal digits until unique. Always terminates, because a
  // fully-revealed grid is trivially unique.
  const rng = mulberry32(opts.seed + 999983);
  const solution = generateFullGrid(rng);
  const cageCells = growCagesWithFallback(solution, rng, 'easy');
  const constraint = cageConstraint(
    cageCells.map((cells) => ({ cells, sum: sumOf(cells, solution) })),
  );
  const givens: Grid = [...noGivens];
  for (let i = 0; i < CELLS; i++) {
    // Same node budget as the main search loop above. Without it, a nearly
    // given-free Killer board can send a single call here down a pathological
    // branch that burns far past any reasonable generation latency — the
    // exact case the main loop's budget already exists to guard against; a
    // budget-exhausted call is "not proven unique", so the loop just reveals
    // another digit and tries again, which still always terminates.
    if (countSolutions(givens, 2, constraint, 4, NODE_BUDGET) === 1) break;
    const blanks: number[] = [];
    for (let c = 0; c < CELLS; c++) if (givens[c] === 0) blanks.push(c);
    if (blanks.length === 0) break;
    const pick = blanks[rng.int(blanks.length)] as number;
    givens[pick] = solution[pick] as number;
  }
  return finish(cageCells, solution, givens, 'easy');
}

export function grade(
  playerState: unknown,
  solution: KillerSolution,
  puzzle: KillerPuzzle,
): GradeResult {
  const board = Array.isArray(playerState) ? (playerState as number[]) : [];
  let cellsTotal = 0;
  let cellsFilled = 0;
  let cellsCorrect = 0;

  for (let i = 0; i < CELLS; i++) {
    if ((puzzle.givens[i] as number) !== 0) continue;
    cellsTotal++;
    const v = board[i] ?? 0;
    if (v !== 0) {
      cellsFilled++;
      if (v === solution[i]) cellsCorrect++;
    }
  }
  return {
    cellsTotal,
    cellsFilled,
    cellsCorrect,
    complete: cellsTotal > 0 && cellsCorrect === cellsTotal,
  };
}

export function hint(
  puzzle: KillerPuzzle,
  solution: KillerSolution,
  playerState: unknown,
  rng: Rng,
): { path: string; value: number } | null {
  const board = Array.isArray(playerState) ? (playerState as number[]) : [];
  const open: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    if ((puzzle.givens[i] as number) !== 0) continue;
    if ((board[i] ?? 0) !== solution[i]) open.push(i);
  }
  if (open.length === 0) return null;
  const pick = open[rng.int(open.length)] as number;
  return { path: `${rowOf(pick)},${colOf(pick)}`, value: solution[pick] as number };
}
