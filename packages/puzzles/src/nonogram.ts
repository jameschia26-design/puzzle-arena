import { mulberry32, type Rng } from '@puzzle-arena/shared';
import type { Difficulty } from './core/solver.js';
import type { GradeResult, PuzzleMeta } from './sudoku.js';

/** Cell states used by the line solver. */
export const UNKNOWN = 0;
export const FILLED = 1;
export const EMPTY = 2;

export type NonogramSize = 10 | 15 | 20;

export interface NonogramPuzzle {
  size: NonogramSize;
  rowClues: number[][];
  colClues: number[][];
}
/** Row-major booleans: true = filled. */
export type NonogramSolution = boolean[];

/* ---------------- clue derivation ---------------- */

export function runsOf(line: boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const on of line) {
    if (on) run++;
    else if (run > 0) {
      clues.push(run);
      run = 0;
    }
  }
  if (run > 0) clues.push(run);
  return clues.length ? clues : [0];
}

/* ---------------- line solver ---------------- */

/**
 * Enumerate every clue placement compatible with the line's known cells and
 * intersect them: a cell that is filled in all placements is definitely filled,
 * and likewise for empty. Returns null on contradiction.
 */
function solveLine(line: Uint8Array, clues: number[]): Uint8Array | null {
  const n = line.length;
  const real = clues.length === 1 && clues[0] === 0 ? [] : clues;

  const canFill = new Uint8Array(n);
  const canEmpty = new Uint8Array(n);
  let found = 0;
  const buf = new Uint8Array(n);

  const place = (clueIdx: number, pos: number): void => {
    if (found > 200_000) return;
    if (clueIdx === real.length) {
      for (let i = pos; i < n; i++) {
        if (line[i] === FILLED) return;
        buf[i] = EMPTY;
      }
      found++;
      for (let i = 0; i < n; i++) {
        if (buf[i] === FILLED) canFill[i] = 1;
        else canEmpty[i] = 1;
      }
      return;
    }

    const len = real[clueIdx] as number;
    // Space still needed for the remaining clues plus their separators.
    let need = 0;
    for (let k = clueIdx; k < real.length; k++) need += (real[k] as number) + 1;
    need -= 1;

    for (let start = pos; start + need <= n; start++) {
      // Gap before this run must contain no known-filled cell.
      let ok = true;
      for (let i = pos; i < start; i++) {
        if (line[i] === FILLED) {
          ok = false;
          break;
        }
        buf[i] = EMPTY;
      }
      if (!ok) break; // a filled cell here blocks every later start too

      // The run itself must contain no known-empty cell.
      for (let i = start; i < start + len; i++) {
        if (line[i] === EMPTY) {
          ok = false;
          break;
        }
        buf[i] = FILLED;
      }
      if (!ok) continue;

      // Separator after the run.
      const after = start + len;
      if (after < n) {
        if (line[after] === FILLED) continue;
        buf[after] = EMPTY;
      }
      place(clueIdx + 1, after + 1);
    }
  };

  place(0, 0);
  if (found === 0) return null;

  const out = Uint8Array.from(line);
  for (let i = 0; i < n; i++) {
    if (canFill[i] && !canEmpty[i]) out[i] = FILLED;
    else if (!canFill[i] && canEmpty[i]) out[i] = EMPTY;
  }
  return out;
}

interface PropagationResult {
  grid: Uint8Array;
  status: 'solved' | 'stuck' | 'contradiction';
  iterations: number;
}

/** Iterate rows and columns to fixpoint. */
function propagateLines(
  grid: Uint8Array,
  size: number,
  rowClues: number[][],
  colClues: number[][],
): PropagationResult {
  const g = Uint8Array.from(grid);
  let iterations = 0;

  for (;;) {
    let changed = false;
    iterations++;

    for (let r = 0; r < size; r++) {
      const line = g.subarray(r * size, r * size + size);
      const solved = solveLine(Uint8Array.from(line), rowClues[r] as number[]);
      if (!solved) return { grid: g, status: 'contradiction', iterations };
      for (let c = 0; c < size; c++) {
        if (solved[c] !== line[c]) {
          g[r * size + c] = solved[c] as number;
          changed = true;
        }
      }
    }

    for (let c = 0; c < size; c++) {
      const col = new Uint8Array(size);
      for (let r = 0; r < size; r++) col[r] = g[r * size + c] as number;
      const solved = solveLine(col, colClues[c] as number[]);
      if (!solved) return { grid: g, status: 'contradiction', iterations };
      for (let r = 0; r < size; r++) {
        if (solved[r] !== col[r]) {
          g[r * size + c] = solved[r] as number;
          changed = true;
        }
      }
    }

    if (!changed) break;
    if (iterations > 200) break;
  }

  const complete = !g.includes(UNKNOWN);
  return { grid: g, status: complete ? 'solved' : 'stuck', iterations };
}

/** Count solutions up to `cap`, using line propagation plus DFS. */
export function countNonogramSolutions(
  size: number,
  rowClues: number[][],
  colClues: number[][],
  cap = 2,
  nodeBudget = 20_000,
): number {
  let found = 0;
  let nodes = 0;
  let aborted = false;

  const search = (grid: Uint8Array): void => {
    if (found >= cap || aborted) return;
    if (++nodes > nodeBudget) {
      aborted = true;
      return;
    }
    const rep = propagateLines(grid, size, rowClues, colClues);
    if (rep.status === 'contradiction') return;
    if (rep.status === 'solved') {
      found++;
      return;
    }
    const idx = rep.grid.indexOf(UNKNOWN);
    if (idx === -1) return;
    for (const v of [FILLED, EMPTY]) {
      if (found >= cap || aborted) return;
      const next = Uint8Array.from(rep.grid);
      next[idx] = v;
      search(next);
    }
  };

  search(new Uint8Array(size * size).fill(UNKNOWN));
  return aborted ? -1 : found;
}

