import { mulberry32, rngFrom, type ScoreInput } from '@puzzle-arena/shared';
import type { GameEngine, ReduceResult } from '../engine.js';
import { makeLog, stampLogs } from '../engine.js';
import {
  MAZE_W, MAZE_H, DIRS, type Dir, type GhostState, type PacManPlayerState, type PacManState, type PacManAction, type PacManConfig, type PacManView, type PacManPublicPlayer,
} from './state.js';
import {
  buildMaze, countPellets, canMovePac, canMoveGhost, nextPos, SCATTER_TARGETS, GHOST_HOUSE, FRUIT_POS, PAC_SPAWN, chooseGhostDir, ghostTarget, manhattan, fruitForLevel, frightTicksForLevel, ghostReviveTicks, MODE_CYCLE, pelletScore, ghostScore, TILE_DOT, TILE_PELLET, TUNNEL_Y, isDoor, isWall,
} from './rules.js';

const DEFAULT_CONFIG: PacManConfig = { turnTimeLimitSec: 90, startLevel: 1 };

function clone(s: PacManState): PacManState { return structuredClone(s); }

function initialGhosts(): GhostState[] {
  return [
    { id: 0, pos: { x: 14, y: 11 }, dir: 'left', mode: 'scatter', frightTicks: 0, eaten: false, target: { ...SCATTER_TARGETS[0]! }, scatterTarget: { ...SCATTER_TARGETS[0]! }, houseTicks: 0, moveCounter: 0, inHouse: false },
    { id: 1, pos: { x: 14, y: 14 }, dir: 'down', mode: 'scatter', frightTicks: 0, eaten: false, target: { ...SCATTER_TARGETS[1]! }, scatterTarget: { ...SCATTER_TARGETS[1]! }, houseTicks: 10, moveCounter: 0, inHouse: true },
    { id: 2, pos: { x: 12, y: 14 }, dir: 'up', mode: 'scatter', frightTicks: 0, eaten: false, target: { ...SCATTER_TARGETS[2]! }, scatterTarget: { ...SCATTER_TARGETS[2]! }, houseTicks: 30, moveCounter: 0, inHouse: true },
    { id: 3, pos: { x: 16, y: 14 }, dir: 'up', mode: 'scatter', frightTicks: 0, eaten: false, target: { ...SCATTER_TARGETS[3]! }, scatterTarget: { ...SCATTER_TARGETS[3]! }, houseTicks: 50, moveCounter: 0, inHouse: true },
  ];
}

function makePlayer(id: string, seat: number, level: number): PacManPlayerState {
  const maze = buildMaze();
  const { dots, pellets } = countPellets(maze);
  return {
    id, seat,
    maze,
    dotsRemaining: dots + pellets,
    score: 0,
    lives: 3,
    level,
    pacPos: { ...PAC_SPAWN },
    pacDir: 'left',
    nextDir: 'left',
    ghosts: initialGhosts(),
    ghostStreak: 0,
    globalMode: 'scatter',
    globalModeTicks: MODE_CYCLE[0]!.ticks,
    globalPhase: 0,
    frightTicks: 0,
    ghostMoveCounter: 0,
    pacMoveCounter: 0,
    fruit: null,
    dotsEatenThisLevel: 0,
    fruitSpawnedCount: 0,
    dyingTicks: 0,
    levelClearTicks: 0,
    extraLifeGiven: false,
    gameOver: false,
    totalDotsEaten: 0,
    pelletsEaten: 0,
    ghostsEatenTotal: 0,
    fruitsEaten: 0,
    actionsSubmitted: 0,
    actionsAccepted: 0,
    penalties: 0,
  };
}

