import type { LogEntry } from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export const COLS = 7;
export const ROWS = 9;
export const SIZE = COLS * ROWS; // 63

export type AnimalType =
  | 'rat'
  | 'cat'
  | 'dog'
  | 'wolf'
  | 'leopard'
  | 'tiger'
  | 'lion'
  | 'elephant';

export type AnimalSide = 0 | 1;

export interface AnimalPiece {
  type: AnimalType;
  side: AnimalSide;
}

export interface AnimalChessConfig {
  turnTimeLimitSec: number;
}

export interface AnimalChessPlayer {
  id: string;
  seat: number;
  capturedCount: number;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export type AnimalChessPhase = 'playing' | 'game_over';

export interface AnimalChessMoveRecord {
  from: number;
  to: number;
  piece: AnimalPiece;
  captured: AnimalPiece | null;
  notation: string;
}

export interface AnimalChessState extends BaseState {
  config: AnimalChessConfig;
  players: [AnimalChessPlayer, AnimalChessPlayer];
  /** 63 squares, row-major (row 0..8, col 0..6). */
  board: (AnimalPiece | null)[];
  current: AnimalSide;
  phase: AnimalChessPhase;
  halfmoveClock: number;
  fullmove: number;
  history: AnimalChessMoveRecord[];
  winner: string | null;
  winReason: 'den' | 'elimination' | 'no_moves' | 'sixty_move' | 'repetition' | null;
  drawReason: 'sixty_move' | 'repetition' | null;
  log: LogEntry[];
}

export interface AnimalChessAction {
  type: 'move';
  from: number;
  to: number;
}

export interface AnimalChessPublicPlayer {
  id: string;
  seat: number;
  side: AnimalSide;
  piecesRemaining: number;
  capturedCount: number;
}

export interface AnimalChessLegalMove {
  from: number;
  to: number;
}

export interface AnimalChessView {
  board: (AnimalPiece | null)[];
  players: AnimalChessPublicPlayer[];
  current: string | null;
  phase: AnimalChessPhase;
  lastMove: { from: number; to: number; piece: AnimalPiece; captured: AnimalPiece | null } | null;
  winner: string | null;
  winReason: AnimalChessState['winReason'];
  drawReason: AnimalChessState['drawReason'];
  log: LogEntry[];
  you: {
    id: string;
    side: AnimalSide;
    legalMoves: AnimalChessLegalMove[];
  } | null;
}
