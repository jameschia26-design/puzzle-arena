import { mulberry32, rngFrom, type LogEntry, type ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  clampScore,
  drawColor,
  findDetached,
  generateWave,
  hasReachedDanger,
  insertPressureRow,
  matchingCluster,
  pressureLimit,
  resolveLanding,
  scoreShot,
  slotKey,
  traceShot,
} from './rules.js';
import type {
  BubbleCell,
  PuzzleBubbleAction,
  PuzzleBubbleConfig,
  PuzzleBubblePlayerState,
  PuzzleBubblePublicPlayer,
  PuzzleBubbleState,
  PuzzleBubbleView,
} from './state.js';

export * from './state.js';
export * from './rules.js';

const DEFAULT_CONFIG: PuzzleBubbleConfig = { colors: 6, speed: 'normal' };

function playerById(state: PuzzleBubbleState, playerId: string): PuzzleBubblePlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

function clone(state: PuzzleBubbleState): PuzzleBubbleState {
  return structuredClone(state);
}

function parseConfig(raw: unknown): PuzzleBubbleConfig {
  const partial = raw && typeof raw === 'object' ? raw as Partial<PuzzleBubbleConfig> : {};
  const colors = Number.isInteger(partial.colors) ? Math.max(3, Math.min(8, partial.colors!)) : DEFAULT_CONFIG.colors;
  const speed = partial.speed === 'slow' || partial.speed === 'fast' || partial.speed === 'normal'
    ? partial.speed
    : DEFAULT_CONFIG.speed;
  return { colors, speed };
}

function setup(playerIds: string[], seed: number, rawConfig: unknown): PuzzleBubbleState {
  const config = parseConfig(rawConfig);
  const templateRng = mulberry32(seed);
  const rowParity: 0 | 1 = 0;
  const board = generateWave(templateRng, config, 1, rowParity);
  const current = drawColor(board, config, templateRng);
  const next = drawColor(board, config, templateRng);
  const initialRng = templateRng.state();
  const pressure = pressureLimit(config.speed);

  return {
    rng: { seed, calls: initialRng.calls },
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players: playerIds.map((id, seat) => ({
      id,
      seat,
      rng: { ...initialRng },
      board: structuredClone(board),
      rowParity,
      current,
      next,
      score: 0,
      wave: 1,
      wavesCleared: 0,
      shots: 0,
      clearingShots: 0,
      bubblesPopped: 0,
      bubblesDropped: 0,
      pressureRemaining: pressure,
      descents: 0,
      gameOver: false,
      lastShot: null,
      actionsSubmitted: 0,
      actionsAccepted: 0,
      penalties: 0,
    })),
    phase: 'playing',
    winner: null,
    log: [],
  };
}

function comparePlayers(a: PuzzleBubblePlayerState, b: PuzzleBubblePlayerState): number {
  return b.score - a.score
    || b.bubblesDropped - a.bubblesDropped
    || b.wavesCleared - a.wavesCleared
    || a.shots - b.shots
    || a.seat - b.seat;
}

