import type { LogEntry, RngState } from '@puzzle-arena/shared';

export type ScrabbleTurnPhase = 'awaiting_move' | 'game_over';

export interface ScrabblePlacedTile {
  /** Resolved letter, A-Z. For a blank this is the letter the placer chose. */
  letter: string;
  isBlank: boolean;
  playerId: string;
}

export interface ScrabblePlayer {
  id: string;
  seat: number;
  /** 0-7 letters; `'_'` is an unassigned blank. */
  rack: string[];
  score: number;
  actionsSubmitted: number;
  actionsAccepted: number;
  /** Tracked for interface parity with the other board games; never incremented
   *  by this engine, matching Property Tycoon and Manor Mystery. */
  penalties: number;
}

export interface ScrabbleConfig {
  turnTimeLimitSec: number;
}

export interface ScrabbleState {
  rng: RngState;
  seq: number;
  /** Monotonic log counter. Logical, never a timestamp — see engine.ts. */
  logSeq: number;
  /** ms from room start at which the winner finished; stamped by the runtime. */
  winnerAtMs: number | null;
  config: ScrabbleConfig;

  /** Row-major, length 225 (15x15). `null` = empty square. */
  board: (ScrabblePlacedTile | null)[];
  /** Remaining tiles, undrawn. */
  bag: string[];

  players: ScrabblePlayer[];
  /** Index into `players` of whoever is on turn. */
  current: number;
  turnPhase: ScrabbleTurnPhase;
  /** Consecutive pass/exchange turns with no scoring play; a `place` resets it to 0. */
  passStreak: number;
  lastPlay: { word: string; score: number; playerId: string } | null;

  winner: string | null;
  winReason: 'emptied-rack' | 'six-passes' | null;
  log: LogEntry[];
}
