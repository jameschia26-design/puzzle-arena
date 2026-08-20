import type {
  CheckersLegalMove,
  CheckersPiece,
  CheckersPlayer,
  CheckersPos,
  CheckersSide,
  CheckersState,
} from './state.js';

export const BOARD_SIZE = 10;
export const PIECES_PER_SIDE = 20;

export function playable(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

export function inBounds(pos: CheckersPos): boolean {
  return pos.row >= 0 && pos.row < BOARD_SIZE && pos.col >= 0 && pos.col < BOARD_SIZE;
}

function idx(pos: CheckersPos): number {
  return pos.row * BOARD_SIZE + pos.col;
}

function key(pos: CheckersPos): string {
  return `${pos.row},${pos.col}`;
}

const DIRECTIONS: readonly CheckersPos[] = [
  { row: -1, col: -1 },
  { row: -1, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 1 },
];

export function createInitialBoard(): (CheckersPiece | null)[] {
  const board: (CheckersPiece | null)[] = new Array(BOARD_SIZE * BOARD_SIZE).fill(null);
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!playable(row, col)) continue;
      if (row <= 3) board[idx({ row, col })] = { side: 0, king: false };
      else if (row >= 6) board[idx({ row, col })] = { side: 1, king: false };
    }
  }
  return board;
}

/** Forward row direction for a man of this side (side 0 moves down, side 1 moves up). */
function forwardRow(side: CheckersSide): number {
  return side === 0 ? 1 : -1;
}

function isBackRank(side: CheckersSide, row: number): boolean {
  return side === 0 ? row === BOARD_SIZE - 1 : row === 0;
}

export function playerById(s: CheckersState, id: string): CheckersPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

export function sideOf(s: CheckersState, playerId: string): CheckersSide | null {
  const i = s.players.findIndex((p) => p.id === playerId);
  return i === 0 || i === 1 ? (i as CheckersSide) : null;
}

/**
 * Resolves what a given board square holds *during* a single multi-hop move:
 * the moving piece's original square reads as empty (it has already left),
 * and any square already captured earlier in this same move reads as
 * "blocked" — occupied for pathing purposes but distinct from a live piece,
 * per the standard rule that a captured piece cannot be crossed or captured
 * again until the whole move completes.
 */
type Occupant = CheckersPiece | null | 'blocked';

function occupantDuring(
  board: (CheckersPiece | null)[],
  pos: CheckersPos,
  startPos: CheckersPos,
  capturedSoFar: ReadonlySet<string>,
): Occupant {
  if (pos.row === startPos.row && pos.col === startPos.col) return null;
  if (capturedSoFar.has(key(pos))) return 'blocked';
  return board[idx(pos)] ?? null;
}

interface CaptureContinuation {
  to: CheckersPos;
  capturedPos: CheckersPos;
}

function findCaptureContinuations(
  board: (CheckersPiece | null)[],
  from: CheckersPos,
  startPos: CheckersPos,
  side: CheckersSide,
  king: boolean,
  capturedSoFar: ReadonlySet<string>,
): CaptureContinuation[] {
  const results: CaptureContinuation[] = [];

  for (const dir of DIRECTIONS) {
    if (king) {
      let foundEnemyAt: CheckersPos | null = null;
      let step = 1;
      for (;;) {
        const cur: CheckersPos = { row: from.row + dir.row * step, col: from.col + dir.col * step };
        if (!inBounds(cur)) break;
        const occ = occupantDuring(board, cur, startPos, capturedSoFar);
        if (occ === 'blocked') break;
        if (occ === null) {
          if (foundEnemyAt) results.push({ to: cur, capturedPos: foundEnemyAt });
          step++;
          continue;
        }
        if (occ.side === side) break;
        // Enemy piece.
        if (foundEnemyAt) break; // a second enemy in the way blocks the ray
        foundEnemyAt = cur;
        step++;
      }
    } else {
      const mid: CheckersPos = { row: from.row + dir.row, col: from.col + dir.col };
      const land: CheckersPos = { row: from.row + dir.row * 2, col: from.col + dir.col * 2 };
      if (!inBounds(land)) continue;
      const midOcc = occupantDuring(board, mid, startPos, capturedSoFar);
      if (midOcc === null || midOcc === 'blocked' || midOcc.side === side) continue;
      const landOcc = occupantDuring(board, land, startPos, capturedSoFar);
      if (landOcc !== null) continue;
      results.push({ to: land, capturedPos: mid });
    }
  }

  return results;
}

