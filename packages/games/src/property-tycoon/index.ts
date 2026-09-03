import {
  rngFrom,
  type LogEntry,
  type PropertyTycoonAction,
  type ScoreInput,
} from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  BANK_HOTELS,
  BANK_HOUSES,
  BOARD_SIZE,
  GO_TO_JAIL_INDEX,
  GROUPS,
  HOUSE_COST,
  JAIL_FINE,
  JAIL_INDEX,
  LUXURY_LEVY,
  PASS_START_PAY,
  REVENUE_LEVY_FLAT,
  REVENUE_LEVY_RATE,
  squareAt,
} from './board.js';
import { CARD_BY_ID, CIVIC_DECK, FORTUNE_DECK, type Card } from './cards.js';
import type { PTConfig, PTPlayer, PTState } from './state.js';
import {
  assetValue,
  buildingCounts,
  canBuild,
  canMortgage,
  canSellHouse,
  canUnmortgage,
  liquidationValue,
  livePlayers,
  nearestAhead,
  netWorth,
  nextLiveIndex,
  ownsFullGroup,
  playerById,
  propertiesOf,
  rentFor,
  unmortgageCost,
} from './rules.js';

export * from './board.js';
export * from './cards.js';
export * from './rules.js';
export type * from './state.js';

const clone = (s: PTState): PTState => structuredClone(s);

const DEFAULT_CONFIG: PTConfig = {
  startingCash: 1500,
  auctionsEnabled: true,
  restStopJackpot: false,
  turnTimeLimitSec: 90,
};

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setup(playerIds: string[], seed: number, rawConfig: unknown): PTState {
  const config: PTConfig = { ...DEFAULT_CONFIG, ...(rawConfig as Partial<PTConfig> | null) };
  const rng = rngFrom({ seed, calls: 0 });

  const properties: Record<number, { owner: string | null; houses: number; mortgaged: boolean }> =
    {};
  for (const sq of Object.values(GROUPS).flat()) {
    properties[sq] = { owner: null, houses: 0, mortgaged: false };
  }

  const state: PTState = {
    rng: rng.state(),
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    startedAt: 0,
    config,
    players: playerIds.map((id, seat) => ({
      id,
      seat,
      cash: config.startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      bankrupt: false,
      actionsSubmitted: 0,
      actionsAccepted: 0,
      penalties: 0,
    })),
    properties,
    current: 0,
    phase: 'awaiting_roll',
    dice: null,
    doublesCount: 0,
    rolledDoublesThisTurn: false,
    pendingPurchase: null,
    auction: null,
    debt: [],
    trades: [],
    fortuneDeck: rng.shuffle(FORTUNE_DECK.map((c) => c.id)),
    fortuneIdx: 0,
    civicDeck: rng.shuffle(CIVIC_DECK.map((c) => c.id)),
    civicIdx: 0,
    lastCard: null,
    housesRemaining: BANK_HOUSES,
    hotelsRemaining: BANK_HOTELS,
    restStopPot: 0,
    winner: null,
    log: [],
  };
  state.rng = rng.state();
  return state;
}

/* ------------------------------------------------------------------ */
/* Money movement                                                      */
/* ------------------------------------------------------------------ */

function pay(
  s: PTState,
  from: PTPlayer,
  amount: number,
  to: PTPlayer | null,
  log: LogEntry[],
  reason: string,
): void {
  from.cash -= amount;
  if (to) to.cash += amount;
  else if (s.config.restStopJackpot) s.restStopPot += amount;
  log.push(
    makeLog(
      `${from.id} pays ${amount} ${to ? `to ${to.id}` : 'to the bank'} (${reason})`,
      from.id,
    ),
  );
  if (from.cash < 0) {
    const existing = s.debt.find((d) => d.playerId === from.id);
    if (existing) existing.amount = -from.cash;
    else s.debt.push({ playerId: from.id, amount: -from.cash, creditor: to?.id ?? null });
  }
}

/**
 * Debt can be settled by any means that raises the debtor's cash back to
 * zero or above — mortgaging, selling a house, an accepted trade, even
 * someone else's card effect — not just the handlers that used to check for
 * it explicitly. Called once after every action so no settlement path has
 * to remember to clear it itself, and so multiple simultaneous debtors
 * (e.g. from a "collect from every player" card) each clear independently
 * as they resolve, instead of only whichever one last occupied the single
 * debt slot the state used to have.
 */
function settleClearedDebts(s: PTState): void {
  const had = s.debt.length > 0;
  s.debt = s.debt.filter((d) => {
    const debtor = playerById(s, d.playerId);
    return !!debtor && !debtor.bankrupt && debtor.cash < 0;
  });
  if (had && s.debt.length === 0 && s.phase === 'awaiting_debt_settlement') {
    settlePhase(s);
  }
}

