import { rngFrom, type LogEntry, type ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import { applyMovePlane, HOME_STEP, hasWon, legalTokenIndices, playerById, QUADRANTS_BY_COUNT } from './rules.js';
import type {
  AeroplaneChessAction,
  AeroplaneChessConfig,
  AeroplaneChessPlayer,
  AeroplaneChessState,
  AeroplaneChessTokens,
  AeroplaneChessView,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: AeroplaneChessState): AeroplaneChessState => structuredClone(s);

const DEFAULT_CONFIG: AeroplaneChessConfig = { turnTimeLimitSec: 60 };

function makeTokens(): AeroplaneChessTokens {
  return [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }];
}

function setup(playerIds: string[], seed: number, rawConfig: unknown): AeroplaneChessState {
  const config: AeroplaneChessConfig = {
    ...DEFAULT_CONFIG,
    ...(rawConfig as Partial<AeroplaneChessConfig> | null),
  };
  const n = playerIds.length;
  const quadrants = QUADRANTS_BY_COUNT[n] ?? [0, 1, 2, 3].slice(0, n);

  const players: AeroplaneChessPlayer[] = playerIds.map((id, i) => ({
    id,
    seat: i,
    quadrant: quadrants[i] ?? i,
    tokens: makeTokens(),
    actionsSubmitted: 0,
    actionsAccepted: 0,
    penalties: 0,
  }));

  return {
    rng: { seed, calls: 0 },
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players,
    current: 0,
    phase: 'awaiting_roll',
    dice: null,
    consecutiveSixes: 0,
    lastRoll: null,
    lastMove: null,
    winner: null,
    log: [],
  };
}

function advanceTurn(s: AeroplaneChessState): void {
  s.current = (s.current + 1) % s.players.length;
  s.consecutiveSixes = 0;
}

function reduce(
  prev: AeroplaneChessState,
  playerId: string,
  action: AeroplaneChessAction,
): ReduceResult<AeroplaneChessState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const player = playerById(s, playerId);
  const fail = (error: string): ReduceResult<AeroplaneChessState> => ({ ok: false, error });

  if (!player) return fail('Not in this game');
  if (s.phase === 'game_over') return fail('The game is over');
  if (s.players[s.current]?.id !== playerId) return fail('Not your turn');

  player.actionsSubmitted += 1;

  if (action.type === 'roll') {
    if (s.phase !== 'awaiting_roll') return fail('You cannot roll right now');

    const rng = rngFrom(s.rng);
    const value = rng.range(1, 7);
    s.rng = rng.state();
    s.lastRoll = { playerId, value };
    log.push(makeLog(`${playerId} rolls a ${value}`, playerId));

    if (value === 6) {
      const nextCount = s.consecutiveSixes + 1;
      if (nextCount >= 3) {
        log.push(makeLog(`${playerId} rolled three sixes in a row — turn forfeited!`, playerId));
        s.dice = null;
        advanceTurn(s);
        player.actionsAccepted += 1;
        s.seq += 1;
        const stamped = stampLogs(s, log);
        s.log = [...s.log, ...stamped].slice(-200);
        return { ok: true, state: s, log: stamped };
      }
      s.consecutiveSixes = nextCount;
    } else {
      s.consecutiveSixes = 0;
    }

    s.dice = value;
    const legal = legalTokenIndices(player, value);
    if (legal.length === 0) {
      log.push(makeLog(`${playerId} has no legal move for a ${value}`, playerId));
      s.dice = null;
      if (value !== 6) advanceTurn(s);
      // A six with nothing to play still keeps the bonus roll.
    } else {
      s.phase = 'awaiting_move';
    }
  } else if (action.type === 'movePlane') {
    if (s.phase !== 'awaiting_move' || s.dice === null) return fail('You must roll first');
    const legal = legalTokenIndices(player, s.dice);
    if (!legal.includes(action.tokenIndex)) return fail('Illegal move');

    const wasSix = s.dice === 6;
    const diceValue = s.dice;
    const playerIndex = s.players.findIndex((p) => p.id === playerId);
    const result = applyMovePlane(s, playerIndex, action.tokenIndex, diceValue);
    s.lastMove = { playerId, tokenIndex: action.tokenIndex, ...result };
    s.dice = null;

    if (result.released) {
      log.push(makeLog(`${playerId} releases a plane onto the runway`, playerId));
    } else {
      log.push(makeLog(`${playerId} advances a plane ${diceValue} squares`, playerId));
    }
    if (result.flew) log.push(makeLog(`${playerId}'s plane catches a tailwind and flies ahead!`, playerId));
    for (const cap of result.captured) {
      log.push(makeLog(`${playerId} sends ${cap.playerId}'s plane back to the hangar!`, playerId));
    }
    if (result.reachedHome) log.push(makeLog(`${playerId}'s plane lands home!`, playerId));

    if (hasWon(player)) {
      s.phase = 'game_over';
      s.winner = playerId;
      log.push(makeLog(`Game over! ${playerId} lands every plane and wins!`, playerId));
    } else if (wasSix) {
      s.phase = 'awaiting_roll'; // bonus roll, same player
    } else {
      s.phase = 'awaiting_roll';
      advanceTurn(s);
    }
  } else {
    return fail('Unknown action');
  }

  player.actionsAccepted += 1;
  s.seq += 1;
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);

  return { ok: true, state: s, log: stamped };
}