function captureSequencesFrom(
  board: (CheckersPiece | null)[],
  startPos: CheckersPos,
  side: CheckersSide,
  startKing: boolean,
  path: CheckersPos[],
  king: boolean,
  capturedSoFar: ReadonlySet<string>,
  capturedPositions: CheckersPos[],
): CheckersLegalMove[] {
  const cur = path[path.length - 1] as CheckersPos;
  const continuations = findCaptureContinuations(board, cur, startPos, side, king, capturedSoFar);

  if (continuations.length === 0) {
    if (capturedPositions.length === 0) return [];
    return [{ path: [...path], captured: [...capturedPositions] }];
  }

  const sequences: CheckersLegalMove[] = [];
  for (const cont of continuations) {
    const newCaptured = new Set(capturedSoFar);
    newCaptured.add(key(cont.capturedPos));
    const newPath = [...path, cont.to];
    const newCapturedPositions = [...capturedPositions, cont.capturedPos];

    // Promotion ends the move immediately, even if a further capture would
    // technically be available as a king from the landing square.
    if (!king && isBackRank(side, cont.to.row)) {
      sequences.push({ path: newPath, captured: newCapturedPositions });
      continue;
    }

    const deeper = captureSequencesFrom(
      board,
      startPos,
      side,
      startKing,
      newPath,
      king,
      newCaptured,
      newCapturedPositions,
    );
    if (deeper.length === 0) {
      sequences.push({ path: newPath, captured: newCapturedPositions });
    } else {
      sequences.push(...deeper);
    }
  }
  return sequences;
}

function simpleMovesFor(
  board: (CheckersPiece | null)[],
  from: CheckersPos,
  piece: CheckersPiece,
): CheckersLegalMove[] {
  const moves: CheckersLegalMove[] = [];
  if (piece.king) {
    for (const dir of DIRECTIONS) {
      let step = 1;
      for (;;) {
        const cur: CheckersPos = { row: from.row + dir.row * step, col: from.col + dir.col * step };
        if (!inBounds(cur) || board[idx(cur)] !== null) break;
        moves.push({ path: [from, cur], captured: [] });
        step++;
      }
    }
  } else {
    const fr = forwardRow(piece.side);
    for (const dc of [-1, 1]) {
      const cur: CheckersPos = { row: from.row + fr, col: from.col + dc };
      if (inBounds(cur) && board[idx(cur)] === null) {
        moves.push({ path: [from, cur], captured: [] });
      }
    }
  }
  return moves;
}

/** Every legal move for `side`, already narrowed to the mandatory-maximum-capture subset. */
export function legalMovesForSide(board: (CheckersPiece | null)[], side: CheckersSide): CheckersLegalMove[] {
  const captureSequences: CheckersLegalMove[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const pos = { row, col };
      const piece = board[idx(pos)];
      if (!piece || piece.side !== side) continue;
      captureSequences.push(
        ...captureSequencesFrom(board, pos, side, piece.king, [pos], piece.king, new Set(), []),
      );
    }
  }

  if (captureSequences.length > 0) {
    const maxCaptures = Math.max(...captureSequences.map((s) => s.captured.length));
    return captureSequences.filter((s) => s.captured.length === maxCaptures);
  }

  const simple: CheckersLegalMove[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const pos = { row, col };
      const piece = board[idx(pos)];
      if (!piece || piece.side !== side) continue;
      simple.push(...simpleMovesFor(board, pos, piece));
    }
  }
  return simple;
}

export function samePath(a: CheckersPos[], b: CheckersPos[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.row === b[i]?.row && p.col === b[i]?.col);
}

export interface ApplyMoveResult {
  board: (CheckersPiece | null)[];
  captured: CheckersPos[];
  promoted: boolean;
}

/** Pure application of an already-validated move path onto a board copy. */
export function applyMove(
  board: (CheckersPiece | null)[],
  move: CheckersLegalMove,
): ApplyMoveResult {
  const next = [...board];
  const start = move.path[0] as CheckersPos;
  const end = move.path[move.path.length - 1] as CheckersPos;
  const piece = next[idx(start)] as CheckersPiece;
  next[idx(start)] = null;
  for (const cap of move.captured) next[idx(cap)] = null;
  const promoted = !piece.king && isBackRank(piece.side, end.row);
  next[idx(end)] = { side: piece.side, king: piece.king || promoted };
  return { board: next, captured: move.captured, promoted };
}

export function countSide(board: (CheckersPiece | null)[], side: CheckersSide): { pieces: number; kings: number } {
  let pieces = 0;
  let kings = 0;
  for (const p of board) {
    if (p && p.side === side) {
      pieces++;
      if (p.king) kings++;
    }
  }
  return { pieces, kings };
}

/** Whoever the game is waiting on right now, or null once it is over. */
export function actorToAct(s: CheckersState): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.current]?.id ?? null;
}