function collect(p: PTPlayer, amount: number, log: LogEntry[], reason: string): void {
  p.cash += amount;
  log.push(makeLog(`${p.id} collects ${amount} (${reason})`, p.id));
}

/* ------------------------------------------------------------------ */
/* Movement and square resolution                                      */
/* ------------------------------------------------------------------ */

function moveTo(
  s: PTState,
  player: PTPlayer,
  target: number,
  log: LogEntry[],
  collectOnPass: boolean,
): void {
  const before = player.position;
  player.position = ((target % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  if (collectOnPass && player.position < before) {
    collect(player, PASS_START_PAY, log, 'passing START');
  }
}

function goToJail(s: PTState, player: PTPlayer, log: LogEntry[]): void {
  player.position = JAIL_INDEX;
  player.inJail = true;
  player.jailTurns = 0;
  s.doublesCount = 0;
  s.rolledDoublesThisTurn = false;
  log.push(makeLog(`${player.id} is sent to Jail`, player.id));
}

function drawCard(s: PTState, deck: 'fortune' | 'civic'): Card | null {
  const ids = deck === 'fortune' ? s.fortuneDeck : s.civicDeck;
  if (ids.length === 0) return null;
  const idx = deck === 'fortune' ? s.fortuneIdx : s.civicIdx;
  const id = ids[idx % ids.length] as string;
  if (deck === 'fortune') s.fortuneIdx = (idx + 1) % ids.length;
  else s.civicIdx = (idx + 1) % ids.length;
  return CARD_BY_ID[id] ?? null;
}

function applyCard(
  s: PTState,
  player: PTPlayer,
  card: Card,
  diceTotal: number,
  log: LogEntry[],
  depth: number,
): void {
  s.lastCard = card;
  log.push(makeLog(`${player.id} draws: ${card.text}`, player.id));
  const e = card.effect;

  switch (e.kind) {
    case 'advanceTo': {
      // "Advance to START (collect 200)" pays once via the square itself; a card
      // whose path merely crosses START pays only when collectIfPass is set.
      if (e.index === 0) {
        player.position = 0;
        collect(player, PASS_START_PAY, log, 'advancing to START');
      } else {
        moveTo(s, player, e.index, log, e.collectIfPass);
      }
      resolveSquare(s, player, diceTotal, log, depth + 1);
      break;
    }
    case 'advanceToNearest': {
      const target = nearestAhead(player.position, e.target);
      moveTo(s, player, target, log, true);
      const owner = s.properties[target]?.owner;
      if (owner && owner !== player.id && !s.properties[target]?.mortgaged) {
        const other = playerById(s, owner);
        const base = rentFor(s, target, diceTotal);
        // Transit pays double; utility pays 10x the roll regardless of how many
        // the owner holds — both are card-specific overrides of normal rent.
        const amount = e.target === 'transit' ? base * 2 : diceTotal * 10;
        if (other) pay(s, player, amount, other, log, 'card rent');
      } else {
        resolveSquare(s, player, diceTotal, log, depth + 1);
      }
      break;
    }
    case 'collect':
      collect(player, e.amount, log, 'card');
      break;
    case 'pay':
      pay(s, player, e.amount, null, log, 'card');
      break;
    case 'collectFromEach': {
      for (const other of livePlayers(s)) {
        if (other.id === player.id) continue;
        pay(s, other, e.amount, player, log, 'card');
      }
      break;
    }
    case 'payEach': {
      for (const other of livePlayers(s)) {
        if (other.id === player.id) continue;
        pay(s, player, e.amount, other, log, 'card');
      }
      break;
    }
    case 'jailCard': {
      player.jailCards.push(card.id);
      // The card leaves the deck while held.
      if (card.deck === 'fortune') s.fortuneDeck = s.fortuneDeck.filter((i) => i !== card.id);
      else s.civicDeck = s.civicDeck.filter((i) => i !== card.id);
      break;
    }
    case 'goToJail':
      goToJail(s, player, log);
      break;
    case 'back3': {
      moveTo(s, player, player.position - 3, log, false);
      resolveSquare(s, player, diceTotal, log, depth + 1);
      break;
    }
    case 'repairs': {
      const { houses, hotels } = buildingCounts(s, player.id);
      const amount = houses * e.perHouse + hotels * e.perHotel;
      if (amount > 0) pay(s, player, amount, null, log, 'repairs');
      break;
    }
  }
}

function resolveSquare(
  s: PTState,
  player: PTPlayer,
  diceTotal: number,
  log: LogEntry[],
  depth = 0,
): void {
  if (depth > 3) return; // guard against card -> card -> card chains
  const sq = squareAt(player.position);

  switch (sq.type) {
    case 'corner': {
      if (sq.index === GO_TO_JAIL_INDEX) {
        goToJail(s, player, log);
      } else if (sq.index === 20 && s.config.restStopJackpot && s.restStopPot > 0) {
        collect(player, s.restStopPot, log, 'the Rest Stop jackpot');
        s.restStopPot = 0;
      }
      break;
    }
    case 'tax': {
      if (sq.name === 'Luxury Levy') {
        pay(s, player, LUXURY_LEVY, null, log, 'Luxury Levy');
      } else {
        // The plan gives the player a choice of a flat 200 or 10% of net worth,
        // but the fixed wire protocol has no action to express that choice, so
        // the engine takes the cheaper option — which is what any rational
        // player would pick anyway.
        const percentage = Math.floor(netWorth(s, player.id) * REVENUE_LEVY_RATE);
        const amount = Math.min(REVENUE_LEVY_FLAT, percentage);
        pay(s, player, amount, null, log, 'Revenue Levy');
      }
      break;
    }
    case 'card': {
      const card = drawCard(s, sq.name === 'Fortune' ? 'fortune' : 'civic');
      if (card) applyCard(s, player, card, diceTotal, log, depth);
      break;
    }
    case 'street':
    case 'transit':
    case 'utility': {
      const prop = s.properties[sq.index];
      if (!prop) break;
      if (prop.owner === null) {
        s.pendingPurchase = sq.index;
      } else if (prop.owner !== player.id && !prop.mortgaged) {
        const owner = playerById(s, prop.owner);
        const rent = rentFor(s, sq.index, diceTotal);
        if (owner && rent > 0) pay(s, player, rent, owner, log, `rent on ${sq.name}`);
      }
      break;
    }
  }
}

/** Choose the phase after a square has resolved. */
function settlePhase(s: PTState): void {
  if (s.debt.length > 0) {
    s.phase = 'awaiting_debt_settlement';
  } else if (s.pendingPurchase !== null) {
    s.phase = 'awaiting_purchase_decision';
  } else {
    s.phase = 'awaiting_end_turn';
  }
}

/* ------------------------------------------------------------------ */
/* Auctions                                                            */
/* ------------------------------------------------------------------ */

function startAuction(s: PTState, propertyId: number, log: LogEntry[]): void {
  // Open to every solvent player, including whoever just declined.
  const participants = livePlayers(s).map((p) => p.id);
  if (participants.length === 0) {
    s.pendingPurchase = null;
    return;
  }
  s.auction = {
    propertyId,
    participants,
    passed: [],
    highBid: 0,
    highBidder: null,
    turn: participants[0] as string,
  };
  s.pendingPurchase = null;
  s.phase = 'auction';
  log.push(makeLog(`${squareAt(propertyId).name} goes to auction (minimum bid 1)`));
}

function advanceAuction(s: PTState, log: LogEntry[]): void {
  const auction = s.auction;
  if (!auction) return;
  const active = auction.participants.filter((p) => !auction.passed.includes(p));

  const finish = (): void => {
    if (auction.highBidder && auction.highBid > 0) {
      const winner = playerById(s, auction.highBidder);
      const prop = s.properties[auction.propertyId];
      if (winner && prop) {
        winner.cash -= auction.highBid;
        prop.owner = winner.id;
        log.push(
          makeLog(
            `${winner.id} wins ${squareAt(auction.propertyId).name} at auction for ${auction.highBid}`,
            winner.id,
          ),
        );
      }
    } else {
      log.push(makeLog(`${squareAt(auction.propertyId).name} received no bids`));
    }
    s.auction = null;
    settlePhase(s);
  };

  if (active.length === 0) return finish();
  // One bidder left standing with a live bid takes it.
  if (active.length === 1 && auction.highBidder === active[0] && auction.highBid > 0) {
    return finish();
  }

  const idx = auction.participants.indexOf(auction.turn);
  for (let step = 1; step <= auction.participants.length; step++) {
    const next = auction.participants[(idx + step) % auction.participants.length] as string;
    if (!auction.passed.includes(next)) {
      auction.turn = next;
      return;
    }
  }
  finish();
}

/* ------------------------------------------------------------------ */
/* Bankruptcy                                                          */
/* ------------------------------------------------------------------ */

function bankrupt(s: PTState, player: PTPlayer, creditorId: string | null, log: LogEntry[]): void {
  player.bankrupt = true;
  const creditor = creditorId ? playerById(s, creditorId) : null;
  const owned = propertiesOf(s, player.id);

  // Buildings always go back to the bank first, at half price.
  for (const index of owned) {
    const prop = s.properties[index];
    const sq = squareAt(index);
    if (!prop || prop.houses === 0 || !sq.group) continue;
    const refund = Math.floor((prop.houses * (HOUSE_COST[sq.group] ?? 0)) / 2);
    if (prop.houses === 5) {
      s.hotelsRemaining += 1;
    } else {
      s.housesRemaining += prop.houses;
    }
    prop.houses = 0;
    player.cash += refund;
  }

  if (creditor) {
    creditor.cash += Math.max(0, player.cash);
    for (const index of owned) {
      const prop = s.properties[index];
      if (prop) prop.owner = creditor.id;
    }
    creditor.jailCards.push(...player.jailCards);
    log.push(makeLog(`${player.id} is bankrupt; everything passes to ${creditor.id}`, player.id));
  } else {
    // Bankruptcy to the bank: the deeds return to the bank and are re-auctioned.
    for (const index of owned) {
      const prop = s.properties[index];
      if (prop) {
        prop.owner = null;
        prop.mortgaged = false;
      }
    }
    // Jail cards go back to the bottom of their decks.
    for (const id of player.jailCards) {
      const card = CARD_BY_ID[id];
      if (card?.deck === 'fortune') s.fortuneDeck.push(id);
      else if (card) s.civicDeck.push(id);
    }
    log.push(makeLog(`${player.id} is bankrupt; the bank reclaims their deeds`, player.id));
  }

  player.jailCards = [];
  player.cash = 0;
  s.debt = s.debt.filter((d) => d.playerId !== player.id);
}

/* ------------------------------------------------------------------ */
/* Turn advancement                                                    */
/* ------------------------------------------------------------------ */

function endTurn(s: PTState, log: LogEntry[]): void {
  s.pendingPurchase = null;
  s.lastCard = null;

  const over = isOver(s);
  if (over.over) {
    s.phase = 'game_over';
    s.winner = over.winner ?? null;
    log.push(makeLog(`Game over — winner: ${s.winner ?? 'nobody'}`));
    return;
  }

  const currentPlayer = s.players[s.current] as PTPlayer;
  // Rolling doubles earns another turn — unless it put you in jail.
  if (s.rolledDoublesThisTurn && !currentPlayer.inJail && !currentPlayer.bankrupt) {
    s.rolledDoublesThisTurn = false;
    s.phase = 'awaiting_roll';
    s.dice = null;
    return;
  }

  s.current = nextLiveIndex(s, s.current);
  s.doublesCount = 0;
  s.rolledDoublesThisTurn = false;
  s.dice = null;
  const next = s.players[s.current] as PTPlayer;
  s.phase = next.inJail ? 'in_jail_decision' : 'awaiting_roll';
}

function isOver(s: PTState): { over: boolean; winner?: string } {
  const live = livePlayers(s);
  if (live.length <= 1) {
    const winner = live[0];
    return winner ? { over: true, winner: winner.id } : { over: true };
  }
  return { over: false };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

function reduce(
  prev: PTState,
  playerId: string,
  action: PropertyTycoonAction,
): ReduceResult<PTState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const rng = rngFrom(s.rng);
  const player = playerById(s, playerId);

  if (!player) return { ok: false, error: 'Not in this game' };
  if (player.bankrupt) return { ok: false, error: 'You are bankrupt' };
  if (s.phase === 'game_over') return { ok: false, error: 'The game is over' };

  player.actionsSubmitted += 1;

  const onTurn = (s.players[s.current] as PTPlayer).id === playerId;
  const fail = (error: string): ReduceResult<PTState> => ({ ok: false, error });

  /** Actions legal off-turn: trading, and building/mortgaging your own stock. */
  const offTurnAllowed = new Set([
    'proposeTrade',
    'respondTrade',
    'bid',
    'passBid',
    'buildHouse',
    'sellHouse',
    'mortgage',
    'unmortgage',
  ]);
  // A debtor must be able to settle even when it is not their turn: a card like
  // "collect 50 from every player" can bankrupt someone who is not on turn.
  const isDebtor = s.debt.some((d) => d.playerId === playerId);
  if (!onTurn && !isDebtor && !offTurnAllowed.has(action.type)) return fail('Not your turn');

  switch (action.type) {
    case 'roll': {
      if (s.phase !== 'awaiting_roll') return fail('You cannot roll right now');
      const a = rng.range(1, 7);
      const b = rng.range(1, 7);
      s.dice = [a, b];
      const total = a + b;
      const doubles = a === b;
      log.push(makeLog(`${playerId} rolls ${a} + ${b} = ${total}`, playerId));

      if (doubles) {
        s.doublesCount += 1;
        // Three consecutive doubles: straight to jail, and the third roll is
        // NOT played out.
        if (s.doublesCount >= 3) {
          goToJail(s, player, log);
          s.rolledDoublesThisTurn = false;
          s.phase = 'awaiting_end_turn';
          break;
        }
        s.rolledDoublesThisTurn = true;
      } else {
        s.rolledDoublesThisTurn = false;
      }

      s.phase = 'resolving_square';
      moveTo(s, player, player.position + total, log, true);
      resolveSquare(s, player, total, log);
      settlePhase(s);
      break;
    }

    case 'buy': {
      if (s.phase !== 'awaiting_purchase_decision' || s.pendingPurchase === null) {
        return fail('Nothing to buy');
      }
      const index = s.pendingPurchase;
      const sq = squareAt(index);
      const price = sq.price ?? 0;
      if (player.cash < price) return fail('Not enough cash');
      player.cash -= price;
      const prop = s.properties[index];
      if (prop) prop.owner = player.id;
      s.pendingPurchase = null;
      log.push(makeLog(`${playerId} buys ${sq.name} for ${price}`, playerId));
      settlePhase(s);
      break;
    }

    case 'decline': {
      if (s.phase !== 'awaiting_purchase_decision' || s.pendingPurchase === null) {
        return fail('Nothing to decline');
      }
      const index = s.pendingPurchase;
      if (s.config.auctionsEnabled) {
        startAuction(s, index, log);
      } else {
        s.pendingPurchase = null;
        log.push(makeLog(`${playerId} declines ${squareAt(index).name}`, playerId));
        settlePhase(s);
      }
      break;
    }

    case 'bid': {
      const auction = s.auction;
      if (!auction || s.phase !== 'auction') return fail('No auction is running');
      if (auction.turn !== playerId) return fail('Not your turn to bid');
      if (auction.passed.includes(playerId)) return fail('You have passed');
      if (action.amount <= auction.highBid) return fail('Bid must beat the current high bid');
      if (action.amount > player.cash) return fail('You cannot cover that bid');
      auction.highBid = action.amount;
      auction.highBidder = playerId;
      log.push(makeLog(`${playerId} bids ${action.amount}`, playerId));
      advanceAuction(s, log);
      break;
    }

    case 'passBid': {
      const auction = s.auction;
      if (!auction || s.phase !== 'auction') return fail('No auction is running');
      if (auction.turn !== playerId) return fail('Not your turn to bid');
      if (!auction.passed.includes(playerId)) auction.passed.push(playerId);
      log.push(makeLog(`${playerId} passes`, playerId));
      advanceAuction(s, log);
      break;
    }

    case 'buildHouse': {
      const reason = canBuild(s, playerId, action.propertyId);
      if (reason) return fail(reason);
      const sq = squareAt(action.propertyId);
      const prop = s.properties[action.propertyId];
      if (!prop) return fail('No such property');
      const cost = HOUSE_COST[sq.group as string] ?? 0;
      player.cash -= cost;
      if (prop.houses === 4) {
        // 4 houses become a hotel; the houses go back to the bank.
        prop.houses = 5;
        s.hotelsRemaining -= 1;
        s.housesRemaining += 4;
        log.push(makeLog(`${playerId} builds a hotel on ${sq.name}`, playerId));
      } else {
        prop.houses += 1;
        s.housesRemaining -= 1;
        log.push(makeLog(`${playerId} builds a house on ${sq.name}`, playerId));
      }
      break;
    }

    case 'sellHouse': {
      const reason = canSellHouse(s, playerId, action.propertyId);
      if (reason) return fail(reason);
      const sq = squareAt(action.propertyId);
      const prop = s.properties[action.propertyId];
      if (!prop) return fail('No such property');
      const refund = Math.floor((HOUSE_COST[sq.group as string] ?? 0) / 2);
      if (prop.houses === 5) {
        prop.houses = 4;
        s.hotelsRemaining += 1;
        s.housesRemaining -= 4;
      } else {
        prop.houses -= 1;
        s.housesRemaining += 1;
      }
      player.cash += refund;
      log.push(makeLog(`${playerId} sells a building on ${sq.name} for ${refund}`, playerId));
      // Debt clearing is handled generically by settleClearedDebts() after
      // every action, not here — see its doc comment.
      break;
    }

    case 'mortgage': {
      const reason = canMortgage(s, playerId, action.propertyId);
      if (reason) return fail(reason);
      const sq = squareAt(action.propertyId);
      const prop = s.properties[action.propertyId];
      if (!prop) return fail('No such property');
      prop.mortgaged = true;
      player.cash += sq.mortgage ?? 0;
      log.push(makeLog(`${playerId} mortgages ${sq.name} for ${sq.mortgage}`, playerId));
      break;
    }

    case 'unmortgage': {
      const reason = canUnmortgage(s, playerId, action.propertyId);
      if (reason) return fail(reason);
      const sq = squareAt(action.propertyId);
      const prop = s.properties[action.propertyId];
      if (!prop) return fail('No such property');
      const cost = unmortgageCost(sq);
      player.cash -= cost;
      prop.mortgaged = false;
      log.push(makeLog(`${playerId} lifts the mortgage on ${sq.name} for ${cost}`, playerId));
      break;
    }

    case 'proposeTrade': {
      const other = playerById(s, action.toPlayerId);
      if (!other || other.bankrupt) return fail('No such player');
      if (other.id === playerId) return fail('You cannot trade with yourself');
      for (const index of action.give.properties) {
        if (s.properties[index]?.owner !== playerId) return fail('You do not own everything offered');
        if ((s.properties[index]?.houses ?? 0) > 0) return fail('Sell buildings before trading');
      }
      for (const index of action.receive.properties) {
        if (s.properties[index]?.owner !== other.id) return fail('They do not own what you asked for');
        if ((s.properties[index]?.houses ?? 0) > 0) return fail('They must sell buildings first');
      }
      if (action.give.cash > player.cash) return fail('You cannot cover that cash offer');
      const tradeId = `t${s.trades.length + 1}_${rng.int(1_000_000)}`;
      s.trades.push({
        id: tradeId,
        from: playerId,
        to: other.id,
        give: action.give,
        receive: action.receive,
      });
      log.push(makeLog(`${playerId} proposes a trade to ${other.id}`, playerId));
      break;
    }

    case 'respondTrade': {
      const idx = s.trades.findIndex((t) => t.id === action.tradeId);
      if (idx === -1) return fail('No such trade');
      const trade = s.trades[idx];
      if (!trade) return fail('No such trade');
      if (trade.to !== playerId) return fail('That trade is not addressed to you');
      s.trades.splice(idx, 1);

      if (!action.accept) {
        log.push(makeLog(`${playerId} rejects the trade`, playerId));
        break;
      }
      const proposer = playerById(s, trade.from);
      if (!proposer || proposer.bankrupt) return fail('The proposer is no longer in the game');
      // Paying $0 is always affordable, even for a player already in debt for
      // an unrelated reason — a trade that hands them cash (receive.cash: 0)
      // is exactly how they might raise it, so this must not reject them.
      if (trade.give.cash > 0 && proposer.cash < trade.give.cash) {
        return fail('The proposer cannot cover their cash');
      }
      if (trade.receive.cash > 0 && player.cash < trade.receive.cash) {
        return fail('You cannot cover that cash');
      }
      for (const index of trade.give.properties) {
        if (s.properties[index]?.owner !== trade.from) return fail('The proposer no longer owns all offered properties');
      }
      for (const index of trade.receive.properties) {
        if (s.properties[index]?.owner !== playerId) return fail('You no longer own all requested properties');
      }
      proposer.cash -= trade.give.cash;
      player.cash += trade.give.cash;
      player.cash -= trade.receive.cash;
      proposer.cash += trade.receive.cash;
      for (const index of trade.give.properties) {
        const prop = s.properties[index];
        if (prop) prop.owner = player.id;
      }
      for (const index of trade.receive.properties) {
        const prop = s.properties[index];
        if (prop) prop.owner = proposer.id;
      }
      log.push(makeLog(`${playerId} accepts the trade with ${proposer.id}`, playerId));
      break;
    }

    case 'payJailFine': {
      if (!player.inJail) return fail('You are not in jail');
      if (player.cash < JAIL_FINE) return fail('Not enough cash');
      player.cash -= JAIL_FINE;
      player.inJail = false;
      player.jailTurns = 0;
      log.push(makeLog(`${playerId} pays the ${JAIL_FINE} fine and leaves Jail`, playerId));
      s.phase = 'awaiting_roll';
      break;
    }

    case 'useJailCard': {
      if (!player.inJail) return fail('You are not in jail');
      const cardId = player.jailCards.shift();
      if (!cardId) return fail('You have no Get Out of Jail Free card');
      // The card returns to the bottom of its deck when used.
      const card = CARD_BY_ID[cardId];
      if (card?.deck === 'fortune') s.fortuneDeck.push(cardId);
      else if (card) s.civicDeck.push(cardId);
      player.inJail = false;
      player.jailTurns = 0;
      log.push(makeLog(`${playerId} uses a Get Out of Jail Free card`, playerId));
      s.phase = 'awaiting_roll';
      break;
    }

    case 'declareBankruptcy': {
      const myDebt = s.debt.find((d) => d.playerId === playerId);
      if (!myDebt && player.cash >= 0) return fail('You are not in debt');
      const wasOnTurn = (s.players[s.current] as PTPlayer).id === playerId;
      bankrupt(s, player, myDebt?.creditor ?? null, log);
      if (wasOnTurn) {
        endTurn(s, log);
      } else {
        // Somebody else was mid-turn; hand the turn back to them.
        const over = isOver(s);
        if (over.over) {
          s.phase = 'game_over';
          s.winner = over.winner ?? null;
          log.push(makeLog(`Game over — winner: ${s.winner ?? 'nobody'}`));
        } else {
          settlePhase(s);
        }
      }
      break;
    }

    case 'endTurn': {
      if (s.phase === 'awaiting_debt_settlement' && s.debt.length > 0) {
        return fail('Settle your debt first');
      }
      if (s.phase === 'auction') return fail('Finish the auction first');
      if (s.phase === 'awaiting_purchase_decision') {
        return fail('Buy or decline the property first');
      }
      if (s.phase === 'awaiting_roll' || s.phase === 'in_jail_decision') {
        return fail('You must roll first');
      }
      endTurn(s, log);
      break;
    }
  }

  // A jailed player who rolls doubles gets out and moves; handled in `roll` via
  // the in_jail_decision phase below.
  player.actionsAccepted += 1;
  s.seq += 1;
  s.rng = rng.state();
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);
  return { ok: true, state: s, log: stamped };
}

/* ------------------------------------------------------------------ */
/* Jail rolling                                                        */
/* ------------------------------------------------------------------ */

/**
 * Rolling while jailed is a distinct flow: doubles free you and move you (with
 * no extra turn), and on the third failed attempt you pay the fine and move the
 * third roll anyway. It is folded into `roll` by pre-processing the phase.
 */
function rollInJail(prev: PTState, playerId: string): ReduceResult<PTState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const rng = rngFrom(s.rng);
  const player = playerById(s, playerId);
  if (!player) return { ok: false, error: 'Not in this game' };

  player.actionsSubmitted += 1;
  const a = rng.range(1, 7);
  const b = rng.range(1, 7);
  s.dice = [a, b];
  const total = a + b;
  log.push(makeLog(`${playerId} rolls ${a} + ${b} in Jail`, playerId));

  if (a === b) {
    player.inJail = false;
    player.jailTurns = 0;
    log.push(makeLog(`${playerId} rolls doubles and leaves Jail`, playerId));
    moveTo(s, player, player.position + total, log, true);
    resolveSquare(s, player, total, log);
    // No extra turn for the double that freed you.
    s.rolledDoublesThisTurn = false;
  } else {
    player.jailTurns += 1;
    if (player.jailTurns >= 3) {
      // Third failed attempt: pay the fine and move the third roll.
      player.cash -= JAIL_FINE;
      player.inJail = false;
      player.jailTurns = 0;
      log.push(makeLog(`${playerId} pays the ${JAIL_FINE} fine after three tries`, playerId));
      if (player.cash < 0) {
        const existing = s.debt.find((d) => d.playerId === playerId);
        if (existing) existing.amount = -player.cash;
        else s.debt.push({ playerId, amount: -player.cash, creditor: null });
      }
      moveTo(s, player, player.position + total, log, true);
      resolveSquare(s, player, total, log);
    } else {
      log.push(makeLog(`${playerId} stays in Jail`, playerId));
    }
  }

  settlePhase(s);
  player.actionsAccepted += 1;
  s.seq += 1;
  s.rng = rng.state();
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);
  return { ok: true, state: s, log: stamped };
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

