import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';

/**
 * Self-contained, like every other game's bot.ts: this module deliberately
 * does not import from `./state.js` or `./rules.js` even though the logic
 * below mirrors them closely. The module boundary — a bot policy sees only
 * plain view data, never the engine's own state type — is the enforcement,
 * and `bots.test.ts` asserts it at runtime too.
 */

const BOARD_SIZE = 10;

type BotSide = 0 | 1;

interface BotPiece {
  side: BotSide;
  king: boolean;
}

interface BotPos {
  row: number;
  col: number;
}

interface BotLegalMove {
  path: BotPos[];
  captured: BotPos[];
}

export interface CheckersBotPublicPlayer {
  id: string;
  seat: number;
  side: BotSide;
  piecesRemaining: number;
  kingsCount: number;
  capturedCount: number;
}

export interface CheckersBotView {
  board: (BotPiece | null)[];
  players: CheckersBotPublicPlayer[];
  current: string | null;
  phase: 'playing' | 'game_over';
  you: {
    id: string;
    side: BotSide;
    legalMoves: BotLegalMove[];
  } | null;
}

/* ------------------------------------------------------------------ */
/* Move generation (mirrors rules.ts; see the note above on why it is   */
/* reimplemented here rather than imported)                            */
/* ------------------------------------------------------------------ */

function inBounds(pos: BotPos): boolean {
  return pos.row >= 0 && pos.row < BOARD_SIZE && pos.col >= 0 && pos.col < BOARD_SIZE;
}

function idx(pos: BotPos): number {
  return pos.row * BOARD_SIZE + pos.col;
}

function key(pos: BotPos): string {
  return `${pos.row},${pos.col}`;
}

const DIRECTIONS: readonly BotPos[] = [
  { row: -1, col: -1 },
  { row: -1, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 1 },
];

function forwardRow(side: BotSide): number {
  return side === 0 ? 1 : -1;
}

function isBackRank(side: BotSide, row: number): boolean {
  return side === 0 ? row === BOARD_SIZE - 1 : row === 0;
}

type Occupant = BotPiece | null | 'blocked';

function occupantDuring(
  board: (BotPiece | null)[],
  pos: BotPos,
  startPos: BotPos,
  capturedSoFar: ReadonlySet<string>,
): Occupant {
  if (pos.row === startPos.row && pos.col === startPos.col) return null;
  if (capturedSoFar.has(key(pos))) return 'blocked';
  return board[idx(pos)] ?? null;
}

function findCaptureContinuations(
  board: (BotPiece | null)[],
  from: BotPos,
  startPos: BotPos,
  side: BotSide,
  king: boolean,
  capturedSoFar: ReadonlySet<string>,
): { to: BotPos; capturedPos: BotPos }[] {
  const results: { to: BotPos; capturedPos: BotPos }[] = [];
  for (const dir of DIRECTIONS) {
    if (king) {
      let foundEnemyAt: BotPos | null = null;
      let step = 1;
      for (;;) {
        const cur: BotPos = { row: from.row + dir.row * step, col: from.col + dir.col * step };
        if (!inBounds(cur)) break;
        const occ = occupantDuring(board, cur, startPos, capturedSoFar);
        if (occ === 'blocked') break;
        if (occ === null) {
          if (foundEnemyAt) results.push({ to: cur, capturedPos: foundEnemyAt });
          step++;
          continue;
        }
        if (occ.side === side) break;
        if (foundEnemyAt) break;
        foundEnemyAt = cur;
        step++;
      }
    } else {
      const mid: BotPos = { row: from.row + dir.row, col: from.col + dir.col };
      const land: BotPos = { row: from.row + dir.row * 2, col: from.col + dir.col * 2 };
      if (!inBounds(land)) continue;
      const midOcc = occupantDuring(board, mid, startPos, capturedSoFar);
      if (midOcc === null || midOcc === 'blocked' || midOcc.side === side) continue;
      const landOcc = occupantDuring(board, land, startPos, capturedSoFar);
      if (landOcc !== null) continue;
      results.push({ to: land, capturedPos: mid });
    }
  }
  return results;
}

function captureSequencesFrom(
  board: (BotPiece | null)[],
  startPos: BotPos,
  side: BotSide,
  path: BotPos[],
  king: boolean,
  capturedSoFar: ReadonlySet<string>,
  capturedPositions: BotPos[],
): BotLegalMove[] {
  const cur = path[path.length - 1] as BotPos;
  const continuations = findCaptureContinuations(board, cur, startPos, side, king, capturedSoFar);

  if (continuations.length === 0) {
    if (capturedPositions.length === 0) return [];
    return [{ path: [...path], captured: [...capturedPositions] }];
  }

  const sequences: BotLegalMove[] = [];
  for (const cont of continuations) {
    const newCaptured = new Set(capturedSoFar);
    newCaptured.add(key(cont.capturedPos));
    const newPath = [...path, cont.to];
    const newCapturedPositions = [...capturedPositions, cont.capturedPos];

    if (!king && isBackRank(side, cont.to.row)) {
      sequences.push({ path: newPath, captured: newCapturedPositions });
      continue;
    }

    const deeper = captureSequencesFrom(board, startPos, side, newPath, king, newCaptured, newCapturedPositions);
    if (deeper.length === 0) sequences.push({ path: newPath, captured: newCapturedPositions });
    else sequences.push(...deeper);
  }
  return sequences;
}

