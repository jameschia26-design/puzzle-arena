/**
 * Pure, state-free chess move generation and legality. Every function here
 * takes only a board array plus the small amount of extra state (side,
 * castling rights, en-passant square) legality actually depends on — never
 * an engine `ChessState` object — so both `rules.ts` (the engine) and
 * `bot.ts` (the bot policy) can import this module without either importing
 * the other's state type. This is a deliberate, documented deviation from
 * the "bots reimplement movegen" house rule (see `checkers/bot.ts`'s header
 * comment) — full FIDE legality is too easy to get subtly wrong twice.
 *
 * Squares are 0..63, a1=0 .. h8=63 (little-endian rank-file: file = sq & 7,
 * rank = sq >> 3).
 */

export type Side = 0 | 1; // 0 = White, 1 = Black
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface ChessPiece {
  type: PieceType;
  side: Side;
}

export type Board = (ChessPiece | null)[];

export interface CastlingRights {
  wk: boolean;
  wq: boolean;
  bk: boolean;
  bq: boolean;
}

export interface ChessMove {
  from: number;
  to: number;
  side: Side;
  piece: PieceType;
  promotion?: PieceType | undefined;
  captured?: PieceType | undefined;
  isEnPassant?: boolean | undefined;
  /** The square of the captured pawn, only set when `isEnPassant` is true (differs from `to`). */
  epCaptureSquare?: number | undefined;
  isCastle?: ('K' | 'Q') | undefined;
  isDoublePush?: boolean | undefined;
}

export function file(sq: number): number {
  return sq & 7;
}

export function rank(sq: number): number {
  return sq >> 3;
}

export function sq(f: number, r: number): number {
  return r * 8 + f;
}

export function inBounds(f: number, r: number): boolean {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

export function squareName(square: number): string {
  const f = 'abcdefgh'[file(square)];
  return `${f}${rank(square) + 1}`;
}

export function createInitialBoard(): Board {
  const board: Board = new Array(64).fill(null);
  const backRank: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f++) {
    board[sq(f, 0)] = { type: backRank[f] as PieceType, side: 0 };
    board[sq(f, 1)] = { type: 'p', side: 0 };
    board[sq(f, 6)] = { type: 'p', side: 1 };
    board[sq(f, 7)] = { type: backRank[f] as PieceType, side: 1 };
  }
  return board;
}

const KNIGHT_DELTAS: readonly [number, number][] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const BISHOP_DIRS: readonly [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const KING_DELTAS: readonly [number, number][] = [...BISHOP_DIRS, ...ROOK_DIRS];

function findKing(board: Board, side: Side): number | null {
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (p && p.side === side && p.type === 'k') return s;
  }
  return null;
}

