import type { BaseState } from '../engine.js';
import type { LogEntry } from '@puzzle-arena/shared';

export const PLAYFIELD_W = 64;
export const PLAYFIELD_H = 44;

export const ALIEN_ROWS = 5;
export const ALIEN_COLS = 11;
export const ALIEN_COUNT = 55;

export const ALIEN_COL_SPACING = 4; // cols: 0, 4, 8, ..., 40 (width: 3 per alien -> 42 wide total)
export const ALIEN_ROW_SPACING = 2; // rows: 0, 2, 4, 6, 8 (height: 9 total)
export const ALIEN_WIDTH = 3;
export const ALIEN_HEIGHT = 1;

export const BUNKER_COUNT = 4;
export const BUNKER_W = 8;
export const BUNKER_H = 7;
export const BUNKER_X = [4, 20, 36, 52];
export const BUNKER_Y = 32;

export const PLAYER_Y = 41;
export const PLAYER_START_X = 30;
export const PLAYER_WIDTH = 3;
export const PLAYER_SPEED = 3; // cells per move action
export const PLAYER_LIVES = 3;
export const RESPAWN_GRACE_TICKS = 20;

export const UFO_Y = 1;
export const UFO_WIDTH = 4;
export const UFO_SCORES = [50, 100, 150, 200, 300] as const;

export type AlienType = 'squid' | 'crab' | 'octopus';

export interface Alien {
  id: number; // 0..54
  row: number; // 0..4
  col: number; // 0..10
  type: AlienType;
  points: number;
  alive: boolean;
}

export interface Bunker {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mask: boolean[]; // length BUNKER_W * BUNKER_H (56), true = solid
}

export interface Bullet {
  x: number;
  y: number;
}

export interface AlienBomb {
  id: number;
  x: number;
  y: number;
  col: number;
}

export interface UFO {
  x: number;
  y: number;
  dir: 1 | -1;
  points: number;
  alive: boolean;
}

export interface SpaceInvadersConfig {
  tickMs: number; // min 20, max 200, default 60
  startWave: number; // min 1, max 10, default 1
  assist: boolean; // default false
  waves?: number; // optional wave cap
}

export interface SpaceInvadersPlayerState {
  id: string;
  seat: number;
  score: number;
  lives: number;
  wave: number;
  wavesCleared: number;
  aliensKilled: number;
  playerX: number;
  playerY: number;
  bullet: Bullet | null;
  bullets: Bullet[];
  maxBullets: number;
  fireCooldownTicks: number;
  alienBombs: AlienBomb[];
  nextBombId: number;
  bunkers: Bunker[];
  aliens: Alien[];
  formationX: number;
  formationY: number;
  formationDir: 1 | -1;
  formationMoveCounter: number;
  aliveCount: number;
  fireTimer: number;
  ufo: UFO | null;
  ufoSpawnTimer: number;
  respawnGraceTicks: number;
  gameOver: boolean;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export type SpaceInvadersPhase = 'playing' | 'game_over';

export interface SpaceInvadersState extends BaseState {
  config: SpaceInvadersConfig;
  players: SpaceInvadersPlayerState[];
  phase: SpaceInvadersPhase;
  log: LogEntry[];
  winner: string | null;
}

export type SpaceInvadersAction =
  | { type: 'move'; dir: 'left' | 'right' }
  | { type: 'fire' }
  | { type: 'toggleAssist' }
  | { type: 'tick' };

export interface SpaceInvadersPublicPlayer {
  id: string;
  seat: number;
  score: number;
  lives: number;
  wave: number;
  playerX: number;
  playerY: number;
  bullet: Bullet | null;
  bullets: Bullet[];
  alienBombs: AlienBomb[];
  bunkers: Bunker[];
  aliens: Alien[];
  formationX: number;
  formationY: number;
  formationDir: 1 | -1;
  aliveCount: number;
  ufo: UFO | null;
  board: number[]; // PLAYFIELD_W * PLAYFIELD_H grid mask for rendering/assist
  gameOver: boolean;
  maxBullets?: number;
  respawnGraceTicks?: number;
}

export interface SpaceInvadersView {
  phase: SpaceInvadersPhase;
  winner: string | null;
  you: SpaceInvadersPublicPlayer | null;
  players: SpaceInvadersPublicPlayer[];
  log: LogEntry[];
  config: SpaceInvadersConfig;
  playfieldW: number;
  playfieldH: number;
}
