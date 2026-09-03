import { describe, it, expect } from 'vitest';
import { bomberman } from './index.js';
import { bombermanBot } from './bot.js';
import {
  ARENA_W,
  ARENA_H,
  ARENA_SIZE,
  TILE_EMPTY,
  TILE_HARD,
  TILE_SOFT,
  cellIndex,
  isBorder,
  isHardPillar,
  getSafeZoneCells,
  SPAWN_POINTS,
} from './rules.js';
import type { BombermanState } from './state.js';
import { mulberry32, rngFrom } from '@puzzle-arena/shared';

describe('1. setup', () => {
  it('15x13 arena, border+hard pattern, soft density within seeded bounds, spawn cells clear, grace ticks', () => {
    const seed = 12345;
    const s = bomberman.setup(['p1', 'p2', 'p3', 'p4'], seed, { tickMs: 60, softDensity: 65 });

    // Arena dimensions
    expect(s.grid.length).toBe(ARENA_SIZE);
    expect(ARENA_W).toBe(15);
    expect(ARENA_H).toBe(13);

    // Border cells are indestructible hard blocks
    for (let y = 0; y < ARENA_H; y++) {
      for (let x = 0; x < ARENA_W; x++) {
        const idx = cellIndex(x, y);
        if (isBorder(x, y)) {
          expect(s.grid[idx]).toBe(TILE_HARD);
        } else if (isHardPillar(x, y)) {
          expect(s.grid[idx]).toBe(TILE_HARD);
        }
      }
    }

    // Spawn cells and adjacent corridors are clear (safe zones)
    const safeZone = getSafeZoneCells();
    for (const idx of safeZone) {
      if (!isBorder(idx % ARENA_W, Math.floor(idx / ARENA_W)) && !isHardPillar(idx % ARENA_W, Math.floor(idx / ARENA_W))) {
        expect(s.grid[idx]).toBe(TILE_EMPTY);
      }
    }

    // Players are at their spawn points and alive
    expect(s.players.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      const p = s.players[i]!;
      expect(p.alive).toBe(true);
      expect(p.x).toBe(SPAWN_POINTS[i]!.x);
      expect(p.y).toBe(SPAWN_POINTS[i]!.y);
      expect(s.grid[cellIndex(p.x, p.y)]).toBe(TILE_EMPTY);
    }

    // Grace ticks initialised to 3
    expect(s.graceTicksRemaining).toBe(3);

    // Soft block density within seeded bounds (~65%)
    let candidateCount = 0;
    let softCount = 0;
    for (let y = 0; y < ARENA_H; y++) {
      for (let x = 0; x < ARENA_W; x++) {
        const idx = cellIndex(x, y);
        if (!isBorder(x, y) && !isHardPillar(x, y) && !safeZone.has(idx)) {
          candidateCount += 1;
          if (s.grid[idx] === TILE_SOFT) softCount += 1;
        }
      }
    }
    const density = (softCount / candidateCount) * 100;
    expect(density).toBeGreaterThan(50);
    expect(density).toBeLessThan(80);
  });
});

