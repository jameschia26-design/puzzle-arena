import { ENABLE1_WORDS } from './dictionary-data.js';

/**
 * Built once per process from the bundled ENABLE1 word list (public domain —
 * see dictionary-data.ts and data/feat-scrabble-game/report.md #1.2 for why
 * this is not the NASPA/Collins tournament lexicon). A module-level constant
 * is the same memoisation every other static game table in this package
 * uses (BOARD, GROUPS, CARD_BY_ID in property-tycoon) — it loads once and is
 * shared by every room and every bot in the process.
 */
const WORD_SET: ReadonlySet<string> = new Set(ENABLE1_WORDS.split('\n'));

export function isValidWord(word: string): boolean {
  return WORD_SET.has(word.toUpperCase());
}

export function dictionarySize(): number {
  return WORD_SET.size;
}
