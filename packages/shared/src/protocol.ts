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

/** A single newly placed tile, as sent by the client. `letter` is always the
 *  resolved A-Z letter — for a blank, the letter the player chose for it. */
export const scrabblePlacedTileSchema = z.object({
  row: z.number().int().min(0).max(14),
  col: z.number().int().min(0).max(14),
  letter: z.string().regex(/^[A-Z]$/),
  isBlank: z.boolean().optional(),
});

export const scrabbleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('place'), tiles: z.array(scrabblePlacedTileSchema).min(1).max(7) }),
  z.object({
    type: z.literal('exchange'),
    // Rack contents to trade back: 'A'-'Z' or '_' for an unassigned blank.
    letters: z.array(z.string().regex(/^[A-Z_]$/)).min(1).max(7),
  }),
  z.object({ type: z.literal('pass') }),
]);
export type ScrabbleAction = z.infer<typeof scrabbleActionSchema>;
export const congkakActionSchema = z.object({
  type: z.literal('sow'),
  pitIndex: z.number().int().min(0).max(17),
});
export type CongkakAction = z.infer<typeof congkakActionSchema>;

export const checkersPosSchema = z.object({
  row: z.number().int().min(0).max(9),
  col: z.number().int().min(0).max(9),
});
export const checkersActionSchema = z.object({
  type: z.literal('move'),
  // Start square + every landing square, including intermediate jumps in a
  // multi-capture chain. 21 is a generous ceiling — a side only ever has 20
  // pieces to capture in total.
  path: z.array(checkersPosSchema).min(2).max(21),
});
export type CheckersAction = z.infer<typeof checkersActionSchema>;
export const reversiActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('place'),
    row: z.number().int().min(0).max(7),
    col: z.number().int().min(0).max(7),
  }),
  z.object({ type: z.literal('pass') }),
]);
export type ReversiAction = z.infer<typeof reversiActionSchema>;

export const connect4ActionSchema = z.object({
  type: z.literal('drop'),
  col: z.number().int().min(0).max(6),
});
export type Connect4Action = z.infer<typeof connect4ActionSchema>;

export const bigTwoCardSchema = z.object({
  rank: z.number().int().min(0).max(12),
  suit: z.number().int().min(0).max(3),
});
export const bigTwoActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play'), cards: z.array(bigTwoCardSchema).min(1).max(5) }),
  z.object({ type: z.literal('pass') }),
]);
export type BigTwoAction = z.infer<typeof bigTwoActionSchema>;

/** 0..63, a1=0 .. h8=63 (standard little-endian rank-file mapping). */
const chessSquareSchema = z.number().int().min(0).max(63);
export const chessActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move'),
    from: chessSquareSchema,
    to: chessSquareSchema,
    promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
  }),
  z.object({ type: z.literal('resign') }),
  z.object({ type: z.literal('offer_draw') }),
  z.object({ type: z.literal('respond_draw'), accept: z.boolean() }),
  z.object({ type: z.literal('offer_takeback') }),
  z.object({ type: z.literal('respond_takeback'), accept: z.boolean() }),
  z.object({ type: z.literal('claim_draw') }),
]);
export type ChessAction = z.infer<typeof chessActionSchema>;

/** 0..89, point = row*9+col; row 0 is Black's back rank, row 9 is Red's. */
const xiangqiPointSchema = z.number().int().min(0).max(89);
export const xiangqiActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), from: xiangqiPointSchema, to: xiangqiPointSchema }),
  z.object({ type: z.literal('resign') }),
  z.object({ type: z.literal('offer_draw') }),
  z.object({ type: z.literal('respond_draw'), accept: z.boolean() }),
  z.object({ type: z.literal('offer_takeback') }),
  z.object({ type: z.literal('respond_takeback'), accept: z.boolean() }),
  z.object({ type: z.literal('claim_draw') }),
]);
export type XiangqiAction = z.infer<typeof xiangqiActionSchema>;

export const tetrisActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), dir: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('rotate'), dir: z.enum(['cw', 'ccw']) }),
  z.object({ type: z.literal('softDrop') }),
  z.object({ type: z.literal('hardDrop') }),
  z.object({ type: z.literal('hold') }),
  z.object({ type: z.literal('toggleAssist') }),
]);
export type TetrisAction = z.infer<typeof tetrisActionSchema>;

