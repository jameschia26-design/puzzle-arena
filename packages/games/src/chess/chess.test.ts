import { describe, expect, it } from 'vitest';
import { mulberry32, type BotDifficulty } from '@puzzle-arena/shared';
import { chess, type ChessState } from './index.js';
import { chessBot, type ChessBotView } from './bot.js';
import {
  applyMoveToBoard,
  createInitialBoard,
  isInCheck,
  isInsufficientMaterial,
  legalMovesForSide,
  nextEpSquare,
  updateCastlingRights,
  type Board,
  type CastlingRights,
  type PieceType,
  type Side,
} from './movegen.js';

/* ------------------------------------------------------------------ */
/* Test helpers                                                        */
/* ------------------------------------------------------------------ */

function sq(f: number, r: number): number {
  return r * 8 + f;
}

function parseFEN(fen: string): { board: Board; side: Side; castling: CastlingRights; epSquare: number | null } {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] as string;
  const activeColor = parts[1] as string;
  const castlingStr = (parts[2] ?? '-') as string;
  const epStr = (parts[3] ?? '-') as string;

  const board: Board = new Array(64).fill(null);
  const rows = placement.split('/');
  for (let i = 0; i < 8; i++) {
    const rowStr = rows[i] as string;
    const r = 7 - i;
    let f = 0;
    for (const ch of rowStr) {
      if (/\d/.test(ch)) {
        f += Number(ch);
      } else {
        const side: Side = ch === ch.toUpperCase() ? 0 : 1;
        const type = ch.toLowerCase() as PieceType;
        board[sq(f, r)] = { type, side };
        f += 1;
      }
    }
  }

  const side: Side = activeColor === 'w' ? 0 : 1;
  const castling: CastlingRights = {
    wk: castlingStr.includes('K'),
    wq: castlingStr.includes('Q'),
    bk: castlingStr.includes('k'),
    bq: castlingStr.includes('q'),
  };
  let epSquare: number | null = null;
  if (epStr !== '-') {
    const f = epStr.charCodeAt(0) - 'a'.charCodeAt(0);
    const r = Number(epStr[1]) - 1;
    epSquare = sq(f, r);
  }
  return { board, side, castling, epSquare };
}

