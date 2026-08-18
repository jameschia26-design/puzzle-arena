import { describe, expect, it } from 'vitest';
import { computeScore, rankResults, type ScoreInput } from './scoring.js';
import { mulberry32, rngFrom, seedFromString } from './rng.js';

const base: ScoreInput = {
  progress: 0,
  accuracy: 0,
  completed: false,
  completedAtMs: null,
  penalties: 0,
};

describe('computeScore — the exact values named in the plan', () => {
  const LIMIT = 300_000; // 5 minutes

  it('perfect grid finished at half the time limit scores 875', () => {
    const score = computeScore(
      { ...base, progress: 1, accuracy: 1, completed: true, completedAtMs: LIMIT / 2 },
      LIMIT,
    );
    // 1000 * (0.55 + 0.20 + 0.25*0.5)
    expect(score).toBe(875);
  });

  it('60% progress, 60 correct of 66 filled, unfinished scores 512', () => {
    const score = computeScore(
      { ...base, progress: 0.6, accuracy: 60 / 66, completed: false },
      LIMIT,
    );
    // round(1000 * (0.55*0.6 + 0.20*0.909...))
    expect(score).toBe(512);
  });

  it('two hints drop that score to 482', () => {
    const score = computeScore(
      { ...base, progress: 0.6, accuracy: 60 / 66, completed: false, penalties: 2 },
      LIMIT,
    );
    expect(score).toBe(482);
  });

  it('clamps to [0, 1000]', () => {
    expect(
      computeScore({ ...base, progress: 0.1, accuracy: 0, penalties: 100 }, LIMIT),
    ).toBe(0);
    expect(
      computeScore(
        { ...base, progress: 1, accuracy: 1, completed: true, completedAtMs: 0 },
        LIMIT,
      ),
    ).toBe(1000);
  });

  it('an unfinished player still scores on partial progress', () => {
    const score = computeScore({ ...base, progress: 0.4, accuracy: 1 }, LIMIT);
    expect(score).toBeGreaterThan(0);
  });

  it('speed contributes nothing when the player did not complete', () => {
    const a = computeScore({ ...base, progress: 1, accuracy: 1, completed: false }, LIMIT);
    expect(a).toBe(750);
  });
});

describe('rankResults', () => {
  it('orders by score desc, then finish time asc with nulls last, then penalties, then seat', () => {
    const ranked = rankResults([
      { playerId: 'd', score: 500, completedAtMs: null, penalties: 0, seat: 3 },
      { playerId: 'a', score: 900, completedAtMs: 5000, penalties: 0, seat: 0 },
      { playerId: 'b', score: 900, completedAtMs: 4000, penalties: 0, seat: 1 },
      { playerId: 'c', score: 500, completedAtMs: 9000, penalties: 0, seat: 2 },
    ]);
    expect(ranked.map((r) => r.playerId)).toEqual(['b', 'a', 'c', 'd']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('breaks a full tie by penalties then seat', () => {
    const ranked = rankResults([
      { playerId: 'x', score: 100, completedAtMs: null, penalties: 2, seat: 0 },
      { playerId: 'y', score: 100, completedAtMs: null, penalties: 0, seat: 5 },
      { playerId: 'z', score: 100, completedAtMs: null, penalties: 0, seat: 1 },
    ]);
    expect(ranked.map((r) => r.playerId)).toEqual(['z', 'y', 'x']);
  });
});

describe('mulberry32 — determinism is what makes event replay work', () => {
  it('produces the same stream for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  it('counts calls and can be restored mid-stream from {seed, calls}', () => {
    const a = mulberry32(999);
    for (let i = 0; i < 37; i++) a.next();
    expect(a.calls).toBe(37);

    const restored = rngFrom(a.state());
    const tail = [a.next(), a.next(), a.next()];
    const restoredTail = [restored.next(), restored.next(), restored.next()];
    expect(restoredTail).toEqual(tail);
  });

  it('int() stays in range and shuffle() is a permutation', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = r.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    const arr = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = mulberry32(42).shuffle([...arr]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(arr);
    expect(shuffled).not.toEqual(arr);
  });

  it('shuffle is reproducible for a seed', () => {
    const one = mulberry32(4321).shuffle(Array.from({ length: 20 }, (_, i) => i));
    const two = mulberry32(4321).shuffle(Array.from({ length: 20 }, (_, i) => i));
    expect(one).toEqual(two);
  });

  it('seedFromString is stable', () => {
    expect(seedFromString('room-abc')).toBe(seedFromString('room-abc'));
    expect(seedFromString('room-abc')).not.toBe(seedFromString('room-abd'));
  });
});
