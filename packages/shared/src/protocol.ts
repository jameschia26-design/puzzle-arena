import { z } from 'zod';
import { botDifficultySchema, gameIdSchema } from './registry.js';

/* ------------------------------------------------------------------ */
/* Per-game action unions                                              */
/* ------------------------------------------------------------------ */

export const propertyTycoonActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roll') }),
  z.object({ type: z.literal('buy') }),
  z.object({ type: z.literal('decline') }),
  z.object({ type: z.literal('bid'), amount: z.number().int().min(1) }),
  z.object({ type: z.literal('passBid') }),
  z.object({ type: z.literal('buildHouse'), propertyId: z.number().int() }),
  z.object({ type: z.literal('sellHouse'), propertyId: z.number().int() }),
  z.object({ type: z.literal('mortgage'), propertyId: z.number().int() }),
  z.object({ type: z.literal('unmortgage'), propertyId: z.number().int() }),
  z.object({
    type: z.literal('proposeTrade'),
    toPlayerId: z.string(),
    give: z.object({ cash: z.number().int().min(0), properties: z.array(z.number().int()) }),
    receive: z.object({ cash: z.number().int().min(0), properties: z.array(z.number().int()) }),
  }),
  z.object({ type: z.literal('respondTrade'), tradeId: z.string(), accept: z.boolean() }),
  z.object({ type: z.literal('payJailFine') }),
  z.object({ type: z.literal('useJailCard') }),
  z.object({ type: z.literal('declareBankruptcy') }),
  z.object({ type: z.literal('endTurn') }),
]);
export type PropertyTycoonAction = z.infer<typeof propertyTycoonActionSchema>;

export const SUSPECTS = [
  'Ms. Crimson',
  'Major Ochre',
  'Mrs. Ivory',
  'Mr. Verde',
  'Lady Azure',
  'Dr. Mauve',
] as const;
export const WEAPONS = [
  'Candlestick',
  'Dagger',
  'Lead Pipe',
  'Revolver',
  'Rope',
  'Wrench',
] as const;
export const ROOMS = [
  'Kitchen',
  'Ballroom',
  'Conservatory',
  'Dining Room',
  'Library',
  'Billiard Room',
  'Lounge',
  'Hall',
  'Study',
] as const;

export type SuspectName = (typeof SUSPECTS)[number];
export type WeaponName = (typeof WEAPONS)[number];
export type RoomName = (typeof ROOMS)[number];

export const suspectSchema = z.enum(SUSPECTS);
export const weaponSchema = z.enum(WEAPONS);
export const roomSchema = z.enum(ROOMS);

export const manorMysteryActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roll') }),
  z.object({ type: z.literal('move'), x: z.number().int(), y: z.number().int() }),
  z.object({ type: z.literal('useSecretPassage') }),
  z.object({ type: z.literal('suggest'), suspect: suspectSchema, weapon: weaponSchema }),
  z.object({ type: z.literal('refute'), card: z.string() }),
  z.object({
    type: z.literal('accuse'),
    suspect: suspectSchema,
    weapon: weaponSchema,
    room: roomSchema,
  }),
  z.object({ type: z.literal('endTurn') }),
]);
export type ManorMysteryAction = z.infer<typeof manorMysteryActionSchema>;

export const gameActionSchema = z.union([
  propertyTycoonActionSchema,
  manorMysteryActionSchema,
]);
export type GameAction = PropertyTycoonAction | ManorMysteryAction;

/* ------------------------------------------------------------------ */
/* Client -> server                                                    */
/* ------------------------------------------------------------------ */

export const roomJoinSchema = z.object({
  code: z.string().length(6),
  displayName: z.string().min(1).max(20),
  avatar: z.string().max(8).optional(),
});
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;

export const roomKickSchema = z.object({ playerId: z.string() });

/** A puzzle move. `path` is game-specific: "r,c" for grids, a word for word-search. */
export const puzzleCommitSchema = z.object({
  path: z.string().max(64),
  value: z.union([z.number().int(), z.string().max(64), z.null()]),
});
export type PuzzleCommitPayload = z.infer<typeof puzzleCommitSchema>;

export const chatSendSchema = z.object({ text: z.string().min(1).max(300) });

export const addBotSchema = z.object({ difficulty: botDifficultySchema });

