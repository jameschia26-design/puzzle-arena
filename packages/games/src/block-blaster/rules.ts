import type { Rng } from '@puzzle-arena/shared';
import {
  BLOCK_BLASTER_BOARD_SIZE,
  BLOCK_BLASTER_TRAY_SIZE,
  BLOCK_SHAPES,
  SHAPES_BY_CATEGORY,
  canPlacePiece,
  hasAnyPlacement,
  checkGameOver,
  type BlockPiece,
  type CellState,
  type PieceCategory,
  type ShapeDefinition,
} from '@puzzle-arena/shared';
import type { ClearEvent } from './state.js';

export {
  BLOCK_BLASTER_BOARD_SIZE,
  BLOCK_BLASTER_TRAY_SIZE,
  BLOCK_SHAPES,
  SHAPES_BY_CATEGORY,
  canPlacePiece,
  hasAnyPlacement,
  checkGameOver,
};

export function createEmptyBoard(): CellState[][] {
  const board: CellState[][] = [];
  for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
    board.push(new Array<CellState>(BLOCK_BLASTER_BOARD_SIZE).fill(0));
  }
  return board;
}

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
 * Generates a batch of 3 pieces according to fairness and safety specifications:
 * 1. Bag Weighting: Small (~35%), Medium (~50%), Large (~15%).
 * 2. Safety Check: Maximum one Large piece per batch of 3.
 * 3. Pity Guarantee: At least one piece in the batch must have a valid placement on the board.
 */
export function generateBatch(board: CellState[][], rng: Rng): BlockPiece[] {
  const batch: BlockPiece[] = [];
  let largeCount = 0;

  for (let i = 0; i < BLOCK_BLASTER_TRAY_SIZE; i++) {
    // Determine category based on weighting
    let category: PieceCategory;
    const roll = rng.int(100);

    if (roll < 35) {
      category = 'small';
    } else if (roll < 85) {
      category = 'medium';
    } else {
      category = 'large';
    }

    // Safety rule: Max 1 large piece per batch of 3
    if (category === 'large') {
      if (largeCount >= 1) {
        // Fall back to medium or small
        category = rng.int(2) === 0 ? 'small' : 'medium';
      } else {
        largeCount++;
      }
    }

    const pool = SHAPES_BY_CATEGORY[category];
    const pickedDef = pool[rng.int(pool.length)];
    if (!pickedDef) {
      // Fallback
      batch.push(instantiatePiece(BLOCK_SHAPES[0]!, rng));
    } else {
      batch.push(instantiatePiece(pickedDef, rng));
    }
  }

  // Pity Guarantee: Check if at least one piece in batch can be placed on current board
  const hasFit = batch.some((piece) => hasAnyPlacement(board, piece));
  if (!hasFit) {
    // Find all shape definitions from catalog that can fit on board
    const fittingDefs: ShapeDefinition[] = [];
    for (const def of BLOCK_SHAPES) {
      const testPiece = instantiatePiece(def, rng);
      if (hasAnyPlacement(board, testPiece)) {
        fittingDefs.push(def);
      }
    }

    if (fittingDefs.length > 0) {
      // Replace one of the pieces in batch with a fitting piece
      const replaceIdx = rng.int(batch.length);
      const chosenDef = fittingDefs[rng.int(fittingDefs.length)]!;
      batch[replaceIdx] = instantiatePiece(chosenDef, rng);
    }
  }

  return batch;
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
