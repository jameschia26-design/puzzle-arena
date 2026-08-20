import type { BaseState } from '../engine.js';
import type { LogEntry } from '@puzzle-arena/shared';

export type Connect4Side = 0 | 1; // 0 = Player 1 (Red / Pink, moves first), 1 = Player 2 (Yellow / Amber)

export type Connect4Action = { type: 'drop'; col: number };

export interface Connect4Player {
  id: string;
  name: string;
  side: Connect4Side;
}

export interface Connect4Config {
  turnTimeLimitSec: number;
}

export interface Connect4LastMove {
  row: number;
  col: number;
  side: Connect4Side;
}

export interface Connect4State extends BaseState {
  config: Connect4Config;
  players: [Connect4Player, Connect4Player];
  /** 6 rows x 7 cols row-major board: null = empty, 0 = Player 1, 1 = Player 2 */
  board: (Connect4Side | null)[];
  turn: Connect4Side;
  lastMove: Connect4LastMove | null;
  winningLine: { row: number; col: number }[] | null;
  winner: string | null;
  winReason: 'connect4' | 'draw' | 'timeout' | null;
  phase: 'playing' | 'game_over';
  log: LogEntry[];
}

export interface Connect4View {
  config: Connect4Config;
  players: [Connect4Player, Connect4Player];
  board: (Connect4Side | null)[];
  turn: Connect4Side;
  lastMove: Connect4LastMove | null;
  winningLine: { row: number; col: number }[] | null;
  winner: string | null;
  winReason: 'connect4' | 'draw' | 'timeout' | null;
  phase: 'playing' | 'game_over';
  legalCols: number[];
  log: LogEntry[];
}
