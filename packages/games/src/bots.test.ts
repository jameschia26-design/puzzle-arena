import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import { actorToAct, propertyTycoon } from './property-tycoon/index.js';
import { propertyTycoonBot, type PTBotView } from './property-tycoon/bot.js';
import { manorMystery, type MMState } from './manor-mystery/index.js';
import { manorMysteryBot, deduce, type MMBotView } from './manor-mystery/bot.js';
import { congkak, type CongkakState } from './congkak/index.js';
import { congkakBot, type CongkakBotView } from './congkak/bot.js';
import { checkers, type CheckersState } from './checkers/index.js';
import { checkersBot, type CheckersBotView } from './checkers/bot.js';
import { aeroplaneChess, type AeroplaneChessState } from './aeroplane-chess/index.js';
import { aeroplaneChessBot, type AeroplaneChessBotView } from './aeroplane-chess/bot.js';
import { bigTwo, type BigTwoState } from './big-two/index.js';
import { bigTwoBot, type BigTwoBotView } from './big-two/bot.js';

const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

/* ================================================================== */
/* The no-cheat invariant — the thing most likely to be got wrong      */
/* ================================================================== */

describe('bots only ever see the restricted view', () => {
  it('never hands a Manor Mystery bot the case file or another hand', () => {
    const ids = ['a', 'b', 'c'];
    const state = manorMystery.setup(ids, 909, {});

    for (const selfId of ids) {
      // This is exactly what the runtime passes to chooseAction.
      const view = manorMystery.view(state, selfId) as MMBotView;
      const json = JSON.stringify(view);

      // No case file field, under any name.
      expect(json).not.toContain('caseFile');
      expect((view as unknown as Record<string, unknown>)['caseFile']).toBeUndefined();

      // No other player's cards reach the policy through any channel.
      const knowable = new Set([
        ...(view.you?.hand ?? []),
        ...(view.you?.eliminated ?? []),
        ...(view.you?.revelations ?? []).map((r) => r.card),
      ]);
      for (const other of state.players) {
        if (other.id === selfId) continue;
        for (const card of other.hand) expect(knowable.has(card)).toBe(false);
      }

      // And the public player records carry no card data at all.
      for (const p of view.players) {
        const rec = p as unknown as Record<string, unknown>;
        expect(rec['hand']).toBeUndefined();
        expect(rec['eliminated']).toBeUndefined();
        expect(rec['revelations']).toBeUndefined();
      }
    }
  });

  it('never hands a Property Tycoon bot the RNG stream', () => {
    const state = propertyTycoon.setup(['a', 'b'], 123, {});
    const view = propertyTycoon.view(state, 'a') as Record<string, unknown>;
    // With the RNG in hand a bot could predict every future die roll.
    expect(view['rng']).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });

  it('a bot policy given only the view still produces a legal action', () => {
    for (const difficulty of DIFFICULTIES) {
      const state = propertyTycoon.setup(['a', 'b'], 55, {});
      const view = propertyTycoon.view(state, 'a') as PTBotView;
      const action = propertyTycoonBot.chooseAction(view, 'a', mulberry32(1), difficulty);
      const r = propertyTycoon.reduce(state, 'a', action);
      expect(r.ok).toBe(true);
    }
  });
  it('never hands a Congkak bot the RNG stream', () => {
    const state = congkak.setup(['a', 'b'], 42, {});
    const view = congkak.view(state, 'a') as Record<string, unknown>;
    expect(view['rng']).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });

  it('a congkak bot policy produces legal actions across all difficulties', () => {
    for (const difficulty of DIFFICULTIES) {
      const state = congkak.setup(['a', 'b'], 42, {});
      const view = congkak.view(state, 'a') as CongkakBotView;
      const action = congkakBot.chooseAction(view, 'a', mulberry32(1), difficulty);
      const r = congkak.reduce(state, 'a', action);
      expect(r.ok).toBe(true);
    }
  });

  it('never hands a Checkers bot the RNG stream', () => {
    const state = checkers.setup(['a', 'b'], 42, {});
    const view = checkers.view(state, 'a') as Record<string, unknown>;
    expect(view['rng']).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });

  it('a checkers bot policy produces legal actions across all difficulties', () => {
    for (const difficulty of DIFFICULTIES) {
      const state = checkers.setup(['a', 'b'], 42, {});
      const view = checkers.view(state, 'a') as CheckersBotView;
      const action = checkersBot.chooseAction(view, 'a', mulberry32(1), difficulty);
      const r = checkers.reduce(state, 'a', action);
      expect(r.ok).toBe(true);
    }
  });

  it('never hands an Aeroplane Chess bot the RNG stream', () => {
    const state = aeroplaneChess.setup(['a', 'b'], 42, {});
    const view = aeroplaneChess.view(state, 'a') as Record<string, unknown>;
    expect(view['rng']).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });

  it('an aeroplane chess bot policy produces legal actions across all difficulties', () => {
    for (const difficulty of DIFFICULTIES) {
      const state = aeroplaneChess.setup(['a', 'b'], 42, {});
      const view = aeroplaneChess.view(state, 'a') as AeroplaneChessBotView;
      const action = aeroplaneChessBot.chooseAction(view, 'a', mulberry32(1), difficulty);
      expect(['roll', 'movePlane']).toContain(action.type);
    }
  });

  it('never hands a Big Two bot the RNG stream', () => {
    const state = bigTwo.setup(['a', 'b'], 42, {});
    const view = bigTwo.view(state, 'a') as Record<string, unknown>;
    expect(view['rng']).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });

  it('a big two bot policy produces legal actions across all difficulties', () => {
    for (const difficulty of DIFFICULTIES) {
      const state = bigTwo.setup(['a', 'b'], 42, {});
      const starter = state.players[state.current]!.id;
      const view = bigTwo.view(state, starter) as BigTwoBotView;
      const action = bigTwoBot.chooseAction(view, starter, mulberry32(1), difficulty);
      const r = bigTwo.reduce(state, starter, action);
      expect(r.ok).toBe(true);
    }
  });
});

