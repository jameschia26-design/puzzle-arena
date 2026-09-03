import { mulberry32, rngFrom, type ScoreInput, type LogEntry, type Rng } from '@puzzle-arena/shared';
import type { GameEngine, ReduceResult } from '../engine.js';
import { makeLog, stampLogs } from '../engine.js';
import {
  PLAYFIELD_W,
  PLAYFIELD_H,
  ALIEN_COUNT,
  ALIEN_COL_SPACING,
  ALIEN_ROW_SPACING,
  ALIEN_WIDTH,
  PLAYER_START_X,
  PLAYER_WIDTH,
  PLAYER_SPEED,
  RESPAWN_GRACE_TICKS,
  UFO_Y,
  UFO_WIDTH,
  UFO_SCORES,
  type SpaceInvadersState,
  type SpaceInvadersPlayerState,
  type SpaceInvadersConfig,
  type SpaceInvadersAction,
  type SpaceInvadersView,
  type SpaceInvadersPublicPlayer,
  type AlienBomb,
  type Alien,
  type Bullet,
} from './state.js';
import {
  createPlayerState,
  setupNextWave,
  marchInterval,
  alienFireInterval,
  nextUfoSpawnTimer,
  erodeBunker,
  hitBunkerAt,
  livingAlienCols,
  renderBoard,
} from './rules.js';

export * from './state.js';
export * from './rules.js';

const DEFAULT_CONFIG: SpaceInvadersConfig = {
  tickMs: 60,
  startWave: 1,
  assist: false,
};

function clone(s: SpaceInvadersState): SpaceInvadersState {
  return structuredClone(s);
}

function parseConfig(raw: unknown): SpaceInvadersConfig {
  const cfg: SpaceInvadersConfig = { ...DEFAULT_CONFIG };
  if (raw && typeof raw === 'object') {
    const p = raw as Partial<SpaceInvadersConfig>;
    if (typeof p.tickMs === 'number') {
      cfg.tickMs = Math.max(20, Math.min(200, Math.floor(p.tickMs)));
    }
    if (typeof p.startWave === 'number') {
      cfg.startWave = Math.max(1, Math.min(10, Math.floor(p.startWave)));
    }
    if (typeof p.assist === 'boolean') {
      cfg.assist = p.assist;
    }
    if (typeof p.waves === 'number') {
      cfg.waves = Math.max(1, Math.floor(p.waves));
    }
  }
  return cfg;
}

function playerById(s: SpaceInvadersState, id: string): SpaceInvadersPlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

function setup(playerIds: string[], seed: number, rawConfig: unknown): SpaceInvadersState {
  const config = parseConfig(rawConfig);
  const rng = mulberry32(seed);
  const players = playerIds.map((id, i) => createPlayerState(id, i, config.startWave, rng));

  return {
    rng: { seed, calls: rng.calls },
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players,
    phase: 'playing',
    log: [],
    winner: null,
  };
}

