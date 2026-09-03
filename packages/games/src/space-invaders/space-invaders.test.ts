import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mulberry32 } from '@puzzle-arena/shared';
import { spaceInvaders } from './index.js';
import {
  PLAYFIELD_W,
  PLAYFIELD_H,
  ALIEN_COUNT,
  BUNKER_COUNT,
  BUNKER_W,
  BUNKER_H,
  PLAYER_LIVES,
  PLAYER_SPEED,
  PLAYER_WIDTH,
  UFO_SCORES,
} from './state.js';
import {
  createAlienFleet,
  createBunkerMask,
  marchInterval,
  alienFireInterval,
  erodeBunker,
} from './rules.js';
import { spaceInvadersBot, type SpaceInvadersBotView } from './bot.js';

describe('space-invaders: setup invariants', () => {
  it('initializes 55 aliens with authentic distribution (1 squid, 2 crabs, 2 octopuses per col)', () => {
    const s = spaceInvaders.setup(['p1', 'p2'], 42, {});
    expect(s.players).toHaveLength(2);
    const p = s.players[0]!;
    expect(p.aliens).toHaveLength(ALIEN_COUNT);
    expect(p.aliveCount).toBe(55);

    // Row 0: 11 squids (32pt)
    const squids = p.aliens.filter((a) => a.type === 'squid');
    expect(squids).toHaveLength(11);
    expect(squids.every((a) => a.points === 32 && a.row === 0)).toBe(true);

    // Rows 1-2: 22 crabs (16pt)
    const crabs = p.aliens.filter((a) => a.type === 'crab');
    expect(crabs).toHaveLength(22);
    expect(crabs.every((a) => a.points === 16 && (a.row === 1 || a.row === 2))).toBe(true);

    // Rows 3-4: 22 octopuses (8pt)
    const octopuses = p.aliens.filter((a) => a.type === 'octopus');
    expect(octopuses).toHaveLength(22);
    expect(octopuses.every((a) => a.points === 8 && (a.row === 3 || a.row === 4))).toBe(true);
  });

  it('initializes 3 lives and correct playfield dimensions', () => {
    const s = spaceInvaders.setup(['p1'], 100, {});
    const p = s.players[0]!;
    expect(p.lives).toBe(PLAYER_LIVES);
    expect(p.score).toBe(0);
    expect(p.wave).toBe(1);
    expect(p.gameOver).toBe(false);

    const view = spaceInvaders.view(s, 'p1') as { playfieldW: number; playfieldH: number };
    expect(view.playfieldW).toBe(PLAYFIELD_W);
    expect(view.playfieldH).toBe(PLAYFIELD_H);
  });

  it('initializes 4 bunker shields with 8x7 boolean masks', () => {
    const s = spaceInvaders.setup(['p1'], 100, {});
    const p = s.players[0]!;
    expect(p.bunkers).toHaveLength(BUNKER_COUNT);

    for (const b of p.bunkers) {
      expect(b.width).toBe(BUNKER_W);
      expect(b.height).toBe(BUNKER_H);
      expect(b.mask).toHaveLength(BUNKER_W * BUNKER_H);
      // Top corners are notched (false)
      expect(b.mask[0 * BUNKER_W + 0]).toBe(false);
      expect(b.mask[0 * BUNKER_W + 7]).toBe(false);
      // Top center is solid
      expect(b.mask[0 * BUNKER_W + 3]).toBe(true);
      // Arch cutout at bottom center (cols 2..5 on rows 5 and 6)
      expect(b.mask[5 * BUNKER_W + 3]).toBe(false);
      expect(b.mask[6 * BUNKER_W + 4]).toBe(false);
      // Arch legs are solid
      expect(b.mask[5 * BUNKER_W + 0]).toBe(true);
      expect(b.mask[6 * BUNKER_W + 7]).toBe(true);
    }
  });

  it('view exposes required fields for human and spectators', () => {
    const s = spaceInvaders.setup(['p1', 'p2'], 42, {});
    const pView = spaceInvaders.view(s, 'p1') as {
      you: { score: number; lives: number; wave: number; board: number[]; bunkers: unknown[]; aliens: unknown[] };
      players: unknown[];
    };
    expect(pView.you).not.toBeNull();
    expect(pView.you.score).toBe(0);
    expect(pView.you.lives).toBe(3);
    expect(pView.you.board).toHaveLength(PLAYFIELD_W * PLAYFIELD_H);
    expect(pView.players).toHaveLength(2);

    const specView = spaceInvaders.view(s, null) as { you: unknown; players: unknown[] };
    expect(specView.you).toBeNull();
    expect(specView.players).toHaveLength(2);
  });
});

