import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';

export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
export const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
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
const TILE_SOFT = 2;

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
export function getDangerCells(
  view: BombermanBotView,
  extraBomb?: { x: number; y: number; radius: number }
): Set<number> {
  const danger = new Set<number>();
  const w = view.arenaW;
  const h = view.arenaH;

  // Active blasts
  for (const bl of view.blasts) {
    danger.add(bl.y * w + bl.x);
  }

  // Live bombs + optional extra hypothetical bomb
  const allBombs: { x: number; y: number; radius: number }[] = view.bombs.map((b) => ({
    x: b.x,
    y: b.y,
    radius: b.radius,
  }));
  if (extraBomb) {
    allBombs.push(extraBomb);
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
 * Check if placing a bomb at the player's current location allows a safe escape path.
 */
export function canSafelyPlaceBomb(
  view: BombermanBotView,
  you: BombermanBotPlayer
): boolean {
  if (you.activeBombs >= you.maxBombs) return false;
  if (view.bombs.some((b) => b.x === you.x && b.y === you.y)) return false;

  const w = view.arenaW;
  const h = view.arenaH;

  // Hypothetical bomb at player position
  const hypBomb: BombermanBotBomb = {
    id: -999,
    ownerId: you.id,
    x: you.x,
    y: you.y,
    fuse: 30,
    radius: you.blastRadius,
  };
  const bombsWithHyp = [...view.bombs, hypBomb];
  const hypDanger = getDangerCells(view, { x: you.x, y: you.y, radius: you.blastRadius });

  // From you.x, you.y, try every passable neighbor step.
  // The newly placed bomb blocks walking back to (you.x, you.y) unless player has pass.
  for (const d of DIRS) {
    const nx = you.x + DIR_VEC[d].dx;
    const ny = you.y + DIR_VEC[d].dy;
    if (!isPassable(view.grid, w, h, nx, ny, you.hasPass, view.bombs)) continue;

    // Check if neighbor is already safe
    if (!hypDanger.has(ny * w + nx)) {
      return true;
    }

    // BFS from (nx, ny) to any safe cell outside hypDanger
    const queue: { x: number; y: number; dist: number }[] = [{ x: nx, y: ny, dist: 1 }];
    const visited = new Set<number>();
    if (!you.hasPass) {
      visited.add(you.y * w + you.x); // cannot step back onto bomb
    }
    visited.add(ny * w + nx);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (!hypDanger.has(curr.y * w + curr.x)) {
        return true;
      }
      if (curr.dist >= 8) continue; // within bomb fuse limit

      for (const nextD of DIRS) {
        const sx = curr.x + DIR_VEC[nextD].dx;
        const sy = curr.y + DIR_VEC[nextD].dy;
        const sidx = sy * w + sx;
        if (visited.has(sidx)) continue;
        visited.add(sidx);

        if (isPassable(view.grid, w, h, sx, sy, you.hasPass, bombsWithHyp)) {
          queue.push({ x: sx, y: sy, dist: curr.dist + 1 });
        }
      }
    }
  }

  return false;
}

/**
 * BFS to find the best direction to flee from danger to a safe cell.
 */
export function findEscapeDir(
  view: BombermanBotView,
  you: BombermanBotPlayer,
  danger: Set<number>
): Dir | null {
  const w = view.arenaW;
  const h = view.arenaH;
  const youIdx = you.y * w + you.x;

  if (!danger.has(youIdx)) return null;

  const blastCells = new Set<number>(view.blasts.map((b) => b.y * w + b.x));

  // Immediate neighbors
  for (const d of DIRS) {
    const nx = you.x + DIR_VEC[d].dx;
    const ny = you.y + DIR_VEC[d].dy;
    const nidx = ny * w + nx;
    if (isPassable(view.grid, w, h, nx, ny, you.hasPass, view.bombs) && !blastCells.has(nidx)) {
      if (!danger.has(nidx)) {
        return d; // Direct escape to safe cell
      }
    }
  }

  // BFS search for multi-step escape
  const queue: { x: number; y: number; firstDir: Dir; dist: number }[] = [];
  const visited = new Set<number>();
  visited.add(youIdx);

  for (const d of DIRS) {
    const nx = you.x + DIR_VEC[d].dx;
    const ny = you.y + DIR_VEC[d].dy;
    const nidx = ny * w + nx;
    if (isPassable(view.grid, w, h, nx, ny, you.hasPass, view.bombs) && !blastCells.has(nidx)) {
      visited.add(nidx);
      queue.push({ x: nx, y: ny, firstDir: d, dist: 1 });
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (!danger.has(curr.y * w + curr.x)) {
      return curr.firstDir;
    }
    if (curr.dist >= 10) continue;

    for (const d of DIRS) {
      const nx = curr.x + DIR_VEC[d].dx;
      const ny = curr.y + DIR_VEC[d].dy;
      const nidx = ny * w + nx;
      if (visited.has(nidx)) continue;
      visited.add(nidx);

      if (isPassable(view.grid, w, h, nx, ny, you.hasPass, view.bombs) && !blastCells.has(nidx)) {
        queue.push({ x: nx, y: ny, firstDir: curr.firstDir, dist: curr.dist + 1 });
      }
    }
  }

  return null;
}

/**
 * BFS finding shortest path to any target predicate, avoiding obstacles and danger cells.
 */
export function findPathTo(
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

  const queue: { x: number; y: number; firstDir: Dir }[] = [];
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
      visited.add(idx);

      if (!isPassable(grid, w, h, nx, ny, hasPass, bombs)) continue;
      if (avoidCells && avoidCells.has(idx)) continue;

      if (isTarget(nx, ny)) {
        return curr.firstDir;
      }
      queue.push({ x: nx, y: ny, firstDir: curr.firstDir });
    }
  }

  return null;
}

