import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import { BOARD_SIZE, getFlipsForMove, getLegalMoves } from './rules.js';
import type { ReversiAction, ReversiPlayer, ReversiSide } from './state.js';

export interface ReversiBotView {
  players: [ReversiPlayer, ReversiPlayer];
  board: (ReversiSide | null)[];
  turn: ReversiSide;
  legalMoves: { row: number; col: number; flipsCount: number }[];
  phase: 'playing' | 'game_over';
}

const POSITIONAL_WEIGHTS: readonly number[][] = [
  [100, -20, 10, 5, 5, 10, -20, 100],
  [-20, -50, -2, -2, -2, -2, -50, -20],
  [10, -2, -1, -1, -1, -1, -2, 10],
  [5, -2, -1, 0, 0, -1, -2, 5],
  [5, -2, -1, 0, 0, -1, -2, 5],
  [10, -2, -1, -1, -1, -1, -2, 10],
  [-20, -50, -2, -2, -2, -2, -50, -20],
  [100, -20, 10, 5, 5, 10, -20, 100],
];

export const reversiBot: BotPolicy<ReversiBotView, ReversiAction> = {
  chooseAction(
    view: ReversiBotView,
    selfId: string,
    rng: Rng,
    difficulty: BotDifficulty,
  ): ReversiAction {
    if (view.legalMoves.length === 0) {
      return { type: 'pass' };
    }

    const selfIdx = view.players.findIndex((p) => p.id === selfId);
    const selfSide: ReversiSide = selfIdx >= 0 ? view.players[selfIdx]!.side : view.turn;

    if (difficulty === 'easy') {
      const pick = view.legalMoves[rng.int(view.legalMoves.length)]!;
      return { type: 'place', row: pick.row, col: pick.col };
    }

    if (difficulty === 'normal') {
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestMoves: { row: number; col: number }[] = [];

      for (const m of view.legalMoves) {
        const posVal = POSITIONAL_WEIGHTS[m.row]![m.col]!;
        const score = posVal * 2 + m.flipsCount * 3 + rng.int(5);
        if (score > bestScore) {
          bestScore = score;
          bestMoves = [{ row: m.row, col: m.col }];
        } else if (score === bestScore) {
          bestMoves.push({ row: m.row, col: m.col });
        }
      }

      const pick = bestMoves[rng.int(bestMoves.length)]!;
      return { type: 'place', row: pick.row, col: pick.col };
    }

    // difficulty === 'hard': Minimax with Alpha-Beta pruning (depth 4)
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestMove = view.legalMoves[0]!;

    for (const m of view.legalMoves) {
      const simBoard = applySimulatedMove(view.board, m.row, m.col, selfSide);
      const score = minimax(simBoard, 3, false, selfSide, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
    }

    return { type: 'place', row: bestMove.row, col: bestMove.col };
  },
};

function applySimulatedMove(
  board: readonly (ReversiSide | null)[],
  row: number,
  col: number,
  side: ReversiSide,
): (ReversiSide | null)[] {
  const next = [...board];
  const flips = getFlipsForMove(board, row, col, side);
  next[row * BOARD_SIZE + col] = side;
  for (const f of flips) {
    next[f.row * BOARD_SIZE + f.col] = side;
  }
  return next;
}

function evaluateBoard(board: readonly (ReversiSide | null)[], mySide: ReversiSide): number {
  const oppSide: ReversiSide = mySide === 0 ? 1 : 0;
  let score = 0;
  let myDiscs = 0;
  let oppDiscs = 0;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const val = board[r * BOARD_SIZE + c];
      if (val === mySide) {
        myDiscs++;
        score += POSITIONAL_WEIGHTS[r]![c]!;
      } else if (val === oppSide) {
        oppDiscs++;
        score -= POSITIONAL_WEIGHTS[r]![c]!;
      }
    }
  }

  // Corner stability bonus
  const corners = [
    [0, 0],
    [0, 7],
    [7, 0],
    [7, 7],
  ];
  for (const [cr, cc] of corners) {
    const val = board[cr! * BOARD_SIZE + cc!]!;
    if (val === mySide) score += 200;
    else if (val === oppSide) score -= 200;
  }

  // Mobility
  const myMoves = getLegalMoves(board, mySide).length;
  const oppMoves = getLegalMoves(board, oppSide).length;
  score += (myMoves - oppMoves) * 15;

  // Endgame disc parity
  const totalDiscs = myDiscs + oppDiscs;
  if (totalDiscs > 54) {
    score += (myDiscs - oppDiscs) * 50;
  }

  return score;
}

function minimax(
  board: readonly (ReversiSide | null)[],
  depth: number,
  isMaximizing: boolean,
  mySide: ReversiSide,
  alpha: number,
  beta: number,
): number {
  if (depth === 0) {
    return evaluateBoard(board, mySide);
  }

  const oppSide: ReversiSide = mySide === 0 ? 1 : 0;
  const currSide = isMaximizing ? mySide : oppSide;
  const legal = getLegalMoves(board, currSide);

  if (legal.length === 0) {
    const otherLegal = getLegalMoves(board, isMaximizing ? oppSide : mySide);
    if (otherLegal.length === 0) {
      // Game over state
      return evaluateBoard(board, mySide);
    }
    // Pass turn
    return minimax(board, depth - 1, !isMaximizing, mySide, alpha, beta);
  }

  if (isMaximizing) {
    let maxEval = Number.NEGATIVE_INFINITY;
    for (const m of legal) {
      const nextBoard = applySimulatedMove(board, m.row, m.col, mySide);
      const evalScore = minimax(nextBoard, depth - 1, false, mySide, alpha, beta);
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Number.POSITIVE_INFINITY;
    for (const m of legal) {
      const nextBoard = applySimulatedMove(board, m.row, m.col, oppSide);
      const evalScore = minimax(nextBoard, depth - 1, true, mySide, alpha, beta);
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}
