import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import { actorToAct, checkers as engine, legalMovesForSide } from './index.js';
import { checkersBot, type CheckersBotView } from './bot.js';
import type { CheckersPiece } from './state.js';

describe('checkers game engine', () => {
  it('sets up a 10x10 board with 20 pieces per side', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    const pieces = s.board.filter((p): p is CheckersPiece => p !== null);
    expect(pieces).toHaveLength(40);
    expect(pieces.filter((p) => p.side === 0)).toHaveLength(20);
    expect(pieces.filter((p) => p.side === 1)).toHaveLength(20);
    expect(pieces.every((p) => !p.king)).toBe(true);
    expect(s.current).toBe(0);
    expect(s.phase).toBe('playing');
    expect(engine.isOver(s).over).toBe(false);
  });

  it('rejects an action from the non-active player', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    const r = engine.reduce(s, 'bob', {
      type: 'move',
      path: [
        { row: 6, col: 0 },
        { row: 5, col: 1 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Not your turn');
  });

  it('rejects a move that is not in the legal set', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    const r = engine.reduce(s, 'alice', {
      type: 'move',
      path: [
        { row: 3, col: 1 },
        { row: 5, col: 3 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Illegal move');
  });

  it('accepts a legal simple move and passes the turn', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    const legal = legalMovesForSide(s.board, 0);
    expect(legal.length).toBeGreaterThan(0);
    const r = engine.reduce(s, 'alice', { type: 'move', path: legal[0]!.path });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.current).toBe(1);
  });

  it('forces mandatory capture over a simple move when one is available', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    s.board = new Array(100).fill(null);
    // Alice man at (4,4), Bob man at (5,5), empty landing at (6,6).
    s.board[4 * 10 + 4] = { side: 0, king: false };
    s.board[5 * 10 + 5] = { side: 1, king: false };
    s.board[9 * 10 + 9] = { side: 1, king: false }; // an otherwise-movable piece elsewhere

    const legal = legalMovesForSide(s.board, 0);
    expect(legal).toHaveLength(1);
    expect(legal[0]!.captured).toHaveLength(1);
    expect(legal[0]!.path[0]).toEqual({ row: 4, col: 4 });
    expect(legal[0]!.path[1]).toEqual({ row: 6, col: 6 });
  });

  it('forces the maximum-capture sequence when multiple chains are available', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    s.board = new Array(100).fill(null);
    // A double-jump chain for Alice's man at (2,2): capture at (3,3) landing (4,4),
    // then capture at (5,5) landing (6,6). A single-capture alternative also exists
    // elsewhere but must be excluded because it captures fewer pieces.
    s.board[2 * 10 + 2] = { side: 0, king: false };
    s.board[3 * 10 + 3] = { side: 1, king: false };
    s.board[5 * 10 + 5] = { side: 1, king: false };
    s.board[6 * 10 + 0] = { side: 0, king: false };
    s.board[7 * 10 + 1] = { side: 1, king: false };

    const legal = legalMovesForSide(s.board, 0);
    expect(legal).toHaveLength(1);
    expect(legal[0]!.captured).toHaveLength(2);
    expect(legal[0]!.path).toEqual([
      { row: 2, col: 2 },
      { row: 4, col: 4 },
      { row: 6, col: 6 },
    ]);
  });

  it('promotes a man that reaches the crownhead and ends the move there', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    s.board = new Array(100).fill(null);
    s.board[8 * 10 + 2] = { side: 0, king: false };

    const legal = legalMovesForSide(s.board, 0);
    const toCrown = legal.find((m) => m.path[m.path.length - 1]!.row === 9);
    expect(toCrown).toBeDefined();
    const r = engine.reduce(s, 'alice', { type: 'move', path: toCrown!.path });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const landed = r.state.board[9 * 10 + (toCrown!.path[1]!.col)];
      expect(landed?.king).toBe(true);
      expect(r.state.lastMove?.promoted).toBe(true);
    }
  });

  it('lets a flying king capture at a distance and choose among landing squares', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    s.board = new Array(100).fill(null);
    s.board[0 * 10 + 0] = { side: 0, king: true };
    s.board[4 * 10 + 4] = { side: 1, king: false };

    const legal = legalMovesForSide(s.board, 0);
    expect(legal.length).toBeGreaterThan(1); // multiple legal landing squares beyond the captured piece
    for (const move of legal) {
      expect(move.captured).toEqual([{ row: 4, col: 4 }]);
      const dest = move.path[1]!;
      expect(dest.row).toBeGreaterThan(4);
    }
  });

  it('declares a win by elimination', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    s.board = new Array(100).fill(null);
    s.board[2 * 10 + 2] = { side: 0, king: false };
    s.board[3 * 10 + 3] = { side: 1, king: false };

    const r = engine.reduce(s, 'alice', {
      type: 'move',
      path: [
        { row: 2, col: 2 },
        { row: 4, col: 4 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.phase).toBe('game_over');
      expect(r.state.winner).toBe('alice');
      expect(r.state.winReason).toBe('elimination');
      expect(engine.isOver(r.state)).toEqual({ over: true, winner: 'alice' });
    }
  });

  it('declares a win when the opponent has no legal moves', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    s.board = new Array(100).fill(null);
    // Bob's only man sits on row 0 with no piece adjacent to capture — a
    // side-1 man's forward simple move is toward row -1, which is off the
    // board, so this piece has zero legal moves of any kind.
    s.board[0 * 10 + 1] = { side: 1, king: false };
    // Alice has a piece far away with an ordinary move available.
    s.board[0 * 10 + 9] = { side: 0, king: false };

    const r = engine.reduce(s, 'alice', {
      type: 'move',
      path: [
        { row: 0, col: 9 },
        { row: 1, col: 8 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.phase).toBe('game_over');
      expect(r.state.winner).toBe('alice');
      expect(r.state.winReason).toBe('no-moves');
    }
  });

  it('provides legal actions for the active player and produces autoAction', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    expect(engine.legalActions(s, 'alice').length).toBeGreaterThan(0);
    expect(engine.legalActions(s, 'bob')).toEqual([]);
    const auto = engine.autoAction(s, 'alice');
    expect(auto.type).toBe('move');
    expect(auto.path.length).toBeGreaterThan(0);
  });

  it('computes score from captured-piece progress', () => {
    const s = engine.setup(['alice', 'bob'], 42, {});
    s.players[0].capturedCount = 10;
    s.phase = 'game_over';
    s.winner = 'alice';
    s.winnerAtMs = 1234;

    const scoreAlice = engine.score(s, 'alice');
    expect(scoreAlice.progress).toBeCloseTo(0.5);
    expect(scoreAlice.completed).toBe(true);
    expect(scoreAlice.completedAtMs).toBe(1234);

    const scoreBob = engine.score(s, 'bob');
    expect(scoreBob.completed).toBe(false);
  });

  it('allows bots of all difficulties to choose legal moves', () => {
    const s = engine.setup(['bot1', 'bot2'], 123, {});
    const view = engine.view(s, 'bot1') as CheckersBotView;
    const rng = mulberry32(999);

    const difficulties: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const diff of difficulties) {
      const action = checkersBot.chooseAction(view, 'bot1', rng, diff);
      expect(action.type).toBe('move');
      expect(action.path.length).toBeGreaterThan(0);
    }
  });

  it('runs a full bot-vs-bot game to completion deterministically', () => {
    let s = engine.setup(['bot_a', 'bot_b'], 777, {});
    const rngA = mulberry32(111);
    const rngB = mulberry32(222);

    let turns = 0;
    while (s.phase !== 'game_over' && turns++ < 300) {
      const actor = actorToAct(s);
      expect(actor).not.toBeNull();
      if (!actor) break;

      const view = engine.view(s, actor) as CheckersBotView;
      const rng = actor === 'bot_a' ? rngA : rngB;
      const action = checkersBot.chooseAction(view, actor, rng, 'normal');

      const r = engine.reduce(s, actor, action);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      s = r.state;
    }

    expect(s.phase).toBe('game_over');
    expect(s.winner).not.toBeNull();
  });
});
