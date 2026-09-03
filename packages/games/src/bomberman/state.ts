import type { BaseState } from '../engine.js';
import type { LogEntry } from '@puzzle-arena/shared';

export const ARENA_W = 15;
export const ARENA_H = 13;
export const ARENA_SIZE = ARENA_W * ARENA_H;

export const TILE_EMPTY = 0;
export const TILE_HARD = 1;
export const TILE_SOFT = 2;

export type Tile = typeof TILE_EMPTY | typeof TILE_HARD | typeof TILE_SOFT;

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Dir[] = ['up', 'left', 'down', 'right'];
export const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export type PowerUpKind = 'flame' | 'bomb' | 'speed' | 'pass';

export interface PowerUpItem {
  x: number;
  y: number;
  kind: PowerUpKind;
}

export interface BombState {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  fuse: number;
  radius: number;
}

export interface BlastCell {
  x: number;
  y: number;
  ticksRemaining: number;
  ownerId: string;
}

export interface BombermanPlayerState {
  id: string;
  seat: number;
  alive: boolean;
  x: number;
  y: number;
  blastRadius: number; // starts at 2, cap 6
  maxBombs: number;    // starts at 1, cap 8
  activeBombs: number;
  speed: number;       // move 2 cells per action if speed > 0, cap 3 increments
  hasPass: boolean;    // walk through bombs
  bombsUnderPlayer: number[]; // bomb IDs currently under player (placed while here)
  kills: number;
  survivalTicks: number;
  gameOver: boolean;
  // stats for score
  powerupsCollected: {
    flame: number;
    bomb: number;
    speed: number;
    pass: number;
  };
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface BombermanConfig {
  tickMs: number;       // default 60 (20..200)
  softDensity: number;  // default 65 (30..80)
}

export type BombermanPhase = 'playing' | 'game_over';

export interface BombermanState extends BaseState {
  config: BombermanConfig;
  grid: number[];          // ARENA_SIZE: TILE_EMPTY, TILE_HARD, TILE_SOFT
  hiddenPowerups: Record<number, PowerUpKind>; // cellIndex -> powerup (revealed when soft destroyed)
  visiblePowerups: PowerUpItem[]; // revealed powerups waiting on ground
  bombs: BombState[];
  blasts: BlastCell[];
  players: BombermanPlayerState[];
  phase: BombermanPhase;
  log: LogEntry[];
  winner: string | null;
  tickCount: number;
  nextBombId: number;
  graceTicksRemaining: number; // 3 ticks grace where players cannot be hit
}

export type BombermanAction =
  | { type: 'move'; dir: Dir }
  | { type: 'bomb' }
  | { type: 'tick' };

export interface BombermanPublicPlayer {
  id: string;
  seat: number;
  alive: boolean;
  x: number;
  y: number;
  blastRadius: number;
  maxBombs: number;
  activeBombs: number;
  speed: number;
  hasPass: boolean;
  kills: number;
  gameOver: boolean;
}

export interface BombermanView {
  phase: BombermanPhase;
  winner: string | null;
  you: BombermanPublicPlayer | null;
  players: BombermanPublicPlayer[];
  grid: number[];           // Arena mask (TILE_EMPTY, TILE_HARD, TILE_SOFT) - NO hidden powerups
  visiblePowerups: PowerUpItem[];
  bombs: { id: number; ownerId: string; x: number; y: number; fuse: number; radius: number }[];
  blasts: { x: number; y: number; ticksRemaining: number }[];
  log: LogEntry[];
  config: BombermanConfig;
  arenaW: number;
  arenaH: number;
  tickCount: number;
  graceTicksRemaining: number;
}
