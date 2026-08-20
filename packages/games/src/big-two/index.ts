import { rngFrom, type LogEntry, type ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  beats,
  cardId,
  classifyCombo,
  comboLabel,
  dealHands,
  enumerateLegalCombos,
  playerById,
  sameCard,
  THREE_OF_DIAMONDS,
} from './rules.js';
import type {
  BigTwoAction,
  BigTwoCard,
  BigTwoConfig,
  BigTwoPlayer,
  BigTwoState,
  BigTwoView,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: BigTwoState): BigTwoState => structuredClone(s);

const DEFAULT_CONFIG: BigTwoConfig = { turnTimeLimitSec: 60 };

function setup(playerIds: string[], seed: number, rawConfig: unknown): BigTwoState {
  const config: BigTwoConfig = { ...DEFAULT_CONFIG, ...(rawConfig as Partial<BigTwoConfig> | null) };
  const rng = rngFrom({ seed, calls: 0 });
  const hands = dealHands(rng, playerIds.length);

  const players: BigTwoPlayer[] = playerIds.map((id, i) => ({
    id,
    seat: i,
    hand: hands[i] ?? [],
    startingHandSize: (hands[i] ?? []).length,
    actionsSubmitted: 0,
    actionsAccepted: 0,
    penalties: 0,
  }));

  // Whoever holds the 3 of Diamonds leads first.
  const starter = players.findIndex((p) => p.hand.some((c) => sameCard(c, THREE_OF_DIAMONDS)));

  return {
    rng: rng.state(),
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players,
    current: starter >= 0 ? starter : 0,
    phase: 'awaiting_play',
    currentLead: null,
    currentLeaderId: null,
    passedSinceLastPlay: [],
    firstPlayDone: false,
    lastPlay: null,
    winner: null,
    log: [],
  };
}

function advanceTurn(s: BigTwoState): void {
  s.current = (s.current + 1) % s.players.length;
}

function reduce(prev: BigTwoState, playerId: string, action: BigTwoAction): ReduceResult<BigTwoState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const player = playerById(s, playerId);
  const fail = (error: string): ReduceResult<BigTwoState> => ({ ok: false, error });

  if (!player) return fail('Not in this game');
  if (s.phase === 'game_over') return fail('The game is over');
  if (s.players[s.current]?.id !== playerId) return fail('Not your turn');

  player.actionsSubmitted += 1;

  if (action.type === 'pass') {
    if (s.currentLead === null) return fail('You must lead — there is nothing to pass on');
    if (!s.passedSinceLastPlay.includes(playerId)) s.passedSinceLastPlay.push(playerId);
    log.push(makeLog(`${playerId} passes`, playerId));
    advanceTurn(s);
    if (s.players[s.current]?.id === s.currentLeaderId) {
      s.currentLead = null;
      s.currentLeaderId = null;
      s.passedSinceLastPlay = [];
      log.push(makeLog('Everyone passed — the lead is open again', null));
    }
  } else if (action.type === 'play') {
    if (!Array.isArray(action.cards) || ![1, 2, 3, 5].includes(action.cards.length)) {
      return fail('Not a legal combo size');
    }
    // Every requested card must actually be in hand, each used at most once.
    const remaining = [...player.hand];
    const chosen: BigTwoCard[] = [];
    for (const requested of action.cards) {
      const idx = remaining.findIndex((c) => sameCard(c, requested));
      if (idx === -1) return fail('You do not have that card');
      chosen.push(remaining[idx] as BigTwoCard);
      remaining.splice(idx, 1);
    }

    const classified = classifyCombo(chosen);
    if (!classified) return fail('Not a legal combo');
    if (!s.firstPlayDone && !chosen.some((c) => sameCard(c, THREE_OF_DIAMONDS))) {
      return fail('The first play of the game must include the 3 of Diamonds');
    }
    if (!beats(classified, s.currentLead)) return fail('That does not beat the current lead');

    player.hand = remaining;
    s.currentLead = classified;
    s.currentLeaderId = playerId;
    s.passedSinceLastPlay = [];
    s.firstPlayDone = true;
    s.lastPlay = { playerId, cards: classified.cards, category: classified.category };
    log.push(makeLog(`${playerId} plays ${comboLabel(classified)}`, playerId));

    if (player.hand.length === 0) {
      s.phase = 'game_over';
      s.winner = playerId;
      log.push(makeLog(`Game over! ${playerId} empties their hand and wins!`, playerId));
    } else {
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

function legalActions(s: BigTwoState, playerId: string): string[] {
  if (s.phase === 'game_over' || s.players[s.current]?.id !== playerId) return [];
  const player = playerById(s, playerId);
  if (!player) return [];

  const actions: string[] = [];
  if (s.currentLead !== null) actions.push('pass');
  const combos = enumerateLegalCombos(player.hand, s.currentLead, !s.firstPlayDone);
  for (const combo of combos) {
    actions.push(`play:${combo.cards.map(cardId).sort((a, b) => a - b).join(',')}`);
  }
  return actions;
}

function autoAction(s: BigTwoState, playerId: string): BigTwoAction {
  if (s.currentLead !== null) return { type: 'pass' };
  const player = playerById(s, playerId);
  if (!player || player.hand.length === 0) return { type: 'pass' };

  if (!s.firstPlayDone) {
    const threeD = player.hand.find((c) => sameCard(c, THREE_OF_DIAMONDS));
    if (threeD) return { type: 'play', cards: [threeD] };
  }
  const lowest = [...player.hand].sort((a, b) => a.rank * 4 + a.suit - (b.rank * 4 + b.suit))[0] as BigTwoCard;
  return { type: 'play', cards: [lowest] };
}

function view(s: BigTwoState, playerId: string | null): BigTwoView {
  const me = playerId ? playerById(s, playerId) : undefined;
  return {
    players: s.players.map((p) => ({ id: p.id, seat: p.seat, handSize: p.hand.length })),
    current: s.phase === 'game_over' ? null : (s.players[s.current]?.id ?? null),
    phase: s.phase,
    currentLead: s.currentLead,
    currentLeaderId: s.currentLeaderId,
    passedSinceLastPlay: s.passedSinceLastPlay,
    firstPlayDone: s.firstPlayDone,
    lastPlay: s.lastPlay,
    winner: s.winner,
    log: s.log,
    you: me ? { id: me.id, hand: [...me.hand] } : null,
  };
}

function score(s: BigTwoState, playerId: string): ScoreInput {
  const player = playerById(s, playerId);
  if (!player) return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };

  const progress = Math.max(
    0,
    Math.min(1, (player.startingHandSize - player.hand.length) / Math.max(1, player.startingHandSize)),
  );
  const completed = s.winner === playerId;

  return {
    progress,
    accuracy: player.actionsSubmitted > 0 ? player.actionsAccepted / player.actionsSubmitted : 1,
    completed,
    completedAtMs: completed ? s.winnerAtMs : null,
    penalties: player.penalties,
  };
}

function isOver(s: BigTwoState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const bigTwo: GameEngine<BigTwoState, BigTwoAction> = {
  id: 'big-two',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
