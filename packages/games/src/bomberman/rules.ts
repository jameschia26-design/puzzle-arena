export {
  ARENA_W,
  ARENA_H,
  ARENA_SIZE,
  TILE_EMPTY,
  TILE_HARD,
  TILE_SOFT,
  DIRS,
  DIR_VEC,
  type Dir,
  type PowerUpKind,
  type PowerUpItem,
  type BombState,
  type BlastCell,
  type BombermanPlayerState,
  type BombermanConfig,
  type BombermanState,
} from './state.js';
import {
  ARENA_W,
  ARENA_H,
  ARENA_SIZE,
  TILE_EMPTY,
  TILE_HARD,
  TILE_SOFT,
  DIRS,
  DIR_VEC,
  type Dir,
  type PowerUpKind,
  type PowerUpItem,
  type BombState,
  type BlastCell,
  type BombermanPlayerState,
  type BombermanConfig,
  type BombermanState,
} from './state.js';
import type { Rng } from '@puzzle-arena/shared';

export function cellIndex(x: number, y: number): number {
  return y * ARENA_W + x;
}

export function fromIndex(idx: number): { x: number; y: number } {
  return { x: idx % ARENA_W, y: Math.floor(idx / ARENA_W) };
}

export function isOutOfBounds(x: number, y: number): boolean {
  return x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H;
}

export function isBorder(x: number, y: number): boolean {
  return x === 0 || x === ARENA_W - 1 || y === 0 || y === ARENA_H - 1;
}

export function isHardPillar(x: number, y: number): boolean {
  return !isBorder(x, y) && x % 2 === 0 && y % 2 === 0;
}

/**
 * 8 spawn positions:
 * Seats 0..3: 4 classic corners: (1,1), (13,1), (1,11), (13,11)
 * Note: prompt mentions (2,1) and (2,11) as part of corner safe zones.
 * Seats 4..7: (7,6) central area
 */
export const SPAWN_POINTS: { x: number; y: number }[] = [
  { x: 1, y: 1 },    // Seat 0 (Player 1) - Top-left
  { x: 13, y: 1 },   // Seat 1 (Player 2) - Top-right
  { x: 1, y: 11 },   // Seat 2 (Player 3) - Bottom-left
  { x: 13, y: 11 },  // Seat 3 (Player 4) - Bottom-right
  { x: 7, y: 5 },    // Seat 4 (Player 5) - Center-north
  { x: 7, y: 7 },    // Seat 5 (Player 6) - Center-south
  { x: 5, y: 6 },    // Seat 6 (Player 7) - Center-west
  { x: 9, y: 6 },    // Seat 7 (Player 8) - Center-east
];

/**
 * Returns safe cell coordinates around each spawn point that MUST NOT have soft blocks.
 * For corner spawns, includes spawn and all adjacent corridor cells (e.g. (1,1) + (2,1) + (1,2)).
 */
export function getSafeZoneCells(): Set<number> {
  const safe = new Set<number>();
  for (const sp of SPAWN_POINTS) {
    safe.add(cellIndex(sp.x, sp.y));
    for (const d of DIRS) {
      const nx = sp.x + DIR_VEC[d].dx;
      const ny = sp.y + DIR_VEC[d].dy;
      if (!isOutOfBounds(nx, ny) && !isBorder(nx, ny) && !isHardPillar(nx, ny)) {
        safe.add(cellIndex(nx, ny));
      }
    }
  }
  // Extra safety around (7,6) area
  for (let y = 5; y <= 7; y++) {
    for (let x = 6; x <= 8; x++) {
      if (!isHardPillar(x, y)) {
        safe.add(cellIndex(x, y));
      }
    }
  }
  return safe;
}

/**
 * Build initial arena grid and hidden powerups.
 * Deterministic via passed rng.
 */
