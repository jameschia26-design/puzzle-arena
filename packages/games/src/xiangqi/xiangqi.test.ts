import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import {
  actorToAct,
  createInitialBoard,
  isInCheck,
  legalMovesForSide,
  pieceMoves,
  toIndex,
  xiangqi as engine,
} from './index.js';
import { xiangqiBot, type XiangqiBotView } from './bot.js';
import type { XiangqiPiece, XiangqiState } from './state.js';

const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard', 'ai'];

function emptyBoard(): (XiangqiPiece | null)[] {
  return new Array(90).fill(null);
}

/* ================================================================== */
/* Perft — the decisive movegen correctness check                     */
/* ================================================================== */

function perft(board: (XiangqiPiece | null)[], side: 0 | 1, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMovesForSide(board, side);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    const next = [...board];
    next[m.to] = next[m.from];
    next[m.from] = null;
    nodes += perft(next, side === 0 ? 1 : 0, depth - 1);
  }
  return nodes;
}

describe('perft from the starting position', () => {
  it('matches known counts at depths 1-3', () => {
    const board = createInitialBoard();
    expect(perft(board, 0, 1)).toBe(44);
    expect(perft(board, 0, 2)).toBe(1_920);
    expect(perft(board, 0, 3)).toBe(79_666);
  });

  const runDepth4 = process.env['XIANGQI_PERFT4'] === '1';
  (runDepth4 ? it : it.skip)('matches known count at depth 4 (slow, gated behind XIANGQI_PERFT4=1)', () => {
    const board = createInitialBoard();
    expect(perft(board, 0, 4)).toBe(3_290_240);
  });
});

/* ================================================================== */
/* Piece rules                                                         */
/* ================================================================== */

describe('piece movement rules', () => {
  it('detects the flying-general face-off as check and forbids exposing moves', () => {
    const board = emptyBoard();
    board[toIndex(0, 4)] = { side: 1, type: 'general' };
    board[toIndex(9, 4)] = { side: 0, type: 'general' };
    expect(isInCheck(board, 1)).toBe(true);
    expect(isInCheck(board, 0)).toBe(true);

    const board2 = emptyBoard();
    board2[toIndex(0, 4)] = { side: 1, type: 'general' };
    board2[toIndex(9, 4)] = { side: 0, type: 'general' };
    board2[toIndex(5, 4)] = { side: 0, type: 'soldier' }; // blocks the file
    expect(isInCheck(board2, 1)).toBe(false);
    // Sideways moves for the blocking soldier (once it has crossed the
    // river) would reopen the file and expose Red's own general — illegal.
    const soldierMoves = legalMovesForSide(board2, 0).filter((m) => m.from === toIndex(5, 4));
    for (const m of soldierMoves) {
      expect(m.to).toBe(toIndex(4, 4)); // only the forward step remains legal
    }
  });

  it('hobbles the horse leg', () => {
    const board = emptyBoard();
    board[toIndex(5, 4)] = { side: 0, type: 'horse' };
    board[toIndex(4, 4)] = { side: 1, type: 'soldier' }; // blocks the leg directly above
    const moves = pieceMoves(board, toIndex(5, 4));
    expect(moves).not.toContain(toIndex(3, 3));
    expect(moves).not.toContain(toIndex(3, 5));
    expect(moves).toContain(toIndex(4, 6)); // clear leg to the right still works
  });

  it('blocks the elephant eye and forbids crossing the river', () => {
    // Red's own half is rows 5-9 (the river runs between rows 4 and 5), so
    // an elephant at (8,4) can only ever reach (6,2) or (6,6) — both still
    // on Red's own side.
    const board = emptyBoard();
    board[toIndex(8, 4)] = { side: 0, type: 'elephant' };
    board[toIndex(7, 3)] = { side: 1, type: 'soldier' }; // sits on the (6,2) eye
    const moves = pieceMoves(board, toIndex(8, 4));
    expect(moves).not.toContain(toIndex(6, 2)); // blocked eye
    expect(moves).toContain(toIndex(6, 6)); // clear diagonal, still on Red's own half

    // Separately: even with a fully clear board, an elephant may never
    // cross the river at all.
    const board2 = emptyBoard();
    board2[toIndex(6, 4)] = { side: 0, type: 'elephant' };
    const moves2 = pieceMoves(board2, toIndex(6, 4));
    expect(moves2).not.toContain(toIndex(4, 2));
    expect(moves2).not.toContain(toIndex(4, 6));
    expect(moves2.slice().sort((a, b) => a - b)).toEqual(
      [toIndex(8, 2), toIndex(8, 6)].sort((a, b) => a - b),
    );
  });

  it('cannon needs exactly one screen to capture and cannot move onto the screen', () => {
    const board = emptyBoard();
    board[toIndex(5, 4)] = { side: 0, type: 'cannon' };
    board[toIndex(0, 4)] = { side: 1, type: 'soldier' };
    let moves = pieceMoves(board, toIndex(5, 4));
    expect(moves).not.toContain(toIndex(0, 4)); // no screen: can't capture

    board[toIndex(3, 4)] = { side: 0, type: 'soldier' }; // one screen
    moves = pieceMoves(board, toIndex(5, 4));
    expect(moves).toContain(toIndex(0, 4));
    expect(moves).not.toContain(toIndex(3, 4)); // cannot land on the screen

    board[toIndex(1, 4)] = { side: 1, type: 'soldier' }; // second screen blocks the capture
    moves = pieceMoves(board, toIndex(5, 4));
    expect(moves).not.toContain(toIndex(0, 4));
  });

  it('soldier moves forward only before crossing, gains sideways after, never backward', () => {
    const board = emptyBoard();
    board[toIndex(6, 4)] = { side: 0, type: 'soldier' }; // Red, not yet crossed
    let moves = pieceMoves(board, toIndex(6, 4));
    expect(moves).toEqual([toIndex(5, 4)]);

    const board2 = emptyBoard();
    board2[toIndex(4, 4)] = { side: 0, type: 'soldier' }; // Red, crossed the river
    moves = pieceMoves(board2, toIndex(4, 4));
    expect(moves.slice().sort((a, b) => a - b)).toEqual(
      [toIndex(3, 4), toIndex(4, 3), toIndex(4, 5)].sort((a, b) => a - b),
    );
    expect(moves).not.toContain(toIndex(5, 4)); // never backward
  });
});

