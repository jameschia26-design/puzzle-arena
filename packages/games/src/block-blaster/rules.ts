import type { Rng } from '@puzzle-arena/shared';
import {
  BLOCK_BLASTER_BOARD_SIZE,
  BLOCK_BLASTER_TRAY_SIZE,
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
  BLOCK_BLASTER_TRAY_SIZE,
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

/** Score needed per escalation tier, and the highest tier reached. Tuned so
 * the mix visibly shifts within the first couple of clears (~600-800 pts)
 * and reaches its hardest mix by the time a run is going well (~4800+),
 * while the pity guarantee below still keeps every batch playable. */
const ESCALATION_SCORE_STEP = 800;
const MAX_ESCALATION_TIER = 6;

/**
 * Generates a batch of 3 pieces according to fairness and safety specifications:
 * 1. Bag Weighting: Small (~35%), Medium (~50%), Large (~15%) at the difficulty's
 *    base mix, shifted toward Medium/Large as `score` climbs (see escalation
 *    tiers below) - otherwise every batch for the whole game looks like the
 *    difficulty picked at setup, no matter how far the run has gone.
 * 2. Safety Check: capped Large pieces per batch of 3, the cap itself rising
 *    with the escalation tier.
 * 3. Pity Guarantee: At least one piece in the batch must have a valid placement on the board.
 */
export function generateBatch(
  board: CellState[][],
  rng: Rng,
  difficulty: BlockBlasterDifficulty = 'normal',
  score = 0,
): BlockPiece[] {
  const batch: BlockPiece[] = [];
  let largeCount = 0;

  // Difficulty weighting thresholds (base mix, at score 0)
  const baseSmallThreshold = difficulty === 'easy' ? 50 : difficulty === 'hard' ? 20 : 35;
  const baseMediumThreshold = difficulty === 'easy' ? 95 : difficulty === 'hard' ? 65 : 85;
  const baseMaxLargeAllowed = difficulty === 'easy' ? 0 : difficulty === 'hard' ? 2 : 1;

  // Escalation: every ESCALATION_SCORE_STEP points shaves the "small" band
  // and the "medium" band down, which grows the "large" band (100 - medium)
  // and, every other tier, allows one more Large piece per batch. Applies on
  // top of every difficulty, since "harder as you go" is a property of the
  // run, not just of Hard mode.
  const tier = Math.min(MAX_ESCALATION_TIER, Math.max(0, Math.floor(score / ESCALATION_SCORE_STEP)));
  const smallThreshold = Math.max(8, baseSmallThreshold - tier * 4);
  const mediumThreshold = Math.max(smallThreshold + 15, baseMediumThreshold - tier * 3);
  const maxLargeAllowed = Math.min(BLOCK_BLASTER_TRAY_SIZE, baseMaxLargeAllowed + Math.floor(tier / 2));

  for (let i = 0; i < BLOCK_BLASTER_TRAY_SIZE; i++) {
    let category: PieceCategory;
    const roll = rng.int(100);

    if (roll < smallThreshold) {
      category = 'small';
    } else if (roll < mediumThreshold) {
      category = 'medium';
    } else {
      category = 'large';
    }

    if (category === 'large') {
      if (largeCount >= maxLargeAllowed) {
        category = rng.int(2) === 0 ? 'small' : 'medium';
      } else {
        largeCount++;
      }
    }

    const pool = SHAPES_BY_CATEGORY[category];
    const pickedDef = pool[rng.int(pool.length)];
    if (!pickedDef) {
      batch.push(instantiatePiece(BLOCK_SHAPES[0]!, rng));
    } else {
      batch.push(instantiatePiece(pickedDef, rng));
    }
  }

  // Pity Guarantee:
  // For easy: ensure at least 2 pieces fit if board has room
  // For normal & hard: ensure at least 1 piece fits
  const minFittingCount = difficulty === 'easy' ? 2 : 1;
  let fittingCount = batch.filter((piece) => hasAnyPlacement(board, piece)).length;

  if (fittingCount < minFittingCount) {
    const fittingDefs: ShapeDefinition[] = [];
    for (const def of BLOCK_SHAPES) {
      const testPiece = instantiatePiece(def, rng);
      if (hasAnyPlacement(board, testPiece)) {
        fittingDefs.push(def);
      }
    }

    if (fittingDefs.length > 0) {
      for (let i = 0; i < batch.length && fittingCount < minFittingCount; i++) {
        const curPiece = batch[i]!;
        if (!hasAnyPlacement(board, curPiece)) {
          const chosenDef = fittingDefs[rng.int(fittingDefs.length)]!;
          batch[i] = instantiatePiece(chosenDef, rng);
          fittingCount++;
        }
      }
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
