import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import { search, type SearchConfig } from '../chess-core/search.js';
import type { Side } from '../chess-core/types.js';
import {
  applyMoveToBoard,
  colOf,
  isInCheck,
  pieceMoves,
  rowOf,
  SIZE,
} from './movegen.js';
import type { XiangqiPieceType } from './state.js';

type BotSide = 0 | 1;

interface BotPiece {
  type: XiangqiPieceType;
  side: BotSide;
}

interface BotLegalMove {
  from: number;
  to: number;
  piece?: XiangqiPieceType | undefined;
  captured?: XiangqiPieceType | undefined;
}

export interface XiangqiBotPublicPlayer {
  id: string;
  side: BotSide;
}

export interface XiangqiBotView {
  board: (BotPiece | null)[];
  current: string;
  players: XiangqiBotPublicPlayer[];
  you?: {
    side: BotSide;
    legalMoves: { from: number; to: number }[];
    inCheck?: boolean;
  } | null;
}

export type XiangqiBotAction = { type: 'move'; from: number; to: number } | { type: 'resign' };

function legalMovesForSide(board: (BotPiece | null)[], side: BotSide): BotLegalMove[] {
  const moves: BotLegalMove[] = [];
  for (let from = 0; from < SIZE; from++) {
    const piece = board[from];
    if (!piece || piece.side !== side) continue;
    for (const to of pieceMoves(board, from)) {
      const { board: next, captured } = applyMoveToBoard(board, from, to);
      if (!isInCheck(next, side)) {
        moves.push({
          from,
          to,
          piece: piece.type,
          captured: captured ? captured.type : undefined,
        });
      }
    }
  }
  return moves;
}

/* ------------------------------------------------------------------ */
/* Evaluation & Piece-Square Tables                                    */
/* ------------------------------------------------------------------ */

const PIECE_VALUE: Record<XiangqiPieceType, number> = {
  general: 10_000,
  chariot: 950,
  cannon: 480,
  horse: 420,
  advisor: 200,
  elephant: 200,
  soldier: 100,
};

// 10 rows (row 0 = piece's own back rank, row 9 = enemy back rank) x 9 cols
const CHARIOT_PST: readonly number[][] = [
  [-2, 6, 4, 12, 10, 12, 4, 6, -2],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [6, 12, 10, 18, 16, 18, 10, 12, 6],
  [6, 14, 12, 20, 18, 20, 12, 14, 6],
  [10, 18, 16, 24, 22, 24, 16, 18, 10],
  [12, 20, 18, 26, 24, 26, 18, 20, 12],
  [14, 22, 20, 28, 26, 28, 20, 22, 14],
  [16, 24, 22, 30, 28, 30, 22, 24, 16],
  [12, 22, 20, 28, 24, 28, 20, 22, 12],
];

const HORSE_PST: readonly number[][] = [
  [-8, -4, 0, 0, -4, 0, 0, -4, -8],
  [-4, 4, 8, 10, 6, 10, 8, 4, -4],
  [0, 8, 14, 16, 12, 16, 14, 8, 0],
  [2, 10, 18, 22, 16, 22, 18, 10, 2],
  [4, 14, 22, 26, 20, 26, 22, 14, 4],
  [6, 18, 26, 30, 24, 30, 26, 18, 6],
  [8, 20, 28, 32, 26, 32, 28, 20, 8],
  [6, 18, 24, 28, 24, 28, 24, 18, 6],
  [2, 12, 18, 22, 18, 22, 18, 12, 2],
  [-6, 0, 6, 10, 6, 10, 6, 0, -6],
];

const CANNON_PST: readonly number[][] = [
  [0, 0, 2, 8, 12, 8, 2, 0, 0],
  [0, 2, 4, 10, 16, 10, 4, 2, 0],
  [2, 4, 6, 12, 18, 12, 6, 4, 2],
  [2, 4, 8, 14, 20, 14, 8, 4, 2],
  [0, 4, 8, 14, 18, 14, 8, 4, 0],
  [-2, 4, 8, 14, 18, 14, 8, 4, -2],
  [-2, 4, 8, 12, 16, 12, 8, 4, -2],
  [4, 8, 12, 18, 22, 18, 12, 8, 4],
  [2, 6, 10, 14, 16, 14, 10, 6, 2],
  [0, 4, 8, 12, 14, 12, 8, 4, 0],
];

const SOLDIER_PST: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 0, 8, 0, 4, 0, 0],
  [4, 0, 8, 0, 14, 0, 8, 0, 4],
  [20, 24, 28, 34, 38, 34, 28, 24, 20],
  [24, 30, 36, 42, 46, 42, 36, 30, 24],
  [28, 36, 44, 52, 56, 52, 44, 36, 28],
  [24, 32, 40, 48, 50, 48, 40, 32, 24],
  [10, 14, 18, 22, 24, 22, 18, 14, 10],
];

