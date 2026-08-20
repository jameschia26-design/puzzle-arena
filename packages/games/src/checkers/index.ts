import type { LogEntry, ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  actorToAct,
  applyMove,
  countSide,
  createInitialBoard,
  legalMovesForSide,
  PIECES_PER_SIDE,
  playerById,
  samePath,
  sideOf,
} from './rules.js';
import type {
  CheckersAction,
  CheckersConfig,
  CheckersPlayer,
  CheckersPos,
  CheckersSide,
  CheckersState,
  CheckersView,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: CheckersState): CheckersState => structuredClone(s);

const DEFAULT_CONFIG: CheckersConfig = { turnTimeLimitSec: 60 };

function setup(playerIds: string[], seed: number, rawConfig: unknown): CheckersState {
  const config: CheckersConfig = { ...DEFAULT_CONFIG, ...(rawConfig as Partial<CheckersConfig> | null) };

  const players: [CheckersPlayer, CheckersPlayer] = [
    { id: playerIds[0] ?? 'p0', seat: 0, capturedCount: 0, actionsSubmitted: 0, actionsAccepted: 0, penalties: 0 },
    { id: playerIds[1] ?? 'p1', seat: 1, capturedCount: 0, actionsSubmitted: 0, actionsAccepted: 0, penalties: 0 },
  ];

  return {
    rng: { seed, calls: 0 },
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players,
    board: createInitialBoard(),
    current: 0,
    phase: 'playing',
    lastMove: null,
    winner: null,
    winReason: null,
    log: [],
  };
}

function pathLabel(path: CheckersPos[]): string {
  return path.map((p) => `${p.row}.${p.col}`).join('-');
}

function reduce(prev: CheckersState, playerId: string, action: CheckersAction): ReduceResult<CheckersState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const player = playerById(s, playerId);
  const fail = (error: string): ReduceResult<CheckersState> => ({ ok: false, error });

  if (!player) return fail('Not in this game');
  if (s.phase === 'game_over') return fail('The game is over');
  const side = sideOf(s, playerId);
  if (side === null || side !== s.current) return fail('Not your turn');

  player.actionsSubmitted += 1;

  if (action.type !== 'move' || !Array.isArray(action.path) || action.path.length < 2) {
    return fail('Unknown action');
  }

  const legal = legalMovesForSide(s.board, side);
  const match = legal.find((m) => samePath(m.path, action.path));
  if (!match) return fail('Illegal move');

  const { board: nextBoard, captured, promoted } = applyMove(s.board, match);
  s.board = nextBoard;
  player.capturedCount += captured.length;

  s.lastMove = { playerId, path: match.path, captured, promoted };

  if (captured.length > 0) {
    log.push(
      makeLog(
        `${playerId} captured ${captured.length} piece${captured.length > 1 ? 's' : ''} (${pathLabel(match.path)})`,
        playerId,
      ),
    );
  } else {
    log.push(makeLog(`${playerId} moved ${pathLabel(match.path)}`, playerId));
  }
  if (promoted) log.push(makeLog(`${playerId} crowned a king`, playerId));

  const opponentSide = (1 - side) as CheckersSide;
  const opponentCount = countSide(s.board, opponentSide);

  if (opponentCount.pieces === 0) {
    s.phase = 'game_over';
    s.winner = playerId;
    s.winReason = 'elimination';
    log.push(makeLog(`Game over! ${playerId} wins — every opponent piece captured!`, playerId));
  } else if (legalMovesForSide(s.board, opponentSide).length === 0) {
    s.phase = 'game_over';
    s.winner = playerId;
    s.winReason = 'no-moves';
    log.push(makeLog(`Game over! ${playerId} wins — the opponent has no legal moves!`, playerId));
  } else {
    s.current = opponentSide;
  }

  player.actionsAccepted += 1;
  s.seq += 1;
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);

  return { ok: true, state: s, log: stamped };
}

function legalActions(s: CheckersState, playerId: string): string[] {
  const side = sideOf(s, playerId);
  if (side === null || side !== s.current || s.phase === 'game_over') return [];
  return legalMovesForSide(s.board, side).map((m) => `move:${pathLabel(m.path)}`);
}

function autoAction(s: CheckersState, playerId: string): CheckersAction {
  const side = sideOf(s, playerId);
  if (side === null) return { type: 'move', path: [] };
  const legal = legalMovesForSide(s.board, side);
  return { type: 'move', path: legal[0]?.path ?? [] };
}

function view(s: CheckersState, playerId: string | null): CheckersView {
  const side = playerId ? sideOf(s, playerId) : null;
  const isMyTurn = side !== null && side === s.current && s.phase !== 'game_over';

  return {
    board: s.board,
    players: s.players.map((p, i) => {
      const counts = countSide(s.board, i as CheckersSide);
      return {
        id: p.id,
        seat: p.seat,
        side: i as CheckersSide,
        piecesRemaining: counts.pieces,
        kingsCount: counts.kings,
        capturedCount: p.capturedCount,
      };
    }),
    current: s.phase === 'game_over' ? null : (s.players[s.current]?.id ?? null),
    phase: s.phase,
    lastMove: s.lastMove,
    winner: s.winner,
    winReason: s.winReason,
    log: s.log,
    you: side !== null ? { id: playerId as string, side, legalMoves: isMyTurn ? legalMovesForSide(s.board, side) : [] } : null,
  };
}

function score(s: CheckersState, playerId: string): ScoreInput {
  const player = playerById(s, playerId);
  if (!player) return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };

  const progress = Math.max(0, Math.min(1, player.capturedCount / PIECES_PER_SIDE));
  const completed = s.winner === playerId;

  return {
    progress,
    accuracy: player.actionsSubmitted > 0 ? player.actionsAccepted / player.actionsSubmitted : 1,
    completed,
    completedAtMs: completed ? s.winnerAtMs : null,
    penalties: player.penalties,
  };
}

function isOver(s: CheckersState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const checkers: GameEngine<CheckersState, CheckersAction> = {
  id: 'checkers',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
