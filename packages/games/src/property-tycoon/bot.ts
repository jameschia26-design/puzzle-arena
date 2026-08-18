import type { BotDifficulty, PropertyTycoonAction, Rng } from '@puzzle-arena/shared';
import { RESERVE, type BotPolicy } from '../bot.js';
import { BOARD, GROUPS, HOUSE_COST, JAIL_FINE, squareAt } from './board.js';

/**
 * The view this policy consumes. Declared locally and deliberately NOT imported
 * from ./state.js — see BotPolicy. If this file could name PTState it could
 * reach for the RNG stream and predict the dice.
 */
export interface PTBotView {
  phase: string;
  current: number;
  players: {
    id: string;
    seat: number;
    cash: number;
    position: number;
    inJail: boolean;
    jailTurns: number;
    jailCards: string[];
    bankrupt: boolean;
  }[];
  properties: Record<number, { owner: string | null; houses: number; mortgaged: boolean }>;
  pendingPurchase: number | null;
  auction: {
    propertyId: number;
    participants: string[];
    passed: string[];
    highBid: number;
    highBidder: string | null;
    turn: string;
  } | null;
  debt: { playerId: string; amount: number; creditor: string | null } | null;
  trades: {
    id: string;
    from: string;
    to: string;
    give: { cash: number; properties: number[] };
    receive: { cash: number; properties: number[] };
  }[];
  housesRemaining: number;
  hotelsRemaining: number;
}

const self = (v: PTBotView, id: string) => v.players.find((p) => p.id === id);

const ownedBy = (v: PTBotView, id: string): number[] =>
  Object.entries(v.properties)
    .filter(([, p]) => p.owner === id)
    .map(([i]) => Number(i));

const ownsGroup = (v: PTBotView, id: string, group: string): boolean =>
  (GROUPS[group] ?? []).every((i) => v.properties[i]?.owner === id);

/** Would buying `index` complete a colour group for `id`? */
function completesGroup(v: PTBotView, id: string, index: number): boolean {
  const sq = squareAt(index);
  if (!sq.group) return false;
  const members = GROUPS[sq.group] ?? [];
  return members.every((i) => i === index || v.properties[i]?.owner === id);
}

/** Would it complete a group for somebody else — i.e. is buying it a block? */
function blocksSomeone(v: PTBotView, id: string, index: number): boolean {
  const sq = squareAt(index);
  if (!sq.group) return false;
  const members = GROUPS[sq.group] ?? [];
  for (const other of v.players) {
    if (other.id === id || other.bankrupt) continue;
    if (members.every((i) => i === index || v.properties[i]?.owner === other.id)) return true;
  }
  return false;
}

/** Groups the bot owns outright, ranked by rent earned per unit of build cost. */
function buildableGroups(v: PTBotView, id: string, difficulty: BotDifficulty): string[] {
  const groups = Object.keys(GROUPS).filter(
    (g) => g !== 'Transit' && g !== 'Utility' && ownsGroup(v, id, g),
  );

  return groups.sort((a, b) => {
    const yieldOf = (g: string): number => {
      const members = GROUPS[g] ?? [];
      const rent = members.reduce((acc, i) => acc + ((squareAt(i).rent?.[1] as number) ?? 0), 0);
      const cost = members.length * (HOUSE_COST[g] ?? 1);
      return cost > 0 ? rent / cost : 0;
    };
    const diff = yieldOf(b) - yieldOf(a);
    if (Math.abs(diff) > 1e-9) return diff;
    // Hard bots break ties toward orange and red — the classic high-traffic set.
    if (difficulty === 'hard') {
      const pref = (g: string): number => (g === 'Orange' ? 0 : g === 'Red' ? 1 : 2);
      return pref(a) - pref(b);
    }
    return 0;
  });
}

