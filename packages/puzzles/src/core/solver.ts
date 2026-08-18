/**
 * Bitmask candidate solver for 9x9 Latin-square-with-boxes problems.
 *
 * This file backs the uniqueness guarantee for Sudoku and Killer Sudoku and
 * supplies the technique tier that becomes the difficulty rating. Constraint
 * propagation runs in tier order; `countSolutions` is the DFS fallback that
 * stops at a cap, which is how we prove "exactly one solution" cheaply.
 */

export const N = 9;
export const CELLS = 81;
export const ALL = 0x1ff; // 9 candidate bits

export type Grid = number[]; // 81 entries, 0 = empty, 1..9 = digit

/* ---------------- bit helpers ---------------- */

const POPCOUNT = new Uint8Array(512);
for (let i = 0; i < 512; i++) POPCOUNT[i] = (i & 1) + (POPCOUNT[i >> 1] as number);

export const bit = (d: number): number => 1 << (d - 1);
export const popcount = (mask: number): number => POPCOUNT[mask] as number;

/** Lowest set digit of a mask (1..9), or 0 for an empty mask. */
export function lowestDigit(mask: number): number {
  if (mask === 0) return 0;
  return 31 - Math.clz32(mask & -mask) + 1;
}

export function maskDigits(mask: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
  return out;
}

/* ---------------- geometry ---------------- */

export const rowOf = (i: number): number => (i / 9) | 0;
export const colOf = (i: number): number => i % 9;
export const boxOf = (i: number): number => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);

/** 27 units (9 rows, 9 cols, 9 boxes), each a list of 9 cell indices. */
export const UNITS: number[][] = (() => {
  const units: number[][] = [];
  for (let r = 0; r < 9; r++) units.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) units.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const br = ((b / 3) | 0) * 3;
    const bc = (b % 3) * 3;
    const cells: number[] = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push((br + dr) * 9 + bc + dc);
    units.push(cells);
  }
  return units;
})();

export const ROW_UNITS = UNITS.slice(0, 9);
export const COL_UNITS = UNITS.slice(9, 18);
export const BOX_UNITS = UNITS.slice(18, 27);

/** The 20 cells that share a row, column or box with cell i. */
export const PEERS: number[][] = (() => {
  const peers: number[][] = [];
  for (let i = 0; i < CELLS; i++) {
    const s = new Set<number>();
    for (const u of UNITS) if (u.includes(i)) for (const j of u) if (j !== i) s.add(j);
    peers.push([...s]);
  }
  return peers;
})();

/* ---------------- extra constraints (Killer cages) ---------------- */

export type PropagateResult = 'changed' | 'none' | 'contradiction';

export interface Constraint {
  /** Tighten `cands` in place. */
  propagate(cands: Int16Array): PropagateResult;
  /** Reject a fully-assigned grid that violates the constraint. */
  validate(grid: Grid): boolean;
}

export interface Cage {
  cells: number[];
  sum: number;
}

/**
 * Cage propagation: enumerate every distinct-digit assignment of the cage that
 * hits the target sum and is compatible with current candidates, then reduce
 * each cell to the union of digits that appear in at least one such assignment.
 * Cages are size 2..5, so the enumeration is tiny.
 */
