import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';

export type Dir = 'up' | 'down' | 'left' | 'right';

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export interface BombermanBotPlayer {
  id: string;
  seat: number;
  alive: boolean;
  x: number;
  y: number;
  blastRadius: number;
  maxBombs: number;
  activeBombs: number;
  speed: number;
  hasPass: boolean;
  kills: number;
  gameOver: boolean;
}

export interface BombermanBotPowerUp {
  x: number;
  y: number;
  kind: 'flame' | 'bomb' | 'speed' | 'pass';
}

export interface BombermanBotBomb {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  fuse: number;
  radius: number;
}

export interface BombermanBotBlast {
  x: number;
  y: number;
  ticksRemaining: number;
}

export interface BombermanBotView {
  phase: string;
  winner: string | null;
  you: BombermanBotPlayer | null;
  players: BombermanBotPlayer[];
  grid: number[];
  visiblePowerups: BombermanBotPowerUp[];
  bombs: BombermanBotBomb[];
  blasts: BombermanBotBlast[];
  arenaW: number;
  arenaH: number;
  tickCount: number;
  graceTicksRemaining: number;
}

export type BombermanBotAction =
  | { type: 'move'; dir: Dir }
  | { type: 'bomb' }
  | { type: 'tick' };

const TILE_EMPTY = 0;
const TILE_HARD = 1;

function isPassable(
  grid: number[],
  w: number,
  h: number,
  x: number,
  y: number,
  hasPass: boolean,
  bombs: BombermanBotBomb[]
): boolean {
  if (x < 0 || x >= w || y < 0 || y >= h) return false;
  if (grid[y * w + x] !== TILE_EMPTY) return false;
  if (!hasPass && bombs.some((b) => b.x === x && b.y === y)) return false;
  return true;
}

/**
 * Identify all cells currently dangerous (active blasts + cells covered by bomb radius).
 */
function getDangerCells(view: BombermanBotView, extraBomb?: { x: number; y: number; radius: number }): Set<number> {
  const danger = new Set<number>();
  const w = view.arenaW;
  const h = view.arenaH;

  // Blasts
  for (const bl of view.blasts) {
    danger.add(bl.y * w + bl.x);
  }

  // Live bombs + optional extra hypothetical bomb
  const allBombs = [...view.bombs];
  if (extraBomb) {
    allBombs.push({ id: -1, ownerId: '', x: extraBomb.x, y: extraBomb.y, fuse: 30, radius: extraBomb.radius });
  }

  for (const b of allBombs) {
    danger.add(b.y * w + b.x);
    for (const d of DIRS) {
      for (let dist = 1; dist <= b.radius; dist++) {
        const nx = b.x + DIR_VEC[d].dx * dist;
        const ny = b.y + DIR_VEC[d].dy * dist;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) break;
        const tile = view.grid[ny * w + nx];
        if (tile === TILE_HARD) break;
        danger.add(ny * w + nx);
        if (tile !== TILE_EMPTY) break; // soft block absorbs and stops blast
      }
    }
  }

  return danger;
}

/**
 * BFS to find the shortest path from start to a target predicate.
 * Returns the first step direction.
 */
function bfsNextStep(
  startX: number,
  startY: number,
  w: number,
  h: number,
  grid: number[],
  hasPass: boolean,
  bombs: BombermanBotBomb[],
  isTarget: (x: number, y: number) => boolean,
  avoidCells?: Set<number>
): Dir | null {
  if (isTarget(startX, startY)) return null;

  const queue: { x: number; y: number; firstDir: Dir | null }[] = [];
  const visited = new Set<number>();
  visited.add(startY * w + startX);

  for (const d of DIRS) {
    const nx = startX + DIR_VEC[d].dx;
    const ny = startY + DIR_VEC[d].dy;
    const idx = ny * w + nx;
    if (isPassable(grid, w, h, nx, ny, hasPass, bombs)) {
      if (!avoidCells || !avoidCells.has(idx)) {
        if (isTarget(nx, ny)) return d;
        visited.add(idx);
        queue.push({ x: nx, y: ny, firstDir: d });
      }
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const d of DIRS) {
      const nx = curr.x + DIR_VEC[d].dx;
      const ny = curr.y + DIR_VEC[d].dy;
      const idx = ny * w + nx;
      if (visited.has(idx)) continue;
      if (!isPassable(grid, w, h, nx, ny, hasPass, bombs)) continue;
      if (avoidCells && avoidCells.has(idx)) continue;

      if (isTarget(nx, ny)) {
        return curr.firstDir;
      }
      visited.add(idx);
      queue.push({ x: nx, y: ny, firstDir: curr.firstDir });
    }
  }

  return null;
}

