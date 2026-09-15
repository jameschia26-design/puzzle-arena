export type CellState = 0 | string;

export type PieceCategory = 'small' | 'medium' | 'large';

export interface BlockPiece {
  id: string;
  shape: number[][];
  color: string;
  width: number;
  height: number;
  cellCount: number;
  category: PieceCategory;
}

export const BLOCK_BLASTER_BOARD_SIZE = 8;
export const BLOCK_BLASTER_TRAY_SIZE = 3;
export const BLOCK_BLASTER_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type BlockBlasterDifficulty = (typeof BLOCK_BLASTER_DIFFICULTIES)[number];

export const BLOCK_BLASTER_LAYOUTS = [
  'empty',
  'templated',
  'bait',
  'corners',
  'scattered',
  'crossroads',
] as const;
export type BlockBlasterLayout = (typeof BLOCK_BLASTER_LAYOUTS)[number];

export interface StartingTemplate {
  id: string;
  name: string;
  description: string;
  blocks: [number, number, string][];
}

export const STARTING_TEMPLATES: Record<string, StartingTemplate> = {
  empty: {
    id: 'empty',
    name: 'Clean Slate',
    description: 'Completely empty 8×8 grid.',
    blocks: [],
  },
  bait: {
    id: 'bait',
    name: 'Blast Bait',
    description: 'Near-complete row and column set up for instant combo blasts.',
    blocks: [
      // Row 3 (cols 0, 1, 2, 5, 6, 7 filled, cols 3, 4 open)
      [3, 0, '#38bdf8'],
      [3, 1, '#38bdf8'],
      [3, 2, '#06b6d4'],
      [3, 5, '#10b981'],
      [3, 6, '#38bdf8'],
      [3, 7, '#38bdf8'],
      // Col 4 (rows 0, 1, 5, 6, 7 filled, rows 2, 3, 4 open)
      [0, 4, '#a855f7'],
      [1, 4, '#a855f7'],
      [5, 4, '#f97316'],
      [6, 4, '#eab308'],
      [7, 4, '#eab308'],
    ],
  },
  corners: {
    id: 'corners',
    name: 'Four Corners',
    description: 'L-corner clusters defending the 4 edges.',
    blocks: [
      // Top-Left
      [0, 0, '#a855f7'],
      [0, 1, '#a855f7'],
      [1, 0, '#a855f7'],
      // Top-Right
      [0, 6, '#8b5cf6'],
      [0, 7, '#8b5cf6'],
      [1, 7, '#8b5cf6'],
      // Bottom-Left
      [6, 0, '#06b6d4'],
      [7, 0, '#06b6d4'],
      [7, 1, '#06b6d4'],
      // Bottom-Right
      [6, 7, '#f97316'],
      [7, 6, '#f97316'],
      [7, 7, '#f97316'],
    ],
  },
  scattered: {
    id: 'scattered',
    name: 'Scattered Gems',
    description: 'Anchor gems scattered across the board to plan combos around.',
    blocks: [
      [1, 2, '#38bdf8'],
      [1, 5, '#eab308'],
      [2, 2, '#10b981'],
      [2, 5, '#ec4899'],
      [5, 2, '#ec4899'],
      [5, 5, '#10b981'],
      [6, 2, '#eab308'],
      [6, 5, '#38bdf8'],
    ],
  },
  crossroads: {
    id: 'crossroads',
    name: 'Center Diamond',
    description: 'Central diamond formation creating tactical corridors.',
    blocks: [
      [2, 3, '#f43f5e'],
      [2, 4, '#f43f5e'],
      [3, 2, '#3b82f6'],
      [3, 5, '#3b82f6'],
      [4, 2, '#3b82f6'],
      [4, 5, '#3b82f6'],
      [5, 3, '#f43f5e'],
      [5, 4, '#f43f5e'],
    ],
  },
};

export function createEmptyBoard(): CellState[][] {
  const board: CellState[][] = [];
  for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
    board.push(new Array<CellState>(BLOCK_BLASTER_BOARD_SIZE).fill(0));
  }
  return board;
}

