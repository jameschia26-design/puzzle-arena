import { mulberry32, rngFrom, type LogEntry, type ScoreInput } from '@puzzle-arena/shared';
import type { GameEngine, ReduceResult } from '../engine.js';
import { makeLog, stampLogs } from '../engine.js';
import {
  ARENA_W,
  ARENA_H,
  type BombermanAction,
  type BombermanConfig,
  type BombermanPlayerState,
  type BombermanPublicPlayer,
  type BombermanState,
  type BombermanView,
  type BombState,
  type Dir,
  DIRS,
  DIR_VEC,
} from './state.js';
import {
  SPAWN_POINTS,
  buildArena,
  canStepTo,
  executeMoveStep,
  processDetonations,
} from './rules.js';

const DEFAULT_CONFIG: BombermanConfig = {
  tickMs: 60,
  softDensity: 65,
};

function playerById(s: BombermanState, id: string): BombermanPlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

function parseConfig(raw: unknown): BombermanConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CONFIG };
  const r = raw as Record<string, unknown>;
  const tickMs = typeof r['tickMs'] === 'number' && r['tickMs'] >= 20 && r['tickMs'] <= 200
    ? r['tickMs']
    : DEFAULT_CONFIG.tickMs;
  const softDensity = typeof r['softDensity'] === 'number' && r['softDensity'] >= 30 && r['softDensity'] <= 80
    ? r['softDensity']
    : DEFAULT_CONFIG.softDensity;
  return { tickMs, softDensity };
}

function setup(playerIds: string[], seed: number, rawConfig: unknown): BombermanState {
  const config = parseConfig(rawConfig);
  const rng = mulberry32(seed);

  const players: BombermanPlayerState[] = playerIds.map((id, seat) => {
    const sp = SPAWN_POINTS[seat % SPAWN_POINTS.length]!;
    return {
      id,
      seat,
      alive: true,
      x: sp.x,
      y: sp.y,
      blastRadius: 2, // 2 tiles each direction
      maxBombs: 1,
      activeBombs: 0,
      speed: 0,
      hasPass: false,
      bombsUnderPlayer: [],
      kills: 0,
      survivalTicks: 0,
      gameOver: false,
      powerupsCollected: { flame: 0, bomb: 0, speed: 0, pass: 0 },
      actionsSubmitted: 0,
      actionsAccepted: 0,
      penalties: 0,
    };
  });

  const { grid, hiddenPowerups } = buildArena(config, rng);

  const s: BombermanState = {
    rng: rng.state(),
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    grid,
    hiddenPowerups,
    visiblePowerups: [],
    bombs: [],
    blasts: [],
    players,
    phase: 'playing',
    log: [],
    winner: null,
    tickCount: 0,
    nextBombId: 1,
    graceTicksRemaining: 3,
  };

  s.log.push(...stampLogs(s, [makeLog('Bomberman battle begins')]));
  return s;
}

