/**
 * Tetris — concurrent per-player engine.
 *
 * Each room holds N independent Tetris boards under one shared GameState.
 * Players act concurrently (no turns). The reducer dispatches every action
 * to the acting player's sub-state only, keeping the room's single-engine
 * invariant intact without requiring runtime changes for per-player states.
 *
 * Placed in packages/games (not puzzles) because Tetris needs a deterministic
 * reducer with 7-bag RNG, SRS kicks, gravity ticks, and lock delay — all of
 * which the GameEngine contract provides, while the puzzle generate/grade/hint
 * scaffolding does not apply.
 */
import type { LogEntry, ScoreInput } from '@puzzle-arena/shared';
import { mulberry32, rngFrom } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  BOARD_W,
  BOARD_H,
  ghostY,
  tryMove,
  tryRotate,
  lockPiece,
  clearLines,
  isTSpin,
  lineClearScore,
  tSpinScore,
  newBag,
  spawnTetromino,
  spawnCollides,
  idx,
  collides,
} from './rules.js';
import type {
  TetrisState,
  TetrisConfig,
  TetrisAction,
  TetrisView,
  TetrisPublicPlayer,
  TetrominoKind,
} from './state.js';

export * from './state.js';
export * from './rules.js';

const DEFAULT_CONFIG: TetrisConfig = { turnTimeLimitSec: 90, startLevel: 1, assist: true };

function clone(s: TetrisState): TetrisState {
  return structuredClone(s);
}

function fillQueue(player: TetrisState['players'][number], rng: ReturnType<typeof mulberry32>): void {
  while (player.next.length < 5) {
    if (player.bag.length === 0) player.bag = newBag(rng);
    const k = player.bag.shift()!;
    player.next.push(k);
  }
  while (player.bag.length === 0) player.bag = newBag(rng);
}

function pullNext(player: TetrisState['players'][number], rng: ReturnType<typeof mulberry32>): TetrominoKind {
  if (player.next.length === 0) fillQueue(player, rng);
  const k = player.next.shift()!;
  fillQueue(player, rng);
  return k;
}

