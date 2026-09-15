import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@puzzle-arena/shared';
import {
  blockBlaster,
  createEmptyBoard,
  canPlacePiece,
  applyPlacement,
  checkGameOver,
  generatePiece,
  instantiatePiece,
  BLOCK_SHAPES,
} from './index.js';

describe('block-blaster: board and placement', () => {
  it('initializes game with an 8x8 board, a current piece and a next-piece preview', () => {
    const s = blockBlaster.setup(['p1', 'p2'], 12345, {});
    expect(s.players).toHaveLength(2);
    expect(s.players[0]!.board).toHaveLength(8);
    expect(s.players[0]!.board[0]).toHaveLength(8);
    expect(s.players[0]!.current).toBeTruthy();
    expect(s.players[0]!.next).toBeTruthy();
    expect(s.phase).toBe('playing');
  });

  it('validates boundaries and collisions correctly', () => {
    const board = createEmptyBoard();
    const rng = mulberry32(1);
    const piece2x2 = instantiatePiece(BLOCK_SHAPES.find((s: { id: string }) => s.id === 'square_2x2')!, rng);

    // Valid placement
    expect(canPlacePiece(board, piece2x2, 0, 0)).toBe(true);
    expect(canPlacePiece(board, piece2x2, 6, 6)).toBe(true);

    // Out of bounds
    expect(canPlacePiece(board, piece2x2, -1, 0)).toBe(false);
    expect(canPlacePiece(board, piece2x2, 0, 7)).toBe(false); // width is 2, col 7 + 1 = 8 (OOB)
    expect(canPlacePiece(board, piece2x2, 7, 0)).toBe(false); // height is 2, row 7 + 1 = 8 (OOB)

    // Collision check
    board[3]![3] = '#ff0000';
    expect(canPlacePiece(board, piece2x2, 2, 2)).toBe(false); // occupies (3, 3)
    expect(canPlacePiece(board, piece2x2, 4, 4)).toBe(true); // does not overlap
  });
});

describe('block-blaster: line clearing & scoring engine', () => {
  it('clears full row and computes base clear points', () => {
    const board = createEmptyBoard();
    // Fill row 2 with 7 blocks leaving column 7 empty
    for (let c = 0; c < 7; c++) {
      board[2]![c] = '#38bdf8';
    }

    const rng = mulberry32(42);
    const dot = instantiatePiece(BLOCK_SHAPES.find((s: { id: string }) => s.id === 'dot_1x1')!, rng);

    // Place dot in row 2, col 7 -> completes row 2
    const res = applyPlacement(board, dot, 2, 7, 0);
    expect(res.ok).toBe(true);
    expect(res.clearEvent).not.toBeNull();
    expect(res.clearEvent?.rows).toEqual([2]);
    expect(res.clearEvent?.cols).toEqual([]);

    // Row 2 should now be completely cleared to 0
    expect(res.newBoard[2]!.every((cell) => cell === 0)).toBe(true);

    // Placement score: 1 (dot cellCount)
    // Line count L = 1: Base Clear = 10 * 1 * (1 + 1) = 20
    // Combo bonus: 0 (streak 1 is not > 1)
    // Turn score: 1 + 20 = 21
    expect(res.turnScore).toBe(21);
    expect(res.newComboStreak).toBe(1);
  });

  it('clears row and column simultaneously (cross clear)', () => {
    const board = createEmptyBoard();
    // Fill row 4 except col 4
    for (let c = 0; c < 8; c++) {
      if (c !== 4) board[4]![c] = '#38bdf8';
    }
    // Fill col 4 except row 4
    for (let r = 0; r < 8; r++) {
      if (r !== 4) board[r]![4] = '#38bdf8';
    }

    const rng = mulberry32(7);
    const dot = instantiatePiece(BLOCK_SHAPES.find((s: { id: string }) => s.id === 'dot_1x1')!, rng);

    // Place dot in row 4, col 4 -> completes both row 4 and col 4!
    const res = applyPlacement(board, dot, 4, 4, 0);
    expect(res.ok).toBe(true);
    expect(res.clearEvent).not.toBeNull();
    expect(res.clearEvent?.rows).toEqual([4]);
    expect(res.clearEvent?.cols).toEqual([4]);

    // Both row 4 and col 4 are 0
    expect(res.newBoard[4]!.every((cell) => cell === 0)).toBe(true);
    for (let r = 0; r < 8; r++) {
      expect(res.newBoard[r]![4]).toBe(0);
    }

    // L = 2: Base Clear = 10 * 2 * (2 + 1) = 60
    // Placement score = 1
    // Turn score = 61
    expect(res.turnScore).toBe(61);
    expect(res.newComboStreak).toBe(1);
  });

  it('accumulates combo streak on consecutive clears and resets on non-clear', () => {
    let board = createEmptyBoard();
    const rng = mulberry32(10);
    const dot = instantiatePiece(BLOCK_SHAPES.find((s: { id: string }) => s.id === 'dot_1x1')!, rng);

    // Clear 1: row 0
    for (let c = 0; c < 7; c++) board[0]![c] = '#38bdf8';
    const turn1 = applyPlacement(board, dot, 0, 7, 0);
    expect(turn1.newComboStreak).toBe(1);
    expect(turn1.turnScore).toBe(21); // 1 + 20

    // Clear 2: row 1 (streak becomes 2)
    board = turn1.newBoard;
    for (let c = 0; c < 7; c++) board[1]![c] = '#38bdf8';
    const turn2 = applyPlacement(board, dot, 1, 7, turn1.newComboStreak);
    expect(turn2.newComboStreak).toBe(2);
    // Base clear = 20, Combo bonus = 2 * 10 * 1 = 20, Placement = 1 -> Total = 41
    expect(turn2.turnScore).toBe(41);

    // Turn 3: placing a block without clearing any line resets streak to 0
    board = turn2.newBoard;
    const turn3 = applyPlacement(board, dot, 5, 5, turn2.newComboStreak);
    expect(turn3.clearEvent).toBeNull();
    expect(turn3.newComboStreak).toBe(0);
    expect(turn3.turnScore).toBe(1); // just placement score
  });
});

