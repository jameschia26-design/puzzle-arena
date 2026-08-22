import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import {
  applyMoveToBoard,
  colOf,
  hasCrossedRiver,
  isInCheck,
  pieceMoves,
  rowOf,
  SIZE,
} from './movegen.js';

/**
 * `packages/games/src/chess-core/` did not exist yet when this was written
 * (checked via glob before starting), so this is a self-contained search —
 * per the plan doc's instruction not to block on the other agent and not to
 * create chess-core here to avoid a collision.
 *
 * This module intentionally imports only from `./movegen.js`, which is
 * state-free (pure functions of `(board, side)`, no `XiangqiState`
 * dependency) — exactly the "state-free primitives" shape the plan doc
 * endorses for shared search code, and the same pattern Connect 4's bot
 * uses with its own `rules.ts`. It never imports `./state.js` or
 * `./rules.js`'s engine-level helpers (setup/reduce/positionKey/etc), so a
 * bot policy still only ever sees plain view data, never engine state —
 * bots.test.ts asserts this invariant at runtime.
 */

type BotSide = 0 | 1;

interface BotPiece {
  side: BotSide;
  type: 'general' | 'advisor' | 'elephant' | 'horse' | 'chariot' | 'cannon' | 'soldier';
}

interface BotLegalMove {
  from: number;
  to: number;
}

export interface XiangqiBotPublicPlayer {
  id: string;
  seat: number;
  side: BotSide;
}

export interface XiangqiBotView {
  board: (BotPiece | null)[];
  players: XiangqiBotPublicPlayer[];
  current: string | null;
  phase: 'playing' | 'game_over';
  you: {
    id: string;
    side: BotSide;
    inCheck: boolean;
    legalMoves: BotLegalMove[];
  } | null;
}

export type XiangqiBotAction = { type: 'move'; from: number; to: number } | { type: 'resign' };

