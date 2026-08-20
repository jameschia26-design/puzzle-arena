import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import { absoluteSquare, actorToAct, aeroplaneChess as engine, HOME_STEP } from './index.js';
import { aeroplaneChessBot, type AeroplaneChessBotView } from './bot.js';

describe('aeroplane chess engine', () => {
  it('seats 2 players in opposite quadrants and 4 in all four', () => {
    const two = engine.setup(['alice', 'bob'], 1, {});
    expect(two.players.map((p) => p.quadrant)).toEqual([0, 2]);

    const four = engine.setup(['a', 'b', 'c', 'd'], 1, {});
    expect(four.players.map((p) => p.quadrant)).toEqual([0, 1, 2, 3]);

    expect(two.players.every((p) => p.tokens.every((t) => t.steps === -1))).toBe(true);
    expect(engine.isOver(two).over).toBe(false);
  });

  it('rejects an action from the non-active player', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    const r = engine.reduce(s, 'bob', { type: 'roll' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Not your turn');
  });

  it('rejects movePlane before rolling', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    const r = engine.reduce(s, 'alice', { type: 'movePlane', tokenIndex: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('roll first');
  });

  it('passes the turn with no move when a non-six roll has no legal token', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    // Every token is in the hangar; only a 6 can do anything.
    // Force a specific non-six roll by trying seeds until we find one.
    let state = s;
    let rolled = false;
    for (let seed = 1; seed < 50 && !rolled; seed++) {
      state = engine.setup(['alice', 'bob'], seed, {});
      const r = engine.reduce(state, 'alice', { type: 'roll' });
      expect(r.ok).toBe(true);
      if (r.ok && r.state.lastRoll?.value !== 6) {
        expect(r.state.current).toBe(1); // turn passed to Bob
        expect(r.state.phase).toBe('awaiting_roll');
        expect(r.state.dice).toBeNull();
        rolled = true;
      }
    }
    expect(rolled).toBe(true);
  });

  it('releases a token onto the runway on a roll of six and grants a bonus roll', () => {
    let state = engine.setup(['alice', 'bob'], 1, {});
    let seed = 1;
    let r;
    do {
      seed++;
      state = engine.setup(['alice', 'bob'], seed, {});
      r = engine.reduce(state, 'alice', { type: 'roll' });
    } while (r.ok && r.state.lastRoll?.value !== 6 && seed < 200);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('awaiting_move');
    const legal = engine.legalActions(r.state, 'alice');
    expect(legal.length).toBeGreaterThan(0);
    const tokenIndex = Number(legal[0]!.split(':')[1]);
    const r2 = engine.reduce(r.state, 'alice', { type: 'movePlane', tokenIndex });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.state.players[0]!.tokens[tokenIndex]!.steps).toBe(0);
      expect(r2.state.current).toBe(0); // bonus roll — still Alice
      expect(r2.state.phase).toBe('awaiting_roll');
    }
  });

  it('captures an opponent token on a non-safe shared square', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    s.players[0]!.tokens[0] = { steps: 5 };
    // Bob (quadrant 2, entry 26) has a token positioned so that absolute
    // square 5 corresponds to one of Bob's relative steps.
    const bobRelForAbs5 = ((5 - 26) % 52 + 52) % 52;
    s.players[1]!.tokens[0] = { steps: bobRelForAbs5 };
    expect(absoluteSquare(2, bobRelForAbs5)).toBe(5);

    s.phase = 'awaiting_move';
    s.dice = 4; // alice's token at steps=1 -> +4 = 5... use a token already at 1
    s.players[0]!.tokens[1] = { steps: 1 };
    const r = engine.reduce(s, 'alice', { type: 'movePlane', tokenIndex: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players[0]!.tokens[1]!.steps).toBe(5);
      expect(r.state.players[1]!.tokens[0]!.steps).toBe(-1); // sent home
      expect(r.state.lastMove?.captured).toHaveLength(1);
    }
  });

  it('does not capture on a safe entry square', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    s.phase = 'awaiting_move';
    s.dice = 1;
    s.players[0]!.tokens[0] = { steps: 12 }; // -> 13, which is Bob's entry square, safe
    const bobRelForAbs13 = ((13 - 26) % 52 + 52) % 52;
    s.players[1]!.tokens[0] = { steps: bobRelForAbs13 };
    const r = engine.reduce(s, 'alice', { type: 'movePlane', tokenIndex: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players[1]!.tokens[0]!.steps).toBe(bobRelForAbs13); // untouched
      expect(r.state.lastMove?.captured).toHaveLength(0);
    }
  });

  it('requires an exact roll to enter home and forbids overshoot', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    s.players[0]!.tokens[0] = { steps: HOME_STEP - 2 };
    const legalOvershoot = engine.legalActions({ ...s, phase: 'awaiting_move', dice: 5 }, 'alice');
    expect(legalOvershoot).toEqual([]);
    const legalExact = engine.legalActions({ ...s, phase: 'awaiting_move', dice: 2 }, 'alice');
    expect(legalExact).toEqual(['movePlane:0']);
  });

  it('wins the moment all four tokens are home', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    s.phase = 'awaiting_move';
    s.dice = 1;
    s.players[0]!.tokens = [
      { steps: HOME_STEP },
      { steps: HOME_STEP },
      { steps: HOME_STEP },
      { steps: HOME_STEP - 1 },
    ];
    const r = engine.reduce(s, 'alice', { type: 'movePlane', tokenIndex: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.phase).toBe('game_over');
      expect(r.state.winner).toBe('alice');
      expect(engine.isOver(r.state)).toEqual({ over: true, winner: 'alice' });
      expect(engine.score(r.state, 'alice').completed).toBe(true);
    }
  });

  it('allows bots of all difficulties to choose legal actions', () => {
    const s = engine.setup(['bot1', 'bot2'], 123, {});
    const view = engine.view(s, 'bot1') as AeroplaneChessBotView;
    const rng = mulberry32(999);
    const difficulties: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const diff of difficulties) {
      const action = aeroplaneChessBot.chooseAction(view, 'bot1', rng, diff);
      expect(['roll', 'movePlane']).toContain(action.type);
    }
  });

  it('runs a full bot-vs-bot game to completion deterministically', () => {
    let s = engine.setup(['bot_a', 'bot_b'], 777, {});
    const rngA = mulberry32(111);
    const rngB = mulberry32(222);

    let turns = 0;
    while (s.phase !== 'game_over' && turns++ < 5000) {
      const actor = actorToAct(s);
      expect(actor).not.toBeNull();
      if (!actor) break;

      const view = engine.view(s, actor) as AeroplaneChessBotView;
      const rng = actor === 'bot_a' ? rngA : rngB;
      const action = aeroplaneChessBot.chooseAction(view, actor, rng, 'normal');

      const r = engine.reduce(s, actor, action);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      s = r.state;
    }

    expect(s.phase).toBe('game_over');
    expect(s.winner).not.toBeNull();
  });
});