/* ================================================================== */
/* Manor Mystery deduction                                             */
/* ================================================================== */

describe('manor mystery deduction', () => {
  const baseView = (over: Partial<MMBotView> = {}): MMBotView => ({
    phase: 'awaiting_action',
    current: 'a',
    players: [
      { id: 'a', seat: 0, suspect: 'Ms. Crimson', handSize: 6, position: { room: null, x: 0, y: 0 }, lockedOut: false },
      { id: 'b', seat: 1, suspect: 'Major Ochre', handSize: 6, position: { room: null, x: 1, y: 0 }, lockedOut: false },
      { id: 'c', seat: 2, suspect: 'Mrs. Ivory', handSize: 6, position: { room: null, x: 2, y: 0 }, lockedOut: false },
    ],
    roll: null,
    history: [],
    you: {
      id: 'a',
      hand: [],
      eliminated: [],
      revelations: [],
      reachableCells: [],
      reachableRooms: [],
      mustRefute: null,
    },
    ...over,
  });

  it('starts from its own hand', () => {
    const v = baseView({
      you: { ...(baseView().you as NonNullable<MMBotView['you']>), hand: ['Rope'], eliminated: ['Rope'] },
    });
    expect(deduce(v, 'a').eliminated.has('Rope')).toBe(true);
  });

  it('records that a non-refuter holds none of the three named cards', () => {
    const v = baseView({
      history: [
        {
          suggester: 'a',
          suspect: 'Dr. Mauve',
          weapon: 'Rope',
          room: 'Kitchen',
          refutedBy: null,
          nonRefuters: ['b', 'c'],
        },
      ],
    });
    const { notHeld } = deduce(v, 'a');
    for (const id of ['b', 'c']) {
      expect(notHeld.get(id)?.has('Dr. Mauve')).toBe(true);
      expect(notHeld.get(id)?.has('Rope')).toBe(true);
      expect(notHeld.get(id)?.has('Kitchen')).toBe(true);
    }
  });

  it('resolves a disjunction down to a held card when two are excluded', () => {
    // c refuted a suggestion of {Dr. Mauve, Rope, Kitchen}, so c holds one.
    // We hold Rope, and b's earlier pass proves nothing about c — but a second
    // suggestion shows c does not hold Dr. Mauve.
    const you = baseView().you as NonNullable<MMBotView['you']>;
    const v = baseView({
      you: { ...you, hand: ['Rope'], eliminated: ['Rope'] },
      history: [
        {
          suggester: 'b',
          suspect: 'Dr. Mauve',
          weapon: 'Rope',
          room: 'Kitchen',
          refutedBy: 'c',
          nonRefuters: [],
        },
        {
          suggester: 'b',
          suspect: 'Dr. Mauve',
          weapon: 'Wrench',
          room: 'Library',
          refutedBy: null,
          nonRefuters: ['c', 'a'],
        },
      ],
    });
    const { eliminated } = deduce(v, 'a');
    // c must hold Kitchen: it was Rope (ours) or Dr. Mauve (proved not held) or Kitchen.
    expect(eliminated.has('Kitchen')).toBe(true);
  });

  it('does not invent knowledge from a suggestion it made itself', () => {
    // When we suggested and someone refuted, we were shown the card directly —
    // a disjunction would be redundant, and inventing one must not eliminate
    // anything extra.
    const you = baseView().you as NonNullable<MMBotView['you']>;
    const v = baseView({
      you: { ...you, revelations: [{ card: 'Rope', from: 'b', at: 0 }], eliminated: ['Rope'] },
      history: [
        {
          suggester: 'a',
          suspect: 'Dr. Mauve',
          weapon: 'Rope',
          room: 'Kitchen',
          refutedBy: 'b',
          nonRefuters: [],
        },
      ],
    });
    const { eliminated } = deduce(v, 'a');
    expect(eliminated.has('Rope')).toBe(true);
    expect(eliminated.has('Dr. Mauve')).toBe(false);
    expect(eliminated.has('Kitchen')).toBe(false);
  });

  it('accuses as soon as exactly one candidate of each type remains', () => {
    // Eliminate all but one of each type.
    const eliminated = [
      'Major Ochre', 'Mrs. Ivory', 'Mr. Verde', 'Lady Azure', 'Dr. Mauve',
      'Dagger', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench',
      'Ballroom', 'Conservatory', 'Dining Room', 'Library', 'Billiard Room',
      'Lounge', 'Hall', 'Study',
    ];
    const you = baseView().you as NonNullable<MMBotView['you']>;
    const v = baseView({ you: { ...you, eliminated } });
    const action = manorMysteryBot.chooseAction(v, 'a', mulberry32(1), 'normal');
    expect(action).toEqual({
      type: 'accuse',
      suspect: 'Ms. Crimson',
      weapon: 'Candlestick',
      room: 'Kitchen',
    });
  });

  it('does not accuse while more than one candidate remains', () => {
    const action = manorMysteryBot.chooseAction(baseView(), 'a', mulberry32(1), 'normal');
    expect(action.type).not.toBe('accuse');
  });

  it('shows a stable card when refuting, to leak as little as possible', () => {
    const you = baseView().you as NonNullable<MMBotView['you']>;
    const v = baseView({
      you: {
        ...you,
        hand: ['Rope', 'Kitchen'],
        mustRefute: { suspect: 'Dr. Mauve', weapon: 'Rope', room: 'Kitchen', options: ['Rope', 'Kitchen'] },
      },
    });
    const first = manorMysteryBot.chooseAction(v, 'a', mulberry32(1), 'hard');
    const second = manorMysteryBot.chooseAction(v, 'a', mulberry32(99), 'hard');
    expect(first).toEqual(second); // same view, same card, regardless of rng
    expect(first.type).toBe('refute');
  });
});

