import type {
  BlockPiece,
  CellState,
  LogEntry,
  BlockBlasterConfig,
  BlockBlasterAction,
} from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export interface ClearEvent {
  rows: number[];
  cols: number[];
  points: number;
  combo: number;
}

export interface BlockBlasterPlayerState {
  id: string;
  seat: number;
  board: CellState[][];
  /** The one piece you can currently place. */
  current: BlockPiece;
  /** Preview of the piece that becomes `current` after this one is placed. */
  next: BlockPiece;
  score: number;
  highScore: number;
  comboStreak: number;
  linesCleared: number;
  piecesPlaced: number;
  gameOver: boolean;
  lastClear: ClearEvent | null;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export type BlockBlasterPhase = 'playing' | 'game_over';

export interface BlockBlasterState extends BaseState {
  config: BlockBlasterConfig;
  players: BlockBlasterPlayerState[];
  phase: BlockBlasterPhase;
  log: LogEntry[];
  winner: string | null;
}

export type { BlockBlasterConfig, BlockBlasterAction };

export interface BlockBlasterPublicPlayer {
  id: string;
  seat: number;
  board: CellState[][];
  current: BlockPiece;
  next: BlockPiece;
  score: number;
  highScore: number;
  comboStreak: number;
  linesCleared: number;
  piecesPlaced: number;
  gameOver: boolean;
  lastClear: ClearEvent | null;
}

export interface BlockBlasterView {
  phase: BlockBlasterPhase;
  winner: string | null;
  you: BlockBlasterPublicPlayer | null;
  players: BlockBlasterPublicPlayer[];
  log: LogEntry[];
  config: BlockBlasterConfig;
}
