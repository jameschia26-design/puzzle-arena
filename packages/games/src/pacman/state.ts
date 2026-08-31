import type { BaseState } from '../engine.js';
import type { LogEntry } from '@puzzle-arena/shared';

export const MAZE_W = 28;
export const MAZE_H = 31;
export const MAZE_SIZE = MAZE_W * MAZE_H;

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Dir[] = ['up', 'left', 'down', 'right'];
export const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function opposite(d: Dir): Dir {
  if (d === 'up') return 'down';
  if (d === 'down') return 'up';
  if (d === 'left') return 'right';
  return 'left';
}

export type GhostId = 0 | 1 | 2 | 3;
export const GHOST_NAMES = ['Blinky', 'Pinky', 'Inky', 'Clyde'] as const;
export const GHOST_COLORS: Record<number, string> = {
  0: '#ff3b30', // Blinky red
  1: '#ff8ed6', // Pinky pink
  2: '#00d8ff', // Inky cyan
  3: '#ffb852', // Clyde orange
};

export type GhostMode = 'scatter' | 'chase' | 'frightened' | 'eaten';

export interface GhostState {
  id: GhostId;
  pos: { x: number; y: number };
  dir: Dir;
  mode: GhostMode;
  // how many ticks remain in frightened (0 if not frightened)
  frightTicks: number;
  // eaten -> returning to house
  eaten: boolean;
  // target tile for AI
  target: { x: number; y: number };
  // scatter corner target
  scatterTarget: { x: number; y: number };
  // house wait counter (ticks to stay in house before exiting)
  houseTicks: number;
  // movement delay counter (for speed control)
  moveCounter: number;
  // whether inside house
  inHouse: boolean;
}

export interface FruitState {
  pos: { x: number; y: number };
  kind: string;
  points: number;
  ticksLeft: number;
}

export interface PacManPlayerState {
  id: string;
  seat: number;
  // remaining maze: 0 empty, 1 dot, 2 power pellet
  maze: number[];
  dotsRemaining: number; // includes both dots and pellets remaining on board
  score: number;
  lives: number;
  level: number;
  // pac-man
  pacPos: { x: number; y: number };
  pacDir: Dir;
  nextDir: Dir;
  // ghosts
  ghosts: GhostState[];
  // fright ghost eat streak 0..3, resets when fright ends
  ghostStreak: number;
  // global scatter/chase cycle
  globalMode: 'scatter' | 'chase';
  globalModeTicks: number;
  globalPhase: number; // 0..7
  frightTicks: number; // global fright countdown (when >0 ghosts are frightened)
  ghostMoveCounter: number;
  pacMoveCounter: number;
  // fruit
  fruit: FruitState | null;
  dotsEatenThisLevel: number;
  fruitSpawnedCount: number; // 0,1,2 per level
  // dying animation
  dyingTicks: number; // >0 means pac is dying, countdown
  // level clear pause
  levelClearTicks: number; // >0 pause before next level
  extraLifeGiven: boolean;
  gameOver: boolean;
  // scoring helpers
  totalDotsEaten: number;
  // stats for score view
  pelletsEaten: number;
  ghostsEatenTotal: number;
  fruitsEaten: number;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface PacManConfig {
  turnTimeLimitSec: number; // unused, kept for parity
  startLevel: number;
}

export type PacManPhase = 'playing' | 'game_over';

export interface PacManState extends BaseState {
  config: PacManConfig;
  players: PacManPlayerState[];
  phase: PacManPhase;
  log: LogEntry[];
  winner: string | null;
}

export type PacManAction =
  | { type: 'dir'; dir: Dir }
  | { type: 'tick' };

export interface PacManPublicPlayer {
  id: string;
  seat: number;
  score: number;
  lives: number;
  level: number;
  pacPos: { x: number; y: number };
  pacDir: Dir;
  nextDir: Dir;
  ghosts: GhostState[];
  fruit: FruitState | null;
  maze: number[]; // remaining pellets (for rendering)
  dotsRemaining: number;
  gameOver: boolean;
  dyingTicks: number;
  levelClearTicks: number;
}

export interface PacManView {
  phase: PacManPhase;
  winner: string | null;
  you: PacManPublicPlayer | null;
  players: PacManPublicPlayer[];
  log: LogEntry[];
  config: PacManConfig;
  // exposed for determinism tests: maze dimensions
  mazeW: number;
  mazeH: number;
}
