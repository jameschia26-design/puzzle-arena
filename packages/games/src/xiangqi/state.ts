import type { LogEntry } from '@puzzle-arena/shared';
import type { XiangqiAction as SharedXiangqiAction } from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export interface XiangqiConfig {
  clockMinutes: number;
  incrementSec: number;
  allowTakeback: boolean;
}

/** 0 = Red (moves first, players[0]), 1 = Black (players[1]). */
export type XiangqiSide = 0 | 1;

export type XiangqiPieceType =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'horse'
  | 'chariot'
  | 'cannon'
  | 'soldier';

export interface XiangqiPiece {
  side: XiangqiSide;
  type: XiangqiPieceType;
}

export interface XiangqiPlayer {
  id: string;
  seat: number;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface MoveRecord {
  playerId: string;
  from: number;
  to: number;
  piece: XiangqiPieceType;
  side: XiangqiSide;
  captured: XiangqiPieceType | null;
  notation: string;
  check: boolean;
  key?: string;
}

export type XiangqiPhase = 'playing' | 'game_over';

export type XiangqiWinReason =
  | 'checkmate'
  | 'resign'
  | 'time'
  | 'idle'
  | 'stalemate'
  | 'flag'
  | 'perpetual_check'
  | null;

export type XiangqiDrawReason = 'agreement' | 'perpetual_mutual_check' | 'sixty_move' | 'threefold' | null;

export interface XiangqiState extends BaseState {
  config: XiangqiConfig;
  players: [XiangqiPlayer, XiangqiPlayer];
  /** 90 points, index = row*9+col. Row 0 is Black's back rank, row 9 is Red's. */
  board: (XiangqiPiece | null)[];
  current: XiangqiSide;
  /** Plies since the last capture, for the 60-full-move (120-ply) no-capture draw. */
  halfmoveClock: number;
  fullmove: number;
  history: MoveRecord[];
  repetition: Record<string, number>;
  /**
   * Simplified, practical approximation of the perpetual-check rule (see
   * rules.ts for the full explanation): counts each side's current streak of
   * consecutive *own* moves that delivered check. Reset to 0 the moment that
   * side makes a move that does not deliver check.
   */
  checkStreak: { 0: number; 1: number };
  drawOffer: string | null;
  takebackOffer: string | null;
  phase: XiangqiPhase;
  winner: string | null;
  winReason: XiangqiWinReason;
  drawReason: XiangqiDrawReason;
  log: LogEntry[];
}

/**
 * The reduce()-level action type. Extends the wire-validated
 * `XiangqiAction` from `@puzzle-arena/shared` with a runtime-only `forfeit`
 * variant used exclusively by the server's chess-clock system (time bank
 * expiry / idle cap). `forfeit` is deliberately NOT part of
 * `xiangqiActionSchema` in packages/shared/src/protocol.ts, so a client can
 * never submit one over the socket — only `apps/server`'s runtime, which
 * calls `engine.reduce` directly, may produce it.
 */
export type XiangqiAction = SharedXiangqiAction | { type: 'forfeit'; reason: 'time' | 'idle' };

export interface XiangqiLegalMove {
  from: number;
  to: number;
}

export interface XiangqiPublicPlayer {
  id: string;
  seat: number;
  side: XiangqiSide;
}

export interface XiangqiView {
  board: (XiangqiPiece | null)[];
  players: XiangqiPublicPlayer[];
  current: string | null;
  phase: XiangqiPhase;
  history: MoveRecord[];
  halfmoveClock: number;
  fullmove: number;
  winner: string | null;
  winReason: XiangqiWinReason;
  drawReason: XiangqiDrawReason;
  drawOffer: string | null;
  takebackOffer: string | null;
  log: LogEntry[];
  you: {
    id: string;
    side: XiangqiSide;
    inCheck: boolean;
    /** Populated only when it is this player's turn. */
    legalMoves: XiangqiLegalMove[];
  } | null;
}
