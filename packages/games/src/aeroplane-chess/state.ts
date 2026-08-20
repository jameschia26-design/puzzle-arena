import type { LogEntry } from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export interface AeroplaneChessConfig {
  turnTimeLimitSec: number;
}

/**
 * -1 = in the hangar (not yet released). 0..50 = on the shared 52-square
 * ring, relative to this token's own entry square. 51..56 = the 6-cell
 * private home stretch. 57 = home (finished).
 */
export interface AeroplaneChessToken {
  steps: number;
}

export type AeroplaneChessTokens = [
  AeroplaneChessToken,
  AeroplaneChessToken,
  AeroplaneChessToken,
  AeroplaneChessToken,
];

export interface AeroplaneChessPlayer {
  id: string;
  seat: number;
  /** Which of the 4 fixed board quadrants (colours) this player occupies —
   *  not necessarily equal to array index; see QUADRANTS_BY_COUNT. */
  quadrant: number;
  tokens: AeroplaneChessTokens;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export type AeroplaneChessPhase = 'awaiting_roll' | 'awaiting_move' | 'game_over';

export interface AeroplaneChessLastRoll {
  playerId: string;
  value: number;
}

export interface AeroplaneChessCapture {
  playerId: string;
  tokenIndex: number;
}

export interface AeroplaneChessLastMove {
  playerId: string;
  tokenIndex: number;
  from: number;
  to: number;
  released: boolean;
  flew: boolean;
  reachedHome: boolean;
  captured: AeroplaneChessCapture[];
}

export interface AeroplaneChessState extends BaseState {
  config: AeroplaneChessConfig;
  players: AeroplaneChessPlayer[];
  current: number;
  phase: AeroplaneChessPhase;
  /** The pending, not-yet-spent roll, or null between turns. */
  dice: number | null;
  /** Sixes rolled back-to-back this turn; a 3rd forfeits the roll. */
  consecutiveSixes: number;
  lastRoll: AeroplaneChessLastRoll | null;
  lastMove: AeroplaneChessLastMove | null;
  winner: string | null;
  log: LogEntry[];
}

export type AeroplaneChessAction = { type: 'roll' } | { type: 'movePlane'; tokenIndex: number };

export interface AeroplaneChessPublicPlayer {
  id: string;
  seat: number;
  quadrant: number;
  tokens: AeroplaneChessTokens;
}

export interface AeroplaneChessView {
  players: AeroplaneChessPublicPlayer[];
  current: string | null;
  phase: AeroplaneChessPhase;
  dice: number | null;
  lastRoll: AeroplaneChessLastRoll | null;
  lastMove: AeroplaneChessLastMove | null;
  winner: string | null;
  log: LogEntry[];
  you: {
    id: string;
    quadrant: number;
    /** Token indices this player may legally move with the pending roll —
     *  populated only during their own `awaiting_move` phase. */
    legalTokens: number[];
  } | null;
}