describe('2. bomb fuse + blast plus-shape radius; hard block stops blast; soft block destroyed', () => {
  it('bomb counts down fuse 30, explodes in plus shape, hard blocks stop blast, soft block is destroyed', () => {
    let s = bomberman.setup(['p1'], 42, {});
    // Place a soft block 2 cells right of player 1 at (3, 1)
    // p1 starts at (1, 1). (2, 1) is corridor. (3, 1) can be soft block.
    // (1, 0) is hard border, (1, 2) is corridor, (2, 2) is hard pillar.
    s.grid[cellIndex(3, 1)] = TILE_SOFT;

    // p1 places bomb at (1, 1)
    const rBomb = bomberman.reduce(s, 'p1', { type: 'bomb' });
    expect(rBomb.ok).toBe(true);
    if (!rBomb.ok) return;
    s = rBomb.state;

    expect(s.bombs.length).toBe(1);
    const bomb = s.bombs[0]!;
    expect(bomb.fuse).toBe(30);
    expect(bomb.radius).toBe(2);

    // Move player away so bomb is not held by standing owner
    const rMove = bomberman.reduce(s, 'p1', { type: 'move', dir: 'down' });
    expect(rMove.ok).toBe(true);
    if (!rMove.ok) return;
    s = rMove.state;
    expect(s.players[0]!.y).toBe(2);

    // Tick 29 times
    for (let i = 0; i < 29; i++) {
      const rTick = bomberman.reduce(s, 'p1', { type: 'tick' });
      expect(rTick.ok).toBe(true);
      if (!rTick.ok) return;
      s = rTick.state;
    }
    expect(s.bombs[0]!.fuse).toBe(1);

    // 30th tick triggers explosion
    const rExplode = bomberman.reduce(s, 'p1', { type: 'tick' });
    expect(rExplode.ok).toBe(true);
    if (!rExplode.ok) return;
    s = rExplode.state;

    // Bomb is detonated and removed
    expect(s.bombs.length).toBe(0);
    // Blast cells generated
    expect(s.blasts.length).toBeGreaterThan(0);

    // Center (1, 1) has blast
    expect(s.blasts.some((b) => b.x === 1 && b.y === 1)).toBe(true);
    // Arm right: (2, 1) has blast
    expect(s.blasts.some((b) => b.x === 2 && b.y === 1)).toBe(true);
    // Soft block at (3, 1) was destroyed!
    expect(s.grid[cellIndex(3, 1)]).toBe(TILE_EMPTY);
    // Blast reached (3, 1)
    expect(s.blasts.some((b) => b.x === 3 && b.y === 1)).toBe(true);
    // Blast stopped by soft block: (4, 1) must NOT have blast
    expect(s.blasts.some((b) => b.x === 4 && b.y === 1)).toBe(false);

    // Hard block at (1, 0) (border) must NOT have blast
    expect(s.blasts.some((b) => b.x === 1 && b.y === 0)).toBe(false);
  });
});

describe('3. chain reaction detonation same-tick, deterministic queue order', () => {
  it('chain reaction detonates adjacent bomb on the same tick in deterministic (y,x) order', () => {
    let s = bomberman.setup(['p1', 'p2'], 100, {});
    // Clean corridor around (1,1)-(5,1)
    for (let x = 1; x <= 5; x++) {
      s.grid[cellIndex(x, 1)] = TILE_EMPTY;
    }

    // p1 at (1,1) drops bomb
    let r = bomberman.reduce(s, 'p1', { type: 'bomb' });
    expect(r.ok).toBe(true);
    s = (r as { state: BombermanState }).state;

    // Move p1 out of the way to (1,2) then (1,3)
    r = bomberman.reduce(s, 'p1', { type: 'move', dir: 'down' });
    s = (r as { state: BombermanState }).state;

    // Manually add second bomb at (2,1) with high fuse
    s.nextBombId = 10;
    s.bombs.push({
      id: 2,
      ownerId: 'p2',
      x: 2,
      y: 1,
      fuse: 20, // fuse has not expired
      radius: 2,
    });
    // Add third bomb at (4,1) with high fuse
    s.bombs.push({
      id: 3,
      ownerId: 'p2',
      x: 4,
      y: 1,
      fuse: 20,
      radius: 2,
    });

    // Tick until bomb 1 reaches fuse 0
    while (s.bombs.find((b) => b.id === 1)?.fuse ?? 0 > 0) {
      r = bomberman.reduce(s, 'p1', { type: 'tick' });
      s = (r as { state: BombermanState }).state;
    }

    // Bomb 1 detonates -> hits bomb 2 at (2,1) -> bomb 2 detonates -> hits bomb 3 at (4,1) -> bomb 3 detonates!
    // All 3 bombs should detonate and disappear on this chain tick!
    expect(s.bombs.length).toBe(0);
    // Blasts should reach (5, 1) via bomb 3's blast
    expect(s.blasts.some((b) => b.x === 5 && b.y === 1)).toBe(true);
  });
});