/* ================================================================== */
/* Engine-level rules                                                  */
/* ================================================================== */

describe('xiangqi game engine', () => {
  it('sets up the standard 32-piece starting position with Red to move first', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    const pieces = s.board.filter((p): p is XiangqiPiece => p !== null);
    expect(pieces).toHaveLength(32);
    expect(s.current).toBe(0);
    expect(s.players[0]?.id).toBe('alice');
    expect(actorToAct(s)).toBe('alice');
  });

  it('rejects a move from the player not on turn', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    const r = engine.reduce(s, 'bob', { type: 'move', from: toIndex(3, 0), to: toIndex(4, 0) });
    expect(r.ok).toBe(false);
  });

  it('rejects an illegal move', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    const r = engine.reduce(s, 'alice', { type: 'move', from: toIndex(9, 0), to: toIndex(0, 0) });
    expect(r.ok).toBe(false);
  });

  it('accepts a legal opening move and passes the turn', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    const r = engine.reduce(s, 'alice', { type: 'move', from: toIndex(6, 0), to: toIndex(5, 0) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.current).toBe(1);
  });

  it('stalemate is a LOSS for the stalemated side, not a draw', () => {
    // Composed position: Black's general is confined to (0,3) in the
    // palace corner. Its only two candidate destinations, (0,4) and
    // (1,3), are both controlled (not occupied) by Red chariots sliding
    // in cleanly along column 4 and row 1 respectively — so both moves
    // would leave the general in check and are illegal. The general's
    // current square, (0,3), is attacked by neither chariot, so this is
    // stalemate, not checkmate. Black has no other pieces.
    let s = engine.setup(['alice', 'bob'], 1, {});
    s.board = emptyBoard();
    s.board[toIndex(0, 3)] = { side: 1, type: 'general' };
    s.board[toIndex(9, 5)] = { side: 0, type: 'general' };
    s.board[toIndex(5, 4)] = { side: 0, type: 'chariot' }; // controls column 4, incl. (0,4)
    s.board[toIndex(1, 0)] = { side: 0, type: 'chariot' }; // will slide along row 1 to control (1,3)
    s.current = 0;

    // Sanity: before Red's move, Black (not on turn) would indeed have zero
    // legal moves and not be in check once the second chariot lands.
    const r = engine.reduce(s, 'alice', { type: 'move', from: toIndex(1, 0), to: toIndex(1, 8) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(legalMovesForSide(r.state.board, 1)).toHaveLength(0);
    expect(isInCheck(r.state.board, 1)).toBe(false);
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winner).toBe('alice');
    expect(r.state.winReason).toBe('stalemate');
  });

  it('60 full moves (120 plies) with no capture triggers an automatic draw', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    s.halfmoveClock = 119;
    const r = engine.reduce(s, 'alice', { type: 'move', from: toIndex(6, 0), to: toIndex(5, 0) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.halfmoveClock).toBe(120);
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winner).toBeNull();
    expect(r.state.drawReason).toBe('sixty_move');
  });

  it('perpetual check (simplified rule): 3 consecutive checking moves forfeits the checker', () => {
    // Red chariot slides onto column 4 delivering check to Black's general
    // at (0,4); Black still has a legal reply (retreat to (0,3)), so this
    // is not checkmate. We seed checkStreak to 2 for Red to simulate this
    // being Red's third consecutive checking move, per the documented
    // simplified approximation (see state.ts / index.ts comments).
    const s = engine.setup(['alice', 'bob'], 1, {});
    s.board = emptyBoard();
    s.board[toIndex(0, 4)] = { side: 1, type: 'general' };
    s.board[toIndex(0, 3)] = null;
    s.board[toIndex(9, 4)] = { side: 0, type: 'general' };
    s.board[toIndex(5, 0)] = { side: 0, type: 'chariot' };
    s.current = 0;
    s.checkStreak = { 0: 2, 1: 0 };

    const r = engine.reduce(s, 'alice', { type: 'move', from: toIndex(5, 0), to: toIndex(5, 4) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isInCheck(r.state.board, 1)).toBe(true);
    expect(legalMovesForSide(r.state.board, 1).length).toBeGreaterThan(0); // not checkmate
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winner).toBe('bob');
    expect(r.state.winReason).toBe('perpetual_check');
  });

  it('mutual perpetual check (both sides at streak 3) is a draw', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    s.board = emptyBoard();
    s.board[toIndex(0, 4)] = { side: 1, type: 'general' };
    s.board[toIndex(9, 4)] = { side: 0, type: 'general' };
    s.board[toIndex(0, 3)] = null;
    s.board[toIndex(5, 0)] = { side: 0, type: 'chariot' };
    s.current = 0;
    s.checkStreak = { 0: 2, 1: 3 }; // Black had already reached the threshold on its last move

    const r = engine.reduce(s, 'alice', { type: 'move', from: toIndex(5, 0), to: toIndex(5, 4) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winner).toBeNull();
    expect(r.state.drawReason).toBe('perpetual_mutual_check');
  });

  it('takeback round-trips back to the exact prior position', () => {
    const initial = engine.setup(['alice', 'bob'], 1, {});
    let s: XiangqiState = initial;
    const moved = engine.reduce(s, 'alice', { type: 'move', from: toIndex(6, 0), to: toIndex(5, 0) });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    s = moved.state;
    expect(s.current).toBe(1);

    const offered = engine.reduce(s, 'alice', { type: 'offer_takeback' });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    s = offered.state;
    expect(s.takebackOffer).toBe('alice');

    const accepted = engine.reduce(s, 'bob', { type: 'respond_takeback', accept: true });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    s = accepted.state;
    expect(s.history).toHaveLength(0);
    expect(s.current).toBe(0);
    expect(s.board).toEqual(initial.board);
    expect(s.takebackOffer).toBeNull();
  });

  it('forfeit ends the game with the runtime-supplied reason, for the other player', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    const r = engine.reduce(s, 'alice', { type: 'forfeit', reason: 'time' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winner).toBe('bob');
    expect(r.state.winReason).toBe('time');

    const s2 = engine.setup(['alice', 'bob'], 1, {});
    const r2 = engine.reduce(s2, 'bob', { type: 'forfeit', reason: 'idle' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.winner).toBe('alice');
    expect(r2.state.winReason).toBe('idle');
  });

  it('never leaks the RNG stream through view()', () => {
    const s = engine.setup(['alice', 'bob'], 1, {});
    const view = engine.view(s, 'alice') as unknown as Record<string, unknown>;
    expect(view['rng']).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });
});

/* ================================================================== */
/* Bots                                                                 */
/* ================================================================== */

describe('xiangqi bot tiers', () => {
  it('every difficulty produces a legal move from the restricted view alone', () => {
    for (const difficulty of DIFFICULTIES) {
      const s = engine.setup(['alice', 'bob'], 7, {});
      const view = engine.view(s, 'alice') as unknown as XiangqiBotView;
      const action = xiangqiBot.chooseAction(view, 'alice', mulberry32(1), difficulty);
      const r = engine.reduce(s, 'alice', action as never);
      expect(r.ok).toBe(true);
    }
  });
});
