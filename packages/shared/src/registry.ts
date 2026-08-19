import { z } from 'zod';

export const GAME_IDS = [
  'sudoku',
  'killer-sudoku',
  'nonogram',
  'word-search',
  'property-tycoon',
  'manor-mystery',
  'scrabble',
  'congkak',
] as const;

export type GameId = (typeof GAME_IDS)[number];

export const gameIdSchema = z.enum(GAME_IDS);

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const difficultySchema = z.enum(DIFFICULTIES);

export const BOT_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];
export const botDifficultySchema = z.enum(BOT_DIFFICULTIES);

/** Config shared by every puzzle room. */
const basePuzzleConfig = {
  difficulty: difficultySchema.default('medium'),
  instantFeedback: z.boolean().default(false),
};

export const sudokuConfigSchema = z.object({ ...basePuzzleConfig });
export const killerSudokuConfigSchema = z.object({ ...basePuzzleConfig });
export const nonogramConfigSchema = z.object({
  ...basePuzzleConfig,
  size: z.union([z.literal(10), z.literal(15), z.literal(20)]).default(10),
});
export const wordSearchConfigSchema = z.object({
  ...basePuzzleConfig,
  size: z.number().int().min(12).max(18).default(14),
  theme: z.string().min(1).max(40).default('Space'),
});

export const propertyTycoonConfigSchema = z.object({
  startingCash: z.number().int().min(500).max(5000).default(1500),
  auctionsEnabled: z.boolean().default(true),
  restStopJackpot: z.boolean().default(false),
  turnTimeLimitSec: z.number().int().min(15).max(300).default(90),
});

export const manorMysteryConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(90),
});

export const scrabbleConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(90),
});

export const congkakConfigSchema = z.object({
  pitsPerSide: z.number().int().min(5).max(9).default(7),
  seedsPerPit: z.number().int().min(4).max(7).default(7),
  turnTimeLimitSec: z.number().int().min(15).max(300).default(60),
});
export interface GameMeta {
  id: GameId;
  title: string;
  kind: 'puzzle' | 'board';
  minPlayers: number;
  maxPlayers: number;
  defaultTimeLimitSec: number;
  supportsBots: true;
  configSchema: z.ZodType;
  blurb: string;
}

export const GAME_REGISTRY: Record<GameId, GameMeta> = {
  sudoku: {
    id: 'sudoku',
    title: 'Sudoku',
    kind: 'puzzle',
    minPlayers: 1,
    maxPlayers: 200,
    defaultTimeLimitSec: 900,
    supportsBots: true,
    configSchema: sudokuConfigSchema,
    blurb: 'Fill the 9x9 grid so every row, column and box holds 1-9 exactly once.',
  },
  'killer-sudoku': {
    id: 'killer-sudoku',
    title: 'Killer Sudoku',
    kind: 'puzzle',
    minPlayers: 1,
    maxPlayers: 200,
    defaultTimeLimitSec: 900,
    supportsBots: true,
    configSchema: killerSudokuConfigSchema,
    blurb: 'Sudoku with no givens — cages must sum to their target with no repeats.',
  },
  nonogram: {
    id: 'nonogram',
    title: 'Nonogram',
    kind: 'puzzle',
    minPlayers: 1,
    maxPlayers: 200,
    defaultTimeLimitSec: 900,
    supportsBots: true,
    configSchema: nonogramConfigSchema,
    blurb: 'Paint the grid from the row and column run clues to reveal a picture.',
  },
  'word-search': {
    id: 'word-search',
    title: 'Word Search',
    kind: 'puzzle',
    minPlayers: 1,
    maxPlayers: 200,
    defaultTimeLimitSec: 900,
    supportsBots: true,
    configSchema: wordSearchConfigSchema,
    blurb: 'Find every themed word hidden in eight directions.',
  },
  'property-tycoon': {
    id: 'property-tycoon',
    title: 'Property Tycoon',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 8,
    defaultTimeLimitSec: 3600,
    supportsBots: true,
    configSchema: propertyTycoonConfigSchema,
    blurb: 'Buy, build and bankrupt your rivals around a 40-square city.',
  },
  'manor-mystery': {
    id: 'manor-mystery',
    title: 'Manor Mystery',
    kind: 'board',
    minPlayers: 3,
    maxPlayers: 6,
    defaultTimeLimitSec: 1800,
    supportsBots: true,
    configSchema: manorMysteryConfigSchema,
    blurb: 'Deduce the suspect, weapon and room before anyone else.',
  },
  scrabble: {
    id: 'scrabble',
    title: 'Scrabble',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 4,
    defaultTimeLimitSec: 2700,
    supportsBots: true,
    configSchema: scrabbleConfigSchema,
    blurb: 'Build words across a shared 15x15 board and rack up the highest score.',
  },
  congkak: {
    id: 'congkak',
    title: 'Congkak',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 2,
    defaultTimeLimitSec: 1200,
    supportsBots: true,
    configSchema: congkakConfigSchema,
    blurb: 'Classic Southeast Asian Mancala: sow seeds, trigger relay runs, and capture houses into your storehouse.',
  },
};

export function isPuzzle(id: GameId): boolean {
  return GAME_REGISTRY[id].kind === 'puzzle';
}

export const BOT_NAME_POOL = [
  'Ada',
  'Turing',
  'Hopper',
  'Lovelace',
  'Babbage',
  'Knuth',
  'Dijkstra',
  'Curie',
  'Noether',
  'Ramanujan',
  'Euler',
  'Gauss',
  'Shannon',
  'Backus',
  'Liskov',
  'Torvalds',
  'Ritchie',
  'Thompson',
  'Kay',
  'Engelbart',
  'Wozniak',
  'Hamilton',
  'Johnson',
  'Vaughan',
] as const;

export const AVATAR_EMOJI = [
  '🚀', '👾', '🎮', '🕹️', '💾', '🧩', '🎲', '🏆',
  '⚡', '🔮', '🦊', '🐙', '🦉', '🐝', '🦄', '🐲',
  '🍄', '⭐', '🌙', '🔥', '❄️', '🌊', '🎧', '🛸',
] as const;

/** 8 seat colours, chosen for mutual distinguishability. */
export const SEAT_COLORS = [
  '#ff3f8e',
  '#22e0ff',
  '#9dff3c',
  '#ffb020',
  '#8b5cf6',
  '#ff6b35',
  '#37f0c2',
  '#f2f5ff',
] as const;

/** Crockford-style alphabet: no 0/O/1/I/L/U. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE_LENGTH = 6;

export const RECONNECT_GRACE_SEC = 120;
export const DEFAULT_TURN_TIME_LIMIT_SEC = 90;
/** room:started sets startsAt this far ahead so every client runs 3-2-1-GO in step. */
export const START_COUNTDOWN_MS = 2200;

export function parseGameConfig(gameId: GameId, raw: unknown): unknown {
  return GAME_REGISTRY[gameId].configSchema.parse(raw ?? {});
}
