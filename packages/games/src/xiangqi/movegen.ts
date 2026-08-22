import type { XiangqiPiece, XiangqiPieceType, XiangqiSide } from './state.js';

/**
 * Pure Xiangqi move generation. Every function here takes only `(board,
 * side, ...)` — never the full engine state — so it can be shared by
 * rules.ts (the authoritative reducer) and, if useful, reused verbatim by
 * bot.ts. There is no engine-state dependency anywhere in this file.
 */

export const ROWS = 10;
export const COLS = 9;
export const SIZE = ROWS * COLS;

export function toIndex(row: number, col: number): number {
  return row * COLS + col;
}

export function rowOf(point: number): number {
  return Math.floor(point / COLS);
}

export function colOf(point: number): number {
  return point % COLS;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

/** Black's palace is rows 0-2, cols 3-5; Red's is rows 7-9, cols 3-5. */
export function inPalace(side: XiangqiSide, row: number, col: number): boolean {
  if (col < 3 || col > 5) return false;
  return side === 1 ? row >= 0 && row <= 2 : row >= 7 && row <= 9;
}

/** Black's own half is rows 0-4; Red's own half is rows 5-9. The river runs between. */
export function onOwnHalf(side: XiangqiSide, row: number): boolean {
  return side === 1 ? row <= 4 : row >= 5;
}

export function hasCrossedRiver(side: XiangqiSide, row: number): boolean {
  return !onOwnHalf(side, row);
}

export function createInitialBoard(): (XiangqiPiece | null)[] {
  const board: (XiangqiPiece | null)[] = new Array(SIZE).fill(null);
  const backRank: XiangqiPieceType[] = [
    'chariot',
    'horse',
    'elephant',
    'advisor',
    'general',
    'advisor',
    'elephant',
    'horse',
    'chariot',
  ];

  for (let col = 0; col < COLS; col++) {
    const type = backRank[col] as XiangqiPieceType;
    board[toIndex(0, col)] = { side: 1, type };
    board[toIndex(9, col)] = { side: 0, type };
  }

  for (const col of [1, 7]) {
    board[toIndex(2, col)] = { side: 1, type: 'cannon' };
    board[toIndex(7, col)] = { side: 0, type: 'cannon' };
  }

  for (const col of [0, 2, 4, 6, 8]) {
    board[toIndex(3, col)] = { side: 1, type: 'soldier' };
    board[toIndex(6, col)] = { side: 0, type: 'soldier' };
  }

  return board;
}

export function findGeneral(board: (XiangqiPiece | null)[], side: XiangqiSide): number | null {
  for (let i = 0; i < SIZE; i++) {
    const p = board[i];
    if (p && p.side === side && p.type === 'general') return i;
  }
  return null;
}

const ORTHOGONAL: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const DIAGONAL: readonly [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** (dr, dc) target plus the (dr, dc) of the leg that must be empty for a horse move. */
const HORSE_MOVES: readonly [number, number, number, number][] = [
  [-2, -1, -1, 0],
  [-2, 1, -1, 0],
  [2, -1, 1, 0],
  [2, 1, 1, 0],
  [-1, -2, 0, -1],
  [-1, 2, 0, 1],
  [1, -2, 0, -1],
  [1, 2, 0, 1],
];

/**
 * Pseudo-legal destinations for the piece at `from` — i.e. respects piece
 * shape, blocking, screens, palace/river confinement, but does NOT filter
 * out moves that leave the mover's own general in check or create a flying-
 * general face-off. rules.ts applies that filter.
 */
export function pieceMoves(board: (XiangqiPiece | null)[], from: number): number[] {
  const piece = board[from];
  if (!piece) return [];
  const row = rowOf(from);
  const col = colOf(from);
  const dests: number[] = [];

  const tryStep = (r: number, c: number): void => {
    if (!inBounds(r, c)) return;
    const target = board[toIndex(r, c)];
    if (target && target.side === piece.side) return;
    dests.push(toIndex(r, c));
  };

  switch (piece.type) {
    case 'general': {
      for (const [dr, dc] of ORTHOGONAL) {
        const r = row + dr;
        const c = col + dc;
        if (!inPalace(piece.side, r, c)) continue;
        tryStep(r, c);
      }
      break;
    }
    case 'advisor': {
      for (const [dr, dc] of DIAGONAL) {
        const r = row + dr;
        const c = col + dc;
        if (!inPalace(piece.side, r, c)) continue;
        tryStep(r, c);
      }
      break;
    }
    case 'elephant': {
      for (const [dr, dc] of DIAGONAL) {
        const midR = row + dr;
        const midC = col + dc;
        const r = row + dr * 2;
        const c = col + dc * 2;
        if (!inBounds(r, c) || !onOwnHalf(piece.side, r)) continue;
        if (board[toIndex(midR, midC)] !== null) continue; // blocked eye
        tryStep(r, c);
      }
      break;
    }
    case 'horse': {
      for (const [dr, dc, legDr, legDc] of HORSE_MOVES) {
        const legR = row + legDr;
        const legC = col + legDc;
        if (!inBounds(legR, legC) || board[toIndex(legR, legC)] !== null) continue; // hobbled
        const r = row + dr;
        const c = col + dc;
        if (!inBounds(r, c)) continue;
        tryStep(r, c);
      }
      break;
    }
    case 'chariot': {
      for (const [dr, dc] of ORTHOGONAL) {
        let r = row + dr;
        let c = col + dc;
        while (inBounds(r, c)) {
          const target = board[toIndex(r, c)];
          if (target == null) {
            dests.push(toIndex(r, c));
          } else {
            if (target.side !== piece.side) dests.push(toIndex(r, c));
            break;
          }
          r += dr;
          c += dc;
        }
      }
      break;
    }
    case 'cannon': {
      for (const [dr, dc] of ORTHOGONAL) {
        let r = row + dr;
        let c = col + dc;
        // Non-capturing slide until the first obstruction.
        while (inBounds(r, c) && board[toIndex(r, c)] === null) {
          dests.push(toIndex(r, c));
          r += dr;
          c += dc;
        }
        if (!inBounds(r, c)) continue;
        // `r,c` now holds the screen. Continue past it to find a capture target.
        r += dr;
        c += dc;
        while (inBounds(r, c) && board[toIndex(r, c)] === null) {
          r += dr;
          c += dc;
        }
        if (inBounds(r, c)) {
          const target = board[toIndex(r, c)];
          if (target && target.side !== piece.side) dests.push(toIndex(r, c));
        }
      }
      break;
    }
    case 'soldier': {
      const forward = piece.side === 1 ? 1 : -1;
      tryStep(row + forward, col);
      if (hasCrossedRiver(piece.side, row)) {
        tryStep(row, col - 1);
        tryStep(row, col + 1);
      }
      break;
    }
    default:
      break;
  }

  return dests;
}

/**
 * True if `bySide` attacks `point` — used for check detection. Covers every
 * normal piece's pseudo-legal capture reach, plus the flying-general rule:
 * `bySide`'s general "attacks" along its open file (see the comment below).
 */
export function isPointAttacked(board: (XiangqiPiece | null)[], point: number, bySide: XiangqiSide): boolean {
  for (let i = 0; i < SIZE; i++) {
    const p = board[i];
    if (!p || p.side !== bySide) continue;
    if (p.type === 'general') continue; // handled separately below
    if (pieceMoves(board, i).includes(point)) return true;
  }

  // Flying general: bySide's general threatens `point` if it shares a file
  // with a clear path — this is exactly the "opposing general attacks along
  // the open file" modelling the spec calls for. In practice this only ever
  // matters when `point` is the other general's square (own-king-safety
  // checks and legality-of-move checks both only ever query that square),
  // so this cannot spuriously flag unrelated empty squares as attacked.
  const generalPos = findGeneral(board, bySide);
  if (generalPos === null) return false;
  const gCol = colOf(generalPos);
  const pCol = colOf(point);
  if (gCol !== pCol) return false;
  const gRow = rowOf(generalPos);
  const pRow = rowOf(point);
  const lo = Math.min(gRow, pRow);
  const hi = Math.max(gRow, pRow);
  for (let r = lo + 1; r < hi; r++) {
    if (board[toIndex(r, gCol)] !== null) return false;
  }
  return true;
}

export function isInCheck(board: (XiangqiPiece | null)[], side: XiangqiSide): boolean {
  const generalPos = findGeneral(board, side);
  if (generalPos === null) return false;
  const opponent: XiangqiSide = side === 0 ? 1 : 0;
  return isPointAttacked(board, generalPos, opponent);
}

export function applyMoveToBoard(
  board: (XiangqiPiece | null)[],
  from: number,
  to: number,
): { board: (XiangqiPiece | null)[]; captured: XiangqiPiece | null } {
  const next = [...board];
  const piece = next[from] as XiangqiPiece;
  const captured = next[to];
  next[from] = null;
  next[to] = piece;
  return { board: next, captured: captured ?? null };
}