export const pacmanActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dir'), dir: z.enum(['up', 'down', 'left', 'right']) }),
  z.object({ type: z.literal('tick') }),
]);
export type PacmanAction = z.infer<typeof pacmanActionSchema>;
export const spaceInvadersActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), dir: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('fire') }),
  z.object({ type: z.literal('toggleAssist') }),
  z.object({ type: z.literal('tick') }),
]);
export type SpaceInvadersAction = z.infer<typeof spaceInvadersActionSchema>;

export const bombermanActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), dir: z.enum(['up', 'down', 'left', 'right']) }),
  z.object({ type: z.literal('bomb') }),
  z.object({ type: z.literal('tick') }),
]);
export type BombermanAction = z.infer<typeof bombermanActionSchema>;

export const gameActionSchema = z.union([
  propertyTycoonActionSchema,
  manorMysteryActionSchema,
  scrabbleActionSchema,
  congkakActionSchema,
  checkersActionSchema,
  reversiActionSchema,
  connect4ActionSchema,
  bigTwoActionSchema,
  chessActionSchema,
  xiangqiActionSchema,
  tetrisActionSchema,
  pacmanActionSchema,
  spaceInvadersActionSchema,
  bombermanActionSchema,
]);
export type GameAction =
  | PropertyTycoonAction
  | ManorMysteryAction
  | ScrabbleAction
  | CongkakAction
  | CheckersAction
  | ReversiAction
  | Connect4Action
  | BigTwoAction
  | ChessAction
  | XiangqiAction
  | TetrisAction
  | PacmanAction
  | SpaceInvadersAction
  | BombermanAction;

/**
 * `forfeit` is deliberately NOT part of `gameActionSchema` — it is produced
 * only by the runtime's chess-clock logic (time-out / 4-minute idle cap),
 * never accepted from a client, so a player can never forfeit an opponent.
 */
export const chessClockForfeitSchema = z.object({
  type: z.literal('forfeit'),
  reason: z.enum(['time', 'idle']),
});
export type ChessClockForfeitAction = z.infer<typeof chessClockForfeitSchema>;
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
  paused: z.boolean().default(false),
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
  avatar: z.string().nullable().optional(),
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
  paused?: boolean;
  /**
   * Chess-clock games only (Chess, Xiangqi): each human player's remaining
   * time bank. Null for every other game. `clockRunningSince` is the epoch
   * ms the current actor's bank started draining — the client subtracts
   * locally and resyncs from the next snapshot, same pattern as `endsAt`.
   */
  clocks?: { playerId: string; remainingMs: number }[] | null;
  clockActor?: string | null;
  clockRunningSince?: number | null;
  /** The hard per-move deadline (min(bank, 4 minutes)), epoch ms. */
  moveDeadline?: number | null;
}

export interface PuzzleCommitAck {
  accepted: boolean;
  /** Only present when the host enabled instantFeedback. */
  correct?: boolean;
  progress: number;
  error?: string;
  /** Word Search only: the word this selection completed, or null when the
   *  selection did not match an unfound word. Distinct from `correct` — Word
   *  Search always reveals which words it finds, regardless of the host's
   *  instantFeedback setting, since that is the whole point of the game. */
  foundWord?: string | null;
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
  roomPause: 'room:pause',
  roomResume: 'room:resume',
  roomRestart: 'room:restart',
  puzzleCommit: 'puzzle:commit',
  puzzleHint: 'puzzle:hint',
  gameAction: 'game:action',
  chatSend: 'chat:send',
  /** Chess-clock games only: dismisses the "still thinking?" modal client-side. */
  stillThinkingAck: 'game:stillThinkingAck',
  // server -> client
  roomSnapshot: 'room:snapshot',
  roomPlayers: 'room:players',
  roomStarted: 'room:started',
  roomEnded: 'room:ended',
  roomPaused: 'room:paused',
  roomResumed: 'room:resumed',
  leaderboard: 'leaderboard',
  gameState: 'game:state',
  gameLog: 'game:log',
  chatMessage: 'chat:message',
  error: 'error',
  /**
   * Chess-clock games only: fired at 1/2/3 minutes of idling on the same
   * move (strike 1-3). A 4th minute forfeits the move without a 4th prompt.
   */
  stillThinking: 'game:stillThinking',
} as const;
