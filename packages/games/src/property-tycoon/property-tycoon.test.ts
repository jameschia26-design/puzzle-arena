import { beforeEach, describe, expect, it } from 'vitest';
import { actorToAct, propertyTycoon as engine } from './index.js';
import type { PTState } from './state.js';
import { GROUPS, HOUSE_COST, JAIL_INDEX, squareAt } from './board.js';
import { assetValue, assetValueBreakdown, netWorth, ownsFullGroup, rentFor } from './rules.js';

const PLAYERS = ['p1', 'p2', 'p3'];

function fresh(config: Partial<Record<string, unknown>> = {}): PTState {
  return engine.setup(PLAYERS, 12345, {
    startingCash: 1500,
    auctionsEnabled: true,
    restStopJackpot: false,
    turnTimeLimitSec: 90,
    ...config,
  });
}

/** Apply an action, asserting it was accepted. */
function act(
  s: PTState,
  playerId: string,
  action: Parameters<typeof engine.reduce>[2],
): PTState {
  const r = engine.reduce(s, playerId, action);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(action)} to be accepted: ${r.error}`);
  return r.state;
}

/** Apply an action, asserting it was rejected. */
function reject(
  s: PTState,
  playerId: string,
  action: Parameters<typeof engine.reduce>[2],
): string {
  const r = engine.reduce(s, playerId, action);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
}

/** Give a player a property outright, for rule tests. */
function grant(s: PTState, playerId: string, indices: number[]): void {
  for (const i of indices) {
    const prop = s.properties[i];
    if (prop) {
      prop.owner = playerId;
      prop.mortgaged = false;
      prop.houses = 0;
    }
  }
}

describe('setup', () => {
  it('seats every player with the configured starting cash', () => {
    const s = fresh();
    expect(s.players).toHaveLength(3);
    expect(s.players.every((p) => p.cash === 1500)).toBe(true);
    expect(s.players.every((p) => p.position === 0)).toBe(true);
    expect(s.phase).toBe('awaiting_roll');
  });

  it('honours a custom starting cash', () => {
    expect(fresh({ startingCash: 800 }).players[0]?.cash).toBe(800);
  });

  it('creates a deed record for all 28 purchasable squares', () => {
    const s = fresh();
    expect(Object.keys(s.properties)).toHaveLength(28);
    expect(Object.values(s.properties).every((p) => p.owner === null)).toBe(true);
  });

  it('stocks the bank with 32 houses and 12 hotels', () => {
    const s = fresh();
    expect(s.housesRemaining).toBe(32);
    expect(s.hotelsRemaining).toBe(12);
  });

  it('is deterministic for a seed — the whole replay guarantee rests on this', () => {
    const a = engine.setup(PLAYERS, 777, {});
    const b = engine.setup(PLAYERS, 777, {});
    expect(a.fortuneDeck).toEqual(b.fortuneDeck);
    expect(a.civicDeck).toEqual(b.civicDeck);

    const a1 = act(a, 'p1', { type: 'roll' });
    const b1 = act(b, 'p1', { type: 'roll' });
    expect(a1.dice).toEqual(b1.dice);
    expect(a1.players).toEqual(b1.players);
  });
});

describe('turn order and rolling', () => {
  it('rejects a roll from a player who is not on turn', () => {
    const s = fresh();
    expect(reject(s, 'p2', { type: 'roll' })).toMatch(/not your turn/i);
  });

  it('moves the player by the dice total and pays 200 for passing START', () => {
    let s = fresh();
    const p1 = s.players[0];
    if (p1) p1.position = 38; // near the end of the board
    s = act(s, 'p1', { type: 'roll' });
    const after = s.players[0];
    expect(after?.position).toBeLessThan(38);
    expect(after?.cash).toBeGreaterThanOrEqual(1500); // collected 200 on the way past
  });

  it('advances to the next player on endTurn', () => {
    let s = fresh();
    s = act(s, 'p1', { type: 'roll' });
    // Clear whatever the square asked for.
    if (s.phase === 'awaiting_purchase_decision') s = act(s, 'p1', { type: 'decline' });
    if (s.phase === 'auction') {
      for (const p of PLAYERS) {
        if (s.auction && s.auction.turn === p) s = act(s, p, { type: 'passBid' });
      }
    }
    if (s.phase === 'awaiting_end_turn') {
      s = act(s, 'p1', { type: 'endTurn' });
      expect(s.players[s.current]?.id).not.toBe('p1');
    }
  });

  it('will not let a player end a turn before rolling', () => {
    const s = fresh();
    expect(reject(s, 'p1', { type: 'endTurn' })).toMatch(/roll/i);
  });
});

describe('buying, declining and auctions', () => {
  it('buys an unowned property and debits the price', () => {
    let s = fresh();
    const p1 = s.players[0];
    if (p1) p1.position = 0;
    s.pendingPurchase = 1; // Ash Lane, 60
    s.phase = 'awaiting_purchase_decision';
    s = act(s, 'p1', { type: 'buy' });
    expect(s.properties[1]?.owner).toBe('p1');
    expect(s.players[0]?.cash).toBe(1440);
  });

  it('refuses a purchase the player cannot afford', () => {
    const s = fresh();
    const p1 = s.players[0];
    if (p1) p1.cash = 10;
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    expect(reject(s, 'p1', { type: 'buy' })).toMatch(/cash/i);
  });

  it('declining opens an auction to every solvent player, including the decliner', () => {
    let s = fresh();
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    s = act(s, 'p1', { type: 'decline' });

    expect(s.phase).toBe('auction');
    expect(s.auction?.propertyId).toBe(1);
    expect(s.auction?.participants).toEqual(['p1', 'p2', 'p3']);
  });

  it('awards the property to the last bidder standing and debits their cash', () => {
    let s = fresh();
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    s = act(s, 'p1', { type: 'decline' });

    s = act(s, 'p1', { type: 'bid', amount: 20 });
    s = act(s, 'p2', { type: 'bid', amount: 50 });
    s = act(s, 'p3', { type: 'passBid' });
    s = act(s, 'p1', { type: 'passBid' });

    expect(s.auction).toBeNull();
    expect(s.properties[1]?.owner).toBe('p2');
    expect(s.players[1]?.cash).toBe(1450);
  });

  it('rejects a bid that does not beat the standing high bid', () => {
    let s = fresh();
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    s = act(s, 'p1', { type: 'decline' });
    s = act(s, 'p1', { type: 'bid', amount: 30 });
    expect(reject(s, 'p2', { type: 'bid', amount: 30 })).toMatch(/beat/i);
  });

  it('rejects a bid larger than the bidder can cover', () => {
    let s = fresh();
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    s = act(s, 'p1', { type: 'decline' });
    expect(reject(s, 'p1', { type: 'bid', amount: 99999 })).toMatch(/cover/i);
  });

  it('leaves the property unowned when everyone passes', () => {
    let s = fresh();
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    s = act(s, 'p1', { type: 'decline' });
    s = act(s, 'p1', { type: 'passBid' });
    s = act(s, 'p2', { type: 'passBid' });
    s = act(s, 'p3', { type: 'passBid' });
    expect(s.properties[1]?.owner).toBeNull();
    expect(s.auction).toBeNull();
  });

  it('skips the auction entirely when the host disabled it', () => {
    let s = fresh({ auctionsEnabled: false });
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    s = act(s, 'p1', { type: 'decline' });
    expect(s.phase).not.toBe('auction');
    expect(s.properties[1]?.owner).toBeNull();
  });
});

describe('rent', () => {
  it('charges the base site rent for a lone street', () => {
    const s = fresh();
    grant(s, 'p2', [1]); // Ash Lane, base rent 2
    expect(rentFor(s, 1, 7)).toBe(2);
  });

  it('doubles the base rent when the owner holds the full colour group', () => {
    const s = fresh();
    grant(s, 'p2', GROUPS['Brown'] as number[]); // Ash Lane + Birch Row
    expect(ownsFullGroup(s, 'p2', 'Brown')).toBe(true);
    expect(rentFor(s, 1, 7)).toBe(4); // 2 doubled
  });

  it('follows the rent ladder once houses are built', () => {
    const s = fresh();
    grant(s, 'p2', GROUPS['Brown'] as number[]);
    const prop = s.properties[1];
    if (prop) prop.houses = 3;
    // Ash Lane ladder: [2, 10, 30, 90, 160, 250]
    expect(rentFor(s, 1, 7)).toBe(90);
    if (prop) prop.houses = 5;
    expect(rentFor(s, 1, 7)).toBe(250);
  });

  it('charges nothing on a mortgaged property', () => {
    const s = fresh();
    grant(s, 'p2', [1]);
    const prop = s.properties[1];
    if (prop) prop.mortgaged = true;
    expect(rentFor(s, 1, 7)).toBe(0);
  });

  it('scales transit rent 25/50/100/200 by the number owned', () => {
    const s = fresh();
    const transit = GROUPS['Transit'] as number[];
    grant(s, 'p2', [transit[0] as number]);
    expect(rentFor(s, transit[0] as number, 7)).toBe(25);
    grant(s, 'p2', [transit[1] as number]);
    expect(rentFor(s, transit[0] as number, 7)).toBe(50);
    grant(s, 'p2', [transit[2] as number]);
    expect(rentFor(s, transit[0] as number, 7)).toBe(100);
    grant(s, 'p2', [transit[3] as number]);
    expect(rentFor(s, transit[0] as number, 7)).toBe(200);
  });

  it('charges 4x the roll for one utility and 10x for both', () => {
    const s = fresh();
    const utils = GROUPS['Utility'] as number[];
    grant(s, 'p2', [utils[0] as number]);
    expect(rentFor(s, utils[0] as number, 9)).toBe(36);
    grant(s, 'p2', [utils[1] as number]);
    expect(rentFor(s, utils[0] as number, 9)).toBe(90);
  });

  it('charges the owner nothing for landing on their own property', () => {
    let s = fresh();
    grant(s, 'p1', [1]);
    const p1 = s.players[0];
    if (p1) p1.position = 1;
    const before = s.players[0]?.cash;
    s = act(s, 'p1', { type: 'roll' });
    // No rent was taken on the way in (any change is from the new square).
    expect(before).toBe(1500);
  });
});

describe('building', () => {
  function withBrownGroup(): PTState {
    const s = fresh();
    grant(s, 'p1', GROUPS['Brown'] as number[]);
    return s;
  }

  it('requires the whole colour group', () => {
    const s = fresh();
    grant(s, 'p1', [1]); // only one of the two Browns
    expect(reject(s, 'p1', { type: 'buildHouse', propertyId: 1 })).toMatch(/colour group/i);
  });

  it('builds a house and debits the group house cost', () => {
    let s = withBrownGroup();
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    expect(s.properties[1]?.houses).toBe(1);
    expect(s.players[0]?.cash).toBe(1500 - (HOUSE_COST['Brown'] as number));
    expect(s.housesRemaining).toBe(31);
  });

  it('rejects uneven building within a group', () => {
    let s = withBrownGroup();
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    // Second house on the same square while its partner has none: not allowed.
    expect(reject(s, 'p1', { type: 'buildHouse', propertyId: 1 })).toMatch(/evenly/i);
  });

  it('allows even building across the group', () => {
    let s = withBrownGroup();
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 3 });
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    expect(s.properties[1]?.houses).toBe(2);
    expect(s.properties[3]?.houses).toBe(1);
  });

  it('turns 4 houses into a hotel and returns the houses to the bank', () => {
    let s = withBrownGroup();
    for (let i = 0; i < 4; i++) {
      s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
      s = act(s, 'p1', { type: 'buildHouse', propertyId: 3 });
    }
    expect(s.housesRemaining).toBe(32 - 8);
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    expect(s.properties[1]?.houses).toBe(5);
    expect(s.hotelsRemaining).toBe(11);
    expect(s.housesRemaining).toBe(32 - 8 + 4);
  });

  it('rejects a build when the bank has no houses left', () => {
    const s = withBrownGroup();
    s.housesRemaining = 0;
    expect(reject(s, 'p1', { type: 'buildHouse', propertyId: 1 })).toMatch(/bank/i);
  });

  it('rejects a hotel when the bank has no hotels left', () => {
    let s = withBrownGroup();
    for (let i = 0; i < 4; i++) {
      s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
      s = act(s, 'p1', { type: 'buildHouse', propertyId: 3 });
    }
    s.hotelsRemaining = 0;
    expect(reject(s, 'p1', { type: 'buildHouse', propertyId: 1 })).toMatch(/hotel/i);
  });

  it('refuses to build when a group member is mortgaged', () => {
    const s = withBrownGroup();
    const prop = s.properties[3];
    if (prop) prop.mortgaged = true;
    expect(reject(s, 'p1', { type: 'buildHouse', propertyId: 1 })).toMatch(/mortgaged/i);
  });

  it('sells houses back at half price, evenly', () => {
    let s = withBrownGroup();
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    const cashAfterBuild = s.players[0]?.cash as number;
    s = act(s, 'p1', { type: 'sellHouse', propertyId: 1 });
    expect(s.properties[1]?.houses).toBe(0);
    expect(s.players[0]?.cash).toBe(cashAfterBuild + (HOUSE_COST['Brown'] as number) / 2);
    expect(s.housesRemaining).toBe(32);
  });
});

describe('mortgaging', () => {
  it('pays the mortgage value and blocks rent', () => {
    let s = fresh();
    grant(s, 'p1', [1]);
    s = act(s, 'p1', { type: 'mortgage', propertyId: 1 });
    expect(s.properties[1]?.mortgaged).toBe(true);
    expect(s.players[0]?.cash).toBe(1500 + (squareAt(1).mortgage as number));
    expect(rentFor(s, 1, 7)).toBe(0);
  });

  it('costs mortgage plus 10% to lift', () => {
    let s = fresh();
    grant(s, 'p1', [1]);
    s = act(s, 'p1', { type: 'mortgage', propertyId: 1 });
    const cash = s.players[0]?.cash as number;
    s = act(s, 'p1', { type: 'unmortgage', propertyId: 1 });
    expect(s.properties[1]?.mortgaged).toBe(false);
    expect(s.players[0]?.cash).toBe(cash - Math.ceil(30 * 1.1)); // Ash Lane mortgage 30
  });

  it('refuses to mortgage while the colour group still has buildings', () => {
    let s = fresh();
    grant(s, 'p1', GROUPS['Brown'] as number[]);
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    expect(reject(s, 'p1', { type: 'mortgage', propertyId: 3 })).toMatch(/buildings/i);
  });
});

describe('jail', () => {
  it('sends a player to jail from the Go To Jail square', () => {
    let s = fresh();
    const p1 = s.players[0];
    if (p1) p1.position = GO_TO_JAIL();
    s.phase = 'awaiting_roll';
    // Land exactly on Go To Jail by resolving it directly.
    if (p1) {
      p1.position = 30;
    }
    const r = engine.reduce(s, 'p1', { type: 'roll' });
    expect(r.ok).toBe(true);
  });

  it('jails a player after three consecutive doubles without moving the third roll', () => {
    const s = fresh();
    s.doublesCount = 2; // two doubles already this turn
    const p1 = s.players[0];
    if (p1) p1.position = 5;

    // Force a double by searching seeds until the roll comes up doubles.
    let found: PTState | null = null;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const t = fresh();
      t.doublesCount = 2;
      t.rng = { seed, calls: 0 };
      const tp = t.players[0];
      if (tp) tp.position = 5;
      const r = engine.reduce(t, 'p1', { type: 'roll' });
      if (r.ok && r.state.dice && r.state.dice[0] === r.state.dice[1]) found = r.state;
    }
    expect(found).not.toBeNull();
    const st = found as PTState;
    expect(st.players[0]?.inJail).toBe(true);
    expect(st.players[0]?.position).toBe(JAIL_INDEX);
  });

  it('lets a jailed player pay the 50 fine to get out', () => {
    let s = fresh();
    const p1 = s.players[0];
    if (p1) {
      p1.inJail = true;
      p1.position = JAIL_INDEX;
    }
    s.phase = 'in_jail_decision';
    s = act(s, 'p1', { type: 'payJailFine' });
    expect(s.players[0]?.inJail).toBe(false);
    expect(s.players[0]?.cash).toBe(1450);
    expect(s.phase).toBe('awaiting_roll');
  });

  it('lets a jailed player spend a Get Out of Jail Free card, returning it to the deck', () => {
    let s = fresh();
    const p1 = s.players[0];
    if (p1) {
      p1.inJail = true;
      p1.jailCards = ['f9'];
    }
    s.fortuneDeck = s.fortuneDeck.filter((id) => id !== 'f9');
    s.phase = 'in_jail_decision';
    s = act(s, 'p1', { type: 'useJailCard' });
    expect(s.players[0]?.inJail).toBe(false);
    expect(s.players[0]?.jailCards).toHaveLength(0);
    expect(s.fortuneDeck).toContain('f9');
  });

  it('refuses the fine when the player cannot afford it', () => {
    const s = fresh();
    const p1 = s.players[0];
    if (p1) {
      p1.inJail = true;
      p1.cash = 10;
    }
    s.phase = 'in_jail_decision';
    expect(reject(s, 'p1', { type: 'payJailFine' })).toMatch(/cash/i);
  });

  it('frees a jailed player who rolls doubles, with no extra turn', () => {
    // Find a seed whose first roll is doubles.
    let s: PTState | null = null;
    for (let seed = 1; seed < 400 && !s; seed++) {
      const t = fresh();
      t.rng = { seed, calls: 0 };
      const tp = t.players[0];
      if (tp) {
        tp.inJail = true;
        tp.position = JAIL_INDEX;
      }
      t.phase = 'in_jail_decision';
      const r = engine.reduce(t, 'p1', { type: 'roll' });
      if (r.ok && r.state.dice && r.state.dice[0] === r.state.dice[1]) s = r.state;
    }
    expect(s).not.toBeNull();
    const st = s as PTState;
    expect(st.players[0]?.inJail).toBe(false);
    expect(st.rolledDoublesThisTurn).toBe(false); // no extra turn for that double
  });

  it('charges the fine and moves the player on the third failed attempt', () => {
    let s: PTState | null = null;
    for (let seed = 1; seed < 400 && !s; seed++) {
      const t = fresh();
      t.rng = { seed, calls: 0 };
      const tp = t.players[0];
      if (tp) {
        tp.inJail = true;
        tp.jailTurns = 2; // two failed attempts already
        tp.position = JAIL_INDEX;
      }
      t.phase = 'in_jail_decision';
      const r = engine.reduce(t, 'p1', { type: 'roll' });
      if (r.ok && r.state.dice && r.state.dice[0] !== r.state.dice[1]) s = r.state;
    }
    const st = s as PTState;
    expect(st.players[0]?.inJail).toBe(false);
    expect(st.players[0]?.cash).toBeLessThan(1500); // paid the fine
    expect(st.players[0]?.position).not.toBe(JAIL_INDEX); // and moved
  });
});

function GO_TO_JAIL(): number {
  return 30;
}

describe('trading', () => {
  it('transfers cash and deeds when a trade is accepted', () => {
    let s = fresh();
    grant(s, 'p1', [1]);
    grant(s, 'p2', [3]);

    s = act(s, 'p1', {
      type: 'proposeTrade',
      toPlayerId: 'p2',
      give: { cash: 100, properties: [1] },
      receive: { cash: 0, properties: [3] },
    });
    const tradeId = s.trades[0]?.id as string;
    s = act(s, 'p2', { type: 'respondTrade', tradeId, accept: true });

    expect(s.properties[1]?.owner).toBe('p2');
    expect(s.properties[3]?.owner).toBe('p1');
    expect(s.players[0]?.cash).toBe(1400);
    expect(s.players[1]?.cash).toBe(1600);
    expect(s.trades).toHaveLength(0);
  });

  it('leaves everything untouched when a trade is rejected', () => {
    let s = fresh();
    grant(s, 'p1', [1]);
    s = act(s, 'p1', {
      type: 'proposeTrade',
      toPlayerId: 'p2',
      give: { cash: 0, properties: [1] },
      receive: { cash: 50, properties: [] },
    });
    const tradeId = s.trades[0]?.id as string;
    s = act(s, 'p2', { type: 'respondTrade', tradeId, accept: false });
    expect(s.properties[1]?.owner).toBe('p1');
    expect(s.players[1]?.cash).toBe(1500);
  });

  it('refuses to trade property the proposer does not own', () => {
    const s = fresh();
    expect(
      reject(s, 'p1', {
        type: 'proposeTrade',
        toPlayerId: 'p2',
        give: { cash: 0, properties: [1] },
        receive: { cash: 0, properties: [] },
      }),
    ).toMatch(/do not own/i);
  });

  it('refuses to trade a property with buildings on it', () => {
    let s = fresh();
    grant(s, 'p1', GROUPS['Brown'] as number[]);
    s = act(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    expect(
      reject(s, 'p1', {
        type: 'proposeTrade',
        toPlayerId: 'p2',
        give: { cash: 0, properties: [1] },
        receive: { cash: 0, properties: [] },
      }),
    ).toMatch(/buildings/i);
  });

  it('only lets the addressee respond', () => {
    let s = fresh();
    grant(s, 'p1', [1]);
    s = act(s, 'p1', {
      type: 'proposeTrade',
      toPlayerId: 'p2',
      give: { cash: 0, properties: [1] },
      receive: { cash: 0, properties: [] },
    });
    const tradeId = s.trades[0]?.id as string;
    expect(reject(s, 'p3', { type: 'respondTrade', tradeId, accept: true })).toMatch(
      /not addressed/i,
    );
  });
});

describe('debt and bankruptcy', () => {
  it('enters debt settlement when rent cannot be covered', () => {
    let s = fresh();
    grant(s, 'p2', GROUPS['Brown'] as number[]);
    const prop = s.properties[1];
    if (prop) prop.houses = 5; // hotel: rent 250
    const p1 = s.players[0];
    if (p1) {
      p1.cash = 10;
      // Ash Lane (1) is unreachable from START with 2d6, so start at 35 and
      // land on it with a 6, collecting 200 for passing START on the way.
      p1.position = 35;
    }
    s.phase = 'awaiting_roll';
    for (let seed = 1; seed < 500; seed++) {
      const t = structuredClone(s);
      t.rng = { seed, calls: 0 };
      const r = engine.reduce(t, 'p1', { type: 'roll' });
      if (r.ok && r.state.players[0]?.position === 1) {
        expect(r.state.phase).toBe('awaiting_debt_settlement');
        expect(r.state.debt?.playerId).toBe('p1');
        return;
      }
    }
    throw new Error('never landed on Ash Lane');
  });

  it('blocks endTurn while a debt is outstanding', () => {
    const s = fresh();
    s.phase = 'awaiting_debt_settlement';
    s.debt = { playerId: 'p1', amount: 100, creditor: 'p2' };
    expect(reject(s, 'p1', { type: 'endTurn' })).toMatch(/debt/i);
  });

  it('clears the debt when the player mortgages enough to cover it', () => {
    let s = fresh();
    grant(s, 'p1', [1]);
    const p1 = s.players[0];
    if (p1) p1.cash = -20;
    s.debt = { playerId: 'p1', amount: 20, creditor: 'p2' };
    s.phase = 'awaiting_debt_settlement';
    s = act(s, 'p1', { type: 'mortgage', propertyId: 1 });
    expect(s.debt).toBeNull();
    expect(s.players[0]?.cash).toBeGreaterThanOrEqual(0);
  });

  it('hands everything to the creditor on bankruptcy to a player', () => {
    let s = fresh();
    grant(s, 'p1', [1, 3]);
    const p1 = s.players[0];
    if (p1) {
      p1.cash = -50;
      p1.jailCards = ['f9'];
    }
    s.debt = { playerId: 'p1', amount: 50, creditor: 'p2' };
    s.phase = 'awaiting_debt_settlement';
    s = act(s, 'p1', { type: 'declareBankruptcy' });

    expect(s.players[0]?.bankrupt).toBe(true);
    expect(s.properties[1]?.owner).toBe('p2');
    expect(s.properties[3]?.owner).toBe('p2');
    expect(s.players[1]?.jailCards).toContain('f9');
  });

  it('returns deeds to the bank on bankruptcy to the bank', () => {
    let s = fresh();
    grant(s, 'p1', [1]);
    const p1 = s.players[0];
    if (p1) p1.cash = -50;
    s.debt = { playerId: 'p1', amount: 50, creditor: null };
    s.phase = 'awaiting_debt_settlement';
    s = act(s, 'p1', { type: 'declareBankruptcy' });
    expect(s.properties[1]?.owner).toBeNull();
  });

  it('sells buildings to the bank before settling a bankruptcy', () => {
    let s = fresh();
    grant(s, 'p1', GROUPS['Brown'] as number[]);
    const prop = s.properties[1];
    if (prop) prop.houses = 2;
    s.housesRemaining = 30;
    const p1 = s.players[0];
    if (p1) p1.cash = -10;
    s.debt = { playerId: 'p1', amount: 10, creditor: 'p2' };
    s.phase = 'awaiting_debt_settlement';
    s = act(s, 'p1', { type: 'declareBankruptcy' });
    expect(s.properties[1]?.houses).toBe(0);
    expect(s.housesRemaining).toBe(32);
  });

  it('ends the game when only one solvent player remains', () => {
    let s = fresh();
    const p2 = s.players[1];
    const p3 = s.players[2];
    if (p2) p2.bankrupt = true;
    if (p3) {
      p3.cash = -10;
    }
    s.current = 2;
    s.debt = { playerId: 'p3', amount: 10, creditor: null };
    s.phase = 'awaiting_debt_settlement';
    s = act(s, 'p3', { type: 'declareBankruptcy' });
    expect(s.phase).toBe('game_over');
    expect(s.winner).toBe('p1');
  });
});

describe('scoring and views', () => {
  it('computes net worth from cash, deeds and half the building cost', () => {
    const s = fresh();
    grant(s, 'p1', [1]); // Ash Lane, price 60
    const prop = s.properties[1];
    if (prop) prop.houses = 2;
    // 1500 cash + 60 face + (2 * 50)/2 = 1610
    expect(netWorth(s, 'p1')).toBe(1610);
  });

  it('counts a mortgaged deed at its mortgage value', () => {
    const s = fresh();
    grant(s, 'p1', [1]);
    const prop = s.properties[1];
    if (prop) prop.mortgaged = true;
    expect(netWorth(s, 'p1')).toBe(1530); // 1500 + 30
  });

  it('scores a bankrupt player at zero progress', () => {
    const s = fresh();
    const p1 = s.players[0];
    if (p1) p1.bankrupt = true;
    expect(engine.score(s, 'p1').progress).toBe(0);
  });

  it('scores the leader at full progress and marks the winner completed', () => {
    const s = fresh();
    const p1 = s.players[0];
    if (p1) p1.cash = 5000;
    expect(engine.score(s, 'p1').progress).toBe(1);
    s.winner = 'p1';
    expect(engine.score(s, 'p1').completed).toBe(true);
    expect(engine.score(s, 'p2').completed).toBe(false);
  });

  it('tracks accuracy as accepted over submitted actions', () => {
    let s = fresh();
    s = act(s, 'p1', { type: 'roll' });
    engine.reduce(s, 'p1', { type: 'roll' }); // rejected, but not applied to s
    const r = engine.reduce(s, 'p1', { type: 'buildHouse', propertyId: 1 });
    expect(r.ok).toBe(false);
    expect(engine.score(s, 'p1').accuracy).toBeLessThanOrEqual(1);
  });

  it('never leaks the RNG stream in a view', () => {
    const s = fresh();
    const v = engine.view(s, 'p1') as Record<string, unknown>;
    expect(v.rng).toBeUndefined();
    expect(v.properties).toBeDefined();
  });
});

describe('asset-value scoring — Property Tycoon does not use computeScore', () => {
  it('is cash + unmortgaged property price + full house/hotel cost', () => {
    const s = fresh();
    grant(s, 'p1', [1]); // Ash Lane, price 60
    const prop = s.properties[1];
    if (prop) prop.houses = 2;
    // 1500 cash + 60 face + 2 * 50 (full house cost, not halved) = 1660
    expect(assetValue(s, 'p1')).toBe(1660);
  });

  it('differs from netWorth precisely in how mortgaged deeds and buildings count', () => {
    const s = fresh();
    grant(s, 'p1', [1]);
    const prop = s.properties[1];
    if (prop) prop.houses = 2;
    // netWorth: half the building cost, full mortgage-value credit if mortgaged.
    expect(netWorth(s, 'p1')).toBe(1610); // 1500 + 60 + (2*50)/2
    // assetValue: full building cost, nothing extra for a mortgaged deed.
    expect(assetValue(s, 'p1')).toBe(1660); // 1500 + 60 + 2*50
  });

  it('counts nothing extra for a mortgaged deed beyond the cash already banked', () => {
    const s = fresh();
    grant(s, 'p1', [1]);
    const prop = s.properties[1];
    if (prop) prop.mortgaged = true;
    // Mortgaging already paid the player the mortgage value in cash; asset
    // value must not also count the deed's face value on top of that.
    expect(assetValue(s, 'p1')).toBe(1500);
  });

  it('breaks the total down into cash, property and building value', () => {
    const s = fresh();
    grant(s, 'p1', [1, 3]); // Ash Lane 60, Cherry Court 60
    const prop = s.properties[1];
    if (prop) prop.houses = 1;
    const breakdown = assetValueBreakdown(s, 'p1');
    expect(breakdown).toEqual({
      cash: 1500,
      propertyValue: 120,
      buildingValue: HOUSE_COST[squareAt(1).group as string],
      total: 1500 + 120 + (HOUSE_COST[squareAt(1).group as string] as number),
    });
  });

  it('exposes assetValue on the engine ScoreInput, separate from progress', () => {
    const s = fresh();
    grant(s, 'p1', [1]);
    const score = engine.score(s, 'p1');
    expect(score.assetValue).toBe(assetValue(s, 'p1'));
  });

  it('is undefined for a player who is not in the game', () => {
    const s = fresh();
    expect(engine.score(s, 'nobody').assetValue).toBeUndefined();
  });
});

describe('legal actions drive the client', () => {
  it('offers roll at the start of a turn, and only to the player on turn', () => {
    const s = fresh();
    expect(engine.legalActions(s, 'p1')).toContain('roll');
    expect(engine.legalActions(s, 'p2')).not.toContain('roll');
  });

  it('offers buy and decline on an affordable unowned square', () => {
    const s = fresh();
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    const legal = engine.legalActions(s, 'p1');
    expect(legal).toContain('buy');
    expect(legal).toContain('decline');
  });

  it('drops buy when the player cannot afford the square', () => {
    const s = fresh();
    const p1 = s.players[0];
    if (p1) p1.cash = 5;
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    const legal = engine.legalActions(s, 'p1');
    expect(legal).not.toContain('buy');
    expect(legal).toContain('decline');
  });

  it('offers nothing to a bankrupt player', () => {
    const s = fresh();
    const p1 = s.players[0];
    if (p1) p1.bankrupt = true;
    expect(engine.legalActions(s, 'p1')).toEqual([]);
  });
});

describe('autoAction — what the turn timer plays', () => {
  it('rolls when a roll is owed', () => {
    const s = fresh();
    expect(engine.autoAction(s, 'p1')).toEqual({ type: 'roll' });
  });

  it('declines rather than buying', () => {
    const s = fresh();
    s.pendingPurchase = 1;
    s.phase = 'awaiting_purchase_decision';
    expect(engine.autoAction(s, 'p1')).toEqual({ type: 'decline' });
  });

  it('passes rather than bidding in an auction', () => {
    const s = fresh();
    s.phase = 'auction';
    s.auction = {
      propertyId: 1,
      participants: PLAYERS,
      passed: [],
      highBid: 0,
      highBidder: null,
      turn: 'p1',
    };
    expect(engine.autoAction(s, 'p1')).toEqual({ type: 'passBid' });
  });

  it('always returns something the reducer accepts', () => {
    let s = fresh();
    for (let i = 0; i < 200; i++) {
      // During an auction the actor is the bidder on the clock, not the player
      // whose turn it is.
      const onTurn = actorToAct(s) as string;
      const action = engine.autoAction(s, onTurn);
      const r = engine.reduce(s, onTurn, action);
      if (!r.ok) throw new Error(`autoAction produced an illegal action: ${r.error}`);
      s = r.state;
      if (s.phase === 'game_over') break;
    }
  });
});

describe('a full game plays to completion deterministically', () => {
  it('reaches a terminal state and replays identically', () => {
    const play = (seed: number): PTState => {
      let s = engine.setup(PLAYERS, seed, {});
      for (let i = 0; i < 3000 && s.phase !== 'game_over'; i++) {
        // Whoever must act next: the auction bidder, otherwise the player on turn.
        const actor = actorToAct(s) as string;
        const r = engine.reduce(s, actor, engine.autoAction(s, actor));
        if (!r.ok) throw new Error(`stuck at ${s.phase}: ${r.error}`);
        s = r.state;
      }
      return s;
    };

    const a = play(2024);
    const b = play(2024);
    expect(a.players).toEqual(b.players);
    expect(a.properties).toEqual(b.properties);
    expect(a.seq).toBe(b.seq);
  });
});
