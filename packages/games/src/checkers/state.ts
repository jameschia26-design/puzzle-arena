import type { LogEntry } from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export interface CheckersConfig {
  turnTimeLimitSec: number;
}

export type CheckersSide = 0 | 1;

export interface CheckersPiece {
  side: CheckersSide;
  king: boolean;
}

export interface CheckersPlayer {
  id: string;
  seat: number;
  /** Opponent pieces this player has captured, out of the opponent's starting 20. */
  capturedCount: number;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface CheckersPos {
  row: number;
  col: number;
}

export type CheckersPhase = 'playing' | 'game_over';

export interface CheckersLastMove {
  playerId: string;
  path: CheckersPos[];
  captured: CheckersPos[];
  promoted: boolean;
}

export interface CheckersState extends BaseState {
  config: CheckersConfig;
  players: [CheckersPlayer, CheckersPlayer];
  /** 100 squares, row-major (row 0..9, col 0..9). Only dark squares ((row+col) odd) are ever occupied. */
  board: (CheckersPiece | null)[];
  current: CheckersSide;
  phase: CheckersPhase;
  lastMove: CheckersLastMove | null;
  winner: string | null;
  winReason: 'elimination' | 'no-moves' | null;
  log: LogEntry[];
}

export interface CheckersAction {
  type: 'move';
  path: CheckersPos[];
}

export interface CheckersPublicPlayer {
  id: string;
  seat: number;
  side: CheckersSide;
  piecesRemaining: number;
  kingsCount: number;
  capturedCount: number;
}

export interface CheckersLegalMove {
  path: CheckersPos[];
  captured: CheckersPos[];
}

export interface CheckersView {
  board: (CheckersPiece | null)[];
  players: CheckersPublicPlayer[];
  current: string | null;
  phase: CheckersPhase;
  lastMove: CheckersLastMove | null;
  winner: string | null;
  winReason: CheckersState['winReason'];
  log: LogEntry[];
  you: {
    id: string;
    side: CheckersSide;
    /** Populated only when it is this player's turn — the full legal-move set,
     *  already narrowed to the mandatory-maximum-capture subset when captures
     *  are available, so the client never has to re-derive the rules. */
    legalMoves: CheckersLegalMove[];
  } | null;
}
