import type { BotDifficulty, Rng, ScrabbleAction } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import { BOARD_SIZE, CENTER_COL, CENTER_ROW, inBounds, indexOf, premiumAt } from './board.js';
import { ENABLE1_WORDS } from './dictionary-data.js';
import { isValidWord } from './dictionary.js';
import { BLANK, RACK_SIZE, letterValue } from './tiles.js';

/**
 * The view this policy consumes. Declared locally and deliberately NOT
 * imported from ./state.js — see BotPolicy in ../bot.js. This module also
 * does not reuse rules.ts's ScrabbleState-typed helpers (validatePlacement,
 * anchorSquares, ...) for the same reason: those take the full engine state,
 * which carries the RNG stream and every player's real rack. Reusing them
 * here would tempt a future edit into fabricating a fake full state just to
 * call them, defeating the point of a locally-typed view. The pure,
 * state-free board/tile/dictionary tables (board.ts, tiles.ts, dictionary.ts)
 * carry no privacy risk and are reused directly, exactly like the Property
 * Tycoon bot reuses BOARD/GROUPS/HOUSE_COST from board.ts/cards.ts.
 */
export interface SCRBotView {
  board: ({ letter: string; isBlank: boolean } | null)[];
  bagCount: number;
  players: { id: string; seat: number; rackSize: number; score: number }[];
  current: string | null;
  turnPhase: 'awaiting_move' | 'game_over';
  passStreak: number;
  you: { id: string; rack: string[] } | null;
}

type BotCell = { letter: string; isBlank: boolean } | null;

/** Longest word this generator will search for. A real rack + a few existing
 *  letters rarely bridges further than this; bounding it keeps a bot's move
 *  search comfortably inside BOT_THINK_MS even on a fairly full board. */
const MAX_WORD_LEN = 7;
/** Stop searching once this many legal candidates have been found. */
const CANDIDATE_CAP = 150;
/** Cap how many anchor squares a single turn's search considers — a fuller
 *  board can have dozens; sampling keeps the worst case bounded. */
const MAX_ANCHORS = 16;
/** Cap how many same-length dictionary words a single window checks. Common
 *  lengths (4-7) can hold thousands of entries; this keeps the anchor x axis
 *  x length x offset search from blowing up on a busy board. */
const MAX_BUCKET_SCAN = 800;

const WORDS_BY_LENGTH: ReadonlyMap<number, readonly string[]> = (() => {
  const map = new Map<number, string[]>();
  for (const w of ENABLE1_WORDS.split('\n')) {
    if (w.length < 2 || w.length > MAX_WORD_LEN) continue;
    let bucket = map.get(w.length);
    if (!bucket) {
      bucket = [];
      map.set(w.length, bucket);
    }
    bucket.push(w);
  }
  return map;
})();

function at(board: BotCell[], row: number, col: number): BotCell | undefined {
  return inBounds(row, col) ? board[indexOf(row, col)] : undefined;
}

function multiset(letters: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of letters) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

function anchors(board: BotCell[]): [number, number][] {
  const empty = board.every((c) => c === null);
  if (empty) return [[CENTER_ROW, CENTER_COL]];
  const out: [number, number][] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[indexOf(row, col)] !== null) continue;
      const neighbours: [number, number][] = [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ];
      if (neighbours.some(([r, c]) => at(board, r, c))) out.push([row, col]);
    }
  }
  return out;
}

interface LocalCell {
  row: number;
  col: number;
  letter: string;
  isBlank: boolean;
  isNew: boolean;
}

function localAt(
  board: BotCell[],
  placed: Map<string, { letter: string; isBlank: boolean }>,
  row: number,
  col: number,
): LocalCell | null {
  if (!inBounds(row, col)) return null;
  const fresh = placed.get(`${row},${col}`);
  if (fresh) return { row, col, letter: fresh.letter, isBlank: fresh.isBlank, isNew: true };
  const existing = at(board, row, col);
  if (existing) return { row, col, letter: existing.letter, isBlank: existing.isBlank, isNew: false };
  return null;
}