function reduce(
  prev: BombermanState,
  playerId: string,
  action: BombermanAction
): ReduceResult<BombermanState> {
  const s = structuredClone(prev);
  const player = playerById(s, playerId);
  if (!player) return { ok: false, error: 'Unknown player' };
  if (s.phase === 'game_over') return { ok: false, error: 'Game is over' };

  s.seq += 1;
  player.actionsSubmitted += 1;
  const logs: LogEntry[] = [];

  switch (action.type) {
    case 'move': {
      if (!player.alive) return { ok: false, error: 'Player is eliminated' };
      const dir = action.dir;
      if (!DIRS.includes(dir)) return { ok: false, error: 'Bad dir' };

      // Step 1
      const moved1 = executeMoveStep(s, player, dir);
      if (!moved1) {
        player.penalties += 1;
        return { ok: false, error: 'Blocked' };
      }

      // If player moves into active fire, eliminate immediately
      if (s.graceTicksRemaining === 0 && s.blasts.some((b) => b.x === player.x && b.y === player.y)) {
        player.alive = false;
        player.gameOver = true;
        logs.push(makeLog('ELIMINATED', player.id));
      }
      break;
    }

    case 'bomb': {
      if (!player.alive) return { ok: false, error: 'Player is eliminated' };
      if (player.activeBombs >= player.maxBombs) {
        player.penalties += 1;
        return { ok: false, error: 'Max bombs placed' };
      }
      if (s.bombs.some((b) => b.x === player.x && b.y === player.y)) {
        player.penalties += 1;
        return { ok: false, error: 'Bomb already here' };
      }

      const bombId = s.nextBombId++;
      const newBomb: BombState = {
        id: bombId,
        ownerId: player.id,
        x: player.x,
        y: player.y,
        fuse: 30,
        radius: player.blastRadius,
      };
      s.bombs.push(newBomb);
      player.activeBombs += 1;
      player.bombsUnderPlayer.push(bombId);
      logs.push(makeLog('Bomb placed', player.id));
      break;
    }

    case 'tick': {
      s.tickCount += 1;

      // 1. Decrement grace ticks if any
      if (s.graceTicksRemaining > 0) {
        s.graceTicksRemaining -= 1;
      }

      // 2. Decrement active blasts
      for (const blast of s.blasts) {
        blast.ticksRemaining -= 1;
      }
      s.blasts = s.blasts.filter((b) => b.ticksRemaining > 0);

      // 3. Decrement bomb fuses
      for (const bomb of s.bombs) {
        if (bomb.fuse > 0) {
          bomb.fuse -= 1;
        }
      }

      // 4. Determine which bombs are ready to detonate
      // Protection rule: a bomb placed under you cannot detonate while you stand on it until you leave
      const readyBombs = s.bombs.filter((b) => {
        if (b.fuse > 0) return false;
        const ownerStanding = s.players.some(
          (p) => p.id === b.ownerId && p.x === b.x && p.y === b.y && p.bombsUnderPlayer.includes(b.id)
        );
        return !ownerStanding;
      });

      // 5. Process detonations
      if (readyBombs.length > 0) {
        const { eliminatedPlayerIds } = processDetonations(s, readyBombs);
        for (const pid of eliminatedPlayerIds) {
          logs.push(makeLog('ELIMINATED', pid));
        }
      }
      // 5b. Check player damage from all active blasts on every tick
      if (s.graceTicksRemaining === 0 && s.blasts.length > 0) {
        for (const p of s.players) {
          if (!p.alive) continue;
          const hit = s.blasts.find((b) => b.x === p.x && b.y === p.y);
          if (hit) {
            p.alive = false;
            p.gameOver = true;
            logs.push(makeLog('ELIMINATED', p.id));
            if (hit.ownerId && hit.ownerId !== p.id) {
              const killer = s.players.find((pl) => pl.id === hit.ownerId);
              if (killer) killer.kills += 1;
            }
          }
        }
      }

      // 6. Advance survival ticks for alive players
      for (const p of s.players) {
        if (p.alive) {
          p.survivalTicks += 1;
        }
      }

      // 7. Check win / game over condition
      if (s.players.length >= 2) {
        const alive = s.players.filter((p) => p.alive);
        if (alive.length === 1) {
          s.phase = 'game_over';
          s.winner = alive[0]!.id;
          logs.push(makeLog(`Player ${alive[0]!.id} wins`, alive[0]!.id));
        } else if (alive.length === 0) {
          s.phase = 'game_over';
          s.winner = null; // Draw
          logs.push(makeLog('Mutual elimination — Draw', null));
        }
      } else if (s.players.length === 1) {
        if (!s.players[0]!.alive) {
          s.phase = 'game_over';
          s.winner = null;
        }
      }
      break;
    }

    default:
      return { ok: false, error: 'Unknown action' };
  }

  player.actionsAccepted += 1;

  if (logs.length > 0) {
    s.log.push(...stampLogs(s, logs));
    s.log = s.log.slice(-200);
  }

  return { ok: true, state: s, log: logs };
}