export function createStartingBoard(
  layout: BlockBlasterLayout = 'templated',
  difficulty: BlockBlasterDifficulty = 'normal',
  seedModifier = 0,
): CellState[][] {
  const board = createEmptyBoard();
  let chosen = layout;

  if (chosen === 'templated') {
    if (difficulty === 'easy') {
      chosen = 'bait';
    } else if (difficulty === 'hard') {
      chosen = seedModifier % 2 === 0 ? 'corners' : 'crossroads';
    } else {
      const pool: BlockBlasterLayout[] = ['bait', 'scattered', 'corners', 'crossroads'];
      chosen = pool[Math.abs(seedModifier) % pool.length] ?? 'scattered';
    }
  }

  const tmpl = STARTING_TEMPLATES[chosen] ?? STARTING_TEMPLATES.empty;
  if (tmpl) {
    for (const [r, c, color] of tmpl.blocks) {
      const row = board[r];
      if (row && c >= 0 && c < BLOCK_BLASTER_BOARD_SIZE) {
        row[c] = color;
      }
    }
  }

  return board;
}


export interface ShapeDefinition {
  id: string;
  shape: number[][];
  color: string;
  category: PieceCategory;
}

export const BLOCK_SHAPES: ShapeDefinition[] = [
  // Dot (1 cell)
  { id: 'dot_1x1', shape: [[1]], color: '#38bdf8', category: 'small' },

  // Dominoes (2 cells)
  { id: 'domino_1x2', shape: [[1, 1]], color: '#06b6d4', category: 'small' },
  { id: 'domino_2x1', shape: [[1], [1]], color: '#06b6d4', category: 'small' },

  // Trios / 3-Lines (3 cells)
  { id: 'trio_1x3', shape: [[1, 1, 1]], color: '#10b981', category: 'small' },
  { id: 'trio_3x1', shape: [[1], [1], [1]], color: '#10b981', category: 'small' },

  // Small Corners (3 cells)
  { id: 'corner_small_tl', shape: [[1, 1], [1, 0]], color: '#a855f7', category: 'small' },
  { id: 'corner_small_tr', shape: [[1, 1], [0, 1]], color: '#a855f7', category: 'small' },
  { id: 'corner_small_bl', shape: [[1, 0], [1, 1]], color: '#a855f7', category: 'small' },
  { id: 'corner_small_br', shape: [[0, 1], [1, 1]], color: '#a855f7', category: 'small' },

  // Quads / 4-Lines (4 cells)
  { id: 'quad_1x4', shape: [[1, 1, 1, 1]], color: '#3b82f6', category: 'medium' },
  { id: 'quad_4x1', shape: [[1], [1], [1], [1]], color: '#3b82f6', category: 'medium' },

  // 2x2 Square (4 cells)
  { id: 'square_2x2', shape: [[1, 1], [1, 1]], color: '#eab308', category: 'medium' },

  // T-Shapes (4 cells)
  { id: 't_up', shape: [[0, 1, 0], [1, 1, 1]], color: '#ec4899', category: 'medium' },
  { id: 't_down', shape: [[1, 1, 1], [0, 1, 0]], color: '#ec4899', category: 'medium' },
  { id: 't_left', shape: [[0, 1], [1, 1], [0, 1]], color: '#ec4899', category: 'medium' },
  { id: 't_right', shape: [[1, 0], [1, 1], [1, 0]], color: '#ec4899', category: 'medium' },

  // Z / S Shapes (4 cells)
  { id: 'z_horiz', shape: [[1, 1, 0], [0, 1, 1]], color: '#22c55e', category: 'medium' },
  { id: 's_horiz', shape: [[0, 1, 1], [1, 1, 0]], color: '#22c55e', category: 'medium' },
  { id: 'z_vert', shape: [[0, 1], [1, 1], [1, 0]], color: '#22c55e', category: 'medium' },
  { id: 's_vert', shape: [[1, 0], [1, 1], [0, 1]], color: '#22c55e', category: 'medium' },

  // L / J 4-cell tetrominoes (4 cells)
  { id: 'l_4_down_right', shape: [[1, 0], [1, 0], [1, 1]], color: '#f97316', category: 'medium' },
  { id: 'j_4_down_left', shape: [[0, 1], [0, 1], [1, 1]], color: '#f97316', category: 'medium' },
  { id: 'l_4_up_right', shape: [[1, 1], [1, 0], [1, 0]], color: '#f97316', category: 'medium' },
  { id: 'j_4_up_left', shape: [[1, 1], [0, 1], [0, 1]], color: '#f97316', category: 'medium' },
  { id: 'l_4_horiz_up', shape: [[1, 1, 1], [1, 0, 0]], color: '#f97316', category: 'medium' },
  { id: 'l_4_horiz_down', shape: [[1, 0, 0], [1, 1, 1]], color: '#f97316', category: 'medium' },
  { id: 'j_4_horiz_up', shape: [[1, 1, 1], [0, 0, 1]], color: '#f97316', category: 'medium' },
  { id: 'j_4_horiz_down', shape: [[0, 0, 1], [1, 1, 1]], color: '#f97316', category: 'medium' },

  // Pentamino Lines / 5-Lines (5 cells)
  { id: 'line_1x5', shape: [[1, 1, 1, 1, 1]], color: '#f43f5e', category: 'large' },
  { id: 'line_5x1', shape: [[1], [1], [1], [1], [1]], color: '#f43f5e', category: 'large' },

  // Large Corners (5 cells)
  { id: 'corner_large_tl', shape: [[1, 1, 1], [1, 0, 0], [1, 0, 0]], color: '#8b5cf6', category: 'large' },
  { id: 'corner_large_tr', shape: [[1, 1, 1], [0, 0, 1], [0, 0, 1]], color: '#8b5cf6', category: 'large' },
  { id: 'corner_large_bl', shape: [[1, 0, 0], [1, 0, 0], [1, 1, 1]], color: '#8b5cf6', category: 'large' },
  { id: 'corner_large_br', shape: [[0, 0, 1], [0, 0, 1], [1, 1, 1]], color: '#8b5cf6', category: 'large' },

  // 3x3 Square (9 cells)
  {
    id: 'square_3x3',
    shape: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    color: '#ef4444',
    category: 'large',
  },
];

