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
