import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty, type ScrabbleAction } from '@puzzle-arena/shared';
import { scrabble as engine } from './index.js';
import { scrabbleBot, type SCRBotView } from './bot.js';
import type { ScrabbleState } from './state.js';
import { BOARD_SIZE, indexOf, premiumAt } from './board.js';
import { BAG_SIZE, RACK_SIZE, freshBag } from './tiles.js';
import { rackValue } from './rules.js';

const PLAYERS = ['p1', 'p2'];

function fresh(seed = 1, playerIds: string[] = PLAYERS): ScrabbleState {
  return engine.setup(playerIds, seed, {});
}

function setRack(s: ScrabbleState, playerId: string, rack: string[]): ScrabbleState {
  const p = s.players.find((pl) => pl.id === playerId);
  if (p) p.rack = [...rack];
  return s;
}

function place(
  s: ScrabbleState,
  playerId: string,
  tiles: { row: number; col: number; letter: string; isBlank?: boolean }[],
): ScrabbleState {
  const r = engine.reduce(s, playerId, { type: 'place', tiles });
  if (!r.ok) throw new Error(`expected place to be accepted: ${r.error}`);
  return r.state;
}

function rejectAction(s: ScrabbleState, playerId: string, action: ScrabbleAction): string {
  const r = engine.reduce(s, playerId, action);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
}

/** Row 7 (0-indexed) runs through the centre star at (7,7). */
const CENTER_ROW = 7;

describe('setup', () => {
  it('deals a 100-tile bag with the standard distribution and 7-tile racks', () => {
    const s = fresh(1, ['p1', 'p2', 'p3']);
    expect(freshBag().length).toBe(BAG_SIZE);
    for (const p of s.players) expect(p.rack.length).toBe(RACK_SIZE);
    expect(s.bag.length).toBe(BAG_SIZE - 3 * RACK_SIZE);
    expect(s.board.length).toBe(BOARD_SIZE * BOARD_SIZE);
    expect(s.board.every((c) => c === null)).toBe(true);
  });
});

