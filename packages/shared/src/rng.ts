/**
 * The ONLY randomness source in the entire platform (outside tests).
 *
 * Reducers persist `{ seed, calls }` inside game state, so replaying
 * `room_events` through the same reducer reproduces a game bit-for-bit.
 * That is what makes crash recovery work. Never use Math.random.
 */

export interface RngState {
  seed: number;
  calls: number;
}

export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  range(minInclusive: number, maxExclusive: number): number;
  pick<T>(a: readonly T[]): T;
  shuffle<T>(a: T[]): T[];
  readonly calls: number;
  state(): RngState;
}

/**
 * mulberry32. `calls` counts how many raw draws have been taken, so an Rng can
 * be restored mid-stream by replaying that many draws.
 */
export function mulberry32(seed: number, calls = 0): Rng {
  let a = seed >>> 0;
  let n = 0;

  const raw = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    n += 1;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Fast-forward to the recorded call count.
  for (let i = 0; i < calls; i++) raw();
  n = calls;

  const rng: Rng = {
    next: raw,
    int(maxExclusive: number): number {
      if (maxExclusive <= 0) return 0;
      return Math.floor(raw() * maxExclusive);
    },
    range(minInclusive: number, maxExclusive: number): number {
      return minInclusive + rng.int(maxExclusive - minInclusive);
    },
    pick<T>(arr: readonly T[]): T {
      const item = arr[rng.int(arr.length)];
      if (item === undefined) throw new Error('pick() from empty array');
      return item;
    },
    shuffle<T>(arr: T[]): T[] {
      // Fisher-Yates, in place, returns the same array.
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const ai = arr[i] as T;
        const aj = arr[j] as T;
        arr[i] = aj;
        arr[j] = ai;
      }
      return arr;
    },
    get calls() {
      return n;
    },
    state(): RngState {
      return { seed, calls: n };
    },
  };

  return rng;
}

/** Rebuild an Rng from persisted state. */
export function rngFrom(s: RngState): Rng {
  return mulberry32(s.seed, s.calls);
}

/** Deterministic 32-bit seed from a string, for derived streams. */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
