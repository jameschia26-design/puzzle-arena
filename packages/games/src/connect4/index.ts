import { type LogEntry, type ScoreInput } from '@puzzle-arena/shared';
import type { GameEngine, ReduceResult } from '../engine.js';
import {
  actorToAct,
  applyMove,
  autoAction,
  createInitialBoard,
  getLegalColumns,
} from './rules.js';
import type {
  Connect4Action,
  Connect4Config,
  Connect4Player,
  Connect4State,
  Connect4View,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: Connect4State): Connect4State => structuredClone(s);

const DEFAULT_CONFIG: Connect4Config = {
  turnTimeLimitSec: 60,
};

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setup(playerIds: string[], seed: number, rawConfig: unknown): Connect4State {
  if (playerIds.length !== 2) {
    throw new Error(`Connect 4 requires exactly 2 players, got ${playerIds.length}`);
  }

  const cfg = (rawConfig ?? {}) as Partial<Connect4Config>;
  const config: Connect4Config = {
    turnTimeLimitSec: cfg.turnTimeLimitSec ?? DEFAULT_CONFIG.turnTimeLimitSec,
  };

  const players: [Connect4Player, Connect4Player] = [
    { id: playerIds[0]!, name: 'Player 1', side: 0 },
    { id: playerIds[1]!, name: 'Player 2', side: 1 },
  ];

  const board = createInitialBoard();
  const initialLog: LogEntry[] = [
    {
      seq: 0,
      at: 0,
      text: 'Connect 4 game started. Player 1 (Red/Pink) drops first.',
      playerId: null,
    },
  ];

  return {
    rng: { seed, calls: 0 },
    logSeq: 1,
    seq: 0,
    winnerAtMs: null,
    config,
    players,
    board,
    turn: 0,
    lastMove: null,
    winningLine: null,
    winner: null,
    winReason: null,
    phase: 'playing',
    log: initialLog,
  };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

function reduce(
  prev: Connect4State,
  playerId: string,
  action: Connect4Action,
): ReduceResult<Connect4State> {
  const s = clone(prev);
  return applyMove(s, playerId, action);
}

/* ------------------------------------------------------------------ */
/* Legal & Auto Actions                                                */
/* ------------------------------------------------------------------ */

function legalActions(s: Connect4State, playerId: string): string[] {
  if (s.phase === 'game_over') return [];
  const currentActor = actorToAct(s);
  if (currentActor !== playerId) return [];
  return getLegalColumns(s.board).map((c) => `drop:${c}`);
}

/* ------------------------------------------------------------------ */
/* View & Score                                                        */
/* ------------------------------------------------------------------ */

function view(s: Connect4State, _playerId: string | null): Connect4View {
  const legalCols = s.phase === 'playing' ? getLegalColumns(s.board) : [];
  return {
    config: s.config,
    players: s.players,
    board: s.board,
    turn: s.turn,
    lastMove: s.lastMove,
    winningLine: s.winningLine,
    winner: s.winner,
    winReason: s.winReason,
    phase: s.phase,
    legalCols,
    log: s.log,
  };
}

function score(s: Connect4State, playerId: string): ScoreInput {
  const isWinner = s.phase === 'game_over' && s.winner === playerId;
  const isDraw = s.phase === 'game_over' && s.winReason === 'draw';

  // Use the runtime-stamped winnerAtMs for the winner's completion time so
  // the speed bonus is proportional to how fast they actually won. Property
  // Tycoon does this in property-tycoon/index.ts and is the right pattern;
  // hardcoding 0 here meant every win earned a perfect speed bonus regardless
  // of when it happened.
  return {
    progress: isWinner ? 1 : isDraw ? 0.5 : 0.2,
    accuracy: isWinner ? 1 : isDraw ? 0.8 : 0.4,
    completed: isWinner,
    completedAtMs: isWinner ? s.winnerAtMs : null,
    penalties: 0,
  };
}

function isOver(s: Connect4State): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const connect4: GameEngine<Connect4State, Connect4Action> = {
  id: 'connect4',
  setup,
  reduce,
  autoAction,
  legalActions,
  view,
  score,
  isOver,
};
