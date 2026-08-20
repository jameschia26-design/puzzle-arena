import type { LogEntry } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type ReduceResult } from '../engine.js';
import type {
  ReversiAction,
  ReversiSide,
  ReversiState,
} from './state.js';

export const BOARD_SIZE = 8;

export const DIRECTIONS: readonly [number, number][] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export function createInitialBoard(): (ReversiSide | null)[] {
  const b = new Array<ReversiSide | null>(BOARD_SIZE * BOARD_SIZE).fill(null);
  // Standard Othello start:
  // (3,3)=1 (Light), (3,4)=0 (Dark), (4,3)=0 (Dark), (4,4)=1 (Light)
  b[3 * BOARD_SIZE + 3] = 1;
  b[3 * BOARD_SIZE + 4] = 0;
  b[4 * BOARD_SIZE + 3] = 0;
  b[4 * BOARD_SIZE + 4] = 1;
  return b;
}

export function getFlipsForMove(
  board: readonly (ReversiSide | null)[],
  row: number,
  col: number,
  side: ReversiSide,
): { row: number; col: number }[] {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return [];
  if (board[row * BOARD_SIZE + col] !== null) return [];

  const opponent: ReversiSide = side === 0 ? 1 : 0;
  const flips: { row: number; col: number }[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    let r = row + dr;
    let c = col + dc;
    const lineFlips: { row: number; col: number }[] = [];

    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
      const cell = board[r * BOARD_SIZE + c];
      if (cell === opponent) {
        lineFlips.push({ row: r, col: c });
      } else if (cell === side) {
        if (lineFlips.length > 0) {
          flips.push(...lineFlips);
        }
        break;
      } else {
        // empty cell breaks line
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return flips;
}

export interface LegalMove {
  row: number;
  col: number;
  flips: { row: number; col: number }[];
}

export function getLegalMoves(
  board: readonly (ReversiSide | null)[],
  side: ReversiSide,
): LegalMove[] {
  const moves: LegalMove[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r * BOARD_SIZE + c] !== null) continue;
      const flips = getFlipsForMove(board, r, c, side);
      if (flips.length > 0) {
        moves.push({ row: r, col: c, flips });
      }
    }
  }
  return moves;
}

export function countDiscs(board: readonly (ReversiSide | null)[]): { dark: number; light: number } {
  let dark = 0;
  let light = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) dark++;
    else if (board[i] === 1) light++;
  }
  return { dark, light };
}

export function actorToAct(s: ReversiState): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.turn].id;
}

export function autoAction(s: ReversiState, playerId: string): ReversiAction {
  const pIdx = s.players.findIndex((p) => p.id === playerId);
  if (pIdx < 0 || s.phase === 'game_over') return { type: 'pass' };
  const side = s.players[pIdx]!.side;
  const legal = getLegalMoves(s.board, side);
  if (legal.length > 0) {
    const m = legal[0]!;
    return { type: 'place', row: m.row, col: m.col };
  }
  return { type: 'pass' };
}

