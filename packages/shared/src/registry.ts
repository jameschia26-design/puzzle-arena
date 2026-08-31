import { z } from 'zod';

export const GAME_IDS = [
  'sudoku',
  'killer-sudoku',
  'nonogram',
  'word-search',
  'minesweeper',
  'property-tycoon',
  'manor-mystery',
  'scrabble',
  'congkak',
  'checkers',
  'reversi',
  'connect4',
  'big-two',
  'chess',
  'xiangqi',
  'animal-chess',
  'tetris',
  'pacman',
] as const;
export type GameId = (typeof GAME_IDS)[number];

export const gameIdSchema = z.enum(GAME_IDS);

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const difficultySchema = z.enum(DIFFICULTIES);

// 'ai' (an LLM picking a move by index out of the legal-move list, no
// lookahead) used to sit above 'hard' as the strongest tier and was even
// steered toward as the default pick in the UI. It wasn't: a single LLM
// guess is regularly weaker than the local alpha-beta search 'hard' already
// runs, so selecting it made bots play worse, not better. Removed rather
// than fixed — an LLM has no way to out-calculate a real search for a
// perfect-information board game like this.
export const BOT_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export const WORD_SEARCH_THEMES = [
  'Space',
  'Animals',
  'Ocean & Deep Sea',
  'Food & Cooking',
  'Computing & Tech',
  'Mythology & Fantasy',
  'Sports & Games',
  'Music & Audio',
  'Weather & Seasons',
  'World & Travel',
] as const;
export type WordSearchTheme = (typeof WORD_SEARCH_THEMES)[number];

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
export const minesweeperConfigSchema = z.object({
  ...basePuzzleConfig,
});

export const reversiConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(60),
});

export const connect4ConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(60),
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

export const checkersConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(60),
});

export const bigTwoConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(60),
});

export const animalChessConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(60),
});
export const tetrisConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(90),
  startLevel: z.number().int().min(1).max(20).default(1),
  /** Ghost shadow visible (assist mode). false = classic mode. */
  assist: z.boolean().default(true),
});
export const pacmanConfigSchema = z.object({
  turnTimeLimitSec: z.number().int().min(15).max(300).default(90),
  startLevel: z.number().int().min(1).max(21).default(1),
});
/**
 * Chess and Xiangqi are the only two board games that use a real chess-clock
 * (total time bank per player) instead of `turnTimeLimitSec`. The runtime
 * dispatches on `usesChessClock()` rather than a config field, so leaving
 * `turnTimeLimitSec` off these two schemas is deliberate and load-bearing.
 */
const chessClockConfig = {
  /** Total per-player time bank, in minutes. */
  clockMinutes: z.number().int().min(1).max(120).default(10),
  /** Fischer increment added to the mover's bank after each accepted move. */
  incrementSec: z.number().int().min(0).max(60).default(0),
  allowTakeback: z.boolean().default(true),
};

export const chessConfigSchema = z.object({ ...chessClockConfig });
export const xiangqiConfigSchema = z.object({ ...chessClockConfig });

/** No single move may take longer than this, even if the bank has more left. */
export const CHESS_MOVE_CAP_MS = 240_000;
/** "Still thinking?" prompts fire every this-many ms while idling on a move. */
export const CHESS_IDLE_PROMPT_MS = 60_000;

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
  minesweeper: {
    id: 'minesweeper',
    title: 'Minesweeper',
    kind: 'puzzle',
    minPlayers: 1,
    maxPlayers: 200,
    defaultTimeLimitSec: 900,
    supportsBots: true,
    configSchema: minesweeperConfigSchema,
    blurb: 'Clear the minefield without detonating a single bomb. Flag hidden mines and chord numbers.',
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
  checkers: {
    id: 'checkers',
    title: 'Checkers',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 2,
    defaultTimeLimitSec: 1800,
    supportsBots: true,
    configSchema: checkersConfigSchema,
    blurb: 'International draughts: flying kings, forced captures, and a race to clear the board.',
  },
  reversi: {
    id: 'reversi',
    title: 'Reversi',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 2,
    defaultTimeLimitSec: 1800,
    supportsBots: true,
    configSchema: reversiConfigSchema,
    blurb: 'Classic Othello / Reversi: flank and flip your opponent discs across an 8x8 grid.',
  },
  connect4: {
    id: 'connect4',
    title: 'Connect 4',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 2,
    defaultTimeLimitSec: 1200,
    supportsBots: true,
    configSchema: connect4ConfigSchema,
    blurb: 'Vertical gravity 4-in-a-row: drop discs to align four in a line before your opponent.',
  },
  'big-two': {
    id: 'big-two',
    title: 'Big Two',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 4,
    defaultTimeLimitSec: 1800,
    supportsBots: true,
    configSchema: bigTwoConfigSchema,
    blurb: 'Shed your hand first — beat the last combo or pass, bombs beat anything.',
  },
  chess: {
    id: 'chess',
    title: 'Chess',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 2,
    defaultTimeLimitSec: 3600,
    supportsBots: true,
    configSchema: chessConfigSchema,
    blurb: 'International chess: full FIDE rules on a per-player clock, castling and all.',
  },
  xiangqi: {
    id: 'xiangqi',
    title: 'Xiangqi',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 2,
    defaultTimeLimitSec: 3600,
    supportsBots: true,
    configSchema: xiangqiConfigSchema,
    blurb: 'Chinese chess: generals, chariots and cannons battle across the river.',
  },
  'animal-chess': {
    id: 'animal-chess',
    title: 'Animal Chess',
    kind: 'board',
    minPlayers: 2,
    maxPlayers: 2,
    defaultTimeLimitSec: 1800,
    supportsBots: true,
    configSchema: animalChessConfigSchema,
    blurb: 'Dou Shou Qi (Jungle): 8 animals, rivers, traps and dens in ancient tactical combat.',
  },
  tetris: {
    id: 'tetris',
    title: 'Tetris',
    kind: 'board',
    minPlayers: 1,
    maxPlayers: 8,
    defaultTimeLimitSec: 0,
    supportsBots: true,
    configSchema: tetrisConfigSchema,
    blurb: 'Stack, clear and survive — 10×20 with SRS, 7-bag, hold and T-spins. Toggle assist mode for a ghost shadow.',
  },
  pacman: {
    id: 'pacman',
    title: 'Pac-Man',
    kind: 'board',
    minPlayers: 1,
    maxPlayers: 8,
    defaultTimeLimitSec: 0,
    supportsBots: true,
    configSchema: pacmanConfigSchema,
    blurb: 'Navigate the 28×31 maze, eat dots, chase frightened ghosts and grab fruit through 21 levels.',
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

// Every entry here must be a single-codepoint emoji (no variation-selector
// suffix) — sequences like joystick (U+1F579 U+FE0F) or snowflake
// (U+2744 U+FE0F) render as a missing-glyph "tofu" box on some Android
// system/WebView fonts, which reads as a broken cross icon in the picker.
export const AVATAR_EMOJI = [
  '🚀', '👾', '🎮', '🎯', '💾', '🧩', '🎲', '🏆',
  '⚡', '🔮', '🦊', '🐙', '🦉', '🐝', '🦄', '🐲',
  '🍄', '⭐', '🌙', '🔥', '🧊', '🌊', '🎧', '🛸',
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
