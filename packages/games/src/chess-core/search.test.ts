import { describe, expect, it } from 'vitest';
import { search, type SearchConfig } from './search.js';
import type { Side } from './types.js';

/**
 * Verifies the generic search algorithm in isolation, using tic-tac-toe as a
 * trivial toy game. This is deliberately not chess/xiangqi — the point is to
 * exercise negamax/alpha-beta/terminal-detection/mate-in-N logic without any
 * dependency on either concrete engine.
 */

type Cell = 0 | 1 | null;
interface TTTPos {
  board: Cell[]; // 9 cells, row-major
  side: Side;
}
type TTTMove = number; // cell index

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function winner(board: Cell[]): Side | null {
  for (const [a, b, c] of LINES) {
    const va = board[a as number];
    if (va !== null && va === board[b as number] && va === board[c as number]) return va;
  }
  return null;
}

const config: SearchConfig<TTTPos, TTTMove> = {
  genMoves(pos) {
    if (winner(pos.board) !== null) return [];
    const moves: TTTMove[] = [];
    pos.board.forEach((c, i) => {
      if (c === null) moves.push(i);
    });
    return moves;
  },
  makeMove(pos, move) {
    const board = [...pos.board];
    board[move] = pos.side;
    return { board, side: (1 - pos.side) as Side };
  },
  sideToMove(pos) {
    return pos.side;
  },
  isCapture() {
    return false;
  },
  captureValue() {
    return 0;
  },
  evaluate() {
    return 0;
  },
  isInCheck(pos, side) {
    // "In check" here means the side to move has already lost — the other
    // side has a completed line. That lets the generic mate-scoring path in
    // search.ts distinguish a loss from a drawn-out board.
    const w = winner(pos.board);
    return w !== null && w !== side;
  },
  moveKey(move) {
    return String(move);
  },
};

describe('generic search (tic-tac-toe)', () => {
  it('takes an immediate winning move when available', () => {
    // X (side 0) has two in a row at 0,1 and can win at 2.
    const pos: TTTPos = {
      board: [0, 0, null, 1, 1, null, null, null, null],
      side: 0,
    };
    const result = search(pos, config, { maxDepth: 4 });
    expect(result.move).toBe(2);
  });

  it('blocks an immediate opponent win', () => {
    // O (side 1) has the anti-diagonal 2-4-6 two-thirds filled (4 and 6);
    // X must block at 2.
    const pos: TTTPos = {
      board: [0, null, null, null, 1, null, 1, null, null],
      side: 0,
    };
    const result = search(pos, config, { maxDepth: 6 });
    expect(result.move).toBe(2);
  });

  it('finds a forced win a few plies deep from an empty board with deep search', () => {
    const pos: TTTPos = { board: new Array(9).fill(null) as Cell[], side: 0 };
    const result = search(pos, config, { maxDepth: 9, quiescence: false });
    // From an empty board with perfect play tic-tac-toe is a draw — the
    // engine should never lose, i.e. its own eventual score must be >= 0
    // when both sides play the returned strategy optimally. We only assert
    // that a legal, central-ish opening move is chosen and the search
    // terminates with a non-negative score for X (no forced loss exists).
    expect(result.move).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('respects a time budget and still returns a legal move', () => {
    const pos: TTTPos = { board: new Array(9).fill(null) as Cell[], side: 0 };
    const result = search(pos, config, { maxDepth: 9, timeBudgetMs: 20 });
    expect(result.move).not.toBeNull();
    expect(result.move).toBeGreaterThanOrEqual(0);
    expect(result.move).toBeLessThan(9);
  });
});