function simpleMovesFor(board: (BotPiece | null)[], from: BotPos, piece: BotPiece): BotLegalMove[] {
  const moves: BotLegalMove[] = [];
  if (piece.king) {
    for (const dir of DIRECTIONS) {
      let step = 1;
      for (;;) {
        const cur: BotPos = { row: from.row + dir.row * step, col: from.col + dir.col * step };
        if (!inBounds(cur) || board[idx(cur)] !== null) break;
        moves.push({ path: [from, cur], captured: [] });
        step++;
      }
    }
  } else {
    const fr = forwardRow(piece.side);
    for (const dc of [-1, 1]) {
      const cur: BotPos = { row: from.row + fr, col: from.col + dc };
      if (inBounds(cur) && board[idx(cur)] === null) moves.push({ path: [from, cur], captured: [] });
    }
  }
  return moves;
}

function legalMovesForSide(board: (BotPiece | null)[], side: BotSide): BotLegalMove[] {
  const captureSequences: BotLegalMove[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const pos = { row, col };
      const piece = board[idx(pos)];
      if (!piece || piece.side !== side) continue;
      captureSequences.push(...captureSequencesFrom(board, pos, side, [pos], piece.king, new Set(), []));
    }
  }
  if (captureSequences.length > 0) {
    const maxCaptures = Math.max(...captureSequences.map((s) => s.captured.length));
    return captureSequences.filter((s) => s.captured.length === maxCaptures);
  }
  const simple: BotLegalMove[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const pos = { row, col };
      const piece = board[idx(pos)];
      if (!piece || piece.side !== side) continue;
      simple.push(...simpleMovesFor(board, pos, piece));
    }
  }
  return simple;
}

function applyMove(board: (BotPiece | null)[], move: BotLegalMove): (BotPiece | null)[] {
  const next = [...board];
  const start = move.path[0] as BotPos;
  const end = move.path[move.path.length - 1] as BotPos;
  const piece = next[idx(start)] as BotPiece;
  next[idx(start)] = null;
  for (const cap of move.captured) next[idx(cap)] = null;
  const promoted = !piece.king && isBackRank(piece.side, end.row);
  next[idx(end)] = { side: piece.side, king: piece.king || promoted };
  return next;
}

/* ------------------------------------------------------------------ */
/* Evaluation and search                                               */
/* ------------------------------------------------------------------ */

function evaluate(board: (BotPiece | null)[], perspective: BotSide): number {
  let score = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[idx({ row, col })];
      if (!piece) continue;
      const value = piece.king ? 1.75 : 1;
      const sign = piece.side === perspective ? 1 : -1;
      // Small pull toward the centre and away from the edges, plus a nudge
      // for men who have advanced toward promotion.
      const centreBonus = 4 - Math.abs(col - 4.5) - Math.abs(row - 4.5) > 0 ? 0.05 : 0;
      const advance = !piece.king
        ? (piece.side === 0 ? row : BOARD_SIZE - 1 - row) * 0.02
        : 0;
      score += sign * (value + centreBonus + advance);
    }
  }
  return score;
}

function minimax(
  board: (BotPiece | null)[],
  sideToMove: BotSide,
  perspective: BotSide,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const legal = legalMovesForSide(board, sideToMove);
  if (legal.length === 0) {
    // No legal moves = that side loses.
    return sideToMove === perspective ? -10_000 : 10_000;
  }
  if (depth <= 0) return evaluate(board, perspective);

  const maximizing = sideToMove === perspective;
  const nextSide = (1 - sideToMove) as BotSide;

  if (maximizing) {
    let best = -Infinity;
    for (const move of legal) {
      const next = applyMove(board, move);
      const ev = minimax(next, nextSide, perspective, depth - 1, alpha, beta);
      best = Math.max(best, ev);
      alpha = Math.max(alpha, ev);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const move of legal) {
    const next = applyMove(board, move);
    const ev = minimax(next, nextSide, perspective, depth - 1, alpha, beta);
    best = Math.min(best, ev);
    beta = Math.min(beta, ev);
    if (beta <= alpha) break;
  }
  return best;
}

export const checkersBot: BotPolicy<CheckersBotView, { type: 'move'; path: BotPos[] }> = {
  chooseAction(view, selfId, rng: Rng, difficulty: BotDifficulty) {
    const side = view.you?.side ?? (view.players.find((p) => p.id === selfId)?.side as BotSide) ?? 0;
    const legal = view.you?.legalMoves.length ? view.you.legalMoves : legalMovesForSide(view.board, side);

    if (legal.length === 0) return { type: 'move', path: [] };

    if (difficulty === 'easy' && rng.next() < 0.4) {
      return { type: 'move', path: rng.pick(legal).path };
    }

    const depth = difficulty === 'hard' ? 4 : difficulty === 'normal' ? 2 : 1;
    const opponent = (1 - side) as BotSide;

    let bestMove = legal[0] as BotLegalMove;
    let bestScore = -Infinity;
    for (const move of legal) {
      const next = applyMove(view.board, move);
      let ev = minimax(next, opponent, side, depth - 1, -Infinity, Infinity);
      // A tiny deterministic jitter breaks ties without destabilising the
      // ranking of genuinely different-scored moves.
      ev += rng.next() * 0.01;
      if (ev > bestScore) {
        bestScore = ev;
        bestMove = move;
      }
    }

    return { type: 'move', path: bestMove.path };
  },
};