/* ================================================================== */
/* Determinism — the replay guarantee                                  */
/* ================================================================== */

describe('bot-only games replay identically', () => {
  it('plays Property Tycoon to the same final state twice', () => {
    const play = (): ReturnType<typeof propertyTycoon.setup> => {
      let s = propertyTycoon.setup(['a', 'b', 'c'], 31415, {});
      const rng = mulberry32(7);
      for (let i = 0; i < 2000 && s.phase !== 'game_over'; i++) {
        const actor = actorToAct(s) as string;
        const difficulty: BotDifficulty =
          actor === 'a' ? 'easy' : actor === 'b' ? 'normal' : 'hard';
        const view = propertyTycoon.view(s, actor) as PTBotView;
        const action = propertyTycoonBot.chooseAction(view, actor, rng, difficulty);
        const r = propertyTycoon.reduce(s, actor, action);
        if (r.ok) {
          s = r.state;
          continue;
        }
        // A policy may occasionally propose something the reducer rejects;
        // fall back to the engine's own minimal legal action, which must work.
        const fallback = propertyTycoon.reduce(s, actor, propertyTycoon.autoAction(s, actor));
        if (!fallback.ok) {
          throw new Error(`stuck at ${s.phase} for ${actor}: ${fallback.error}`);
        }
        s = fallback.state;
      }
      return s;
    };

    const a = play();
    const b = play();
    expect(a.players).toEqual(b.players);
    expect(a.properties).toEqual(b.properties);
    expect(a.seq).toBe(b.seq);
  });

  it('plays Manor Mystery to the same final state twice', () => {
    const play = (): MMState => {
      let s = manorMystery.setup(['a', 'b', 'c'], 2718, {});
      const rng = mulberry32(11);
      for (let i = 0; i < 800 && s.phase !== 'game_over'; i++) {
        const actor =
          s.phase === 'awaiting_refutation' && s.pendingSuggestion?.asking
            ? s.pendingSuggestion.asking
            : (s.players[s.current]?.id as string);
        const view = manorMystery.view(s, actor) as MMBotView;
        const action = manorMysteryBot.chooseAction(view, actor, rng, 'hard');
        const r = manorMystery.reduce(s, actor, action);
        s = r.ok
          ? r.state
          : (manorMystery.reduce(s, actor, manorMystery.autoAction(s, actor)) as {
              ok: true;
              state: MMState;
            }).state;
      }
      return s;
    };

    const a = play();
    const b = play();
    expect(a.players).toEqual(b.players);
    expect(a.caseFile).toEqual(b.caseFile);
    expect(a.winner).toBe(b.winner);
  });
  it('plays Congkak to the same final state twice', () => {
    const play = (): CongkakState => {
      let s = congkak.setup(['a', 'b'], 9876, {});
      const rng = mulberry32(1234);
      for (let i = 0; i < 500 && s.phase !== 'game_over'; i++) {
        const actor = s.players[s.current]?.id as string;
        const difficulty: BotDifficulty = actor === 'a' ? 'hard' : 'normal';
        const view = congkak.view(s, actor) as CongkakBotView;
        const action = congkakBot.chooseAction(view, actor, rng, difficulty);
        const r = congkak.reduce(s, actor, action);
        if (r.ok) {
          s = r.state;
          continue;
        }
        const fallback = congkak.reduce(s, actor, congkak.autoAction(s, actor));
        if (!fallback.ok) throw new Error(`stuck at ${s.phase} for ${actor}`);
        s = fallback.state;
      }
      return s;
    };

    const a = play();
    const b = play();
    expect(a.pits).toEqual(b.pits);
    expect(a.storehouses).toEqual(b.storehouses);
    expect(a.winner).toBe(b.winner);
    expect(a.seq).toBe(b.seq);
  });

  it('plays Checkers to the same final state twice', () => {
    const play = (): CheckersState => {
      let s = checkers.setup(['a', 'b'], 555, {});
      const rng = mulberry32(321);
      for (let i = 0; i < 400 && s.phase !== 'game_over'; i++) {
        const actor = s.players[s.current]?.id as string;
        const difficulty: BotDifficulty = actor === 'a' ? 'hard' : 'normal';
        const view = checkers.view(s, actor) as CheckersBotView;
        const action = checkersBot.chooseAction(view, actor, rng, difficulty);
        const r = checkers.reduce(s, actor, action);
        if (r.ok) {
          s = r.state;
          continue;
        }
        const fallback = checkers.reduce(s, actor, checkers.autoAction(s, actor));
        if (!fallback.ok) throw new Error(`stuck for ${actor}`);
        s = fallback.state;
      }
      return s;
    };

    const a = play();
    const b = play();
    expect(a.board).toEqual(b.board);
    expect(a.winner).toBe(b.winner);
    expect(a.seq).toBe(b.seq);
  });

  it('plays Aeroplane Chess to the same final state twice', () => {
    const play = (): AeroplaneChessState => {
      let s = aeroplaneChess.setup(['a', 'b', 'c'], 909090, {});
      const rng = mulberry32(654);
      for (let i = 0; i < 5000 && s.phase !== 'game_over'; i++) {
        const actor = s.players[s.current]?.id as string;
        const difficulty: BotDifficulty = actor === 'a' ? 'hard' : actor === 'b' ? 'normal' : 'easy';
        const view = aeroplaneChess.view(s, actor) as AeroplaneChessBotView;
        const action = aeroplaneChessBot.chooseAction(view, actor, rng, difficulty);
        const r = aeroplaneChess.reduce(s, actor, action);
        if (r.ok) {
          s = r.state;
          continue;
        }
        const fallback = aeroplaneChess.reduce(s, actor, aeroplaneChess.autoAction(s, actor));
        if (!fallback.ok) throw new Error(`stuck for ${actor}`);
        s = fallback.state;
      }
      return s;
    };

    const a = play();
    const b = play();
    expect(a.players).toEqual(b.players);
    expect(a.winner).toBe(b.winner);
    expect(a.seq).toBe(b.seq);
  });

  it('plays Big Two to the same final state twice', () => {
    const play = (): BigTwoState => {
      let s = bigTwo.setup(['a', 'b', 'c', 'd'], 24680, {});
      const rngs: Record<string, ReturnType<typeof mulberry32>> = {
        a: mulberry32(1),
        b: mulberry32(2),
        c: mulberry32(3),
        d: mulberry32(4),
      };
      for (let i = 0; i < 2000 && s.phase !== 'game_over'; i++) {
        const actor = s.players[s.current]?.id as string;
        const view = bigTwo.view(s, actor) as BigTwoBotView;
        const action = bigTwoBot.chooseAction(view, actor, rngs[actor]!, 'normal');
        const r = bigTwo.reduce(s, actor, action);
        if (!r.ok) throw new Error(`stuck for ${actor}: ${r.error}`);
        s = r.state;
      }
      return s;
    };

    const a = play();
    const b = play();
    expect(a.players).toEqual(b.players);
    expect(a.winner).toBe(b.winner);
    expect(a.seq).toBe(b.seq);
  });

  it('lets a deducing bot eventually solve the mystery rather than guess', () => {
    // Hard bots never guess, so a win here can only come from real deduction.
    let solved = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      let s = manorMystery.setup(['a', 'b', 'c'], seed, {});
      const rng = mulberry32(seed);
      for (let i = 0; i < 1500 && s.phase !== 'game_over'; i++) {
        const actor =
          s.phase === 'awaiting_refutation' && s.pendingSuggestion?.asking
            ? s.pendingSuggestion.asking
            : (s.players[s.current]?.id as string);
        const view = manorMystery.view(s, actor) as MMBotView;
        const action = manorMysteryBot.chooseAction(view, actor, rng, 'hard');
        const r = manorMystery.reduce(s, actor, action);
        s = r.ok
          ? r.state
          : (manorMystery.reduce(s, actor, manorMystery.autoAction(s, actor)) as {
              ok: true;
              state: MMState;
            }).state;
      }
      if (s.winner) {
        solved++;
        // A correct accusation, by construction of the engine.
        expect(s.phase).toBe('game_over');
      }
    }
    expect(solved).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* Property Tycoon policy behaviour                                    */
/* ================================================================== */

describe('property tycoon policy', () => {
  const viewOf = (s: ReturnType<typeof propertyTycoon.setup>, id: string): PTBotView =>
    propertyTycoon.view(s, id) as PTBotView;

  it('buys a property that completes a colour group even when short of reserve', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    // a already holds Ash Lane; Birch Row would complete Brown.
    const ash = s.properties[1];
    if (ash) ash.owner = 'a';
    s.pendingPurchase = 3;
    s.phase = 'awaiting_purchase_decision';
    const pa = s.players[0];
    if (pa) pa.cash = 70; // barely covers the 60 price, below the hard reserve

    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'hard');
    expect(action).toEqual({ type: 'buy' });
  });

  it('declines when the price would eat into the reserve', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    s.pendingPurchase = 39; // Vantage Point, 400
    s.phase = 'awaiting_purchase_decision';
    const pa = s.players[0];
    if (pa) pa.cash = 500; // 500 - 400 = 100 < hard reserve of 250

    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'hard');
    expect(action).toEqual({ type: 'decline' });
  });

  it('an easy bot buys whenever it can afford it', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    s.pendingPurchase = 39;
    s.phase = 'awaiting_purchase_decision';
    const pa = s.players[0];
    if (pa) pa.cash = 420;
    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'easy');
    expect(action).toEqual({ type: 'buy' });
  });

  it('outbids for a property that completes its group', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    const ash = s.properties[1];
    if (ash) ash.owner = 'a';
    s.phase = 'auction';
    s.auction = {
      propertyId: 3, // Birch Row completes Brown for a
      participants: ['a', 'b'],
      passed: [],
      highBid: 50,
      highBidder: 'b',
      turn: 'a',
    };
    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'hard');
    // Valuation is 60 * 1.6 = 96, so 60 is still worth bidding.
    expect(action).toEqual({ type: 'bid', amount: 60 });
  });

  it('passes once the bidding exceeds its valuation', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    s.phase = 'auction';
    s.auction = {
      propertyId: 1,
      participants: ['a', 'b'],
      passed: [],
      highBid: 200, // far above 60 * 0.85
      highBidder: 'b',
      turn: 'a',
    };
    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'hard');
    expect(action).toEqual({ type: 'passBid' });
  });

  it('raises cash by selling buildings before mortgaging when in debt', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    for (const i of [1, 3]) {
      const p = s.properties[i];
      if (p) p.owner = 'a';
    }
    const ash = s.properties[1];
    if (ash) ash.houses = 2;
    s.debt = [{ playerId: 'a', amount: 100, creditor: 'b' }];
    s.phase = 'awaiting_debt_settlement';

    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'normal');
    expect(action).toEqual({ type: 'sellHouse', propertyId: 1 });
  });

  it('declares bankruptcy only when nothing is left to sell', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    s.debt = [{ playerId: 'a', amount: 100, creditor: 'b' }];
    s.phase = 'awaiting_debt_settlement';
    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'normal');
    expect(action).toEqual({ type: 'declareBankruptcy' });
  });

  it('an easy bot never accepts a trade', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    s.trades = [
      {
        id: 't1',
        from: 'b',
        to: 'a',
        give: { cash: 1000, properties: [] },
        receive: { cash: 0, properties: [] },
      },
    ];
    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'easy');
    expect(action).toEqual({ type: 'respondTrade', tradeId: 't1', accept: false });
  });

  it('accepts a clearly favourable trade and rejects a bad one', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    s.trades = [
      {
        id: 't1',
        from: 'b',
        to: 'a',
        give: { cash: 1000, properties: [] },
        receive: { cash: 0, properties: [] },
      },
    ];
    expect(
      propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'hard'),
    ).toEqual({ type: 'respondTrade', tradeId: 't1', accept: true });

    s.trades = [
      {
        id: 't2',
        from: 'b',
        to: 'a',
        give: { cash: 0, properties: [] },
        receive: { cash: 900, properties: [] },
      },
    ];
    expect(
      propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'hard'),
    ).toEqual({ type: 'respondTrade', tradeId: 't2', accept: false });
  });

  it('builds on a completed group when it can afford to', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    for (const i of [1, 3]) {
      const p = s.properties[i];
      if (p) p.owner = 'a';
    }
    s.phase = 'awaiting_end_turn';
    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'hard');
    expect(action.type).toBe('buildHouse');
  });

  it('an easy bot never builds', () => {
    const s = propertyTycoon.setup(['a', 'b'], 5, {});
    for (const i of [1, 3]) {
      const p = s.properties[i];
      if (p) p.owner = 'a';
    }
    s.phase = 'awaiting_end_turn';
    const action = propertyTycoonBot.chooseAction(viewOf(s, 'a'), 'a', mulberry32(1), 'easy');
    expect(action).toEqual({ type: 'endTurn' });
  });
});