function legalMovesForSide(board: (BotPiece | null)[], side: BotSide): BotLegalMove[] {
  const moves: BotLegalMove[] = [];
  for (let from = 0; from < SIZE; from++) {
    const piece = board[from];
    if (!piece || piece.side !== side) continue;
    for (const to of pieceMoves(board, from)) {
      const { board: next } = applyMoveToBoard(board, from, to);
      if (!isInCheck(next, side)) moves.push({ from, to });
    }
  }
  return moves;
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

const PIECE_VALUE: Record<BotPiece['type'], number> = {
  general: 100_000,
  chariot: 900,
  cannon: 450,
  horse: 400,
  advisor: 200,
  elephant: 200,
  soldier: 100,
};

/** Positive is good for `side`. */
function evaluate(board: (BotPiece | null)[], side: BotSide): number {
  let score = 0;
  for (let i = 0; i < SIZE; i++) {
    const piece = board[i];
    if (!piece) continue;
    const row = rowOf(i);
    const col = colOf(i);
    let value = PIECE_VALUE[piece.type];
    if (piece.type === 'soldier' && hasCrossedRiver(piece.side, row)) value = 200;

    let bonus = 0;
    if (piece.type === 'horse' && col >= 2 && col <= 6 && row >= 2 && row <= 7) bonus += 15;
    if ((piece.type === 'chariot' || piece.type === 'cannon') && col >= 3 && col <= 5) bonus += 12;
    if (piece.type === 'soldier' && hasCrossedRiver(piece.side, row)) bonus += 8;

    score += (piece.side === side ? 1 : -1) * (value + bonus);
  }
  return score;
}

function captureValue(board: (BotPiece | null)[], move: BotLegalMove): number {
  const target = board[move.to];
  return target ? PIECE_VALUE[target.type] : 0;
}

function orderMoves(board: (BotPiece | null)[], moves: BotLegalMove[]): BotLegalMove[] {
  return [...moves].sort((a, b) => captureValue(board, b) - captureValue(board, a));
}

/* ------------------------------------------------------------------ */
/* Search: negamax with alpha-beta + quiescence, optionally time-boxed */
/* ------------------------------------------------------------------ */

function quiescence(
  board: (BotPiece | null)[],
  side: BotSide,
  alpha: number,
  beta: number,
  deadline: number,
): number {
  const standPat = evaluate(board, side);
  if (standPat >= beta) return beta;
  if (alpha < standPat) alpha = standPat;

  if (Date.now() > deadline) return alpha;

  const opponent: BotSide = side === 0 ? 1 : 0;
  const captures = orderMoves(
    board,
    legalMovesForSide(board, side).filter((m) => board[m.to] !== null),
  );

  for (const move of captures) {
    if (Date.now() > deadline) break;
    const { board: next } = applyMoveToBoard(board, move.from, move.to);
    const score = -quiescence(next, opponent, -beta, -alpha, deadline);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(
  board: (BotPiece | null)[],
  side: BotSide,
  depth: number,
  alpha: number,
  beta: number,
  deadline: number,
): number {
  const legal = legalMovesForSide(board, side);
  if (legal.length === 0) {
    // No legal moves is always a loss for `side` in Xiangqi — checkmate and
    // stalemate are both losses, so the bot never needs to special-case them.
    return -90_000 - depth;
  }
  if (depth <= 0 || Date.now() > deadline) {
    return quiescence(board, side, alpha, beta, deadline);
  }

  const opponent: BotSide = side === 0 ? 1 : 0;
  let best = -Infinity;
  for (const move of orderMoves(board, legal)) {
    if (Date.now() > deadline) break;
    const { board: next } = applyMoveToBoard(board, move.from, move.to);
    const score = -negamax(next, opponent, depth - 1, -beta, -alpha, deadline);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function bestMoveAtDepth(
  board: (BotPiece | null)[],
  side: BotSide,
  legal: BotLegalMove[],
  depth: number,
  deadline: number,
): { move: BotLegalMove; score: number } {
  const opponent: BotSide = side === 0 ? 1 : 0;
  let best = legal[0] as BotLegalMove;
  let bestScore = -Infinity;
  for (const move of orderMoves(board, legal)) {
    if (Date.now() > deadline) break;
    const { board: next } = applyMoveToBoard(board, move.from, move.to);
    const score = -negamax(next, opponent, depth - 1, -Infinity, Infinity, deadline);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return { move: best, score: bestScore };
}

const HARD_BUDGET_MS = 550;

export const xiangqiBot: BotPolicy<XiangqiBotView, XiangqiBotAction> = {
  chooseAction(view, selfId, rng: Rng, difficulty: BotDifficulty): XiangqiBotAction {
    const side: BotSide =
      view.you?.side ?? (view.players.find((p) => p.id === selfId)?.side as BotSide | undefined) ?? 0;
    const legal = view.you?.legalMoves.length ? view.you.legalMoves : legalMovesForSide(view.board, side);

    if (legal.length === 0) return { type: 'resign' };

    if (difficulty === 'easy') {
      if (rng.next() < 0.35) {
        const pick = rng.pick(legal);
        return { type: 'move', from: pick.from, to: pick.to };
      }
      const scored = legal
        .map((m) => {
          const { board: next } = applyMoveToBoard(view.board, m.from, m.to);
          return { m, score: evaluate(next, side) };
        })
        .sort((a, b) => b.score - a.score);
      const top = scored.slice(0, Math.min(3, scored.length));
      const pick = rng.pick(top).m;
      return { type: 'move', from: pick.from, to: pick.to };
    }

    if (difficulty === 'normal') {
      const deadline = Date.now() + 5_000; // generous — depth 3 is cheap, this is just a safety cap
      const { move } = bestMoveAtDepth(view.board, side, legal, 3, deadline);
      return { type: 'move', from: move.from, to: move.to };
    }

    // hard / ai: iterative deepening under a wall-clock budget.
    const deadline = Date.now() + HARD_BUDGET_MS;
    let best = legal[0] as BotLegalMove;
    for (let depth = 1; depth <= 8; depth++) {
      if (Date.now() > deadline) break;
      const result = bestMoveAtDepth(view.board, side, legal, depth, deadline);
      if (Date.now() <= deadline) best = result.move;
    }
    return { type: 'move', from: best.from, to: best.to };
  },
};
