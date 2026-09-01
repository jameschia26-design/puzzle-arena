import { BOARD_W, BOARD_H, type TetrominoKind, type Tetromino } from './state.js';
export { BOARD_W, BOARD_H };

// ------------------------------------------------------------------
// Tetromino shapes: cell offsets for each rotation (0..3)
// Origin is the SRS rotation origin. Cells are integer (x,y) offsets.
// ------------------------------------------------------------------

// Base shapes in spawn orientation, then derived via rotation
// Using SRS definitions
const BASE: Record<TetrominoKind, [number, number][]> = {
  I: [[-1, 0], [0, 0], [1, 0], [2, 0]],
  J: [[-1, 0], [-1, 1], [0, 0], [1, 0]],
  L: [[-1, 0], [0, 0], [1, 0], [1, 1]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  S: [[-1, 1], [0, 1], [0, 0], [1, 0]],
  T: [[-1, 0], [0, 0], [1, 0], [0, 1]],
  Z: [[-1, 0], [0, 0], [0, 1], [1, 1]],
};

function rotateCW([x, y]: [number, number]): [number, number] {
  return [y, -x];
}

function cellsFor(kind: TetrominoKind, rot: number): [number, number][] {
  let cells = BASE[kind].map((c) => [...c] as [number, number]);
  const r = ((rot % 4) + 4) % 4;
  for (let i = 0; i < r; i++) cells = cells.map(rotateCW);
  // Special centering for I to match SRS: I piece rotates around (0.5,0.5)
  // Our integer origin approximation is sufficient for gameplay; kicks handle alignment.
  return cells;
}

export function tetrominoCells(t: Tetromino): [number, number][] {
  const offs = cellsFor(t.kind, t.rot);
  return offs.map(([dx, dy]) => [t.x + dx, t.y + dy] as [number, number]);
}

// ------------------------------------------------------------------
// SRS kick tables
// ------------------------------------------------------------------

type Kick = [number, number];

// JLSTZ kicks: indexed by from->to
const JLSTZ_KICKS: Record<string, Kick[]> = {
  '0->1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1->0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1->2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2->1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2->3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3->2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3->0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0->3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

const I_KICKS: Record<string, Kick[]> = {
  '0->1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1->0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1->2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2->1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2->3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3->2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3->0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0->3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

function kickTable(kind: TetrominoKind, from: number, to: number): Kick[] {
  if (kind === 'O') return [[0, 0]];
  const key = `${from}->${to}`;
  if (kind === 'I') return I_KICKS[key] ?? [[0, 0]];
  return JLSTZ_KICKS[key] ?? [[0, 0]];
}

// ------------------------------------------------------------------
// Board helpers
// ------------------------------------------------------------------

export function idx(x: number, y: number): number {
  return y * BOARD_W + x;
}

export function collides(
  board: (TetrominoKind | null)[],
  kind: TetrominoKind,
  x: number,
  y: number,
  rot: number,
): boolean {
  const offs = cellsFor(kind, rot);
  for (const [dx, dy] of offs) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cx >= BOARD_W || cy >= BOARD_H) return true;
    if (cy < 0) continue; // above board is free
    if (board[idx(cx, cy)] !== null) return true;
  }
  return false;
}
export function isGrounded(
  board: (TetrominoKind | null)[],
  t: Tetromino,
): boolean {
  return collides(board, t.kind, t.x, t.y + 1, t.rot);
}


export function ghostY(
  board: (TetrominoKind | null)[],
  t: Tetromino,
): number {
  let y = t.y;
  while (!collides(board, t.kind, t.x, y + 1, t.rot)) y++;
  return y;
}

export function tryMove(
  board: (TetrominoKind | null)[],
  t: Tetromino,
  dx: number,
  dy: number,
): Tetromino | null {
  const nx = t.x + dx;
  const ny = t.y + dy;
  if (collides(board, t.kind, nx, ny, t.rot)) return null;
  return { ...t, x: nx, y: ny };
}

export function tryRotate(
  board: (TetrominoKind | null)[],
  t: Tetromino,
  dir: 'cw' | 'ccw',
): Tetromino | null {
  const from = ((t.rot % 4) + 4) % 4;
  const to = dir === 'cw' ? (from + 1) % 4 : (from + 3) % 4;
  const kicks = kickTable(t.kind, from, to);
  for (const [kx, ky] of kicks) {
    const nx = t.x + kx;
    const ny = t.y - ky; // SRS y is inverted vs our y (down positive), so negate
    if (!collides(board, t.kind, nx, ny, to)) {
      return { kind: t.kind, x: nx, y: ny, rot: to };
    }
  }
  return null;
}

export function lockPiece(
  board: (TetrominoKind | null)[],
  t: Tetromino,
): (TetrominoKind | null)[] {
  const next = [...board];
  for (const [cx, cy] of tetrominoCells(t)) {
    if (cy >= 0 && cy < BOARD_H && cx >= 0 && cx < BOARD_W) {
      next[idx(cx, cy)] = t.kind;
    }
  }
  return next;
}

export function clearLines(board: (TetrominoKind | null)[]): { board: (TetrominoKind | null)[]; cleared: number; clearedRows: number[] } {
  const clearedRows: number[] = [];
  for (let y = 0; y < BOARD_H; y++) {
    let full = true;
    for (let x = 0; x < BOARD_W; x++) if (board[idx(x, y)] === null) { full = false; break; }
    if (full) clearedRows.push(y);
  }
  if (clearedRows.length === 0) return { board, cleared: 0, clearedRows };
  const remaining: (TetrominoKind | null)[][] = [];
  const clearedSet = new Set(clearedRows);
  for (let y = 0; y < BOARD_H; y++) {
    if (!clearedSet.has(y)) {
      const row: (TetrominoKind | null)[] = [];
      for (let x = 0; x < BOARD_W; x++) row.push(board[idx(x, y)] ?? null);
      remaining.push(row);
    }
  }
  // pad top with empty rows
  while (remaining.length < BOARD_H) remaining.unshift(Array(BOARD_W).fill(null));
  const flat = remaining.flat();
  return { board: flat, cleared: clearedRows.length, clearedRows };
}

// T-spin detection: T piece, last action was rotate, and 3 of 4 diagonal corners blocked
export function isTSpin(
  board: (TetrominoKind | null)[],
  t: Tetromino,
  lastWasRotate: boolean,
): boolean {
  if (t.kind !== 'T' || !lastWasRotate) return false;
  const corners: [number, number][] = [
    [t.x - 1, t.y - 1],
    [t.x + 1, t.y - 1],
    [t.x - 1, t.y + 1],
    [t.x + 1, t.y + 1],
  ];
  let blocked = 0;
  for (const [cx, cy] of corners) {
    if (cx < 0 || cx >= BOARD_W || cy >= BOARD_H) blocked++;
    else if (cy < 0) { /* above board not blocked */ }
    else if (board[idx(cx, cy)] !== null) blocked++;
  }
  return blocked >= 3;
}

// ------------------------------------------------------------------
// Scoring
// ------------------------------------------------------------------

export function lineClearScore(cleared: number, level: number): number {
  switch (cleared) {
    case 1: return 100 * level;
    case 2: return 300 * level;
    case 3: return 500 * level;
    case 4: return 800 * level;
    default: return 0;
  }
}

export function tSpinScore(cleared: number, level: number): number {
  switch (cleared) {
    case 0: return 400 * level;
    case 1: return 800 * level;
    case 2: return 1200 * level;
    case 3: return 1600 * level;
    default: return 0;
  }
}

// Gravity table: ms per cell at each level (approx Tetris Guideline)
export function gravityMs(level: number): number {
  const table = [0, 1000, 800, 700, 600, 500, 400, 320, 250, 200, 150, 120, 100, 90, 80, 70, 60, 50, 40, 30, 20];
  if (level <= 0) return 1000;
  if (level < table.length) return table[level]!;
  return 15;
}

// ------------------------------------------------------------------
// 7-bag
// ------------------------------------------------------------------

export const KINDS: TetrominoKind[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

export function newBag(rng: { shuffle<T>(a: T[]): T[] }): TetrominoKind[] {
  return rng.shuffle([...KINDS]);
}

// Spawn position for new piece (center top)
export function spawnTetromino(kind: TetrominoKind): Tetromino {
  // I spawns slightly higher due to shape
  return { kind, x: 4, y: kind === 'I' ? 1 : 0, rot: 0 };
}

export function spawnCollides(board: (TetrominoKind | null)[], kind: TetrominoKind): boolean {
  const t = spawnTetromino(kind);
  return collides(board, t.kind, t.x, t.y, t.rot);
}
