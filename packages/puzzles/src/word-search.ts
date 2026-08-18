import { mulberry32, type Rng } from '@puzzle-arena/shared';
import type { Difficulty } from './core/solver.js';
import type { PuzzleMeta } from './sudoku.js';

/** The 8 directions, as [dx, dy]. */
export const DIRECTIONS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];

export interface Placement {
  word: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface WordSearchPuzzle {
  size: number;
  /** Row-major uppercase letters. */
  grid: string[];
  words: string[];
  theme: string;
}

export interface WordSearchSolution {
  placements: Placement[];
}

/** English letter frequency, for filler that does not look random. */
const LETTER_FREQ: [string, number][] = [
  ['E', 1202], ['T', 910], ['A', 812], ['O', 768], ['I', 731], ['N', 695],
  ['S', 628], ['R', 602], ['H', 592], ['D', 432], ['L', 398], ['U', 288],
  ['C', 271], ['M', 261], ['F', 230], ['Y', 211], ['W', 209], ['G', 203],
  ['P', 182], ['B', 149], ['V', 111], ['K', 69], ['X', 17], ['Q', 11],
  ['J', 10], ['Z', 7],
];
const FREQ_TOTAL = LETTER_FREQ.reduce((a, [, w]) => a + w, 0);

function randomLetter(rng: Rng): string {
  let roll = rng.int(FREQ_TOTAL);
  for (const [ch, w] of LETTER_FREQ) {
    if (roll < w) return ch;
    roll -= w;
  }
  return 'E';
}

/** Every occurrence of `word` in the grid, in all 8 directions. */
export function findAll(grid: string[], size: number, word: string): Placement[] {
  const hits: Placement[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (const [dx, dy] of DIRECTIONS) {
        const endX = x + dx * (word.length - 1);
        const endY = y + dy * (word.length - 1);
        if (endX < 0 || endX >= size || endY < 0 || endY >= size) continue;
        let ok = true;
        for (let k = 0; k < word.length; k++) {
          if (grid[(y + dy * k) * size + (x + dx * k)] !== word[k]) {
            ok = false;
            break;
          }
        }
        if (ok) hits.push({ word, x, y, dx, dy });
      }
    }
  }
  return hits;
}

function placeWords(
  size: number,
  words: string[],
  rng: Rng,
): { grid: (string | null)[]; placements: Placement[] } | null {
  const grid: (string | null)[] = new Array<string | null>(size * size).fill(null);
  const placements: Placement[] = [];

  // Longest first — long words are the hard ones to fit.
  const ordered = [...words].sort((a, b) => b.length - a.length);

  const tryPlace = (idx: number): boolean => {
    if (idx === ordered.length) return true;
    const word = ordered[idx] as string;

    const spots: Placement[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (const [dx, dy] of DIRECTIONS) {
          const endX = x + dx * (word.length - 1);
          const endY = y + dy * (word.length - 1);
          if (endX < 0 || endX >= size || endY < 0 || endY >= size) continue;
          let ok = true;
          for (let k = 0; k < word.length; k++) {
            const cur = grid[(y + dy * k) * size + (x + dx * k)];
            if (cur !== null && cur !== word[k]) {
              ok = false;
              break;
            }
          }
          if (ok) spots.push({ word, x, y, dx, dy });
        }
      }
    }
    rng.shuffle(spots);

    for (const spot of spots.slice(0, 40)) {
      const written: number[] = [];
      for (let k = 0; k < word.length; k++) {
        const at = (spot.y + spot.dy * k) * size + (spot.x + spot.dx * k);
        if (grid[at] === null) {
          grid[at] = word[k] as string;
          written.push(at);
        }
      }
      placements.push(spot);
      if (tryPlace(idx + 1)) return true;
      placements.pop();
      for (const at of written) grid[at] = null;
    }
    return false;
  };

  return tryPlace(0) ? { grid, placements } : null;
}