function legalActions(s: PTState, playerId: string): string[] {
  const player = playerById(s, playerId);
  if (!player || player.bankrupt || s.phase === 'game_over') return [];
  const onTurn = (s.players[s.current] as PTPlayer).id === playerId;
  const out: string[] = [];

  if (s.phase === 'auction' && s.auction) {
    if (s.auction.turn === playerId && !s.auction.passed.includes(playerId)) {
      if (player.cash > s.auction.highBid) out.push('bid');
      out.push('passBid');
    }
    return out;
  }

  if (onTurn) {
    if (s.phase === 'awaiting_roll') out.push('roll');
    if (s.phase === 'in_jail_decision') {
      out.push('roll');
      if (player.cash >= JAIL_FINE) out.push('payJailFine');
      if (player.jailCards.length > 0) out.push('useJailCard');
    }
    if (s.phase === 'awaiting_purchase_decision' && s.pendingPurchase !== null) {
      const price = squareAt(s.pendingPurchase).price ?? 0;
      if (player.cash >= price) out.push('buy');
      out.push('decline');
    }
    if (s.phase === 'awaiting_end_turn') out.push('endTurn');
  }

  // Settling a debt is the debtor's job, on turn or not — and any of
  // several simultaneous debtors (e.g. from a "collect from everyone" card)
  // may resolve their own debt independently, not just whichever one the
  // turn timer happens to be watching.
  if (s.debt.some((d) => d.playerId === playerId)) {
    out.push('declareBankruptcy');
  }

  // Property management is legal off-turn too, as in the real game.
  for (const index of propertiesOf(s, playerId)) {
    if (!canBuild(s, playerId, index)) out.push('buildHouse');
    if (!canSellHouse(s, playerId, index)) out.push('sellHouse');
    if (!canMortgage(s, playerId, index)) out.push('mortgage');
    if (!canUnmortgage(s, playerId, index)) out.push('unmortgage');
  }
  if (s.trades.some((t) => t.to === playerId)) out.push('respondTrade');
  if (!player.bankrupt) out.push('proposeTrade');

  return [...new Set(out)];
}

