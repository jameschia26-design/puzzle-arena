import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';

export interface SpaceInvadersBotView {
  phase: string;
  winner: string | null;
  you: {
    score: number;
    lives: number;
    wave: number;
    playerX: number;
    playerY: number;
    bullet: { x: number; y: number } | null;
    bullets: { x: number; y: number }[];
    alienBombs: { id: number; x: number; y: number; col: number }[];
    bunkers: { id: number; x: number; y: number; width: number; height: number; mask: boolean[] }[];
    aliens: { id: number; row: number; col: number; type: string; points: number; alive: boolean }[];
    formationX: number;
    formationY: number;
    formationDir: 1 | -1;
    aliveCount: number;
    ufo: { x: number; y: number; dir: 1 | -1; points: number; alive: boolean } | null;
    board: number[];
    gameOver: boolean;
    maxBullets?: number;
  } | null;
  players: unknown[];
  log: unknown[];
  config: unknown;
  playfieldW: number;
  playfieldH: number;
}

export type SpaceInvadersBotAction =
  | { type: 'move'; dir: 'left' | 'right' }
  | { type: 'fire' }
  | { type: 'toggleAssist' }
  | { type: 'tick' };

const PLAYFIELD_W = 64;
const PLAYER_WIDTH = 3;
const ALIEN_COL_SPACING = 4;
const ALIEN_WIDTH = 3;

/** Check if player is under active bunker protection */
function isUnderBunker(
  playerX: number,
  bunkers: SpaceInvadersBotView['you'] extends null ? never : NonNullable<SpaceInvadersBotView['you']>['bunkers'],
): boolean {
  const center = playerX + 1;
  for (const b of bunkers) {
    if (center >= b.x && center < b.x + b.width) {
      const lx = center - b.x;
      // Check if any solid cell exists in this bunker column
      for (let r = 0; r < b.height; r++) {
        if (b.mask[r * b.width + lx]) return true;
      }
    }
  }
  return false;
}

/** Columns that have at least one living alien */
function getLivingAlienCols(
  aliens: NonNullable<SpaceInvadersBotView['you']>['aliens'],
  formationX: number,
): { col: number; centerX: number; lowestY: number }[] {
  const colMap = new Map<number, { lowestRow: number }>();
  for (const a of aliens) {
    if (!a.alive) continue;
    const cur = colMap.get(a.col);
    if (!cur || a.row > cur.lowestRow) {
      colMap.set(a.col, { lowestRow: a.row });
    }
  }

  const result: { col: number; centerX: number; lowestY: number }[] = [];
  for (const [col, { lowestRow }] of colMap.entries()) {
    const leftX = formationX + col * ALIEN_COL_SPACING;
    result.push({
      col,
      centerX: leftX + 1,
      lowestY: lowestRow,
    });
  }
  return result;
}