/** Is `square` attacked by any piece of `bySide`? */
export function isSquareAttacked(board: Board, square: number, bySide: Side): boolean {
  const f0 = file(square);
  const r0 = rank(square);

  // Pawn attacks: a pawn of `bySide` attacks diagonally forward from its own
  // square, so we look one step *backward* from `square` for such a pawn.
  const pawnDir = bySide === 0 ? -1 : 1;
  for (const df of [-1, 1]) {
    const f = f0 + df;
    const r = r0 + pawnDir;
    if (inBounds(f, r)) {
      const p = board[sq(f, r)];
      if (p && p.side === bySide && p.type === 'p') return true;
    }
  }

  for (const [df, dr] of KNIGHT_DELTAS) {
    const f = f0 + df;
    const r = r0 + dr;
    if (inBounds(f, r)) {
      const p = board[sq(f, r)];
      if (p && p.side === bySide && p.type === 'n') return true;
    }
  }

  for (const [df, dr] of KING_DELTAS) {
    const f = f0 + df;
    const r = r0 + dr;
    if (inBounds(f, r)) {
      const p = board[sq(f, r)];
      if (p && p.side === bySide && p.type === 'k') return true;
    }
  }

  for (const [df, dr] of BISHOP_DIRS) {
    let f = f0 + df;
    let r = r0 + dr;
    while (inBounds(f, r)) {
      const p = board[sq(f, r)];
      if (p) {
        if (p.side === bySide && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }

  for (const [df, dr] of ROOK_DIRS) {
    let f = f0 + df;
    let r = r0 + dr;
    while (inBounds(f, r)) {
      const p = board[sq(f, r)];
      if (p) {
        if (p.side === bySide && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }

  return false;
}

export function isInCheck(board: Board, side: Side): boolean {
  const kingSq = findKing(board, side);
  if (kingSq === null) return false;
  return isSquareAttacked(board, kingSq, (1 - side) as Side);
}

const PROMOTION_TYPES: readonly PieceType[] = ['q', 'r', 'b', 'n'];

function genPawnMoves(board: Board, from: number, side: Side, epSquare: number | null): ChessMove[] {
  const moves: ChessMove[] = [];
  const f = file(from);
  const r = rank(from);
  const dir = side === 0 ? 1 : -1;
  const startRank = side === 0 ? 1 : 6;
  const promRank = side === 0 ? 7 : 0;

  const oneR = r + dir;
  if (inBounds(f, oneR)) {
    const oneTo = sq(f, oneR);
    if (board[oneTo] === null) {
      if (oneR === promRank) {
        for (const promo of PROMOTION_TYPES) {
          moves.push({ from, to: oneTo, side, piece: 'p', promotion: promo });
        }
      } else {
        moves.push({ from, to: oneTo, side, piece: 'p' });
      }
      const twoR = r + 2 * dir;
      if (r === startRank && inBounds(f, twoR)) {
        const twoTo = sq(f, twoR);
        if (board[twoTo] === null) {
          moves.push({ from, to: twoTo, side, piece: 'p', isDoublePush: true });
        }
      }
    }
  }

  for (const df of [-1, 1]) {
    const cf = f + df;
    const cr = r + dir;
    if (!inBounds(cf, cr)) continue;
    const to = sq(cf, cr);
    const target = board[to];
    if (target && target.side !== side) {
      if (cr === promRank) {
        for (const promo of PROMOTION_TYPES) {
          moves.push({ from, to, side, piece: 'p', promotion: promo, captured: target.type });
        }
      } else {
        moves.push({ from, to, side, piece: 'p', captured: target.type });
      }
    } else if (!target && to === epSquare) {
      const capSq = sq(cf, r);
      const capPiece = board[capSq];
      if (capPiece && capPiece.side !== side && capPiece.type === 'p') {
        moves.push({ from, to, side, piece: 'p', isEnPassant: true, epCaptureSquare: capSq, captured: 'p' });
      }
    }
  }

  return moves;
}

function genKnightMoves(board: Board, from: number, side: Side): ChessMove[] {
  const moves: ChessMove[] = [];
  const f0 = file(from);
  const r0 = rank(from);
  for (const [df, dr] of KNIGHT_DELTAS) {
    const f = f0 + df;
    const r = r0 + dr;
    if (!inBounds(f, r)) continue;
    const to = sq(f, r);
    const target = board[to];
    if (target && target.side === side) continue;
    moves.push({ from, to, side, piece: 'n', captured: target?.type });
  }
  return moves;
}

function genSlidingMoves(
  board: Board,
  from: number,
  side: Side,
  piece: PieceType,
  dirs: readonly [number, number][],
): ChessMove[] {
  const moves: ChessMove[] = [];
  const f0 = file(from);
  const r0 = rank(from);
  for (const [df, dr] of dirs) {
    let f = f0 + df;
    let r = r0 + dr;
    while (inBounds(f, r)) {
      const to = sq(f, r);
      const target = board[to];
      if (target) {
        if (target.side !== side) moves.push({ from, to, side, piece, captured: target.type });
        break;
      }
      moves.push({ from, to, side, piece });
      f += df;
      r += dr;
    }
  }
  return moves;
}

function genKingStepMoves(board: Board, from: number, side: Side): ChessMove[] {
  const moves: ChessMove[] = [];
  const f0 = file(from);
  const r0 = rank(from);
  for (const [df, dr] of KING_DELTAS) {
    const f = f0 + df;
    const r = r0 + dr;
    if (!inBounds(f, r)) continue;
    const to = sq(f, r);
    const target = board[to];
    if (target && target.side === side) continue;
    moves.push({ from, to, side, piece: 'k', captured: target?.type });
  }
  return moves;
}

const CASTLE_SQUARES = {
  0: { king: 4, kSideRook: 7, kSideThrough: [5, 6], kSideKingTo: 6, kSideRookTo: 5,
       qSideRook: 0, qSideEmpty: [1, 2, 3], qSideThrough: [3, 2], qSideKingTo: 2, qSideRookTo: 3 },
  1: { king: 60, kSideRook: 63, kSideThrough: [61, 62], kSideKingTo: 62, kSideRookTo: 61,
       qSideRook: 56, qSideEmpty: [57, 58, 59], qSideThrough: [59, 58], qSideKingTo: 58, qSideRookTo: 59 },
} as const;

function genCastlingMoves(board: Board, side: Side, castling: CastlingRights): ChessMove[] {
  const moves: ChessMove[] = [];
  const cfg = CASTLE_SQUARES[side];
  const opp = (1 - side) as Side;
  const king = board[cfg.king];
  if (!king || king.type !== 'k' || king.side !== side) return moves;
  if (isSquareAttacked(board, cfg.king, opp)) return moves; // in check: can't castle

  const kingside = side === 0 ? castling.wk : castling.bk;
  if (kingside) {
    const rook = board[cfg.kSideRook];
    const clear = cfg.kSideThrough.every((s) => board[s] === null);
    const safe = cfg.kSideThrough.every((s) => !isSquareAttacked(board, s, opp));
    if (rook && rook.type === 'r' && rook.side === side && clear && safe) {
      moves.push({ from: cfg.king, to: cfg.kSideKingTo, side, piece: 'k', isCastle: 'K' });
    }
  }

  const queenside = side === 0 ? castling.wq : castling.bq;
  if (queenside) {
    const rook = board[cfg.qSideRook];
    const clear = cfg.qSideEmpty.every((s) => board[s] === null);
    const safe = cfg.qSideThrough.every((s) => !isSquareAttacked(board, s, opp));
    if (rook && rook.type === 'r' && rook.side === side && clear && safe) {
      moves.push({ from: cfg.king, to: cfg.qSideKingTo, side, piece: 'k', isCastle: 'Q' });
    }
  }

  return moves;
}

/** Pseudo-legal moves for one piece — does not check whether the mover's own king ends up in check. */
function pseudoMovesFromSquare(
  board: Board,
  from: number,
  castling: CastlingRights,
  epSquare: number | null,
): ChessMove[] {
  const piece = board[from];
  if (!piece) return [];
  switch (piece.type) {
    case 'p':
      return genPawnMoves(board, from, piece.side, epSquare);
    case 'n':
      return genKnightMoves(board, from, piece.side);
    case 'b':
      return genSlidingMoves(board, from, piece.side, 'b', BISHOP_DIRS);
    case 'r':
      return genSlidingMoves(board, from, piece.side, 'r', ROOK_DIRS);
    case 'q':
      return genSlidingMoves(board, from, piece.side, 'q', KING_DELTAS);
    case 'k':
      return [...genKingStepMoves(board, from, piece.side), ...genCastlingMoves(board, piece.side, castling)];
    default:
      return [];
  }
}

/** All pseudo-legal moves for `side` — may leave the mover's own king in check. */
export function pseudoMovesForSide(
  board: Board,
  side: Side,
  castling: CastlingRights,
  epSquare: number | null,
): ChessMove[] {
  const moves: ChessMove[] = [];
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p || p.side !== side) continue;
    moves.push(...pseudoMovesFromSquare(board, s, castling, epSquare));
  }
  return moves;
}

/** Pure application of an already-generated move onto a board copy. Ignores castling/ep bookkeeping. */
export function applyMoveToBoard(board: Board, move: ChessMove): Board {
  const next = [...board];
  const piece = next[move.from];
  if (!piece) return next;
  next[move.from] = null;
  if (move.isEnPassant && move.epCaptureSquare !== undefined) {
    next[move.epCaptureSquare] = null;
  }
  next[move.to] = { type: move.promotion ?? piece.type, side: piece.side };
  if (move.isCastle === 'K') {
    const cfg = CASTLE_SQUARES[move.side];
    const rook = next[cfg.kSideRook];
    next[cfg.kSideRook] = null;
    if (rook) next[cfg.kSideRookTo] = rook;
  } else if (move.isCastle === 'Q') {
    const cfg = CASTLE_SQUARES[move.side];
    const rook = next[cfg.qSideRook];
    next[cfg.qSideRook] = null;
    if (rook) next[cfg.qSideRookTo] = rook;
  }
  return next;
}

/** Every fully legal move for `side` — pseudo-legal moves filtered so the mover's own king never ends up in check. */
export function legalMovesForSide(
  board: Board,
  side: Side,
  castling: CastlingRights,
  epSquare: number | null,
): ChessMove[] {
  const pseudo = pseudoMovesForSide(board, side, castling, epSquare);
  const legal: ChessMove[] = [];
  for (const m of pseudo) {
    const next = applyMoveToBoard(board, m);
    if (!isInCheck(next, side)) legal.push(m);
  }
  return legal;
}

export function updateCastlingRights(castling: CastlingRights, move: ChessMove): CastlingRights {
  let { wk, wq, bk, bq } = castling;
  if (move.piece === 'k') {
    if (move.side === 0) {
      wk = false;
      wq = false;
    } else {
      bk = false;
      bq = false;
    }
  }
  if (move.from === 0 || move.to === 0) wq = false; // a1
  if (move.from === 7 || move.to === 7) wk = false; // h1
  if (move.from === 56 || move.to === 56) bq = false; // a8
  if (move.from === 63 || move.to === 63) bk = false; // h8
  return { wk, wq, bk, bq };
}

export function nextEpSquare(move: ChessMove): number | null {
  if (!move.isDoublePush) return null;
  const f = file(move.from);
  const r = (rank(move.from) + rank(move.to)) / 2;
  return sq(f, r);
}

const MATERIAL: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function pieceValue(type: PieceType): number {
  return MATERIAL[type];
}

/** K-K, K+B-K, K+N-K, K+B-K+B with same-colour bishops: an immediate dead position. */
export function isInsufficientMaterial(board: Board): boolean {
  const pieces: { type: PieceType; side: Side; square: number }[] = [];
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (p && p.type !== 'k') pieces.push({ type: p.type, side: p.side, square: s });
  }
  if (pieces.length === 0) return true; // K vs K
  if (pieces.length > 2) return false;
  if (pieces.length === 1) {
    const t = pieces[0]?.type;
    return t === 'b' || t === 'n';
  }
  // Exactly two minor pieces left.
  const [a, b] = pieces as [{ type: PieceType; side: Side; square: number }, { type: PieceType; side: Side; square: number }];
  if (a.type === 'b' && b.type === 'b' && a.side !== b.side) {
    const colourOf = (square: number): number => (file(square) + rank(square)) % 2;
    return colourOf(a.square) === colourOf(b.square);
  }
  return false;
}