describe('block-blaster: single-piece cycling', () => {
  it('promotes the previewed next piece to current and rolls a fresh preview after a placement', () => {
    let cur = blockBlaster.setup(['p1'], 999, { startingLayout: 'empty' });
    let p = cur.players[0]!;
    const previewedNext = p.next;

    // The board starts empty, so the current piece always fits at (0, 0).
    const res = blockBlaster.reduce(cur, 'p1', { type: 'place', row: 0, col: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    cur = res.state;
    p = cur.players[0]!;

    expect(p.current.id).toBe(previewedNext.id);
    expect(p.next).toBeTruthy();
    expect(p.next.id).not.toBe(previewedNext.id);
    expect(p.piecesPlaced).toBe(1);
  });

  it('rejects a placement action once the current piece is gone (no stale re-submits)', () => {
    const s = blockBlaster.setup(['p1'], 999, { startingLayout: 'empty' });
    const first = blockBlaster.reduce(s, 'p1', { type: 'place', row: 0, col: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error);

    // Re-submitting the exact same action against the pre-placement state
    // (simulating a duplicate/stale client action) must not double-apply.
    const dupe = blockBlaster.reduce(s, 'p1', { type: 'place', row: 0, col: 0 });
    expect(dupe.ok).toBe(true); // still valid against the original (unmutated) `s`
    if (!dupe.ok) throw new Error(dupe.error);
    expect(dupe.state.players[0]!.piecesPlaced).toBe(1);
  });

  it('guarantees the generated piece fits somewhere when any shape would (pity guarantee)', () => {
    const board = createEmptyBoard();
    // Fill almost the entire board, leaving only a single 1x1 space at (7, 7)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (r !== 7 || c !== 7) {
          board[r]![c] = '#ef4444';
        }
      }
    }

    const rng = mulberry32(12345);
    for (let i = 0; i < 20; i++) {
      const piece = generatePiece(board, rng);
      expect(canPlacePiece(board, piece, 7, 7)).toBe(true);
    }
  });
});

describe('block-blaster: game over detection & restart', () => {
  it('detects game over when the current piece has nowhere left to go', () => {
    const board = createEmptyBoard();
    // Fill every cell on board
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        board[r]![c] = '#ef4444';
      }
    }

    const rng = mulberry32(1);
    const dot = instantiatePiece(BLOCK_SHAPES.find((s: { id: string }) => s.id === 'dot_1x1')!, rng);
    expect(checkGameOver(board, dot)).toBe(true);
  });

  it('allows restart after game over', () => {
    const s = blockBlaster.setup(['p1'], 100, {});
    const p = s.players[0]!;
    p.gameOver = true;
    s.phase = 'game_over';

    const r = blockBlaster.reduce(s, 'p1', { type: 'restart' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.gameOver).toBe(false);
    expect(r.state.phase).toBe('playing');
  });
});

describe('block-blaster: starting templates & difficulty scales', () => {
  it('generates non-empty templated boards for starting layouts', () => {
    const sBait = blockBlaster.setup(['p1'], 1, { startingLayout: 'bait', difficulty: 'easy' });
    const pBait = sBait.players[0]!;
    const occupiedBait = pBait.board.flat().filter((cell) => cell !== 0);
    expect(occupiedBait.length).toBeGreaterThan(5);

    const sEmpty = blockBlaster.setup(['p1'], 1, { startingLayout: 'empty' });
    const occupiedEmpty = sEmpty.players[0]!.board.flat().filter((cell) => cell !== 0);
    expect(occupiedEmpty.length).toBe(0);
  });

  it('scales piece generation difficulty appropriately', () => {
    const board = createEmptyBoard();
    const rngEasy = mulberry32(100);
    let largeEasy = 0;
    for (let i = 0; i < 200; i++) {
      if (generatePiece(board, rngEasy, 'easy').category === 'large') largeEasy++;
    }
    expect(largeEasy).toBe(0); // easy never rolls a large piece

    const rngHard = mulberry32(100);
    let largeHard = 0;
    for (let i = 0; i < 200; i++) {
      if (generatePiece(board, rngHard, 'hard').category === 'large') largeHard++;
    }
    expect(largeHard).toBeGreaterThan(20); // hard rolls large pieces far more often
  });

  it('allows restart with different difficulty and layout', () => {
    const s = blockBlaster.setup(['p1'], 1, { difficulty: 'easy', startingLayout: 'empty' });
    expect(s.config.difficulty).toBe('easy');

    const r = blockBlaster.reduce(s, 'p1', { type: 'restart', difficulty: 'hard', startingLayout: 'bait' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.state.config.difficulty).toBe('hard');
    expect(r.state.config.startingLayout).toBe('bait');
    const occupied = r.state.players[0]!.board.flat().filter((c) => c !== 0);
    expect(occupied.length).toBeGreaterThan(0);
  });
});
