import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import { search, type SearchConfig } from '../chess-core/search.js';
import type { Side } from '../chess-core/types.js';

type BotSide = 0 | 1;
type BotAnimalType = 'rat' | 'cat' | 'dog' | 'wolf' | 'leopard' | 'tiger' | 'lion' | 'elephant';

export interface AnimalChessBotPiece {
  type: BotAnimalType;
  side: BotSide;
}

export interface AnimalChessBotLegalMove {
  from: number;
  to: number;
  captured?: BotAnimalType;
}

export interface AnimalChessBotPublicPlayer {
  id: string;
  seat: number;
  side: BotSide;
  piecesRemaining: number;
  capturedCount: number;
}

export interface AnimalChessBotView {
  board: (AnimalChessBotPiece | null)[];
  players: AnimalChessBotPublicPlayer[];
  current: string | null;
  phase: 'playing' | 'game_over';
  winner: string | null;
  you: {
    id: string;
    side: BotSide;
    legalMoves: AnimalChessBotLegalMove[];
  } | null;
}

export type AnimalChessBotAction = { type: 'move'; from: number; to: number };

const COLS = 7;
const ROWS = 9;
const SIZE = 63;
const DEN_0 = 3;
const DEN_1 = 59;
const TRAPS_0 = [2, 4, 10];
const TRAPS_1 = [58, 60, 52];

const WATER_SQUARES = new Set([
  22, 23, 29, 30, 36, 37,
  25, 26, 32, 33, 39, 40,
]);

const ANIMAL_RANK: Record<BotAnimalType, number> = {
  rat: 1,
  cat: 2,
  dog: 3,
  wolf: 4,
  leopard: 5,
  tiger: 6,
  lion: 7,
  elephant: 8,
};

const BASE_PIECE_VALUE: Record<BotAnimalType, number> = {
  rat: 180,
  cat: 100,
  dog: 120,
  wolf: 150,
  leopard: 220,
  tiger: 380,
  lion: 500,
  elephant: 650,
};

function rowOf(pt: number): number {
  return Math.floor(pt / COLS);
}

function colOf(pt: number): number {
  return pt % COLS;
}

function pointOf(row: number, col: number): number {
  return row * COLS + col;
}

function isWater(pt: number): boolean {
  return WATER_SQUARES.has(pt);
}

function isDen(pt: number, side?: BotSide): boolean {
  if (side === 0) return pt === DEN_0;
  if (side === 1) return pt === DEN_1;
  return pt === DEN_0 || pt === DEN_1;
}

function isTrap(pt: number, side?: BotSide): boolean {
  if (side === 0) return TRAPS_0.includes(pt);
  if (side === 1) return TRAPS_1.includes(pt);
  return TRAPS_0.includes(pt) || TRAPS_1.includes(pt);
}

function canCapture(
  attacker: AnimalChessBotPiece,
  from: number,
  defender: AnimalChessBotPiece,
  to: number,
): boolean {
  if (attacker.side === defender.side) return false;

  const attackerInWater = isWater(from);
  const defenderInWater = isWater(to);

  if (attackerInWater) {
    if (!defenderInWater) return false;
    return defender.type === 'rat';
  }

  if (defenderInWater) return false;

  if (isTrap(to, attacker.side)) {
    return true;
  }

  if (attacker.type === 'rat' && defender.type === 'elephant') {
    return true;
  }
  if (attacker.type === 'elephant' && defender.type === 'rat') {
    return false;
  }

  return ANIMAL_RANK[attacker.type] >= ANIMAL_RANK[defender.type];
}

const DELTAS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function moveTo(from: number, to: number, occupant: AnimalChessBotPiece | null | undefined): AnimalChessBotLegalMove {
  return occupant ? { from, to, captured: occupant.type } : { from, to };
}

function generateMoves(board: (AnimalChessBotPiece | null)[], side: BotSide): AnimalChessBotLegalMove[] {
  const moves: AnimalChessBotLegalMove[] = [];

  for (let from = 0; from < SIZE; from++) {
    const piece = board[from];
    if (!piece || piece.side !== side) continue;

    const r = rowOf(from);
    const c = colOf(from);

    for (const [dr, dc] of DELTAS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;

      const dest = pointOf(nr, nc);
      if (isDen(dest, piece.side)) continue;

      if (isWater(dest)) {
        if (piece.type === 'rat') {
          const occupant = board[dest];
          if (!occupant || canCapture(piece, from, occupant, dest)) {
            moves.push(moveTo(from, dest, occupant));
          }
        } else if (piece.type === 'lion' || piece.type === 'tiger') {
          let jumpDest = -1;
          let blocked = false;

          if (dr === 0) {
            if (c === 0 && dc === 1 && r >= 3 && r <= 5) {
              if (board[pointOf(r, 1)] || board[pointOf(r, 2)]) blocked = true;
              jumpDest = pointOf(r, 3);
            } else if (c === 3 && dc === -1 && r >= 3 && r <= 5) {
              if (board[pointOf(r, 2)] || board[pointOf(r, 1)]) blocked = true;
              jumpDest = pointOf(r, 0);
            } else if (c === 3 && dc === 1 && r >= 3 && r <= 5) {
              if (board[pointOf(r, 4)] || board[pointOf(r, 5)]) blocked = true;
              jumpDest = pointOf(r, 6);
            } else if (c === 6 && dc === -1 && r >= 3 && r <= 5) {
              if (board[pointOf(r, 5)] || board[pointOf(r, 4)]) blocked = true;
              jumpDest = pointOf(r, 3);
            }
          } else if (dc === 0) {
            if (r === 2 && dr === 1 && ((c >= 1 && c <= 2) || (c >= 4 && c <= 5))) {
              if (board[pointOf(3, c)] || board[pointOf(4, c)] || board[pointOf(5, c)]) blocked = true;
              jumpDest = pointOf(6, c);
            } else if (r === 6 && dr === -1 && ((c >= 1 && c <= 2) || (c >= 4 && c <= 5))) {
              if (board[pointOf(5, c)] || board[pointOf(4, c)] || board[pointOf(3, c)]) blocked = true;
              jumpDest = pointOf(2, c);
            }
          }

          if (jumpDest !== -1 && !blocked && !isDen(jumpDest, piece.side)) {
            const occupant = board[jumpDest];
            if (!occupant || canCapture(piece, from, occupant, jumpDest)) {
              moves.push(moveTo(from, jumpDest, occupant));
            }
          }
        }
      } else {
        const occupant = board[dest];
        if (!occupant || canCapture(piece, from, occupant, dest)) {
          moves.push(moveTo(from, dest, occupant));
        }
      }
    }
  }

  return moves;
}

