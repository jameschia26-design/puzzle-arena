import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@puzzle-arena/shared';
import {
  blockBlaster,
  createEmptyBoard,
  canPlacePiece,
  applyPlacement,
  checkGameOver,
  generateBatch,
  instantiatePiece,
  BLOCK_SHAPES,
} from './index.js';

describe('block-blaster: board and placement', () => {
  it('initializes game with 8x8 boards and 3 tray pieces', () => {
    const s = blockBlaster.setup(['p1', 'p2'], 12345, {});
    expect(s.players).toHaveLength(2);
    expect(s.players[0]!.board).toHaveLength(8);
    expect(s.players[0]!.board[0]).toHaveLength(8);
    expect(s.players[0]!.tray).toHaveLength(3);
    expect(s.players[0]!.tray.every((p) => p !== null)).toBe(true);
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

describe('block-blaster: tray refilling & safety checks', () => {
  it('tray refills with 3 pieces only when all 3 are placed', () => {
    let cur = blockBlaster.setup(['p1'], 999, {});
    let p = cur.players[0]!;

    // Find valid coords for piece 0
    let placed0 = false;
    for (let r = 0; r < 8 && !placed0; r++) {
      for (let c = 0; c < 8 && !placed0; c++) {
        if (canPlacePiece(p.board, p.tray[0]!, r, c)) {
          const r1 = blockBlaster.reduce(cur, 'p1', { type: 'place', pieceIndex: 0, row: r, col: c });
          expect(r1.ok).toBe(true);
          if (r1.ok) cur = r1.state;
          p = cur.players[0]!;
          placed0 = true;
        }
      }
    }
    expect(placed0).toBe(true);
    expect(p.tray[0]).toBeNull();
    expect(p.tray[1]).not.toBeNull();
    expect(p.tray[2]).not.toBeNull();

    // Place piece 1
    let placed1 = false;
    for (let r = 0; r < 8 && !placed1; r++) {
      for (let c = 0; c < 8 && !placed1; c++) {
        if (canPlacePiece(p.board, p.tray[1]!, r, c)) {
          const r2 = blockBlaster.reduce(cur, 'p1', { type: 'place', pieceIndex: 1, row: r, col: c });
          expect(r2.ok).toBe(true);
          if (r2.ok) cur = r2.state;
          p = cur.players[0]!;
          placed1 = true;
        }
      }
    }
    expect(placed1).toBe(true);
    expect(p.tray[0]).toBeNull();
    expect(p.tray[1]).toBeNull();
    expect(p.tray[2]).not.toBeNull();

    // Place piece 2 -> should refill all 3 slots
    let placed2 = false;
    for (let r = 0; r < 8 && !placed2; r++) {
      for (let c = 0; c < 8 && !placed2; c++) {
        if (canPlacePiece(p.board, p.tray[2]!, r, c)) {
          const r3 = blockBlaster.reduce(cur, 'p1', { type: 'place', pieceIndex: 2, row: r, col: c });
          expect(r3.ok).toBe(true);
          if (r3.ok) cur = r3.state;
          p = cur.players[0]!;
          placed2 = true;
        }
      }
    }
    expect(placed2).toBe(true);
    expect(p.tray[0]).not.toBeNull();
    expect(p.tray[1]).not.toBeNull();
    expect(p.tray[2]).not.toBeNull();
  });

  it('never spawns more than 1 large piece per batch', () => {
    const board = createEmptyBoard();
    const rng = mulberry32(42);

    for (let i = 0; i < 50; i++) {
      const batch = generateBatch(board, rng);
      const largePieces = batch.filter((p) => p.category === 'large');
      expect(largePieces.length).toBeLessThanOrEqual(1);
    }
  });

  it('guarantees at least one piece can be placed (pity guarantee)', () => {
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
      const batch = generateBatch(board, rng);
      const hasLegalPlacement = batch.some((piece) => canPlacePiece(board, piece, 7, 7));
      expect(hasLegalPlacement).toBe(true);
    }
  });
});

describe('block-blaster: game over detection & restart', () => {
  it('detects game over when no remaining piece fits on board', () => {
    const board = createEmptyBoard();
    // Fill every cell on board
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        board[r]![c] = '#ef4444';
      }
    }

    const rng = mulberry32(1);
    const dot = instantiatePiece(BLOCK_SHAPES.find((s: { id: string }) => s.id === 'dot_1x1')!, rng);
    expect(checkGameOver(board, [dot, null, null])).toBe(true);
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
    for (let i = 0; i < 30; i++) {
      const batch = generateBatch(board, rngEasy, 'easy');
      largeEasy += batch.filter((p) => p.category === 'large').length;
    }
    expect(largeEasy).toBe(0); // easy has 0 large pieces

    const rngHard = mulberry32(100);
    let largeHard = 0;
    for (let i = 0; i < 30; i++) {
      const batch = generateBatch(board, rngHard, 'hard');
      largeHard += batch.filter((p) => p.category === 'large').length;
    }
    expect(largeHard).toBeGreaterThan(5); // hard has multiple large pieces
  });

  it('escalates piece difficulty as score climbs, for every difficulty setting', () => {
    const board = createEmptyBoard();

    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const rngLow = mulberry32(7);
      let smallLow = 0;
      let largeLow = 0;
      for (let i = 0; i < 40; i++) {
        const batch = generateBatch(board, rngLow, difficulty, 0);
        smallLow += batch.filter((p) => p.category === 'small').length;
        largeLow += batch.filter((p) => p.category === 'large').length;
      }

      const rngHigh = mulberry32(7);
      let smallHigh = 0;
      let largeHigh = 0;
      for (let i = 0; i < 40; i++) {
        const batch = generateBatch(board, rngHigh, difficulty, 6000);
        smallHigh += batch.filter((p) => p.category === 'small').length;
        largeHigh += batch.filter((p) => p.category === 'large').length;
      }

      // A high-score batch skews toward fewer small pieces and more large ones
      // than the same difficulty's opening batches - the mix isn't frozen at
      // whatever the player picked at setup for the whole run.
      expect(smallHigh).toBeLessThan(smallLow);
      expect(largeHigh).toBeGreaterThan(largeLow);
    }
  });

  it('allows more than one large piece per batch at a high escalation tier', () => {
    const board = createEmptyBoard();
    const rng = mulberry32(99);
    let sawMultipleLarge = false;
    for (let i = 0; i < 60; i++) {
      const batch = generateBatch(board, rng, 'normal', 6000);
      if (batch.filter((p) => p.category === 'large').length > 1) {
        sawMultipleLarge = true;
        break;
      }
    }
    expect(sawMultipleLarge).toBe(true);
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