describe('placement legality', () => {
  it('rejects a first play that does not cover the centre star', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    const err = rejectAction(s, 'p1', {
      type: 'place',
      tiles: [
        { row: 0, col: 0, letter: 'C' },
        { row: 0, col: 1, letter: 'A' },
        { row: 0, col: 2, letter: 'T' },
      ],
    });
    expect(err).toMatch(/centre star/i);
  });

  it('accepts a first play covering the centre star and forms the word', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C' },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    expect(s.board[indexOf(CENTER_ROW, 7)]?.letter).toBe('A');
    expect(s.lastPlay?.word).toBe('CAT');
  });

  it('rejects tiles that are not in a single line', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    const err = rejectAction(s, 'p1', {
      type: 'place',
      tiles: [
        { row: CENTER_ROW, col: 7, letter: 'C' },
        { row: CENTER_ROW + 1, col: 8, letter: 'A' },
      ],
    });
    expect(err).toMatch(/single line/i);
  });

  it('rejects a gap left in the middle of a placed run', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'T', 'X', 'X', 'X', 'X', 'X']);
    const err = rejectAction(s, 'p1', {
      type: 'place',
      tiles: [
        { row: CENTER_ROW, col: 6, letter: 'C' },
        { row: CENTER_ROW, col: 8, letter: 'T' },
      ],
    });
    expect(err).toMatch(/contiguous/i);
  });

  it('rejects a play that does not connect to any existing tile', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C' },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    s = setRack(s, 'p2', ['D', 'O', 'G', 'X', 'X', 'X', 'X']);
    const err = rejectAction(s, 'p2', {
      type: 'place',
      tiles: [
        { row: 0, col: 0, letter: 'D' },
        { row: 0, col: 1, letter: 'O' },
        { row: 0, col: 2, letter: 'G' },
      ],
    });
    expect(err).toMatch(/connect/i);
  });

  it('rejects placing on an already-occupied square', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C' },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    s = setRack(s, 'p2', ['S', 'X', 'X', 'X', 'X', 'X', 'X']);
    const err = rejectAction(s, 'p2', {
      type: 'place',
      tiles: [{ row: CENTER_ROW, col: 7, letter: 'S' }],
    });
    expect(err).toMatch(/occupied/i);
  });

  it('rejects tiles the player does not hold', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'A', 'X', 'X', 'X', 'X', 'X']);
    const err = rejectAction(s, 'p1', {
      type: 'place',
      tiles: [
        { row: CENTER_ROW, col: 6, letter: 'C' },
        { row: CENTER_ROW, col: 7, letter: 'A' },
        { row: CENTER_ROW, col: 8, letter: 'T' },
      ],
    });
    expect(err).toMatch(/do not have/i);
  });

  it('rejects a word that is not in the dictionary', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['Z', 'Z', 'Z', 'X', 'X', 'X', 'X']);
    const err = rejectAction(s, 'p1', {
      type: 'place',
      tiles: [
        { row: CENTER_ROW, col: 6, letter: 'Z' },
        { row: CENTER_ROW, col: 7, letter: 'Z' },
        { row: CENTER_ROW, col: 8, letter: 'Z' },
      ],
    });
    expect(err).toMatch(/not a valid word/i);
  });

  it('rejects an out-of-turn play', () => {
    let s = fresh();
    s = setRack(s, 'p2', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    const err = rejectAction(s, 'p2', {
      type: 'place',
      tiles: [
        { row: CENTER_ROW, col: 6, letter: 'C' },
        { row: CENTER_ROW, col: 7, letter: 'A' },
        { row: CENTER_ROW, col: 8, letter: 'T' },
      ],
    });
    expect(err).toMatch(/not your turn/i);
  });

  it('scores a blank as 0 points but lets it stand in for its chosen letter', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['_', 'A', 'T', 'X', 'X', 'X', 'X']);
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C', isBlank: true },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    // C(0, blank) + A(1) + T(1) = 2, doubled by the centre DW square = 4.
    expect(s.players[0]?.score).toBe(4);
  });
});

describe('scoring with premium squares', () => {
  it('doubles the whole word across the centre double-word square', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C' },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    // C=3, A=1, T=1 -> 5, doubled by the centre DW = 10.
    expect(premiumAt(CENTER_ROW, 7)).toBe('DW');
    expect(s.players[0]?.score).toBe(10);
  });

  it('reuses an existing tile at face value, never re-applying the square it already scored', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C' },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    // (8,7)-(10,7) carry no premium; (11,7) is a double-letter square four
    // rows below the centre. Extend the existing A at (7,7) down through all
    // of them to spell "AMONG" — four newly placed tiles, M/O/N plain and a
    // doubled G on the double-letter square.
    expect(premiumAt(8, 7)).toBe(null);
    expect(premiumAt(9, 7)).toBe(null);
    expect(premiumAt(10, 7)).toBe(null);
    expect(premiumAt(11, 7)).toBe('DL');
    s = setRack(s, 'p2', ['M', 'O', 'N', 'G', 'X', 'X', 'X']);
    s = place(s, 'p2', [
      { row: 8, col: 7, letter: 'M' },
      { row: 9, col: 7, letter: 'O' },
      { row: 10, col: 7, letter: 'N' },
      { row: 11, col: 7, letter: 'G' },
    ]);
    // A(existing,1, the centre DW does NOT re-trigger) + M(3) + O(1) + N(1) +
    // G(2, doubled by DL = 4) = 10, with no word multiplier from this play.
    expect(s.lastPlay?.word).toBe('AMONG');
    expect(s.players[1]?.score).toBe(10);
  });
});