function setup(playerIds: string[], seed: number, rawConfig: unknown): PacManState {
  let cfg: PacManConfig = { ...DEFAULT_CONFIG };
  try {
    const parsed = rawConfig as Partial<PacManConfig>;
    if (parsed && typeof parsed.startLevel === 'number') cfg.startLevel = Math.max(1, Math.min(21, Math.floor(parsed.startLevel)));
    if (parsed && typeof parsed.turnTimeLimitSec === 'number') cfg.turnTimeLimitSec = parsed.turnTimeLimitSec;
  } catch { /* keep defaults */ }
  const players = playerIds.map((id, i) => makePlayer(id, i, cfg.startLevel));
  return {
    rng: { seed, calls: 0 },
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config: cfg,
    players,
    phase: 'playing',
    log: [],
    winner: null,
  };
}

function playerById(s: PacManState, id: string): PacManPlayerState | undefined {
  return s.players.find(p => p.id === id);
}

// Reset player for next level (keep score/lives, bump level, reset maze & positions)
function nextLevel(player: PacManPlayerState): void {
  player.level = Math.min(21, player.level + 1);
  const maze = buildMaze();
  const { dots, pellets } = countPellets(maze);
  player.maze = maze;
  player.dotsRemaining = dots + pellets;
  player.pacPos = { ...PAC_SPAWN };
  player.pacDir = 'left';
  player.nextDir = 'left';
  player.ghosts = initialGhosts();
  player.ghostStreak = 0;
  player.globalMode = 'scatter';
  player.globalPhase = 0;
  player.globalModeTicks = MODE_CYCLE[0]!.ticks;
  player.frightTicks = 0;
  player.ghostMoveCounter = 0;
  player.pacMoveCounter = 0;
  player.fruit = null;
  player.dotsEatenThisLevel = 0;
  player.fruitSpawnedCount = 0;
  player.dyingTicks = 0;
  player.levelClearTicks = 0;
  for (const g of player.ghosts) { g.mode = 'scatter'; g.frightTicks = 0; g.eaten = false; }
}