describe('space-invaders: movement, fire, and collision mechanics', () => {
  it('moves player left and right by PLAYER_SPEED and enforces boundary clamping', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    const initialX = s0.players[0]!.playerX;

    // Move left
    let res = spaceInvaders.reduce(s0, 'p1', { type: 'move', dir: 'left' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.playerX).toBe(initialX - PLAYER_SPEED);

    // Move right
    res = spaceInvaders.reduce(res.state, 'p1', { type: 'move', dir: 'right' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.playerX).toBe(initialX);

    // Drive left to boundary (0)
    let cur = res.state;
    for (let i = 0; i < 40; i++) {
      const r = spaceInvaders.reduce(cur, 'p1', { type: 'move', dir: 'left' });
      if (r.ok) cur = r.state;
    }
    expect(cur.players[0]!.playerX).toBe(0);

    // Drive right to boundary (PLAYFIELD_W - PLAYER_WIDTH)
    for (let i = 0; i < 40; i++) {
      const r = spaceInvaders.reduce(cur, 'p1', { type: 'move', dir: 'right' });
      if (r.ok) cur = r.state;
    }
    expect(cur.players[0]!.playerX).toBe(PLAYFIELD_W - PLAYER_WIDTH);
  });

  it('enforces one-shot rule: at most one player bullet in flight', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    // First fire succeeds
    const r1 = spaceInvaders.reduce(s0, 'p1', { type: 'fire' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.players[0]!.bullet).not.toBeNull();

    // Second fire while bullet in flight is rejected
    const r2 = spaceInvaders.reduce(r1.state, 'p1', { type: 'fire' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error).toMatch(/in flight/i);
    }
  });

  it('player bullet ascends and destroys first alien hit, awarding points', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    let s = structuredClone(s0);
    const p = s.players[0]!;

    // Place squid (row 0, col 0, 32 pts) directly in line of bullet
    // Squid position: x = formationX (10), y = formationY (2)
    p.bullet = { x: 10, y: 3 }; // 1 row below squid
    const targetAlien = p.aliens.find((a) => a.row === 0 && a.col === 0)!;
    expect(targetAlien.alive).toBe(true);
    expect(targetAlien.points).toBe(32);

    // Advance 1 tick: bullet moves from y=3 to y=2 and hits the squid
    const r = spaceInvaders.reduce(s, 'p1', { type: 'tick' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const pAfter = r.state.players[0]!;
    expect(pAfter.bullet).toBeNull(); // bullet consumed
    expect(pAfter.score).toBe(32); // 32 points awarded
    expect(pAfter.aliveCount).toBe(54); // alive count decremented
    expect(pAfter.aliens.find((a) => a.id === targetAlien.id)!.alive).toBe(false);
  });

  it('alien bomb destroys bunker cells (erodes 3x3 chunk) and is absorbed', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    let s = structuredClone(s0);
    const p = s.players[0]!;
    const bunker = p.bunkers[0]!;
    const solidBefore = bunker.mask.filter(Boolean).length;

    // Place an alien bomb descending right into the top of bunker 0
    p.alienBombs = [{ id: 99, x: bunker.x + 3, y: bunker.y - 1, col: 0 }];

    // Tick: bomb moves to bunker.y and impacts
    const r = spaceInvaders.reduce(s, 'p1', { type: 'tick' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const pAfter = r.state.players[0]!;
    expect(pAfter.alienBombs).toHaveLength(0); // bomb destroyed by bunker
    const bunkerAfter = pAfter.bunkers[0]!;
    const solidAfter = bunkerAfter.mask.filter(Boolean).length;
    expect(solidAfter).toBeLessThan(solidBefore); // cells eroded
  });

  it('shooting Mystery UFO awards points from UFO_SCORES (50..300)', () => {
    const s0 = spaceInvaders.setup(['p1'], 999, {});
    let s = structuredClone(s0);
    const p = s.players[0]!;

    // Spawn UFO at (20, 1)
    p.ufo = { x: 20, y: 1, dir: 1, points: 0, alive: true };
    // Place player bullet at (21, 2)
    p.bullet = { x: 21, y: 2 };

    // Tick: bullet ascends to y=1, hitting UFO
    const r = spaceInvaders.reduce(s, 'p1', { type: 'tick' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const pAfter = r.state.players[0]!;
    expect(pAfter.bullet).toBeNull();
    expect(pAfter.ufo).toBeNull();
    expect(UFO_SCORES).toContain(pAfter.score as never);
  });
});

describe('space-invaders: formation march, edge drop, and interval scaling', () => {
  it('march interval shrinks as alien count drops', () => {
    // moveEvery = max(2, floor(aliveCount / 4)) ticks at wave 1
    expect(marchInterval(55, 1)).toBe(13);
    expect(marchInterval(40, 1)).toBe(10);
    expect(marchInterval(20, 1)).toBe(5);
    expect(marchInterval(8, 1)).toBe(2);
    expect(marchInterval(4, 1)).toBe(2);
    expect(marchInterval(1, 1)).toBe(2);

    // Speeds up on higher waves
    expect(marchInterval(55, 3)).toBeLessThan(marchInterval(55, 1));
  });

  it('formation drops one row and reverses direction upon hitting edge', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    let s = structuredClone(s0);
    const p = s.players[0]!;

    // Position formation right at the right edge
    // Rightmost living col is 10: x = formationX + 10 * 4 + 3 - 1 = formationX + 42
    // If formationX is 21: 21 + 42 = 63 (right edge)
    p.formationX = 21;
    p.formationDir = 1;
    const initialY = p.formationY;
    p.formationMoveCounter = marchInterval(p.aliveCount, p.wave) - 1;

    // Next tick will trigger formation step
    const r = spaceInvaders.reduce(s, 'p1', { type: 'tick' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const pAfter = r.state.players[0]!;
    expect(pAfter.formationDir).toBe(-1); // reversed to left
    expect(pAfter.formationY).toBe(initialY + 1); // dropped 1 row
  });
});

describe('space-invaders: wave progression', () => {
  it('clearing all 55 aliens advances wave and starts fleet one row lower', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    let s = structuredClone(s0);
    const p = s.players[0]!;

    // Kill 54 aliens, leave only 1
    for (let i = 1; i < p.aliens.length; i++) {
      p.aliens[i]!.alive = false;
    }
    p.aliveCount = 1;
    const lastAlien = p.aliens[0]!;
    p.formationX = 10;
    p.formationY = 2;
    p.bullet = { x: p.formationX + lastAlien.col * 4, y: p.formationY + lastAlien.row * 2 + 1 };

    // Tick kills the last alien and immediately triggers wave clear & setupNextWave
    const r = spaceInvaders.reduce(s, 'p1', { type: 'tick' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const pNext = r.state.players[0]!;
    expect(pNext.wave).toBe(2);
    expect(pNext.wavesCleared).toBe(1);
    expect(pNext.aliveCount).toBe(55);
    // Started 1 row lower than wave 1 (initialY = 2 + (wave-1) = 3)
    expect(pNext.formationY).toBe(3);
  });
});

describe('space-invaders: life loss, game over, and isOver', () => {
  it('player loses life when hit by alien bomb and enters respawn grace', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    let s = structuredClone(s0);
    const p = s.players[0]!;

    // Drop bomb directly on player
    p.alienBombs = [{ id: 1, x: p.playerX + 1, y: p.playerY - 1, col: 0 }];

    const r = spaceInvaders.reduce(s, 'p1', { type: 'tick' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const pAfter = r.state.players[0]!;
    expect(pAfter.lives).toBe(2);
    expect(pAfter.respawnGraceTicks).toBeGreaterThan(0);
    expect(pAfter.gameOver).toBe(false);
  });

  it('game over when lives reach 0, and isOver triggers when all players die', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    let s = structuredClone(s0);
    const p = s.players[0]!;
    p.lives = 1;
    p.alienBombs = [{ id: 1, x: p.playerX + 1, y: p.playerY - 1, col: 0 }];

    const r = spaceInvaders.reduce(s, 'p1', { type: 'tick' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const pAfter = r.state.players[0]!;
    expect(pAfter.lives).toBe(0);
    expect(pAfter.gameOver).toBe(true);

    const overStatus = spaceInvaders.isOver(r.state);
    expect(overStatus.over).toBe(true);
    expect(r.state.phase).toBe('game_over');
  });

  it('legalActions returns empty array when player is game over', () => {
    const s0 = spaceInvaders.setup(['p1'], 42, {});
    expect(spaceInvaders.legalActions(s0, 'p1')).toEqual(['move:left', 'move:right', 'fire', 'tick']);

    let s = structuredClone(s0);
    s.players[0]!.gameOver = true;
    expect(spaceInvaders.legalActions(s, 'p1')).toEqual([]);
  });
});

describe('space-invaders: determinism (bit-for-bit replay)', () => {
  it('same seed + same action sequence produces identical state', () => {
    const seed = 12345678;
    const actions: { player: string; action: { type: 'move' | 'fire' | 'tick'; dir?: 'left' | 'right' } }[] = [
      { player: 'p1', action: { type: 'move', dir: 'left' } },
      { player: 'p1', action: { type: 'fire' } },
      { player: 'p1', action: { type: 'tick' } },
      { player: 'p1', action: { type: 'tick' } },
      { player: 'p2', action: { type: 'move', dir: 'right' } },
      { player: 'p2', action: { type: 'fire' } },
      { player: 'p1', action: { type: 'tick' } },
      { player: 'p2', action: { type: 'tick' } },
      { player: 'p1', action: { type: 'move', dir: 'right' } },
      { player: 'p2', action: { type: 'move', dir: 'left' } },
      { player: 'p1', action: { type: 'tick' } },
      { player: 'p2', action: { type: 'tick' } },
      { player: 'p1', action: { type: 'tick' } },
      { player: 'p2', action: { type: 'tick' } },
    ];

    // Run 1
    let s1 = spaceInvaders.setup(['p1', 'p2'], seed, {});
    for (const a of actions) {
      const res = spaceInvaders.reduce(s1, a.player, a.action as never);
      if (res.ok) s1 = res.state;
    }

    // Run 2
    let s2 = spaceInvaders.setup(['p1', 'p2'], seed, {});
    for (const a of actions) {
      const res = spaceInvaders.reduce(s2, a.player, a.action as never);
      if (res.ok) s2 = res.state;
    }

    expect(s1.rng).toEqual(s2.rng);
    expect(s1.seq).toBe(s2.seq);
    expect(s1.logSeq).toBe(s2.logSeq);
    expect(s1.players[0]!.score).toBe(s2.players[0]!.score);
    expect(s1.players[0]!.playerX).toBe(s2.players[0]!.playerX);
    expect(s1.players[0]!.alienBombs).toEqual(s2.players[0]!.alienBombs);
    expect(s1.players[0]!.aliveCount).toBe(s2.players[0]!.aliveCount);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });
});

describe('space-invaders: bot only-view invariant & policy', () => {
  it('bot module must not import ./state or ./index internals', () => {
    const botSourcePath = resolve(__dirname, 'bot.ts');
    const source = readFileSync(botSourcePath, 'utf8');

    // Bot must only import from @puzzle-arena/shared and ../bot.js
    expect(source).not.toMatch(/from\s+['"][^'"]*state(\.js)?['"]/);
    expect(source).not.toMatch(/from\s+['"][^'"]*index(\.js)?['"]/);
    expect(source).not.toMatch(/from\s+['"][^'"]*rules(\.js)?['"]/);
  });

  it('bot produces legal actions or ticks across all difficulties', () => {
    const s = spaceInvaders.setup(['bot1'], 42, {});
    const view = spaceInvaders.view(s, 'bot1') as SpaceInvadersBotView;
    const rng = mulberry32(100);

    const difficulties = ['easy', 'normal', 'hard'] as const;
    for (const diff of difficulties) {
      const action = spaceInvadersBot.chooseAction(view, 'bot1', rng, diff);
      expect(['move', 'fire', 'tick', 'toggleAssist']).toContain(action.type);
    }
  });

  it('simulates bot game progression with chooseAction', () => {
    let s = spaceInvaders.setup(['bot1'], 777, {});
    const rng = mulberry32(777);

    // Bot plays for 50 steps
    for (let step = 0; step < 50; step++) {
      if (s.phase === 'game_over') break;
      const view = spaceInvaders.view(s, 'bot1') as SpaceInvadersBotView;
      const action = spaceInvadersBot.chooseAction(view, 'bot1', rng, 'normal');
      const res = spaceInvaders.reduce(s, 'bot1', action as never);
      if (res.ok) {
        s = res.state;
      } else {
        // Fallback to tick if action rejected
        const tickRes = spaceInvaders.reduce(s, 'bot1', { type: 'tick' });
        if (tickRes.ok) s = tickRes.state;
      }
    }

    expect(s.seq).toBeGreaterThan(0);
  });
});
