import { rngFrom, type LogEntry, type ScrabbleAction, type ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import { BOARD_SIZE, indexOf } from './board.js';
import { BLANK, RACK_SIZE, freshBag } from './tiles.js';
import {
  consumeFromRack,
  playerById,
  rackValue,
  validatePlacement,
  type PlacementTile,
} from './rules.js';
import type {
  ScrabbleConfig,
  ScrabblePlacedTile,
  ScrabblePlayer,
  ScrabbleState,
} from './state.js';

export * from './board.js';
export * from './tiles.js';
export * from './rules.js';
export * from './dictionary.js';
export type * from './state.js';

const clone = (s: ScrabbleState): ScrabbleState => structuredClone(s);

const DEFAULT_CONFIG: ScrabbleConfig = { turnTimeLimitSec: 90 };

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setup(playerIds: string[], seed: number, rawConfig: unknown): ScrabbleState {
  const config: ScrabbleConfig = {
    ...DEFAULT_CONFIG,
    ...(rawConfig as Partial<ScrabbleConfig> | null),
  };
  const rng = rngFrom({ seed, calls: 0 });
  const bag = rng.shuffle(freshBag());

  const players: ScrabblePlayer[] = playerIds.map((id, seat) => ({
    id,
    seat,
    rack: bag.splice(0, RACK_SIZE),
    score: 0,
    actionsSubmitted: 0,
    actionsAccepted: 0,
    penalties: 0,
  }));

  const board: (ScrabblePlacedTile | null)[] = new Array(BOARD_SIZE * BOARD_SIZE).fill(null);

  const state: ScrabbleState = {
    rng: rng.state(),
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    board,
    bag,
    players,
    current: 0,
    turnPhase: 'awaiting_move',
    passStreak: 0,
    lastPlay: null,
    winner: null,
    winReason: null,
    log: [],
  };
  return state;
}

/* ------------------------------------------------------------------ */
/* End of game                                                         */
/* ------------------------------------------------------------------ */

function maybeEndGame(s: ScrabbleState, log: LogEntry[]): boolean {
  const emptied = s.players.find((p) => p.rack.length === 0);
  if (emptied && s.bag.length === 0) {
    let bonus = 0;
    for (const p of s.players) {
      if (p.id === emptied.id) continue;
      const value = rackValue(p.rack);
      p.score -= value;
      bonus += value;
    }
    emptied.score += bonus;
    s.winner = emptied.id;
    s.winReason = 'emptied-rack';
    s.turnPhase = 'game_over';
    log.push(makeLog(`${emptied.id} played their last tile — game over`, emptied.id));
    return true;
  }

  if (s.passStreak >= 6) {
    s.turnPhase = 'game_over';
    s.winReason = 'six-passes';
    // Standard end-of-game adjustment: since nobody emptied their rack here,
    // every player's final score is reduced by the value of the tiles still
    // in their own rack — the symmetric case to the emptied-rack path above,
    // which credits that value to whoever went out instead.
    for (const p of s.players) {
      const value = rackValue(p.rack);
      if (value > 0) p.score -= value;
    }
    let best = s.players[0] as ScrabblePlayer;
    for (const p of s.players) {
      if (p.score > best.score || (p.score === best.score && p.seat < best.seat)) best = p;
    }
    s.winner = best.id;
    log.push(makeLog('Six consecutive scoreless turns — game over', null));
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

function reduce(
  prev: ScrabbleState,
  playerId: string,
  action: ScrabbleAction,
): ReduceResult<ScrabbleState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const rng = rngFrom(s.rng);
  const player = playerById(s, playerId);
  const fail = (error: string): ReduceResult<ScrabbleState> => ({ ok: false, error });

  if (!player) return fail('Not in this game');
  if (s.turnPhase === 'game_over') return fail('The game is over');
  if (s.players[s.current]?.id !== playerId) return fail('Not your turn');

  player.actionsSubmitted += 1;

  switch (action.type) {
    case 'place': {
      const tiles: PlacementTile[] = action.tiles.map((t) => ({
        row: t.row,
        col: t.col,
        letter: t.letter,
        isBlank: t.isBlank ?? false,
      }));
      const validated = validatePlacement(s, playerId, tiles);
      if (!validated.ok) return fail(validated.error);
      const { result } = validated;

      for (const t of tiles) {
        consumeFromRack(player.rack, t.letter, t.isBlank);
        s.board[indexOf(t.row, t.col)] = { letter: t.letter, isBlank: t.isBlank, playerId };
      }
      player.score += result.totalScore;
      const primary = result.words[0];
      s.lastPlay = primary ? { word: primary.word, score: result.totalScore, playerId } : null;

      const wordList = result.words.map((w) => w.word).join(', ');
      log.push(
        makeLog(
          `${playerId} plays ${wordList} for ${result.totalScore}${
            result.bingo ? ' (bingo! +50)' : ''
          }`,
          playerId,
        ),
      );

      const need = RACK_SIZE - player.rack.length;
      if (need > 0) player.rack.push(...s.bag.splice(0, Math.min(need, s.bag.length)));
      s.passStreak = 0;
      break;
    }

    case 'exchange': {
      if (s.bag.length < RACK_SIZE) return fail('Not enough tiles left in the bag to exchange');
      const check = [...player.rack];
      for (const letter of action.letters) {
        if (!consumeFromRack(check, letter, letter === BLANK)) {
          return fail('You do not have those tiles');
        }
      }
      for (const letter of action.letters) consumeFromRack(player.rack, letter, letter === BLANK);
      s.bag.push(...action.letters);
      rng.shuffle(s.bag);
      player.rack.push(...s.bag.splice(0, action.letters.length));
      log.push(
        makeLog(
          `${playerId} exchanges ${action.letters.length} tile${
            action.letters.length === 1 ? '' : 's'
          }`,
          playerId,
        ),
      );
      s.passStreak += 1;
      break;
    }

    case 'pass': {
      log.push(makeLog(`${playerId} passes`, playerId));
      s.passStreak += 1;
      break;
    }
  }

  player.actionsAccepted += 1;

  if (!maybeEndGame(s, log)) {
    s.current = (s.current + 1) % s.players.length;
  }

  s.seq += 1;
  s.rng = rng.state();
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);
  return { ok: true, state: s, log: stamped };
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

function legalActions(s: ScrabbleState, playerId: string): string[] {
  if (s.turnPhase === 'game_over') return [];
  if (s.players[s.current]?.id !== playerId) return [];
  const out = ['place', 'pass'];
  if (s.bag.length >= RACK_SIZE) out.push('exchange');
  return out;
}

function autoAction(_s: ScrabbleState, _playerId: string): ScrabbleAction {
  // Never auto-play a placement: passing is the conservative default, exactly
  // like Property Tycoon never auto-buys.
  return { type: 'pass' };
}

export interface ScrabblePublicPlayer {
  id: string;
  seat: number;
  rackSize: number;
  score: number;
}

export interface ScrabbleView {
  board: (ScrabblePlacedTile | null)[];
  bagCount: number;
  players: ScrabblePublicPlayer[];
  current: string | null;
  turnPhase: ScrabbleState['turnPhase'];
  passStreak: number;
  lastPlay: { word: string; score: number; playerId: string } | null;
  winner: string | null;
  winReason: ScrabbleState['winReason'];
  log: LogEntry[];
  /** Present only for the requesting player — nobody else's rack is ever exposed. */
  you: { id: string; rack: string[] } | null;
}

function view(s: ScrabbleState, playerId: string | null): ScrabbleView {
  const me = playerId ? playerById(s, playerId) : undefined;
  return {
    board: s.board,
    bagCount: s.bag.length,
    players: s.players.map((p) => ({ id: p.id, seat: p.seat, rackSize: p.rack.length, score: p.score })),
    current: s.players[s.current]?.id ?? null,
    turnPhase: s.turnPhase,
    passStreak: s.passStreak,
    lastPlay: s.lastPlay,
    winner: s.winner,
    winReason: s.winReason,
    log: s.log,
    you: me ? { id: me.id, rack: [...me.rack] } : null,
  };
}

function score(s: ScrabbleState, playerId: string): ScoreInput {
  const player = playerById(s, playerId);
  if (!player) {
    return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };
  }
  const maxScore = Math.max(1, ...s.players.map((p) => p.score));
  const progress = Math.max(0, Math.min(1, player.score / maxScore));
  const completed = s.winner === playerId;
  return {
    progress,
    accuracy: player.actionsSubmitted > 0 ? player.actionsAccepted / player.actionsSubmitted : 1,
    completed,
    completedAtMs: completed ? s.winnerAtMs : null,
    penalties: player.penalties,
    // Scrabble's scoreboard result is the raw point total, not the generic
    // progress/accuracy/speed blend — same escape hatch Property Tycoon uses
    // for asset value. See packages/shared/src/scoring.ts.
    assetValue: player.score,
  };
}

function isOver(s: ScrabbleState): { over: boolean; winner?: string } {
  if (s.turnPhase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const scrabble: GameEngine<ScrabbleState, ScrabbleAction> = {
  id: 'scrabble',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};

/** Whoever the game is waiting on right now, or null once it's over. */
export function actorToAct(s: ScrabbleState): string | null {
  if (s.turnPhase === 'game_over') return null;
  return s.players[s.current]?.id ?? null;
}