function reduce(prev: PuzzleBubbleState, playerId: string, action: PuzzleBubbleAction): ReduceResult<PuzzleBubbleState> {
  const state = clone(prev);
  const player = playerById(state, playerId);
  if (!player) return { ok: false, error: 'Unknown player' };
  if (player.gameOver) return { ok: false, error: 'Game over' };
  if (state.phase === 'game_over') return { ok: false, error: 'Game over' };
  if (action.type === 'descent') {
    const rng = rngFrom(player.rng);
    const pressured = insertPressureRow(player.board, player.rowParity, state.config, rng);
    state.seq += 1;
    player.board = pressured.board;
    player.rowParity = pressured.rowParity;
    player.rng = rng.state();
    player.descents += 1;
    if (hasReachedDanger(player.board)) player.gameOver = true;

    const log: LogEntry[] = [makeLog('Ceiling descended', player.id)];
    if (player.gameOver) log.push(makeLog('BUBBLES OVER THE LINE', player.id));
    if (state.players.every((candidate) => candidate.gameOver)) {
      state.phase = 'game_over';
      state.winner = [...state.players].sort(comparePlayers)[0]?.id ?? null;
      log.push(makeLog(`Game over — ${state.winner ? 'score leader wins' : 'no winner'}`, null));
    }
    state.log.push(...stampLogs(state, log));
    state.log = state.log.slice(-200);
    return { ok: true, state, log };
  }
  if (action.type !== 'shoot' || !Number.isInteger(action.angleDeg) || action.angleDeg < -80 || action.angleDeg > 80) {
    return { ok: false, error: 'Invalid shot angle' };
  }

  const rng = rngFrom(player.rng);
  const trace = traceShot(player.board, player.rowParity, action.angleDeg);
  const landing = resolveLanding(player.board, player.rowParity, trace);
  if (!landing) return { ok: false, error: 'No available landing slot' };

  state.seq += 1;
  player.actionsSubmitted += 1;
  player.actionsAccepted += 1;
  player.shots += 1;

  const placed: BubbleCell = { ...landing, color: player.current };
  let board = [...player.board, placed];
  const matching = matchingCluster(board, landing, player.rowParity);
  const popped = matching.length >= 3 ? matching : [];
  if (popped.length > 0) {
    const removed = new Set(popped.map(slotKey));
    board = board.filter((cell) => !removed.has(slotKey(cell)));
  }
  const detached = popped.length > 0 ? findDetached(board, player.rowParity) : [];
  if (detached.length > 0) {
    const dropped = new Set(detached.map(slotKey));
    board = board.filter((cell) => !dropped.has(slotKey(cell)));
  }

  const clearing = popped.length > 0;
  let pressureAdded = false;
  if (clearing) {
    player.pressureRemaining = pressureLimit(state.config.speed);
  } else {
    player.pressureRemaining -= 1;
    if (player.pressureRemaining === 0) {
      const pressured = insertPressureRow(board, player.rowParity, state.config, rng);
      board = pressured.board;
      player.rowParity = pressured.rowParity;
      player.pressureRemaining = pressureLimit(state.config.speed);
      pressureAdded = true;
    }
  }

  const gained = scoreShot(popped.length, detached.length);
  player.score = clampScore(player.score + gained);
  player.bubblesPopped += popped.length;
  player.bubblesDropped += detached.length;
  if (clearing) player.clearingShots += 1;

  if (board.length === 0) {
    player.wavesCleared += 1;
    player.wave += 1;
    board = generateWave(rng, state.config, player.wave, player.rowParity);
  }
  player.current = player.next;
  player.next = drawColor(board, state.config, rng);
  player.board = board;
  player.rng = rng.state();
  player.lastShot = {
    angleDeg: action.angleDeg,
    path: trace.path,
    landing,
    popped: popped.map(({ row, col }) => ({ row, col })),
    dropped: detached.map(({ row, col }) => ({ row, col })),
    pressureAdded,
  };
  if (hasReachedDanger(board)) player.gameOver = true;

  const log: LogEntry[] = [];
  if (gained > 0) log.push(makeLog(`+${gained} points`, player.id));
  if (pressureAdded) log.push(makeLog('Pressure row added', player.id));
  if (player.gameOver) log.push(makeLog('BUBBLES OVER THE LINE', player.id));
  if (state.players.every((candidate) => candidate.gameOver)) {
    state.phase = 'game_over';
    state.winner = [...state.players].sort(comparePlayers)[0]?.id ?? null;
    log.push(makeLog(`Game over — ${state.winner ? 'score leader wins' : 'no winner'}`, null));
  }
  state.log.push(...stampLogs(state, log));
  state.log = state.log.slice(-200);
  return { ok: true, state, log };
}

function toPublic(player: PuzzleBubblePlayerState, config: PuzzleBubbleConfig): PuzzleBubblePublicPlayer {
  return {
    id: player.id,
    seat: player.seat,
    board: player.board.map((cell) => ({ ...cell })),
    rowParity: player.rowParity,
    current: player.current,
    next: player.next,
    score: player.score,
    wave: player.wave,
    wavesCleared: player.wavesCleared,
    shots: player.shots,
    clearingShots: player.clearingShots,
    bubblesPopped: player.bubblesPopped,
    bubblesDropped: player.bubblesDropped,
    pressureRemaining: player.pressureRemaining,
    pressureLimit: pressureLimit(config.speed),
    descents: player.descents,
    gameOver: player.gameOver,
    lastShot: player.lastShot ? structuredClone(player.lastShot) : null,
  };
}

function view(state: PuzzleBubbleState, playerId: string | null): PuzzleBubbleView {
  const publicPlayers = state.players.map((player) => toPublic(player, state.config));
  return {
    phase: state.phase,
    winner: state.winner,
    you: playerId ? publicPlayers.find((player) => player.id === playerId) ?? null : null,
    players: publicPlayers,
    config: { ...state.config },
    log: state.log.slice(-80),
  };
}

function score(state: PuzzleBubbleState, playerId: string): ScoreInput {
  const player = playerById(state, playerId);
  if (!player) return { progress: 0, accuracy: 1, completed: false, completedAtMs: null, penalties: 0 };
  const completed = state.phase === 'game_over' && state.winner === playerId;
  return {
    progress: Math.min(1, player.wavesCleared / 10),
    accuracy: player.clearingShots / Math.max(1, player.shots),
    completed,
    completedAtMs: completed ? state.winnerAtMs : null,
    penalties: player.penalties,
    assetValue: player.score,
  };
}

function isOver(state: PuzzleBubbleState): { over: boolean; winner?: string } {
  if (state.phase !== 'game_over') return { over: false };
  return state.winner ? { over: true, winner: state.winner } : { over: true };
}

function legalActions(state: PuzzleBubbleState, playerId: string): string[] {
  const player = playerById(state, playerId);
  return player && !player.gameOver && state.phase === 'playing' ? ['shoot'] : [];
}

function autoAction(): PuzzleBubbleAction {
  return { type: 'shoot', angleDeg: 0 };
}

export const puzzleBubble: GameEngine<PuzzleBubbleState, PuzzleBubbleAction> = {
  id: 'puzzle-bubble',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
