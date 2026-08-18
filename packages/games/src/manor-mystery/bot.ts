import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  type BotDifficulty,
  type ManorMysteryAction,
  type RoomName,
  type Rng,
  type SuspectName,
  type WeaponName,
} from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import { DOORS_BY_ROOM, SECRET_PASSAGES, type CardId } from './board.js';

/**
 * The view this policy consumes. Declared locally and deliberately NOT imported
 * from ../manor-mystery/index.js state — if this file could name MMState it
 * could read the case file, which is precisely the cheat we are preventing.
 */
export interface MMBotView {
  phase: string;
  current: string | null;
  players: {
    id: string;
    seat: number;
    suspect: string;
    handSize: number;
    position: { room: string | null; x: number; y: number };
    lockedOut: boolean;
  }[];
  roll: number | null;
  history: {
    suggester: string;
    suspect: string;
    weapon: string;
    room: string;
    refutedBy: string | null;
    nonRefuters: string[];
  }[];
  you: {
    id: string;
    hand: CardId[];
    eliminated: CardId[];
    revelations: { card: CardId; from: string; at: number }[];
    reachableCells: [number, number][];
    reachableRooms: string[];
    mustRefute: { suspect: string; weapon: string; room: string; options: CardId[] } | null;
  } | null;
}

/**
 * Deduce everything the seat legitimately knows.
 *
 * Three knowledge sources, all public or privately ours:
 *  - own hand and cards shown to us (`eliminated`)
 *  - disjunctions: player P refuted a suggestion, so P holds >= 1 of its 3 cards
 *  - negatives: player P was asked and could not refute, so P holds none of them
 *
 * Propagated to fixpoint: if two cards of a disjunction are known not-held by P,
 * P must hold the third — which eliminates it.
 */
export function deduce(v: MMBotView, selfId: string): {
  eliminated: Set<CardId>;
  notHeld: Map<string, Set<CardId>>;
} {
  const eliminated = new Set<CardId>(v.you?.eliminated ?? []);
  const notHeld = new Map<string, Set<CardId>>();
  const noneFor = (id: string): Set<CardId> => {
    let set = notHeld.get(id);
    if (!set) {
      set = new Set();
      notHeld.set(id, set);
    }
    return set;
  };

  // Nobody else holds a card we hold.
  for (const card of v.you?.hand ?? []) {
    for (const p of v.players) if (p.id !== selfId) noneFor(p.id).add(card);
  }
  // A card shown to us is held by its shower, so nobody else has it.
  const heldBy = new Map<CardId, string>();
  for (const r of v.you?.revelations ?? []) heldBy.set(r.card, r.from);
  for (const [card, holder] of heldBy) {
    for (const p of v.players) if (p.id !== holder) noneFor(p.id).add(card);
  }

  const disjunctions: { player: string; cards: CardId[] }[] = [];
  for (const rec of v.history) {
    const cards = [rec.suspect, rec.weapon, rec.room] as CardId[];
    // Anyone who was asked and passed holds none of the three.
    for (const id of rec.nonRefuters) for (const c of cards) noneFor(id).add(c);
    // Whoever refuted holds at least one. If we were the suggester we already
    // know exactly which, via `revelations`, so no disjunction is needed.
    if (rec.refutedBy && rec.suggester !== selfId) {
      disjunctions.push({ player: rec.refutedBy, cards });
    }
  }

  // Propagate to fixpoint.
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const d of disjunctions) {
      const none = noneFor(d.player);
      const live = d.cards.filter((c) => !none.has(c));
      if (live.length === 1) {
        const card = live[0] as CardId;
        if (!eliminated.has(card)) {
          eliminated.add(card);
          changed = true;
        }
        if (!heldBy.has(card)) {
          heldBy.set(card, d.player);
          for (const p of v.players) {
            if (p.id !== d.player && !noneFor(p.id).has(card)) {
              noneFor(p.id).add(card);
              changed = true;
            }
          }
        }
      }
    }
    if (!changed) break;
  }

  return { eliminated, notHeld };
}

const candidatesOf = <T extends string>(all: readonly T[], eliminated: Set<CardId>): T[] =>
  all.filter((c) => !eliminated.has(c as CardId));

