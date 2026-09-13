import type { LogEntry, RngState } from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export const BUBBLE_ROWS = 13;
export const LONG_ROW_SLOTS = 8;
export const SHORT_ROW_SLOTS = 7;
export const BUBBLE_COLORS = ['coral', 'gold', 'leaf', 'sky', 'violet', 'rose', 'mint', 'amber'] as const;
export type BubbleColor = (typeof BUBBLE_COLORS)[number];
export type PuzzleBubbleSpeed = 'slow' | 'normal' | 'fast';

export interface PuzzleBubbleConfig {
  colors: number;
  speed: PuzzleBubbleSpeed;
}

export interface BubbleCell {
  row: number;
  col: number;
  color: BubbleColor;
}

export interface BubbleSlot {
  row: number;
  col: number;
}

export interface BubblePoint {
  x: number;
  y: number;
}

export interface PuzzleBubbleShot {
  angleDeg: number;
  path: BubblePoint[];
  landing: BubbleSlot;
  popped: BubbleSlot[];
  dropped: BubbleSlot[];
  pressureAdded: boolean;
}

export interface PuzzleBubblePlayerState {
  id: string;
  seat: number;
  rng: RngState;
  board: BubbleCell[];
  rowParity: 0 | 1;
  current: BubbleColor;
  next: BubbleColor;
  score: number;
  wave: number;
  wavesCleared: number;
  shots: number;
  clearingShots: number;
  bubblesPopped: number;
  bubblesDropped: number;
  pressureRemaining: number;
  descents: number;
  gameOver: boolean;
  lastShot: PuzzleBubbleShot | null;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export type PuzzleBubblePhase = 'playing' | 'game_over';

export interface PuzzleBubbleState extends BaseState {
  config: PuzzleBubbleConfig;
  players: PuzzleBubblePlayerState[];
  phase: PuzzleBubblePhase;
  winner: string | null;
  log: LogEntry[];
}

export type PuzzleBubbleAction =
  | { type: 'shoot'; angleDeg: number }
  | { type: 'descent' };

export interface PuzzleBubblePublicPlayer {
  id: string;
  seat: number;
  board: BubbleCell[];
  rowParity: 0 | 1;
  current: BubbleColor;
  next: BubbleColor;
  score: number;
  wave: number;
  wavesCleared: number;
  shots: number;
  clearingShots: number;
  bubblesPopped: number;
  bubblesDropped: number;
  pressureRemaining: number;
  descents: number;
  pressureLimit: number;
  gameOver: boolean;
  lastShot: PuzzleBubbleShot | null;
}

export interface PuzzleBubbleView {
  phase: PuzzleBubblePhase;
  winner: string | null;
  you: PuzzleBubblePublicPlayer | null;
  players: PuzzleBubblePublicPlayer[];
  config: PuzzleBubbleConfig;
  /** Runtime-owned epoch deadline for the next automatic ceiling descent. */
  pressureEndsAtMs?: number | null;
  log: LogEntry[];
}
