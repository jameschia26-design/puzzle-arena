// Maze, movement, ghost AI, scoring, level tables — authentic approximation.
import { MAZE_W, MAZE_H, MAZE_SIZE, type Dir, opposite, DIR_VEC, DIRS } from './state.js';

export const TUNNEL_Y = 14;

// Tile kinds for template parsing
// 0 = empty (no pellet), 1 = dot, 2 = power pellet, 9 = wall (impassable)
export const TILE_WALL = 9;
export const TILE_EMPTY = 0;
export const TILE_DOT = 1;
export const TILE_PELLET = 2;
export const TILE_DOOR = 3; // ghost house door (Pac-Man blocked, ghosts pass when eaten/exiting)

// Fruit table per level (1-indexed)
export const FRUIT_TABLE: { kind: string; points: number }[] = [
  { kind: 'cherry', points: 100 },      // 1
  { kind: 'strawberry', points: 300 },  // 2
  { kind: 'orange', points: 500 },      // 3
  { kind: 'orange', points: 500 },      // 4
  { kind: 'apple', points: 700 },       // 5
  { kind: 'apple', points: 700 },       // 6
  { kind: 'melon', points: 1000 },      // 7
  { kind: 'melon', points: 1000 },      // 8
  { kind: 'galaxian', points: 2000 },   // 9
  { kind: 'galaxian', points: 2000 },   // 10
  { kind: 'bell', points: 3000 },       // 11
  { kind: 'bell', points: 3000 },       // 12
  { kind: 'key', points: 5000 },        // 13+
];
export function fruitForLevel(level: number): { kind: string; points: number } {
  if (level <= 13) return FRUIT_TABLE[level - 1]!;
  return FRUIT_TABLE[12]!;
}

// Fright duration in ticks (approx 7 ticks/sec => tick 130ms). Real Pac-Man: 6s L1 decreasing.
// We map: L1 6s=42 ticks, L2 5s=35, L3 4s=28, L4 3s=21, L5 2s=14, L6 5s=35 (blinky speed-up), etc.
// Simplified decreasing: L1 42, L2 35, L3 28, L4 21, L5 14, L6 14, L7 14, L8 14, L9 7, L10 35, L11+ 7 or 0
export function frightTicksForLevel(level: number): number {
  const table: Record<number, number> = {
    1: 42, 2: 35, 3: 28, 4: 21, 5: 14, 6: 35, 7: 14, 8: 14, 9: 7, 10: 35, 11: 14, 12: 14, 13: 7, 14: 7, 15: 7, 16: 0, 17: 0, 18: 0, 19: 0, 20: 0, 21: 0,
  };
  if (level >= 21) return 0;
  return table[level] ?? 0;
}

/**
 * Ghost revival wait inside the ghost house (in simulation ticks).
 *
 * In arcade Pac-Man, eaten ghost eyes return to the ghost house, restore their
 * body, and wait inside before being released. Arcade release timing is governed
 * by per-ghost dot counters (Pinky: 0 dots, Inky: 0-30, Clyde: 0-60, dropping
 * to 0 at level 5+) or an inactivity timeout (~4s). In this tick-based engine
 * (4 ticks/sec at TICK_MS = 250ms), we approximate this authentic behavior with
 * a short level-scaled pause: ~3s (12 ticks) at level 1, decreasing by 2 ticks per
 * level down to a floor of ~1s (4 ticks) at level 5+.
 */
export function ghostReviveTicks(level: number): number {
  return Math.max(4, 12 - (Math.max(1, level) - 1) * 2);
}

// Speed tables: ticks per move. Higher level = smaller divisor = faster.
// Pac-Man normal: L1 1.0, L5 1.1x etc. We'll return moveEvery = 1 for most, with occasional extra move.
// Simplified: pacmanMoveEvery(level) = 1 always, ghostMoveEvery: frightened 2, tunnel 2, normal 1
// But to honor table, we provide pacman speed factor for level 21.
export function pacmanMoveEvery(level: number): number { return 1; }
export function ghostMoveEvery(mode: string, inTunnel: boolean, level: number): number {
  if (mode === 'eaten') return 1; // fast eyes
  if (mode === 'frightened') return 2;
  if (inTunnel) return 2;
  // level 1 ghosts slightly slower, but keep 1 for simplicity and note in docs
  void level;
  return 1;
}

// Scatter/Chase cycle durations (ticks). 7s scatter ~49 ticks, 20s chase ~140 ticks
export const MODE_CYCLE: { mode: 'scatter' | 'chase'; ticks: number }[] = [
  { mode: 'scatter', ticks: 49 },
  { mode: 'chase', ticks: 140 },
  { mode: 'scatter', ticks: 49 },
  { mode: 'chase', ticks: 140 },
  { mode: 'scatter', ticks: 35 },
  { mode: 'chase', ticks: 140 },
  { mode: 'scatter', ticks: 35 },
  { mode: 'chase', ticks: -1 }, // indefinite
];