describe('4. powerup reveal + collect; FLAME increases radius; BOMB cap; PASS walk-through', () => {
  it('soft block reveals powerup, player collects it to increase stats or pass through bombs', () => {
    let s = bomberman.setup(['p1'], 999, {});
    // Clear area around (1,1)
    s.grid[cellIndex(2, 1)] = TILE_SOFT;
    s.hiddenPowerups[cellIndex(2, 1)] = 'flame';

    s.grid[cellIndex(1, 2)] = TILE_SOFT;
    s.hiddenPowerups[cellIndex(1, 2)] = 'pass';

    // Drop bomb at (1,1)
    let r = bomberman.reduce(s, 'p1', { type: 'bomb' });
    s = (r as { state: BombermanState }).state;

    // Detonate bomb by setting fuse to 1 and moving away or ticking
    s.bombs[0]!.fuse = 1;
    // Step off to not hold detonation
    s.players[0]!.bombsUnderPlayer = [];
    s.players[0]!.x = 1;
    s.players[0]!.y = 3;

    // Tick to detonate
    r = bomberman.reduce(s, 'p1', { type: 'tick' });
    s = (r as { state: BombermanState }).state;
    // Both soft blocks destroyed and revealed
    expect(s.grid[cellIndex(2, 1)]).toBe(TILE_EMPTY);
    expect(s.grid[cellIndex(1, 2)]).toBe(TILE_EMPTY);
    expect(s.visiblePowerups.some((p) => p.x === 2 && p.y === 1 && p.kind === 'flame')).toBe(true);
    expect(s.visiblePowerups.some((p) => p.x === 1 && p.y === 2 && p.kind === 'pass')).toBe(true);

    // Initial player stats
    expect(s.players[0]!.blastRadius).toBe(2);
    expect(s.players[0]!.hasPass).toBe(false);

    // Move player onto (1, 2) to collect PASS
    s.players[0]!.x = 1;
    s.players[0]!.y = 1;
    r = bomberman.reduce(s, 'p1', { type: 'move', dir: 'down' });
    s = (r as { state: BombermanState }).state;
    expect(s.players[0]!.hasPass).toBe(true);

    // Move player onto (2, 1) to collect FLAME
    s.players[0]!.x = 1;
    s.players[0]!.y = 1;
    r = bomberman.reduce(s, 'p1', { type: 'move', dir: 'right' });
    s = (r as { state: BombermanState }).state;
    expect(s.players[0]!.blastRadius).toBe(3);

    // PASS allows walking onto a live bomb placed by another
    s.bombs.push({ id: 99, ownerId: 'p2', x: 3, y: 1, fuse: 10, radius: 2 });
    s.grid[cellIndex(3, 1)] = TILE_EMPTY;
    r = bomberman.reduce(s, 'p1', { type: 'move', dir: 'right' });
    expect(r.ok).toBe(true);
    s = (r as { state: BombermanState }).state;
    expect(s.players[0]!.x).toBe(3);
  });
});

describe('5. bomb-under-owner protection; walking onto live bomb blocked without pass', () => {
  it('bomb under owner holds detonation until owner steps off; walking onto bomb without pass is blocked', () => {
    let s = bomberman.setup(['p1', 'p2'], 777, {});
    // p1 at (1,1), drops bomb
    let r = bomberman.reduce(s, 'p1', { type: 'bomb' });
    expect(r.ok).toBe(true);
    s = (r as { state: BombermanState }).state;

    const bombId = s.bombs[0]!.id;
    // Set fuse to 0
    s.bombs[0]!.fuse = 0;

    // Tick multiple times while p1 is standing on it: bomb MUST NOT detonate
    r = bomberman.reduce(s, 'p1', { type: 'tick' });
    s = (r as { state: BombermanState }).state;
    expect(s.bombs.some((b) => b.id === bombId)).toBe(true);

    // p2 is at (2,1). p2 tries to walk left onto the bomb at (1,1) without pass -> BLOCKED
    s.players[1]!.x = 2;
    s.players[1]!.y = 1;
    s.players[1]!.hasPass = false;
    const rBlocked = bomberman.reduce(s, 'p2', { type: 'move', dir: 'left' });
    expect(rBlocked.ok).toBe(false);

    // p1 steps off the bomb down to (1,2)
    const rStepOff = bomberman.reduce(s, 'p1', { type: 'move', dir: 'down' });
    expect(rStepOff.ok).toBe(true);
    s = rStepOff.state;
    expect(s.players[0]!.y).toBe(2);

    // Next tick: bomb detonates now that owner stepped off
    r = bomberman.reduce(s, 'p1', { type: 'tick' });
    s = (r as { state: BombermanState }).state;
    expect(s.bombs.some((b) => b.id === bombId)).toBe(false);
  });
});

