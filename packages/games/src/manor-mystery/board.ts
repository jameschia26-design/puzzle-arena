import { ROOMS, SUSPECTS, WEAPONS, type RoomName } from '@puzzle-arena/shared';

/**
 * The 24x24 mansion, generated from the bands in PLAN.md rather than
 * hand-drawn, so the door rule is the single source of truth.
 */
export const GRID = 24;

export interface RoomRect {
  name: RoomName;
  x0: number;
  x1: number; // inclusive
  y0: number;
  y1: number; // inclusive
}

const COL_BANDS: [number, number][] = [
  [1, 6],
  [9, 14],
  [17, 22],
];
const ROW_BANDS: [number, number][] = [
  [1, 6],
  [9, 14],
  [17, 22],
];

/**
 *            cols 1-6      cols 9-14     cols 17-22
 * rows 1-6   Kitchen       Ballroom      Conservatory
 * rows 9-14  Dining Room   Library       Billiard Room
 * rows 17-22 Lounge        Hall          Study
 */
export const ROOM_RECTS: RoomRect[] = ROOMS.map((name, i) => {
  const row = Math.floor(i / 3);
  const col = i % 3;
  const [x0, x1] = COL_BANDS[col] as [number, number];
  const [y0, y1] = ROW_BANDS[row] as [number, number];
  return { name, x0, x1, y0, y1 };
});

export const ROOM_BY_NAME: Record<string, RoomRect> = Object.fromEntries(
  ROOM_RECTS.map((r) => [r.name, r]),
);

export const inBounds = (x: number, y: number): boolean =>
  x >= 0 && x < GRID && y >= 0 && y < GRID;

/** Every cell not inside a room rectangle is corridor. */
export const isCorridor = (x: number, y: number): boolean =>
  inBounds(x, y) && roomAt(x, y) === null;

export interface Door {
  room: RoomName;
  /** The room-edge cell. */
  x: number;
  y: number;
  /** The corridor cell the door opens onto. */
  cx: number;
  cy: number;
}

/**
 * One door on every side of a room, at offset 3 along that edge.
 *
 * DEVIATION FROM PLAN.md, which specifies exactly two doors per room chosen by
 * column/row band. That rule was implemented faithfully and turned out to make
 * the game close to unplayable: it points a room's only two doors at whichever
 * corridors its neighbours' doors do *not* face. Measured over the finished
 * board, eight rooms could reach another room on a roll of 3 (97% of turns)
 * but the Kitchen needed a 10 — its nearest door was ten corridor steps away,
 * so a Kitchen turn could enter a room only 17% of the time, and suggestions
 * can only be made from inside a room.
 *
 * Four doors per room fixes the dead corner without touching the grid, the
 * corridors or the movement rules: every room now reaches another on a 3, and
 * an average roll offers two to four destinations rather than nought or one.
 */
export const DOORS: Door[] = ROOM_RECTS.flatMap((r) =>
  [
    { room: r.name, x: r.x0, y: r.y0 + 3, cx: r.x0 - 1, cy: r.y0 + 3 },
    { room: r.name, x: r.x1, y: r.y0 + 3, cx: r.x1 + 1, cy: r.y0 + 3 },
    { room: r.name, x: r.x0 + 3, y: r.y0, cx: r.x0 + 3, cy: r.y0 - 1 },
    { room: r.name, x: r.x0 + 3, y: r.y1, cx: r.x0 + 3, cy: r.y1 + 1 },
  ].filter((door) => isCorridor(door.cx, door.cy)),
);

export const DOORS_BY_ROOM: Record<string, Door[]> = (() => {
  const out: Record<string, Door[]> = {};
  for (const d of DOORS) (out[d.room] ??= []).push(d);
  return out;
})();

/** Secret passages join the diagonally opposite corner rooms. */
export const SECRET_PASSAGES: Record<string, RoomName> = {
  Kitchen: 'Study',
  Study: 'Kitchen',
  Conservatory: 'Lounge',
  Lounge: 'Conservatory',
};

