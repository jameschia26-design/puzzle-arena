import { mulberry32, type Rng } from '@puzzle-arena/shared';
import type { Difficulty } from './core/solver.js';
import type { GradeResult, PuzzleMeta } from './sudoku.js';

export const MINE = -1;

export interface MinesweeperConfig {
  rows: number;
  cols: number;
  totalMines: number;
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, MinesweeperConfig> = {
  easy: { rows: 9, cols: 9, totalMines: 10 },
  medium: { rows: 16, cols: 16, totalMines: 40 },
  hard: { rows: 16, cols: 30, totalMines: 99 },
  expert: { rows: 20, cols: 30, totalMines: 130 },
};

export interface MinesweeperPuzzle {
  rows: number;
  cols: number;
  totalMines: number;
  safeStart: { row: number; col: number };
}

export interface MinesweeperSolution {
  rows: number;
  cols: number;
  totalMines: number;
  /** Array of length rows * cols: -1 for mine, 0..8 for adjacent mine count */
  grid: number[];
}

export interface MinesweeperPlayerState {
  /** Array of length rows * cols: true if revealed */
  revealed: boolean[];
  detonated: boolean;
  detonatedCell: { row: number; col: number } | null;
  moves: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

export function getNeighbors(row: number, col: number, rows: number, cols: number): { r: number; c: number }[] {
  const neighbors: { r: number; c: number }[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        neighbors.push({ r: nr, c: nc });
      }
    }
  }
  return neighbors;
}

/* ------------------------------------------------------------------ */
/* Generator                                                          */
/* ------------------------------------------------------------------ */

export function generate(opts: {
  difficulty?: Difficulty;
  seed?: number;
}): { puzzle: MinesweeperPuzzle; solution: MinesweeperSolution; meta: PuzzleMeta } {
  const t0 = Date.now();
  const seed = opts.seed ?? 42;
  const difficulty = opts.difficulty ?? 'medium';
  const cfg = DIFFICULTY_CONFIGS[difficulty];
  const { rows, cols, totalMines } = cfg;
  const rng = mulberry32(seed);
  const startR = Math.floor(rows / 2);
  const startC = Math.floor(cols / 2);

  // Forbidden cells for mines: safe start and its 8 neighbors
  const forbidden = new Set<number>();
  forbidden.add(startR * cols + startC);
  for (const n of getNeighbors(startR, startC, rows, cols)) {
    forbidden.add(n.r * cols + n.c);
  }

  // Eligible indices for mine placement
  const totalCells = rows * cols;
  const eligible: number[] = [];
  for (let i = 0; i < totalCells; i++) {
    if (!forbidden.has(i)) eligible.push(i);
  }

  // Fisher-Yates shuffle eligible cells to place mines
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = eligible[i]!;
    eligible[i] = eligible[j]!;
    eligible[j] = tmp;
  }

  const mineIndices = new Set<number>(eligible.slice(0, totalMines));
  const grid = new Array<number>(totalCells).fill(0);

  for (const idx of mineIndices) {
    grid[idx] = MINE;
  }

  // Compute adjacent counts
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (grid[idx] === MINE) continue;
      let count = 0;
      for (const n of getNeighbors(r, c, rows, cols)) {
        if (grid[n.r * cols + n.c] === MINE) count++;
      }
      grid[idx] = count;
    }
  }

  return {
    puzzle: {
      rows,
      cols,
      totalMines,
      safeStart: { row: startR, col: startC },
    },
    solution: {
      rows,
      cols,
      totalMines,
      grid,
    },
    meta: {
      actualDifficulty: difficulty,
      generationMs: Date.now() - t0,
      seed,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Flood Fill Reveal                                                  */
/* ------------------------------------------------------------------ */

export function revealCell(
  solution: MinesweeperSolution,
  revealed: boolean[],
  row: number,
  col: number,
): { revealed: boolean[]; detonated: boolean; countRevealed: number } {
  const { rows, cols, grid } = solution;
  const targetIdx = row * cols + col;
  const nextRevealed = [...revealed];

  if (targetIdx < 0 || targetIdx >= rows * cols) {
    return { revealed: nextRevealed, detonated: false, countRevealed: 0 };
  }

  if (grid[targetIdx] === MINE) {
    nextRevealed[targetIdx] = true;
    return { revealed: nextRevealed, detonated: true, countRevealed: 1 };
  }

  if (nextRevealed[targetIdx]) {
    return { revealed: nextRevealed, detonated: false, countRevealed: 0 };
  }

  let count = 0;
  const queue: { r: number; c: number }[] = [{ r: row, c: col }];
  nextRevealed[targetIdx] = true;
  count++;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currIdx = curr.r * cols + curr.c;
    const val = grid[currIdx];

    // If it's a 0, cascade to all unrevealed neighbors
    if (val === 0) {
      for (const n of getNeighbors(curr.r, curr.c, rows, cols)) {
        const nIdx = n.r * cols + n.c;
        if (!nextRevealed[nIdx] && grid[nIdx] !== MINE) {
          nextRevealed[nIdx] = true;
          count++;
          if (grid[nIdx] === 0) {
            queue.push({ r: n.r, c: n.c });
          }
        }
      }
    }
  }

  return { revealed: nextRevealed, detonated: false, countRevealed: count };
}

/* ------------------------------------------------------------------ */
/* Solve Path / Order for Bots & Solvers                              */
/* ------------------------------------------------------------------ */

export function solveOrder(puzzle: MinesweeperPuzzle, solution: MinesweeperSolution): string[] {
  const { rows, cols, grid } = solution;
  const order: string[] = [];
  const visited = new Array<boolean>(rows * cols).fill(false);

  // Safe start first
  const startIdx = puzzle.safeStart.row * cols + puzzle.safeStart.col;
  order.push(`${puzzle.safeStart.row},${puzzle.safeStart.col}`);
  visited[startIdx] = true;

  // BFS from safe start
  const queue: { r: number; c: number }[] = [{ r: puzzle.safeStart.row, c: puzzle.safeStart.col }];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const n of getNeighbors(curr.r, curr.c, rows, cols)) {
      const idx = n.r * cols + n.c;
      if (!visited[idx] && grid[idx] !== MINE) {
        visited[idx] = true;
        order.push(`${n.r},${n.c}`);
        queue.push({ r: n.r, c: n.c });
      }
    }
  }

  // Any remaining non-mine cells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!visited[idx] && grid[idx] !== MINE) {
        visited[idx] = true;
        order.push(`${r},${c}`);
      }
    }
  }

  return order;
}