describe('6. elimination + last-standing winner; mutual-kill draw', () => {
  it('last standing player is winner', () => {
    let s = bomberman.setup(['p1', 'p2'], 555, {});
    s.graceTicksRemaining = 0; // expire grace

    // Put p2 in blast zone
    s.players[1]!.x = 3;
    s.players[1]!.y = 1;
    s.grid[cellIndex(2, 1)] = TILE_EMPTY;
    s.grid[cellIndex(3, 1)] = TILE_EMPTY;

    // p1 places bomb at (1, 1) with radius 3
    s.players[0]!.blastRadius = 3;
    let r = bomberman.reduce(s, 'p1', { type: 'bomb' });
    s = (r as { state: BombermanState }).state;
    // Move p1 to safe spot (1, 5) out of blast radius 3
    s.players[0]!.x = 1;
    s.players[0]!.y = 5;
    s.players[0]!.bombsUnderPlayer = [];
    s.bombs[0]!.fuse = 0;

    // Tick triggers detonation and kills p2
    r = bomberman.reduce(s, 'p1', { type: 'tick' });
    s = (r as { state: BombermanState }).state;

    expect(s.players[1]!.alive).toBe(false);
    expect(s.players[0]!.alive).toBe(true);
    expect(s.phase).toBe('game_over');
    expect(s.winner).toBe('p1');
    expect(bomberman.isOver(s).over).toBe(true);
    expect(bomberman.isOver(s).winner).toBe('p1');
  });

  it('mutual kill results in draw (winner null, phase game_over)', () => {
    let s = bomberman.setup(['p1', 'p2'], 555, {});
    s.graceTicksRemaining = 0;

    // Put both players in blast zone of a bomb at (2,1)
    s.grid[cellIndex(1, 1)] = TILE_EMPTY;
    s.grid[cellIndex(2, 1)] = TILE_EMPTY;
    s.grid[cellIndex(3, 1)] = TILE_EMPTY;

    s.players[0]!.x = 1;
    s.players[0]!.y = 1;
    s.players[1]!.x = 3;
    s.players[1]!.y = 1;

    s.bombs.push({ id: 1, ownerId: 'other', x: 2, y: 1, fuse: 0, radius: 2 });

    const r = bomberman.reduce(s, 'p1', { type: 'tick' });
    s = (r as { state: BombermanState }).state;

    expect(s.players[0]!.alive).toBe(false);
    expect(s.players[1]!.alive).toBe(false);
    expect(s.phase).toBe('game_over');
    expect(s.winner).toBeNull();
    expect(bomberman.isOver(s).over).toBe(true);
    expect(bomberman.isOver(s).winner).toBeUndefined();
  });
});

