import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import {
  COLS,
  ROWS,
  checkWinningLine,
  getLowestEmptyRow,
} from './rules.js';
import type { Connect4Action, Connect4Player, Connect4Side } from './state.js';

export interface Connect4BotView {
  players: [Connect4Player, Connect4Player];
  board: (Connect4Side | null)[];
  turn: Connect4Side;
  legalCols: number[];
  phase: 'playing' | 'game_over';
}

const COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];

export const connect4Bot: BotPolicy<Connect4BotView, Connect4Action> = {
  chooseAction(
    view: Connect4BotView,
    selfId: string,
    rng: Rng,
    difficulty: BotDifficulty,
  ): Connect4Action {
    if (view.legalCols.length === 0) {
      return { type: 'drop', col: 0 };
    }

    const selfIdx = view.players.findIndex((p) => p.id === selfId);
    const selfSide: Connect4Side = selfIdx >= 0 ? view.players[selfIdx]!.side : view.turn;
    const oppSide: Connect4Side = selfSide === 0 ? 1 : 0;

    // Check immediate winning move
    for (const c of view.legalCols) {
      const r = getLowestEmptyRow(view.board, c);
      if (r !== null) {
        const nextBoard = [...view.board];
        nextBoard[r * COLS + c] = selfSide;
        if (checkWinningLine(nextBoard, r, c, selfSide)) {
          return { type: 'drop', col: c };
        }
      }
    }

    // Check immediate opponent block
    for (const c of view.legalCols) {
      const r = getLowestEmptyRow(view.board, c);
      if (r !== null) {
        const nextBoard = [...view.board];
        nextBoard[r * COLS + c] = oppSide;
        if (checkWinningLine(nextBoard, r, c, oppSide)) {
          // Easy bots have 30% chance to miss the block
          if (difficulty !== 'easy' || rng.next() < 0.7) {
            return { type: 'drop', col: c };
          }
        }
      }
    }

    if (difficulty === 'easy') {
      const pick = view.legalCols[rng.int(view.legalCols.length)]!;
      return { type: 'drop', col: pick };
    }

    const depth = difficulty === 'normal' ? 3 : 6;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestCol = view.legalCols[0]!;

    const orderedCols = COLUMN_ORDER.filter((c) => view.legalCols.includes(c));

    for (const c of orderedCols) {
      const r = getLowestEmptyRow(view.board, c);
      if (r !== null) {
        const nextBoard = [...view.board];
        nextBoard[r * COLS + c] = selfSide;
        const score = minimax(
          nextBoard,
          depth - 1,
          false,
          selfSide,
          r,
          c,
          Number.NEGATIVE_INFINITY,
          Number.POSITIVE_INFINITY,
        );
        if (score > bestScore) {
          bestScore = score;
          bestCol = c;
        }
      }
    }

    return { type: 'drop', col: bestCol };
  },
};

function scoreWindow(window: (Connect4Side | null)[], mySide: Connect4Side): number {
  const oppSide: Connect4Side = mySide === 0 ? 1 : 0;
  let myCount = 0;
  let oppCount = 0;
  let emptyCount = 0;

  for (const cell of window) {
    if (cell === mySide) myCount++;
    else if (cell === oppSide) oppCount++;
    else emptyCount++;
  }

  if (myCount === 4) return 100000;
  if (myCount === 3 && emptyCount === 1) return 100;
  if (myCount === 2 && emptyCount === 2) return 10;
  if (oppCount === 3 && emptyCount === 1) return -90;
  if (oppCount === 2 && emptyCount === 2) return -8;
  return 0;
}

const get = (board: readonly (Connect4Side | null)[], r: number, c: number): Connect4Side | null => {
  return board[r * COLS + c] ?? null;
};

function evaluateBoard(board: readonly (Connect4Side | null)[], mySide: Connect4Side): number {
  let score = 0;

  // Center column preference
  const centerCol = 3;
  for (let r = 0; r < ROWS; r++) {
    if (get(board, r, centerCol) === mySide) score += 6;
  }

  // Horizontal windows
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const win: (Connect4Side | null)[] = [
        get(board, r, c),
        get(board, r, c + 1),
        get(board, r, c + 2),
        get(board, r, c + 3),
      ];
      score += scoreWindow(win, mySide);
    }
  }

  // Vertical windows
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      const win: (Connect4Side | null)[] = [
        get(board, r, c),
        get(board, r + 1, c),
        get(board, r + 2, c),
        get(board, r + 3, c),
      ];
      score += scoreWindow(win, mySide);
    }
  }

  // Diagonal Down-Right (\)
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const win: (Connect4Side | null)[] = [
        get(board, r, c),
        get(board, r + 1, c + 1),
        get(board, r + 2, c + 2),
        get(board, r + 3, c + 3),
      ];
      score += scoreWindow(win, mySide);
    }
  }

  // Diagonal Up-Right (/)
  for (let r = 3; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const win: (Connect4Side | null)[] = [
        get(board, r, c),
        get(board, r - 1, c + 1),
        get(board, r - 2, c + 2),
        get(board, r - 3, c + 3),
      ];
      score += scoreWindow(win, mySide);
    }
  }

  return score;
}

function minimax(
  board: readonly (Connect4Side | null)[],
  depth: number,
  isMaximizing: boolean,
  mySide: Connect4Side,
  lastRow: number,
  lastCol: number,
  alpha: number,
  beta: number,
): number {
  const oppSide: Connect4Side = mySide === 0 ? 1 : 0;
  const prevSide: Connect4Side = isMaximizing ? oppSide : mySide;

  // Check if last move won
  if (checkWinningLine(board, lastRow, lastCol, prevSide)) {
    return prevSide === mySide ? 100000 + depth * 100 : -100000 - depth * 100;
  }

  if (depth === 0) {
    return evaluateBoard(board, mySide);
  }

  const legalCols: number[] = [];
  for (const c of COLUMN_ORDER) {
    if (board[0 * COLS + c] === null) legalCols.push(c);
  }

  if (legalCols.length === 0) {
    return 0; // Draw
  }

  const currSide = isMaximizing ? mySide : oppSide;

  if (isMaximizing) {
    let maxEval = Number.NEGATIVE_INFINITY;
    for (const c of legalCols) {
      const r = getLowestEmptyRow(board, c);
      if (r !== null) {
        const nextBoard = [...board];
        nextBoard[r * COLS + c] = currSide;
        const evalScore = minimax(nextBoard, depth - 1, false, mySide, r, c, alpha, beta);
        maxEval = Math.max(maxEval, evalScore);
        alpha = Math.max(alpha, evalScore);
        if (beta <= alpha) break;
      }
    }
    return maxEval;
  } else {
    let minEval = Number.POSITIVE_INFINITY;
    for (const c of legalCols) {
      const r = getLowestEmptyRow(board, c);
      if (r !== null) {
        const nextBoard = [...board];
        nextBoard[r * COLS + c] = currSide;
        const evalScore = minimax(nextBoard, depth - 1, true, mySide, r, c, alpha, beta);
        minEval = Math.min(minEval, evalScore);
        beta = Math.min(beta, evalScore);
        if (beta <= alpha) break;
      }
    }
    return minEval;
  }
}
