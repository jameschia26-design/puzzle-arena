import type { Rng } from '@puzzle-arena/shared';
import {
  BUBBLE_COLORS,
  BUBBLE_ROWS,
  LONG_ROW_SLOTS,
  SHORT_ROW_SLOTS,
  type BubbleCell,
  type BubbleColor,
  type BubblePoint,
  type BubbleSlot,
  type PuzzleBubbleConfig,
  type PuzzleBubbleSpeed,
} from './state.js';

export const PIXEL_UNIT = 1024;
export const BOARD_WIDTH = 14 * PIXEL_UNIT;
export const ROW_HEIGHT = 1774;
export const BUBBLE_RADIUS = PIXEL_UNIT;
const COLLISION_DISTANCE_SQUARED = (BUBBLE_RADIUS * 2) ** 2;
const NEIGHBOUR_TOLERANCE = PIXEL_UNIT ** 2 / 3;
const SHOT_STEP = 128;
const SHOOTER_X = 7 * PIXEL_UNIT;
const SHOOTER_Y = (BUBBLE_ROWS + 1) * ROW_HEIGHT;
const MAX_SHOT_STEPS = 420;
const MAX_SCORE = 2_147_483_647;

export function pressureLimit(speed: PuzzleBubbleSpeed): number {
  if (speed === 'slow') return 8;
  if (speed === 'fast') return 4;
  return 6;
}

export function shotAnimationMs(speed: PuzzleBubbleSpeed): number {
  if (speed === 'slow') return 520;
  if (speed === 'fast') return 240;
  return 360;
}

/** Real-time ceiling descent cadence; faster modes leave less time between rows. */
export function descentIntervalMs(speed: PuzzleBubbleSpeed): number {
  if (speed === 'slow') return 30_000;
  if (speed === 'fast') return 12_000;
  return 20_000;
}

export function slotCount(row: number, rowParity: 0 | 1): number {
  return (row + rowParity) % 2 === 0 ? LONG_ROW_SLOTS : SHORT_ROW_SLOTS;
}

export function isValidSlot(slot: BubbleSlot, rowParity: 0 | 1): boolean {
  return slot.row >= 0 && slot.row < BUBBLE_ROWS && slot.col >= 0 && slot.col < slotCount(slot.row, rowParity);
}

export function slotKey(slot: BubbleSlot): string {
  return `${slot.row}:${slot.col}`;
}

export function bubblePoint(slot: BubbleSlot, rowParity: 0 | 1): BubblePoint {
  const longRow = slotCount(slot.row, rowParity) === LONG_ROW_SLOTS;
  return {
    x: (longRow ? slot.col * 2 : slot.col * 2 + 1) * PIXEL_UNIT,
    y: slot.row * ROW_HEIGHT,
  };
}

export function allSlots(rowParity: 0 | 1): BubbleSlot[] {
  const slots: BubbleSlot[] = [];
  for (let row = 0; row < BUBBLE_ROWS; row += 1) {
    for (let col = 0; col < slotCount(row, rowParity); col += 1) slots.push({ row, col });
  }
  return slots;
}

export function neighbours(slot: BubbleSlot, rowParity: 0 | 1): BubbleSlot[] {
  const origin = bubblePoint(slot, rowParity);
  return allSlots(rowParity).filter((candidate) => {
    if (candidate.row === slot.row && candidate.col === slot.col) return false;
    const point = bubblePoint(candidate, rowParity);
    const distance = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
    return Math.abs(distance - COLLISION_DISTANCE_SQUARED) <= NEIGHBOUR_TOLERANCE;
  });
}

function bySlot<T extends BubbleSlot>(cells: T[]): Map<string, T> {
  return new Map(cells.map((cell) => [slotKey(cell), cell]));
}

export function matchingCluster(board: BubbleCell[], start: BubbleSlot, rowParity: 0 | 1): BubbleCell[] {
  const occupied = bySlot(board);
  const first = occupied.get(slotKey(start));
  if (!first) return [];
  const seen = new Set<string>();
  const queue: BubbleSlot[] = [start];
  const cluster: BubbleCell[] = [];
  while (queue.length > 0) {
    const slot = queue.pop()!;
    const key = slotKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);
    const cell = occupied.get(key);
    if (!cell || cell.color !== first.color) continue;
    cluster.push(cell);
    for (const next of neighbours(slot, rowParity)) queue.push(next);
  }
  return cluster;
}

export function findDetached(board: BubbleCell[], rowParity: 0 | 1): BubbleCell[] {
  const occupied = bySlot(board);
  const attached = new Set<string>();
  const queue = board.filter((cell) => cell.row === 0).map((cell) => ({ row: cell.row, col: cell.col }));
  while (queue.length > 0) {
    const slot = queue.pop()!;
    const key = slotKey(slot);
    if (attached.has(key) || !occupied.has(key)) continue;
    attached.add(key);
    for (const next of neighbours(slot, rowParity)) queue.push(next);
  }
  return board.filter((cell) => !attached.has(slotKey(cell)));
}