function tickPlayer(
  player: SpaceInvadersPlayerState,
  config: SpaceInvadersConfig,
  rng: Rng,
): string[] {
  const logs: string[] = [];
  if (player.gameOver) return logs;

  // Handle respawn grace period
  if (player.respawnGraceTicks > 0) {
    player.respawnGraceTicks -= 1;
  }
  // Decrement fire cooldown
  if (player.fireCooldownTicks > 0) {
    player.fireCooldownTicks -= 1;
  }

  // 1. Player Bullet movement & collisions
  if ((!player.bullets || player.bullets.length === 0) && player.bullet !== null) {
    player.bullets = [player.bullet];
  }

  const nextBullets: Bullet[] = [];
  for (const bullet of player.bullets ?? []) {
    bullet.y -= 1;

    // Check top wall
    if (bullet.y < 0) {
      continue;
    }

    // Check UFO hit
    if (
      player.ufo &&
      player.ufo.alive &&
      (bullet.y === player.ufo.y || (bullet.y <= player.ufo.y && bullet.y >= player.ufo.y - 1)) &&
      bullet.x >= player.ufo.x &&
      bullet.x < player.ufo.x + UFO_WIDTH
    ) {
      const pts = rng.pick(UFO_SCORES);
      player.score += pts;
      player.ufo.alive = false;
      player.ufo.points = pts;
      player.ufo = null;
      logs.push(`UFO destroyed — ${pts} pts`);
      continue;
    }

    // Alien hit check
    let hitAlien = false;
    for (const a of player.aliens) {
      if (!a.alive) continue;
      const ax = player.formationX + a.col * ALIEN_COL_SPACING;
      const ay = player.formationY + a.row * ALIEN_ROW_SPACING;
      if (
        bullet.y === ay &&
        bullet.x >= ax &&
        bullet.x < ax + ALIEN_WIDTH
      ) {
        a.alive = false;
        player.aliveCount -= 1;
        player.aliensKilled += 1;
        player.score += a.points;
        logs.push(`Alien hit — ${a.points} pts`);
        hitAlien = true;
        break;
      }
    }
    if (hitAlien) continue;

    // Bunker hit check from below
    const hit = hitBunkerAt(player.bunkers, bullet.x, bullet.y);
    if (hit) {
      erodeBunker(hit.bunker, hit.lx, hit.ly, 'from_below');
      continue;
    }

    nextBullets.push(bullet);
  }
  player.bullets = nextBullets;
  player.bullet = player.bullets[0] ?? null;

  // 2. Check wave clear
  if (player.aliveCount === 0) {
    if (config.waves && player.wave >= config.waves) {
      player.wavesCleared += 1;
      player.gameOver = true;
      logs.push('All waves cleared!');
      return logs;
    }
    setupNextWave(player, rng);
    logs.push(`Wave ${player.wave} started!`);
    return logs;
  }

  // 3. Alien Bomb movement & collisions
  const nextBombs: AlienBomb[] = [];
  for (const bomb of player.alienBombs) {
    bomb.y += 1;

    // Check bunker collision from above
    const hit = hitBunkerAt(player.bunkers, bomb.x, bomb.y);
    if (hit) {
      erodeBunker(hit.bunker, hit.lx, hit.ly, 'from_above');
      continue;
    }

    // Check player collision
    if (
      bomb.y === player.playerY &&
      bomb.x >= player.playerX &&
      bomb.x < player.playerX + PLAYER_WIDTH
    ) {
      if (player.respawnGraceTicks === 0) {
        player.lives -= 1;
        logs.push(`Player hit! Lives remaining: ${player.lives}`);
        if (player.lives <= 0) {
          player.gameOver = true;
          player.lives = 0;
          logs.push('GAME OVER');
        } else {
          player.respawnGraceTicks = RESPAWN_GRACE_TICKS;
          player.playerX = PLAYER_START_X;
          player.bullet = null;
          player.bullets = [];
        }
        continue;
      }
    }

    // Retain if inside playfield
    if (bomb.y < PLAYFIELD_H) {
      nextBombs.push(bomb);
    }
  }
  player.alienBombs = nextBombs;

  // 4. Alien Bomb firing
  player.fireTimer -= 1;
  if (player.fireTimer <= 0 && player.aliveCount > 0) {
    player.fireTimer = alienFireInterval(player.wave);
    const activeBombCols = new Set(player.alienBombs.map((b) => b.col));
    const eligibleCols: number[] = [];
    for (let col = 0; col < 11; col++) {
      if (!activeBombCols.has(col) && player.aliens.some((a) => a.col === col && a.alive)) {
        eligibleCols.push(col);
      }
    }

    if (eligibleCols.length > 0) {
      const chosenCol = eligibleCols[rng.int(eligibleCols.length)]!;
      let bottomAlien: Alien | null = null;
      for (const a of player.aliens) {
        if (a.col === chosenCol && a.alive) {
          if (!bottomAlien || a.row > bottomAlien.row) {
            bottomAlien = a;
          }
        }
      }
      if (bottomAlien) {
        player.alienBombs.push({
          id: player.nextBombId++,
          x: player.formationX + bottomAlien.col * ALIEN_COL_SPACING + 1,
          y: player.formationY + bottomAlien.row * ALIEN_ROW_SPACING + 1,
          col: chosenCol,
        });
      }
    }
  }

  // 5. Alien Formation march
  player.formationMoveCounter += 1;
  const interval = marchInterval(player.aliveCount, player.wave);
  if (player.formationMoveCounter >= interval) {
    player.formationMoveCounter = 0;
    const { minCol, maxCol, maxRow } = livingAlienCols(player.aliens);
    if (minCol <= maxCol) {
      const leftX = player.formationX + minCol * ALIEN_COL_SPACING;
      const rightX = player.formationX + maxCol * ALIEN_COL_SPACING + ALIEN_WIDTH - 1;
      let edgeReached = false;
      if (player.formationDir === 1 && rightX >= PLAYFIELD_W - 1) {
        edgeReached = true;
      } else if (player.formationDir === -1 && leftX <= 0) {
        edgeReached = true;
      }

      if (edgeReached) {
        player.formationDir = player.formationDir === 1 ? -1 : 1;
        player.formationY += 1;
      } else {
        player.formationX += player.formationDir;
      }

      // Check if alien row reaches ground / player
      const lowestY = player.formationY + maxRow * ALIEN_ROW_SPACING;
      if (lowestY >= player.playerY) {
        player.lives -= 1;
        logs.push(`Invaders reached ground! Lives remaining: ${player.lives}`);
        if (player.lives <= 0) {
          player.gameOver = true;
          player.lives = 0;
          logs.push('GAME OVER');
        } else {
          player.respawnGraceTicks = RESPAWN_GRACE_TICKS;
          player.playerX = PLAYER_START_X;
          player.formationY = Math.max(2, player.formationY - 3);
        }
      }
    }
  }

  // 6. Mystery UFO
  if (player.ufo && player.ufo.alive) {
    player.ufo.x += player.ufo.dir;
    if (
      (player.ufo.dir === 1 && player.ufo.x >= PLAYFIELD_W) ||
      (player.ufo.dir === -1 && player.ufo.x + UFO_WIDTH <= 0)
    ) {
      player.ufo = null;
    }
  } else {
    player.ufoSpawnTimer -= 1;
    if (player.ufoSpawnTimer <= 0) {
      const dir = rng.next() < 0.5 ? 1 : -1;
      player.ufo = {
        x: dir === 1 ? 0 : PLAYFIELD_W - UFO_WIDTH,
        y: UFO_Y,
        dir: dir as 1 | -1,
        points: 0,
        alive: true,
      };
      player.ufoSpawnTimer = nextUfoSpawnTimer(rng);
    }
  }

  return logs;
}

