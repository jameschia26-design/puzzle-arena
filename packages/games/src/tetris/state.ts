import type { BaseState } from '../engine.js';
import type { LogEntry } from '@puzzle-arena/shared';

// 10 wide, 20 tall visible. Row 0 = top.
export const BOARD_W = 10;
export const BOARD_H = 20;

export type TetrominoKind = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';

export interface Tetromino {
  kind: TetrominoKind;
  x: number; // origin
  y: number;
  rot: number; // 0..3
}

export interface TetrisPlayerState {
  id: string;
  seat: number;
  board: (TetrominoKind | null)[]; // BOARD_W * BOARD_H, null empty
  active: Tetromino | null;
  hold: TetrominoKind | null;
  canHold: boolean;
  bag: TetrominoKind[];
  next: TetrominoKind[]; // queue of upcoming, length 5
  score: number;
  lines: number;
  level: number;
  combo: number; // -1 means no combo, else consecutive clears
  backToBack: boolean;
  gameOver: boolean;
  // lock delay tracking
  lockTicks: number;
  // Guideline move-reset counter: moves/rotations that reset lock delay while grounded
  lockResets: number;
  // lowest row the active piece has reached (y is down-positive); resets are
  // only re-armed when the piece descends below this
  lowestY: number;
  // soft drop distance since last lock
  softDropCells: number;
  // last action was rotate (for T-spin detection)
  lastWasRotate: boolean;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface TetrisConfig {
  turnTimeLimitSec: number; // unused but required by registry shape parity
  startLevel: number;
  /** Assist mode: ghost shadow visible. false = classic (hidden). */
  assist: boolean;
}

export type TetrisPhase = 'playing' | 'game_over';

export interface TetrisState extends BaseState {
  config: TetrisConfig;
  players: TetrisPlayerState[];
  phase: TetrisPhase;
  log: LogEntry[];
  winner: string | null;
}

export type TetrisAction =
  | { type: 'move'; dir: 'left' | 'right' }
  | { type: 'rotate'; dir: 'cw' | 'ccw' }
  | { type: 'softDrop' }
  | { type: 'hardDrop' }
  | { type: 'hold' }
  | { type: 'toggleAssist' }
  | { type: 'tick' };

export interface TetrisPublicPlayer {
  id: string;
  seat: number;
  score: number;
  lines: number;
  level: number;
  board: (TetrominoKind | null)[];
  active: Tetromino | null;
  hold: TetrominoKind | null;
  next: TetrominoKind[];
  ghostY: number | null;
  gameOver: boolean;
  combo: number;
  backToBack: boolean;
}

export interface TetrisView {
  phase: TetrisPhase;
  winner: string | null;
  you: TetrisPublicPlayer | null;
  players: TetrisPublicPlayer[];
  log: LogEntry[];
  config: TetrisConfig;
}
