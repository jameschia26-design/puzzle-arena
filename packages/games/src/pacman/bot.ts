import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import type { Dir } from './state.js';
import { DIR_VEC } from './state.js';

export interface PacManBotView {
  phase: string;
  winner: string | null;
  you: {
    id: string;
    pacPos: { x: number; y: number };
    pacDir: Dir;
    nextDir: Dir;
    maze: number[];
    dotsRemaining: number;
    lives: number;
    ghosts: {
      id: number;
      pos: { x: number; y: number };
      dir: Dir;
      mode: string;
      frightTicks: number;
      eaten: boolean;
    }[];
    fruit: { pos: { x: number; y: number }; points: number } | null;
    dyingTicks: number;
    levelClearTicks: number;
  } | null;
  players: unknown[];
  config: unknown;
  mazeW: number;
  mazeH: number;
}

type PacManBotAction = { type: 'dir'; dir: Dir } | { type: 'tick' };

function isWall(maze: number[], w: number, x: number, y: number): boolean {
  if (x < 0 || x >= w || y < 0 || y >= 31) return true;
  const v = maze[y * w + x];
  return v === 9; // TILE_WALL
}

function canMove(maze: number[], w: number, x: number, y: number, dir: Dir): boolean {
  let nx = x + DIR_VEC[dir].dx;
  let ny = y + DIR_VEC[dir].dy;
  if (ny === 14) {
    if (nx < 0) nx = w - 1;
    if (nx >= w) nx = 0;
  }
  if (nx < 0 || nx >= w || ny < 0 || ny >= 31) return false;
  const v = maze[ny * w + nx];
  if (v === 9) return false;
  if (v === 3) return false; // door blocked for pac
  return true;
}

function nearestPellet(maze: number[], w: number, from: { x: number; y: number }): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (let y = 0; y < 31; y++) {
    for (let x = 0; x < w; x++) {
      const v = maze[y * w + x];
      if (v === 1 || v === 2) {
        const d = Math.abs(x - from.x) + Math.abs(y - from.y);
        if (d < bestDist) { bestDist = d; best = { x, y }; }
      }
    }
  }
  return best;
}

function dirToward(from: { x: number; y: number }, target: { x: number; y: number }, maze: number[], w: number, curDir: Dir): Dir | null {
  let best: Dir | null = null;
  let bestDist = Infinity;
  for (const d of ['up','left','down','right'] as Dir[]) {
    if (!canMove(maze, w, from.x, from.y, d)) continue;
    const nx = from.x + DIR_VEC[d].dx;
    const ny = from.y + DIR_VEC[d].dy;
    // tunnel wrap distance approx
    let tx = target.x, ty = target.y;
    // handle wrap heuristic: if target far wrap, consider wrap copy
    let d2 = Math.abs(nx - tx) + Math.abs(ny - ty);
    // alternative: wrap around maze -> try target shifted
    const alt = Math.abs(nx - (tx - w)) + Math.abs(ny - ty);
    const alt2 = Math.abs(nx - (tx + w)) + Math.abs(ny - ty);
    d2 = Math.min(d2, alt, alt2);
    if (d2 < bestDist) { bestDist = d2; best = d; }
  }
  return best;
}

export const pacmanBot: BotPolicy<PacManBotView, PacManBotAction> = {
  chooseAction(view, _selfId, rng, difficulty) {
    const you = view.you;
    if (!you) return { type: 'tick' };
    if (you.dyingTicks > 0 || you.levelClearTicks > 0) return { type: 'tick' };
    // Occasionally do tick only (let game advance) – difficulty affects tick cadence via server scheduler,
    // but here we sometimes need to turn.
    // Strategy: avoid frightened ghosts? Actually chase frightened ghosts when possible.
    const w = view.mazeW;
    const frightGhosts = you.ghosts.filter(g => g.mode === 'frightened' && !g.eaten);
    const dangerGhosts = you.ghosts.filter(g => g.mode !== 'frightened' && !g.eaten && Math.abs(g.pos.x - you.pacPos.x) + Math.abs(g.pos.y - you.pacPos.y) <= 5);

    // If fright ghost nearby, go eat it (easy always chases, hard more aggressively)
    if (frightGhosts.length > 0) {
      // find closest fright ghost
      let best = frightGhosts[0]!;
      let bd = Math.abs(best.pos.x - you.pacPos.x) + Math.abs(best.pos.y - you.pacPos.y);
      for (const g of frightGhosts.slice(1)) {
        const d = Math.abs(g.pos.x - you.pacPos.x) + Math.abs(g.pos.y - you.pacPos.y);
        if (d < bd) { bd = d; best = g; }
      }
      if (bd <= (difficulty === 'hard' ? 12 : difficulty === 'normal' ? 8 : 5)) {
        const d = dirToward(you.pacPos, best.pos, you.maze, w, you.pacDir);
        if (d) return { type: 'dir', dir: d };
      }
    }

    // If danger ghost adjacent, try to flee (choose direction maximizing distance)
    if (dangerGhosts.length > 0) {
      const nearest = dangerGhosts.reduce((a,b) => {
        const da = Math.abs(a.pos.x - you.pacPos.x) + Math.abs(a.pos.y - you.pacPos.y);
        const db = Math.abs(b.pos.x - you.pacPos.x) + Math.abs(b.pos.y - you.pacPos.y);
        return da < db ? a : b;
      });
      const avail = (['up','left','down','right'] as Dir[]).filter(d => canMove(you.maze, w, you.pacPos.x, you.pacPos.y, d));
      if (avail.length > 0) {
        // pick direction that maximizes distance from nearest danger ghost
        let best: Dir = avail[0]!;
        let bestDist = -Infinity;
        for (const d of avail) {
          const np = { x: you.pacPos.x + DIR_VEC[d].dx, y: you.pacPos.y + DIR_VEC[d].dy };
          // wrap
          if (np.y === 14) {
            if (np.x < 0) np.x = w - 1;
            if (np.x >= w) np.x = 0;
          }
          const dist = Math.abs(np.x - nearest.pos.x) + Math.abs(np.y - nearest.pos.y);
          if (dist > bestDist) { bestDist = dist; best = d; }
        }
        // randomize for easy
        if (difficulty === 'easy' && rng.int(3) === 0) {
          return { type: 'dir', dir: rng.pick(avail) };
        }
        return { type: 'dir', dir: best };
      }
    }

    // Otherwise head toward nearest pellet, optionally with randomness for lower difficulty
    if (difficulty === 'easy' && rng.int(4) === 0) {
      const avail = (['up','left','down','right'] as Dir[]).filter(d => canMove(you.maze, w, you.pacPos.x, you.pacPos.y, d));
      if (avail.length > 0 && rng.int(5) === 0) return { type: 'dir', dir: rng.pick(avail) };
    }

    // Fruit lure: if fruit present and difficulty hard/normal, go for it
    if (you.fruit && difficulty !== 'easy') {
      const d = dirToward(you.pacPos, you.fruit.pos, you.maze, w, you.pacDir);
      if (d && (difficulty === 'hard' || rng.int(2) === 0)) return { type: 'dir', dir: d };
    }

    const target = nearestPellet(you.maze, w, you.pacPos);
    if (target) {
      const d = dirToward(you.pacPos, target, you.maze, w, you.pacDir);
      if (d) return { type: 'dir', dir: d };
    }
    // fallback: any valid move
    const avail = (['up','left','down','right'] as Dir[]).filter(d => canMove(you.maze, w, you.pacPos.x, you.pacPos.y, d));
    if (avail.length > 0) return { type: 'dir', dir: rng.pick(avail) };
    return { type: 'tick' };
  },
};