function reduce(
  prev: SpaceInvadersState,
  playerId: string,
  action: SpaceInvadersAction,
): ReduceResult<SpaceInvadersState> {
  const s = clone(prev);
  const player = playerById(s, playerId);
  if (!player) return { ok: false, error: 'Unknown player' };
  if (player.gameOver) return { ok: false, error: 'Game over' };

  const rng = rngFrom(s.rng);
  const logs: LogEntry[] = [];
  s.seq += 1;
  player.actionsSubmitted += 1;

  switch (action.type) {
    case 'move': {
      if (player.respawnGraceTicks > 0) {
        // Can't move while respawning
        break;
      }
      if (action.dir === 'left') {
        player.playerX = Math.max(0, player.playerX - PLAYER_SPEED);
      } else if (action.dir === 'right') {
        player.playerX = Math.min(PLAYFIELD_W - PLAYER_WIDTH, player.playerX + PLAYER_SPEED);
      }
      break;
    }
    case 'fire': {
      if (player.respawnGraceTicks > 0) {
        break;
      }
      const maxB = player.maxBullets ?? 1;
      const curBullets = player.bullets ?? (player.bullet ? [player.bullet] : []);
      if (player.fireCooldownTicks > 0 || curBullets.length >= maxB) {
        // Silently no-op: accepted, action consumed, no state change
        break;
      }
      const newBullet: Bullet = {
        x: player.playerX + 1,
        y: player.playerY - 1,
      };
      player.bullets = [...curBullets, newBullet];
      player.bullet = player.bullets[0] ?? null;
      player.fireCooldownTicks = 2;
      break;
    }
    case 'toggleAssist': {
      s.config.assist = !s.config.assist;
      break;
    }
    case 'tick': {
      const messages = tickPlayer(player, s.config, rng);
      for (const msg of messages) {
        logs.push(makeLog(msg, player.id));
      }
      break;
    }
    default:
      return { ok: false, error: 'Unknown action' };
  }

  player.actionsAccepted += 1;
  s.rng = rng.state();

  if (s.players.every((p) => p.gameOver)) {
    s.phase = 'game_over';
    const sorted = [...s.players].sort(
      (a, b) => b.score - a.score || b.wave - a.wave || a.seat - b.seat,
    );
    s.winner = sorted[0]?.id ?? null;
    logs.push(makeLog(`Game over — ${sorted[0]?.score ?? 0} pts wins`, null));
  }

  s.log.push(...stampLogs(s, logs));
  s.log = s.log.slice(-200);
  return { ok: true, state: s, log: logs };
}

