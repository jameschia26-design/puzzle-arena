/**
 * Pure Scrabble board/tile constants — no dictionary, no engine logic. Lives
 * in packages/shared (not packages/games/src/scrabble) specifically so the
 * web client can render the board and racks WITHOUT pulling in the 172k-word
 * dictionary or the bot's move generator, both of which sit behind
 * @puzzle-arena/games and have no business shipping to a browser tab.
 * packages/games/src/scrabble/board.ts and tiles.ts re-export these so the
 * engine's own import paths are unaffected.
 */

export const BOARD_SIZE = 15;
export const CENTER_ROW = 7;
export const CENTER_COL = 7;

export type PremiumType = 'TW' | 'DW' | 'TL' | 'DL' | null;

const TRIPLE_WORD: [number, number][] = [
  [0, 0], [0, 7], [0, 14],
  [7, 0], [7, 14],
  [14, 0], [14, 7], [14, 14],
];

const DOUBLE_WORD: [number, number][] = [
  [1, 1], [2, 2], [3, 3], [4, 4],
  [1, 13], [2, 12], [3, 11], [4, 10],
  [13, 1], [12, 2], [11, 3], [10, 4],
  [13, 13], [12, 12], [11, 11], [10, 10],
  [7, 7], // centre star — also the double-word square.
];

const TRIPLE_LETTER: [number, number][] = [
  [1, 5], [1, 9],
  [5, 1], [5, 5], [5, 9], [5, 13],
  [9, 1], [9, 5], [9, 9], [9, 13],
  [13, 5], [13, 9],
];

const DOUBLE_LETTER: [number, number][] = [
  [0, 3], [0, 11],
  [2, 6], [2, 8],
  [3, 0], [3, 7], [3, 14],
  [6, 2], [6, 6], [6, 8], [6, 12],
  [7, 3], [7, 11],
  [8, 2], [8, 6], [8, 8], [8, 12],
  [11, 0], [11, 7], [11, 14],
  [12, 6], [12, 8],
  [14, 3], [14, 11],
];

export const indexOf = (row: number, col: number): number => row * BOARD_SIZE + col;

export const inBounds = (row: number, col: number): boolean =>
  row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;

const PREMIUM_GRID: PremiumType[] = new Array(BOARD_SIZE * BOARD_SIZE).fill(null);
for (const [r, c] of TRIPLE_WORD) PREMIUM_GRID[indexOf(r, c)] = 'TW';
for (const [r, c] of DOUBLE_WORD) PREMIUM_GRID[indexOf(r, c)] = 'DW';
for (const [r, c] of TRIPLE_LETTER) PREMIUM_GRID[indexOf(r, c)] = 'TL';
for (const [r, c] of DOUBLE_LETTER) PREMIUM_GRID[indexOf(r, c)] = 'DL';

export function premiumAt(row: number, col: number): PremiumType {
  return PREMIUM_GRID[indexOf(row, col)] ?? null;
}

/** A frozen copy for clients that want the whole layout at once (e.g. the board UI). */
export const PREMIUM_LAYOUT: readonly PremiumType[] = Object.freeze([...PREMIUM_GRID]);

/** Rack/bag slot value representing an unassigned blank tile. */
export const BLANK = '_';

export const TILE_VALUES: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

/** Standard 100-tile English Scrabble distribution. */
export const TILE_COUNTS: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1,
  K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
  [BLANK]: 2,
};

export const RACK_SIZE = 7;
export const BAG_SIZE = 100;

/** Face value of a tile. Blanks are always worth 0, regardless of the letter they represent. */
export function letterValue(letter: string, isBlank: boolean): number {
  if (isBlank) return 0;
  return TILE_VALUES[letter] ?? 0;
}

/** Value of a tile still sitting in a rack — `'_'` reads as an unassigned blank. */
export function rackTileValue(rackLetter: string): number {
  return letterValue(rackLetter, rackLetter === BLANK);
}

/** A freshly shuffled 100-tile bag is built by the caller via `rng.shuffle(freshBag())`. */
export function freshBag(): string[] {
  const bag: string[] = [];
  for (const [letter, count] of Object.entries(TILE_COUNTS)) {
    for (let i = 0; i < count; i++) bag.push(letter);
  }
  return bag;
}