// Ghost scatter corners
export const SCATTER_TARGETS: { x: number; y: number }[] = [
  { x: 25, y: 0 }, // Blinky top-right
  { x: 2, y: 0 },  // Pinky top-left
  { x: 27, y: 30 },// Inky bottom-right
  { x: 0, y: 30 }, // Clyde bottom-left
];

export const GHOST_HOUSE = { x: 14, y: 14 }; // center
export const GHOST_HOUSE_DOOR = { x: 13, y: 12 }; // doorway (2 wide: 13,12 and 14,12)
export const PAC_SPAWN = { x: 14, y: 23 };
export const FRUIT_POS = { x: 14, y: 17 };

// --------------- Maze template ----------------
// 28 cols x 31 rows. chars: # wall, . dot, o power pellet, space empty, - door, H house interior empty
// This template is handcrafted to match the authentic maze and yields exactly 240 dots + 4 pellets.
const TEMPLATE: string[] = [
  '############################', // 0
  '#............##............#', // 1
  '#.####.#####.##.#####.####.#', // 2
  '#o####.#####.##.#####.####o#', // 3 pellets
  '#.####.#####.##.#####.####.#', // 4
  '#..........................#', // 5
  '#.####.##.########.##.####.#', // 6
  '#.####.##.########.##.####.#', // 7
  '#......##....##....##......#', // 8
  '######.##### ## #####.######', // 9 (space = empty/tunnel wall gap handling)
  '######.##### ## #####.######', //10
  '######.##          ##.######', //11 ghost house top empty
  '######.## ###--### ##.######', //12 door row
  '######.## #      # ##.######', //13 house interior
  '      .   #      #   .      ', //14 tunnel row (dots at col 6 and 21)
  '######.## #      # ##.######', //15
  '######.## ###--### ##.######', //16
  '######.##          ##.######', //17 fruit row empty area
  '######.## ######## ##.######', //18
  '######.## ######## ##.######', //19
  '#............##............#', //20
  '#.####.#####.##.#####.####.#', //21
  '#.####.#####.##.#####.####.#', //22
  '#o..##.......  .......##..o#', //23 pellets bottom (cols 3 and 24) + special spacing
  '###.##.##.########.##.##.###', //24
  '###.##.##.########.##.##.###', //25
  '#......##....##....##......#', //26
  '#.##########.##.##########.#', //27
  '#.##########.##.##########.#', //28
  '#..........................#', //29
  '############################', //30
];

function charToTile(ch: string): number {
  if (ch === '#') return TILE_WALL;
  if (ch === '.') return TILE_DOT;
  if (ch === 'o') return TILE_PELLET;
  if (ch === '-') return TILE_DOOR;
  if (ch === 'H') return TILE_EMPTY;
  // space and others are empty
  return TILE_EMPTY;
}

export function buildMaze(): number[] {
  const maze: number[] = new Array(MAZE_SIZE).fill(TILE_EMPTY);
  for (let y = 0; y < MAZE_H; y++) {
    const row = TEMPLATE[y] ?? ''.padEnd(MAZE_W, ' ');
    for (let x = 0; x < MAZE_W; x++) {
      const ch = row[x] ?? ' ';
      maze[y * MAZE_W + x] = charToTile(ch);
    }
  }
  // Ensure tunnel openings at row 14 col 0 and 27 are empty (wrap)
  maze[14 * MAZE_W + 0] = TILE_EMPTY;
  maze[14 * MAZE_W + 27] = TILE_EMPTY;
  // Ensure ghost house interior (11-16 cols 11-16 rows) is empty where template has space
  // Already empty via space.
  // Patch: dot at tunnel row col 0/27 should not exist; ensure pellets count 4
  // No dots in house interior should remain (already empty)
  return maze;
}

export function countPellets(maze: number[]): { dots: number; pellets: number } {
  let dots = 0, pellets = 0;
  for (const t of maze) {
    if (t === TILE_DOT) dots++;
    if (t === TILE_PELLET) pellets++;
  }
  return { dots, pellets };
}

export function idx(x: number, y: number): number { return y * MAZE_W + x; }

export function inBounds(x: number, y: number): boolean { return x >= 0 && x < MAZE_W && y >= 0 && y < MAZE_H; }

export function isWall(maze: number[], x: number, y: number): boolean {
  if (!inBounds(x, y)) return true;
  const t = maze[idx(x, y)]!;
  return t === TILE_WALL;
}
export function isDoor(maze: number[], x: number, y: number): boolean {
  if (!inBounds(x, y)) return false;
  return maze[idx(x, y)] === TILE_DOOR;
}