export function applyMove(
  s: ReversiState,
  playerId: string,
  action: ReversiAction,
): ReduceResult<ReversiState> {
  if (s.phase === 'game_over') {
    return { ok: false, error: 'Game is already over' };
  }

  const currentIdx = s.players.findIndex((p) => p.id === playerId);
  if (currentIdx < 0) return { ok: false, error: 'Player not in game' };

  const currentSide = s.players[currentIdx]!.side;
  if (currentSide !== s.turn) {
    return { ok: false, error: 'Not your turn' };
  }

  const nextState: ReversiState = {
    ...s,
    board: [...s.board],
    players: [
      { ...s.players[0] },
      { ...s.players[1] },
    ],
  };

  const logs: LogEntry[] = [];
  const legalMoves = getLegalMoves(nextState.board, currentSide);

  if (action.type === 'pass') {
    if (legalMoves.length > 0) {
      return { ok: false, error: 'Cannot pass when legal moves exist' };
    }

    nextState.consecutivePasses += 1;
    logs.push(makeLog(`${nextState.players[currentIdx]!.name} passed`, playerId));

    // If both passed consecutively, game ends
    if (nextState.consecutivePasses >= 2) {
      return finishGame(nextState, logs);
    }

    // Switch turn
    const otherSide: ReversiSide = currentSide === 0 ? 1 : 0;
    nextState.turn = otherSide;
    const nextLegal = getLegalMoves(nextState.board, otherSide);
    if (nextLegal.length === 0) {
      // Other player also has no legal moves -> game ends
      nextState.consecutivePasses += 1;
      return finishGame(nextState, logs);
    }

    const stamped = stampLogs(nextState, logs);
    nextState.log = [...nextState.log, ...stamped];
    return { ok: true, state: nextState, log: stamped };
  }

  // action.type === 'place'
  const { row, col } = action;
  const matchingMove = legalMoves.find((m) => m.row === row && m.col === col);
  if (!matchingMove) {
    return { ok: false, error: `Invalid placement at row ${row}, col ${col}` };
  }

  // Place disc
  nextState.board[row * BOARD_SIZE + col] = currentSide;
  for (const f of matchingMove.flips) {
    nextState.board[f.row * BOARD_SIZE + f.col] = currentSide;
  }

  nextState.lastMove = {
    row,
    col,
    flipped: matchingMove.flips,
    side: currentSide,
  };
  nextState.consecutivePasses = 0;

  // Update disc counts
  const counts = countDiscs(nextState.board);
  nextState.players[0].discs = counts.dark;
  nextState.players[1].discs = counts.light;

  logs.push(
    makeLog(
      `${nextState.players[currentIdx]!.name} played at (${row + 1},${col + 1}) and flipped ${matchingMove.flips.length} disc${matchingMove.flips.length === 1 ? '' : 's'}`,
      playerId,
    ),
  );

  // Check if board full or one player wiped out
  if (counts.dark === 0 || counts.light === 0 || counts.dark + counts.light === BOARD_SIZE * BOARD_SIZE) {
    return finishGame(nextState, logs);
  }

  // Switch turn to opponent
  const otherSide: ReversiSide = currentSide === 0 ? 1 : 0;
  const otherLegal = getLegalMoves(nextState.board, otherSide);

  if (otherLegal.length > 0) {
    nextState.turn = otherSide;
  } else {
    // Opponent has no moves! Turn passes back to current player if they have moves
    const currentLegalAgain = getLegalMoves(nextState.board, currentSide);
    if (currentLegalAgain.length > 0) {
      nextState.consecutivePasses = 1;
      const otherName = nextState.players[otherSide].name;
      logs.push(makeLog(`${otherName} has no legal moves and passes`, nextState.players[otherSide].id));
      nextState.turn = currentSide;
    } else {
      // Neither player has legal moves -> game over
      nextState.consecutivePasses = 2;
      return finishGame(nextState, logs);
    }
  }

  const stamped = stampLogs(nextState, logs);
  nextState.log = [...nextState.log, ...stamped];
  return { ok: true, state: nextState, log: stamped };
}

function finishGame(s: ReversiState, logs: LogEntry[]): ReduceResult<ReversiState> {
  s.phase = 'game_over';
  const counts = countDiscs(s.board);
  s.players[0].discs = counts.dark;
  s.players[1].discs = counts.light;

  if (counts.dark > counts.light) {
    s.winner = s.players[0].id;
    s.winReason = 'discs';
    logs.push(makeLog(`${s.players[0].name} wins with ${counts.dark} to ${counts.light} discs!`, s.players[0].id));
  } else if (counts.light > counts.dark) {
    s.winner = s.players[1].id;
    s.winReason = 'discs';
    logs.push(makeLog(`${s.players[1].name} wins with ${counts.light} to ${counts.dark} discs!`, s.players[1].id));
  } else {
    s.winner = null;
    s.winReason = 'draw';
    logs.push(makeLog(`Game drawn with ${counts.dark} discs each!`));
  }

  const stamped = stampLogs(s, logs);
  s.log = [...s.log, ...stamped];
  return { ok: true, state: s, log: stamped };
}