/* ------------------------------------------------------------------ */
/* Server -> client                                                    */
/* ------------------------------------------------------------------ */

export const playerViewSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  seat: z.number().int(),
  isHost: z.boolean(),
  isBot: z.boolean(),
  botDifficulty: botDifficultySchema.nullable(),
  avatar: z.string().nullable(),
  connected: z.boolean(),
  left: z.boolean(),
});
export type PlayerView = z.infer<typeof playerViewSchema>;

export const roomStatusSchema = z.enum(['lobby', 'running', 'finished', 'abandoned']);
export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const roomMetaSchema = z.object({
  id: z.string(),
  code: z.string(),
  gameId: gameIdSchema,
  status: roomStatusSchema,
  timeLimitSec: z.number().int(),
  config: z.unknown(),
  startedAt: z.number().nullable(),
  endsAt: z.number().nullable(),
  hostPlayerId: z.string().nullable(),
});
export type RoomMeta = z.infer<typeof roomMetaSchema>;

export const leaderboardEntrySchema = z.object({
  playerId: z.string(),
  displayName: z.string(),
  seat: z.number().int(),
  isBot: z.boolean(),
  /**
   * ANTI-CHEAT: while instantFeedback is off this is the *filled* fraction,
   * never the correct fraction. See runtime.ts.
   */
  progress: z.number(),
  completed: z.boolean(),
  completedAtMs: z.number().nullable(),
  penalties: z.number().int(),
  score: z.number().int().nullable(),
  /** Manor Mystery only — how many times this player accused wrongly. */
  wrongAccusations: z.number().int().optional(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const resultRowSchema = z.object({
  playerId: z.string(),
  displayName: z.string(),
  seat: z.number().int(),
  isBot: z.boolean(),
  rank: z.number().int(),
  score: z.number().int(),
  progress: z.number(),
  accuracy: z.number(),
  speed: z.number(),
  completed: z.boolean(),
  completedAtMs: z.number().nullable(),
  penalties: z.number().int(),
  detail: z.unknown().optional(),
});
export type ResultRow = z.infer<typeof resultRowSchema>;

export const logEntrySchema = z.object({
  seq: z.number().int(),
  at: z.number(),
  text: z.string(),
  playerId: z.string().nullable(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  displayName: z.string(),
  seat: z.number().int(),
  text: z.string(),
  at: z.number(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const socketErrorSchema = z.object({ code: z.string(), message: z.string() });

/** The full room snapshot pushed on join and after every material change. */
export interface RoomSnapshot {
  room: RoomMeta;
  players: PlayerView[];
  you: { playerId: string; seat: number; isHost: boolean } | null;
  /** Puzzle: the player's own board + the public puzzle. Board game: engine view(). */
  state: unknown;
  /**
   * What this player may legally do right now. Carried on the snapshot, not
   * only on `game:state`, so a client that has just joined (or just seen the
   * game start) knows what is enabled without waiting for someone else to move.
   */
  legalActions: string[];
  endsAt: number | null;
  /**
   * When the server will play this player's minimal legal action for them.
   * Board games only; null when no human is on the clock. The client renders
   * the same countdown so a turn is never silently auto-played.
   */
  turnEndsAt: number | null;
  leaderboard: LeaderboardEntry[];
  log: LogEntry[];
  results: ResultRow[] | null;
}

export interface PuzzleCommitAck {
  accepted: boolean;
  /** Only present when the host enabled instantFeedback. */
  correct?: boolean;
  progress: number;
  error?: string;
}

export interface GameActionAck {
  accepted: boolean;
  error?: string;
}

/** Event names, so client and server never drift on a string literal. */
export const EV = {
  // client -> server
  roomJoin: 'room:join',
  roomLeave: 'room:leave',
  roomStart: 'room:start',
  roomKick: 'room:kick',
  roomEndEarly: 'room:endEarly',
  puzzleCommit: 'puzzle:commit',
  puzzleHint: 'puzzle:hint',
  gameAction: 'game:action',
  chatSend: 'chat:send',
  // server -> client
  roomSnapshot: 'room:snapshot',
  roomPlayers: 'room:players',
  roomStarted: 'room:started',
  roomEnded: 'room:ended',
  leaderboard: 'leaderboard',
  gameState: 'game:state',
  gameLog: 'game:log',
  chatMessage: 'chat:message',
  error: 'error',
} as const;
