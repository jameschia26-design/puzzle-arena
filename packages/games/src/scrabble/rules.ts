import type { ScrabblePlacedTile, ScrabblePlayer, ScrabbleState } from './state.js';
import { BOARD_SIZE, CENTER_COL, CENTER_ROW, inBounds, indexOf, premiumAt } from './board.js';
import { isValidWord } from './dictionary.js';
import { BLANK, letterValue } from './tiles.js';

export const playerById = (s: ScrabbleState, id: string): ScrabblePlayer | undefined =>
  s.players.find((p) => p.id === id);

export const boardIsEmpty = (s: ScrabbleState): boolean => s.board.every((c) => c === null);

/** A tile the player wants to place, as validated input (mirrors the wire shape). */
export interface PlacementTile {
  row: number;
  col: number;
  letter: string;
  isBlank: boolean;
}

interface ResolvedCell {
  row: number;
  col: number;
  letter: string;
  isBlank: boolean;
  /** Placed as part of THIS turn, vs. already on the board. */
  isNew: boolean;
}

interface FormedWord {
  word: string;
  cells: ResolvedCell[];
  score: number;
}

export interface PlacementResult {
  words: FormedWord[];
  totalScore: number;
  bingo: boolean;
}

export type ValidatePlacementResult =
  | { ok: true; result: PlacementResult }
  | { ok: false; error: string };

/** Remove one occurrence of a rack tile (a blank consumes `'_'` regardless of the
 *  letter it will represent). Returns false if the rack does not have it. */
function consumeFromRack(rack: string[], letter: string, isBlank: boolean): boolean {
  const target = isBlank ? BLANK : letter;
  const idx = rack.indexOf(target);
  if (idx === -1) return false;
  rack.splice(idx, 1);
  return true;
}

/** Everything a rack could legally place THIS turn, without mutating it. */
export function canAffordFromRack(rack: string[], tiles: PlacementTile[]): boolean {
  const copy = [...rack];
  for (const t of tiles) {
    if (!consumeFromRack(copy, t.letter, t.isBlank)) return false;
  }
  return true;
}

function cellAt(
  board: (ScrabblePlacedTile | null)[],
  placed: Map<string, PlacementTile>,
  row: number,
  col: number,
): ResolvedCell | null {
  if (!inBounds(row, col)) return null;
  const key = `${row},${col}`;
  const fresh = placed.get(key);
  if (fresh) return { row, col, letter: fresh.letter, isBlank: fresh.isBlank, isNew: true };
  const existing = board[indexOf(row, col)];
  if (existing) {
    return { row, col, letter: existing.letter, isBlank: existing.isBlank, isNew: false };
  }
  return null;
}

/** Walk outward from (row,col) along (dr,dc)/-(dr,dc) and collect the contiguous run. */
function extendWord(
  board: (ScrabblePlacedTile | null)[],
  placed: Map<string, PlacementTile>,
  row: number,
  col: number,
  dr: number,
  dc: number,
): FormedWord | null {
  let sr = row;
  let sc = col;
  while (cellAt(board, placed, sr - dr, sc - dc)) {
    sr -= dr;
    sc -= dc;
  }
  const cells: ResolvedCell[] = [];
  let cr = sr;
  let cc = sc;
  for (;;) {
    const cell = cellAt(board, placed, cr, cc);
    if (!cell) break;
    cells.push(cell);
    cr += dr;
    cc += dc;
  }
  if (cells.length < 2) return null;
  return { word: cells.map((c) => c.letter).join(''), cells, score: 0 };
}

function scoreWord(word: FormedWord): number {
  let sum = 0;
  let wordMultiplier = 1;
  for (const cell of word.cells) {
    const base = letterValue(cell.letter, cell.isBlank);
    if (!cell.isNew) {
      sum += base;
      continue;
    }
    const premium = premiumAt(cell.row, cell.col);
    let letterMultiplier = 1;
    if (premium === 'DL') letterMultiplier = 2;
    else if (premium === 'TL') letterMultiplier = 3;
    else if (premium === 'DW') wordMultiplier *= 2;
    else if (premium === 'TW') wordMultiplier *= 3;
    sum += base * letterMultiplier;
  }
  return sum * wordMultiplier;
}

/**
 * Validate and score a placement against the CURRENT board (before applying
 * it). Pure — never mutates `s`. The caller (`reduce`) applies the returned
 * cells and rack consumption only after this succeeds.
 */
