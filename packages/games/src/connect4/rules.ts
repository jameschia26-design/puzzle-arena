import type { LogEntry } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type ReduceResult } from '../engine.js';
import type {
  Connect4Action,
  Connect4Side,
  Connect4State,
} from './state.js';

export const ROWS = 6;
export const COLS = 7;

export function createInitialBoard(): (Connect4Side | null)[] {
  return new Array<Connect4Side | null>(ROWS * COLS).fill(null);
}

export function getLowestEmptyRow(
  board: readonly (Connect4Side | null)[],
  col: number,
): number | null {
  if (col < 0 || col >= COLS) return null;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r * COLS + col] === null) {
      return r;
    }
  }
  return null;
}

export function getLegalColumns(board: readonly (Connect4Side | null)[]): number[] {
  const legal: number[] = [];
  for (let c = 0; c < COLS; c++) {
    if (board[0 * COLS + c] === null) {
      legal.push(c);
    }
  }
  return legal;
}

export function checkWinningLine(
  board: readonly (Connect4Side | null)[],
  lastRow: number,
  lastCol: number,
  side: Connect4Side,
): { row: number; col: number }[] | null {
  const directions: readonly [number, number][] = [
    [0, 1],  // Horizontal
    [1, 0],  // Vertical
    [1, 1],  // Diagonal Down-Right (\)
    [-1, 1], // Diagonal Up-Right (/)
  ];

  for (const [dr, dc] of directions) {
    const line: { row: number; col: number }[] = [{ row: lastRow, col: lastCol }];

    // Forward
    let r = lastRow + dr;
    let c = lastCol + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === side) {
      line.push({ row: r, col: c });
      r += dr;
      c += dc;
    }

    // Backward
    r = lastRow - dr;
    c = lastCol - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === side) {
      line.unshift({ row: r, col: c });
      r -= dr;
      c -= dc;
    }

    if (line.length >= 4) {
      return line;
    }
  }

  return null;
}

export function actorToAct(s: Connect4State): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.turn].id;
}

export function autoAction(s: Connect4State, _playerId: string): Connect4Action {
  const legal = getLegalColumns(s.board);
  if (legal.length > 0) {
    // Prefer center-ish column if available
    const centerPreferred = [3, 2, 4, 1, 5, 0, 6];
    for (const c of centerPreferred) {
      if (legal.includes(c)) return { type: 'drop', col: c };
    }
    return { type: 'drop', col: legal[0]! };
  }
  return { type: 'drop', col: 0 };
}

export function applyMove(
  s: Connect4State,
  playerId: string,
  action: Connect4Action,
): ReduceResult<Connect4State> {
  if (s.phase === 'game_over') {
    return { ok: false, error: 'Game is already over' };
  }

  const currentIdx = s.players.findIndex((p) => p.id === playerId);
  if (currentIdx < 0) return { ok: false, error: 'Player not in game' };

  const currentSide = s.players[currentIdx]!.side;
  if (currentSide !== s.turn) {
    return { ok: false, error: 'Not your turn' };
  }

  const { col } = action;
  const targetRow = getLowestEmptyRow(s.board, col);
  if (targetRow === null) {
    return { ok: false, error: `Column ${col + 1} is already full` };
  }

  const nextState: Connect4State = {
    ...s,
    board: [...s.board],
    players: [
      { ...s.players[0] },
      { ...s.players[1] },
    ],
  };

  const logs: LogEntry[] = [];
  nextState.board[targetRow * COLS + col] = currentSide;
  nextState.lastMove = { row: targetRow, col, side: currentSide };

  logs.push(
    makeLog(
      `${nextState.players[currentIdx]!.name} dropped a disc in column ${col + 1}`,
      playerId,
    ),
  );

  // Check 4-in-a-row win
  const winLine = checkWinningLine(nextState.board, targetRow, col, currentSide);
  if (winLine) {
    nextState.phase = 'game_over';
    nextState.winner = playerId;
    nextState.winReason = 'connect4';
    nextState.winningLine = winLine;
    logs.push(
      makeLog(
        `🏆 ${nextState.players[currentIdx]!.name} connected 4 in a row and won!`,
        playerId,
      ),
    );
    const stamped = stampLogs(nextState, logs);
    nextState.log = [...nextState.log, ...stamped];
    return { ok: true, state: nextState, log: stamped };
  }

  // Check draw (board full)
  const remaining = getLegalColumns(nextState.board);
  if (remaining.length === 0) {
    nextState.phase = 'game_over';
    nextState.winner = null;
    nextState.winReason = 'draw';
    logs.push(makeLog('Game drawn! Board is completely full.'));
    const stamped = stampLogs(nextState, logs);
    nextState.log = [...nextState.log, ...stamped];
    return { ok: true, state: nextState, log: stamped };
  }

  // Switch turn
  nextState.turn = currentSide === 0 ? 1 : 0;

  const stamped = stampLogs(nextState, logs);
  nextState.log = [...nextState.log, ...stamped];
  return { ok: true, state: nextState, log: stamped };
}