/* ------------------------------------------------------------------ */
/* Grading                                                            */
/* ------------------------------------------------------------------ */

export function grade(playerState: unknown, solution: MinesweeperSolution): GradeResult {
  const { rows, cols, totalMines, grid } = solution;
  const totalNonMines = rows * cols - totalMines;

  let revealed: boolean[] = [];
  let detonated = false;

  if (playerState && typeof playerState === 'object') {
    const ps = playerState as { revealed?: boolean[]; detonated?: boolean };
    if (Array.isArray(ps.revealed)) revealed = ps.revealed;
    if (typeof ps.detonated === 'boolean') detonated = ps.detonated;
  }

  let revealedNonMines = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== MINE && revealed[i]) {
      revealedNonMines++;
    }
  }

  const complete = !detonated && revealedNonMines >= totalNonMines;
  const cellsFilled = revealed.filter(Boolean).length;
  const cellsCorrect = revealedNonMines;

  return {
    cellsFilled,
    cellsCorrect,
    cellsTotal: totalNonMines,
    complete,
  };
}

/* ------------------------------------------------------------------ */
/* Hint                                                               */
/* ------------------------------------------------------------------ */

export function hint(
  solution: MinesweeperSolution,
  playerState: unknown,
  rng: Rng,
): { path: string; value: number } | null {
  const { rows, cols, grid } = solution;
  let revealed: boolean[] = [];
  if (playerState && typeof playerState === 'object' && Array.isArray((playerState as { revealed?: boolean[] }).revealed)) {
    revealed = (playerState as { revealed: boolean[] }).revealed;
  }

  const unrevealedSafe: { r: number; c: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!revealed[idx] && grid[idx] !== MINE) {
        unrevealedSafe.push({ r, c });
      }
    }
  }

  if (unrevealedSafe.length === 0) return null;
  const pick = unrevealedSafe[rng.int(unrevealedSafe.length)]!;
  return { path: `${pick.r},${pick.c}`, value: 1 };
}
