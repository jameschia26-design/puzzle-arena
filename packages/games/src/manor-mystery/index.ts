import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  rngFrom,
  type LogEntry,
  type ManorMysteryAction,
  type RoomName,
  type RngState,
  type ScoreInput,
  type SuspectName,
  type WeaponName,
} from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  ALL_CARDS,
  CARD_TYPE,
  DOORS_BY_ROOM,
  SECRET_PASSAGES,
  START_SQUARES,
  type CardId,
  type Position,
  reachable,
  roomAt,
} from './board.js';

export * from './board.js';

export type MMPhase =
  | 'awaiting_action'
  | 'awaiting_move'
  | 'awaiting_suggestion'
  | 'awaiting_refutation'
  | 'awaiting_end_turn'
  | 'game_over';

export interface MMPlayer {
  id: string;
  seat: number;
  suspect: SuspectName;
  hand: CardId[];
  position: Position;
  /** Cards this player has been shown, plus their own hand. Drives progress. */
  eliminated: CardId[];
  /** What was revealed to them, and by whom — private. */
  revelations: { card: CardId; from: string; at: number }[];
  wrongAccusations: number;
  /** A wrong accusation locks you out of moving, suggesting and accusing —
   *  but you must keep refuting. */
  lockedOut: boolean;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface Suggestion {
  suggester: string;
  suspect: SuspectName;
  weapon: WeaponName;
  room: RoomName;
  /** Players still to be asked, in clockwise order. */
  queue: string[];
  /** Who is being asked right now. */
  asking: string | null;
  /** Players already asked who could not refute. */
  nonRefuters: string[];
}

/**
 * Public record of a resolved suggestion. Everything here is already visible to
 * every player at the table — who suggested what, who refuted, and who visibly
 * could not. It is exposed structurally so a deducing player (or bot) does not
 * have to parse the prose log.
 */
export interface SuggestionRecord {
  suggester: string;
  suspect: SuspectName;
  weapon: WeaponName;
  room: RoomName;
  /** Who refuted, or null when nobody could. Never says WHICH card. */
  refutedBy: string | null;
  /** Players who were asked and had none of the three cards. */
  nonRefuters: string[];
}

export interface MMState {
  rng: RngState;
  seq: number;
  /** Monotonic log counter. Logical, never a timestamp — see engine.ts. */
  logSeq: number;
  /** ms from room start at which the winner finished; stamped by the runtime. */
  winnerAtMs: number | null;
  startedAt: number;
  config: { turnTimeLimitSec: number };

  players: MMPlayer[];
  current: number;
  phase: MMPhase;

  /** THE SECRET. Never leaves the server — `view` must never include it. */
  caseFile: { suspect: SuspectName; weapon: WeaponName; room: RoomName };

  suspectPositions: Record<string, Position>;
  weaponPositions: Record<string, RoomName>;

  dice: [number, number] | null;
  roll: number | null;
  pendingSuggestion: Suggestion | null;
  /** Public, structured history of resolved suggestions. */
  history: SuggestionRecord[];