export function cageConstraint(cages: Cage[]): Constraint {
  // Enumerating a cage is pure in (cell masks, sum), and propagation revisits
  // the same cage states constantly, so memoising it is the single biggest win
  // in Killer generation.
  const memo = new Map<string, Int32Array | null>();

  return {
    propagate(cands: Int16Array): PropagateResult {
      let changed = false;
      for (let cageIdx = 0; cageIdx < cages.length; cageIdx++) {
        const cage = cages[cageIdx] as Cage;
        const k = cage.cells.length;

        let key = `${cageIdx}`;
        for (const c of cage.cells) key += `,${cands[c] as number}`;
        const cached = memo.get(key);
        if (cached !== undefined) {
          if (cached === null) return 'contradiction';
          for (let z = 0; z < k; z++) {
            const cell = cage.cells[z] as number;
            const next = cached[z] as number;
            if (next !== cands[cell]) {
              cands[cell] = next;
              changed = true;
            }
          }
          continue;
        }
        const union = new Array<number>(k).fill(0);
        let any = false;

        const dfs = (idx: number, used: number, sum: number, chosen: number[]): void => {
          if (sum > cage.sum) return;
          const remaining = k - idx;
          if (remaining === 0) {
            if (sum !== cage.sum) return;
            any = true;
            for (let z = 0; z < k; z++) union[z] = (union[z] as number) | bit(chosen[z] as number);
            return;
          }
          // Bound: cheapest and dearest completions with distinct unused digits.
          let minAdd = 0;
          let maxAdd = 0;
          let cnt = 0;
          for (let d = 1; d <= 9 && cnt < remaining; d++) if (!(used & bit(d))) { minAdd += d; cnt++; }
          cnt = 0;
          for (let d = 9; d >= 1 && cnt < remaining; d--) if (!(used & bit(d))) { maxAdd += d; cnt++; }
          if (sum + minAdd > cage.sum || sum + maxAdd < cage.sum) return;

          const mask = cands[cage.cells[idx] as number] as number;
          for (let d = 1; d <= 9; d++) {
            const b = bit(d);
            if (!(mask & b) || used & b) continue;
            chosen[idx] = d;
            dfs(idx + 1, used | b, sum + d, chosen);
          }
        };
        dfs(0, 0, 0, new Array<number>(k).fill(0));

        if (!any) {
          memo.set(key, null);
          return 'contradiction';
        }

        const resolved = new Int32Array(k);
        for (let z = 0; z < k; z++) {
          const cell = cage.cells[z] as number;
          const next = (cands[cell] as number) & (union[z] as number);
          if (next === 0) {
            memo.set(key, null);
            return 'contradiction';
          }
          resolved[z] = next;
        }
        memo.set(key, resolved);

        for (let z = 0; z < k; z++) {
          const cell = cage.cells[z] as number;
          const next = resolved[z] as number;
          if (next !== cands[cell]) {
            cands[cell] = next;
            changed = true;
          }
        }
      }
      return changed ? 'changed' : 'none';
    },

    validate(grid: Grid): boolean {
      for (const cage of cages) {
        let sum = 0;
        const seen = new Set<number>();
        for (const c of cage.cells) {
          const v = grid[c] as number;
          if (v === 0) return false;
          if (seen.has(v)) return false;
          seen.add(v);
          sum += v;
        }
        if (sum !== cage.sum) return false;
      }
      return true;
    },
  };
}

/* ---------------- candidate grid ---------------- */

export function candidatesFrom(grid: Grid): Int16Array | null {
  const cands = new Int16Array(CELLS).fill(ALL);
  for (let i = 0; i < CELLS; i++) {
    const v = grid[i] as number;
    if (v === 0) continue;
    cands[i] = bit(v);
  }
  // Eliminate givens from peers.
  for (let i = 0; i < CELLS; i++) {
    const v = grid[i] as number;
    if (v === 0) continue;
    const b = bit(v);
    for (const p of PEERS[i] as number[]) {
      if (p === i) continue;
      if ((cands[p] as number) & b) {
        cands[p] = (cands[p] as number) & ~b;
        if (cands[p] === 0) return null;
      }
    }
  }
  return cands;
}

export function gridFromCandidates(cands: Int16Array): Grid {
  const g: Grid = new Array<number>(CELLS).fill(0);
  for (let i = 0; i < CELLS; i++) {
    if (popcount(cands[i] as number) === 1) g[i] = lowestDigit(cands[i] as number);
  }
  return g;
}

function isSolved(cands: Int16Array): boolean {
  for (let i = 0; i < CELLS; i++) if (popcount(cands[i] as number) !== 1) return false;
  return true;
}

/* ---------------- techniques, by tier ---------------- */

/** Tier 1: a cell with one candidate eliminates that digit from its peers. */
function nakedSingle(cands: Int16Array): PropagateResult {
  let changed = false;
  for (let i = 0; i < CELLS; i++) {
    const m = cands[i] as number;
    if (popcount(m) !== 1) continue;
    for (const p of PEERS[i] as number[]) {
      if ((cands[p] as number) & m) {
        cands[p] = (cands[p] as number) & ~m;
        if (cands[p] === 0) return 'contradiction';
        changed = true;
      }
    }
  }
  return changed ? 'changed' : 'none';
}