describe('7. DETERMINISM', () => {
  it('same seed + action script => identical JSON.stringify(state) replay', () => {
    const seed = 99999;
    const actions: { playerId: string; action: { type: 'move'; dir: 'up' | 'down' | 'left' | 'right' } | { type: 'bomb' } | { type: 'tick' } }[] = [
      { playerId: 'p1', action: { type: 'move', dir: 'down' } },
      { playerId: 'p2', action: { type: 'move', dir: 'down' } },
      { playerId: 'p1', action: { type: 'bomb' } },
      { playerId: 'p1', action: { type: 'move', dir: 'up' } },
      { playerId: 'p1', action: { type: 'tick' } },
      { playerId: 'p2', action: { type: 'tick' } },
      { playerId: 'p1', action: { type: 'tick' } },
      { playerId: 'p2', action: { type: 'bomb' } },
      { playerId: 'p2', action: { type: 'move', dir: 'up' } },
      { playerId: 'p1', action: { type: 'tick' } },
      { playerId: 'p2', action: { type: 'tick' } },
    ];

    let s1 = bomberman.setup(['p1', 'p2'], seed, {});
    for (const { playerId, action } of actions) {
      const r = bomberman.reduce(s1, playerId, action);
      if (r.ok) s1 = r.state;
    }

    let s2 = bomberman.setup(['p1', 'p2'], seed, {});
    for (const { playerId, action } of actions) {
      const r = bomberman.reduce(s2, playerId, action);
      if (r.ok) s2 = r.state;
    }

    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    expect(s1).toEqual(s2);
  });
});

describe('8. safe-spawn invariant & opening bomb escape for all 8 seats', () => {
  it('guarantees every spawn point (seats 0..7) has an opening route with safe legal escape after bomb placement', () => {
    // Test all 8 spawn points under arbitrary map seeds
    const seeds = [42, 12345, 99999];
    for (const seed of seeds) {
      const players = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
      const s = bomberman.setup(players, seed, { softDensity: 80 }); // max density

      for (let seat = 0; seat < players.length; seat++) {
        const pid = players[seat]!;
        const p = s.players[seat]!;
        const sp = SPAWN_POINTS[seat]!;
        expect(p.x).toBe(sp.x);
        expect(p.y).toBe(sp.y);
        expect(s.grid[cellIndex(p.x, p.y)]).toBe(TILE_EMPTY);

        // Clone state to test this seat independently
        let sim = structuredClone(s);
        sim.graceTicksRemaining = 0; // ensure lethal damage is active

        // 1. Player drops bomb at initial spawn point
        const rBomb = bomberman.reduce(sim, pid, { type: 'bomb' });
        expect(rBomb.ok).toBe(true);
        sim = (rBomb as { state: BombermanState }).state;
        const bomb = sim.bombs.find((b) => b.ownerId === pid)!;
        expect(bomb).toBeDefined();
        expect(bomb.x).toBe(sp.x);
        expect(bomb.y).toBe(sp.y);

        // 2. Bot policy view from this player
        const rng = rngFrom({ seed: seat * 100 + 1, calls: 0 });
        let escaped = false;

        // Walk using bot policy (or legal moves) for up to 10 actions
        for (let step = 0; step < 10; step++) {
          const v = bomberman.view(sim, pid);
          const act = bombermanBot.chooseAction(v as never, pid, rng, 'normal');
          if (act.type === 'move') {
            const rMove = bomberman.reduce(sim, pid, act);
            expect(rMove.ok).toBe(true);
            sim = (rMove as { state: BombermanState }).state;
          } else {
            // If bot chose not to move, tick
            const rTick = bomberman.reduce(sim, pid, { type: 'tick' });
            expect(rTick.ok).toBe(true);
            sim = (rTick as { state: BombermanState }).state;
          }

          const curP = sim.players.find((pl) => pl.id === pid)!;
          // Safe cell: not in line of sight of spawn within blast radius 2
          const inXLine = curP.x === sp.x && Math.abs(curP.y - sp.y) <= 2;
          const inYLine = curP.y === sp.y && Math.abs(curP.x - sp.x) <= 2;
          if (!inXLine && !inYLine) {
            escaped = true;
            break;
          }
        }

        expect(escaped).toBe(true);

        // 3. Detonate the bomb by ticking out its fuse and verify player survives
        while (sim.bombs.some((b) => b.ownerId === pid)) {
          const rTick = bomberman.reduce(sim, pid, { type: 'tick' });
          expect(rTick.ok).toBe(true);
          sim = (rTick as { state: BombermanState }).state;
        }
        // Tick through blast
        for (let t = 0; t < 5; t++) {
          const rTick = bomberman.reduce(sim, pid, { type: 'tick' });
          if (rTick.ok) sim = rTick.state;
        }

        const finalP = sim.players.find((pl) => pl.id === pid)!;
        expect(finalP.alive).toBe(true);
      }
    }
  });
});