function legalActions(s: AeroplaneChessState, playerId: string): string[] {
  if (s.phase === 'game_over' || s.players[s.current]?.id !== playerId) return [];
  if (s.phase === 'awaiting_roll') return ['roll'];
  const player = playerById(s, playerId);
  if (!player) return [];
  return legalTokenIndices(player, s.dice ?? 0).map((i) => `movePlane:${i}`);
}

function autoAction(s: AeroplaneChessState, playerId: string): AeroplaneChessAction {
  if (s.phase === 'awaiting_move') {
    const player = playerById(s, playerId);
    const legal = player ? legalTokenIndices(player, s.dice ?? 0) : [];
    return { type: 'movePlane', tokenIndex: legal[0] ?? 0 };
  }
  return { type: 'roll' };
}

function view(s: AeroplaneChessState, playerId: string | null): AeroplaneChessView {
  const player = playerId ? playerById(s, playerId) : undefined;
  const isMyTurn = !!player && s.players[s.current]?.id === playerId && s.phase !== 'game_over';

  return {
    players: s.players.map((p) => ({ id: p.id, seat: p.seat, quadrant: p.quadrant, tokens: p.tokens })),
    current: s.phase === 'game_over' ? null : (s.players[s.current]?.id ?? null),
    phase: s.phase,
    dice: s.dice,
    lastRoll: s.lastRoll,
    lastMove: s.lastMove,
    winner: s.winner,
    log: s.log,
    you: player
      ? {
          id: player.id,
          quadrant: player.quadrant,
          legalTokens: isMyTurn && s.phase === 'awaiting_move' ? legalTokenIndices(player, s.dice ?? 0) : [],
        }
      : null,
  };
}

function score(s: AeroplaneChessState, playerId: string): ScoreInput {
  const player = playerById(s, playerId);
  if (!player) return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };

  const numerator = player.tokens.reduce((sum, t) => sum + (t.steps === -1 ? 0 : t.steps + 1), 0);
  const denom = player.tokens.length * (HOME_STEP + 1);
  const progress = Math.max(0, Math.min(1, numerator / denom));
  const completed = s.winner === playerId;

  return {
    progress,
    accuracy: player.actionsSubmitted > 0 ? player.actionsAccepted / player.actionsSubmitted : 1,
    completed,
    completedAtMs: completed ? s.winnerAtMs : null,
    penalties: player.penalties,
  };
}

function isOver(s: AeroplaneChessState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const aeroplaneChess: GameEngine<AeroplaneChessState, AeroplaneChessAction> = {
  id: 'aeroplane-chess',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