describe('bingo bonus', () => {
  it('adds 50 points for playing all seven rack tiles in one turn', () => {
    let s = fresh();
    // "CANTORS" — a valid 7-letter word, played horizontally through the centre.
    s = setRack(s, 'p1', ['C', 'A', 'N', 'T', 'O', 'R', 'S']);
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 4, letter: 'C' },
      { row: CENTER_ROW, col: 5, letter: 'A' },
      { row: CENTER_ROW, col: 6, letter: 'N' },
      { row: CENTER_ROW, col: 7, letter: 'T' },
      { row: CENTER_ROW, col: 8, letter: 'O' },
      { row: CENTER_ROW, col: 9, letter: 'R' },
      { row: CENTER_ROW, col: 10, letter: 'S' },
    ]);
    // Letters: C3 A1 N1 T1 O1 R1 S1 = 9, doubled by centre DW = 18, +50 bingo = 68.
    expect(s.players[0]?.score).toBe(68);
    // A full rack refill is drawn immediately after the bingo.
    expect(s.players[0]?.rack.length).toBe(RACK_SIZE);
  });
});

describe('exchange', () => {
  it('rejects exchanging when the bag has fewer than 7 tiles', () => {
    let s = fresh();
    const p1 = s.players[0];
    if (p1) s.bag = s.bag.slice(0, 6);
    const err = rejectAction(s, 'p1', {
      type: 'exchange',
      letters: [p1?.rack[0] as string],
    });
    expect(err).toMatch(/not enough tiles/i);
  });

  it('trades tiles back into the bag and draws the same count, ending the turn', () => {
    let s = fresh();
    s = setRack(s, 'p1', ['Q', 'Q', 'X', 'X', 'X', 'X', 'X']);
    const bagBefore = s.bag.length;
    const r = engine.reduce(s, 'p1', { type: 'exchange', letters: ['Q', 'Q'] });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.players[0]?.rack.length).toBe(RACK_SIZE);
    expect(s.players[0]?.rack.filter((l) => l === 'Q').length).toBe(0);
    expect(s.bag.length).toBe(bagBefore); // 2 returned, 2 drawn
    expect(s.current).toBe(1); // turn passed to p2
    expect(s.passStreak).toBe(1);
  });
});

describe('pass and six-pass forfeiture', () => {
  it('ends the game after six consecutive scoreless turns, deducting each rack like standard Scrabble', () => {
    let s = fresh();
    const scoresBefore = s.players.map((p) => p.score);
    const rackValuesBefore = s.players.map((p) => rackValue(p.rack));
    for (let i = 0; i < 6; i++) {
      const actor = s.players[s.current] as ScrabbleState['players'][number];
      const r = engine.reduce(s, actor.id, { type: 'pass' });
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(s.turnPhase).toBe('game_over');
    expect(s.winReason).toBe('six-passes');
    // Nobody emptied their rack, so — unlike the emptied-rack ending — every
    // player's own unplayed tiles are deducted from their own score, exactly
    // as standard Scrabble scores a game that ends without a rack going out.
    expect(s.players.map((p) => p.score)).toEqual(
      scoresBefore.map((score, i) => score - (rackValuesBefore[i] ?? 0)),
    );
    expect(engine.isOver(s).over).toBe(true);
  });

  it('resets the pass streak when a play is made', () => {
    let s = fresh();
    // Turn order is p1 then p2 — pass with each in turn.
    let r = engine.reduce(s, 'p1', { type: 'pass' });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    r = engine.reduce(s, 'p2', { type: 'pass' });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.passStreak).toBe(2);
    expect(s.current).toBe(0); // back to p1
    s = setRack(s, 'p1', ['C', 'A', 'T', 'X', 'X', 'X', 'X']);
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C' },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    expect(s.passStreak).toBe(0);
  });
});