interface PosWrapper {
  board: (AnimalChessBotPiece | null)[];
  side: BotSide;
}

function evaluateBoard(board: (AnimalChessBotPiece | null)[], side: BotSide): number {
  let score = 0;
  const oppSide = (1 - side) as BotSide;
  const oppDen = side === 0 ? DEN_1 : DEN_0;
  const ownDen = side === 0 ? DEN_0 : DEN_1;
  const oppDenRow = rowOf(oppDen);
  const oppDenCol = colOf(oppDen);
  const ownDenRow = rowOf(ownDen);
  const ownDenCol = colOf(ownDen);

  for (let pt = 0; pt < SIZE; pt++) {
    const piece = board[pt];
    if (!piece) continue;

    if (piece.side === side && isDen(pt, oppSide)) {
      return 1_000_000;
    }
    if (piece.side === oppSide && isDen(pt, side)) {
      return -1_000_000;
    }

    const val = BASE_PIECE_VALUE[piece.type];
    const r = rowOf(pt);
    const c = colOf(pt);

    let positional = 0;
    if (piece.side === side) {
      const dist = Math.abs(r - oppDenRow) + Math.abs(c - oppDenCol);
      positional += (14 - dist) * 12;

      if (isTrap(pt, oppSide)) {
        positional -= 80;
      }
      score += val + positional;
    } else {
      const dist = Math.abs(r - ownDenRow) + Math.abs(c - ownDenCol);
      positional += (14 - dist) * 12;

      if (isTrap(pt, side)) {
        positional -= 80;
      }
      score -= val + positional;
    }
  }

  return score;
}

const searchConfig: SearchConfig<PosWrapper, AnimalChessBotLegalMove> = {
  genMoves(pos: PosWrapper, side: Side): AnimalChessBotLegalMove[] {
    return generateMoves(pos.board, side as BotSide);
  },

  makeMove(pos: PosWrapper, move: AnimalChessBotLegalMove): PosWrapper {
    const next = [...pos.board];
    const piece = next[move.from];
    next[move.to] = piece ?? null;
    next[move.from] = null;
    return {
      board: next,
      side: (1 - pos.side) as BotSide,
    };
  },

  sideToMove(pos: PosWrapper): Side {
    return pos.side as Side;
  },

  isCapture(move: AnimalChessBotLegalMove): boolean {
    return move.captured !== undefined;
  },

  captureValue(move: AnimalChessBotLegalMove, pos: PosWrapper): number {
    if (!move.captured) return 0;
    const attacker = pos.board[move.from];
    const attackerValue = attacker ? BASE_PIECE_VALUE[attacker.type] : 0;
    return BASE_PIECE_VALUE[move.captured] * 10 - attackerValue;
  },

  evaluate(pos: PosWrapper, side: Side): number {
    return evaluateBoard(pos.board, side as BotSide);
  },

  isInCheck(_pos: PosWrapper, _side: Side): boolean {
    return false;
  },

  moveKey(move: AnimalChessBotLegalMove): string {
    return `${move.from}->${move.to}`;
  },

  stalemateIsLoss: true,
};

export const animalChessBot: BotPolicy<AnimalChessBotView, AnimalChessBotAction> = {
  chooseAction(
    view: AnimalChessBotView,
    _actorId: string,
    rng: Rng,
    difficulty: BotDifficulty = 'normal',
  ): AnimalChessBotAction {
    const side = view.you?.side ?? 0;
    const legal = view.you?.legalMoves ?? generateMoves(view.board, side);
    if (legal.length === 0) {
      return { type: 'move', from: 0, to: 0 };
    }

    if (difficulty === 'easy') {
      const idx = Math.floor(rng.next() * legal.length);
      const chosen = legal[idx] ?? legal[0]!;
      return { type: 'move', from: chosen.from, to: chosen.to };
    }

    const pos: PosWrapper = { board: view.board, side };

    if (difficulty === 'normal') {
      const result = search(pos, searchConfig, {
        maxDepth: 3,
        timeBudgetMs: 250,
        quiescence: true,
        maxQDepth: 4,
      });
      const chosen = result.move ?? legal[0]!;
      return { type: 'move', from: chosen.from, to: chosen.to };
    }

    // hard / ai
    const result = search(pos, searchConfig, {
      maxDepth: 12,
      timeBudgetMs: 550,
      quiescence: true,
      maxQDepth: 6,
    });
    const chosen = result.move ?? legal[0]!;
    return { type: 'move', from: chosen.from, to: chosen.to };
  },
};
