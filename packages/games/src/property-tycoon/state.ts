import type { LogEntry, RngState } from '@puzzle-arena/shared';
import type { Card } from './cards.js';

export type PTPhase =
  | 'awaiting_roll'
  | 'resolving_square'
  | 'awaiting_purchase_decision'
  | 'auction'
  | 'awaiting_debt_settlement'
  | 'awaiting_end_turn'
  | 'in_jail_decision'
  | 'game_over';

export interface PTPlayer {
  id: string;
  seat: number;
  cash: number;
  position: number;
  inJail: boolean;
  /** Turns spent in jail this stint (0..3). */
  jailTurns: number;
  jailCards: string[];
  bankrupt: boolean;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface PTProperty {
  owner: string | null;
  /** 0..4 houses, 5 = hotel. */
  houses: number;
  mortgaged: boolean;
}

export interface PTAuction {
  propertyId: number;
  /** Seat order of players still able to bid. */
  participants: string[];
  passed: string[];
  highBid: number;
  highBidder: string | null;
  /** Whose turn it is to bid or pass. */
  turn: string;
}

export interface PTTrade {
  id: string;
  from: string;
  to: string;
  give: { cash: number; properties: number[] };
  receive: { cash: number; properties: number[] };
}

export interface PTConfig {
  startingCash: number;
  auctionsEnabled: boolean;
  restStopJackpot: boolean;
  turnTimeLimitSec: number;
}

export interface PTState {
  rng: RngState;
  seq: number;
  /** Monotonic log counter. Logical, never a timestamp — see engine.ts. */
  logSeq: number;
  /** ms from room start at which the winner finished; stamped by the runtime. */
  winnerAtMs: number | null;
  startedAt: number;
  config: PTConfig;

  players: PTPlayer[];
  properties: Record<number, PTProperty>;

  /** Index into `players` of whoever is on turn. */
  current: number;
  phase: PTPhase;

  dice: [number, number] | null;
  /** Consecutive doubles this turn (the third sends you to jail). */
  doublesCount: number;
  rolledDoublesThisTurn: boolean;

  pendingPurchase: number | null;
  auction: PTAuction | null;
  /** Every player currently in debt — a "collect from everyone" card can put
   *  more than one player in the hole at once, so this is a list, not a
   *  single slot. Each entry clears independently once that player's cash
   *  is non-negative again, by whatever means. */
  debt: { playerId: string; amount: number; creditor: string | null }[];
  trades: PTTrade[];

  fortuneDeck: string[];
  fortuneIdx: number;
  civicDeck: string[];
  civicIdx: number;
  /** The card just drawn, for the client to display. */
  lastCard: Card | null;

  housesRemaining: number;
  hotelsRemaining: number;

  restStopPot: number;
  winner: string | null;
  log: LogEntry[];
}
