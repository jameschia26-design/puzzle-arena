import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import type { TetrominoKind } from './state.js';
import { BOARD_W, BOARD_H, idx, tetrominoCells, collides, ghostY, clearLines } from './rules.js';

// Re-declare view shape without importing state (bot must only see view)
export interface TetrisBotView {
  phase: string;
  winner: string | null;
  you: {
    board: (TetrominoKind | null)[];
    active: { kind: TetrominoKind; x: number; y: number; rot: number } | null;
    hold: TetrominoKind | null;
    next: TetrominoKind[];
    ghostY: number | null;
    gameOver: boolean;
    score: number;
    lines: number;
    level: number;
  } | null;
  players: unknown[];
  log: unknown[];
}

type TetrisBotAction =
  | { type: 'move'; dir: 'left' | 'right' }
  | { type: 'rotate'; dir: 'cw' | 'ccw' }
  | { type: 'hardDrop' }
  | { type: 'tick' }
  | { type: 'hold' }
  | { type: 'softDrop' };

function aggregateHeight(board: (TetrominoKind | null)[]): number {
  let h = 0;
  for (let x = 0; x < BOARD_W; x++) {
    for (let y = 0; y < BOARD_H; y++) {
      if (board[idx(x, y)] !== null) { h += BOARD_H - y; break; }
    }
  }
  return h;
}

function holes(board: (TetrominoKind | null)[]): number {
  let count = 0;
  for (let x = 0; x < BOARD_W; x++) {
    let seenBlock = false;
    for (let y = 0; y < BOARD_H; y++) {
      const v = board[idx(x, y)];
      if (v !== null) seenBlock = true;
      else if (seenBlock) count++;
    }
  }
  return count;
}

function bumpiness(board: (TetrominoKind | null)[]): number {
  const heights: number[] = [];
  for (let x = 0; x < BOARD_W; x++) {
    let h = 0;
    for (let y = 0; y < BOARD_H; y++) { if (board[idx(x, y)] !== null) { h = BOARD_H - y; break; } }
    heights.push(h);
  }
  let b = 0;
  for (let i = 0; i < heights.length - 1; i++) b += Math.abs(heights[i]! - heights[i + 1]!);
  return b;
}

function evaluate(board: (TetrominoKind | null)[], linesCleared: number): number {
  // lower is worse; higher is better
  const agg = aggregateHeight(board);
  const hs = holes(board);
  const bump = bumpiness(board);
  return linesCleared * 1000 - agg * 2 - hs * 50 - bump * 2;
}

// Try all placements for a given kind/rotation via brute force columns
function bestPlacement(
  board: (TetrominoKind | null)[],
  kind: TetrominoKind,
  rot: number,
): { x: number; y: number; rot: number; score: number; cleared: number } | null {
  let best: { x: number; y: number; rot: number; score: number; cleared: number } | null = null;
  for (let x = -2; x < BOARD_W + 2; x++) {
    // find ghost y for this x
    let y = 0;
    // start from top, drop until collision free then ghost
    // simple: test spawn at y=0..BOARD_H, find lowest valid y
    // Do collision check
    let valid = false;
    let gy = y;
    // Move to lowest valid
    // First check if spawn collides -> skip
    if (collides(board, kind, x, y, rot)) continue;
    gy = y;
    while (!collides(board, kind, x, gy + 1, rot)) gy++;
    // validate final position not colliding
    if (collides(board, kind, x, gy, rot)) continue;
    // compute resulting board
    const cells: [number, number][] = [];
    // reuse tetrominoCells logic: compute offsets
    const offs = (() => {
      const base: Record<string, [number, number][]> = {
        I: [[-1, 0], [0, 0], [1, 0], [2, 0]],
        J: [[-1, 0], [-1, 1], [0, 0], [1, 0]],
        L: [[-1, 0], [0, 0], [1, 0], [1, 1]],
        O: [[0, 0], [1, 0], [0, 1], [1, 1]],
        S: [[-1, 1], [0, 1], [0, 0], [1, 0]],
        T: [[-1, 0], [0, 0], [1, 0], [0, 1]],
        Z: [[-1, 0], [0, 0], [0, 1], [1, 1]],
      };
      let cs = (base[kind] ?? []).map((c) => [...c] as [number, number]);
      for (let i = 0; i < (((rot % 4) + 4) % 4); i++) cs = cs.map(([cx, cy]) => [cy, -cx] as [number, number]);
      return cs.map(([dx, dy]) => [x + dx, gy + dy] as [number, number]);
    })();
    if (offs.some(([cx, cy]) => cx < 0 || cx >= BOARD_W || cy >= BOARD_H)) continue;
    const nb = [...board];
    for (const [cx, cy] of offs) if (cy >= 0) nb[idx(cx, cy)] = kind;
    const { board: cb, cleared } = clearLines(nb);
    const sc = evaluate(cb, cleared);
    if (!best || sc > best.score) best = { x, y: gy, rot, score: sc, cleared };
  }
  return best;
}

