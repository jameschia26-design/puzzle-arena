import type { Rng } from '@puzzle-arena/shared';
import {
  PLAYFIELD_W,
  PLAYFIELD_H,
  ALIEN_ROWS,
  ALIEN_COLS,
  ALIEN_COUNT,
  ALIEN_COL_SPACING,
  ALIEN_ROW_SPACING,
  ALIEN_WIDTH,
  BUNKER_COUNT,
  BUNKER_W,
  BUNKER_H,
  BUNKER_X,
  BUNKER_Y,
  PLAYER_Y,
  PLAYER_START_X,
  PLAYER_WIDTH,
  PLAYER_SPEED,
  PLAYER_LIVES,
  UFO_Y,
  UFO_WIDTH,
  UFO_SCORES,
  type Alien,
  type AlienType,
  type Bunker,
  type Bullet,
  type AlienBomb,
  type UFO,
  type SpaceInvadersPlayerState,
} from './state.js';

/** Create initial 55 aliens */
export function createAlienFleet(): Alien[] {
  const aliens: Alien[] = [];
  let id = 0;
  for (let row = 0; row < ALIEN_ROWS; row++) {
    let type: AlienType = 'octopus';
    let points = 8;
    if (row === 0) {
      type = 'squid';
      points = 32;
    } else if (row === 1 || row === 2) {
      type = 'crab';
      points = 16;
    }
    for (let col = 0; col < ALIEN_COLS; col++) {
      aliens.push({
        id: id++,
        row,
        col,
        type,
        points,
        alive: true,
      });
    }
  }
  return aliens;
}

/** Initial 8x7 bunker mask with rounded top corners and open bottom arch */
export function createBunkerMask(): boolean[] {
  // 8 cols x 7 rows = 56 booleans
  // Row 0: .XXXXXX. (indices 1..6)
  // Row 1..4: XXXXXXXX
  // Row 5..6: XX....XX (open arch in cols 2..5)
  const mask = new Array<boolean>(BUNKER_W * BUNKER_H).fill(true);

  // Row 0 notches
  mask[0 * BUNKER_W + 0] = false;
  mask[0 * BUNKER_W + 7] = false;

  // Row 5 arch
  for (let c = 2; c <= 5; c++) {
    mask[5 * BUNKER_W + c] = false;
  }

  // Row 6 arch
  for (let c = 2; c <= 5; c++) {
    mask[6 * BUNKER_W + c] = false;
  }

  return mask;
}

export function createBunkers(): Bunker[] {
  const bunkers: Bunker[] = [];
  for (let i = 0; i < BUNKER_COUNT; i++) {
    bunkers.push({
      id: i,
      x: BUNKER_X[i]!,
      y: BUNKER_Y,
      width: BUNKER_W,
      height: BUNKER_H,
      mask: createBunkerMask(),
    });
  }
  return bunkers;
}

/** Formation march interval scaling with aliveCount and wave */
export function marchInterval(aliveCount: number, wave: number): number {
  const base = Math.max(2, Math.floor(aliveCount / 4));
  const waveSpeedup = Math.floor((wave - 1) / 2);
  return Math.max(1, base - waveSpeedup);
}

/** Alien firing interval scaling with wave */
export function alienFireInterval(wave: number): number {
  return Math.max(6, 25 - (wave - 1) * 3);
}

/** UFO spawn timer (300-600 ticks) */
export function nextUfoSpawnTimer(rng: Rng): number {
  return 300 + rng.int(301);
}

/** Erode 3x3-ish chunk of bunker. direction: 'from_above' (bomb) or 'from_below' (player shot) */
export function erodeBunker(bunker: Bunker, hitLocalX: number, hitLocalY: number, direction: 'from_above' | 'from_below'): void {
  const minY = direction === 'from_below' ? hitLocalY - 2 : hitLocalY;
  const maxY = direction === 'from_below' ? hitLocalY : hitLocalY + 2;
  const minX = hitLocalX - 1;
  const maxX = hitLocalX + 1;

  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= BUNKER_H) continue;
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= BUNKER_W) continue;
      bunker.mask[y * BUNKER_W + x] = false;
    }
  }
}

/** Check if bunker at given global coords has solid cell */
export function hitBunkerAt(bunkers: Bunker[], x: number, y: number): { bunker: Bunker; lx: number; ly: number } | null {
  for (const b of bunkers) {
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
      const lx = x - b.x;
      const ly = y - b.y;
      if (b.mask[ly * BUNKER_W + lx]) {
        return { bunker: b, lx, ly };
      }
    }
  }
  return null;
}

/** Bounding columns of living aliens in formation */
export function livingAlienCols(aliens: Alien[]): { minCol: number; maxCol: number; maxRow: number } {
  let minCol = ALIEN_COLS;
  let maxCol = -1;
  let maxRow = -1;
  for (const a of aliens) {
    if (a.alive) {
      if (a.col < minCol) minCol = a.col;
      if (a.col > maxCol) maxCol = a.col;
      if (a.row > maxRow) maxRow = a.row;
    }
  }
  return { minCol, maxCol, maxRow };
}