function autoAction(_s: BombermanState, _playerId: string): BombermanAction {
  return { type: 'tick' };
}

function toPublic(p: BombermanPlayerState): BombermanPublicPlayer {
  return {
    id: p.id,
    seat: p.seat,
    alive: p.alive,
    x: p.x,
    y: p.y,
    blastRadius: p.blastRadius,
    maxBombs: p.maxBombs,
    activeBombs: p.activeBombs,
    speed: p.speed,
    hasPass: p.hasPass,
    kills: p.kills,
    gameOver: p.gameOver,
  };
}

function view(s: BombermanState, playerId: string | null): BombermanView {
  const you = playerId
    ? (() => {
        const p = playerById(s, playerId);
        return p ? toPublic(p) : null;
      })()
    : null;

  return {
    phase: s.phase,
    winner: s.winner,
    you,
    players: s.players.map(toPublic),
    grid: [...s.grid], // arena mask without hidden powerups
    visiblePowerups: s.visiblePowerups.map((p) => ({ ...p })),
    bombs: s.bombs.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      x: b.x,
      y: b.y,
      fuse: b.fuse,
      radius: b.radius,
    })),
    blasts: s.blasts.map((b) => ({
      x: b.x,
      y: b.y,
      ticksRemaining: b.ticksRemaining,
    })),
    log: s.log.slice(-80),
    config: s.config,
    arenaW: ARENA_W,
    arenaH: ARENA_H,
    tickCount: s.tickCount,
    graceTicksRemaining: s.graceTicksRemaining,
  };
}

function score(s: BombermanState, playerId: string): ScoreInput {
  const p = playerById(s, playerId);
  if (!p) {
    return {
      progress: 0,
      accuracy: 1,
      completed: false,
      completedAtMs: null,
      penalties: 0,
    };
  }

  const powerupScore =
    p.powerupsCollected.flame * 100 +
    p.powerupsCollected.bomb * 100 +
    p.powerupsCollected.speed * 100 +
    p.powerupsCollected.pass * 150;
  const survivalBonus = Math.round(p.survivalTicks / 50);
  const assetValue = p.kills * 1000 + powerupScore + survivalBonus;
  const progress = Math.min(1, p.survivalTicks / 3000);
  const accuracy = p.actionsSubmitted === 0 ? 1 : p.actionsAccepted / p.actionsSubmitted;
  const completed = p.alive;

  return {
    progress,
    accuracy,
    completed,
    completedAtMs: s.phase === 'game_over' && s.winner === playerId ? (s.winnerAtMs ?? null) : null,
    penalties: p.penalties,
    assetValue,
  };
}

function isOver(s: BombermanState): { over: boolean; winner?: string } {
  if (s.phase === 'game_over') {
    return s.winner ? { over: true, winner: s.winner } : { over: true };
  }
  const remaining = s.players.filter((p) => p.alive && !p.gameOver);
  if (s.players.length >= 2 && remaining.length <= 1) {
    const winner = s.winner ?? remaining[0]?.id;
    return winner !== undefined ? { over: true, winner } : { over: true };
  }
  if (remaining.length === 0) {
    return { over: true };
  }
  return { over: false };
}

function legalActions(s: BombermanState, playerId: string): string[] {
  const p = playerById(s, playerId);
  if (!p || !p.alive || s.phase === 'game_over') return [];

  const actions: string[] = ['tick'];

  for (const d of DIRS) {
    const nx = p.x + DIR_VEC[d].dx;
    const ny = p.y + DIR_VEC[d].dy;
    if (canStepTo(s, p, nx, ny)) {
      actions.push(`move:${d}`);
    }
  }

  if (p.activeBombs < p.maxBombs && !s.bombs.some((b) => b.x === p.x && b.y === p.y)) {
    actions.push('bomb');
  }

  return actions;
}

export const bomberman: GameEngine<BombermanState, BombermanAction> = {
  id: 'bomberman' as never,
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};

export * from './state.js';
export * from './rules.js';