function planMoves(
  board: (TetrominoKind | null)[],
  active: { kind: TetrominoKind; x: number; y: number; rot: number },
  difficulty: BotDifficulty,
  rng: Rng,
): TetrisBotAction[] {
  const candidates: { rot: number; placement: ReturnType<typeof bestPlacement>; actions: TetrisBotAction[] }[] = [];
  const rots = [0, 1, 2, 3];
  for (const r of rots) {
    const p = bestPlacement(board, active.kind, r);
    if (p) {
      const rotateActions: TetrisBotAction[] = [];
      const diff = ((r - active.rot) % 4 + 4) % 4;
      // choose shortest rotation direction
      if (diff === 1) rotateActions.push({ type: 'rotate', dir: 'cw' });
      else if (diff === 2) { rotateActions.push({ type: 'rotate', dir: 'cw' }, { type: 'rotate', dir: 'cw' }); }
      else if (diff === 3) rotateActions.push({ type: 'rotate', dir: 'ccw' });
      candidates.push({ rot: r, placement: p, actions: rotateActions });
    }
  }
  if (candidates.length === 0) return [{ type: 'hardDrop' }];
  candidates.sort((a, b) => (b.placement?.score ?? -Infinity) - (a.placement?.score ?? -Infinity));

  // difficulty: easy picks top 3 randomly, normal picks best with occasional second, hard picks best
  let pick: typeof candidates[number];
  if (difficulty === 'easy') {
    const pool = candidates.slice(0, Math.min(3, candidates.length));
    pick = pool[rng.int(pool.length)] ?? candidates[0]!;
  } else if (difficulty === 'normal') {
    if (rng.next() < 0.2 && candidates.length > 1) pick = candidates[1]!;
    else pick = candidates[0]!;
  } else {
    pick = candidates[0]!;
  }

  const target = pick.placement!;
  const moves: TetrisBotAction[] = [...pick.actions];
  // horizontal moves
  const dx = target.x - active.x;
  // Note: rotation may have changed x via kicks approximation; simplify: just move to target x stepwise
  // We'll approximate: move left/right as needed
  // Real SRS kicks shift x slightly; our plan ignores that and just walks to target.x
  const activeXAfterRot = active.x; // we didn't apply kick x shift, so stepwise is okay
  const needDx = target.x - activeXAfterRot;
  for (let i = 0; i < Math.abs(needDx); i++) {
    moves.push({ type: 'move', dir: needDx > 0 ? 'right' : 'left' });
  }
  moves.push({ type: 'hardDrop' });
  return moves;
}

export const tetrisBot: BotPolicy<TetrisBotView, TetrisBotAction> = {
  chooseAction(view, _selfId, rng, difficulty) {
    const you = view.you;
    if (!you || you.gameOver || !you.active) return { type: 'tick' };
    // Occasional random soft drop instead of hard for variety on easy
    if (difficulty === 'easy' && rng.next() < 0.3) return { type: 'tick' };

    // Cache planned moves per view? For simplicity, compute per call and return first step.
    // Store on rng state? Instead just compute fresh and return first action of best plan.
    // To make bot coherent, we compute plan and stash in a module-level map keyed by board hash? Simpler: compute plan and execute first step
    const board = you.board;
    const active = you.active;

    // With some probability, hold if hold gives better placement
    if (you.hold !== null || true) {
      // evaluate hold option: if next piece placement is terrible, hold
      // For now, simple heuristic: don't hold on hard, occasionally hold on easy/normal
      if (rng.next() < 0.05) return { type: 'hold' };
    }

    const moves = planMoves(board, active as never, difficulty, rng);
    return moves[0] ?? { type: 'hardDrop' };
  },
};
