import type { Rng } from '@puzzle-arena/shared';
import {
  BLOCK_BLASTER_BOARD_SIZE,
  BLOCK_SHAPES,
  SHAPES_BY_CATEGORY,
  canPlacePiece,
  hasAnyPlacement,
  checkGameOver,
  createEmptyBoard,
  createStartingBoard,
  STARTING_TEMPLATES,
  BLOCK_BLASTER_DIFFICULTIES,
  BLOCK_BLASTER_LAYOUTS,
  type BlockPiece,
  type CellState,
  type PieceCategory,
  type ShapeDefinition,
  type BlockBlasterDifficulty,
  type BlockBlasterLayout,
} from '@puzzle-arena/shared';
import type { ClearEvent } from './state.js';

export {
  BLOCK_BLASTER_BOARD_SIZE,
  BLOCK_SHAPES,
  SHAPES_BY_CATEGORY,
  canPlacePiece,
  hasAnyPlacement,
  checkGameOver,
  createEmptyBoard,
  createStartingBoard,
  STARTING_TEMPLATES,
  BLOCK_BLASTER_DIFFICULTIES,
  BLOCK_BLASTER_LAYOUTS,
};


export function cloneBoard(board: CellState[][]): CellState[][] {
  return board.map((row) => [...row]);
}

/**
 * Generate a piece from a shape definition with a deterministic unique ID based on RNG.
 */
export function instantiatePiece(def: ShapeDefinition, rng: Rng): BlockPiece {
  let cellCount = 0;
  for (const row of def.shape) {
    for (const cell of row) {
      if (cell === 1) cellCount++;
    }
  }
  const suffix = rng.int(1_000_000).toString(36).padStart(4, '0');
  return {
    id: `${def.id}_${suffix}`,
    shape: def.shape,
    color: def.color,
    width: def.shape[0]?.length ?? 0,
    height: def.shape.length,
    cellCount,
    category: def.category,
  };
}

/**
 * Picks the next piece's category from the difficulty-weighted distribution:
 * Small (~35%), Medium (~50%), Large (~15%) at 'normal', shifted lighter for
 * 'easy' and heavier for 'hard'.
 */
function pickCategory(rng: Rng, difficulty: BlockBlasterDifficulty): PieceCategory {
  const smallThreshold = difficulty === 'easy' ? 50 : difficulty === 'hard' ? 20 : 35;
  const mediumThreshold = difficulty === 'easy' ? 95 : difficulty === 'hard' ? 65 : 85;
  const roll = rng.int(100);
  let category: PieceCategory;
  if (roll < smallThreshold) category = 'small';
  else if (roll < mediumThreshold) category = 'medium';
  else category = 'large';

  // Easy never hands out a large piece at all - swap the rare 'large' roll
  // for a coin flip between small and medium instead.
  if (category === 'large' && difficulty === 'easy') {
    category = rng.int(2) === 0 ? 'small' : 'medium';
  }
  return category;
}

/**
 * Generates the single next piece. Pity guarantee: if the difficulty-weighted
 * roll produces a piece with nowhere to go on the current board, but some
 * other shape would fit, swap it for one that does - a lone unplayable piece
 * would end the game on a technicality rather than genuine lack of space.
 */
export function generatePiece(
  board: CellState[][],
  rng: Rng,
  difficulty: BlockBlasterDifficulty = 'normal',
): BlockPiece {
  const category = pickCategory(rng, difficulty);
  const pool = SHAPES_BY_CATEGORY[category];
  const pickedDef = pool[rng.int(pool.length)] ?? BLOCK_SHAPES[0]!;
  const piece = instantiatePiece(pickedDef, rng);
  if (hasAnyPlacement(board, piece)) return piece;

  for (const def of BLOCK_SHAPES) {
    const candidate = instantiatePiece(def, rng);
    if (hasAnyPlacement(board, candidate)) return candidate;
  }
  // Board has no room for any shape at all - hand back the original roll;
  // checkGameOver will end the game on the very next placement attempt.
  return piece;
}

export interface PlacementResult {
  ok: boolean;
  error?: string;
  newBoard: CellState[][];
  clearEvent: ClearEvent | null;
  placedPiece: BlockPiece;
  turnScore: number;
  newComboStreak: number;
}

/**
 * Places a piece onto the board at targetRow, targetCol and computes line clears and scoring.
 */
export function applyPlacement(
  board: CellState[][],
  piece: BlockPiece,
  targetRow: number,
  targetCol: number,
  currentComboStreak: number,
): PlacementResult {
  if (!canPlacePiece(board, piece, targetRow, targetCol)) {
    return {
      ok: false,
      error: 'Invalid placement: overlaps existing blocks or out of bounds',
      newBoard: board,
      clearEvent: null,
      placedPiece: piece,
      turnScore: 0,
      newComboStreak: currentComboStreak,
    };
  }

  const nextBoard = cloneBoard(board);

  // 1. Commit piece cells to board
  for (let r = 0; r < piece.shape.length; r++) {
    const shapeRow = piece.shape[r];
    if (!shapeRow) continue;
    for (let c = 0; c < shapeRow.length; c++) {
      if (shapeRow[c] === 1) {
        const boardRow = nextBoard[targetRow + r];
        if (boardRow) {
          boardRow[targetCol + c] = piece.color;
        }
      }
    }
  }

  // 2. Detect full rows and full columns simultaneously
  const fullRows: number[] = [];
  const fullCols: number[] = [];

  for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
    const row = nextBoard[r];
    if (row && row.every((cell) => cell !== 0)) {
      fullRows.push(r);
    }
  }

  for (let c = 0; c < BLOCK_BLASTER_BOARD_SIZE; c++) {
    let isColFull = true;
    for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
      const row = nextBoard[r];
      if (!row || row[c] === 0) {
        isColFull = false;
        break;
      }
    }
    if (isColFull) {
      fullCols.push(c);
    }
  }

  // 3. Clear detected full rows and columns
  for (const r of fullRows) {
    const row = nextBoard[r];
    if (row) {
      for (let c = 0; c < BLOCK_BLASTER_BOARD_SIZE; c++) {
        row[c] = 0;
      }
    }
  }
  for (const c of fullCols) {
    for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
      const row = nextBoard[r];
      if (row) {
        row[c] = 0;
      }
    }
  }

  // 4. Compute score
  // Placement Score: +1 per filled cell in piece
  const placementScore = piece.cellCount;
  const lineCount = fullRows.length + fullCols.length;

  let newComboStreak = 0;
  let baseClear = 0;
  let comboBonus = 0;
  let turnScore = placementScore;

  if (lineCount > 0) {
    newComboStreak = currentComboStreak + 1;
    // Base Clear = 10 * (L * (L + 1) / 2) * 2 = 10 * L * (L + 1)
    baseClear = 10 * lineCount * (lineCount + 1);
    // Combo Bonus = comboStreak > 1 ? (comboStreak * 10 * L) : 0
    comboBonus = newComboStreak > 1 ? newComboStreak * 10 * lineCount : 0;
    turnScore = placementScore + baseClear + comboBonus;
  }

  const clearEvent: ClearEvent | null =
    lineCount > 0
      ? {
          rows: fullRows,
          cols: fullCols,
          points: baseClear + comboBonus,
          combo: newComboStreak,
        }
      : null;

  return {
    ok: true,
    newBoard: nextBoard,
    clearEvent,
    placedPiece: piece,
    turnScore,
    newComboStreak,
  };
}
