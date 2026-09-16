import type {
  BlockPiece,
  CellState,
  LogEntry,
  BlockBlasterConfig,
  BlockBlasterAction,
  BombType,
  BonusBomb,
  DetonationResult,
} from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export interface ClearEvent {
  rows: number[];
  cols: number[];
  points: number;
  combo: number;
  claimedBomb?: BombType | undefined;
}

export interface BlockBlasterPlayerState {
  id: string;
  seat: number;
  board: CellState[][];
  tray: (BlockPiece | null)[];
  score: number;
  highScore: number;
  comboStreak: number;
  linesCleared: number;
  piecesPlaced: number;
  bombsDetonated: number;
  gameOver: boolean;
  lastClear: ClearEvent | null;
  lastDetonation: DetonationResult | null;
  bombs: BombType[];
  bonusBomb: BonusBomb | null;
  roundsCompleted: number;
  nextBonusBombRound: number;
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
  tray: (BlockPiece | null)[];
  score: number;
  highScore: number;
  comboStreak: number;
  linesCleared: number;
  piecesPlaced: number;
  bombsDetonated: number;
  gameOver: boolean;
  lastClear: ClearEvent | null;
  lastDetonation: DetonationResult | null;
  bombs: BombType[];
  bonusBomb: BonusBomb | null;
}
export interface BlockBlasterView {
  phase: BlockBlasterPhase;
  winner: string | null;
  you: BlockBlasterPublicPlayer | null;
  players: BlockBlasterPublicPlayer[];
  log: LogEntry[];
  config: BlockBlasterConfig;
}