function extendLocal(
  board: BotCell[],
  placed: Map<string, { letter: string; isBlank: boolean }>,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { word: string; cells: LocalCell[] } | null {
  let sr = row;
  let sc = col;
  while (localAt(board, placed, sr - dr, sc - dc)) {
    sr -= dr;
    sc -= dc;
  }
  const cells: LocalCell[] = [];
  let cr = sr;
  let cc = sc;
  for (;;) {
    const cell = localAt(board, placed, cr, cc);
    if (!cell) break;
    cells.push(cell);
    cr += dr;
    cc += dc;
  }
  if (cells.length < 2) return null;
  return { word: cells.map((c) => c.letter).join(''), cells };
}

function scoreCells(cells: LocalCell[]): number {
  let sum = 0;
  let mult = 1;
  for (const cell of cells) {
    const base = letterValue(cell.letter, cell.isBlank);
    if (!cell.isNew) {
      sum += base;
      continue;
    }
    const premium = premiumAt(cell.row, cell.col);
    let letterMultiplier = 1;
    if (premium === 'DL') letterMultiplier = 2;
    else if (premium === 'TL') letterMultiplier = 3;
    else if (premium === 'DW') mult *= 2;
    else if (premium === 'TW') mult *= 3;
    sum += base * letterMultiplier;
  }
  return sum * mult;
}

interface Candidate {
  tiles: { row: number; col: number; letter: string; isBlank: boolean }[];
  score: number;
}

const AXES = [
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
] as const;

/**
 * Anchor + dictionary-bucket move generator. For every anchor square and
 * every window of the axis that could pass through it, scan the words of
 * that exact length for ones matching the existing (fixed) letters in the
 * window, then check the free positions can be covered by the rack (blanks
 * as wildcards). Every candidate is also checked for valid cross-words, so
 * everything returned here is legal by the same rules the reducer enforces.
 */
function generateCandidates(board: BotCell[], rack: string[], rng: Rng): Candidate[] {
  const candidates: Candidate[] = [];
  const rackCounts = multiset(rack);
  const sampledAnchors = rng.shuffle(anchors(board)).slice(0, MAX_ANCHORS);

  for (const [ar, ac] of sampledAnchors) {
    for (const axis of AXES) {
      for (let len = 2; len <= MAX_WORD_LEN; len++) {
        for (let offset = 0; offset < len; offset++) {
          const startRow = ar - offset * axis.dr;
          const startCol = ac - offset * axis.dc;
          const endRow = startRow + (len - 1) * axis.dr;
          const endCol = startCol + (len - 1) * axis.dc;
          if (!inBounds(startRow, startCol) || !inBounds(endRow, endCol)) continue;

          // Maximality: the square just outside either end must be empty, or
          // this window is a truncated slice of a longer real word.
          if (at(board, startRow - axis.dr, startCol - axis.dc)) continue;
          if (at(board, endRow + axis.dr, endCol + axis.dc)) continue;

          const cells: { row: number; col: number; fixed: BotCell }[] = [];
          let newCount = 0;
          let anchorIsFree = false;
          for (let i = 0; i < len; i++) {
            const row = startRow + i * axis.dr;
            const col = startCol + i * axis.dc;
            const fixed = at(board, row, col) ?? null;
            cells.push({ row, col, fixed });
            if (fixed === null) {
              newCount++;
              if (row === ar && col === ac) anchorIsFree = true;
            }
          }
          if (!anchorIsFree || newCount === 0 || newCount > rack.length) continue;

          const bucket = WORDS_BY_LENGTH.get(len);
          if (!bucket) continue;
          const scanLimit = Math.min(bucket.length, MAX_BUCKET_SCAN);

          for (let wi = 0; wi < scanLimit; wi++) {
            const word = bucket[wi] as string;
            let matches = true;
            for (let i = 0; i < len; i++) {
              const cell = cells[i] as { row: number; col: number; fixed: BotCell };
              if (cell.fixed && cell.fixed.letter !== word[i]) {
                matches = false;
                break;
              }
            }
            if (!matches) continue;

            const rackCopy = new Map(rackCounts);
            const placements: { row: number; col: number; letter: string; isBlank: boolean }[] = [];
            let feasible = true;
            for (let i = 0; i < len; i++) {
              const cell = cells[i] as { row: number; col: number; fixed: BotCell };
              if (cell.fixed) continue;
              const need = word[i] as string;
              const ownCount = rackCopy.get(need) ?? 0;
              if (ownCount > 0) {
                rackCopy.set(need, ownCount - 1);
                placements.push({ row: cell.row, col: cell.col, letter: need, isBlank: false });
              } else {
                const blankCount = rackCopy.get(BLANK) ?? 0;
                if (blankCount === 0) {
                  feasible = false;
                  break;
                }
                rackCopy.set(BLANK, blankCount - 1);
                placements.push({ row: cell.row, col: cell.col, letter: need, isBlank: true });
              }
            }
            if (!feasible) continue;

            const placedMap = new Map<string, { letter: string; isBlank: boolean }>();
            for (const p of placements) placedMap.set(`${p.row},${p.col}`, p);

            const perp = axis.dr === 0 ? { dr: 1, dc: 0 } : { dr: 0, dc: 1 };
            let crossScore = 0;
            let allCrossValid = true;
            for (const p of placements) {
              const cross = extendLocal(board, placedMap, p.row, p.col, perp.dr, perp.dc);
              if (!cross) continue;
              if (!isValidWord(cross.word)) {
                allCrossValid = false;
                break;
              }
              crossScore += scoreCells(cross.cells);
            }
            if (!allCrossValid) continue;

            const mainCells: LocalCell[] = cells.map((c) => {
              if (c.fixed) {
                return { row: c.row, col: c.col, letter: c.fixed.letter, isBlank: c.fixed.isBlank, isNew: false };
              }
              const p = placements.find((pp) => pp.row === c.row && pp.col === c.col);
              return { row: c.row, col: c.col, letter: p?.letter ?? '?', isBlank: p?.isBlank ?? false, isNew: true };
            });

            let total = scoreCells(mainCells) + crossScore;
            if (newCount === RACK_SIZE) total += 50;

            candidates.push({ tiles: placements, score: total });
            if (candidates.length >= CANDIDATE_CAP) return candidates;
          }
        }
      }
    }
  }

  return candidates;
}

function rackAfter(rack: string[], tiles: Candidate['tiles']): string[] {
  const copy = [...rack];
  for (const t of tiles) {
    const target = t.isBlank ? BLANK : t.letter;
    const idx = copy.indexOf(target);
    if (idx !== -1) copy.splice(idx, 1);
  }
  return copy;
}

/** Hand-tuned static leave value: reward keeping a blank or an S, keep a
 *  vowel/consonant balance, and penalise a stranded Q with no U to pair it. */
function leaveValue(rack: string[]): number {
  let value = 0;
  let vowels = 0;
  let consonants = 0;
  const vowelSet = new Set(['A', 'E', 'I', 'O', 'U']);
  for (const l of rack) {
    if (l === BLANK) value += 5;
    else if (l === 'S') value += 3;
    else if (l === 'Q' && !rack.includes('U')) value -= 5;
    if (l !== BLANK) {
      if (vowelSet.has(l)) vowels++;
      else consonants++;
    }
  }
  value -= Math.abs(vowels - consonants);
  return value;
}

/** A small set of low-value or awkward tiles worth trading in, when nothing
 *  playable was found. */
function weakTilesFor(rack: string[]): string[] {
  const weak: string[] = [];
  if (rack.includes('Q') && !rack.includes('U')) weak.push('Q');
  const counts = multiset(rack);
  for (const [letter, count] of counts) {
    if (letter === BLANK || letter === 'Q' || letter === 'S') continue;
    if (count > 1 && letterValue(letter, false) <= 2) {
      for (let i = 1; i < count && weak.length < 4; i++) weak.push(letter);
    }
  }
  return weak.slice(0, 4);
}

export const scrabbleBot: BotPolicy<SCRBotView, ScrabbleAction> = {
  chooseAction(v, _selfId, rng: Rng, difficulty: BotDifficulty): ScrabbleAction {
    if (!v.you || v.turnPhase === 'game_over' || v.you.rack.length === 0) {
      return { type: 'pass' };
    }
    const rack = v.you.rack;
    const candidates = generateCandidates(v.board, rack, rng);

    if (candidates.length === 0) {
      if (v.bagCount >= RACK_SIZE) {
        const toExchange = weakTilesFor(rack);
        if (toExchange.length > 0) return { type: 'exchange', letters: toExchange };
      }
      return { type: 'pass' };
    }

    if (difficulty === 'easy') {
      // Occasionally exchange even with a play on the board — an easy bot is
      // meant to be beatable, not merely weaker at the same strategy.
      if (v.bagCount >= RACK_SIZE && rng.next() < 0.15) {
        const toExchange = weakTilesFor(rack);
        if (toExchange.length > 0) return { type: 'exchange', letters: toExchange };
      }
      const best = Math.max(...candidates.map((c) => c.score));
      const pool = candidates.filter((c) => c.score >= best * 0.6);
      const pick = pool[rng.int(pool.length)] as Candidate;
      return { type: 'place', tiles: pick.tiles };
    }

    if (difficulty === 'normal') {
      let best = candidates[0] as Candidate;
      for (const c of candidates) if (c.score > best.score) best = c;
      return { type: 'place', tiles: best.tiles };
    }

    // hard: maximise score plus the value of whatever rack the play leaves behind.
    let best = candidates[0] as Candidate;
    let bestValue = -Infinity;
    for (const c of candidates) {
      const value = c.score + leaveValue(rackAfter(rack, c.tiles));
      if (value > bestValue) {
        bestValue = value;
        best = c;
      }
    }
    return { type: 'place', tiles: best.tiles };
  },
};
