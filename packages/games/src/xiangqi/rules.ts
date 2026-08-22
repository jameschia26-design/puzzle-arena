import {
  applyMoveToBoard,
  colOf,
  isInCheck,
  pieceMoves,
  rowOf,
  SIZE,
} from './movegen.js';
import type { XiangqiLegalMove, XiangqiPiece, XiangqiPlayer, XiangqiSide, XiangqiState } from './state.js';

export * from './movegen.js';

export function playerById(s: XiangqiState, id: string): XiangqiPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

export function sideOf(s: XiangqiState, playerId: string): XiangqiSide | null {
  const i = s.players.findIndex((p) => p.id === playerId);
  return i === 0 || i === 1 ? (i as XiangqiSide) : null;
}

/** Whoever the game is waiting on right now, or null once it is over. */
export function actorToAct(s: XiangqiState): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.current]?.id ?? null;
}

/**
 * Every legal move for `side`: pseudo-legal piece moves filtered to exclude
 * any that leave the mover's own general in check, INCLUDING the
 * flying-general face-off (that case is naturally covered because
 * isInCheck/isPointAttacked treats an open-file general confrontation as
 * "attacked" — see movegen.ts).
 */
export function legalMovesForSide(board: (XiangqiPiece | null)[], side: XiangqiSide): XiangqiLegalMove[] {
  const moves: XiangqiLegalMove[] = [];
  for (let from = 0; from < SIZE; from++) {
    const piece = board[from];
    if (!piece || piece.side !== side) continue;
    for (const to of pieceMoves(board, from)) {
      const { board: next } = applyMoveToBoard(board, from, to);
      if (!isInCheck(next, side)) moves.push({ from, to });
    }
  }
  return moves;
}

function fileLabel(side: XiangqiSide, col: number): number {
  // WXF-style file numbering runs 1-9 from each side's own right, i.e.
  // descending for Red (whose right is col 8) and ascending for Black
  // (whose right is col 0).
  return side === 0 ? 9 - col : col + 1;
}

const PIECE_LETTER: Record<XiangqiPiece['type'], string> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  horse: 'H',
  chariot: 'R',
  cannon: 'C',
  soldier: 'S',
};

/**
 * Simplified `<piece><fromFile>-<toFile>/<toFile>` style notation (WXF-ish,
 * documented deviation: full WXF uses '.' for lateral moves, '+'/'-' for
 * forward/back and disambiguates tandem pieces on the same file with
 * 前/後 — we skip that disambiguation here since `history` already carries
 * unambiguous from/to points for replay and takeback; this string is purely
 * for the human-readable move list).
 */
export function notationFor(piece: XiangqiPiece, from: number, to: number): string {
  const letter = PIECE_LETTER[piece.type];
  const fromFile = fileLabel(piece.side, colOf(from));
  const toFile = fileLabel(piece.side, colOf(to));
  const fromRow = rowOf(from);
  const toRow = rowOf(to);
  if (fromFile === toFile) {
    // Straight forward/back move: report rank distance travelled.
    const forward = piece.side === 1 ? toRow > fromRow : toRow < fromRow;
    const dist = Math.abs(toRow - fromRow);
    return `${letter}${fromFile}${forward ? '+' : '-'}${dist}`;
  }
  return `${letter}${fromFile}.${toFile}`;
}

export function positionKey(s: XiangqiState): string {
  let key = '';
  for (const p of s.board) key += p ? `${p.side}${p.type[0]}` : '.';
  return `${key}:${s.current}`;
}
