import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import { search, type SearchConfig } from '../chess-core/search.js';
import {
  applyMoveToBoard,
  file,
  isInCheck as boardInCheck,
  legalMovesForSide,
  nextEpSquare,
  pieceValue,
  rank,
  updateCastlingRights,
  type Board,
  type CastlingRights,
  type ChessMove,
  type ChessPiece,
  type PieceType,
  type Side,
} from './movegen.js';

/**
 * Deliberately imports only `./movegen.js` — which takes no engine state
 * object — never `./state.js` or `./rules.js`'s `ChessState`. The module
 * boundary (a bot policy sees only plain view data) is still the
 * enforcement; see `movegen.ts`'s header comment for why full FIDE movegen
 * is shared rather than duplicated, unlike every other game's `bot.ts`.
 */

export interface ChessBotPublicPlayer {
  id: string;
  seat: number;
  side: Side;
}

export interface ChessBotView {
  board: (ChessPiece | null)[];
  players: ChessBotPublicPlayer[];
  current: string | null;
  phase: 'playing' | 'game_over';
  castling: CastlingRights;
  epSquare: number | null;
  halfmoveClock: number;
  you: {
    id: string;
    side: Side;
    legalMoves: ChessMove[];
    inCheck: boolean;
  } | null;
}

export type ChessBotAction =
  | { type: 'move'; from: number; to: number; promotion?: ('q' | 'r' | 'b' | 'n') | undefined }
  | { type: 'resign' };

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

// Standard piece-square tables, row r0 = the piece's own back rank, r7 = the
// far (promotion / enemy back) rank — flipped per-side by `pstValue` so one
// table serves both colours.
const PAWN_PST: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 10, 10, -20, -20, 10, 10, 5],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [0, 0, 0, 20, 20, 0, 0, 0],
  [5, 5, 10, 25, 25, 10, 5, 5],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const KNIGHT_PST: readonly number[][] = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-30, 5, 10, 15, 15, 10, 5, -30],
  [-30, 0, 15, 20, 20, 15, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30],
  [-30, 0, 10, 15, 15, 10, 0, -30],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];
const BISHOP_PST: readonly number[][] = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 5, 0, 0, 0, 0, 5, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10],
  [-10, 0, 5, 10, 10, 5, 0, -10],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];
const ROOK_PST: readonly number[][] = [
  [0, 0, 0, 5, 5, 0, 0, 0],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [5, 10, 10, 10, 10, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const QUEEN_PST: readonly number[][] = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 5, 5, 5, 0, -10],
  [-5, 0, 5, 5, 5, 5, 0, -5],
  [0, 0, 5, 5, 5, 5, 0, -5],
  [-10, 5, 5, 5, 5, 5, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20],
];
const KING_MID_PST: readonly number[][] = [
  [20, 30, 10, 0, 0, 10, 30, 20],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
];
const KING_END_PST: readonly number[][] = [
  [-50, -30, -30, -30, -30, -30, -30, -50],
  [-30, -30, 0, 0, 0, 0, -30, -30],
  [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30],
  [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -20, -10, 0, 0, -10, -20, -30],
  [-50, -40, -30, -20, -20, -30, -40, -50],
];

function pstValue(table: readonly number[][], side: Side, f: number, r: number): number {
  const row = side === 0 ? r : 7 - r;
  return table[row]?.[f] ?? 0;
}

function totalNonPawnMaterial(board: Board): number {
  let total = 0;
  for (const p of board) {
    if (p && p.type !== 'p' && p.type !== 'k') total += pieceValue(p.type);
  }
  return total;
}

function pstFor(type: PieceType, endgame: boolean): readonly number[][] {
  switch (type) {
    case 'p':
      return PAWN_PST;
    case 'n':
      return KNIGHT_PST;
    case 'b':
      return BISHOP_PST;
    case 'r':
      return ROOK_PST;
    case 'q':
      return QUEEN_PST;
    case 'k':
      return endgame ? KING_END_PST : KING_MID_PST;
  }
}

function materialAndPst(board: Board, perspective: Side, endgame: boolean): number {
  let score = 0;
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p) continue;
    const f = file(s);
    const r = rank(s);
    const value = pieceValue(p.type) + pstValue(pstFor(p.type, endgame), p.side, f, r);
    score += p.side === perspective ? value : -value;
  }
  return score;
}