export function validatePlacement(
  s: ScrabbleState,
  playerId: string,
  tiles: PlacementTile[],
): ValidatePlacementResult {
  const player = playerById(s, playerId);
  if (!player) return { ok: false, error: 'Not in this game' };

  const seen = new Set<string>();
  for (const t of tiles) {
    const key = `${t.row},${t.col}`;
    if (seen.has(key)) return { ok: false, error: 'The same square was used twice' };
    seen.add(key);
    if (!inBounds(t.row, t.col)) return { ok: false, error: 'Off the board' };
    if (s.board[indexOf(t.row, t.col)] !== null) {
      return { ok: false, error: 'That square is already occupied' };
    }
  }

  if (!canAffordFromRack(player.rack, tiles)) {
    return { ok: false, error: 'You do not have those tiles' };
  }

  const placed = new Map<string, PlacementTile>();
  for (const t of tiles) placed.set(`${t.row},${t.col}`, t);

  const allSameRow = tiles.every((t) => t.row === tiles[0]?.row);
  const allSameCol = tiles.every((t) => t.col === tiles[0]?.col);

  const words: FormedWord[] = [];
  const first = tiles[0];
  if (!first) return { ok: false, error: 'No tiles placed' };

  if (tiles.length === 1) {
    const horiz = extendWord(s.board, placed, first.row, first.col, 0, 1);
    const vert = extendWord(s.board, placed, first.row, first.col, 1, 0);
    if (horiz) words.push(horiz);
    if (vert) words.push(vert);
    if (words.length === 0) {
      return { ok: false, error: 'A word must be at least two letters' };
    }
  } else {
    if (!allSameRow && !allSameCol) {
      return { ok: false, error: 'Tiles must form a single line' };
    }
    const [dr, dc] = allSameRow ? [0, 1] : [1, 0];
    const main = extendWord(s.board, placed, first.row, first.col, dr, dc);
    if (!main) {
      return { ok: false, error: 'Tiles must be contiguous' };
    }
    // Contiguity: every placed tile must actually appear in the extended run —
    // otherwise there is a gap the run skipped over (extendWord stops at the
    // first empty square it meets, so a gap simply truncates the run short of
    // some placed tile).
    for (const t of tiles) {
      if (!main.cells.some((c) => c.row === t.row && c.col === t.col)) {
        return { ok: false, error: 'Tiles must be contiguous, with no gaps' };
      }
    }
    words.push(main);
    const [pdr, pdc] = [dc, dr];
    for (const t of tiles) {
      const cross = extendWord(s.board, placed, t.row, t.col, pdr, pdc);
      if (cross) words.push(cross);
    }
  }

  const empty = boardIsEmpty(s);
  if (empty) {
    if (!tiles.some((t) => t.row === CENTER_ROW && t.col === CENTER_COL)) {
      return { ok: false, error: 'The first play must cover the centre star' };
    }
  } else {
    const touchesExisting = words.some((w) => w.cells.some((c) => !c.isNew));
    if (!touchesExisting) {
      return { ok: false, error: 'Your play must connect to an existing word' };
    }
  }

  const invalid = words
    .map((w) => w.word)
    .filter((w) => !isValidWord(w));
  if (invalid.length > 0) {
    const unique = [...new Set(invalid)];
    return {
      ok: false,
      error: `${unique.join(', ')} ${unique.length > 1 ? 'are not valid words' : 'is not a valid word'}`,
    };
  }

  const scored = words.map((w) => ({ ...w, score: scoreWord(w) }));
  const totalScore =
    scored.reduce((sum, w) => sum + w.score, 0) + (tiles.length === 7 ? 50 : 0);

  return {
    ok: true,
    result: { words: scored, totalScore, bingo: tiles.length === 7 },
  };
}

/** Face value of everything left in a rack — used for the end-of-game adjustment. */
export function rackValue(rack: string[]): number {
  return rack.reduce((sum, letter) => sum + letterValue(letter, letter === BLANK), 0);
}

/** Empty squares reachable this turn: adjacent to an occupied square, or the
 *  centre star when the board is still empty. Used by both legality checks
 *  that want a cheap anchor set and by the bot's move generator. */
export function anchorSquares(s: ScrabbleState): [number, number][] {
  if (boardIsEmpty(s)) return [[CENTER_ROW, CENTER_COL]];
  const anchors: [number, number][] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (s.board[indexOf(row, col)] !== null) continue;
      const neighbours: [number, number][] = [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ];
      if (neighbours.some(([r, c]) => inBounds(r, c) && s.board[indexOf(r, c)] !== null)) {
        anchors.push([row, col]);
      }
    }
  }
  return anchors;
}

export { consumeFromRack };