// Core tick: advance one player's simulation.
// Returns logs for this tick.
function tickPlayer(player: PacManPlayerState, rng: ReturnType<typeof mulberry32>): string[] {
  const logs: string[] = [];
  if (player.gameOver) return logs;
  if (player.dyingTicks > 0) {
    player.dyingTicks -= 1;
    if (player.dyingTicks === 0) {
      if (player.lives <= 0) {
        player.gameOver = true;
        logs.push(`Game over`);
      } else {
        // respawn
        player.pacPos = { ...PAC_SPAWN };
        player.pacDir = 'left';
        player.nextDir = 'left';
        player.ghosts = initialGhosts();
        player.ghostStreak = 0;
        player.frightTicks = 0;
        player.fruit = null;
        for (const g of player.ghosts) { g.frightTicks = 0; g.mode = 'scatter'; g.eaten = false; }
        logs.push(`Life lost — ${player.lives} left`);
      }
    }
    return logs;
  }
  if (player.levelClearTicks > 0) {
    player.levelClearTicks -= 1;
    if (player.levelClearTicks === 0) {
      nextLevel(player);
      logs.push(`Level ${player.level} start`);
    }
    return logs;
  }

  // global scatter/chase timer (only when not frightened)
  if (player.frightTicks > 0) {
    player.frightTicks -= 1;
    for (const g of player.ghosts) {
      if (g.frightTicks > 0) g.frightTicks = player.frightTicks;
    }
    if (player.frightTicks === 0) {
      // fright ends: reset ghosts not eaten
      player.ghostStreak = 0;
      for (const g of player.ghosts) {
        if (!g.eaten) {
          g.mode = player.globalMode;
          g.frightTicks = 0;
        }
      }
      logs.push('Fright ended');
    }
  } else {
    if (player.globalModeTicks > 0) {
      player.globalModeTicks -= 1;
      if (player.globalModeTicks === 0) {
        const nextPhase = Math.min(player.globalPhase + 1, MODE_CYCLE.length - 1);
        player.globalPhase = nextPhase;
        const entry = MODE_CYCLE[nextPhase]!;
        player.globalMode = entry.mode;
        player.globalModeTicks = entry.ticks;
        // update ghost modes (except eaten/frightened)
        for (const g of player.ghosts) {
          if (!g.eaten && g.frightTicks === 0) g.mode = entry.mode;
        }
        // ghosts reverse on mode change (authentic)
        for (const g of player.ghosts) {
          if (!g.inHouse && !g.eaten && g.frightTicks === 0) {
            // reverse dir if possible
            const rev = g.dir === 'up' ? 'down' : g.dir === 'down' ? 'up' : g.dir === 'left' ? 'right' : 'left';
            if (canMoveGhost(player.maze, g.pos.x, g.pos.y, rev, { canUseDoor: g.eaten || g.inHouse })) {
              g.dir = rev;
            }
          }
        }
      }
    }
  }

  // fruit timer
  if (player.fruit) {
    player.fruit.ticksLeft -= 1;
    if (player.fruit.ticksLeft <= 0) player.fruit = null;
  }

  // spawn fruit at 70 and 170 dots
  if (player.fruit === null && player.fruitSpawnedCount < 2) {
    const thresh = player.fruitSpawnedCount === 0 ? 70 : 170;
    if (player.dotsEatenThisLevel >= thresh) {
      const f = fruitForLevel(player.level);
      player.fruit = { pos: { ...FRUIT_POS }, kind: f.kind, points: f.points, ticksLeft: 70 }; // ~10s
      player.fruitSpawnedCount += 1;
      logs.push(`Fruit ${f.kind} appeared`);
    }
  }

  // --- Early collision (before Pac movement) ---
  // Handles deterministic eat when Pac and a frightened ghost start overlapped.
  // Late check after movement handles Pac moving onto ghost and ghost moving onto Pac.
  for (const g of player.ghosts) {
    if (g.pos.x === player.pacPos.x && g.pos.y === player.pacPos.y) {
      if (g.eaten) continue;
      if (g.mode === 'frightened') {
        const pts = ghostScore(player.ghostStreak);
        player.score += pts;
        player.ghostsEatenTotal += 1;
        player.ghostStreak = Math.min(3, player.ghostStreak + 1);
        g.eaten = true;
        g.mode = 'eaten';
        g.frightTicks = 0;
        logs.push(`Ate ${['Blinky','Pinky','Inky','Clyde'][g.id]} ${pts}`);
      } else {
        // Pac collided with a non-frightened ghost at tick start — dies immediately.
        player.lives -= 1;
        if (player.lives <= 0) {
          player.dyingTicks = 30;
          logs.push('Pac-Man died — game over');
        } else {
          player.dyingTicks = 20;
          logs.push(`Pac-Man died — ${player.lives} lives left`);
        }
        return logs;
      }
    }
  }

  const pacPrev = { ...player.pacPos };
  // Pac-Man movement: try nextDir first (buffered turn)
  const tryDir = (dir: Dir): boolean => canMovePac(player.maze, player.pacPos.x, player.pacPos.y, dir);
  if (player.nextDir !== player.pacDir && tryDir(player.nextDir)) {
    player.pacDir = player.nextDir;
  }
  // move pac if possible
  if (tryDir(player.pacDir)) {
    const np = nextPos(player.pacPos.x, player.pacPos.y, player.pacDir);
    player.pacPos = np;
  }
  // check pellet consumption at new pos
  const pIdx = player.pacPos.y * MAZE_W + player.pacPos.x;
  const tile = player.maze[pIdx]!;
  if (tile === TILE_DOT || tile === TILE_PELLET) {
    const isPower = tile === TILE_PELLET;
    player.maze[pIdx] = 0; // empty
    player.dotsRemaining -= 1;
    player.dotsEatenThisLevel += 1;
    player.totalDotsEaten += 1;
    player.pelletsEaten += 1;
    const pts = pelletScore(isPower);
    player.score += pts;
    if (isPower) {
      const ft = frightTicksForLevel(player.level);
      if (ft > 0) {
        player.frightTicks = ft;
        player.ghostStreak = 0;
        for (const g of player.ghosts) {
          if (!g.eaten) {
            g.mode = 'frightened';
            g.frightTicks = ft;
            if (!g.inHouse) {
              // reverse
              const rev = g.dir === 'up' ? 'down' : g.dir === 'down' ? 'up' : g.dir === 'left' ? 'right' : 'left';
              if (canMoveGhost(player.maze, g.pos.x, g.pos.y, rev, { canUseDoor: false })) g.dir = rev;
            }
          }
        }
        logs.push('Power pellet!');
      }
    }
    // check level clear
    if (player.dotsRemaining <= 0) {
      player.score += 1000; // level bonus? authenticate: not standard but give
      player.levelClearTicks = 20; // pause ~3s before next maze
      logs.push(`Level ${player.level} cleared!`);
      // extra handling in outer tick will transition
    }
  }
  // fruit eaten?
  if (player.fruit && player.pacPos.x === player.fruit.pos.x && player.pacPos.y === player.fruit.pos.y) {
    player.score += player.fruit.points;
    player.fruitsEaten += 1;
    logs.push(`Ate ${player.fruit.kind} ${player.fruit.points}`);
    player.fruit = null;
  }

  // Extra life at 10000 points (single)
  if (!player.extraLifeGiven && player.score >= 10000) {
    player.lives += 1;
    player.extraLifeGiven = true;
    logs.push('Extra life!');
  }

  // Ghost movement
  const ghostPrev = player.ghosts.map(g => ({ ...g.pos }));
  for (const g of player.ghosts) {
    // house exit logic
    if (g.inHouse) {
      if (g.houseTicks > 0) {
        g.houseTicks -= 1;
        // jiggle inside house (simple up/down)
        if (g.houseTicks % 2 === 0) {
          const dirs: Dir[] = ['up', 'down'];
          const curIdx = dirs.indexOf(g.dir);
          g.dir = curIdx === -1 ? 'up' : (dirs[(curIdx + 1) % 2] as Dir);
          const np = nextPos(g.pos.x, g.pos.y, g.dir);
          if (np.y >= 13 && np.y <= 15 && np.x >= 11 && np.x <= 16 && !isWall(player.maze, np.x, np.y)) {
            g.pos = np;
          }
        }
        continue; // stay inside until timer
      } else {
        // exit house: move to door
        g.inHouse = false;
        g.eaten = false;
        g.houseTicks = 0;
        g.pos = { x: GHOST_HOUSE.x, y: 11 }; // just above door
        g.dir = 'left';
        g.mode = player.frightTicks > 0 ? 'frightened' : player.globalMode;
        g.frightTicks = player.frightTicks > 0 ? player.frightTicks : 0;
        continue;
      }
    }

    // speed gating: eaten fast, frightened/tunnel slow
    const inTunnel = g.pos.y === TUNNEL_Y && (g.pos.x <= 2 || g.pos.x >= 25);
    // frightened ghosts move every 2 ticks (use moveCounter)
    const shouldMove = (() => {
      if (g.eaten) return true;
      if (g.mode === 'frightened' || inTunnel) {
        g.moveCounter = (g.moveCounter + 1) % 2;
        return g.moveCounter === 0;
      }
      return true;
    })();
    if (!shouldMove) continue;

    // choose next dir
    if (g.eaten) {
      // head to house
      const target = { ...GHOST_HOUSE };
      const canUseDoor = true;
      const isAtDoor = isDoor(player.maze, g.pos.x, g.pos.y);
      const isInsideHouse = g.pos.x >= 11 && g.pos.x <= 16 && g.pos.y >= 13 && g.pos.y <= 15;
      // if at door or inside house, enter house and revive
      if (isAtDoor || isInsideHouse || (g.pos.x === GHOST_HOUSE.x && g.pos.y === GHOST_HOUSE.y)) {
        g.pos = { x: 14, y: 14 };
        g.eaten = false;
        g.mode = player.frightTicks > 0 ? 'frightened' : player.globalMode;
        g.frightTicks = player.frightTicks > 0 ? player.frightTicks : 0;
        g.inHouse = true;
        g.houseTicks = ghostReviveTicks(player.level);
        continue;
      }
      const nd = chooseGhostDir(player.maze, g.pos, g.dir, target, canUseDoor);
      g.dir = nd;
      const np = nextPos(g.pos.x, g.pos.y, nd);
      g.pos = np;
      if (isDoor(player.maze, g.pos.x, g.pos.y) || (g.pos.x >= 11 && g.pos.x <= 16 && g.pos.y >= 13 && g.pos.y <= 15)) {
        g.pos = { x: 14, y: 14 };
        g.eaten = false;
        g.mode = player.frightTicks > 0 ? 'frightened' : player.globalMode;
        g.frightTicks = player.frightTicks > 0 ? player.frightTicks : 0;
        g.inHouse = true;
        g.houseTicks = ghostReviveTicks(player.level);
      }
    } else if (g.mode === 'frightened') {
      // random valid (not reverse preferred but allow)
      const avail = DIRS.filter(d => canMoveGhost(player.maze, g.pos.x, g.pos.y, d, { canUseDoor: false }));
      // prefer not reverse
      const rev = g.dir === 'up' ? 'down' : g.dir === 'down' ? 'up' : g.dir === 'left' ? 'right' : 'left';
      let choices = avail.filter(d => d !== rev);
      if (choices.length === 0) choices = avail;
      if (choices.length > 0) {
        const pick = choices[rng.int(choices.length)]!;
        g.dir = pick;
        g.pos = nextPos(g.pos.x, g.pos.y, pick);
      }
    } else {
      // scatter/chase
      let target: { x: number; y: number };
      if (g.mode === 'scatter') {
        target = g.scatterTarget;
      } else {
        // chase per ghost
        const blinkyPos = player.ghosts[0]!.pos;
        target = ghostTarget(g.id, g.pos, player.pacPos, player.pacDir, blinkyPos, 'chase', g.scatterTarget);
      }
      const nd = chooseGhostDir(player.maze, g.pos, g.dir, target, false);
      g.dir = nd;
      g.pos = nextPos(g.pos.x, g.pos.y, nd);
    }
  }

  // Collision checks after movement
  for (let gi = 0; gi < player.ghosts.length; gi++) {
    const g = player.ghosts[gi]!;
    const prev = ghostPrev[gi]!;
    const isOverlap = g.pos.x === player.pacPos.x && g.pos.y === player.pacPos.y;
    const isSwap = g.pos.x === pacPrev.x && g.pos.y === pacPrev.y && prev.x === player.pacPos.x && prev.y === player.pacPos.y;
    if (isOverlap || isSwap) {
      if (g.eaten) {
        // already eaten eyes, ignore
        continue;
      }
      if (g.mode === 'frightened') {
        // eat ghost
        const pts = ghostScore(player.ghostStreak);
        player.score += pts;
        player.ghostsEatenTotal += 1;
        player.ghostStreak = Math.min(3, player.ghostStreak + 1);
        g.eaten = true;
        g.mode = 'eaten';
        g.frightTicks = 0;
        // eyes return fast
        logs.push(`Ate ${['Blinky','Pinky','Inky','Clyde'][g.id]} ${pts}`);
      } else {
        // pac dies
        player.lives -= 1;
        if (player.lives <= 0) {
          // will handle gameOver after dyingTicks
          player.dyingTicks = 30;
          logs.push('Pac-Man died — game over');
        } else {
          player.dyingTicks = 20;
          logs.push(`Pac-Man died — ${player.lives} lives left`);
        }
        break; // stop checking further colls this tick
      }
    }
  }

  return logs;
}