export const propertyTycoonBot: BotPolicy<PTBotView, PropertyTycoonAction> = {
  chooseAction(v, selfId, rng, difficulty): PropertyTycoonAction {
    const me = self(v, selfId);
    const reserve = RESERVE[difficulty];
    if (!me) return { type: 'endTurn' };

    /* ---------------- auctions ---------------- */
    if (v.auction && v.auction.turn === selfId) {
      const index = v.auction.propertyId;
      const price = squareAt(index).price ?? 0;
      const m = completesGroup(v, selfId, index)
        ? 1.6
        : blocksSomeone(v, selfId, index)
          ? 1.25
          : difficulty === 'easy'
            ? 0.7
            : 0.85;
      const valuation = price * m;
      const next = v.auction.highBid + 10;
      if (next <= Math.min(valuation, me.cash - reserve)) {
        return { type: 'bid', amount: next };
      }
      return { type: 'passBid' };
    }

    /* ---------------- debt ---------------- */
    if (v.debt && v.debt.playerId === selfId) {
      // Sell buildings evenly first — the most-built square in the biggest group.
      const mine = ownedBy(v, selfId);
      const withHouses = mine
        .filter((i) => (v.properties[i]?.houses ?? 0) > 0)
        .sort((a, b) => (v.properties[b]?.houses ?? 0) - (v.properties[a]?.houses ?? 0));
      if (withHouses[0] !== undefined) {
        return { type: 'sellHouse', propertyId: withHouses[0] };
      }
      // Then mortgage the cheapest property outside a completed group.
      const mortgageable = mine
        .filter((i) => !v.properties[i]?.mortgaged)
        .sort((a, b) => (squareAt(a).price ?? 0) - (squareAt(b).price ?? 0));
      const outsideGroups = mortgageable.filter((i) => {
        const g = squareAt(i).group;
        return !g || !ownsGroup(v, selfId, g);
      });
      const target = outsideGroups[0] ?? mortgageable[0];
      if (target !== undefined) return { type: 'mortgage', propertyId: target };
      // Nothing left to raise.
      return { type: 'declareBankruptcy' };
    }

    /* ---------------- trades addressed to us ---------------- */
    const incoming = v.trades.find((t) => t.to === selfId);
    if (incoming) {
      if (difficulty === 'easy') return { type: 'respondTrade', tradeId: incoming.id, accept: false };
      const value = (indices: number[], forId: string): number =>
        indices.reduce((acc, i) => {
          const price = squareAt(i).price ?? 0;
          return acc + price * (completesGroup(v, forId, i) ? 1.6 : 1);
        }, 0);
      // "give"/"receive" are from the proposer's side.
      const gain = value(incoming.give.properties, selfId) + incoming.give.cash;
      const loss = value(incoming.receive.properties, incoming.from) + incoming.receive.cash;
      return { type: 'respondTrade', tradeId: incoming.id, accept: gain - loss > 0 };
    }

    /* ---------------- jail ---------------- */
    if (v.phase === 'in_jail_decision') {
      const unownedStreets = BOARD.filter(
        (sq) => sq.type === 'street' && v.properties[sq.index]?.owner === null,
      ).length;
      // Worth buying your way out only while there is still board left to claim.
      if (unownedStreets >= 4) {
        if (me.jailCards.length > 0) return { type: 'useJailCard' };
        if (me.cash >= JAIL_FINE + reserve) return { type: 'payJailFine' };
      }
      return { type: 'roll' };
    }

    /* ---------------- buy or decline ---------------- */
    if (v.phase === 'awaiting_purchase_decision' && v.pendingPurchase !== null) {
      const index = v.pendingPurchase;
      const price = squareAt(index).price ?? 0;
      if (me.cash < price) return { type: 'decline' };
      if (difficulty === 'easy') return { type: 'buy' };
      // Always take a property that completes a group, if it can be afforded.
      if (completesGroup(v, selfId, index)) return { type: 'buy' };
      return me.cash - price >= reserve ? { type: 'buy' } : { type: 'decline' };
    }

    /* ---------------- roll ---------------- */
    if (v.phase === 'awaiting_roll') return { type: 'roll' };

    /* ---------------- building, then end the turn ---------------- */
    if (v.phase === 'awaiting_end_turn') {
      if (difficulty !== 'easy') {
        for (const group of buildableGroups(v, selfId, difficulty)) {
          const cost = HOUSE_COST[group] ?? 0;
          if (me.cash - cost < reserve) continue;
          if (v.housesRemaining <= 0) continue;
          const members = GROUPS[group] ?? [];
          if (members.some((i) => v.properties[i]?.mortgaged)) continue;
          // Build evenly: always on the least-built square in the group.
          const least = [...members].sort(
            (a, b) => (v.properties[a]?.houses ?? 0) - (v.properties[b]?.houses ?? 0),
          )[0];
          if (least !== undefined && (v.properties[least]?.houses ?? 0) < 5) {
            return { type: 'buildHouse', propertyId: least };
          }
        }
      }
      return { type: 'endTurn' };
    }

    return { type: 'endTurn' };
  },
};