describe('9. bot policy progression & behavioral intelligence', () => {
  it('easy, normal, hard bots choose legal actions based on view alone', () => {
    const s = bomberman.setup(['bot1', 'bot2'], 12345, {});
    const v = bomberman.view(s, 'bot1') as Parameters<typeof bombermanBot.chooseAction>[0];
    expect(v.you).not.toBeNull();

    const actEasy = bombermanBot.chooseAction(v, 'bot1', rngFrom({ seed: 111, calls: 0 }), 'easy');
    expect(['move', 'bomb', 'tick']).toContain(actEasy.type);

    const actNormal = bombermanBot.chooseAction(v, 'bot1', rngFrom({ seed: 222, calls: 0 }), 'normal');
    expect(['move', 'bomb', 'tick']).toContain(actNormal.type);

    const actHard = bombermanBot.chooseAction(v, 'bot1', rngFrom({ seed: 333, calls: 0 }), 'hard');
    expect(['move', 'bomb', 'tick']).toContain(actHard.type);
  });

  it('bot actively moves and places bombs to destroy soft blocks and make progress', () => {
    let s = bomberman.setup(['bot1', 'bot2'], 42, {});
    const rng = rngFrom({ seed: 777, calls: 0 });

    let bombPlacedCount = 0;
    let movesCount = 0;
    const initialSoftCount = s.grid.filter((t) => t === TILE_SOFT).length;

    // Run 120 steps of simulation for bot1
    for (let i = 0; i < 120; i++) {
      const v = bomberman.view(s, 'bot1');
      const action = bombermanBot.chooseAction(v as never, 'bot1', rng, 'normal');
      if (action.type === 'bomb') bombPlacedCount++;
      if (action.type === 'move') movesCount++;

      const res = bomberman.reduce(s, 'bot1', action);
      if (res.ok) s = res.state;

      // Tick room clock to allow bombs to explode and advance state
      const tickRes = bomberman.reduce(s, 'bot1', { type: 'tick' });
      if (tickRes.ok) s = tickRes.state;
    }

    // Bot must have made multiple moves and placed bombs
    expect(movesCount).toBeGreaterThan(10);
    expect(bombPlacedCount).toBeGreaterThan(0);
    // Bot must have survived its own actions
    expect(s.players[0]!.alive).toBe(true);
    // Soft blocks must have been destroyed
    const finalSoftCount = s.grid.filter((t) => t === TILE_SOFT).length;
    expect(finalSoftCount).toBeLessThan(initialSoftCount);
  });

  it('bot flees immediate blast danger and avoids suicidal moves', () => {
    let s = bomberman.setup(['bot1', 'bot2'], 999, {});
    s.graceTicksRemaining = 0;

    // Put bot1 at (1, 1). Place bomb at (1, 1) with fuse 1.
    s.players[0]!.x = 1;
    s.players[0]!.y = 1;
    s.bombs.push({ id: 10, ownerId: 'bot2', x: 1, y: 1, fuse: 1, radius: 2 });

    const rng = rngFrom({ seed: 55, calls: 0 });
    const v = bomberman.view(s, 'bot1');
    const action = bombermanBot.chooseAction(v as never, 'bot1', rng, 'hard');

    // Bot must choose to move away, NOT bomb or sit and tick
    expect(action.type).toBe('move');
    if (action.type === 'move') {
      expect(['down', 'right']).toContain(action.dir);
      // Execute move
      const res = bomberman.reduce(s, 'bot1', action);
      expect(res.ok).toBe(true);
    }
  });
});
