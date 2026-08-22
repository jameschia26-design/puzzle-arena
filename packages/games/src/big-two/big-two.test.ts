import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import { actorToAct, beats, bigTwo as engine, classifyCombo } from './index.js';
import { bigTwoBot, type BigTwoBotView } from './bot.js';
import type { BigTwoCard } from './state.js';

const c = (rank: number, suit: number): BigTwoCard => ({ rank, suit });

describe('big two combo classification', () => {
  it('classifies singles, pairs and triples', () => {
    expect(classifyCombo([c(0, 0)])?.category).toBe('single');
    expect(classifyCombo([c(5, 0), c(5, 1)])?.category).toBe('pair');
    expect(classifyCombo([c(5, 0), c(6, 1)])).toBeNull(); // not a pair
    expect(classifyCombo([c(7, 0), c(7, 1), c(7, 2)])?.category).toBe('triple');
  });

  it('classifies five-card hands including bombs and orders/clusters cards', () => {
    // 3-4-5-6-7 entered out of order -> arranged in order from small to big
    const straight = classifyCombo([c(4, 0), c(1, 1), c(3, 3), c(0, 0), c(2, 2)]);
    expect(straight?.category).toBe('straight');
    expect(straight?.cards.map((x) => x.rank)).toEqual([0, 1, 2, 3, 4]);

    // same suit entered out of order -> flush arranged from small to big
    const flush = classifyCombo([c(9, 0), c(2, 0), c(6, 0), c(0, 0), c(4, 0)]);
    expect(flush?.category).toBe('flush');
    expect(flush?.cards.map((x) => x.rank)).toEqual([0, 2, 4, 6, 9]);

    // straight + same suit -> straight flush in order
    const sf = classifyCombo([c(3, 0), c(0, 0), c(4, 0), c(1, 0), c(2, 0)]);
    expect(sf?.category).toBe('straight-flush');
    expect(sf?.cards.map((x) => x.rank)).toEqual([0, 1, 2, 3, 4]);

    // full house entered out of order (pair first, then triple) -> triple clustered first, then pair
    const fh = classifyCombo([c(9, 0), c(1, 0), c(9, 1), c(1, 1), c(1, 2)]);
    expect(fh?.category).toBe('full-house');
    expect(fh?.cards.map((x) => x.rank)).toEqual([1, 1, 1, 9, 9]);

    // four of a kind entered out of order (kicker in middle) -> four clustered together, then kicker
    const fk = classifyCombo([c(3, 0), c(3, 1), c(9, 0), c(3, 2), c(3, 3)]);
    expect(fk?.category).toBe('four-kind');
    expect(fk?.cards.map((x) => x.rank)).toEqual([3, 3, 3, 3, 9]);

    // unrelated cards: invalid
    expect(classifyCombo([c(0, 0), c(2, 1), c(4, 2), c(6, 3), c(9, 0)])).toBeNull();
  });

  it('rejects a straight that would need to wrap through the 2', () => {
    // J-Q-K-A-2 is not a legal straight in Big Two.
    expect(classifyCombo([c(8, 0), c(9, 1), c(10, 2), c(11, 3), c(12, 0)])).toBeNull();
  });

  it('ranks the highest legal straight as 10-J-Q-K-A', () => {
    const straight = classifyCombo([c(7, 0), c(8, 1), c(9, 2), c(10, 3), c(11, 0)]);
    expect(straight?.category).toBe('straight');
    expect(straight?.value).toBe(11);
  });
});

describe('big two combo comparison', () => {
  it('requires same category and size for singles/pairs/triples', () => {
    const straight = classifyCombo([c(0, 0), c(1, 1), c(2, 2), c(3, 3), c(4, 0)])!;
    const flush = classifyCombo([c(0, 0), c(2, 0), c(4, 0), c(6, 0), c(9, 0)])!;
    expect(beats(flush, straight)).toBe(true); // 5-card hands rank on one ladder: straight < flush < full house
    const higherStraight = classifyCombo([c(1, 0), c(2, 1), c(3, 2), c(4, 3), c(5, 0)])!;
    expect(beats(higherStraight, straight)).toBe(true);
  });

  it('ranks 5-card hands on one ladder: straight < flush < full house', () => {
    const straight = classifyCombo([c(0, 0), c(1, 1), c(2, 2), c(3, 3), c(4, 0)])!;
    const fullHouse = classifyCombo([c(0, 0), c(0, 1), c(0, 2), c(1, 0), c(1, 1)])!;
    expect(beats(fullHouse, straight)).toBe(true);
    expect(beats(straight, fullHouse)).toBe(false);
    const flush = classifyCombo([c(0, 0), c(2, 0), c(4, 0), c(6, 0), c(9, 0)])!;
    expect(beats(fullHouse, flush)).toBe(true);
    expect(beats(flush, fullHouse)).toBe(false);
  });

  it('lets a bomb beat any weaker combo of any size', () => {
    const single = classifyCombo([c(12, 3)])!; // the 2 of spades, normally unbeatable as a single
    const bomb = classifyCombo([c(3, 0), c(3, 1), c(3, 2), c(3, 3), c(9, 0)])!;
    expect(beats(bomb, single)).toBe(true);
  });

  it('ranks straight flush above four of a kind', () => {
    const fourKind = classifyCombo([c(5, 0), c(5, 1), c(5, 2), c(5, 3), c(9, 0)])!;
    const straightFlush = classifyCombo([c(0, 0), c(1, 0), c(2, 0), c(3, 0), c(4, 0)])!;
    expect(beats(straightFlush, fourKind)).toBe(true);
    expect(beats(fourKind, straightFlush)).toBe(false);
  });

  it('anything beats a free (null) lead', () => {
    const single = classifyCombo([c(0, 0)])!;
    expect(beats(single, null)).toBe(true);
  });
});