export const bombermanBot: BotPolicy<BombermanBotView, BombermanBotAction> = {
  chooseAction(view, _selfId, rng, difficulty) {
    const you = view.you;
    if (!you || !you.alive || you.gameOver) return { type: 'tick' };

    const w = view.arenaW;
    const h = view.arenaH;
    const youIdx = you.y * w + you.x;

    const danger = getDangerCells(view);
    const inDanger = danger.has(youIdx);
    const blastCells = new Set<number>(view.blasts.map((b) => b.y * w + b.x));

    const availDirs = DIRS.filter((d) =>
      isPassable(view.grid, w, h, you.x + DIR_VEC[d].dx, you.y + DIR_VEC[d].dy, you.hasPass, view.bombs)
    );

    // ================= 1. SAFETY: ESCAPE DANGER =================
    if (inDanger) {
      const escapeDir = findEscapeDir(view, you, danger);
      if (escapeDir) {
        return { type: 'move', dir: escapeDir };
      }
      // If no full escape path is found, move away from active blasts or any passable step
      const nonBlastDirs = availDirs.filter(
        (d) => !blastCells.has((you.y + DIR_VEC[d].dy) * w + (you.x + DIR_VEC[d].dx))
      );
      if (nonBlastDirs.length > 0) {
        return { type: 'move', dir: rng.pick(nonBlastDirs) };
      }
      return { type: 'tick' };
    }

    const opponents = view.players.filter((p) => p.alive && !p.gameOver && p.id !== you.id);

    // Check if adjacent to soft block
    const hasAdjSoft = DIRS.some((d) => {
      const nx = you.x + DIR_VEC[d].dx;
      const ny = you.y + DIR_VEC[d].dy;
      return nx >= 0 && nx < w && ny >= 0 && ny < h && view.grid[ny * w + nx] === TILE_SOFT;
    });

    // Check if near an opponent or in direct line of sight
    const nearOpponent = opponents.some(
      (op) => Math.abs(op.x - you.x) + Math.abs(op.y - you.y) <= you.blastRadius + 1
    );
    const opponentInBlastLine = opponents.some((op) => {
      if (op.x === you.x) {
        const dist = Math.abs(op.y - you.y);
        if (dist <= you.blastRadius) {
          const stepY = op.y > you.y ? 1 : -1;
          for (let y = you.y + stepY; y !== op.y; y += stepY) {
            if (view.grid[y * w + you.x] === TILE_HARD) return false;
          }
          return true;
        }
      }
      if (op.y === you.y) {
        const dist = Math.abs(op.x - you.x);
        if (dist <= you.blastRadius) {
          const stepX = op.x > you.x ? 1 : -1;
          for (let x = you.x + stepX; x !== op.x; x += stepX) {
            if (view.grid[you.y * w + x] === TILE_HARD) return false;
          }
          return true;
        }
      }
      return false;
    });

    const shouldBomb = hasAdjSoft || nearOpponent || opponentInBlastLine;

    // ================= 2. PLACE BOMB =================
    if (shouldBomb && canSafelyPlaceBomb(view, you)) {
      if (difficulty === 'easy') {
        // Easy bot places bombs 50% of the time when safe and useful
        if (rng.int(2) === 0) {
          return { type: 'bomb' };
        }
      } else {
        return { type: 'bomb' };
      }
    }

    // ================= 3. POWERUP COLLECTION =================
    if (view.visiblePowerups.length > 0) {
      const powerupDir = findPathTo(
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
      if (powerupDir) {
        return { type: 'move', dir: powerupDir };
      }
    }

    // ================= 4. HUNT OPPONENT (HARD / NORMAL) =================
    if (opponents.length > 0) {
      const huntDir = findPathTo(
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
      if (huntDir) {
        return { type: 'move', dir: huntDir };
      }
    }

    // ================= 5. NAVIGATE TO NEAREST SOFT BLOCK =================
    // When opponents are behind soft blocks, move to a tile adjacent to a soft block to clear it.
    const softBlockDir = findPathTo(
      you.x,
      you.y,
      w,
      h,
      view.grid,
      you.hasPass,
      view.bombs,
      (x, y) => {
        return DIRS.some((d) => {
          const nx = x + DIR_VEC[d].dx;
          const ny = y + DIR_VEC[d].dy;
          return nx >= 0 && nx < w && ny >= 0 && ny < h && view.grid[ny * w + nx] === TILE_SOFT;
        });
      },
      danger
    );
    if (softBlockDir) {
      return { type: 'move', dir: softBlockDir };
    }

    // ================= 6. SAFE STEP TOWARD OPPONENT =================
    const safeDirs = availDirs.filter(
      (d) => !danger.has((you.y + DIR_VEC[d].dy) * w + (you.x + DIR_VEC[d].dx))
    );

    if (safeDirs.length > 0) {
      if (opponents.length > 0) {
        let bestDir = safeDirs[0]!;
        let bestDist = Infinity;
        for (const d of safeDirs) {
          const nx = you.x + DIR_VEC[d].dx;
          const ny = you.y + DIR_VEC[d].dy;
          for (const op of opponents) {
            const dist = Math.abs(nx - op.x) + Math.abs(ny - op.y);
            if (dist < bestDist) {
              bestDist = dist;
              bestDir = d;
            }
          }
        }
        return { type: 'move', dir: bestDir };
      }
      return { type: 'move', dir: rng.pick(safeDirs) };
    }

    return { type: 'tick' };
  },
};