export function buildArena(
  config: BombermanConfig,
  rng: Rng
): { grid: number[]; hiddenPowerups: Record<number, PowerUpKind> } {
  const grid: number[] = new Array(ARENA_SIZE).fill(TILE_EMPTY);
  const hiddenPowerups: Record<number, PowerUpKind> = {};
  const safeZone = getSafeZoneCells();

  for (let y = 0; y < ARENA_H; y++) {
    for (let x = 0; x < ARENA_W; x++) {
      const idx = cellIndex(x, y);
      if (isBorder(x, y) || isHardPillar(x, y)) {
        grid[idx] = TILE_HARD;
      } else if (!safeZone.has(idx)) {
        // Candidate for soft block
        if (rng.int(100) < config.softDensity) {
          grid[idx] = TILE_SOFT;
          // ~12% drop chance for powerups under soft block
          if (rng.int(100) < 12) {
            // Weighted: FLAME(40%) > BOMB(30%) > SPEED(20%) > PASS(10%)
            const roll = rng.int(10);
            let kind: PowerUpKind;
            if (roll < 4) kind = 'flame';
            else if (roll < 7) kind = 'bomb';
            else if (roll < 9) kind = 'speed';
            else kind = 'pass';
            hiddenPowerups[idx] = kind;
          }
        }
      }
    }
  }

  return { grid, hiddenPowerups };
}

/**
 * Check if a player can step onto (nx, ny).
 */
