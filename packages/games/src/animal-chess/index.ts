import type { LogEntry, ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  actorToAct,
  ANIMAL_NAMES,
  applyMove,
  colOf,
  countPieces,
  createInitialBoard,
  isDen,
  legalMovesForSide,
  playerById,
  rowOf,
  sideOf,
} from './rules.js';
import type {
  AnimalChessAction,
  AnimalChessConfig,
  AnimalChessPlayer,
  AnimalChessState,
  AnimalChessView,
  AnimalPiece,
  AnimalSide,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: AnimalChessState): AnimalChessState => structuredClone(s);

const DEFAULT_CONFIG: AnimalChessConfig = { turnTimeLimitSec: 60 };

function setup(playerIds: string[], seed: number, rawConfig: unknown): AnimalChessState {
  const config: AnimalChessConfig = { ...DEFAULT_CONFIG, ...(rawConfig as Partial<AnimalChessConfig> | null) };

  const players: [AnimalChessPlayer, AnimalChessPlayer] = [
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
    halfmoveClock: 0,
    fullmove: 1,
    history: [],
    winner: null,
    winReason: null,
    drawReason: null,
    log: [],
  };
}

function moveNotation(piece: AnimalPiece, from: number, to: number, captured: AnimalPiece | null): string {
  const name = ANIMAL_NAMES[piece.type].en;
  const fromCoord = `(${colOf(from)},${rowOf(from)})`;
  const toCoord = `(${colOf(to)},${rowOf(to)})`;
  if (captured) {
    return `${name} ${fromCoord} -> ${toCoord} captures ${ANIMAL_NAMES[captured.type].en}`;
  }
  return `${name} ${fromCoord} -> ${toCoord}`;
}

function reduce(prev: AnimalChessState, playerId: string, action: AnimalChessAction): ReduceResult<AnimalChessState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const player = playerById(s, playerId);
  const fail = (error: string): ReduceResult<AnimalChessState> => ({ ok: false, error });

  if (!player) return fail('Not in this game');
  if (s.phase === 'game_over') return fail('The game is over');
  const side = sideOf(s, playerId);
  if (side === null || side !== s.current) return fail('Not your turn');

  player.actionsSubmitted += 1;

  if (action.type !== 'move' || typeof action.from !== 'number' || typeof action.to !== 'number') {
    return fail('Unknown action');
  }

  const legal = legalMovesForSide(s.board, side);
  const match = legal.find((m) => m.from === action.from && m.to === action.to);
  if (!match) return fail('Illegal move');

  const { board: nextBoard, piece, captured } = applyMove(s.board, match.from, match.to);
  s.board = nextBoard;

  if (captured) {
    player.capturedCount += 1;
    s.halfmoveClock = 0;
  } else {
    s.halfmoveClock += 1;
  }

  const notation = moveNotation(piece, match.from, match.to, captured);
  s.history.push({
    from: match.from,
    to: match.to,
    piece,
    captured,
    notation,
  });

  log.push(makeLog(`${playerId} (${side === 0 ? 'Blue' : 'Red'}): ${notation}`, playerId));

  const opponentSide = (1 - side) as AnimalSide;
  // 1. Reaching opponent's Den
  if (isDen(match.to, opponentSide)) {
    s.phase = 'game_over';
    s.winner = playerId;
    s.winReason = 'den';
    log.push(makeLog(`Game over! ${playerId} entered the opponent's Den and won!`, playerId));
  }
  // 2. Eliminating all opponent pieces
  else if (countPieces(s.board, opponentSide) === 0) {
    s.phase = 'game_over';
    s.winner = playerId;
    s.winReason = 'elimination';
    log.push(makeLog(`Game over! ${playerId} captured all opponent pieces and won!`, playerId));
  }
  // 3. Opponent has no legal moves
  else if (legalMovesForSide(s.board, opponentSide).length === 0) {
    s.phase = 'game_over';
    s.winner = playerId;
    s.winReason = 'no_moves';
    log.push(makeLog(`Game over! ${playerId} won — the opponent has no legal moves!`, playerId));
  }
  // 4. 60-move rule without capture (120 plies)
  else if (s.halfmoveClock >= 120) {
    s.phase = 'game_over';
    s.winner = null;
    s.drawReason = 'sixty_move';
    log.push(makeLog('Draw - 60 moves with no capture', playerId));
  } else {
    s.current = opponentSide;
    if (side === 1) {
      s.fullmove += 1;
    }
  }

  player.actionsAccepted += 1;
  s.seq += 1;
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);

  return { ok: true, state: s, log: stamped };
}

function legalActions(s: AnimalChessState, playerId: string): string[] {
  if (s.phase === 'game_over') return [];
  const side = sideOf(s, playerId);
  if (side === null || side !== s.current) return [];
  return legalMovesForSide(s.board, side).map((m) => `${m.from}->${m.to}`);
}

function autoAction(s: AnimalChessState, playerId: string): AnimalChessAction {
  const side = sideOf(s, playerId);
  if (side === null) return { type: 'move', from: 0, to: 0 };
  const legal = legalMovesForSide(s.board, side);
  if (legal.length === 0) return { type: 'move', from: 0, to: 0 };
  const m = legal[0]!;
  return { type: 'move', from: m.from, to: m.to };
}

function view(s: AnimalChessState, playerId: string | null): AnimalChessView {
  const side = playerId ? sideOf(s, playerId) : null;
  const youMoves = side !== null && side === s.current && s.phase === 'playing' ? legalMovesForSide(s.board, side) : [];
  const lastRecord = s.history[s.history.length - 1];

  return {
    board: s.board,
    players: s.players.map((p, idx) => ({
      id: p.id,
      seat: p.seat,
      side: idx as AnimalSide,
      piecesRemaining: countPieces(s.board, idx as AnimalSide),
      capturedCount: p.capturedCount,
    })),
    current: actorToAct(s),
    phase: s.phase,
    lastMove: lastRecord
      ? {
          from: lastRecord.from,
          to: lastRecord.to,
          piece: lastRecord.piece,
          captured: lastRecord.captured,
        }
      : null,
    winner: s.winner,
    winReason: s.winReason,
    drawReason: s.drawReason,
    log: s.log,
    you:
      playerId && side !== null
        ? {
            id: playerId,
            side,
            legalMoves: youMoves,
          }
        : null,
  };
}

function score(s: AnimalChessState, playerId: string): ScoreInput {
  const p = playerById(s, playerId);
  if (!p) return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };
  const side = sideOf(s, playerId);
  const won = s.winner === playerId;
  const oppPieces = side !== null ? countPieces(s.board, (1 - side) as AnimalSide) : 0;
  const captured = p.capturedCount || Math.max(0, 8 - oppPieces);

  return {
    progress: Math.max(0, Math.min(1, captured / 8)),
    accuracy: p.actionsSubmitted > 0 ? p.actionsAccepted / p.actionsSubmitted : 1,
    completed: won,
    completedAtMs: won ? s.winnerAtMs : null,
    penalties: p.penalties,
  };
}

function isOver(s: AnimalChessState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const animalChess: GameEngine<AnimalChessState, AnimalChessAction> = {
  id: 'animal-chess',
  setup,
  reduce,
  legalActions,
  autoAction,
  view,
  score,
  isOver,
};