  winner: string | null;
  log: LogEntry[];
}

const clone = (s: MMState): MMState => structuredClone(s);

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setup(playerIds: string[], seed: number, rawConfig: unknown): MMState {
  const rng = rngFrom({ seed, calls: 0 });
  const config = { turnTimeLimitSec: 90, ...(rawConfig as { turnTimeLimitSec?: number } | null) };

  // One of each type goes to the case file; the remaining 18 are dealt.
  const suspects = rng.shuffle([...SUSPECTS]);
  const weapons = rng.shuffle([...WEAPONS]);
  const rooms = rng.shuffle([...ROOMS]);
  const caseFile = {
    suspect: suspects[0] as SuspectName,
    weapon: weapons[0] as WeaponName,
    room: rooms[0] as RoomName,
  };

  const deck = rng.shuffle(
    ALL_CARDS.map((c) => c.id).filter(
      (id) => id !== caseFile.suspect && id !== caseFile.weapon && id !== caseFile.room,
    ),
  );

  const players: MMPlayer[] = playerIds.map((id, seat) => ({
    id,
    seat,
    suspect: SUSPECTS[seat % SUSPECTS.length] as SuspectName,
    hand: [],
    position: {
      room: null,
      x: (START_SQUARES[seat % START_SQUARES.length] as [number, number])[0],
      y: (START_SQUARES[seat % START_SQUARES.length] as [number, number])[1],
    },
    eliminated: [],
    revelations: [],
    wrongAccusations: 0,
    lockedOut: false,
    actionsSubmitted: 0,
    actionsAccepted: 0,
    penalties: 0,
  }));

  // Round-robin deal, so hands are uneven with 4 or 5 players.
  deck.forEach((card, i) => {
    const p = players[i % players.length] as MMPlayer;
    p.hand.push(card);
  });
  for (const p of players) p.eliminated = [...p.hand];

  const suspectPositions: Record<string, Position> = {};
  SUSPECTS.forEach((name, k) => {
    const [x, y] = START_SQUARES[k] as [number, number];
    suspectPositions[name] = { room: null, x, y };
  });
  // Seated players stand on their suspect's start square.
  for (const p of players) {
    suspectPositions[p.suspect] = { ...p.position };
  }

  // Scatter the weapons, one per room, across distinct rooms.
  const weaponRooms = rng.shuffle([...ROOMS]);
  const weaponPositions: Record<string, RoomName> = {};
  WEAPONS.forEach((w, i) => {
    weaponPositions[w] = weaponRooms[i % weaponRooms.length] as RoomName;
  });

  return {
    rng: rng.state(),
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    startedAt: 0,
    config,
    players,
    current: 0,
    phase: 'awaiting_action',
    caseFile,
    suspectPositions,
    weaponPositions,
    dice: null,
    roll: null,
    pendingSuggestion: null,
    history: [],
    winner: null,
    log: [],
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const playerById = (s: MMState, id: string): MMPlayer | undefined =>
  s.players.find((p) => p.id === id);

/** Cells occupied by other players — you cannot stop on or pass through them. */
function blockedCells(s: MMState, selfId: string): Set<string> {
  const out = new Set<string>();
  for (const p of s.players) {
    if (p.id === selfId) continue;
    if (p.position.room === null) out.add(`${p.position.x},${p.position.y}`);
  }
  return out;
}

function eliminate(p: MMPlayer, card: CardId): void {
  if (!p.eliminated.includes(card)) p.eliminated.push(card);
}

function advanceTurn(s: MMState): void {
  s.dice = null;
  s.roll = null;
  s.pendingSuggestion = null;
  // Everyone locked out means nobody can ever win — end it.
  if (s.players.every((p) => p.lockedOut)) {
    s.phase = 'game_over';
    return;
  }
  for (let step = 1; step <= s.players.length; step++) {
    const idx = (s.current + step) % s.players.length;
    if (!(s.players[idx] as MMPlayer).lockedOut) {
      s.current = idx;
      s.phase = 'awaiting_action';
      return;
    }
  }
  s.phase = 'game_over';
}

/** Clockwise order after the suggester, for refutation. */
function refutationQueue(s: MMState, suggesterId: string): string[] {
  const idx = s.players.findIndex((p) => p.id === suggesterId);
  const out: string[] = [];
  for (let step = 1; step < s.players.length; step++) {
    out.push((s.players[(idx + step) % s.players.length] as MMPlayer).id);
  }
  return out;
}

const matchingCards = (p: MMPlayer, sug: Suggestion): CardId[] =>
  p.hand.filter((c) => c === sug.suspect || c === sug.weapon || c === sug.room);

/**
 * Walk the refutation queue until someone can refute (they must) or it runs out.
 * Returns true when the suggestion resolved with nobody able to refute.
 */
function advanceRefutation(s: MMState, log: LogEntry[]): void {
  const sug = s.pendingSuggestion;
  if (!sug) return;

  while (sug.queue.length > 0) {
    const nextId = sug.queue.shift() as string;
    const p = playerById(s, nextId);
    if (!p) continue;
    if (matchingCards(p, sug).length > 0) {
      sug.asking = nextId;
      s.phase = 'awaiting_refutation';
      return;
    }
    // Publicly visible: this player was asked and had nothing.
    sug.nonRefuters.push(nextId);
    log.push(makeLog(`${nextId} cannot refute`, nextId));
  }

  log.push(makeLog('Nobody could refute the suggestion'));
  s.history.push({
    suggester: sug.suggester,
    suspect: sug.suspect,
    weapon: sug.weapon,
    room: sug.room,
    refutedBy: null,
    nonRefuters: [...sug.nonRefuters],
  });
  s.pendingSuggestion = null;
  s.phase = 'awaiting_end_turn';
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

function reduce(
  prev: MMState,
  playerId: string,
  action: ManorMysteryAction,
): ReduceResult<MMState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const rng = rngFrom(s.rng);
  const player = playerById(s, playerId);

  if (!player) return { ok: false, error: 'Not in this game' };
  if (s.phase === 'game_over') return { ok: false, error: 'The game is over' };

  player.actionsSubmitted += 1;
  const fail = (error: string): ReduceResult<MMState> => ({ ok: false, error });
  const onTurn = (s.players[s.current] as MMPlayer).id === playerId;

  switch (action.type) {
    case 'roll': {
      if (!onTurn) return fail('Not your turn');
      if (player.lockedOut) return fail('A wrong accusation locked you out');
      if (s.phase !== 'awaiting_action') return fail('You cannot roll right now');
      const a = rng.range(1, 7);
      const b = rng.range(1, 7);
      s.dice = [a, b];
      s.roll = a + b;
      s.phase = 'awaiting_move';
      log.push(makeLog(`${playerId} rolls ${a} + ${b} = ${a + b}`, playerId));
      break;
    }

    case 'move': {
      if (!onTurn) return fail('Not your turn');
      if (s.phase !== 'awaiting_move' || s.roll === null) return fail('Roll first');

      const targetRoom = roomAt(action.x, action.y);
      const { cells, rooms } = reachable(player.position, s.roll, blockedCells(s, playerId));

      if (targetRoom) {
        if (!rooms.includes(targetRoom)) return fail('That room is out of reach');
        player.position = { room: targetRoom, x: action.x, y: action.y };
        s.suspectPositions[player.suspect] = { ...player.position };
        log.push(makeLog(`${playerId} enters the ${targetRoom}`, playerId));
        // Entering a room ends movement, and lets you suggest.
        s.phase = 'awaiting_suggestion';
      } else {
        if (!cells.some(([x, y]) => x === action.x && y === action.y)) {
          return fail('That square is out of reach');
        }
        player.position = { room: null, x: action.x, y: action.y };
        s.suspectPositions[player.suspect] = { ...player.position };
        s.phase = 'awaiting_end_turn';
      }
      s.roll = null;
      break;
    }

    case 'useSecretPassage': {
      if (!onTurn) return fail('Not your turn');
      if (player.lockedOut) return fail('A wrong accusation locked you out');
      if (s.phase !== 'awaiting_action') return fail('You cannot do that right now');
      const here = player.position.room;
      if (!here) return fail('You are not in a room');
      const target = SECRET_PASSAGES[here];
      if (!target) return fail('This room has no secret passage');

      const rect = DOORS_BY_ROOM[target]?.[0];
      player.position = { room: target, x: rect?.x ?? 0, y: rect?.y ?? 0 };
      s.suspectPositions[player.suspect] = { ...player.position };
      log.push(makeLog(`${playerId} takes the secret passage to the ${target}`, playerId));
      s.phase = 'awaiting_suggestion';
      break;
    }

    case 'suggest': {
      if (!onTurn) return fail('Not your turn');
      if (player.lockedOut) return fail('A wrong accusation locked you out');
      if (s.phase !== 'awaiting_suggestion') return fail('You can only suggest in a room');
      const room = player.position.room;
      if (!room) return fail('You are not in a room');

      // The named suspect and weapon are moved into this room.
      s.suspectPositions[action.suspect] = { room, x: player.position.x, y: player.position.y };
      s.weaponPositions[action.weapon] = room;
      const moved = s.players.find((p) => p.suspect === action.suspect);
      if (moved) moved.position = { room, x: player.position.x, y: player.position.y };

      log.push(
        makeLog(
          `${playerId} suggests ${action.suspect} in the ${room} with the ${action.weapon}`,
          playerId,
        ),
      );

      s.pendingSuggestion = {
        suggester: playerId,
        suspect: action.suspect,
        weapon: action.weapon,
        room,
        queue: refutationQueue(s, playerId),
        asking: null,
        nonRefuters: [],
      };
      advanceRefutation(s, log);
      break;
    }

    case 'refute': {
      const sug = s.pendingSuggestion;
      if (!sug || s.phase !== 'awaiting_refutation') return fail('Nothing to refute');
      if (sug.asking !== playerId) return fail('You are not being asked');
      const options = matchingCards(player, sug);
      if (options.length === 0) return fail('You have nothing to show');
      if (!options.includes(action.card)) return fail('You do not hold that card');

      const suggester = playerById(s, sug.suggester);
      if (suggester) {
        eliminate(suggester, action.card);
        // Logical tick, not wall-clock: this lives in state and must replay.
        suggester.revelations.push({ card: action.card, from: playerId, at: s.seq });
      }
      // Public log names WHO refuted, never WHAT.
      log.push(makeLog(`${playerId} refutes the suggestion`, playerId));
      s.history.push({
        suggester: sug.suggester,
        suspect: sug.suspect,
        weapon: sug.weapon,
        room: sug.room,
        refutedBy: playerId,
        nonRefuters: [...sug.nonRefuters],
      });
      s.pendingSuggestion = null;
      s.phase = 'awaiting_end_turn';
      break;
    }

    case 'accuse': {
      if (!onTurn) return fail('Not your turn');
      if (player.lockedOut) return fail('A wrong accusation locked you out');
      if (s.phase === 'awaiting_refutation') return fail('Resolve the refutation first');

      const correct =
        action.suspect === s.caseFile.suspect &&
        action.weapon === s.caseFile.weapon &&
        action.room === s.caseFile.room;

      if (correct) {
        s.winner = playerId;
        s.phase = 'game_over';
        log.push(
          makeLog(
            `${playerId} accuses ${action.suspect} in the ${action.room} with the ${action.weapon} — and is RIGHT`,
            playerId,
          ),
        );
      } else {
        player.wrongAccusations += 1;
        player.lockedOut = true;
        log.push(
          makeLog(
            `${playerId} accuses ${action.suspect} in the ${action.room} with the ${action.weapon} — and is wrong`,
            playerId,
          ),
        );
        advanceTurn(s);
      }
      break;
    }

    case 'endTurn': {
      if (!onTurn) return fail('Not your turn');
      if (s.phase === 'awaiting_refutation') return fail('Resolve the refutation first');
      if (s.phase === 'awaiting_move') return fail('Move first');
      if (s.phase === 'awaiting_action') return fail('Take your action first');
      advanceTurn(s);
      break;
    }
  }

  player.actionsAccepted += 1;
  s.seq += 1;
  s.rng = rng.state();
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);
  return { ok: true, state: s, log: stamped };
}

/* ------------------------------------------------------------------ */
/* View — the privacy boundary                                         */
/* ------------------------------------------------------------------ */

export interface MMPublicPlayer {
  id: string;
  seat: number;
  suspect: SuspectName;
  handSize: number;
  position: Position;
  wrongAccusations: number;
  lockedOut: boolean;
}

export interface MMView {
  phase: MMPhase;
  current: string | null;
  players: MMPublicPlayer[];
  suspectPositions: Record<string, Position>;
  weaponPositions: Record<string, RoomName>;
  dice: [number, number] | null;
  roll: number | null;
  log: LogEntry[];
  /** Public suggestion history — who asked what, and who refuted (never which card). */
  history: SuggestionRecord[];
  winner: string | null;
  /** Present only for the requesting player. */
  you: {
    id: string;
    hand: CardId[];
    eliminated: CardId[];
    revelations: { card: CardId; from: string; at: number }[];
    /** Where you may move, once you have rolled. */
    reachableCells: [number, number][];
    reachableRooms: RoomName[];
    /** Set only while you are the one being asked to refute. */
    mustRefute: { suspect: string; weapon: string; room: string; options: CardId[] } | null;
  } | null;
}

/**
 * Never include `caseFile`, and never include another player's `hand`,
 * `eliminated` or `revelations`. A spectator (playerId === null) gets no
 * private data at all. This is asserted by tests in bots.test.ts.
 */
function view(s: MMState, playerId: string | null): MMView {
  const me = playerId ? playerById(s, playerId) : undefined;

  const publicPlayers: MMPublicPlayer[] = s.players.map((p) => ({
    id: p.id,
    seat: p.seat,
    suspect: p.suspect,
    handSize: p.hand.length,
    position: p.position,
    wrongAccusations: p.wrongAccusations,
    lockedOut: p.lockedOut,
  }));

  let you: MMView['you'] = null;
  if (me) {
    const sug = s.pendingSuggestion;
    const isAsked = sug?.asking === me.id;
    const canMove = s.phase === 'awaiting_move' && s.roll !== null;
    const reach = canMove
      ? reachable(me.position, s.roll as number, blockedCells(s, me.id))
      : { cells: [], rooms: [] };

    you = {
      id: me.id,
      hand: [...me.hand],
      eliminated: [...me.eliminated],
      revelations: me.revelations.map((r) => ({ ...r })),
      reachableCells: reach.cells,
      reachableRooms: reach.rooms,
      mustRefute:
        isAsked && sug
          ? {
              suspect: sug.suspect,
              weapon: sug.weapon,
              room: sug.room,
              options: matchingCards(me, sug),
            }
          : null,
    };
  }

  return {
    phase: s.phase,
    current: (s.players[s.current] as MMPlayer | undefined)?.id ?? null,
    players: publicPlayers,
    suspectPositions: s.suspectPositions,
    weaponPositions: s.weaponPositions,
    dice: s.dice,
    roll: s.roll,
    log: s.log,
    history: s.history,
    winner: s.winner,
    you,
  };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/** 21 cards minus the 3 in the case file. */
export const ELIMINABLE = 18;

function score(s: MMState, playerId: string): ScoreInput {
  const p = playerById(s, playerId);
  if (!p) {
    return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };
  }
  const completed = s.winner === playerId;
  return {
    progress: Math.min(1, p.eliminated.length / ELIMINABLE),
    accuracy: Math.max(0, 1 - 0.5 * p.wrongAccusations),
    completed,
    completedAtMs: completed ? s.winnerAtMs : null,
    penalties: p.penalties,
  };
}

function isOver(s: MMState): { over: boolean; winner?: string } {
  if (s.winner) return { over: true, winner: s.winner };
  if (s.players.every((p) => p.lockedOut)) return { over: true };
  return { over: false };
}

function legalActions(s: MMState, playerId: string): string[] {
  const p = playerById(s, playerId);
  if (!p || s.phase === 'game_over') return [];
  const out: string[] = [];

  // Refuting is compulsory and happens off-turn.
  if (s.phase === 'awaiting_refutation' && s.pendingSuggestion?.asking === playerId) {
    return ['refute'];
  }

  const onTurn = (s.players[s.current] as MMPlayer).id === playerId;
  if (!onTurn || p.lockedOut) return out;

  switch (s.phase) {
    case 'awaiting_action':
      out.push('roll', 'accuse');
      if (p.position.room && SECRET_PASSAGES[p.position.room]) out.push('useSecretPassage');
      break;
    case 'awaiting_move':
      out.push('move');
      break;
    case 'awaiting_suggestion':
      out.push('suggest', 'accuse', 'endTurn');
      break;
    case 'awaiting_end_turn':
      out.push('accuse', 'endTurn');
      break;
    default:
      break;
  }
  return out;
}

function autoAction(s: MMState, playerId: string): ManorMysteryAction {
  const p = playerById(s, playerId);
  const legal = legalActions(s, playerId);

  if (legal.includes('refute')) {
    const sug = s.pendingSuggestion;
    const options = p && sug ? matchingCards(p, sug) : [];
    return { type: 'refute', card: (options[0] ?? '') as string };
  }
  if (s.phase === 'awaiting_move' && p && s.roll !== null) {
    const { cells, rooms } = reachable(p.position, s.roll, blockedCells(s, playerId));
    if (rooms.length > 0) {
      const target = rooms[0] as RoomName;
      const door = DOORS_BY_ROOM[target]?.[0];
      return { type: 'move', x: door?.x ?? 0, y: door?.y ?? 0 };
    }
    const cell = cells[0];
    if (cell) return { type: 'move', x: cell[0], y: cell[1] };
    // Nowhere to go (fully boxed in): end the turn instead.
    return { type: 'endTurn' };
  }
  if (legal.includes('roll')) return { type: 'roll' };
  if (legal.includes('endTurn')) return { type: 'endTurn' };
  return { type: 'endTurn' };
}

/**
 * Who the game is waiting on. During refutation that is the player being asked,
 * who is deliberately not the player whose turn it is.
 */
export function actorToAct(s: MMState): string | null {
  if (s.phase === 'game_over') return null;
  if (s.phase === 'awaiting_refutation' && s.pendingSuggestion?.asking) {
    return s.pendingSuggestion.asking;
  }
  return (s.players[s.current] as MMPlayer | undefined)?.id ?? null;
}

export const manorMystery: GameEngine<MMState, ManorMysteryAction> = {
  id: 'manor-mystery',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