function legalActions(s: SpaceInvadersState, playerId: string): string[] {
  const p = playerById(s, playerId);
  if (!p || p.gameOver || s.phase === 'game_over') return [];
  return ['move:left', 'move:right', 'fire', 'tick'];
}

function autoAction(_s: SpaceInvadersState, _playerId: string): SpaceInvadersAction {
  return { type: 'tick' };
}

function toPublic(p: SpaceInvadersPlayerState): SpaceInvadersPublicPlayer {
  return {
    id: p.id,
    seat: p.seat,
    score: p.score,
    lives: p.lives,
    wave: p.wave,
    playerX: p.playerX,
    playerY: p.playerY,
    bullet: p.bullets && p.bullets.length > 0 ? { ...p.bullets[0]! } : (p.bullet ? { ...p.bullet } : null),
    bullets: p.bullets ? p.bullets.map((b) => ({ ...b })) : (p.bullet ? [{ ...p.bullet }] : []),
    maxBullets: p.maxBullets ?? 1,
    alienBombs: p.alienBombs.map((b) => ({ ...b })),
    bunkers: p.bunkers.map((b) => ({ ...b, mask: [...b.mask] })),
    aliens: p.aliens.map((a) => ({ ...a })),
    formationX: p.formationX,
    formationY: p.formationY,
    formationDir: p.formationDir,
    aliveCount: p.aliveCount,
    ufo: p.ufo ? { ...p.ufo } : null,
    board: renderBoard(p),
    gameOver: p.gameOver,
    respawnGraceTicks: p.respawnGraceTicks,
  };
}

function view(s: SpaceInvadersState, playerId: string | null): SpaceInvadersView {
  const you = playerId ? (playerById(s, playerId) ? toPublic(playerById(s, playerId)!) : null) : null;
  return {
    phase: s.phase,
    winner: s.winner,
    you,
    players: s.players.map(toPublic),
    log: s.log.slice(-80),
    config: s.config,
    playfieldW: PLAYFIELD_W,
    playfieldH: PLAYFIELD_H,
  };
}

function score(s: SpaceInvadersState, playerId: string): ScoreInput {
  const p = playerById(s, playerId);
  if (!p) return { progress: 0, accuracy: 1, completed: false, completedAtMs: null, penalties: 0 };
  const targetWaves = s.config.waves ?? 5;
  const progress = Math.min(1, (p.wavesCleared + p.aliensKilled / ALIEN_COUNT) / targetWaves);
  const completed = s.phase === 'game_over' && !p.gameOver;
  const accuracy = p.actionsSubmitted === 0 ? 1 : p.actionsAccepted / p.actionsSubmitted;
  return {
    progress,
    accuracy,
    completed,
    completedAtMs: completed ? (s.winnerAtMs ?? null) : null,
    penalties: p.penalties,
    assetValue: p.score,
  };
}

function isOver(s: SpaceInvadersState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const spaceInvaders: GameEngine<SpaceInvadersState, SpaceInvadersAction> = {
  id: 'space-invaders' as never,
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