export function dropScore(count: number): number {
  return count === 0 ? 0 : 20 * 2 ** (Math.min(count, 17) - 1);
}

export function scoreShot(popped: number, dropped: number): number {
  return popped * 10 + dropScore(dropped);
}

function distanceSquared(a: BubblePoint, b: BubblePoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function closestSlot(candidates: BubbleSlot[], point: BubblePoint, rowParity: 0 | 1): BubbleSlot | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const delta = distanceSquared(bubblePoint(a, rowParity), point) - distanceSquared(bubblePoint(b, rowParity), point);
    return delta || a.row - b.row || a.col - b.col;
  })[0]!;
}

export interface ShotTrace {
  path: BubblePoint[];
  impact: BubblePoint;
  hit: BubbleSlot | null;
}

/**
 * Integer-coordinate trajectory shared by the reducer and canvas renderer.
 * A single segment is sampled at 1/8th of a logical pixel unit, eliminating
 * browser layout and floating-point collision differences from game state.
 */
export function traceShot(board: BubbleCell[], rowParity: 0 | 1, angleDeg: number): ShotTrace {
  const radians = (angleDeg * Math.PI) / 180;
  let dx = Math.round(Math.sin(radians) * SHOT_STEP);
  let dy = -Math.max(1, Math.round(Math.cos(radians) * SHOT_STEP));
  let x = SHOOTER_X;
  let y = SHOOTER_Y;
  const path: BubblePoint[] = [{ x, y }];

  for (let step = 0; step < MAX_SHOT_STEPS; step += 1) {
    x += dx;
    y += dy;
    if (x < 0 || x > BOARD_WIDTH) {
      x = Math.max(0, Math.min(BOARD_WIDTH, x));
      dx = -dx;
    }
    const impact = { x, y };
    if (y <= 0) return { path: [...path, impact], impact, hit: null };
    const hit = board.find((cell) => distanceSquared(impact, bubblePoint(cell, rowParity)) <= COLLISION_DISTANCE_SQUARED);
    if (hit) return { path: [...path, impact], impact, hit: { row: hit.row, col: hit.col } };
    if (step % 8 === 7) path.push(impact);
  }
  return { path, impact: { x, y }, hit: null };
}

export function resolveLanding(board: BubbleCell[], rowParity: 0 | 1, trace: ShotTrace): BubbleSlot | null {
  const occupied = new Set(board.map(slotKey));
  const candidates = trace.hit
    ? neighbours(trace.hit, rowParity)
    : allSlots(rowParity).filter((slot) => slot.row === 0);
  return closestSlot(candidates.filter((slot) => !occupied.has(slotKey(slot))), trace.impact, rowParity);
}

function enabledColors(config: PuzzleBubbleConfig): BubbleColor[] {
  return BUBBLE_COLORS.slice(0, config.colors);
}

export function drawColor(board: BubbleCell[], config: PuzzleBubbleConfig, rng: Rng): BubbleColor {
  const visible = new Set(board.map((cell) => cell.color));
  const pool = enabledColors(config).filter((color) => visible.has(color));
  const choices = pool.length > 0 ? pool : enabledColors(config);
  return choices[rng.int(choices.length)]!;
}

function canPlaceWithoutMatch(board: BubbleCell[], cell: BubbleCell, rowParity: 0 | 1): boolean {
  return matchingCluster([...board, cell], cell, rowParity).length < 3;
}

export function generateWave(rng: Rng, config: PuzzleBubbleConfig, wave: number, rowParity: 0 | 1): BubbleCell[] {
  const rows = Math.min(8, 5 + Math.floor((wave - 1) / 3));
  const colors = enabledColors(config);
  const board: BubbleCell[] = [];
  let colorCursor = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < slotCount(row, rowParity); col += 1) {
      const ordered = rng.shuffle([...colors]);
      if (colorCursor < colors.length) ordered.unshift(colors[colorCursor++]!);
      const selected = ordered.find((color) => canPlaceWithoutMatch(board, { row, col, color }, rowParity));
      if (selected) board.push({ row, col, color: selected });
    }
  }
  return board;
}

export function insertPressureRow(board: BubbleCell[], rowParity: 0 | 1, config: PuzzleBubbleConfig, rng: Rng): {
  board: BubbleCell[];
  rowParity: 0 | 1;
} {
  const nextParity = rowParity === 0 ? 1 : 0;
  const shifted = board.map((cell) => ({ ...cell, row: cell.row + 1 }));
  const colors = enabledColors(config);
  const withRow = [...shifted];
  for (let col = 0; col < slotCount(0, nextParity); col += 1) {
    const ordered = rng.shuffle([...colors]);
    const selected = ordered.find((color) => canPlaceWithoutMatch(withRow, { row: 0, col, color }, nextParity)) ?? ordered[0]!;
    withRow.push({ row: 0, col, color: selected });
  }
  return { board: withRow, rowParity: nextParity };
}

export function hasReachedDanger(board: BubbleCell[]): boolean {
  return board.some((cell) => cell.row >= BUBBLE_ROWS - 1);
}

export function clampScore(score: number): number {
  return Math.min(MAX_SCORE, score);
}