export function createBlockPiece(def: ShapeDefinition, instanceId?: string): BlockPiece {
  let cellCount = 0;
  for (const row of def.shape) {
    for (const cell of row) {
      if (cell === 1) cellCount++;
    }
  }
  return {
    id: instanceId ?? `${def.id}_${Math.random().toString(36).slice(2, 8)}`,
    shape: def.shape,
    color: def.color,
    width: def.shape[0]?.length ?? 0,
    height: def.shape.length,
    cellCount,
    category: def.category,
  };
}

export const SHAPES_BY_CATEGORY: Record<PieceCategory, ShapeDefinition[]> = {
  small: BLOCK_SHAPES.filter((s) => s.category === 'small'),
  medium: BLOCK_SHAPES.filter((s) => s.category === 'medium'),
  large: BLOCK_SHAPES.filter((s) => s.category === 'large'),
};

export function canPlacePiece(
  board: CellState[][],
  piece: BlockPiece,
  targetRow: number,
  targetCol: number,
): boolean {
  for (let r = 0; r < piece.shape.length; r++) {
    const shapeRow = piece.shape[r];
    if (!shapeRow) continue;
    for (let c = 0; c < shapeRow.length; c++) {
      if (shapeRow[c] === 1) {
        const boardR = targetRow + r;
        const boardC = targetCol + c;

        // 1. Boundary Check
        if (
          boardR < 0 ||
          boardR >= BLOCK_BLASTER_BOARD_SIZE ||
          boardC < 0 ||
          boardC >= BLOCK_BLASTER_BOARD_SIZE
        ) {
          return false;
        }
        // 2. Collision Check
        const boardRow = board[boardR];
        if (!boardRow || boardRow[boardC] !== 0) {
          return false;
        }
      }
    }
  }
  return true;
}

export function hasAnyPlacement(board: CellState[][], piece: BlockPiece): boolean {
  const maxR = BLOCK_BLASTER_BOARD_SIZE - piece.height;
  const maxC = BLOCK_BLASTER_BOARD_SIZE - piece.width;
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      if (canPlacePiece(board, piece, r, c)) {
        return true;
      }
    }
  }
  return false;
}

export function checkGameOver(board: CellState[][], tray: (BlockPiece | null)[]): boolean {
  const remainingPieces = tray.filter((p): p is BlockPiece => p !== null);
  if (remainingPieces.length === 0) return false;

  for (const piece of remainingPieces) {
    if (hasAnyPlacement(board, piece)) {
      return false;
    }
  }
  return true;
}