/** Tier 2: a digit with only one home in a unit belongs there. */
function hiddenSingle(cands: Int16Array): PropagateResult {
  let changed = false;
  for (const unit of UNITS) {
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      let where = -1;
      let count = 0;
      for (const c of unit) {
        if ((cands[c] as number) & b) {
          count++;
          where = c;
          if (count > 1) break;
        }
      }
      if (count === 0) return 'contradiction';
      if (count === 1 && popcount(cands[where] as number) > 1) {
        cands[where] = b;
        changed = true;
      }
    }
  }
  return changed ? 'changed' : 'none';
}

/** Tier 3: k cells in a unit sharing exactly k candidates lock them away. */
function nakedSubset(cands: Int16Array, size: number): PropagateResult {
  let changed = false;
  for (const unit of UNITS) {
    const open = unit.filter((c) => popcount(cands[c] as number) > 1);
    if (open.length <= size) continue;
    const combo: number[] = [];
    const walk = (start: number, mask: number): void => {
      if (changed) return;
      if (combo.length === size) {
        if (popcount(mask) !== size) return;
        for (const c of unit) {
          if (combo.includes(c)) continue;
          const next = (cands[c] as number) & ~mask;
          if (next !== cands[c]) {
            cands[c] = next;
            changed = true;
          }
        }
        return;
      }
      for (let idx = start; idx < open.length; idx++) {
        const c = open[idx] as number;
        const nextMask = mask | (cands[c] as number);
        if (popcount(nextMask) > size) continue;
        combo.push(c);
        walk(idx + 1, nextMask);
        combo.pop();
      }
    };
    walk(0, 0);
  }
  for (let i = 0; i < CELLS; i++) if (cands[i] === 0) return 'contradiction';
  return changed ? 'changed' : 'none';
}

/** Tier 4: pointing pair (box -> line) and box-line reduction (line -> box). */
function pointingAndBoxLine(cands: Int16Array): PropagateResult {
  let changed = false;

  // Pointing: within a box, if digit d lives in only one row/col, clear the rest of that line.
  for (const box of BOX_UNITS) {
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      const spots = box.filter((c) => (cands[c] as number) & b);
      if (spots.length < 2) continue;
      const rows = new Set(spots.map(rowOf));
      const cols = new Set(spots.map(colOf));
      if (rows.size === 1) {
        const r = rows.values().next().value as number;
        for (const c of ROW_UNITS[r] as number[]) {
          if (box.includes(c)) continue;
          if ((cands[c] as number) & b) {
            cands[c] = (cands[c] as number) & ~b;
            if (cands[c] === 0) return 'contradiction';
            changed = true;
          }
        }
      }
      if (cols.size === 1) {
        const cc = cols.values().next().value as number;
        for (const c of COL_UNITS[cc] as number[]) {
          if (box.includes(c)) continue;
          if ((cands[c] as number) & b) {
            cands[c] = (cands[c] as number) & ~b;
            if (cands[c] === 0) return 'contradiction';
            changed = true;
          }
        }
      }
    }
  }

  // Box-line: within a row/col, if digit d lives in only one box, clear the rest of that box.
  for (const line of [...ROW_UNITS, ...COL_UNITS]) {
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      const spots = line.filter((c) => (cands[c] as number) & b);
      if (spots.length < 2) continue;
      const boxes = new Set(spots.map(boxOf));
      if (boxes.size !== 1) continue;
      const bx = boxes.values().next().value as number;
      for (const c of BOX_UNITS[bx] as number[]) {
        if (line.includes(c)) continue;
        if ((cands[c] as number) & b) {
          cands[c] = (cands[c] as number) & ~b;
          if (cands[c] === 0) return 'contradiction';
          changed = true;
        }
      }
    }
  }

  return changed ? 'changed' : 'none';
}

