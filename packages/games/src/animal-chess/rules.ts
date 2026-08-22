import type {
  AnimalChessLegalMove,
  AnimalChessPlayer,
  AnimalChessState,
  AnimalPiece,
  AnimalSide,
  AnimalType,
} from './state.js';
import { COLS, ROWS, SIZE } from './state.js';

export { COLS, ROWS, SIZE };

export const ANIMAL_RANK: Record<AnimalType, number> = {
  rat: 1,
  cat: 2,
  dog: 3,
  wolf: 4,
  leopard: 5,
  tiger: 6,
  lion: 7,
  elephant: 8,
};

export const ANIMAL_NAMES: Record<AnimalType, { en: string; zh: string }> = {
  rat: { en: 'Rat', zh: '鼠' },
  cat: { en: 'Cat', zh: '猫' },
  dog: { en: 'Dog', zh: '狗' },
  wolf: { en: 'Wolf', zh: '狼' },
  leopard: { en: 'Leopard', zh: '豹' },
  tiger: { en: 'Tiger', zh: '虎' },
  lion: { en: 'Lion', zh: '狮' },
  elephant: { en: 'Elephant', zh: '象' },
};

export const DEN_0 = 3; // (col: 3, row: 0)
export const DEN_1 = 59; // (col: 3, row: 8)

export const TRAPS_0 = [2, 4, 10]; // (col: 2, row: 0), (col: 4, row: 0), (col: 3, row: 1)
export const TRAPS_1 = [58, 60, 52]; // (col: 2, row: 8), (col: 4, row: 8), (col: 3, row: 7)

export const WATER_SQUARES = new Set([
  22, 23, // row 3, col 1..2
  29, 30, // row 4, col 1..2
  36, 37, // row 5, col 1..2
  25, 26, // row 3, col 4..5
  32, 33, // row 4, col 4..5
  39, 40, // row 5, col 4..5
]);

export function rowOf(pt: number): number {
  return Math.floor(pt / COLS);
}

export function colOf(pt: number): number {
  return pt % COLS;
}

export function pointOf(row: number, col: number): number {
  return row * COLS + col;
}

export function isWater(pt: number): boolean {
  return WATER_SQUARES.has(pt);
}

export function isDen(pt: number, side?: AnimalSide): boolean {
  if (side === 0) return pt === DEN_0;
  if (side === 1) return pt === DEN_1;
  return pt === DEN_0 || pt === DEN_1;
}

export function isTrap(pt: number, side?: AnimalSide): boolean {
  if (side === 0) return TRAPS_0.includes(pt);
  if (side === 1) return TRAPS_1.includes(pt);
  return TRAPS_0.includes(pt) || TRAPS_1.includes(pt);
}

export function createInitialBoard(): (AnimalPiece | null)[] {
  const b: (AnimalPiece | null)[] = Array(SIZE).fill(null);

  // Side 0 (Top / Blue)
  b[pointOf(0, 0)] = { type: 'lion', side: 0 };
  b[pointOf(0, 6)] = { type: 'tiger', side: 0 };
  b[pointOf(1, 1)] = { type: 'dog', side: 0 };
  b[pointOf(1, 5)] = { type: 'cat', side: 0 };
  b[pointOf(2, 0)] = { type: 'rat', side: 0 };
  b[pointOf(2, 2)] = { type: 'leopard', side: 0 };
  b[pointOf(2, 4)] = { type: 'wolf', side: 0 };
  b[pointOf(2, 6)] = { type: 'elephant', side: 0 };

  // Side 1 (Bottom / Red)
  b[pointOf(6, 0)] = { type: 'elephant', side: 1 };
  b[pointOf(6, 2)] = { type: 'wolf', side: 1 };
  b[pointOf(6, 4)] = { type: 'leopard', side: 1 };
  b[pointOf(6, 6)] = { type: 'rat', side: 1 };
  b[pointOf(7, 1)] = { type: 'cat', side: 1 };
  b[pointOf(7, 5)] = { type: 'dog', side: 1 };
  b[pointOf(8, 0)] = { type: 'tiger', side: 1 };
  b[pointOf(8, 6)] = { type: 'lion', side: 1 };

  return b;
}

export function canCapture(
  attacker: AnimalPiece,
  from: number,
  defender: AnimalPiece,
  to: number,
): boolean {
  if (attacker.side === defender.side) return false;

  const attackerInWater = isWater(from);
  const defenderInWater = isWater(to);

  // If attacker is in water: only Rat can be in water.
  if (attackerInWater) {
    // Rat in water cannot attack piece on land.
    if (!defenderInWater) return false;
    // Rat in water can attack enemy Rat in water.
    return defender.type === 'rat';
  }

  // If attacker is on land and defender is in water:
  // Land pieces cannot attack piece in water.
  if (defenderInWater) return false;

  // Both pieces are on land:
  // If defender is trapped in attacker's trap, its combat power drops to 0.
  if (isTrap(to, attacker.side)) {
    return true;
  }

  // Rat vs Elephant exception on land
  if (attacker.type === 'rat' && defender.type === 'elephant') {
    return true;
  }
  if (attacker.type === 'elephant' && defender.type === 'rat') {
    return false;
  }

  return ANIMAL_RANK[attacker.type] >= ANIMAL_RANK[defender.type];
}

