import type { LogEntry } from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';

export interface BigTwoConfig {
  turnTimeLimitSec: number;
}

/** rank: 0=3 .. 7=10, 8=J, 9=Q, 10=K, 11=A, 12=2 (low to high). suit: 0=♦ 1=♣ 2=♥ 3=♠ (low to high, tiebreak only). */
export interface BigTwoCard {
  rank: number;
  suit: number;
}

export type BigTwoComboCategory =
  | 'single'
  | 'pair'
  | 'triple'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-kind'
  | 'straight-flush';

export interface BigTwoCombo {
  category: BigTwoComboCategory;
  /** Comparable strength within same-size, same-category combos (and across
   *  bombs) — see rules.ts#beats for the full comparison, which is not a
   *  plain `value` compare alone. */
  value: number;
  cards: BigTwoCard[];
}

export interface BigTwoPlayer {
  id: string;
  seat: number;
  hand: BigTwoCard[];
  startingHandSize: number;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export type BigTwoPhase = 'awaiting_play' | 'game_over';

export interface BigTwoLastPlay {
  playerId: string;
  cards: BigTwoCard[];
  category: BigTwoComboCategory;
}

export interface BigTwoState extends BaseState {
  config: BigTwoConfig;
  players: BigTwoPlayer[];
  current: number;
  phase: BigTwoPhase;
  /** The combo currently in play to beat, or null when the lead is free. */
  currentLead: BigTwoCombo | null;
  /** Whoever led the current trick — leads again, freely, once everyone else passes. */
  currentLeaderId: string | null;
  /** Player ids who have passed since the last non-pass play, for display. */
  passedSinceLastPlay: string[];
  /** The very first play of the game must include the 3 of Diamonds. */
  firstPlayDone: boolean;
  lastPlay: BigTwoLastPlay | null;
  winner: string | null;
  log: LogEntry[];
}

export type BigTwoAction = { type: 'play'; cards: BigTwoCard[] } | { type: 'pass' };

export interface BigTwoPublicPlayer {
  id: string;
  seat: number;
  handSize: number;
}

export interface BigTwoView {
  players: BigTwoPublicPlayer[];
  current: string | null;
  phase: BigTwoPhase;
  currentLead: BigTwoCombo | null;
  currentLeaderId: string | null;
  passedSinceLastPlay: string[];
  firstPlayDone: boolean;
  lastPlay: BigTwoLastPlay | null;
  winner: string | null;
  log: LogEntry[];
  you: {
    id: string;
    hand: BigTwoCard[];
  } | null;
}
