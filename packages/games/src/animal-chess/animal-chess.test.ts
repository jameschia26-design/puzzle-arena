import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@puzzle-arena/shared';
import { animalChess } from './index.js';
import { animalChessBot } from './bot.js';
import {
  canCapture,
  DEN_0,
  DEN_1,
  isDen,
  isTrap,
  isWater,
  pieceMoves,
  pointOf,
} from './rules.js';
import type { AnimalPiece } from './state.js';

describe('Animal Chess (Dou Shou Qi / 斗兽棋)', () => {
  it('sets up 8 pieces per side in standard positions with correct terrain', () => {
    const s = animalChess.setup(['alice', 'bob'], 42, null);
    expect(s.players[0]?.id).toBe('alice');
    expect(s.players[1]?.id).toBe('bob');
    expect(s.current).toBe(0);
    expect(s.phase).toBe('playing');

    const blueLion = s.board[pointOf(0, 0)];
    expect(blueLion).toEqual({ type: 'lion', side: 0 });

    const blueTiger = s.board[pointOf(0, 6)];
    expect(blueTiger).toEqual({ type: 'tiger', side: 0 });

    const redLion = s.board[pointOf(8, 6)];
    expect(redLion).toEqual({ type: 'lion', side: 1 });

    const redTiger = s.board[pointOf(8, 0)];
    expect(redTiger).toEqual({ type: 'tiger', side: 1 });

    // Terrain checks
    expect(isDen(DEN_0, 0)).toBe(true);
    expect(isDen(DEN_1, 1)).toBe(true);
    expect(isWater(pointOf(3, 1))).toBe(true);
    expect(isWater(pointOf(4, 2))).toBe(true);
    expect(isWater(pointOf(0, 0))).toBe(false);
    expect(isTrap(pointOf(0, 2), 0)).toBe(true);
    expect(isTrap(pointOf(8, 2), 1)).toBe(true);
  });

  it('generates legal opening moves for Blue', () => {
    const s = animalChess.setup(['alice', 'bob'], 42, null);
    const legal = animalChess.legalActions(s, 'alice');
    expect(legal.length).toBeGreaterThan(0);
    // Bob cannot act out of turn
    expect(animalChess.legalActions(s, 'bob')).toEqual([]);
  });

  describe('Rat special abilities', () => {
    it('allows Rat to enter water and swim, but forbids non-rats from water', () => {
      const board: (AnimalPiece | null)[] = Array(63).fill(null);
      // Rat at (row 2, col 1) - adjacent to river (row 3, col 1)
      board[pointOf(2, 1)] = { type: 'rat', side: 0 };
      // Cat at (row 2, col 2) - adjacent to river (row 3, col 2)
      board[pointOf(2, 2)] = { type: 'cat', side: 0 };

      const ratMoves = pieceMoves(board, pointOf(2, 1));
      expect(ratMoves).toContain(pointOf(3, 1)); // Rat can enter water

      const catMoves = pieceMoves(board, pointOf(2, 2));
      expect(catMoves).not.toContain(pointOf(3, 2)); // Cat cannot enter water
    });

    it('allows Rat on land to capture Elephant on land, but Elephant cannot capture Rat', () => {
      const rat: AnimalPiece = { type: 'rat', side: 0 };
      const elephant: AnimalPiece = { type: 'elephant', side: 1 };
      const land1 = pointOf(2, 1);
      const land2 = pointOf(2, 2);

      expect(canCapture(rat, land1, elephant, land2)).toBe(true);
      expect(canCapture(elephant, land2, rat, land1)).toBe(false);
    });

    it('forbids Rat in water from capturing Elephant on land', () => {
      const rat: AnimalPiece = { type: 'rat', side: 0 };
      const elephant: AnimalPiece = { type: 'elephant', side: 1 };
      const water = pointOf(3, 1);
      const land = pointOf(2, 1);

      expect(canCapture(rat, water, elephant, land)).toBe(false);
      expect(canCapture(elephant, land, rat, water)).toBe(false); // Land piece cannot capture Rat in water
    });

    it('allows Rat in water to capture enemy Rat in water', () => {
      const rat0: AnimalPiece = { type: 'rat', side: 0 };
      const rat1: AnimalPiece = { type: 'rat', side: 1 };
      const water1 = pointOf(3, 1);
      const water2 = pointOf(4, 1);

      expect(canCapture(rat0, water1, rat1, water2)).toBe(true);
    });
  });

  describe('Lion and Tiger river jumps', () => {
    it('allows Lion and Tiger to jump horizontally across river', () => {
      const board: (AnimalPiece | null)[] = Array(63).fill(null);
      // Lion at (row 3, col 0), jumps to (row 3, col 3)
      board[pointOf(3, 0)] = { type: 'lion', side: 0 };

      const moves = pieceMoves(board, pointOf(3, 0));
      expect(moves).toContain(pointOf(3, 3));
    });

    it('allows Lion and Tiger to jump vertically across river', () => {
      const board: (AnimalPiece | null)[] = Array(63).fill(null);
      // Tiger at (row 2, col 1), jumps over rows 3,4,5 to (row 6, col 1)
      board[pointOf(2, 1)] = { type: 'tiger', side: 0 };

      const moves = pieceMoves(board, pointOf(2, 1));
      expect(moves).toContain(pointOf(6, 1));
    });

    it('blocks jump when a Rat is in the river path', () => {
      const board: (AnimalPiece | null)[] = Array(63).fill(null);
      board[pointOf(3, 0)] = { type: 'lion', side: 0 };
      // Rat swimming in river at (row 3, col 1)
      board[pointOf(3, 1)] = { type: 'rat', side: 1 };

      const moves = pieceMoves(board, pointOf(3, 0));
      expect(moves).not.toContain(pointOf(3, 3));
    });

    it('allows jump to capture an enemy piece of equal or lower rank on landing', () => {
      const board: (AnimalPiece | null)[] = Array(63).fill(null);
      board[pointOf(3, 0)] = { type: 'lion', side: 0 };
      board[pointOf(3, 3)] = { type: 'tiger', side: 1 }; // Tiger rank 6 < Lion rank 7

      const moves = pieceMoves(board, pointOf(3, 0));
      expect(moves).toContain(pointOf(3, 3));
    });
  });

  describe('Traps and Dens', () => {
    it('reduces trapped piece combat power to 0, allowing lower rank piece to capture it', () => {
      const board: (AnimalPiece | null)[] = Array(63).fill(null);
      // Red Lion at Blue Trap (row 0, col 2 = pt 2)
      const redLion: AnimalPiece = { type: 'lion', side: 1 };
      const blueCat: AnimalPiece = { type: 'cat', side: 0 };
      board[pointOf(0, 2)] = redLion;
      board[pointOf(0, 1)] = blueCat;

      // Blue Cat can capture Red Lion in Blue's trap
      expect(canCapture(blueCat, pointOf(0, 1), redLion, pointOf(0, 2))).toBe(true);
    });

    it('prevents entering own Den', () => {
      const board: (AnimalPiece | null)[] = Array(63).fill(null);
      board[pointOf(0, 2)] = { type: 'dog', side: 0 };
      // Move toward (0, 3) which is Blue's own Den
      const moves = pieceMoves(board, pointOf(0, 2));
      expect(moves).not.toContain(DEN_0);
    });

    it('triggers game over when entering opponent Den', () => {
      let s = animalChess.setup(['alice', 'bob'], 123, null);
      s.board = Array(63).fill(null);
      // Alice piece adjacent to Bob's den (row 7, col 3 -> pt 52)
      s.board[pointOf(7, 3)] = { type: 'leopard', side: 0 };
      s.current = 0;

      const res = animalChess.reduce(s, 'alice', {
        type: 'move',
        from: pointOf(7, 3),
        to: DEN_1, // (row 8, col 3)
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.state.phase).toBe('game_over');
        expect(res.state.winner).toBe('alice');
        expect(res.state.winReason).toBe('den');
      }
    });
  });

  describe('Bot Policy', () => {
    it('chooses legal moves across easy, normal, and hard difficulties', () => {
      const s = animalChess.setup(['alice', 'bot'], 42, null);
      const v = animalChess.view(s, 'alice');
      const rng = mulberry32(123);

      const easyAction = animalChessBot.chooseAction(v as never, 'alice', rng, 'easy');
      expect(easyAction.type).toBe('move');

      const normalAction = animalChessBot.chooseAction(v as never, 'alice', rng, 'normal');
      expect(normalAction.type).toBe('move');

      const hardAction = animalChessBot.chooseAction(v as never, 'alice', rng, 'hard');
      expect(hardAction.type).toBe('move');
    });
  });
});