function setup(playerIds: string[], seed: number, rawConfig: unknown): TetrisState {
  const cfg = { ...DEFAULT_CONFIG, ...((rawConfig as Partial<TetrisConfig>) ?? {}) };
  const rng = mulberry32(seed);
  const players = playerIds.map((id, i) => {
    const bag = newBag(rng);
    const next: TetrominoKind[] = [];
    while (next.length < 5) {
      if (bag.length === 0) bag.push(...newBag(rng));
      next.push(bag.shift()!);
    }
    if (bag.length === 0) bag.push(...newBag(rng));
    const firstKind = next.shift()!;
    fillQueue({ bag, next } as never, rng);
    const active = spawnTetromino(firstKind);
    return {
      id,
      seat: i,
      board: Array(BOARD_W * BOARD_H).fill(null),
      active,
      hold: null,
      canHold: true,
      bag,
      next,
      score: 0,
      lines: 0,
      level: Math.max(1, cfg.startLevel),
      combo: -1,
      backToBack: false,
      gameOver: false,
      lockTicks: 0,
      lockResets: 0,
      lowestY: active.y,
      softDropCells: 0,
      lastWasRotate: false,
      actionsSubmitted: 0,
      actionsAccepted: 0,
      penalties: 0,
    };
  });

  // Re-fill next after consuming first piece correctly
  // Already done via fillQueue above

  return {
    rng: rng.state(),
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

function playerById(s: TetrisState, id: string) {
  return s.players.find((p) => p.id === id);
}

function doLock(
  s: TetrisState,
  player: TetrisState['players'][number],
  rng: ReturnType<typeof mulberry32>,
): void {
  if (!player.active) return;
  const active = player.active;
  // Check T-spin before locking
  const tSpin = isTSpin(player.board, active, player.lastWasRotate);
  let newBoard = lockPiece(player.board, active);
  const { board: clearedBoard, cleared } = clearLines(newBoard);
  newBoard = clearedBoard;
  player.board = newBoard;

  let add = 0;
  const isDifficult = cleared === 4 || (tSpin && cleared > 0);
  if (tSpin) {
    add = tSpinScore(cleared, player.level);
    // back-to-back bonus
    if (isDifficult && player.backToBack) add = Math.floor(add * 1.5);
  } else if (cleared > 0) {
    add = lineClearScore(cleared, player.level);
    if (isDifficult && player.backToBack) add = Math.floor(add * 1.5);
  }

  // soft drop bonus (1 per cell already counted incrementally, hard drop counted there)
  // combo
  if (cleared > 0) {
    player.combo = player.combo === -1 ? 0 : player.combo + 1;
    if (player.combo > 0) add += 50 * player.combo * player.level;
    player.backToBack = isDifficult ? true : player.backToBack;
    if (!isDifficult) player.backToBack = false;
    // level progression: 15 lines per level
    player.lines += cleared;
    const newLevel = Math.floor(player.lines / 15) + Math.max(1, s.config.startLevel);
    if (newLevel !== player.level) {
      player.level = newLevel;
    }
  } else {
    player.combo = -1;
    if (tSpin) {
      // T-spin no lines still counts? keep B2B? No, only difficult clears maintain B2B; mini t-spin not implemented
    }
  }

  // hard drop already added; soft drop cells bonus
  if (player.softDropCells > 0) {
    add += player.softDropCells;
    player.softDropCells = 0;
  }

  player.lockTicks = 0;
  player.lockResets = 0;
  player.lowestY = player.active ? player.active.y : 0;
  player.canHold = true;

  // spawn next
  const nextKind = pullNext(player, rng);
  const nextActive = spawnTetromino(nextKind);
  if (collides(player.board, nextKind, nextActive.x, nextActive.y, nextActive.rot)) {
    player.gameOver = true;
    player.active = null;
  } else {
    player.active = nextActive;
    player.lowestY = nextActive.y;
  }
}

function isGrounded(player: TetrisState['players'][number]): boolean {
  if (!player.active) return false;
  return collides(player.board, player.active.kind, player.active.x, player.active.y + 1, player.active.rot);
}

/**
 * Guideline "move reset" cap: while grounded, a move/rotation may reset the
 * lock delay, but only up to MAX_LOCK_RESETS times per piece. Beyond that the
 * piece is forced to lock — this stops endless floor-kick stall (repeated
 * rotations with upward SRS kicks lifting the piece forever).
 */
const MAX_LOCK_RESETS = 15;

function resetLockDelay(player: TetrisState['players'][number]): void {
  if (player.lockResets < MAX_LOCK_RESETS) {
    player.lockTicks = 0;
    player.lockResets += 1;
  }
}

function reduce(prev: TetrisState, playerId: string, action: TetrisAction): ReduceResult<TetrisState> {
  const s = clone(prev);
  const player = playerById(s, playerId);
  if (!player) return { ok: false, error: 'Unknown player' };
  if (player.gameOver) return { ok: false, error: 'Game over' };
  if (!player.active && action.type !== 'tick' && action.type !== 'toggleAssist') return { ok: false, error: 'No active piece' };

  const rng = rngFrom(s.rng);
  const logs: LogEntry[] = [];
  s.seq += 1;

  player.actionsSubmitted += 1;

  const beforeScore = player.score;
  const beforeLines = player.lines;

  switch (action.type) {
    case 'move': {
      const nxt = tryMove(player.board, player.active!, action.dir === 'left' ? -1 : 1, 0);
      if (!nxt) return { ok: false, error: 'Blocked' };
      player.active = nxt;
      player.lastWasRotate = false;
      // Guideline: reset is capped (MAX_LOCK_RESETS) so a grounded piece locks
      if (isGrounded(player)) resetLockDelay(player);
      break;
    }
    case 'rotate': {
      const nxt = tryRotate(player.board, player.active!, action.dir);
      if (!nxt) return { ok: false, error: 'Blocked' };
      player.active = nxt;
      player.lastWasRotate = true;
      if (nxt.y > player.lowestY) {
        // kick pushed the piece to a genuinely lower row: re-arm resets
        player.lockTicks = 0;
        player.lowestY = nxt.y;
        player.lockResets = 0;
      } else {
        // Guideline: reset is capped (MAX_LOCK_RESETS) so a grounded piece locks
        if (isGrounded(player)) resetLockDelay(player);
      }
      break;
    }
    case 'softDrop': {
      const nxt = tryMove(player.board, player.active!, 0, 1);
      if (nxt) {
        player.active = nxt;
        player.softDropCells += 1;
        player.score += 1;
        player.lastWasRotate = false;
        if (nxt.y > player.lowestY) {
          // new lowest row: Guideline resets lock delay and re-arms resets
          player.lockTicks = 0;
          player.lowestY = nxt.y;
          player.lockResets = 0;
        }
      }
      // Note: per Tetris Guideline, soft drop to floor grounds the piece but does
      // NOT force an instant lock; the piece enjoys the full 500ms lock delay.
      break;
    }
    case 'hardDrop': {
      if (!player.active) break;
      let dist = 0;
      let cur = player.active;
      while (!collides(player.board, cur.kind, cur.x, cur.y + 1, cur.rot)) {
        cur = { ...cur, y: cur.y + 1 };
        dist++;
      }
      player.active = cur;
      player.score += dist * 2;
      doLock(s, player, rng);
      if (player.gameOver) logs.push(makeLog('TOP OUT', player.id));
      else if (player.lines > beforeLines) {
        const cleared = player.lines - beforeLines;
        logs.push(makeLog(`Clear ${cleared} — ${player.score - beforeScore - dist * 2} pts + hard ${dist * 2}`, player.id));
      }
      break;
    }
    case 'hold': {
      if (!player.canHold) return { ok: false, error: 'Hold already used' };
      if (player.hold === null) {
        player.hold = player.active!.kind;
        const nk = pullNext(player, rng);
        player.active = spawnTetromino(nk);
        if (collides(player.board, nk, player.active.x, player.active.y, player.active.rot)) {
          player.gameOver = true;
          player.active = null;
        }
      } else {
        const tmp = player.hold;
        player.hold = player.active!.kind;
        player.active = spawnTetromino(tmp);
        if (collides(player.board, tmp, player.active.x, player.active.y, player.active.rot)) {
          player.gameOver = true;
          player.active = null;
        }
      }
      player.canHold = false;
      player.lastWasRotate = false;
      player.lockTicks = 0;
      player.lockResets = 0;
      player.lowestY = player.active ? player.active.y : 0;
      break;
    }
    case 'toggleAssist': {
      s.config.assist = !s.config.assist;
      break;
    }
    case 'tick': {
      if (!player.active) break;
      const nxt = tryMove(player.board, player.active, 0, 1);
      if (nxt) {
        player.active = nxt;
        player.lastWasRotate = false;
        if (nxt.y > player.lowestY) {
          // new lowest row: Guideline resets lock delay and re-arms resets
          player.lockTicks = 0;
          player.lowestY = nxt.y;
          player.lockResets = 0;
        }
      } else {
        // grounded -> increment lock ticks (approx 500ms = ~5 ticks at 100ms/tick)
        player.lockTicks += 1;
        if (player.lockTicks >= 5) {
          doLock(s, player, rng);
          if (player.gameOver) logs.push(makeLog('TOP OUT', player.id));
          else if (player.lines > beforeLines) {
            const cleared = player.lines - beforeLines;
            logs.push(makeLog(`Clear ${cleared} — ${player.score - beforeScore} pts`, player.id));
          }
        }
      }
      break;
    }
  }

  // Only count accepted actions
  player.actionsAccepted += 1;

  // persist rng
  s.rng = rng.state();

  // check all game over
  if (s.players.every((p) => p.gameOver)) {
    s.phase = 'game_over';
    // winner is highest score, tie break by lines then seat
    const sorted = [...s.players].sort((a, b) => b.score - a.score || b.lines - a.lines || a.seat - b.seat);
    s.winner = sorted[0]?.id ?? null;
    logs.push(makeLog(`Game over — ${sorted[0]?.score ?? 0} pts wins`, null));
  }

  s.log.push(...stampLogs(s, logs));
  s.log = s.log.slice(-200);
  return { ok: true, state: s, log: logs };
}

function legalActions(s: TetrisState, playerId: string): string[] {
  const p = playerById(s, playerId);
  if (!p || p.gameOver || s.phase === 'game_over') return [];
  // In tetris all actions are always nominally legal; blocking is checked in reducer
  return ['move:left', 'move:right', 'rotate:cw', 'rotate:ccw', 'softDrop', 'hardDrop', 'hold', 'toggleAssist', 'tick'];
}

function autoAction(_s: TetrisState, _playerId: string): TetrisAction {
  return { type: 'tick' };
}

function view(s: TetrisState, playerId: string | null): TetrisView {
  const toPublic = (p: TetrisState['players'][number]): TetrisPublicPlayer => ({
    id: p.id,
    seat: p.seat,
    score: p.score,
    lines: p.lines,
    level: p.level,
    board: p.board,
    active: p.active,
    hold: p.hold,
    next: p.next.slice(0, 5),
    ghostY: s.config.assist && p.active ? ghostY(p.board, p.active) : null,
    gameOver: p.gameOver,
    combo: p.combo,
    backToBack: p.backToBack,
  });
  const you = playerId ? (playerById(s, playerId) ? toPublic(playerById(s, playerId)!) : null) : null;
  return {
    phase: s.phase,
    winner: s.winner,
    you,
    players: s.players.map(toPublic),
    log: s.log.slice(-80),
    config: s.config,
  };
}

function score(s: TetrisState, playerId: string): ScoreInput {
  const p = playerById(s, playerId);
  if (!p) return { progress: 0, accuracy: 1, completed: false, completedAtMs: null, penalties: 0 };
  // Progress: lines cleared (capped at 100) + score normalized, gameOver considered completion
  const progress = Math.min(1, p.lines / 100);
  const accuracy = p.actionsSubmitted === 0 ? 1 : p.actionsAccepted / p.actionsSubmitted;
  const completed = s.phase === 'game_over' && s.winner === playerId;
  return {
    progress,
    accuracy,
    completed,
    completedAtMs: completed ? (s.winnerAtMs ?? null) : null,
    penalties: p.penalties,
    assetValue: p.score,
  };
}

function isOver(s: TetrisState): { over: boolean; winner?: string } {
  if (s.phase === 'game_over') return s.winner ? { over: true, winner: s.winner } : { over: true };
  return { over: false };
}

export const tetris: GameEngine<TetrisState, TetrisAction> = {
  id: 'tetris',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
