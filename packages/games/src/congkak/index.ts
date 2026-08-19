import { rngFrom, type LogEntry, type ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  actorToAct,
  executeSow,
  isPlayerPit,
  legalPits,
  pitsPerSide,
  playerById,
  playerSideRange,
} from './rules.js';
import type {
  CongkakAction,
  CongkakConfig,
  CongkakPlayer,
  CongkakState,
  CongkakView,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: CongkakState): CongkakState => structuredClone(s);

const DEFAULT_CONFIG: CongkakConfig = {
  pitsPerSide: 7,
  seedsPerPit: 7,
  turnTimeLimitSec: 60,
};

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setup(playerIds: string[], seed: number, rawConfig: unknown): CongkakState {
  const config: CongkakConfig = {
    ...DEFAULT_CONFIG,
    ...(rawConfig as Partial<CongkakConfig> | null),
  };
  const rng = rngFrom({ seed, calls: 0 });
  const nPits = config.pitsPerSide;

  const players: [CongkakPlayer, CongkakPlayer] = [
    {
      id: playerIds[0] ?? 'p0',
      seat: 0,
      storehouse: 0,
      actionsSubmitted: 0,
      actionsAccepted: 0,
      penalties: 0,
    },
    {
      id: playerIds[1] ?? 'p1',
      seat: 1,
      storehouse: 0,
      actionsSubmitted: 0,
      actionsAccepted: 0,
      penalties: 0,
    },
  ];

  // Each pit starts with seedsPerPit seeds
  const pits = new Array(2 * nPits).fill(config.seedsPerPit);
  const storehouses: [number, number] = [0, 0];

  const state: CongkakState = {
    rng: rng.state(),
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players,
    pits,
    storehouses,
    current: 0,
    phase: 'pick',
    lastMove: null,
    winner: null,
    winReason: null,
    log: [],
  };

  return state;
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

function reduce(
  prev: CongkakState,
  playerId: string,
  action: CongkakAction,
): ReduceResult<CongkakState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const rng = rngFrom(s.rng);
  const player = playerById(s, playerId);
  const fail = (error: string): ReduceResult<CongkakState> => ({ ok: false, error });

  if (!player) return fail('Not in this game');
  if (s.phase === 'game_over') return fail('The game is over');
  if (s.players[s.current]?.id !== playerId) return fail('Not your turn');

  player.actionsSubmitted += 1;

  if (action.type !== 'sow') return fail('Unknown action');

  const nPits = pitsPerSide(s);
  const { pitIndex } = action;

  if (!isPlayerPit(s.current, pitIndex, nPits)) {
    return fail('You can only sow from your own houses');
  }

  if ((s.pits[pitIndex] ?? 0) <= 0) {
    return fail('That house is empty');
  }

  const result = executeSow(
    s.pits,
    s.storehouses,
    s.current,
    pitIndex,
    nPits,
    s.players,
  );

  s.pits = result.pits;
  s.storehouses = result.storehouses;
  s.players[0].storehouse = result.storehouses[0];
  s.players[1].storehouse = result.storehouses[1];

  s.lastMove = {
    playerId,
    startPit: pitIndex,
    relayHops: result.relayHops,
    landedInStorehouse: result.landedInStorehouse,
    tembakPit: result.tembakPit,
    capturedSeeds: result.capturedSeeds,
  };

  const pitDisplayNumber = (s.current === 0 ? pitIndex + 1 : pitIndex - nPits + 1);
  const relayText = result.relayHops > 0 ? ` with ${result.relayHops} relay hop${result.relayHops > 1 ? 's' : ''}` : '';
  log.push(makeLog(`${playerId} sowed house #${pitDisplayNumber}${relayText}`, playerId));

  if (result.tembakPit !== undefined && result.capturedSeeds !== undefined) {
    const tembakDisplayNumber = (s.current === 0 ? result.tembakPit + 1 : result.tembakPit - nPits + 1);
    log.push(
      makeLog(
        `${playerId} triggered Tembak at house #${tembakDisplayNumber} capturing ${result.capturedSeeds} seeds!`,
        playerId,
      ),
    );
  }

  if (result.landedInStorehouse) {
    log.push(makeLog(`${playerId} landed in storehouse and earned an extra turn!`, playerId));
  }

  if (result.gameOver) {
    s.phase = 'game_over';
    s.winner = result.winner;
    s.winReason = result.winReason;
    if (result.winner) {
      log.push(
        makeLog(
          `Game over! ${result.winner} wins with ${Math.max(...result.storehouses)} seeds!`,
          result.winner,
        ),
      );
    } else {
      log.push(makeLog('Game over! It is a draw!', null));
    }
  } else {
    s.current = result.nextPlayerIndex;
  }

  player.actionsAccepted += 1;
  s.seq += 1;
  s.rng = rng.state();
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);

  return { ok: true, state: s, log: stamped };
}

