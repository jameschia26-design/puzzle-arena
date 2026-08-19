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
