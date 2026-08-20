import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import { reversi } from './index.js';
import { reversiBot, type ReversiBotView } from './bot.js';
import { actorToAct, getLegalMoves } from './rules.js';
import type { ReversiAction, ReversiState } from './state.js';

describe('reversi engine', () => {
  it('initializes with 2 dark and 2 light discs', () => {
    const s = reversi.setup(['p1', 'p2'], 42, {});
    expect(s.board[3 * 8 + 3]).toBe(1);
    expect(s.board[3 * 8 + 4]).toBe(0);
    expect(s.board[4 * 8 + 3]).toBe(0);
    expect(s.board[4 * 8 + 4]).toBe(1);
    expect(s.turn).toBe(0);
    expect(s.players[0].discs).toBe(2);
    expect(s.players[1].discs).toBe(2);
    expect(s.phase).toBe('playing');
  });

  it('calculates 4 initial opening moves for Dark', () => {
    const s = reversi.setup(['p1', 'p2'], 42, {});
    const legal = getLegalMoves(s.board, 0);
    expect(legal.length).toBe(4);
    // (2,3), (3,2), (4,5), (5,4)
    const coords = legal.map((m) => `${m.row},${m.col}`).sort();
    expect(coords).toEqual(['2,3', '3,2', '4,5', '5,4']);
  });

  it('flips discs on legal placement and updates scores', () => {
    const s = reversi.setup(['p1', 'p2'], 42, {});
    const res = reversi.reduce(s, 'p1', { type: 'place', row: 2, col: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const next = res.state;
    expect(next.board[2 * 8 + 3]).toBe(0);
    expect(next.board[3 * 8 + 3]).toBe(0); // Flipped from 1 to 0!
    expect(next.players[0].discs).toBe(4);
    expect(next.players[1].discs).toBe(1);
    expect(next.turn).toBe(1); // Switched to Light (p2)
  });

  it('rejects illegal placements and wrong-turn actions', () => {
    const s = reversi.setup(['p1', 'p2'], 42, {});
    // Wrong player
    const res1 = reversi.reduce(s, 'p2', { type: 'place', row: 2, col: 3 });
    expect(res1.ok).toBe(false);

    // Invalid non-capturing square
    const res2 = reversi.reduce(s, 'p1', { type: 'place', row: 0, col: 0 });
    expect(res2.ok).toBe(false);
  });

  it('plays a complete bot game to termination deterministically', () => {
    const play = (seed: number): ReversiState => {
      let s = reversi.setup(['bot1', 'bot2'], seed, {});
      const rng = mulberry32(seed);
      let turns = 0;

      while (s.phase === 'playing' && turns < 100) {
        turns++;
        const actor = actorToAct(s);
        if (!actor) break;

        const diff: BotDifficulty = actor === 'bot1' ? 'hard' : 'normal';
        const v = reversi.view(s, actor) as ReversiBotView;
        const action: ReversiAction = reversiBot.chooseAction(v, actor, rng, diff);

        const r = reversi.reduce(s, actor, action);
        if (r.ok) {
          s = r.state;
        } else {
          const auto = reversi.autoAction(s, actor);
          const autoRes = reversi.reduce(s, actor, auto);
          if (!autoRes.ok) break;
          s = autoRes.state;
        }
      }

      return s;
    };

    const g1 = play(12345);
    const g2 = play(12345);

    expect(g1.phase).toBe('game_over');
    expect(g1.players[0].discs).toBe(g2.players[0].discs);
    expect(g1.players[1].discs).toBe(g2.players[1].discs);
    expect(g1.winner).toBe(g2.winner);
  });
});