export const spaceInvadersBot: BotPolicy<SpaceInvadersBotView, SpaceInvadersBotAction> = {
  chooseAction(view, _selfId, rng, difficulty) {
    const you = view.you;
    if (!you || you.gameOver) return { type: 'tick' };

    const playerCenter = you.playerX + 1;
    const livingCols = getLivingAlienCols(you.aliens, you.formationX);
    const canFire = you.bullets ? you.bullets.length < (you.maxBullets ?? 1) : you.bullet === null;

    // --- Threat detection: Bombs falling towards player ---
    const threateningBombs = you.alienBombs.filter(
      (b) => b.y < you.playerY && b.y > 10 && Math.abs(b.x - playerCenter) <= 2,
    );

    // --- Hard difficulty: full bomb tracking & evasion ---
    if (difficulty === 'hard') {
      // 1. Evade immediate bomb threat
      if (threateningBombs.length > 0) {
        const nearestBomb = threateningBombs.reduce((closest, b) =>
          b.y > closest.y ? b : closest,
        );
        // Decide dodge direction
        const canGoLeft = you.playerX >= 2;
        const canGoRight = you.playerX + PLAYER_WIDTH + 2 <= PLAYFIELD_W;

        if (nearestBomb.x >= playerCenter) {
          if (canGoLeft) return { type: 'move', dir: 'left' };
          if (canGoRight) return { type: 'move', dir: 'right' };
        } else {
          if (canGoRight) return { type: 'move', dir: 'right' };
          if (canGoLeft) return { type: 'move', dir: 'left' };
        }
      }

      // 2. Prioritize UFO if safe
      if (you.ufo && you.ufo.alive) {
        const ufoCenter = you.ufo.x + 2;
        if (Math.abs(ufoCenter - playerCenter) <= 1 && canFire) {
          return { type: 'fire' };
        }
        if (ufoCenter < playerCenter && you.playerX > 0) {
          return { type: 'move', dir: 'left' };
        }
        if (ufoCenter > playerCenter && you.playerX + PLAYER_WIDTH < PLAYFIELD_W) {
          return { type: 'move', dir: 'right' };
        }
      }

      // 3. Align with nearest alien column and shoot
      if (livingCols.length > 0) {
        // Find closest column
        const targetCol = livingCols.reduce((best, c) =>
          Math.abs(c.centerX - playerCenter) < Math.abs(best.centerX - playerCenter) ? c : best,
        );

        if (Math.abs(targetCol.centerX - playerCenter) <= 1) {
          if (canFire) return { type: 'fire' };
        } else if (targetCol.centerX < playerCenter && you.playerX > 0) {
          if (rng.next() < 0.65) return { type: 'move', dir: 'left' };
        } else if (targetCol.centerX > playerCenter && you.playerX + PLAYER_WIDTH < PLAYFIELD_W) {
          if (rng.next() < 0.65) return { type: 'move', dir: 'right' };
        }
      }

      // If bombs are falling anywhere, prefer bunker shadow
      if (you.alienBombs.length > 0 && !isUnderBunker(you.playerX, you.bunkers)) {
        // Drift toward nearest bunker
        const targetBunker = you.bunkers[0];
        if (targetBunker && targetBunker.x < playerCenter && you.playerX > 0) {
          if (rng.next() < 0.3) return { type: 'move', dir: 'left' };
        }
      }

      return { type: 'tick' };
    }

    // --- Normal difficulty: dodge immediate bombs, target columns ---
    if (difficulty === 'normal') {
      if (threateningBombs.length > 0) {
        // Dodge one cell
        const bomb = threateningBombs[0]!;
        if (bomb.x >= playerCenter && you.playerX > 0) {
          return { type: 'move', dir: 'left' };
        }
        if (bomb.x < playerCenter && you.playerX + PLAYER_WIDTH < PLAYFIELD_W) {
          return { type: 'move', dir: 'right' };
        }
      }

      // Shoot if aligned with any column
      const aligned = livingCols.some((c) => Math.abs(c.centerX - playerCenter) <= 1);
      if (aligned && canFire && rng.next() < 0.7) {
        return { type: 'fire' };
      }

      // Track nearest threatening column
      if (livingCols.length > 0 && rng.next() < 0.4) {
        const closest = livingCols.reduce((best, c) =>
          Math.abs(c.centerX - playerCenter) < Math.abs(best.centerX - playerCenter) ? c : best,
        );
        if (closest.centerX < playerCenter && you.playerX > 0) {
          return { type: 'move', dir: 'left' };
        }
        if (closest.centerX > playerCenter && you.playerX + PLAYER_WIDTH < PLAYFIELD_W) {
          return { type: 'move', dir: 'right' };
        }
      }

      return { type: 'tick' };
    }

    // --- Easy difficulty: random lateral drift, fires when roughly aligned ---
    if (difficulty === 'easy') {
      const roughlyAligned = livingCols.some((c) => Math.abs(c.centerX - playerCenter) <= 2);
      if (roughlyAligned && canFire && rng.next() < 0.5) {
        return { type: 'fire' };
      }

      // Occasional random drift
      if (rng.next() < 0.25) {
        const dir = rng.next() < 0.5 ? 'left' : 'right';
        if (dir === 'left' && you.playerX > 0) return { type: 'move', dir: 'left' };
        if (dir === 'right' && you.playerX + PLAYER_WIDTH < PLAYFIELD_W) return { type: 'move', dir: 'right' };
      }

      return { type: 'tick' };
    }

    return { type: 'tick' };
  },
};