function view(s: PTState, _playerId: string | null): unknown {
  // Property Tycoon is a game of open information — every board state is public.
  // Only the RNG stream is withheld, because it would predict future dice.
  const { rng: _rng, ...rest } = s;
  return rest;
}

function score(s: PTState, playerId: string): ScoreInput {
  const player = playerById(s, playerId);
  if (!player) {
    return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };
  }

  const live = livePlayers(s);
  const worths = live.map((p) => netWorth(s, p.id));
  const maxWorth = Math.max(1, ...worths);
  const progress = player.bankrupt ? 0 : Math.min(1, netWorth(s, playerId) / maxWorth);

  const completed = s.winner === playerId;
  return {
    progress,
    accuracy:
      player.actionsSubmitted > 0 ? player.actionsAccepted / player.actionsSubmitted : 1,
    completed,
    completedAtMs: completed ? s.winnerAtMs : null,
    penalties: player.penalties,
    // The runtime's leaderboard/results use THIS, not `computeScore`, as
    // Property Tycoon's final score — see the comment on `assetValueBreakdown`
    // in rules.ts for the exact formula and why it differs from `netWorth`.
    assetValue: assetValue(s, playerId),
  };
}

/** Minimal legal action, played on turn timeout or disconnect. */
function autoAction(s: PTState, playerId: string): PropertyTycoonAction {
  const legal = legalActions(s, playerId);
  if (legal.includes('roll')) return { type: 'roll' };
  if (s.phase === 'auction') return { type: 'passBid' };
  // Never auto-buy: declining is the conservative default.
  if (legal.includes('decline')) return { type: 'decline' };
  if (legal.includes('endTurn')) return { type: 'endTurn' };
  if (legal.includes('declareBankruptcy')) return { type: 'declareBankruptcy' };
  return { type: 'endTurn' };
}