/** Tier 5: X-wing on rows and columns. */
function xWing(cands: Int16Array): PropagateResult {
  let changed = false;
  for (const orientation of ['row', 'col'] as const) {
    const lines = orientation === 'row' ? ROW_UNITS : COL_UNITS;
    const cross = orientation === 'row' ? COL_UNITS : ROW_UNITS;
    const idxOf = orientation === 'row' ? colOf : rowOf;

    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      const pairs: { line: number; a: number; z: number }[] = [];
      for (let li = 0; li < 9; li++) {
        const spots = (lines[li] as number[]).filter((c) => (cands[c] as number) & b);
        if (spots.length === 2) {
          pairs.push({ line: li, a: idxOf(spots[0] as number), z: idxOf(spots[1] as number) });
        }
      }
      for (let p = 0; p < pairs.length; p++) {
        for (let q = p + 1; q < pairs.length; q++) {
          const pp = pairs[p] as { line: number; a: number; z: number };
          const qq = pairs[q] as { line: number; a: number; z: number };
          if (pp.a !== qq.a || pp.z !== qq.z) continue;
          for (const ci of [pp.a, pp.z]) {
            for (const c of cross[ci] as number[]) {
              const lineIdx = orientation === 'row' ? rowOf(c) : colOf(c);
              if (lineIdx === pp.line || lineIdx === qq.line) continue;
              if ((cands[c] as number) & b) {
                cands[c] = (cands[c] as number) & ~b;
                if (cands[c] === 0) return 'contradiction';
                changed = true;
              }
            }
          }
        }
      }
    }
  }
  return changed ? 'changed' : 'none';
}

/* ---------------- tiered propagation ---------------- */

export type SolveStatus = 'solved' | 'stuck' | 'contradiction';

export interface SolveReport {
  status: SolveStatus;
  /** Highest technique tier that was needed. 0 if nothing was required. */
  maxTier: number;
  cands: Int16Array;
}

/**
 * Run techniques in ascending tier order, always preferring the cheapest one
 * that makes progress. `maxTier` is what the difficulty rating reads.
 */
export function propagate(
  cands: Int16Array,
  maxAllowedTier = 5,
  constraint?: Constraint,
): SolveReport {
  let maxTier = 0;

  for (;;) {
    if (constraint) {
      const r = constraint.propagate(cands);
      if (r === 'contradiction') return { status: 'contradiction', maxTier, cands };
      if (r === 'changed') continue;
    }

    const steps: { tier: number; run: () => PropagateResult }[] = [
      { tier: 1, run: () => nakedSingle(cands) },
      { tier: 2, run: () => hiddenSingle(cands) },
      { tier: 3, run: () => nakedSubset(cands, 2) },
      { tier: 3, run: () => nakedSubset(cands, 3) },
      { tier: 4, run: () => pointingAndBoxLine(cands) },
      { tier: 5, run: () => xWing(cands) },
    ];

    let progressed = false;
    for (const step of steps) {
      if (step.tier > maxAllowedTier) break;
      const r = step.run();
      if (r === 'contradiction') return { status: 'contradiction', maxTier, cands };
      if (r === 'changed') {
        maxTier = Math.max(maxTier, step.tier);
        progressed = true;
        break;
      }
    }

    if (!progressed) {
      return { status: isSolved(cands) ? 'solved' : 'stuck', maxTier, cands };
    }
    if (isSolved(cands)) return { status: 'solved', maxTier, cands };
  }
}

/* ---------------- solution counting ---------------- */

/**
 * DFS that stops as soon as `cap` solutions have been found. Callers pass
 * cap = 2 and test `=== 1` to prove uniqueness.
 */