/* ---------------- generation ---------------- */

/** Random binary grid at ~0.55 density, biased toward runs of 2-5. */
function randomGrid(size: number, rng: Rng): boolean[] {
  const cells = new Array<boolean>(size * size).fill(false);
  for (let r = 0; r < size; r++) {
    let c = 0;
    let on = rng.next() < 0.55;
    while (c < size) {
      // Filled runs 2-5 (mean 3.5), gaps 1-5 (mean 3.0) => ~0.54 density.
      const len = on ? rng.range(2, 6) : rng.range(1, 6);
      for (let k = 0; k < len && c < size; k++, c++) cells[r * size + c] = on;
      on = !on;
    }
  }
  // Guarantee no empty row or column — an all-blank line is a dull clue.
  for (let r = 0; r < size; r++) {
    if (!cells.slice(r * size, r * size + size).some(Boolean)) {
      cells[r * size + rng.int(size)] = true;
    }
  }
  for (let c = 0; c < size; c++) {
    let any = false;
    for (let r = 0; r < size; r++) if (cells[r * size + c]) any = true;
    if (!any) cells[rng.int(size) * size + c] = true;
  }
  return cells;
}

export function generate(opts: {
  difficulty: Difficulty;
  seed: number;
  size?: NonogramSize;
}): { puzzle: NonogramPuzzle; solution: NonogramSolution; meta: PuzzleMeta } {
  const started = Date.now();
  const size: NonogramSize =
    opts.size ?? (opts.difficulty === 'easy' ? 10 : opts.difficulty === 'medium' ? 15 : 20);

  let fallback: { puzzle: NonogramPuzzle; solution: NonogramSolution; diff: Difficulty } | null =
    null;

  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = mulberry32(opts.seed + attempt * 7717);
    const cells = randomGrid(size, rng);

    const rowClues: number[][] = [];
    for (let r = 0; r < size; r++) rowClues.push(runsOf(cells.slice(r * size, r * size + size)));
    const colClues: number[][] = [];
    for (let c = 0; c < size; c++) {
      const col: boolean[] = [];
      for (let r = 0; r < size; r++) col.push(cells[r * size + c] as boolean);
      colClues.push(runsOf(col));
    }

    const puzzle: NonogramPuzzle = { size, rowClues, colClues };

    // Does the line solver alone crack it?
    const rep = propagateLines(new Uint8Array(size * size), size, rowClues, colClues);
    let diff: Difficulty;
    if (rep.status === 'solved') {
      diff = rep.iterations <= 3 ? 'easy' : 'medium';
    } else {
      // Needs search. Unique -> hard; ambiguous -> discard this seed.
      const count = countNonogramSolutions(size, rowClues, colClues, 2);
      if (count !== 1) continue;
      diff = 'hard';
    }

    if (diff === opts.difficulty || (opts.difficulty === 'expert' && diff === 'hard')) {
      return {
        puzzle,
        solution: cells,
        meta: {
          actualDifficulty: diff,
          generationMs: Date.now() - started,
          seed: opts.seed,
        },
      };
    }
    fallback ??= { puzzle, solution: cells, diff };
  }

  const f = fallback;
  if (!f) throw new Error('nonogram: generation failed');
  return {
    puzzle: f.puzzle,
    solution: f.solution,
    meta: { actualDifficulty: f.diff, generationMs: Date.now() - started, seed: opts.seed },
  };
}

/* ---------------- grading ---------------- */

/**
 * Player state is a row-major array of marks: 1 = painted, 2 = crossed out,
 * 0/undefined = untouched.
 *
 * Note the deviation from the shared "cellsTotal = cells blank at start" rule:
 * for a Nonogram that would be every cell, which would hand a player who did
 * nothing at all a progress score equal to the grid's empty fraction (~45%).
 * The goal of a Nonogram is the painted cells, so those are what count.
 */
export function grade(playerState: unknown, solution: NonogramSolution): GradeResult {
  const marks = Array.isArray(playerState) ? (playerState as number[]) : [];
  let cellsTotal = 0;
  let cellsFilled = 0;
  let cellsCorrect = 0;

  for (let i = 0; i < solution.length; i++) {
    if (solution[i]) cellsTotal++;
    if ((marks[i] ?? 0) === FILLED) {
      cellsFilled++;
      if (solution[i]) cellsCorrect++;
    }
  }

  return {
    cellsTotal,
    cellsFilled,
    cellsCorrect,
    complete: cellsTotal > 0 && cellsCorrect === cellsTotal && cellsFilled === cellsTotal,
  };
}

export function hint(
  solution: NonogramSolution,
  playerState: unknown,
  size: number,
  rng: Rng,
): { path: string; value: number } | null {
  const marks = Array.isArray(playerState) ? (playerState as number[]) : [];
  const open: number[] = [];
  for (let i = 0; i < solution.length; i++) {
    const want = solution[i] ? FILLED : EMPTY;
    if ((marks[i] ?? 0) !== want) open.push(i);
  }
  if (open.length === 0) return null;
  const pick = open[rng.int(open.length)] as number;
  return {
    path: `${Math.floor(pick / size)},${pick % size}`,
    value: solution[pick] ? FILLED : EMPTY,
  };
}