const DELTAS: [number, number][] = [
  [-1, 0], // Up
  [1, 0],  // Down
  [0, -1], // Left
  [0, 1],  // Right
];

export function pieceMoves(board: (AnimalPiece | null)[], from: number): number[] {
  const piece = board[from];
  if (!piece) return [];

  const moves: number[] = [];
  const r = rowOf(from);
  const c = colOf(from);

  for (const [dr, dc] of DELTAS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;

    const dest = pointOf(nr, nc);

    // Cannot enter own den
    if (isDen(dest, piece.side)) continue;

    if (isWater(dest)) {
      if (piece.type === 'rat') {
        // Rat can swim into water
        const occupant = board[dest];
        if (!occupant) {
          moves.push(dest);
        } else if (canCapture(piece, from, occupant, dest)) {
          moves.push(dest);
        }
      } else if (piece.type === 'lion' || piece.type === 'tiger') {
        // Lion and Tiger can jump across the river in a straight line
        let jumpDest = -1;
        let blocked = false;

        if (dr === 0) {
          // Horizontal jump across river (2 river squares)
          if (c === 0 && dc === 1 && r >= 3 && r <= 5) {
            // Jump from col 0 to col 3
            if (board[pointOf(r, 1)] || board[pointOf(r, 2)]) blocked = true;
            jumpDest = pointOf(r, 3);
          } else if (c === 3 && dc === -1 && r >= 3 && r <= 5) {
            // Jump from col 3 to col 0
            if (board[pointOf(r, 2)] || board[pointOf(r, 1)]) blocked = true;
            jumpDest = pointOf(r, 0);
          } else if (c === 3 && dc === 1 && r >= 3 && r <= 5) {
            // Jump from col 3 to col 6
            if (board[pointOf(r, 4)] || board[pointOf(r, 5)]) blocked = true;
            jumpDest = pointOf(r, 6);
          } else if (c === 6 && dc === -1 && r >= 3 && r <= 5) {
            // Jump from col 6 to col 3
            if (board[pointOf(r, 5)] || board[pointOf(r, 4)]) blocked = true;
            jumpDest = pointOf(r, 3);
          }
        } else if (dc === 0) {
          // Vertical jump across river (3 river squares)
          if (r === 2 && dr === 1 && ((c >= 1 && c <= 2) || (c >= 4 && c <= 5))) {
            // Jump from row 2 to row 6
            if (board[pointOf(3, c)] || board[pointOf(4, c)] || board[pointOf(5, c)]) blocked = true;
            jumpDest = pointOf(6, c);
          } else if (r === 6 && dr === -1 && ((c >= 1 && c <= 2) || (c >= 4 && c <= 5))) {
            // Jump from row 6 to row 2
            if (board[pointOf(5, c)] || board[pointOf(4, c)] || board[pointOf(3, c)]) blocked = true;
            jumpDest = pointOf(2, c);
          }
        }

        if (jumpDest !== -1 && !blocked) {
          if (!isDen(jumpDest, piece.side)) {
            const occupant = board[jumpDest];
            if (!occupant) {
              moves.push(jumpDest);
            } else if (canCapture(piece, from, occupant, jumpDest)) {
              moves.push(jumpDest);
            }
          }
        }
      }
    } else {
      // Land square
      const occupant = board[dest];
      if (!occupant) {
        moves.push(dest);
      } else if (canCapture(piece, from, occupant, dest)) {
        moves.push(dest);
      }
    }
  }

  return moves;
}

export function legalMovesForSide(board: (AnimalPiece | null)[], side: AnimalSide): AnimalChessLegalMove[] {
  const moves: AnimalChessLegalMove[] = [];
  for (let from = 0; from < SIZE; from++) {
    const piece = board[from];
    if (!piece || piece.side !== side) continue;
    for (const to of pieceMoves(board, from)) {
      moves.push({ from, to });
    }
  }
  return moves;
}

export function applyMove(
  board: (AnimalPiece | null)[],
  from: number,
  to: number,
): { board: (AnimalPiece | null)[]; piece: AnimalPiece; captured: AnimalPiece | null } {
  const next = [...board];
  const piece = next[from];
  if (!piece) throw new Error(`No piece at ${from}`);
  const captured = next[to] ?? null;
  next[to] = piece;
  next[from] = null;
  return { board: next, piece, captured };
}

export function playerById(s: AnimalChessState, id: string): AnimalChessPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

export function sideOf(s: AnimalChessState, playerId: string): AnimalSide | null {
  const i = s.players.findIndex((p) => p.id === playerId);
  return i === 0 || i === 1 ? (i as AnimalSide) : null;
}

export function actorToAct(s: AnimalChessState): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.current]?.id ?? null;
}

export function countPieces(board: (AnimalPiece | null)[], side: AnimalSide): number {
  let count = 0;
  for (const p of board) {
    if (p && p.side === side) count++;
  }
  return count;
}
