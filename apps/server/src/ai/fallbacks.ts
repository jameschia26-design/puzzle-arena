import { fallbackWordsFor } from '@puzzle-arena/puzzles';

/**
 * What the AI layer serves when a provider is unreachable, times out, or
 * returns something that fails schema validation. A room must always start.
 */

export { fallbackWordsFor };

export const MYSTERY_BLURBS: { victim: string; setting: string; blurb: string }[] = [
  {
    victim: 'Lord Ashcombe',
    setting: 'Ashcombe Manor, a winter storm',
    blurb: 'The power failed at nine. When the lamps returned, the study door stood open.',
  },
  {
    victim: 'Professor Waverly',
    setting: 'a country house on the moors',
    blurb: 'He had promised to name his blackmailer at dinner. He never reached the soup.',
  },
  {
    victim: 'Madame Duclos',
    setting: 'a rain-soaked estate outside town',
    blurb: 'Her rings were untouched, which told the inspector this was never about money.',
  },
  {
    victim: 'Sir Edmund Vale',
    setting: 'the old hall, the night of the hunt ball',
    blurb: 'Six guests, six alibis, and a clock that had been set twenty minutes fast.',
  },
  {
    victim: 'Miss Harriet Coates',
    setting: 'a manor house cut off by floodwater',
    blurb: 'The telephone line was cut from the inside. Nobody had left since supper.',
  },
  {
    victim: 'Colonel Pemberton',
    setting: 'Pemberton Grange at midsummer',
    blurb: 'He was found beneath his own portrait, still holding the letter he meant to burn.',
  },
  {
    victim: 'Doctor Ellery Finch',
    setting: 'a shuttered house on the coast road',
    blurb: 'The sea drowned every sound that night, including the one that mattered.',
  },
  {
    victim: 'Mrs. Aurelia Thorne',
    setting: 'the Thorne residence, the eve of the reading of the will',
    blurb: 'She had changed her will that afternoon. Only one guest knew it.',
  },
  {
    victim: 'Mr. Silas Grange',
    setting: 'a manor snowed in for three days',
    blurb: 'The footprints in the conservatory led in, and never out again.',
  },
  {
    victim: 'Captain Reyes',
    setting: 'a great house at the end of the lane',
    blurb: 'Every clock in the house had stopped at ten past eleven. Only one had been wound.',
  },
];

export function fallbackMysteryFlavour(seed: number): {
  victim: string;
  setting: string;
  blurb: string;
} {
  const idx = Math.abs(seed) % MYSTERY_BLURBS.length;
  return MYSTERY_BLURBS[idx] as { victim: string; setting: string; blurb: string };
}

export function fallbackPuzzleTitle(gameId: string, difficulty: string): { title: string } {
  const titles: Record<string, string[]> = {
    sudoku: ['Nine by Nine', 'The Digit Lattice', 'Row, Column, Box'],
    'killer-sudoku': ['Sum of Its Parts', 'The Cage Set', 'Arithmetic Confinement'],
    nonogram: ['Paint by Numbers', 'The Hidden Picture', 'Runs and Gaps'],
    'word-search': ['Hidden in Plain Sight', 'The Letter Field', 'Eight Directions'],
  };
  const pool = titles[gameId] ?? ['Puzzle Arena'];
  const idx = difficulty.length % pool.length;
  return { title: pool[idx] as string };
}