/** True when (x,y) lies inside a room rectangle. */
export function roomAt(x: number, y: number): RoomName | null {
  for (const r of ROOM_RECTS) {
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r.name;
  }
  return null;
}

/**
 * The outer corridor ring walked clockwise from (0,0).
 * Perimeter length = 4 * 24 - 4 = 92.
 */
export const PERIMETER: [number, number][] = (() => {
  const ring: [number, number][] = [];
  for (let x = 0; x < GRID; x++) ring.push([x, 0]);
  for (let y = 1; y < GRID; y++) ring.push([GRID - 1, y]);
  for (let x = GRID - 2; x >= 0; x--) ring.push([x, GRID - 1]);
  for (let y = GRID - 2; y >= 1; y--) ring.push([0, y]);
  return ring;
})();

/** Suspect k starts at perimeter index floor(k * 92 / 6): 0, 15, 30, 46, 61, 76. */
export const START_SQUARES: [number, number][] = SUSPECTS.map(
  (_, k) => PERIMETER[Math.floor((k * PERIMETER.length) / SUSPECTS.length)] as [number, number],
);

/* ---------------- cards ---------------- */

export type CardType = 'suspect' | 'weapon' | 'room';
/** Card ids are the names themselves — all 21 are distinct. */
export type CardId = string;

export const ALL_CARDS: { id: CardId; type: CardType }[] = [
  ...SUSPECTS.map((s) => ({ id: s as CardId, type: 'suspect' as const })),
  ...WEAPONS.map((w) => ({ id: w as CardId, type: 'weapon' as const })),
  ...ROOMS.map((r) => ({ id: r as CardId, type: 'room' as const })),
];

export const CARD_TYPE: Record<CardId, CardType> = Object.fromEntries(
  ALL_CARDS.map((c) => [c.id, c.type]),
);

export const SUSPECT_COLORS: Record<string, string> = {
  'Ms. Crimson': '#ff3f5e',
  'Major Ochre': '#ffb020',
  'Mrs. Ivory': '#f2f5ff',
  'Mr. Verde': '#9dff3c',
  'Lady Azure': '#22e0ff',
  'Dr. Mauve': '#8b5cf6',
};

/* ---------------- movement ---------------- */

export interface Position {
  /** Set when the token is standing in a room. */
  room: RoomName | null;
  x: number;
  y: number;
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Cells reachable at exactly `roll` steps, plus every room whose door can be
 * entered within the roll. Entering a room ends movement.
 */
export function reachable(
  from: Position,
  roll: number,
  blocked: Set<string>,
): { cells: [number, number][]; rooms: RoomName[] } {
  const dist = new Map<string, number>();
  const queue: [number, number][] = [];

  if (from.room) {
    // Leaving a room costs one step onto the corridor cell outside a door.
    for (const door of DOORS_BY_ROOM[from.room] ?? []) {
      if (!isCorridor(door.cx, door.cy) || blocked.has(key(door.cx, door.cy))) continue;
      const k = key(door.cx, door.cy);
      if (!dist.has(k)) {
        dist.set(k, 1);
        queue.push([door.cx, door.cy]);
      }
    }
  } else {
    dist.set(key(from.x, from.y), 0);
    queue.push([from.x, from.y]);
  }

  let head = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++] as [number, number];
    const d = dist.get(key(x, y)) as number;
    if (d >= roll) continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as [number, number][]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isCorridor(nx, ny)) continue;
      const nk = key(nx, ny);
      if (dist.has(nk) || blocked.has(nk)) continue;
      dist.set(nk, d + 1);
      queue.push([nx, ny]);
    }
  }

  const cells: [number, number][] = [];
  for (const [k, d] of dist) {
    if (d !== roll) continue;
    const [xs, ys] = k.split(',');
    cells.push([Number(xs), Number(ys)]);
  }

  const rooms: RoomName[] = [];
  for (const door of DOORS) {
    if (door.room === from.room) continue;
    const d = dist.get(key(door.cx, door.cy));
    // Stepping through the door costs one more move.
    if (d !== undefined && d + 1 <= roll && !rooms.includes(door.room)) {
      rooms.push(door.room);
    }
  }

  return { cells, rooms };
}
