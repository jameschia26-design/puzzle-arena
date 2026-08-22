import type { Side } from './types.js';

/**
 * A generic alpha-beta / negamax search with iterative deepening and
 * quiescence search on captures, parameterised entirely over caller-supplied
 * functions. This module must never import or reference chess-specific or
 * xiangqi-specific state types — it is pure algorithm, shared by both games'
 * `bot.ts` (see `AGENTS.md`: "Deliberate deviation from the house rule").
 *
 * Bots are NOT reducers — `Date.now()` is fine in here, unlike inside a
 * `GameEngine.reduce` implementation.
 */
export interface SearchConfig<Pos, Mv> {
  /** All legal moves for `side` in `pos`. Empty means no legal moves. */
  genMoves(pos: Pos, side: Side): Mv[];
  /** Pure application of `move` onto `pos`, returning a new position. */
  makeMove(pos: Pos, move: Mv): Pos;
  /** Whose move it is in `pos`. */
  sideToMove(pos: Pos): Side;
  /** Whether `move` captures a piece (drives quiescence + MVV-LVA ordering). */
  isCapture(move: Mv): boolean;
  /** Ordering hint for a capture — typically victim value minus attacker value. */
  captureValue(move: Mv, pos: Pos): number;
  /** Static evaluation of `pos`, from `side`'s perspective (higher is better for `side`). */
  evaluate(pos: Pos, side: Side): number;
  /** Whether `side`'s "king" (or equivalent) is currently in check in `pos`. */
  isInCheck(pos: Pos, side: Side): boolean;
  /** A stable string key for a move, used for killer-move bookkeeping. */
  moveKey(move: Mv): string;
  /** Whether stalemate is scored as a loss (true for Xiangqi, false/undefined for Chess). */
  stalemateIsLoss?: boolean;
}

export interface SearchOptions {
  /** Upper bound on iterative-deepening depth. */
  maxDepth: number;
  /** Wall-clock budget; when omitted the search always reaches `maxDepth`. */
  timeBudgetMs?: number;
  /** Quiescence search on captures at leaf nodes. Defaults to true. */
  quiescence?: boolean;
  /** Cap on quiescence recursion. Defaults to 6. */
  maxQDepth?: number;
}

export interface SearchResult<Mv> {
  move: Mv | null;
  score: number;
  depthReached: number;
  nodes: number;
}

const MATE_SCORE = 1_000_000;

export function search<Pos, Mv>(
  pos: Pos,
  config: SearchConfig<Pos, Mv>,
  options: SearchOptions,
): SearchResult<Mv> {
  const { maxDepth, timeBudgetMs, quiescence = true, maxQDepth = 6 } = options;
  const deadline = timeBudgetMs !== undefined ? Date.now() + timeBudgetMs : null;
  let nodes = 0;
  const killers = new Map<number, string[]>();

  function timeUp(): boolean {
    return deadline !== null && Date.now() >= deadline;
  }

  function orderMoves(p: Pos, moves: Mv[], ply: number): Mv[] {
    const killerSet = killers.get(ply);
    return [...moves].sort((a, b) => {
      const ca = config.isCapture(a) ? 10_000 + config.captureValue(a, p) : 0;
      const cb = config.isCapture(b) ? 10_000 + config.captureValue(b, p) : 0;
      if (ca !== cb) return cb - ca;
      const ka = killerSet?.includes(config.moveKey(a)) ? 1 : 0;
      const kb = killerSet?.includes(config.moveKey(b)) ? 1 : 0;
      return kb - ka;
    });
  }

  function recordKiller(move: Mv, ply: number): void {
    if (config.isCapture(move)) return;
    const mkey = config.moveKey(move);
    const arr = killers.get(ply) ?? [];
    if (!arr.includes(mkey)) {
      arr.unshift(mkey);
      if (arr.length > 2) arr.pop();
      killers.set(ply, arr);
    }
  }

  function quiesce(p: Pos, side: Side, alphaIn: number, beta: number, qdepth: number): number {
    nodes++;
    let alpha = alphaIn;
    const standPat = config.evaluate(p, side);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qdepth <= 0) return alpha;

    const captures = config.genMoves(p, side).filter((m) => config.isCapture(m));
    const ordered = orderMoves(p, captures, 1000 + qdepth);
    for (const m of ordered) {
      const next = config.makeMove(p, m);
      const score = -quiesce(next, (1 - side) as Side, -beta, -alpha, qdepth - 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(p: Pos, side: Side, depth: number, alphaIn: number, beta: number, ply: number): number {
    nodes++;
    const moves = config.genMoves(p, side);
    if (moves.length === 0) {
      if (config.isInCheck(p, side)) return -MATE_SCORE + ply;
      return config.stalemateIsLoss ? -MATE_SCORE + ply : 0;
    }
    if (depth <= 0) {
      return quiescence ? quiesce(p, side, alphaIn, beta, maxQDepth) : config.evaluate(p, side);
    }

    let alpha = alphaIn;
    const ordered = orderMoves(p, moves, ply);
    let best = -Infinity;
    for (const m of ordered) {
      if (timeUp()) break;
      const next = config.makeMove(p, m);
      const score = -negamax(next, (1 - side) as Side, depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        recordKiller(m, ply);
        break;
      }
    }
    return best;
  }

  let bestMove: Mv | null = null;
  let bestScore = -Infinity;
  let depthReached = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const side = config.sideToMove(pos);
    const moves = config.genMoves(pos, side);
    if (moves.length === 0) break;
    const ordered = orderMoves(pos, moves, 0);

    let localBest: Mv | null = null;
    let localBestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;
    let aborted = false;

    for (const m of ordered) {
      if (depth > 1 && timeUp()) {
        aborted = true;
        break;
      }
      const next = config.makeMove(pos, m);
      const score = -negamax(next, (1 - side) as Side, depth - 1, -beta, -alpha, 1);
      if (score > localBestScore) {
        localBestScore = score;
        localBest = m;
      }
      if (localBestScore > alpha) alpha = localBestScore;
    }

    if (localBest !== null) {
      bestMove = localBest;
      bestScore = localBestScore;
      depthReached = depth;
    }
    if (aborted || timeUp()) break;
  }

  return { move: bestMove, score: bestScore, depthReached, nodes };
}