export const manorMysteryBot: BotPolicy<MMBotView, ManorMysteryAction> = {
  chooseAction(v, selfId, rng, difficulty): ManorMysteryAction {
    const me = v.players.find((p) => p.id === selfId);
    const { eliminated } = deduce(v, selfId);

    const suspects = candidatesOf(SUSPECTS, eliminated);
    const weapons = candidatesOf(WEAPONS, eliminated);
    const rooms = candidatesOf(ROOMS, eliminated);

    /* ---------------- refuting ---------------- */
    if (v.you?.mustRefute) {
      const options = v.you.mustRefute.options;
      if (options.length === 0) return { type: 'endTurn' };
      if (difficulty === 'easy') {
        return { type: 'refute', card: options[rng.int(options.length)] as CardId };
      }
      // Show the same card whenever possible, so repeat suggestions learn
      // nothing new. A stable ordering achieves that without extra state.
      const stable = [...options].sort();
      return { type: 'refute', card: stable[0] as CardId };
    }

    /* ---------------- accuse when certain ---------------- */
    const certain = suspects.length === 1 && weapons.length === 1 && rooms.length === 1;
    if (certain) {
      return {
        type: 'accuse',
        suspect: suspects[0] as SuspectName,
        weapon: weapons[0] as WeaponName,
        room: rooms[0] as RoomName,
      };
    }

    /* ---------------- movement ---------------- */
    if (v.phase === 'awaiting_move' && v.you) {
      // Prefer a room that is still a candidate.
      const candidateRoom = v.you.reachableRooms.find((r) => rooms.includes(r as never));
      const target = candidateRoom ?? v.you.reachableRooms[0];
      if (target) {
        const door = DOORS_BY_ROOM[target]?.[0];
        if (door) return { type: 'move', x: door.x, y: door.y };
      }
      // Otherwise step toward the nearest candidate room's door.
      const cells = v.you.reachableCells;
      if (cells.length === 0) return { type: 'endTurn' };
      const goals = rooms.flatMap((r) => DOORS_BY_ROOM[r] ?? []);
      let best = cells[0] as [number, number];
      let bestDist = Infinity;
      for (const [x, y] of cells) {
        for (const g of goals) {
          const d = Math.abs(g.cx - x) + Math.abs(g.cy - y);
          if (d < bestDist) {
            bestDist = d;
            best = [x, y];
          }
        }
      }
      return { type: 'move', x: best[0], y: best[1] };
    }

    /* ---------------- start of turn ---------------- */
    if (v.phase === 'awaiting_action') {
      const here = me?.position.room;
      // A secret passage is worth taking when it lands on a candidate room.
      if (here && SECRET_PASSAGES[here]) {
        const dest = SECRET_PASSAGES[here] as string;
        if (rooms.includes(dest as never) && !rooms.includes(here as never)) {
          return { type: 'useSecretPassage' };
        }
      }
      return { type: 'roll' };
    }

    /* ---------------- suggesting ---------------- */
    if (v.phase === 'awaiting_suggestion') {
      const room = me?.position.room;
      if (room) {
        if (difficulty === 'easy') {
          return {
            type: 'suggest',
            suspect: (suspects[rng.int(suspects.length)] ?? SUSPECTS[0]) as SuspectName,
            weapon: (weapons[rng.int(weapons.length)] ?? WEAPONS[0]) as WeaponName,
          };
        }
        // Highest expected information: ask about the candidates that have
        // appeared in the fewest resolved suggestions so far.
        const seen = (card: string): number =>
          v.history.filter((h) => h.suspect === card || h.weapon === card).length;
        const suspect = [...suspects].sort((a, b) => seen(a) - seen(b))[0] ?? SUSPECTS[0];
        const weapon = [...weapons].sort((a, b) => seen(a) - seen(b))[0] ?? WEAPONS[0];
        return {
          type: 'suggest',
          suspect: suspect as SuspectName,
          weapon: weapon as WeaponName,
        };
      }
      return { type: 'endTurn' };
    }

    return { type: 'endTurn' };
  },
};