describe('end-of-game scoring', () => {
  it('credits the emptying player with every opponent rack value and zeroes their own subtraction', () => {
    let s = fresh();
    // Drain the bag so the next completed play, with an empty rack, ends the game.
    s.bag = [];
    s = setRack(s, 'p1', ['C', 'A', 'T', '', '', '', ''].filter(Boolean));
    s = setRack(s, 'p2', ['D', 'O', 'G']);
    s.players[0]!.score = 10;
    s.players[1]!.score = 20;
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C' },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    // p1's rack is now empty and the bag was empty -> game over immediately.
    expect(s.turnPhase).toBe('game_over');
    expect(s.winReason).toBe('emptied-rack');
    expect(s.winner).toBe('p1');
    // p2's unplayed rack D(2)+O(1)+G(2) = 5 is subtracted from p2 and added to p1.
    const p1Score = s.players.find((p) => p.id === 'p1')?.score;
    const p2Score = s.players.find((p) => p.id === 'p2')?.score;
    expect(p2Score).toBe(20 - 5);
    // p1 earned 10 (starting) + 10 (CAT through centre DW) + 5 (bonus) = 25.
    expect(p1Score).toBe(10 + 10 + 5);
  });

  it('awards the win to the higher scorer even when a different player empties their rack', () => {
    let s = fresh();
    // Drain the bag so the next completed play, with an empty rack, ends the game.
    s.bag = [];
    s = setRack(s, 'p1', ['C', 'A', 'T', '', '', '', ''].filter(Boolean));
    s = setRack(s, 'p2', ['D', 'O', 'G']);
    s.players[0]!.score = 10;
    s.players[1]!.score = 100;
    s = place(s, 'p1', [
      { row: CENTER_ROW, col: 6, letter: 'C' },
      { row: CENTER_ROW, col: 7, letter: 'A' },
      { row: CENTER_ROW, col: 8, letter: 'T' },
    ]);
    // p1 emptied their rack and gets the end-of-game bonus, but p2's huge
    // lead survives the small D+O+G deduction, so p2 is the true winner.
    expect(s.turnPhase).toBe('game_over');
    expect(s.winReason).toBe('emptied-rack');
    const p1Score = s.players.find((p) => p.id === 'p1')?.score;
    const p2Score = s.players.find((p) => p.id === 'p2')?.score;
    expect(p1Score).toBe(10 + 10 + 5);
    expect(p2Score).toBe(100 - 5);
    expect(p2Score).toBeGreaterThan(p1Score!);
    expect(s.winner).toBe('p2');
  });
});

describe('bot policy', () => {
  const difficulties: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('never sees the RNG stream or another player\'s rack', () => {
    const s = fresh(42, ['p1', 'p2']);
    const view = engine.view(s, 'p1') as Record<string, unknown>;
    expect(view['rng']).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"rng"');
    const players = view['players'] as Record<string, unknown>[];
    for (const p of players) expect(p['rack']).toBeUndefined();
  });

  it('produces a legal action on an empty board within the view alone', () => {
    for (const difficulty of difficulties) {
      const s = fresh(7, ['p1', 'p2']);
      const view = engine.view(s, 'p1') as SCRBotView;
      const action = scrabbleBot.chooseAction(view, 'p1', mulberry32(3), difficulty);
      const r = engine.reduce(s, 'p1', action);
      expect(r.ok).toBe(true);
    }
  });

  it('plays a bot-only game to completion deterministically', () => {
    const play = (): ScrabbleState => {
      let s = engine.setup(['a', 'b'], 999, {});
      const rng = mulberry32(21);
      for (let i = 0; i < 300 && s.turnPhase !== 'game_over'; i++) {
        const actor = s.players[s.current] as ScrabbleState['players'][number];
        const view = engine.view(s, actor.id) as SCRBotView;
        const difficulty: BotDifficulty = actor.id === 'a' ? 'hard' : 'easy';
        const action = scrabbleBot.chooseAction(view, actor.id, rng, difficulty);
        const r = engine.reduce(s, actor.id, action);
        if (r.ok) {
          s = r.state;
          continue;
        }
        const fallback = engine.reduce(s, actor.id, engine.autoAction(s, actor.id));
        if (!fallback.ok) throw new Error(`stuck: ${fallback.error}`);
        s = fallback.state;
      }
      return s;
    };

    const a = play();
    const b = play();
    expect(a.players).toEqual(b.players);
    expect(a.board).toEqual(b.board);
    expect(a.winner).toBe(b.winner);
  });
});