function reduce(prev: PacManState, playerId: string, action: PacManAction): ReduceResult<PacManState> {
  const s = clone(prev);
  const player = playerById(s, playerId);
  if (!player) return { ok: false, error: 'Unknown player' };
  if (player.gameOver) return { ok: false, error: 'Game over' };
  const rng = rngFrom(s.rng);
  const logs: ReturnType<typeof makeLog>[] = [];
  s.seq += 1;
  player.actionsSubmitted += 1;

  switch (action.type) {
    case 'dir': {
      const d = action.dir;
      if (!['up','down','left','right'].includes(d)) return { ok: false, error: 'Bad dir' };
      player.nextDir = d as Dir;
      break;
    }
    case 'tick': {
      // advance this player's simulation by one tick
      const texts = tickPlayer(player, rng);
      for (const t of texts) logs.push(makeLog(t, player.id));
      break;
    }
    default: return { ok: false, error: 'Unknown action' };
  }

  player.actionsAccepted += 1;
  s.rng = rng.state();

  // check global over: all players game over
  if (s.players.every(p => p.gameOver)) {
    s.phase = 'game_over';
    // winner highest score tie lives/level/seat
    const sorted = [...s.players].sort((a,b) => b.score - a.score || b.level - a.level || a.seat - b.seat);
    s.winner = sorted[0]?.id ?? null;
    logs.push(makeLog(`Game over — ${sorted[0]?.score ?? 0} pts wins`, null));
  }

  s.log.push(...stampLogs(s, logs));
  s.log = s.log.slice(-200);
  return { ok: true, state: s, log: logs };
}

