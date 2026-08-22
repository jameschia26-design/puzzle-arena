import {
  applyMoveToBoard,
  createInitialBoard,
  file,
  isInCheck,
  isInsufficientMaterial,
  legalMovesForSide,
  nextEpSquare,
  rank,
  squareName,
  updateCastlingRights,
  type Board,
  type CastlingRights,
  type ChessMove,
  type PieceType,
  type Side,
} from './movegen.js';
import type { ChessPlayer, ChessState, MoveRecord } from './state.js';

export * from './movegen.js';

export function playerById(s: ChessState, id: string): ChessPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

export function sideOf(s: ChessState, playerId: string): Side | null {
  const i = s.players.findIndex((p) => p.id === playerId);
  return i === 0 || i === 1 ? (i as Side) : null;
}

/** Whoever the game is waiting on right now, or null once it is over. */
export function actorToAct(s: ChessState): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.current]?.id ?? null;
}

/** Board + side-to-move + castling rights + ep-square. Deliberately excludes halfmove/fullmove counters. */
export function positionKey(board: Board, current: Side, castling: CastlingRights, epSquare: number | null): string {
  let boardKey = '';
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    boardKey += p ? `${p.side}${p.type}` : '--';
  }
  const castleKey = `${castling.wk ? 'K' : ''}${castling.wq ? 'Q' : ''}${castling.bk ? 'k' : ''}${castling.bq ? 'q' : ''}`;
  return `${boardKey}|${current}|${castleKey}|${epSquare ?? '-'}`;
}

export function stateKey(s: ChessState): string {
  return positionKey(s.board, s.current, s.castling, s.epSquare);
}

/** Full disambiguation SAN, without the trailing +/# suffix (the caller appends that once it knows the result). */
export function sanForMove(move: ChessMove, legalMovesBefore: ChessMove[]): string {
  if (move.isCastle === 'K') return 'O-O';
  if (move.isCastle === 'Q') return 'O-O-O';

  const capture = move.captured !== undefined;
  const target = squareName(move.to);
  const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : '';

  if (move.piece === 'p') {
    const fromFile = capture ? `${'abcdefgh'[file(move.from)]}` : '';
    return `${fromFile}${capture ? 'x' : ''}${target}${promo}`;
  }

  const pieceLetter = move.piece.toUpperCase();
  const others = legalMovesBefore.filter(
    (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from,
  );
  let disambig = '';
  if (others.length > 0) {
    const sameFile = others.some((m) => file(m.from) === file(move.from));
    const sameRank = others.some((m) => rank(m.from) === rank(move.from));
    if (!sameFile) disambig = 'abcdefgh'[file(move.from)] as string;
    else if (!sameRank) disambig = String(rank(move.from) + 1);
    else disambig = squareName(move.from);
  }
  return `${pieceLetter}${disambig}${capture ? 'x' : ''}${target}${promo}`;
}

export interface ReplayResult {
  board: Board;
  castling: CastlingRights;
  epSquare: number | null;
  halfmoveClock: number;
  fullmove: number;
  current: Side;
  repetition: Record<string, number>;
}

/**
 * Deterministically rebuilds the position by replaying `moves` from the
 * initial setup. Used by takeback (never "undo" incrementally) so the
 * result stays byte-for-byte reproducible from `room_events` replay.
 */
export function replayFromStart(moves: readonly MoveRecord[]): ReplayResult {
  let board = createInitialBoard();
  let castling: CastlingRights = { wk: true, wq: true, bk: true, bq: true };
  let epSquare: number | null = null;
  let halfmoveClock = 0;
  let fullmove = 1;
  let current: Side = 0;
  const repetition: Record<string, number> = {};

  const key0 = positionKey(board, current, castling, epSquare);
  repetition[key0] = 1;

  for (const rec of moves) {
    const move: ChessMove = {
      from: rec.from,
      to: rec.to,
      side: rec.side,
      piece: rec.piece,
      promotion: rec.promotion,
      captured: rec.captured,
      isEnPassant: rec.isEnPassant,
      isCastle: rec.isCastle,
      isDoublePush: rec.isDoublePush,
      epCaptureSquare: rec.isEnPassant ? enPassantCaptureSquareFor(rec) : undefined,
    };
    board = applyMoveToBoard(board, move);
    castling = updateCastlingRights(castling, move);
    epSquare = nextEpSquare(move);
    halfmoveClock = rec.piece === 'p' || rec.captured !== undefined ? 0 : halfmoveClock + 1;
    if (rec.side === 1) fullmove += 1;
    current = (1 - rec.side) as Side;

    const key = positionKey(board, current, castling, epSquare);
    repetition[key] = (repetition[key] ?? 0) + 1;
  }

  return { board, castling, epSquare, halfmoveClock, fullmove, current, repetition };
}

function enPassantCaptureSquareFor(rec: MoveRecord): number {
  // The captured pawn sits on the same file as `to`, same rank as `from`.
  return rec.to - (rec.side === 0 ? 8 : -8);
}

export type TerminalReason =
  | { kind: 'checkmate'; winnerSide: Side }
  | { kind: 'stalemate' }
  | { kind: 'material' }
  | { kind: 'fivefold' }
  | { kind: 'seventyfive' }
  | null;

/** Automatic terminal detection after a move: checkmate/stalemate, dead position, 75-move, fivefold. */
export function detectTerminal(
  board: Board,
  sideToMove: Side,
  castling: CastlingRights,
  epSquare: number | null,
  halfmoveClock: number,
  repetitionCount: number,
): TerminalReason {
  const legal = legalMovesForSide(board, sideToMove, castling, epSquare);
  if (legal.length === 0) {
    if (isInCheck(board, sideToMove)) {
      return { kind: 'checkmate', winnerSide: (1 - sideToMove) as Side };
    }
    return { kind: 'stalemate' };
  }
  if (isInsufficientMaterial(board)) return { kind: 'material' };
  if (repetitionCount >= 5) return { kind: 'fivefold' };
  if (halfmoveClock >= 150) return { kind: 'seventyfive' };
  return null;
}

export function canClaimFiftyMove(s: ChessState): boolean {
  return s.halfmoveClock >= 100;
}

export function canClaimThreefold(s: ChessState): boolean {
  return (s.repetition[stateKey(s)] ?? 0) >= 3;
}

export function canClaimDraw(s: ChessState): boolean {
  return canClaimFiftyMove(s) || canClaimThreefold(s);
}

export function moveLabel(m: Pick<ChessMove, 'from' | 'to' | 'promotion'>): string {
  return `move:${m.from}-${m.to}${m.promotion ? `=${m.promotion}` : ''}`;
}

export { pieceValue } from './movegen.js';