/* ------------------------------------------------------------------ */
/* Legal & Auto Actions                                                */
/* ------------------------------------------------------------------ */

function legalActions(s: CongkakState, playerId: string): string[] {
  const pits = legalPits(s, playerId);
  return pits.map((p) => `sow:${p}`);
}

function autoAction(s: CongkakState, playerId: string): CongkakAction {
  const pits = legalPits(s, playerId);
  if (pits.length > 0) {
    return { type: 'sow', pitIndex: pits[0] ?? 0 };
  }
  const nPits = pitsPerSide(s);
  const pIndex = s.players.findIndex((p) => p.id === playerId) as 0 | 1;
  const start = pIndex === 1 ? nPits : 0;
  return { type: 'sow', pitIndex: start };
}

/* ------------------------------------------------------------------ */
/* View & Score                                                        */
/* ------------------------------------------------------------------ */

function view(s: CongkakState, playerId: string | null): CongkakView {
  const meIndex = playerId ? (s.players.findIndex((p) => p.id === playerId) as 0 | 1 | -1) : -1;
  const nPits = pitsPerSide(s);

  return {
    pits: s.pits,
    storehouses: s.storehouses,
    players: s.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      storehouse: p.storehouse,
    })),
    current: s.phase === 'game_over' ? null : (s.players[s.current]?.id ?? null),
    phase: s.phase,
    lastMove: s.lastMove,
    winner: s.winner,
    winReason: s.winReason,
    log: s.log,
    pitsPerSide: nPits,
    you:
      meIndex >= 0 && meIndex < 2
        ? {
            id: s.players[meIndex as 0 | 1].id,
            playerIndex: meIndex as 0 | 1,
            sidePits: playerSideRange(meIndex as 0 | 1, nPits),
          }
        : null,
  };
}

function score(s: CongkakState, playerId: string): ScoreInput {
  const player = playerById(s, playerId);
  if (!player) {
    return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };
  }
  const pIdx = s.players.findIndex((p) => p.id === playerId);
  const storehouseCount =
    pIdx >= 0 && pIdx < 2 ? (s.storehouses[pIdx as 0 | 1] ?? player.storehouse) : player.storehouse;
  const totalSeeds = 2 * (s.config.pitsPerSide ?? 7) * (s.config.seedsPerPit ?? 7);
  const progress = Math.max(0, Math.min(1, storehouseCount / Math.max(1, totalSeeds)));
  const completed = s.winner === playerId;

  return {
    progress,
    accuracy: player.actionsSubmitted > 0 ? player.actionsAccepted / player.actionsSubmitted : 1,
    completed,
    completedAtMs: completed ? s.winnerAtMs : null,
    penalties: player.penalties,
    // Congkak's scoreboard score is the raw seed count in the storehouse
    assetValue: storehouseCount,
  };
}

function isOver(s: CongkakState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const congkak: GameEngine<CongkakState, CongkakAction> = {
  id: 'congkak',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