export function countSolutions(
  grid: Grid,
  cap = 2,
  constraint?: Constraint,
  /**
   * How deep to propagate at each node. Deeper costs more per node but prunes
   * far more of the tree. Plain Sudoku is fine on singles alone; a given-free
   * Killer board is not — there the deeper tiers pay for themselves many times
   * over, which is why the default rises when a cage constraint is present.
   */
  propagationTier = constraint ? 4 : 2,
  /**
   * Abort after this many search nodes and return UNKNOWN. Every caller treats
   * "not exactly 1" as failure, so aborting is always the conservative answer:
   * a Sudoku dig restores the cell, a Killer layout gets discarded. Without it
   * a single pathological cage layout can burn minutes on its own.
   */
  nodeBudget = Number.POSITIVE_INFINITY,
): number {
  const start = candidatesFrom(grid);
  if (!start) return 0;
  let found = 0;
  let nodes = 0;
  let aborted = false;

  const search = (cands: Int16Array): void => {
    if (found >= cap || aborted) return;
    if (++nodes > nodeBudget) {
      aborted = true;
      return;
    }
    const work = Int16Array.from(cands);
    const rep = propagate(work, propagationTier, constraint);
    if (rep.status === 'contradiction') return;
    if (rep.status === 'solved') {
      if (!constraint || constraint.validate(gridFromCandidates(work))) found++;
      return;
    }

    // Branch on the most constrained open cell.
    let best = -1;
    let bestCount = 10;
    for (let i = 0; i < CELLS; i++) {
      const pc = popcount(work[i] as number);
      if (pc > 1 && pc < bestCount) {
        bestCount = pc;
        best = i;
        if (pc === 2) break;
      }
    }
    if (best === -1) return;

    for (const d of maskDigits(work[best] as number)) {
      if (found >= cap || aborted) return;
      const next = Int16Array.from(work);
      next[best] = bit(d);
      search(next);
    }
  };

  search(start);
  return aborted ? COUNT_UNKNOWN : found;
}

/** Returned by `countSolutions` when its node budget ran out. Never equals 1. */
export const COUNT_UNKNOWN = -1;

/** Solve fully (first solution found), or null. */
export function solve(grid: Grid, constraint?: Constraint): Grid | null {
  const start = candidatesFrom(grid);
  if (!start) return null;
  let result: Grid | null = null;

  const search = (cands: Int16Array): boolean => {
    const work = Int16Array.from(cands);
    const rep = propagate(work, 2, constraint);
    if (rep.status === 'contradiction') return false;
    if (rep.status === 'solved') {
      const g = gridFromCandidates(work);
      if (constraint && !constraint.validate(g)) return false;
      result = g;
      return true;
    }
    let best = -1;
    let bestCount = 10;
    for (let i = 0; i < CELLS; i++) {
      const pc = popcount(work[i] as number);
      if (pc > 1 && pc < bestCount) {
        bestCount = pc;
        best = i;
        if (pc === 2) break;
      }
    }
    if (best === -1) return false;
    for (const d of maskDigits(work[best] as number)) {
      const next = Int16Array.from(work);
      next[best] = bit(d);
      if (search(next)) return true;
    }
    return false;
  };

  search(start);
  return result;
}

/* ---------------- difficulty ---------------- */

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export function tierToDifficulty(tier: number, solvedByLogic: boolean): Difficulty {
  if (!solvedByLogic) return 'expert';
  if (tier <= 2) return 'easy';
  if (tier === 3) return 'medium';
  if (tier === 4) return 'hard';
  return 'expert';
}

export const DIFFICULTY_ORDER: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
  expert: 3,
};

/**
 * The highest technique tier required before any guessing. A puzzle that the
 * technique set cannot finish requires a guess and is therefore `expert`.
 */
export function rateDifficulty(grid: Grid, constraint?: Constraint): Difficulty {
  const cands = candidatesFrom(grid);
  if (!cands) return 'expert';
  const rep = propagate(cands, 5, constraint);
  return tierToDifficulty(rep.maxTier, rep.status === 'solved');
}

/**
 * The order in which cells fall to successively harder techniques — this is the
 * human-plausible solve path that puzzle bots follow (plan step 8).
 */
export function solvePath(grid: Grid, constraint?: Constraint): number[] {
  const cands = candidatesFrom(grid);
  const order: number[] = [];
  if (!cands) return order;
  const known = new Set<number>();
  for (let i = 0; i < CELLS; i++) if ((grid[i] as number) !== 0) known.add(i);

  for (;;) {
    const before = new Set(known);
    const rep = propagate(cands, 5, constraint);
    for (let i = 0; i < CELLS; i++) {
      if (!known.has(i) && popcount(cands[i] as number) === 1) {
        known.add(i);
        order.push(i);
      }
    }
    if (rep.status !== 'stuck' || known.size === before.size) break;
  }

  // Anything the technique set could not reach is appended in index order, so
  // the path always covers every cell.
  for (let i = 0; i < CELLS; i++) if (!known.has(i)) order.push(i);
  return order;
}