// For Pac-Man: cannot go through walls or door. For ghosts: walls block, door only when eaten or exiting house.
export function canMovePac(maze: number[], x: number, y: number, dir: Dir): boolean {
  let nx = x + DIR_VEC[dir].dx;
  let ny = y + DIR_VEC[dir].dy;
  // tunnel wrap
  if (ny === TUNNEL_Y) {
    if (nx < 0) nx = MAZE_W - 1;
    if (nx >= MAZE_W) nx = 0;
  }
  if (!inBounds(nx, ny)) return false;
  const t = maze[idx(nx, ny)]!;
  if (t === TILE_WALL) return false;
  if (t === TILE_DOOR) return false;
  return true;
}
export function canMoveGhost(maze: number[], x: number, y: number, dir: Dir, opts: { canUseDoor: boolean; inTunnel?: boolean }): boolean {
  let nx = x + DIR_VEC[dir].dx;
  let ny = y + DIR_VEC[dir].dy;
  if (ny === TUNNEL_Y) {
    if (nx < 0) nx = MAZE_W - 1;
    if (nx >= MAZE_W) nx = 0;
  }
  if (!inBounds(nx, ny)) return false;
  const t = maze[idx(nx, ny)]!;
  if (t === TILE_WALL) return false;
  if (t === TILE_DOOR && !opts.canUseDoor) return false;
  return true;
}

export function nextPos(x: number, y: number, dir: Dir): { x: number; y: number } {
  let nx = x + DIR_VEC[dir].dx;
  let ny = y + DIR_VEC[dir].dy;
  if (ny === TUNNEL_Y) {
    if (nx < 0) nx = MAZE_W - 1;
    if (nx >= MAZE_W) nx = 0;
  }
  return { x: nx, y: ny };
}

export function availableDirs(maze: number[], x: number, y: number, canUseDoor: boolean): Dir[] {
  const out: Dir[] = [];
  for (const d of DIRS) {
    if (canMoveGhost(maze, x, y, d, { canUseDoor })) out.push(d);
  }
  return out;
}

export function pelletScore(isPower: boolean): number { return isPower ? 50 : 10; }

// Ghost eat scores doubling per fright (per power pellet)
export function ghostScore(streak: number): number {
  // streak 0 => 200, 1=>400, 2=>800, 3=>1600
  const table = [200, 400, 800, 1600];
  return table[Math.min(streak, 3)] ?? 1600;
}

// --- Ghost target calculation ---
export function ghostTarget(
  ghostId: number,
  pacPos: { x: number; y: number },
  pacDir: Dir,
  blinkyPos: { x: number; y: number },
  mode: 'scatter' | 'chase',
  scatterTarget: { x: number; y: number },
): { x: number; y: number } {
  if (mode === 'scatter') return scatterTarget;
  // chase
  switch (ghostId) {
    case 0: // Blinky: direct
      return { x: pacPos.x, y: pacPos.y };
    case 1: { // Pinky: 4 ahead
      const v = DIR_VEC[pacDir];
      return { x: pacPos.x + v.dx * 4, y: pacPos.y + v.dy * 4 };
    }
    case 2: { // Inky: 2 ahead, vector from Blinky double
      const v = DIR_VEC[pacDir];
      const ahead = { x: pacPos.x + v.dx * 2, y: pacPos.y + v.dy * 2 };
      const vx = ahead.x - blinkyPos.x;
      const vy = ahead.y - blinkyPos.y;
      return { x: ahead.x + vx, y: ahead.y + vy };
    }
    case 3: { // Clyde: >8 distance chase else scatter
      const dx = pacPos.x - 0, dy = pacPos.y - 0; // not used
      const dist = Math.hypot(pacPos.x - 0, pacPos.y - 0); // placeholder, correct below
      void dx; void dy;
      const d = Math.hypot(pacPos.x - (0), pacPos.y - (0)); // bug: need ghost pos
      void d;
      // actual distance from Clyde to Pac
      // This is called with Clyde's own pos? For decision we need ghost pos separately.
      // We'll compute in caller; for now return scatter if distance <=8 logic handled outside.
      // To keep pure, we return pac pos and let caller override for Clyde.
      return { x: pacPos.x, y: pacPos.y };
    }
    default: return { x: pacPos.x, y: pacPos.y };
  }
}

// Manhattan distance
export function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
export function euclidSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// Choose ghost direction minimizing distance to target (no reverse)
export function chooseGhostDir(
  maze: number[],
  ghostPos: { x: number; y: number },
  ghostDir: Dir,
  target: { x: number; y: number },
  canUseDoor: boolean,
): Dir {
  const rev = opposite(ghostDir);
  const candidates: { dir: Dir; dist: number }[] = [];
  for (const d of DIRS) {
    if (d === rev) continue;
    if (!canMoveGhost(maze, ghostPos.x, ghostPos.y, d, { canUseDoor })) continue;
    const np = nextPos(ghostPos.x, ghostPos.y, d);
    const dist = euclidSq(np, target);
    candidates.push({ dir: d, dist });
  }
  if (candidates.length === 0) {
    // dead end, must reverse
    if (canMoveGhost(maze, ghostPos.x, ghostPos.y, rev, { canUseDoor })) return rev;
    return ghostDir;
  }
  candidates.sort((a, b) => a.dist - b.dist || DIRS.indexOf(a.dir) - DIRS.indexOf(b.dir));
  return candidates[0]!.dir;
}

// Fruit logic helpers — already defined above

// Expose template for tests
export function getTemplate(): string[] { return [...TEMPLATE]; }
