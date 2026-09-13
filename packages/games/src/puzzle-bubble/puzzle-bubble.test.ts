import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@puzzle-arena/shared';
import { puzzleBubble } from './index.js';
import {
  dropScore,
  descentIntervalMs,
  findDetached,
  generateWave,
  insertPressureRow,
  matchingCluster,
  pressureLimit,
  resolveLanding,
  scoreShot,
  traceShot,
} from './rules.js';
import { BUBBLE_ROWS, type BubbleCell } from './state.js';

function board(cells: BubbleCell[]) {
  return cells;
}

describe('puzzle bubble rules', () => {
  it('resolves straight and bank shots into valid empty slots', () => {
    const cells = board([{ row: 0, col: 3, color: 'coral' }]);
    const straight = traceShot(cells, 0, 0);
    const bank = traceShot(cells, 0, 65);
    const straightLanding = resolveLanding(cells, 0, straight);
    const bankLanding = resolveLanding(cells, 0, bank);
    expect(straightLanding).not.toBeNull();
    expect(bankLanding).not.toBeNull();
    expect(bank.path.length).toBeGreaterThan(1);
    expect(straightLanding).not.toEqual({ row: 0, col: 3 });
  });

  it('pops a matching triple and drops bubbles no longer anchored to the ceiling', () => {
    const cells = board([
      { row: 0, col: 0, color: 'coral' },
      { row: 1, col: 0, color: 'coral' },
      { row: 1, col: 1, color: 'coral' },
      { row: 2, col: 0, color: 'sky' },
    ]);
    const matching = matchingCluster(cells, { row: 0, col: 0 }, 0);
    expect(matching).toHaveLength(3);
    const detached = findDetached(cells.filter((cell) => cell.color === 'sky'), 0);
    expect(detached).toEqual([{ row: 2, col: 0, color: 'sky' }]);
  });

  it('uses original-style direct and capped detached-bubble scores', () => {
    expect(scoreShot(3, 0)).toBe(30);
    expect(dropScore(1)).toBe(20);
    expect(dropScore(5)).toBe(320);
    expect(dropScore(17)).toBe(1_310_720);
    expect(dropScore(40)).toBe(1_310_720);
  });

  it('maps all speed modes to their visible pressure limits', () => {
    expect(pressureLimit('slow')).toBe(8);
    expect(pressureLimit('normal')).toBe(6);
    expect(pressureLimit('fast')).toBe(4);
  });

  it('shortens the automatic descent timer as speed increases', () => {
    expect(descentIntervalMs('slow')).toBe(30_000);
    expect(descentIntervalMs('normal')).toBe(20_000);
    expect(descentIntervalMs('fast')).toBe(12_000);
  });

  it('inserts a staggered pressure row and retains danger-row bubbles for defeat detection', () => {
    const rng = mulberry32(21);
    const result = insertPressureRow([{ row: BUBBLE_ROWS - 1, col: 0, color: 'coral' }], 0, { colors: 3, speed: 'fast' }, rng);
    expect(result.rowParity).toBe(1);
    expect(result.board.some((cell) => cell.row === BUBBLE_ROWS)).toBe(true);
    expect(result.board.some((cell) => cell.row === 0)).toBe(true);
  });

  it('generates a connected opening without pre-existing triples using only configured colours', () => {
    const generated = generateWave(mulberry32(9), { colors: 3, speed: 'normal' }, 1, 0);
    expect(new Set(generated.map((cell) => cell.color)).size).toBe(3);
    for (const cell of generated) {
      expect(matchingCluster(generated, cell, 0).length).toBeLessThan(3);
    }
  });
});

describe('puzzle bubble engine', () => {
  it('clones the same seeded board and queue for every player', () => {
    const state = puzzleBubble.setup(['p1', 'p2'], 31415, { colors: 5, speed: 'normal' });
    const [one, two] = state.players;
    expect(one?.board).toEqual(two?.board);
    expect(one?.current).toBe(two?.current);
    expect(one?.next).toBe(two?.next);
    expect(one?.rng).toEqual(two?.rng);
  });

  it('keeps each player state independent when their actions are interleaved', () => {
    const first = puzzleBubble.setup(['p1', 'p2'], 99, { colors: 4, speed: 'normal' });
    const firstP1 = puzzleBubble.reduce(first, 'p1', { type: 'shoot', angleDeg: 0 });
    expect(firstP1.ok).toBe(true);
    if (!firstP1.ok) return;
    const interleaved = puzzleBubble.reduce(firstP1.state, 'p2', { type: 'shoot', angleDeg: 28 });
    expect(interleaved.ok).toBe(true);
    if (!interleaved.ok) return;

    const separate = puzzleBubble.reduce(first, 'p1', { type: 'shoot', angleDeg: 0 });
    expect(separate.ok).toBe(true);
    if (!separate.ok) return;
    expect(interleaved.state.players[0]).toEqual(separate.state.players[0]);
  });

  it('applies a deterministic ceiling descent without consuming a shot', () => {
    const state = puzzleBubble.setup(['p1'], 52, { colors: 4, speed: 'normal' });
    const result = puzzleBubble.reduce(state, 'p1', { type: 'descent' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0]?.descents).toBe(1);
    expect(result.state.players[0]?.shots).toBe(0);
    expect(result.state.players[0]?.board.some((cell) => cell.row === 0)).toBe(true);
    expect(result.state.players[0]?.rowParity).toBe(1);
  });

  it('rejects non-integer and out-of-range angles', () => {
    const state = puzzleBubble.setup(['p1'], 1, {});
    expect(puzzleBubble.reduce(state, 'p1', { type: 'shoot', angleDeg: 80.5 }).ok).toBe(false);
    expect(puzzleBubble.reduce(state, 'p1', { type: 'shoot', angleDeg: 81 }).ok).toBe(false);
  });
});