const ADVISOR_PST: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 15, 0, 0, 0, 0],
  [0, 0, 0, 5, 0, 5, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const ELEPHANT_PST: readonly number[][] = [
  [0, 0, 2, 0, 0, 0, 2, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 0, 0, 0, 0, 0, 0, 0, 4],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const GENERAL_PST: readonly number[][] = [
  [0, 0, 0, 5, 10, 5, 0, 0, 0],
  [0, 0, 0, 0, 2, 0, 0, 0, 0],
  [0, 0, 0, -10, -5, -10, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

function pstFor(type: XiangqiPieceType): readonly number[][] {
  switch (type) {
    case 'chariot':
      return CHARIOT_PST;
    case 'horse':
      return HORSE_PST;
    case 'cannon':
      return CANNON_PST;
    case 'soldier':
      return SOLDIER_PST;
    case 'advisor':
      return ADVISOR_PST;
    case 'elephant':
      return ELEPHANT_PST;
    case 'general':
      return GENERAL_PST;
  }
}

/** Positive is good for `side`. */
function evaluate(board: (BotPiece | null)[], side: BotSide, advanced: boolean): number {
  let materialAndPst = 0;
  for (let i = 0; i < SIZE; i++) {
    const piece = board[i];
    if (!piece) continue;
    const row = rowOf(i);
    const col = colOf(i);
    const rank = piece.side === 0 ? 9 - row : row;
    const file = col;

    const baseVal = PIECE_VALUE[piece.type];
    const pstTable = pstFor(piece.type);
    const pstVal = pstTable[rank]?.[file] ?? 0;

    const totalPieceVal = baseVal + pstVal;
    materialAndPst += (piece.side === side ? 1 : -1) * totalPieceVal;
  }

  if (!advanced) {
    return materialAndPst;
  }

  const opponent: BotSide = (1 - side) as BotSide;
  let bonus = 0;

  // King safety & check bonus/penalty
  const ownCheck = isInCheck(board, side) ? -60 : 0;
  const oppCheck = isInCheck(board, opponent) ? 60 : 0;
  bonus += ownCheck + oppCheck;

  // Mobility bonus
  const ownMobility = legalMovesForSide(board, side).length;
  const oppMobility = legalMovesForSide(board, opponent).length;
  bonus += (ownMobility - oppMobility) * 2;

  return materialAndPst + bonus;
}

/* ------------------------------------------------------------------ */
/* Search Configuration                                                */
/* ------------------------------------------------------------------ */

interface BotPos {
  board: (BotPiece | null)[];
  current: BotSide;
}

function makeSearchConfig(advanced: boolean): SearchConfig<BotPos, BotLegalMove> {
  return {
    genMoves(pos: BotPos, side: Side): BotLegalMove[] {
      return legalMovesForSide(pos.board, side as BotSide);
    },
    makeMove(pos: BotPos, move: BotLegalMove): BotPos {
      const { board } = applyMoveToBoard(pos.board, move.from, move.to);
      return { board, current: (1 - pos.current) as BotSide };
    },
    sideToMove(pos: BotPos): Side {
      return pos.current as Side;
    },
    isCapture(move: BotLegalMove): boolean {
      return move.captured !== undefined;
    },
    captureValue(move: BotLegalMove): number {
      const victim = move.captured ? PIECE_VALUE[move.captured] : 100;
      const attacker = move.piece ? PIECE_VALUE[move.piece] : 100;
      return victim * 10 - attacker;
    },
    evaluate(pos: BotPos, side: Side): number {
      return evaluate(pos.board, side as BotSide, advanced);
    },
    isInCheck(pos: BotPos, side: Side): boolean {
      return isInCheck(pos.board, side as BotSide);
    },
    moveKey(move: BotLegalMove): string {
      return `${move.from}-${move.to}`;
    },
    stalemateIsLoss: true,
  };
}

export const xiangqiBot: BotPolicy<XiangqiBotView, XiangqiBotAction> = {
  chooseAction(
    view: XiangqiBotView,
    selfId: string,
    rng: Rng,
    difficulty: BotDifficulty,
  ): XiangqiBotAction {
    const side: BotSide =
      view.you?.side ?? (view.players.find((p) => p.id === selfId)?.side as BotSide | undefined) ?? 0;
    const legal: BotLegalMove[] = view.you?.legalMoves.length
      ? view.you.legalMoves.map((m) => {
          const piece = view.board[m.from];
          const target = view.board[m.to];
          return {
            from: m.from,
            to: m.to,
            piece: piece ? piece.type : undefined,
            captured: target ? target.type : undefined,
          };
        })
      : legalMovesForSide(view.board, side);

    if (legal.length === 0) return { type: 'resign' };

    if (difficulty === 'easy') {
      if (rng.next() < 0.35) {
        const pick = rng.pick<BotLegalMove>(legal);
        return { type: 'move', from: pick.from, to: pick.to };
      }
      const scored = legal
        .map((m) => {
          const { board: next } = applyMoveToBoard(view.board, m.from, m.to);
          return { m, score: evaluate(next, side, false) };
        })
        .sort((a, b) => b.score - a.score);
      const top = scored.slice(0, Math.min(3, scored.length));
      const pick = rng.pick<{ m: BotLegalMove; score: number }>(top).m;
      return { type: 'move', from: pick.from, to: pick.to };
    }

    const pos: BotPos = { board: view.board, current: side };

    if (difficulty === 'normal') {
      const result = search(pos, makeSearchConfig(false), { maxDepth: 3, quiescence: true });
      const move = result.move ?? legal[0] ?? (rng.pick<BotLegalMove>(legal));
      return { type: 'move', from: move.from, to: move.to };
    }

    // hard / ai: iterative deepening under a wall-clock budget with alpha-beta + quiescence + killer moves
    const result = search(pos, makeSearchConfig(true), {
      maxDepth: 16,
      timeBudgetMs: 550,
      quiescence: true,
    });
    const move = result.move ?? legal[0] ?? (rng.pick<BotLegalMove>(legal));
    return { type: 'move', from: move.from, to: move.to };
  },
};