export function generate(opts: {
  difficulty: Difficulty;
  seed: number;
  size?: number;
  words: string[];
  theme?: string;
}): { puzzle: WordSearchPuzzle; solution: WordSearchSolution; meta: PuzzleMeta } {
  const started = Date.now();
  const size = opts.size ?? (opts.difficulty === 'easy' ? 12 : opts.difficulty === 'medium' ? 14 : 18);

  // Normalise: uppercase, letters only, 4..9 chars, deduped, must fit the grid.
  const words = [...new Set(opts.words.map((w) => w.toUpperCase().replace(/[^A-Z]/g, '')))]
    .filter((w) => w.length >= 4 && w.length <= 9 && w.length <= size)
    .slice(0, 18);

  if (words.length === 0) throw new Error('word-search: no usable words');

  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = mulberry32(opts.seed + attempt * 5347);
    const placed = placeWords(size, words, rng);
    if (!placed) continue;

    // Fill the gaps, then re-scan. A filler letter can accidentally spell a
    // target word a second time, which would make the puzzle ambiguous.
    for (let fillTry = 0; fillTry < 50; fillTry++) {
      const grid = placed.grid.map((c) => c ?? randomLetter(rng));

      let clean = true;
      for (const word of words) {
        const hits = findAll(grid, size, word);
        // Exactly one occurrence, and it must be the intended placement.
        if (hits.length !== 1) {
          clean = false;
          break;
        }
        const intended = placed.placements.find((p) => p.word === word);
        const hit = hits[0] as Placement;
        if (
          !intended ||
          hit.x !== intended.x ||
          hit.y !== intended.y ||
          hit.dx !== intended.dx ||
          hit.dy !== intended.dy
        ) {
          clean = false;
          break;
        }
      }
      if (!clean) continue;

      return {
        puzzle: { size, grid, words: [...words].sort(), theme: opts.theme ?? '' },
        solution: { placements: placed.placements },
        meta: {
          actualDifficulty: opts.difficulty,
          generationMs: Date.now() - started,
          seed: opts.seed,
        },
      };
    }
  }

  throw new Error('word-search: generation failed');
}

export interface WordSearchGrade {
  wordsTotal: number;
  wordsFound: number;
  selectionsSubmitted: number;
  complete: boolean;
}

/** Player state: the words found plus how many selections were attempted. */
export function grade(playerState: unknown, solution: WordSearchSolution): WordSearchGrade {
  const st = (playerState ?? {}) as { found?: string[]; selections?: number };
  const found = new Set(st.found ?? []);
  const wordsTotal = solution.placements.length;
  const wordsFound = solution.placements.filter((p) => found.has(p.word)).length;
  return {
    wordsTotal,
    wordsFound,
    selectionsSubmitted: st.selections ?? 0,
    complete: wordsTotal > 0 && wordsFound === wordsTotal,
  };
}

/**
 * Validate a player's drag selection. Returns the word if the straight line
 * from (x1,y1) to (x2,y2) spells an unfound target, else null.
 */
export function checkSelection(
  puzzle: WordSearchPuzzle,
  solution: WordSearchSolution,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string | null {
  const dxRaw = x2 - x1;
  const dyRaw = y2 - y1;
  const len = Math.max(Math.abs(dxRaw), Math.abs(dyRaw)) + 1;
  if (len < 2) return null;
  // Must be a straight line in one of the 8 directions.
  if (dxRaw !== 0 && dyRaw !== 0 && Math.abs(dxRaw) !== Math.abs(dyRaw)) return null;
  const dx = Math.sign(dxRaw);
  const dy = Math.sign(dyRaw);

  for (const p of solution.placements) {
    if (p.word.length !== len) continue;
    // Accept the selection dragged in either direction.
    const forward = p.x === x1 && p.y === y1 && p.dx === dx && p.dy === dy;
    const backward =
      p.x === x2 && p.y === y2 && p.dx === -dx && p.dy === -dy;
    if (forward || backward) return p.word;
  }
  return null;
}

export function hint(
  solution: WordSearchSolution,
  playerState: unknown,
  rng: Rng,
): { path: string; value: string } | null {
  const st = (playerState ?? {}) as { found?: string[] };
  const found = new Set(st.found ?? []);
  const open = solution.placements.filter((p) => !found.has(p.word));
  if (open.length === 0) return null;
  const pick = open[rng.int(open.length)] as Placement;
  // Reveal the first letter's position only — enough to start, not to finish.
  return { path: `${pick.y},${pick.x}`, value: pick.word };
}