/** Create new player state */
export function createPlayerState(id: string, seat: number, startWave: number, rng: Rng): SpaceInvadersPlayerState {
  return {
    id,
    seat,
    score: 0,
    lives: PLAYER_LIVES,
    wave: startWave,
    wavesCleared: 0,
    aliensKilled: 0,
    playerX: PLAYER_START_X,
    playerY: PLAYER_Y,
    bullet: null,
    bullets: [],
    maxBullets: 1,
    fireCooldownTicks: 0,
    alienBombs: [],
    nextBombId: 1,
    bunkers: createBunkers(),
    aliens: createAlienFleet(),
    formationX: 10,
    formationY: Math.min(10, 2 + (startWave - 1)),
    formationDir: 1,
    formationMoveCounter: 0,
    aliveCount: ALIEN_COUNT,
    fireTimer: alienFireInterval(startWave),
    ufo: null,
    ufoSpawnTimer: nextUfoSpawnTimer(rng),
    respawnGraceTicks: 0,
    gameOver: false,
    actionsSubmitted: 0,
    actionsAccepted: 0,
    penalties: 0,
  };
}

/** Reset player for next wave */
export function setupNextWave(player: SpaceInvadersPlayerState, rng: Rng): void {
  player.wave += 1;
  player.wavesCleared += 1;
  player.aliens = createAlienFleet();
  player.aliveCount = ALIEN_COUNT;
  player.formationX = 10;
  player.formationY = Math.min(12, 2 + (player.wave - 1));
  player.formationDir = 1;
  player.formationMoveCounter = 0;
  player.fireTimer = alienFireInterval(player.wave);
  player.bullet = null;
  player.bullets = [];
  player.fireCooldownTicks = 0;
  player.maxBullets = 1 + (player.wavesCleared % 5 === 0 && player.wavesCleared > 0 ? 1 : 0);
  player.alienBombs = [];
  player.ufo = null;
  player.ufoSpawnTimer = nextUfoSpawnTimer(rng);
}

/** Render a 64x32 board mask for clients/view (0=empty, 1=player, 2=alien, 3=bullet, 4=bomb, 5=bunker, 6=ufo) */
export function renderBoard(p: SpaceInvadersPlayerState): number[] {
  const board = new Array<number>(PLAYFIELD_W * PLAYFIELD_H).fill(0);

  // Bunkers
  for (const b of p.bunkers) {
    for (let r = 0; r < BUNKER_H; r++) {
      const gy = b.y + r;
      if (gy < 0 || gy >= PLAYFIELD_H) continue;
      for (let c = 0; c < BUNKER_W; c++) {
        const gx = b.x + c;
        if (gx < 0 || gx >= PLAYFIELD_W) continue;
        if (b.mask[r * BUNKER_W + c]) {
          board[gy * PLAYFIELD_W + gx] = 5;
        }
      }
    }
  }

  // Aliens
  for (const a of p.aliens) {
    if (!a.alive) continue;
    const ax = p.formationX + a.col * ALIEN_COL_SPACING;
    const ay = p.formationY + a.row * ALIEN_ROW_SPACING;
    if (ay >= 0 && ay < PLAYFIELD_H) {
      for (let w = 0; w < ALIEN_WIDTH; w++) {
        const gx = ax + w;
        if (gx >= 0 && gx < PLAYFIELD_W) {
          board[ay * PLAYFIELD_W + gx] = 2;
        }
      }
    }
  }

  // UFO
  if (p.ufo && p.ufo.alive) {
    const uy = p.ufo.y;
    for (let w = 0; w < UFO_WIDTH; w++) {
      const gx = p.ufo.x + w;
      if (gx >= 0 && gx < PLAYFIELD_W && uy >= 0 && uy < PLAYFIELD_H) {
        board[uy * PLAYFIELD_W + gx] = 6;
      }
    }
  }

  // Player
  if (!p.gameOver) {
    const py = p.playerY;
    for (let w = 0; w < PLAYER_WIDTH; w++) {
      const gx = p.playerX + w;
      if (gx >= 0 && gx < PLAYFIELD_W && py >= 0 && py < PLAYFIELD_H) {
        board[py * PLAYFIELD_W + gx] = 1;
      }
    }
  }

  // Bombs
  for (const bomb of p.alienBombs) {
    if (bomb.x >= 0 && bomb.x < PLAYFIELD_W && bomb.y >= 0 && bomb.y < PLAYFIELD_H) {
      board[bomb.y * PLAYFIELD_W + bomb.x] = 4;
    }
  }

  // Bullets
  const bullets = p.bullets && p.bullets.length > 0 ? p.bullets : (p.bullet ? [p.bullet] : []);
  for (const b of bullets) {
    const bx = b.x;
    const by = b.y;
    if (bx >= 0 && bx < PLAYFIELD_W && by >= 0 && by < PLAYFIELD_H) {
      board[by * PLAYFIELD_W + bx] = 3;
    }
  }
  return board;
}
