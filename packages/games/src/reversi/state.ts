import type { BaseState } from '../engine.js';
import type { LogEntry } from '@puzzle-arena/shared';

export type ReversiAction =
  | { type: 'place'; row: number; col: number }
  | { type: 'pass' };
export type ReversiSide = 0 | 1; // 0 = Dark / Black (moves first), 1 = Light / White

export interface ReversiPlayer {
  id: string;
  name: string;
  side: ReversiSide;
  discs: number;
}

export interface ReversiConfig {
  turnTimeLimitSec: number;
}

export interface ReversiLastMove {
  row: number;
  col: number;
  flipped: { row: number; col: number }[];
  side: ReversiSide;
}

export interface ReversiState extends BaseState {
  config: ReversiConfig;
  players: [ReversiPlayer, ReversiPlayer];
  /** 8x8 row-major board: null = empty, 0 = Dark, 1 = Light */
  board: (ReversiSide | null)[];
  turn: ReversiSide;
  consecutivePasses: number;
  lastMove: ReversiLastMove | null;
  winner: string | null; // player ID or null
  winReason: 'discs' | 'elimination' | 'pass' | 'draw' | null;
  phase: 'playing' | 'game_over';
  log: LogEntry[];
}

export interface ReversiView {
  config: ReversiConfig;
  players: [ReversiPlayer, ReversiPlayer];
  board: (ReversiSide | null)[];
  turn: ReversiSide;
  lastMove: ReversiLastMove | null;
  winner: string | null;
  winReason: 'discs' | 'elimination' | 'pass' | 'draw' | null;
  phase: 'playing' | 'game_over';
  legalMoves: { row: number; col: number; flipsCount: number }[];
  log: LogEntry[];
}