export const bombermanBot: BotPolicy<BombermanBotView, BombermanBotAction> = {
  chooseAction(view, _selfId, rng, difficulty) {
    const you = view.you;
    if (!you || !you.alive) return { type: 'tick' };

    const w = view.arenaW;
    const h = view.arenaH;
    const youIdx = you.y * w + you.x;

    // Available moves
    const availDirs = DIRS.filter((d) =>
      isPassable(view.grid, w, h, you.x + DIR_VEC[d].dx, you.y + DIR_VEC[d].dy, you.hasPass, view.bombs)
    );

    // ================= EASY =================
    if (difficulty === 'easy') {
      // Random bomb every ~30 ticks if we have bombs left and not on a bomb
      if (
        rng.int(30) === 0 &&
        you.activeBombs < you.maxBombs &&
        !view.bombs.some((b) => b.x === you.x && b.y === you.y)
      ) {
        return { type: 'bomb' };
      }
      // Random walk
      if (availDirs.length > 0 && rng.int(4) !== 0) {
        return { type: 'move', dir: rng.pick(availDirs) };
      }
      return { type: 'tick' };
    }

    // Danger zones
    const danger = getDangerCells(view);
    const inDanger = danger.has(youIdx);

    // ================= HARD =================
    if (difficulty === 'hard') {
      // 1. Evacuate if in danger
      if (inDanger) {
        // Find path to any safe cell
        const escapeDir = bfsNextStep(
          you.x,
          you.y,
          w,
          h,
          view.grid,
          you.hasPass,
          view.bombs,
          (x, y) => !danger.has(y * w + x)
        );
        if (escapeDir) return { type: 'move', dir: escapeDir };
      }

      // 2. Collect visible powerups if safe
      if (!inDanger && view.visiblePowerups.length > 0) {
        const powerupDir = bfsNextStep(
          you.x,
          you.y,
          w,
          h,
          view.grid,
          you.hasPass,
          view.bombs,
          (x, y) => view.visiblePowerups.some((p) => p.x === x && p.y === y),
          danger
        );
        if (powerupDir) return { type: 'move', dir: powerupDir };
      }

      // 3. Attack: if near opponent or soft block blocking opponent, check if placing a bomb is safe
      const opponents = view.players.filter((p) => p.alive && p.id !== you.id);
      if (!inDanger && you.activeBombs < you.maxBombs && !view.bombs.some((b) => b.x === you.x && b.y === you.y)) {
        // Check if hypothetical bomb here leaves us an escape route
        const hypDanger = getDangerCells(view, { x: you.x, y: you.y, radius: you.blastRadius });
        const canEscape = DIRS.some((d) => {
          const nx = you.x + DIR_VEC[d].dx;
          const ny = you.y + DIR_VEC[d].dy;
          return (
            isPassable(view.grid, w, h, nx, ny, you.hasPass, view.bombs) &&
            bfsNextStep(nx, ny, w, h, view.grid, you.hasPass, view.bombs, (x, y) => !hypDanger.has(y * w + x)) !== null
          );
        });

        if (canEscape) {
          // Drop bomb if close to opponent or adjacent to soft block
          const closeOpponent = opponents.some((op) => Math.abs(op.x - you.x) + Math.abs(op.y - you.y) <= 3);
          const adjSoft = DIRS.some((d) => {
            const nx = you.x + DIR_VEC[d].dx;
            const ny = you.y + DIR_VEC[d].dy;
            return nx >= 0 && nx < w && ny >= 0 && ny < h && view.grid[ny * w + nx] === 2; // soft block
          });

          if (closeOpponent || adjSoft) {
            return { type: 'bomb' };
          }
        }
      }

      // 4. Move toward closest opponent via safe path
      if (opponents.length > 0) {
        const huntDir = bfsNextStep(
          you.x,
          you.y,
          w,
          h,
          view.grid,
          you.hasPass,
          view.bombs,
          (x, y) => opponents.some((op) => op.x === x && op.y === y),
          danger
        );
        if (huntDir) return { type: 'move', dir: huntDir };
      }

      // 5. Fallback: any move that is not into danger
      const safeDirs = availDirs.filter(
        (d) => !danger.has((you.y + DIR_VEC[d].dy) * w + (you.x + DIR_VEC[d].dx))
      );
      if (safeDirs.length > 0) return { type: 'move', dir: rng.pick(safeDirs) };
      return { type: 'tick' };
    }

    // ================= NORMAL =================
    // 1. Flee own or any bomb blast
    if (inDanger) {
      const escapeDir = bfsNextStep(
        you.x,
        you.y,
        w,
        h,
        view.grid,
        you.hasPass,
        view.bombs,
        (x, y) => !danger.has(y * w + x)
      );
      if (escapeDir) return { type: 'move', dir: escapeDir };
    }

    // 2. Drop bomb if near opponent and safe
    const opponents = view.players.filter((p) => p.alive && p.id !== you.id);
    const nearOpponent = opponents.some((op) => Math.abs(op.x - you.x) + Math.abs(op.y - you.y) <= 4);

    if (
      !inDanger &&
      nearOpponent &&
      you.activeBombs < you.maxBombs &&
      !view.bombs.some((b) => b.x === you.x && b.y === you.y)
    ) {
      const hypDanger = getDangerCells(view, { x: you.x, y: you.y, radius: you.blastRadius });
      const canEscape = DIRS.some((d) => {
        const nx = you.x + DIR_VEC[d].dx;
        const ny = you.y + DIR_VEC[d].dy;
        return (
          isPassable(view.grid, w, h, nx, ny, you.hasPass, view.bombs) &&
          !hypDanger.has(ny * w + nx)
        );
      });
      if (canEscape) {
        return { type: 'bomb' };
      }
    }

    // 3. Move toward opponent general direction if safe
    const safeDirs = availDirs.filter(
      (d) => !danger.has((you.y + DIR_VEC[d].dy) * w + (you.x + DIR_VEC[d].dx))
    );
    if (safeDirs.length > 0) {
      if (opponents.length > 0) {
        const target = opponents[0]!;
        let bestDir = safeDirs[0]!;
        let bestDist = Infinity;
        for (const d of safeDirs) {
          const dist = Math.abs(you.x + DIR_VEC[d].dx - target.x) + Math.abs(you.y + DIR_VEC[d].dy - target.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestDir = d;
          }
        }
        return { type: 'move', dir: bestDir };
      }
      return { type: 'move', dir: rng.pick(safeDirs) };
    }

    return { type: 'tick' };
  },
};
