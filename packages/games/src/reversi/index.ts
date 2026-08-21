import { rngFrom, type LogEntry, type ScoreInput } from '@puzzle-arena/shared';
import type { GameEngine, ReduceResult } from '../engine.js';
import {
  actorToAct,
  applyMove,
  autoAction,
  countDiscs,
  createInitialBoard,
  getLegalMoves,
} from './rules.js';
import type {
  ReversiAction,
  ReversiConfig,
  ReversiPlayer,
  ReversiState,
  ReversiView,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: ReversiState): ReversiState => structuredClone(s);

const DEFAULT_CONFIG: ReversiConfig = {
  turnTimeLimitSec: 60,
};

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setup(playerIds: string[], seed: number, rawConfig: unknown): ReversiState {
  if (playerIds.length !== 2) {
    throw new Error(`Reversi requires exactly 2 players, got ${playerIds.length}`);
  }

  const cfg = (rawConfig ?? {}) as Partial<ReversiConfig>;
  const config: ReversiConfig = {
    turnTimeLimitSec: cfg.turnTimeLimitSec ?? DEFAULT_CONFIG.turnTimeLimitSec,
  };

  const players: [ReversiPlayer, ReversiPlayer] = [
    { id: playerIds[0]!, name: 'Player 1', side: 0, discs: 2 },
    { id: playerIds[1]!, name: 'Player 2', side: 1, discs: 2 },
  ];

  const board = createInitialBoard();
  const initialLog: LogEntry[] = [
    {
      seq: 0,
      at: 0,
      text: 'Reversi game started. Dark (Player 1) moves first.',
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
    consecutivePasses: 0,
    lastMove: null,
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
  prev: ReversiState,
  playerId: string,
  action: ReversiAction,
): ReduceResult<ReversiState> {
  const s = clone(prev);
  return applyMove(s, playerId, action);
}

/* ------------------------------------------------------------------ */
/* Legal & Auto Actions                                                */
/* ------------------------------------------------------------------ */

function legalActions(s: ReversiState, playerId: string): string[] {
  if (s.phase === 'game_over') return [];
  const currentActor = actorToAct(s);
  if (currentActor !== playerId) return [];
  const pIdx = s.players.findIndex((p) => p.id === playerId);
  if (pIdx < 0) return [];
  const side = s.players[pIdx]!.side;
  const legal = getLegalMoves(s.board, side);
  if (legal.length === 0) return ['pass'];
  return legal.map((m) => `place:${m.row},${m.col}`);
}

/* ------------------------------------------------------------------ */
/* View & Score                                                        */
/* ------------------------------------------------------------------ */

function view(s: ReversiState, _playerId: string | null): ReversiView {
  const currentSide = s.players[s.turn].side;
  const legal = s.phase === 'playing' ? getLegalMoves(s.board, currentSide) : [];
  return {
    config: s.config,
    players: s.players,
    board: s.board,
    turn: s.turn,
    lastMove: s.lastMove,
    winner: s.winner,
    winReason: s.winReason,
    phase: s.phase,
    legalMoves: legal.map((m) => ({ row: m.row, col: m.col, flipsCount: m.flips.length })),
    log: s.log,
  };
}

function score(s: ReversiState, playerId: string): ScoreInput {
  const counts = countDiscs(s.board);
  const pIdx = s.players.findIndex((p) => p.id === playerId);
  const myDiscs = pIdx === 0 ? counts.dark : counts.light;
  const total = counts.dark + counts.light;
  const progress = total > 0 ? myDiscs / 64 : 0;
  const isWinner = s.phase === 'game_over' && s.winner === playerId;
  const isDraw = s.phase === 'game_over' && s.winReason === 'draw';

  // Use the runtime-stamped winnerAtMs for the winner's completion time so
  // the speed bonus is proportional to how fast they actually won — every
  // other board game (property-tycoon, scrabble, ...) does it this way.
  return {
    progress: isWinner ? 1 : progress,
    accuracy: isWinner ? 1 : isDraw ? 0.8 : progress,
    completed: isWinner,
    completedAtMs: isWinner ? s.winnerAtMs : null,
    penalties: 0,
  };
}

function isOver(s: ReversiState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const reversi: GameEngine<ReversiState, ReversiAction> = {
  id: 'reversi',
  setup,
  reduce,
  autoAction,
  legalActions,
  view,
  score,
  isOver,
};