function perft(board: Board, side: Side, castling: CastlingRights, epSquare: number | null, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMovesForSide(board, side, castling, epSquare);
  if (depth === 1) return moves.length;
  let count = 0;
  for (const m of moves) {
    const nextBoard = applyMoveToBoard(board, m);
    const nextCastling = updateCastlingRights(castling, m);
    const nextEp = nextEpSquare(m);
    count += perft(nextBoard, (1 - side) as Side, nextCastling, nextEp, depth - 1);
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Perft — the load-bearing movegen correctness check                  */
/* ------------------------------------------------------------------ */

describe('perft', () => {
  const startCastling: CastlingRights = { wk: true, wq: true, bk: true, bq: true };

  it('start position depths 1-3 match the known node counts', () => {
    const board = createInitialBoard();
    expect(perft(board, 0, startCastling, null, 1)).toBe(20);
    expect(perft(board, 0, startCastling, null, 2)).toBe(400);
    expect(perft(board, 0, startCastling, null, 3)).toBe(8_902);
  });

  it('start position depth 4 matches the known node count', () => {
    const board = createInitialBoard();
    expect(perft(board, 0, startCastling, null, 4)).toBe(197_281);
  }, 30_000);

  it('Kiwipete depths 1-3 match the known node counts (stresses castling, en passant, pins)', () => {
    const { board, side, castling, epSquare } = parseFEN(
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -',
    );
    expect(perft(board, side, castling, epSquare, 1)).toBe(48);
    expect(perft(board, side, castling, epSquare, 2)).toBe(2_039);
    expect(perft(board, side, castling, epSquare, 3)).toBe(97_862);
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* Targeted rules                                                      */
/* ------------------------------------------------------------------ */

describe('castling legality', () => {
  it('is illegal when the king would pass through an attacked square', () => {
    // White king e1, rook h1, black rook on f8 covering the f-file — f1 is
    // attacked, so kingside castling must not appear among legal moves.
    const board: Board = new Array(64).fill(null);
    board[sq(4, 0)] = { type: 'k', side: 0 };
    board[sq(7, 0)] = { type: 'r', side: 0 };
    board[sq(5, 7)] = { type: 'r', side: 1 };
    board[sq(4, 7)] = { type: 'k', side: 1 };
    const castling: CastlingRights = { wk: true, wq: false, bk: false, bq: false };
    const legal = legalMovesForSide(board, 0, castling, null);
    expect(legal.some((m) => m.isCastle === 'K')).toBe(false);
  });

  it('is illegal while the king is in check', () => {
    const board: Board = new Array(64).fill(null);
    board[sq(4, 0)] = { type: 'k', side: 0 };
    board[sq(7, 0)] = { type: 'r', side: 0 };
    board[sq(4, 7)] = { type: 'r', side: 1 }; // checks e1 down the e-file
    board[sq(0, 7)] = { type: 'k', side: 1 };
    const castling: CastlingRights = { wk: true, wq: false, bk: false, bq: false };
    const legal = legalMovesForSide(board, 0, castling, null);
    expect(legal.some((m) => m.isCastle === 'K')).toBe(false);
  });

  it('is legal even when the rook itself passes through an attacked square', () => {
    // Queenside castling: b1 may be attacked (only the rook crosses it) —
    // only c1/d1 (the king's path) and e1 (start) must be safe.
    const board: Board = new Array(64).fill(null);
    board[sq(4, 0)] = { type: 'k', side: 0 };
    board[sq(0, 0)] = { type: 'r', side: 0 };
    board[sq(1, 7)] = { type: 'r', side: 1 }; // attacks b1 only
    board[sq(4, 7)] = { type: 'k', side: 1 };
    const castling: CastlingRights = { wk: false, wq: true, bk: false, bq: false };
    const legal = legalMovesForSide(board, 0, castling, null);
    expect(legal.some((m) => m.isCastle === 'Q')).toBe(true);
  });
});

describe('en passant', () => {
  // White pawn on e5, Black just double-pushed d7-d5 landing on d5, so the
  // ep square is d6. White's e5 pawn may capture exd6 e.p. this ply only.
  const noCastling: CastlingRights = { wk: false, wq: false, bk: false, bq: false };

  it('is available immediately after the double push', () => {
    const board: Board = new Array(64).fill(null);
    board[sq(4, 0)] = { type: 'k', side: 0 };
    board[sq(4, 7)] = { type: 'k', side: 1 };
    board[sq(4, 4)] = { type: 'p', side: 0 }; // e5
    board[sq(3, 4)] = { type: 'p', side: 1 }; // d5
    const epSquare = sq(3, 5); // d6
    const legal = legalMovesForSide(board, 0, noCastling, epSquare);
    const ep = legal.find((m) => m.isEnPassant);
    expect(ep).toBeDefined();
    expect(ep?.to).toBe(sq(3, 5));
    expect(ep?.epCaptureSquare).toBe(sq(3, 4));
  });

  it('is not available once the ep square has expired (one ply later)', () => {
    const board: Board = new Array(64).fill(null);
    board[sq(4, 0)] = { type: 'k', side: 0 };
    board[sq(4, 7)] = { type: 'k', side: 1 };
    board[sq(4, 4)] = { type: 'p', side: 0 }; // e5
    board[sq(3, 4)] = { type: 'p', side: 1 }; // d5
    const legal = legalMovesForSide(board, 0, noCastling, null);
    expect(legal.some((m) => m.isEnPassant)).toBe(false);
  });
});

describe('promotion', () => {
  it('allows under-promotion to rook, bishop, or knight, not just queen', () => {
    const board: Board = new Array(64).fill(null);
    board[sq(4, 0)] = { type: 'k', side: 0 };
    board[sq(4, 7)] = { type: 'k', side: 1 };
    board[sq(0, 6)] = { type: 'p', side: 0 }; // a7 pawn, one step from promoting
    const legal = legalMovesForSide(board, 0, { wk: false, wq: false, bk: false, bq: false }, null);
    const promos = legal.filter((m) => m.from === sq(0, 6) && m.to === sq(0, 7)).map((m) => m.promotion);
    expect(new Set(promos)).toEqual(new Set(['q', 'r', 'b', 'n']));
  });
});

describe('stalemate is a draw, not a loss', () => {
  it('detects the classic K+Q vs K stalemate directly from movegen', () => {
    // Black king a8, white king c6, white queen b6: Black has no legal move
    // and is not in check.
    const board: Board = new Array(64).fill(null);
    board[sq(0, 7)] = { type: 'k', side: 1 }; // a8
    board[sq(2, 5)] = { type: 'k', side: 0 }; // c6
    board[sq(1, 5)] = { type: 'q', side: 0 }; // b6
    const castling: CastlingRights = { wk: false, wq: false, bk: false, bq: false };

    expect(isInCheck(board, 1)).toBe(false);
    expect(legalMovesForSide(board, 1, castling, null)).toHaveLength(0);
  });

  it('ends the game as a draw (not a win) when reached through reduce()', () => {
    const s = chess.setup(['white', 'black'], 1, {});
    s.board = new Array(64).fill(null);
    s.board[sq(0, 7)] = { type: 'k', side: 1 }; // a8
    s.board[sq(2, 5)] = { type: 'k', side: 0 }; // c6
    s.board[sq(1, 6)] = { type: 'q', side: 0 }; // b7, one move away from stalemating
    s.current = 0;
    s.castling = { wk: false, wq: false, bk: false, bq: false };
    s.epSquare = null;
    s.history = [];
    s.repetition = {};

    // Qb7-b6 delivers stalemate (not check) to the king on a8.
    const r = chess.reduce(s, 'white', { type: 'move', from: sq(1, 6), to: sq(1, 5) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.phase).toBe('game_over');
      expect(r.state.winner).toBeNull();
      expect(r.state.drawReason).toBe('stalemate');
    }
  });
});

describe('insufficient material', () => {
  it('K+B vs K+B with same-colour bishops is an automatic draw', () => {
    const board: Board = new Array(64).fill(null);
    board[sq(4, 0)] = { type: 'k', side: 0 };
    board[sq(2, 0)] = { type: 'b', side: 0 }; // c1, dark square (2+0 even -> light? check parity)
    board[sq(4, 7)] = { type: 'k', side: 1 };
    board[sq(5, 7)] = { type: 'b', side: 1 }; // f8
    // c1 = file2,rank0 -> (2+0)%2=0 ; f8 = file5,rank7 -> (5+7)%2=0 -> same colour
    expect(isInsufficientMaterial(board)).toBe(true);
  });

  it('K+B vs K+B with opposite-colour bishops is NOT an automatic draw', () => {
    const board: Board = new Array(64).fill(null);
    board[sq(4, 0)] = { type: 'k', side: 0 };
    board[sq(2, 0)] = { type: 'b', side: 0 }; // c1, colour parity 0
    board[sq(4, 7)] = { type: 'k', side: 1 };
    board[sq(4, 7 - 1)] = null;
    board[sq(3, 7)] = { type: 'b', side: 1 }; // e8 -> file4? use d8 file3,rank7 -> (3+7)%2=0... need opposite parity
    board[sq(5, 6)] = { type: 'b', side: 1 }; // f7: file5,rank6 -> (5+6)%2=1, opposite colour to c1's 0
    board[sq(3, 7)] = null;
    expect(isInsufficientMaterial(board)).toBe(false);
  });
});

describe('threefold repetition claim', () => {
  it('only succeeds once the position has actually repeated three times', () => {
    let s = chess.setup(['white', 'black'], 1, {});

    const claimTooEarly = chess.reduce(s, 'white', { type: 'claim_draw' });
    expect(claimTooEarly.ok).toBe(false);

    // Shuffle knights back and forth: Nf3-g1, Ng8-f6, Ng1-f3, Nf6-g8, ... to
    // repeat the starting position three times total.
    const seq: Array<{ from: number; to: number }> = [
      { from: sq(6, 0), to: sq(5, 2) }, // Ng1-f3
      { from: sq(6, 7), to: sq(5, 5) }, // Ng8-f6
      { from: sq(5, 2), to: sq(6, 0) }, // Nf3-g1
      { from: sq(5, 5), to: sq(6, 7) }, // Nf6-g8
      { from: sq(6, 0), to: sq(5, 2) },
      { from: sq(6, 7), to: sq(5, 5) },
      { from: sq(5, 2), to: sq(6, 0) },
      { from: sq(5, 5), to: sq(6, 7) },
    ];
    for (const mv of seq) {
      const actor = s.players[s.current]!.id;
      const r = chess.reduce(s, actor, { type: 'move', from: mv.from, to: mv.to });
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }

    const actor = s.players[s.current]!.id;
    const claim = chess.reduce(s, actor, { type: 'claim_draw' });
    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(claim.state.phase).toBe('game_over');
      expect(claim.state.drawReason).toBe('threefold');
    }
  });
});

describe('takeback', () => {
  it('round-trips: request -> accept restores position, current side, and repetition', () => {
    let s = chess.setup(['white', 'black'], 1, {});
    const before = structuredClone(s);

    const r1 = chess.reduce(s, 'white', { type: 'move', from: sq(4, 1), to: sq(4, 3) }); // e2-e4
    expect(r1.ok).toBe(true);
    if (r1.ok) s = r1.state;

    // White regrets e2-e4 and asks to take it back before Black replies —
    // the offer returns the turn to White, the requester.
    const r2 = chess.reduce(s, 'white', { type: 'offer_takeback' });
    expect(r2.ok).toBe(true);
    if (r2.ok) s = r2.state;

    const r3 = chess.reduce(s, 'black', { type: 'respond_takeback', accept: true });
    expect(r3.ok).toBe(true);
    if (r3.ok) s = r3.state;

    expect(s.current).toBe(before.current);
    expect(s.board).toEqual(before.board);
    expect(s.history).toHaveLength(0);
    expect(s.repetition).toEqual(before.repetition);
  });
});

describe('view() no-cheat invariant', () => {
  it('never leaks the RNG stream', () => {
    const s = chess.setup(['white', 'black'], 1, {});
    const view = chess.view(s, 'white') as Record<string, unknown>;
    expect(view['rng']).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });
});

describe('forfeit (runtime-only action)', () => {
  it('ends the game with winReason time/idle for the other player', () => {
    const s = chess.setup(['white', 'black'], 1, {});
    const r = chess.reduce(s, 'white', { type: 'forfeit', reason: 'time' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.phase).toBe('game_over');
      expect(r.state.winner).toBe('black');
      expect(r.state.winReason).toBe('time');
    }
  });

  it('supports idle forfeits too', () => {
    const s = chess.setup(['white', 'black'], 1, {});
    const r = chess.reduce(s, 'black', { type: 'forfeit', reason: 'idle' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.winner).toBe('white');
      expect(r.state.winReason).toBe('idle');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Bots                                                                 */
/* ------------------------------------------------------------------ */

const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

describe('chess bot', () => {
  it('never sees the RNG stream through its view', () => {
    const s = chess.setup(['white', 'black'], 1, {});
    const view = chess.view(s, 'white') as unknown as Record<string, unknown>;
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });

  it('every difficulty tier produces a legal move from the opening position', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const seed of [1, 2, 3]) {
        const s = chess.setup(['white', 'black'], seed, {});
        const view = chess.view(s, 'white') as unknown as ChessBotView;
        const action = chessBot.chooseAction(view, 'white', mulberry32(seed), difficulty);
        const r = chess.reduce(s, 'white', action as unknown as Parameters<typeof chess.reduce>[2]);
        expect(r.ok).toBe(true);
      }
    }
  }, 20_000);

  it('every difficulty tier produces a legal move mid-game', () => {
    for (const difficulty of DIFFICULTIES) {
      let s: ChessState = chess.setup(['white', 'black'], 7, {});
      const openingMoves: Array<{ from: number; to: number }> = [
        { from: sq(4, 1), to: sq(4, 3) },
        { from: sq(4, 6), to: sq(4, 4) },
        { from: sq(6, 0), to: sq(5, 2) },
        { from: sq(1, 7), to: sq(2, 5) },
      ];
      for (const mv of openingMoves) {
        const actor = s.players[s.current]!.id;
        const r = chess.reduce(s, actor, { type: 'move', from: mv.from, to: mv.to });
        expect(r.ok).toBe(true);
        if (r.ok) s = r.state;
      }
      const actor = s.players[s.current]!.id;
      const view = chess.view(s, actor) as unknown as ChessBotView;
      const action = chessBot.chooseAction(view, actor, mulberry32(9), difficulty);
      const r = chess.reduce(s, actor, action as unknown as Parameters<typeof chess.reduce>[2]);
      expect(r.ok).toBe(true);
    }
  }, 20_000);
});