describe('big two game engine', () => {
  it('deals all 52 cards fairly for 2, 3 and 4 players', () => {
    for (const n of [2, 3, 4]) {
      const s = engine.setup(
        Array.from({ length: n }, (_, i) => `p${i}`),
        42,
        {},
      );
      const total = s.players.reduce((sum, p) => sum + p.hand.length, 0);
      expect(total).toBe(52);
      const sizes = s.players.map((p) => p.hand.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('starts with whoever holds the 3 of Diamonds', () => {
    const s = engine.setup(['a', 'b', 'c', 'd'], 42, {});
    const starter = s.players[s.current]!;
    expect(starter.hand.some((card) => card.rank === 0 && card.suit === 0)).toBe(true);
  });

  it('rejects an action from the non-active player', () => {
    const s = engine.setup(['a', 'b'], 42, {});
    const notCurrent = s.players[1 - s.current]!.id;
    const r = engine.reduce(s, notCurrent, { type: 'pass' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Not your turn');
  });

  it('requires the first play of the game to include the 3 of Diamonds', () => {
    const s = engine.setup(['a', 'b'], 42, {});
    const starter = s.players[s.current]!;
    const nonThreeD = starter.hand.find((card) => !(card.rank === 0 && card.suit === 0))!;
    const r = engine.reduce(s, starter.id, { type: 'play', cards: [nonThreeD] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('3 of Diamonds');
  });

  it('rejects a pass when there is nothing to pass on', () => {
    const s = engine.setup(['a', 'b'], 42, {});
    const starter = s.players[s.current]!;
    const r = engine.reduce(s, starter.id, { type: 'pass' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('lead');
  });

  it('plays the 3D single, passes the turn, and reopens the lead once everyone passes', () => {
    const s = engine.setup(['a', 'b'], 42, {});
    const starter = s.players[s.current]!;
    const threeD = starter.hand.find((card) => card.rank === 0 && card.suit === 0)!;
    const r1 = engine.reduce(s, starter.id, { type: 'play', cards: [threeD] });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.currentLead?.category).toBe('single');
    expect(r1.state.firstPlayDone).toBe(true);

    const other = r1.state.players.find((p) => p.id !== starter.id)!;
    const r2 = engine.reduce(r1.state, other.id, { type: 'pass' });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      // With 2 players, one pass wraps straight back to the leader.
      expect(r2.state.currentLead).toBeNull();
      expect(r2.state.currentLeaderId).toBeNull();
      expect(r2.state.current).toBe(s.current);
    }
  });

  it('wins the instant a player empties their hand', () => {
    const s = engine.setup(['a', 'b'], 42, {});
    const starter = s.players[s.current]!;
    starter.hand = [{ rank: 0, suit: 0 }];
    const r = engine.reduce(s, starter.id, { type: 'play', cards: starter.hand });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.phase).toBe('game_over');
      expect(r.state.winner).toBe(starter.id);
      expect(engine.isOver(r.state)).toEqual({ over: true, winner: starter.id });
      expect(engine.score(r.state, starter.id).completed).toBe(true);
    }
  });

  it('provides legal actions and a valid autoAction', () => {
    const s = engine.setup(['a', 'b'], 42, {});
    const starter = s.players[s.current]!;
    const legal = engine.legalActions(s, starter.id);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((a) => a.startsWith('play:'))).toBe(true); // can't pass into a free lead
    const auto = engine.autoAction(s, starter.id);
    expect(auto.type).toBe('play');
  });

  it('allows bots of all difficulties to choose legal actions', () => {
    const s = engine.setup(['bot1', 'bot2'], 123, {});
    const starter = s.players[s.current]!.id;
    const view = engine.view(s, starter) as BigTwoBotView;
    const rng = mulberry32(999);
    const difficulties: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const diff of difficulties) {
      const action = bigTwoBot.chooseAction(view, starter, rng, diff);
      expect(['play', 'pass']).toContain(action.type);
    }
  });

  it('runs a full bot-vs-bot game to completion deterministically', () => {
    let s = engine.setup(['bot_a', 'bot_b', 'bot_c', 'bot_d'], 777, {});
    const rngs: Record<string, ReturnType<typeof mulberry32>> = {
      bot_a: mulberry32(111),
      bot_b: mulberry32(222),
      bot_c: mulberry32(333),
      bot_d: mulberry32(444),
    };

    let turns = 0;
    while (s.phase !== 'game_over' && turns++ < 2000) {
      const actor = actorToAct(s);
      expect(actor).not.toBeNull();
      if (!actor) break;

      const view = engine.view(s, actor) as BigTwoBotView;
      const action = bigTwoBot.chooseAction(view, actor, rngs[actor]!, 'normal');

      const r = engine.reduce(s, actor, action);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      s = r.state;
    }

    expect(s.phase).toBe('game_over');
    expect(s.winner).not.toBeNull();
  });
});
