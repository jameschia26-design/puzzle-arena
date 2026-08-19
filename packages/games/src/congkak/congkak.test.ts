import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import { actorToAct, congkak as engine } from './index.js';
import { congkakBot, type CongkakBotView } from './bot.js';
import type { CongkakState } from './state.js';

describe('congkak game engine', () => {
  it('sets up a 14-pit board with 7 seeds per pit by default', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    expect(s.pits).toHaveLength(14);
    expect(s.pits.every((seeds) => seeds === 7)).toBe(true);
    expect(s.storehouses).toEqual([0, 0]);
    expect(s.players[0].id).toBe('alice');
    expect(s.players[1].id).toBe('bob');
    expect(s.current).toBe(0);
    expect(s.phase).toBe('pick');
    expect(engine.isOver(s).over).toBe(false);
  });

  it('rejects an action from the non-active player', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    const r = engine.reduce(s, 'bob', { type: 'sow', pitIndex: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Not your turn');
  });

  it('rejects sowing from the opponent side of the board', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    const r = engine.reduce(s, 'alice', { type: 'sow', pitIndex: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('own houses');
  });

  it('grants an extra turn when the last seed drops into own storehouse', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    // In standard 7-pit setup, pit 0 has 7 seeds.
    // Sowing from pit 0 drops into pits 1, 2, 3, 4, 5, 6, and Storehouse 0.
    // Last seed lands in Storehouse 0 -> extra turn!
    const r = engine.reduce(s, 'alice', { type: 'sow', pitIndex: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.pits[0]).toBe(0);
      expect(r.state.storehouses[0]).toBe(1);
      expect(r.state.storehouses[1]).toBe(0);
      expect(r.state.current).toBe(0); // Alice still to play!
      expect(r.state.lastMove?.landedInStorehouse).toBe(true);
    }
  });

  it('executes relay sowing when landing in a non-empty pit', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    // From pit 0 -> lands in Storehouse 0 (extra turn)
    const r1 = engine.reduce(s, 'alice', { type: 'sow', pitIndex: 0 });
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      // Alice now sows from pit 1 (which now has 8 seeds).
      // Pit 1 seeds drop into 2, 3, 4, 5, 6, Storehouse 0 (now 2), 7, 8.
      // Last seed lands in pit 8 (which had 7 seeds, now 8) -> non-empty -> relay!
      const r2 = engine.reduce(r1.state, 'alice', { type: 'sow', pitIndex: 1 });
      expect(r2.ok).toBe(true);
      if (r2.ok) {
        expect(r2.state.lastMove?.relayHops).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('performs Tembak capture when landing in an empty pit on own side with seeds opposite', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    // Custom setup: Alice pit 0 has 2 seeds, pit 2 is empty, opposite pit 11 (13 - 2) has 10 seeds.
    s.pits = [2, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 10, 5, 5];
    s.storehouses = [0, 0];

    // Alice sows pit 0 (2 seeds):
    // 1st seed -> pit 1 (becomes 1)
    // 2nd seed -> pit 2 (was 0, now 1). Pit 2 is on Alice's side, opposite pit 11 has 10 seeds!
    // -> Tembak! Alice captures 1 + 10 = 11 seeds into Storehouse 0.
    const r = engine.reduce(s, 'alice', { type: 'sow', pitIndex: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.pits[0]).toBe(0);
      expect(r.state.pits[1]).toBe(1);
      expect(r.state.pits[2]).toBe(0); // captured
      expect(r.state.pits[11]).toBe(0); // captured
      expect(r.state.storehouses[0]).toBe(11);
      expect(r.state.lastMove?.tembakPit).toBe(2);
      expect(r.state.lastMove?.capturedSeeds).toBe(11);
      expect(r.state.current).toBe(1); // Turn passed to Bob
    }
  });

  it('skips the opponent storehouse during sowing circulation', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    // Alice sows pit 6 with 15 seeds (full loop passing Storehouse 0, pits 7..13, skipping Storehouse 1, and back into pit 0)
    s.pits[6] = 15;
    const r = engine.reduce(s, 'alice', { type: 'sow', pitIndex: 6 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Bob's storehouse should NEVER receive seeds from Alice
      expect(r.state.storehouses[1]).toBe(0);
    }
  });

  it('provides legal actions for the active player and produces autoAction', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    const legalAlice = engine.legalActions(s, 'alice');
    expect(legalAlice).toEqual(['sow:0', 'sow:1', 'sow:2', 'sow:3', 'sow:4', 'sow:5', 'sow:6']);

    const legalBob = engine.legalActions(s, 'bob');
    expect(legalBob).toEqual([]);

    const auto = engine.autoAction(s, 'alice');
    expect(auto).toEqual({ type: 'sow', pitIndex: 0 });
  });

  it('calculates score and identifies game over accurately', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    s.pits = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    s.storehouses = [56, 42];
    s.phase = 'game_over';
    s.winner = 'alice';

    const over = engine.isOver(s);
    expect(over.over).toBe(true);
    expect(over.winner).toBe('alice');

    const scoreAlice = engine.score(s, 'alice');
    expect(scoreAlice.assetValue).toBe(56);
    expect(scoreAlice.completed).toBe(true);

    const scoreBob = engine.score(s, 'bob');
    expect(scoreBob.assetValue).toBe(42);
    expect(scoreBob.completed).toBe(false);
  });

  it('allows bots of all difficulties to choose legal moves', () => {
    const s = engine.setup(['bot1', 'bot2'], 123, {});
    const view = engine.view(s, 'bot1') as CongkakBotView;
    const rng = mulberry32(999);

    const difficulties: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const diff of difficulties) {
      const action = congkakBot.chooseAction(view, 'bot1', rng, diff);
      expect(action.type).toBe('sow');
      expect(action.pitIndex).toBeGreaterThanOrEqual(0);
      expect(action.pitIndex).toBeLessThanOrEqual(6);
    }
  });

  it('runs a full bot-vs-bot game to completion deterministically', () => {
    let s = engine.setup(['bot_a', 'bot_b'], 777, {});
    const rngA = mulberry32(111);
    const rngB = mulberry32(222);

    let turns = 0;
    while (s.phase !== 'game_over' && turns++ < 500) {
      const actor = actorToAct(s);
      expect(actor).not.toBeNull();
      if (!actor) break;

      const view = engine.view(s, actor) as CongkakBotView;
      const rng = actor === 'bot_a' ? rngA : rngB;
      const action = congkakBot.chooseAction(view, actor, rng, 'normal');

      const r = engine.reduce(s, actor, action);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      s = r.state;
    }

    expect(s.phase).toBe('game_over');
    expect(s.storehouses[0] + s.storehouses[1]).toBe(98);
  });
});