export function canStepTo(
  s: BombermanState,
  player: BombermanPlayerState,
  nx: number,
  ny: number
): boolean {
  if (isOutOfBounds(nx, ny)) return false;
  const idx = cellIndex(nx, ny);
  if (s.grid[idx] !== TILE_EMPTY) return false;

  // Check bombs
  const bombAtDest = s.bombs.find((b) => b.x === nx && b.y === ny);
  if (bombAtDest) {
    if (player.hasPass) return true; // PASS allows walking through bombs
    // Allowed only if this bomb is still under the player (was placed while standing on it)
    if (player.bombsUnderPlayer.includes(bombAtDest.id)) {
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Handle a single movement step. Returns true if moved.
 */
export function executeMoveStep(
  s: BombermanState,
  player: BombermanPlayerState,
  dir: Dir
): boolean {
  const nx = player.x + DIR_VEC[dir].dx;
  const ny = player.y + DIR_VEC[dir].dy;

  if (!canStepTo(s, player, nx, ny)) {
    return false;
  }

  player.x = nx;
  player.y = ny;

  // Update bombs under player: remove any bombs that player has now stepped off
  player.bombsUnderPlayer = player.bombsUnderPlayer.filter((bombId) => {
    const b = s.bombs.find((bomb) => bomb.id === bombId);
    return b && b.x === player.x && b.y === player.y;
  });

  // Check if stepped onto a visible powerup
  const pIndex = s.visiblePowerups.findIndex((p) => p.x === nx && p.y === ny);
  if (pIndex >= 0) {
    const p = s.visiblePowerups[pIndex]!;
    s.visiblePowerups.splice(pIndex, 1);
    applyPowerup(player, p.kind);
  }

  return true;
}

export function applyPowerup(player: BombermanPlayerState, kind: PowerUpKind): void {
  player.powerupsCollected[kind] += 1;
  switch (kind) {
    case 'flame':
      player.blastRadius = Math.min(6, player.blastRadius + 1);
      break;
    case 'bomb':
      player.maxBombs = Math.min(8, player.maxBombs + 1);
      break;
    case 'speed':
      player.speed = Math.min(3, player.speed + 1);
      break;
    case 'pass':
      player.hasPass = true;
      break;
  }
}

/**
 * Detonates a set of bombs, including chain reactions in deterministic queue order.
 * Chain detonation queue is processed in (y, x, id) order.
 */
export function processDetonations(
  s: BombermanState,
  initialDetonating: BombState[]
): { newBlasts: BlastCell[]; eliminatedPlayerIds: string[]; killCredits: Record<string, string[]> } {
  const queue: BombState[] = [...initialDetonating];
  // Sort queue deterministically by y, x, id
  queue.sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);

  const processedBombIds = new Set<number>();
  const blastCells: BlastCell[] = [];
  const blastCellMap = new Map<number, BlastCell>(); // cellIndex -> BlastCell

  while (queue.length > 0) {
    const bomb = queue.shift()!;
    if (processedBombIds.has(bomb.id)) continue;
    processedBombIds.add(bomb.id);

    // Remove bomb from s.bombs
    const bIdx = s.bombs.findIndex((b) => b.id === bomb.id);
    if (bIdx >= 0) {
      s.bombs.splice(bIdx, 1);
    }
    // Update owner active count
    const owner = s.players.find((p) => p.id === bomb.ownerId);
    if (owner) {
      owner.activeBombs = Math.max(0, owner.activeBombs - 1);
      owner.bombsUnderPlayer = owner.bombsUnderPlayer.filter((id) => id !== bomb.id);
    }

    // Add center cell
    const centerIdx = cellIndex(bomb.x, bomb.y);
    if (!blastCellMap.has(centerIdx)) {
      const cell: BlastCell = { x: bomb.x, y: bomb.y, ticksRemaining: 3, ownerId: bomb.ownerId };
      blastCellMap.set(centerIdx, cell);
      blastCells.push(cell);
    }

    const newlyTriggeredBombs: BombState[] = [];

    // Blast arms in 4 directions
    for (const d of DIRS) {
      for (let dist = 1; dist <= bomb.radius; dist++) {
        const nx = bomb.x + DIR_VEC[d].dx * dist;
        const ny = bomb.y + DIR_VEC[d].dy * dist;

        if (isOutOfBounds(nx, ny)) break;
        const idx = cellIndex(nx, ny);
        const tile = s.grid[idx];

        if (tile === TILE_HARD) {
          // Hard block stops blast completely
          break;
        }

        // Add blast cell
        if (!blastCellMap.has(idx)) {
          const cell: BlastCell = { x: nx, y: ny, ticksRemaining: 3, ownerId: bomb.ownerId };
          blastCellMap.set(idx, cell);
          blastCells.push(cell);
        }

        if (tile === TILE_SOFT) {
          // Soft block is destroyed and stops blast
          s.grid[idx] = TILE_EMPTY;
          // Reveal powerup if present
          if (s.hiddenPowerups[idx]) {
            s.visiblePowerups.push({ x: nx, y: ny, kind: s.hiddenPowerups[idx]! });
            delete s.hiddenPowerups[idx];
          }
          break;
        }

        // Check if bomb present in this cell -> chain reaction!
        const chainBomb = s.bombs.find((b) => b.x === nx && b.y === ny);
        if (chainBomb && !processedBombIds.has(chainBomb.id)) {
          if (!queue.some((b) => b.id === chainBomb.id) && !newlyTriggeredBombs.some((b) => b.id === chainBomb.id)) {
            newlyTriggeredBombs.push(chainBomb);
          }
        }

        // Check if visible powerup is in this cell -> destroyed by blast
        const pIndex = s.visiblePowerups.findIndex((p) => p.x === nx && p.y === ny);
        if (pIndex >= 0) {
          s.visiblePowerups.splice(pIndex, 1);
        }
      }
    }

    if (newlyTriggeredBombs.length > 0) {
      // Sort newly triggered deterministically in (y, x, id) order and push to queue
      newlyTriggeredBombs.sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
      queue.push(...newlyTriggeredBombs);
      // Keep entire queue sorted
      queue.sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
    }
  }

  // Merge blast cells into state
  s.blasts.push(...blastCells);

  // Check player eliminations against ALL active blast cells (both existing and new)
  const eliminatedPlayerIds: string[] = [];
  const killCredits: Record<string, string[]> = {}; // killerId -> victimIds

  if (s.graceTicksRemaining === 0) {
    for (const player of s.players) {
      if (!player.alive) continue;
      const hitBlast = s.blasts.find((b) => b.x === player.x && b.y === player.y);
      if (hitBlast) {
        player.alive = false;
        player.gameOver = true;
        eliminatedPlayerIds.push(player.id);
        const killerId = hitBlast.ownerId;
        if (killerId && killerId !== player.id) {
          const killer = s.players.find((p) => p.id === killerId);
          if (killer) {
            killer.kills += 1;
            if (!killCredits[killerId]) killCredits[killerId] = [];
            killCredits[killerId]!.push(player.id);
          }
        }
      }
    }
  }

  return { newBlasts: blastCells, eliminatedPlayerIds, killCredits };
}