function rollFromJailEntry(s: PTState, playerId: string): ReduceResult<PTState> {
  const player = playerById(s, playerId);
  if (!player) return { ok: false, error: 'Not in this game' };
  if ((s.players[s.current] as PTPlayer).id !== playerId) {
    return { ok: false, error: 'Not your turn' };
  }
  return rollInJail(s, playerId);
}

export const propertyTycoon: GameEngine<PTState, PropertyTycoonAction> = {
  id: 'property-tycoon',
  setup,
  reduce(s, playerId, action) {
    // Rolling from jail follows its own rules.
    const result =
      action.type === 'roll' && s.phase === 'in_jail_decision'
        ? rollFromJailEntry(s, playerId)
        : reduce(s, playerId, action);
    // Debt can clear via any settlement path (mortgage, house sale, an
    // accepted trade, ...) — see settleClearedDebts's doc comment.
    if (result.ok) settleClearedDebts(result.state);
    return result;
  },
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};

export { isOver, netWorth as propertyNetWorth };

/**
 * Who the game is waiting on right now. Not always the player whose turn it is:
 * an auction waits on the bidder on the clock, and a debt waits on the debtor,
 * who may have been pushed into it by another player's card.
 */
export function actorToAct(s: PTState): string | null {
  if (s.phase === 'game_over') return null;
  if (s.phase === 'auction' && s.auction) return s.auction.turn;
  if (s.phase === 'awaiting_debt_settlement' && s.debt.length > 0) return s.debt[0]!.playerId;
  return (s.players[s.current] as PTPlayer | undefined)?.id ?? null;
}