function bishopPairBonus(board: Board, perspective: Side): number {
  let white = 0;
  let black = 0;
  for (const p of board) {
    if (p?.type === 'b') {
      if (p.side === 0) white++;
      else black++;
    }
  }
  const own = perspective === 0 ? white : black;
  const opp = perspective === 0 ? black : white;
  return (own >= 2 ? 30 : 0) - (opp >= 2 ? 30 : 0);
}

function mobilityScore(board: Board, castling: CastlingRights, perspective: Side): number {
  const own = legalMovesForSide(board, perspective, castling, null).length;
  const opp = legalMovesForSide(board, (1 - perspective) as Side, castling, null).length;
  return (own - opp) * 2;
}

function kingSafetyScore(board: Board, perspective: Side): number {
  const opp = (1 - perspective) as Side;
  const ownCheck = boardInCheck(board, perspective) ? -50 : 0;
  const oppCheck = boardInCheck(board, opp) ? 50 : 0;
  return ownCheck + oppCheck;
}

interface BotPos {
  board: Board;
  castling: CastlingRights;
  epSquare: number | null;
  current: Side;
}

function makeSearchConfig(advanced: boolean): SearchConfig<BotPos, ChessMove> {
  return {
    genMoves(pos, side) {
      return legalMovesForSide(pos.board, side, pos.castling, pos.epSquare);
    },
    makeMove(pos, move) {
      const board = applyMoveToBoard(pos.board, move);
      const castling = updateCastlingRights(pos.castling, move);
      const epSquare = nextEpSquare(move);
      return { board, castling, epSquare, current: (1 - pos.current) as Side };
    },
    sideToMove(pos) {
      return pos.current;
    },
    isCapture(move) {
      return move.captured !== undefined || move.isEnPassant === true;
    },
    captureValue(move) {
      const victim = move.captured !== undefined ? pieceValue(move.captured) : pieceValue('p');
      return victim * 10 - pieceValue(move.piece);
    },
    evaluate(pos, side) {
      const endgame = totalNonPawnMaterial(pos.board) < 2 * pieceValue('r') + pieceValue('q');
      let score = materialAndPst(pos.board, side, endgame);
      if (advanced) {
        score += bishopPairBonus(pos.board, side);
        score += mobilityScore(pos.board, pos.castling, side);
        score += kingSafetyScore(pos.board, side);
      }
      return score;
    },
    isInCheck(pos, side) {
      return boardInCheck(pos.board, side);
    },
    moveKey(move) {
      return `${move.from}-${move.to}-${move.promotion ?? ''}`;
    },
  };
}

function moveAction(m: ChessMove): ChessBotAction {
  return { type: 'move', from: m.from, to: m.to, promotion: m.promotion as ('q' | 'r' | 'b' | 'n') | undefined };
}

export const chessBot: BotPolicy<ChessBotView, ChessBotAction> = {
  chooseAction(view, selfId, rng: Rng, difficulty: BotDifficulty): ChessBotAction {
    const side: Side =
      view.you?.side ?? (view.players.find((p) => p.id === selfId)?.side as Side | undefined) ?? 0;
    const legal = view.you?.legalMoves.length
      ? view.you.legalMoves
      : legalMovesForSide(view.board, side, view.castling, view.epSquare);

    if (legal.length === 0) return { type: 'resign' };

    if (difficulty === 'easy') {
      if (rng.next() < 0.35) return moveAction(rng.pick(legal));
      const scored = legal
        .map((m) => ({ m, v: m.captured !== undefined ? pieceValue(m.captured) : 0 }))
        .sort((a, b) => b.v - a.v);
      const top = scored.slice(0, Math.min(3, scored.length));
      return moveAction(rng.pick(top).m);
    }

    const pos: BotPos = { board: view.board, castling: view.castling, epSquare: view.epSquare, current: side };

    if (difficulty === 'normal') {
      const result = search(pos, makeSearchConfig(false), { maxDepth: 3, quiescence: true });
      return moveAction(result.move ?? legal[0] ?? (rng.pick(legal) as ChessMove));
    }

    // hard / ai
    const result = search(pos, makeSearchConfig(true), {
      maxDepth: 20,
      timeBudgetMs: 550,
      quiescence: true,
    });
    return moveAction(result.move ?? legal[0] ?? (rng.pick(legal) as ChessMove));
  },
};
