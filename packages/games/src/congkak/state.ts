import type { LogEntry } from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export interface CongkakConfig {
  pitsPerSide: number;
  seedsPerPit: number;
  turnTimeLimitSec: number;
}

export interface CongkakPlayer {
  id: string;
  seat: number;
  storehouse: number;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface CongkakLastMove {
  playerId: string;
  startPit: number;
  relayHops: number;
  landedInStorehouse: boolean;
  tembakPit?: number | undefined;
  capturedSeeds?: number | undefined;
}

export type CongkakPhase = 'pick' | 'game_over';

export interface CongkakState extends BaseState {
  config: CongkakConfig;
  players: [CongkakPlayer, CongkakPlayer];
  /** Small pits: [0..pitsPerSide-1] for P0, [pitsPerSide..2*pitsPerSide-1] for P1 */
  pits: number[];
  /** Storehouse counts: [P0_storehouse, P1_storehouse] */
  storehouses: [number, number];
  /** 0 or 1 index of player whose turn it is */
  current: 0 | 1;
  phase: CongkakPhase;
  lastMove: CongkakLastMove | null;
  winner: string | null;
  winReason: 'all-captured' | 'starved' | 'six-passes' | null;
  log: LogEntry[];
}

export interface CongkakAction {
  type: 'sow';
  pitIndex: number;
}

export interface CongkakPublicPlayer {
  id: string;
  seat: number;
  storehouse: number;
}

export interface CongkakView {
  pits: number[];
  storehouses: [number, number];
  players: CongkakPublicPlayer[];
  current: string | null;
  phase: CongkakPhase;
  lastMove: CongkakLastMove | null;
  winner: string | null;
  winReason: CongkakState['winReason'];
  log: LogEntry[];
  pitsPerSide: number;
  /** Restricted view perspective for the calling player */
  you: {
    id: string;
    playerIndex: 0 | 1;
    sidePits: [number, number];
  } | null;
}
