import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import { connect4 } from './index.js';
import { connect4Bot, type Connect4BotView } from './bot.js';
import { actorToAct, getLegalColumns } from './rules.js';
import type { Connect4Action, Connect4State } from './state.js';

describe('connect 4 engine', () => {
  it('initializes an empty 6x7 board', () => {
    const s = connect4.setup(['p1', 'p2'], 42, {});
    expect(s.board.length).toBe(42);
    expect(s.board.every((c) => c === null)).toBe(true);
    expect(s.turn).toBe(0);
    expect(s.phase).toBe('playing');
    expect(getLegalColumns(s.board).length).toBe(7);
  });

  it('drops disc to the lowest row in chosen column', () => {
    const s = connect4.setup(['p1', 'p2'], 42, {});
    const res = connect4.reduce(s, 'p1', { type: 'drop', col: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Row 5 is the bottom row
    expect(res.state.board[5 * 7 + 3]).toBe(0);
    expect(res.state.turn).toBe(1);

    // Drop second disc in same column -> lands on row 4
    const res2 = connect4.reduce(res.state, 'p2', { type: 'drop', col: 3 });
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;

    expect(res2.state.board[4 * 7 + 3]).toBe(1);
    expect(res2.state.turn).toBe(0);
  });

  it('detects horizontal 4-in-a-row win', () => {
    let s = connect4.setup(['p1', 'p2'], 42, {});
    // p1: col 0, p2: col 0
    // p1: col 1, p2: col 1
    // p1: col 2, p2: col 2
    // p1: col 3 -> p1 wins!
    const moves = [
      { p: 'p1', c: 0 }, { p: 'p2', c: 0 },
      { p: 'p1', c: 1 }, { p: 'p2', c: 1 },
      { p: 'p1', c: 2 }, { p: 'p2', c: 2 },
      { p: 'p1', c: 3 },
    ];

    for (const m of moves) {
      const r = connect4.reduce(s, m.p, { type: 'drop', col: m.c });
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }

    expect(s.phase).toBe('game_over');
    expect(s.winner).toBe('p1');
    expect(s.winReason).toBe('connect4');
    expect(s.winningLine).not.toBeNull();
    expect(s.winningLine?.length).toBe(4);
  });

  it('detects vertical 4-in-a-row win', () => {
    let s = connect4.setup(['p1', 'p2'], 42, {});
    // p1: col 0, p2: col 1
    // p1: col 0, p2: col 1
    // p1: col 0, p2: col 1
    // p1: col 0 -> p1 wins vertically!
    const moves = [
      { p: 'p1', c: 0 }, { p: 'p2', c: 1 },
      { p: 'p1', c: 0 }, { p: 'p2', c: 1 },
      { p: 'p1', c: 0 }, { p: 'p2', c: 1 },
      { p: 'p1', c: 0 },
    ];

    for (const m of moves) {
      const r = connect4.reduce(s, m.p, { type: 'drop', col: m.c });
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }

    expect(s.phase).toBe('game_over');
    expect(s.winner).toBe('p1');
    expect(s.winReason).toBe('connect4');
  });

  it('plays a complete bot game to termination deterministically', () => {
    const play = (seed: number): Connect4State => {
      let s = connect4.setup(['bot1', 'bot2'], seed, {});
      const rng = mulberry32(seed);
      let turns = 0;

      while (s.phase === 'playing' && turns < 60) {
        turns++;
        const actor = actorToAct(s);
        if (!actor) break;

        const diff: BotDifficulty = actor === 'bot1' ? 'hard' : 'normal';
        const v = connect4.view(s, actor) as Connect4BotView;
        const action: Connect4Action = connect4Bot.chooseAction(v, actor, rng, diff);

        const r = connect4.reduce(s, actor, action);
        if (r.ok) {
          s = r.state;
        } else {
          const auto = connect4.autoAction(s, actor);
          const autoRes = connect4.reduce(s, actor, auto);
          if (!autoRes.ok) break;
          s = autoRes.state;
        }
      }

      return s;
    };

    const g1 = play(54321);
    const g2 = play(54321);

    expect(g1.phase).toBe('game_over');
    expect(g1.board).toEqual(g2.board);
    expect(g1.winner).toBe(g2.winner);
  });
});