function legalActions(s: PacManState, playerId: string): string[] {
  const p = playerById(s, playerId);
  if (!p || p.gameOver || s.phase === 'game_over') return [];
  return ['dir:up', 'dir:down', 'dir:left', 'dir:right', 'tick'];
}
function autoAction(_s: PacManState, _playerId: string): PacManAction { return { type: 'tick' }; }

function toPublic(p: PacManPlayerState): PacManPublicPlayer {
  return {
    id: p.id, seat: p.seat, score: p.score, lives: p.lives, level: p.level,
    pacPos: { ...p.pacPos }, pacDir: p.pacDir, nextDir: p.nextDir,
    ghosts: p.ghosts.map(g => ({ ...g, pos: { ...g.pos }, target: { ...g.target }, scatterTarget: { ...g.scatterTarget } })),
    fruit: p.fruit ? { ...p.fruit, pos: { ...p.fruit.pos } } : null,
    maze: [...p.maze],
    dotsRemaining: p.dotsRemaining,
    gameOver: p.gameOver,
    dyingTicks: p.dyingTicks,
    levelClearTicks: p.levelClearTicks,
  };
}

function view(s: PacManState, playerId: string | null): PacManView {
  const you = playerId ? playerById(s, playerId) ? toPublic(playerById(s, playerId)!) : null : null;
  return {
    phase: s.phase,
    winner: s.winner,
    you,
    players: s.players.map(toPublic),
    log: s.log.slice(-80),
    config: s.config,
    mazeW: MAZE_W,
    mazeH: MAZE_H,
  };
}

function score(s: PacManState, playerId: string): ScoreInput {
  const p = playerById(s, playerId);
  if (!p) return { progress: 0, accuracy: 1, completed: false, completedAtMs: null, penalties: 0 };
  // Progress: fraction of total possible score? Use dots ratio + levels
  // For leaderboard, use raw score as assetValue like tetris, but also compute progress for display.
  // progress = totalDotsEaten / (240 * levels cleared + remaining?) approximate 1 when highest level reached.
  // Simpler: progress = min(1, (p.level -1 + (1 - p.dotsRemaining/244))/21 )
  const levelProg = Math.min(1, (p.level - 1 + (1 - p.dotsRemaining / 244)) / 21);
  const completed = s.phase === 'game_over' && s.winner === playerId;
  const accuracy = p.actionsSubmitted === 0 ? 1 : p.actionsAccepted / p.actionsSubmitted;
  return {
    progress: levelProg,
    accuracy,
    completed,
    completedAtMs: completed ? (s.winnerAtMs ?? null) : null,
    penalties: p.penalties,
    assetValue: p.score,
  };
}

function isOver(s: PacManState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const pacman: GameEngine<PacManState, PacManAction> = {
  id: 'pacman' as never,
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
