import * as React from 'react';
import { useRoom, emit } from '../net/socket.js';
import { sfx, bgm } from '../ui/sound.js';
import { EV } from '@puzzle-arena/shared';
import { SEAT_COLORS, resolvePlayer, type PlayerLike } from '../ui/seat.js';
import type {
  SpaceInvadersView,
  SpaceInvadersPublicPlayer,
  SpaceInvadersAction,
  Bunker,
  Bullet,
  AlienBomb,
  UFO,
  SpaceInvadersConfig,
} from '@puzzle-arena/games';

export const PLAYFIELD_W = 64;
export const PLAYFIELD_H = 44;
export const CANVAS_SCALE = 10; // 640 x 440 px internal canvas resolution
export const CW = PLAYFIELD_W * CANVAS_SCALE;
export const CH = PLAYFIELD_H * CANVAS_SCALE;

// Palette (authentic 1978 CRT arcade cellophane aesthetic)
const COLOR_BG = '#060810';
const COLOR_PLAYER = '#2ee66b';
const COLOR_PLAYER_CANNON = '#ffffff';
const COLOR_BULLET = '#ffe438';
const COLOR_BOMB = '#ff3f8e';
const COLOR_BUNKER = '#2ee66b';
const COLOR_UFO = '#ff283d';
const COLOR_SQUID = '#ff3f8e'; // row 0: top magenta
const COLOR_CRAB = '#24d6ff'; // rows 1, 2: mid cyan
const COLOR_OCTOPUS = '#8bff30'; // rows 3, 4: bot lime
const COLOR_GROUND = '#2ee66b';

// ---------------------------------------------------------------------------
// Authentic 1978 Space Invaders Arcade Bitmaps
// ---------------------------------------------------------------------------

const SPRITE_SQUID: [string[], string[]] = [
  // Frame 0 (tentacles in)
  [
    '00011000',
    '00111100',
    '01111110',
    '11011011',
    '11111111',
    '00100100',
    '01011010',
    '10100101',
  ],
  // Frame 1 (tentacles out)
  [
    '00011000',
    '00111100',
    '01111110',
    '11011011',
    '11111111',
    '01011010',
    '10000001',
    '01000010',
  ],
];

const SPRITE_CRAB: [string[], string[]] = [
  // Frame 0 (claws up)
  [
    '00100000100',
    '00010001000',
    '00111111100',
    '01101110110',
    '11111111111',
    '10111111101',
    '10100000101',
    '00011011000',
  ],
  // Frame 1 (claws down)
  [
    '00100000100',
    '10010001001',
    '10111111101',
    '11101110111',
    '11111111111',
    '01111111110',
    '00100000100',
    '01000000010',
  ],
];

const SPRITE_OCTOPUS: [string[], string[]] = [
  // Frame 0 (legs flared)
  [
    '000011110000',
    '011111111110',
    '111111111111',
    '111001100111',
    '111111111111',
    '000110011000',
    '001101101100',
    '110000000011',
  ],
  // Frame 1 (legs folded)
  [
    '000011110000',
    '011111111110',
    '111111111111',
    '111001100111',
    '111111111111',
    '001100001100',
    '011001100110',
    '000110011000',
  ],
];

const SPRITE_CANNON = [
  '0000001000000',
  '0000011100000',
  '0000011100000',
  '0111111111110',
  '1111111111111',
  '1111111111111',
  '1111111111111',
  '1111111111111',
];

const SPRITE_UFO = [
  '0000011111100000',
  '0001111111111000',
  '0011111111111100',
  '0110110110110110',
  '1111111111111111',
  '0011100110011100',
  '0001000000001000',
  '0000000000000000',
];

const SPRITE_EXPLOSION = [
  '000010000100',
  '010001001000',
  '001000000010',
  '000100001000',
  '110000000011',
  '000100001000',
  '001001000100',
  '010010000010',
];

const SPRITE_BOMB: [string[], string[]] = [
  // Frame 0
  ['010', '100', '010', '001', '010', '100', '010'],
  // Frame 1
  ['010', '001', '010', '100', '010', '001', '010'],
];

function drawBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: string[],
  startX: number,
  startY: number,
  pixelSize: number,
  color: string,
) {
  ctx.fillStyle = color;
  const rows = bitmap.length;
  for (let r = 0; r < rows; r++) {
    const row = bitmap[r]!;
    const cols = row.length;
    for (let c = 0; c < cols; c++) {
      if (row[c] === '1') {
        ctx.fillRect(startX + c * pixelSize, startY + r * pixelSize, pixelSize, pixelSize);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Starfield (deterministic PRNG seed 1978)
// ---------------------------------------------------------------------------

interface Star {
  x: number;
  y: number;
  size: number;
  color: string;
  twinklePhase: number;
}

const STARS: Star[] = (() => {
  let s = 1978;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const stars: Star[] = [];
  for (let i = 0; i < 50; i++) {
    stars.push({
      x: Math.floor(rand() * CW),
      y: Math.floor(rand() * (CH - 40)),
      size: rand() < 0.25 ? 2 : 1,
      color: rand() < 0.3 ? '#88aaff' : rand() < 0.6 ? '#ffffff' : '#556688',
      twinklePhase: Math.floor(rand() * 4),
    });
  }
  return stars;
})();

export interface EphemeralExplosion {
  id: number;
  x: number;
  y: number;
  color: string;
  age: number;
}

export interface EphemeralScorePopup {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
}

interface CustomInvaderSfx {
  invaderMarch?: (step: number) => void;
  invaderLaser?: () => void;
  invaderExplosion?: () => void;
  invaderUfo?: () => void;
}

const customSfx = sfx as unknown as CustomInvaderSfx;

/**
 * Master playfield render routine: draws on any canvas context.
 */
export function renderPlayfieldCanvas(
  ctx: CanvasRenderingContext2D,
  player: SpaceInvadersPublicPlayer,
  width: number,
  height: number,
  options?: {
    explosions?: EphemeralExplosion[];
    popups?: EphemeralScorePopup[];
    tickCount?: number;
  },
) {
  const scaleX = width / PLAYFIELD_W;
  const scaleY = height / PLAYFIELD_H;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scaleX / CANVAS_SCALE, scaleY / CANVAS_SCALE);

  // 1. Clear background
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, CW, CH);

  // 2. Deterministic Twinkling Starfield
  const tick = options?.tickCount ?? 0;
  for (const star of STARS) {
    const isDim = (tick + star.twinklePhase) % 4 === 0;
    ctx.fillStyle = isDim ? 'rgba(255, 255, 255, 0.15)' : star.color;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }

  // 3. Ground defense line
  ctx.fillStyle = COLOR_GROUND;
  ctx.fillRect(0, 43 * CANVAS_SCALE + 6, CW, 2);

  // 4. Bunkers (4 bunkers, 8x7 mask) with 2px-pixel authentic green chunks
  if (player.bunkers) {
    for (const bunker of player.bunkers) {
      const bx = bunker.x * CANVAS_SCALE;
      const by = bunker.y * CANVAS_SCALE;
      for (let r = 0; r < bunker.height; r++) {
        for (let c = 0; c < bunker.width; c++) {
          const solid = bunker.mask[r * bunker.width + c];
          if (solid) {
            ctx.fillStyle = COLOR_BUNKER;
            ctx.fillRect(bx + c * CANVAS_SCALE, by + r * CANVAS_SCALE, CANVAS_SCALE, CANVAS_SCALE);
            // Subtle 2px pixel highlight for authentic chunky CRT look
            ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
            ctx.fillRect(bx + c * CANVAS_SCALE, by + r * CANVAS_SCALE, CANVAS_SCALE, 2);
          }
        }
      }
    }
  }

  // 5. Aliens with 2-frame animation based on formation march parity
  const frame: 0 | 1 = Math.abs(player.formationX) % 2 === 0 ? 0 : 1;
  if (player.aliens) {
    for (const alien of player.aliens) {
      if (!alien.alive) continue;
      const ax = (player.formationX + alien.col * 4) * CANVAS_SCALE;
      const ay = (player.formationY + alien.row * 2) * CANVAS_SCALE;

      if (alien.type === 'squid') {
        drawBitmap(ctx, SPRITE_SQUID[frame], ax + 7, ay - 3, 2, COLOR_SQUID);
      } else if (alien.type === 'crab') {
        drawBitmap(ctx, SPRITE_CRAB[frame], ax + 4, ay - 3, 2, COLOR_CRAB);
      } else {
        drawBitmap(ctx, SPRITE_OCTOPUS[frame], ax + 3, ay - 3, 2, COLOR_OCTOPUS);
      }
    }
  }

  // 6. Mystery UFO
  if (player.ufo && player.ufo.alive) {
    const ux = player.ufo.x * CANVAS_SCALE;
    const uy = player.ufo.y * CANVAS_SCALE;
    drawBitmap(ctx, SPRITE_UFO, ux + 4, uy - 3, 2, COLOR_UFO);
    // Rotating cabin pod light
    ctx.fillStyle = (tick % 2 === 0) ? '#ffffff' : '#ffd426';
    ctx.fillRect(ux + 14, uy + 5, 4, 2);
    ctx.fillRect(ux + 22, uy + 5, 4, 2);
  }

  // 7. Player Ship (cannon)
  if (!player.gameOver) {
    // Grace period blink
    const isBlinking = player.respawnGraceTicks !== undefined && player.respawnGraceTicks > 0 && Math.floor(player.respawnGraceTicks / 2) % 2 === 0;
    if (!isBlinking) {
      const px = player.playerX * CANVAS_SCALE;
      const py = player.playerY * CANVAS_SCALE;
      drawBitmap(ctx, SPRITE_CANNON, px + 2, py - 3, 2, COLOR_PLAYER);
      // White cannon tip highlight
      ctx.fillStyle = COLOR_PLAYER_CANNON;
      ctx.fillRect(px + 14, py - 3, 2, 4);
    }
  }

  // 8. Player Bullets (supports multi-bullet array & legacy bullet)
  const bullets = player.bullets && player.bullets.length > 0 ? player.bullets : (player.bullet ? [player.bullet] : []);
  for (const bullet of bullets) {
    const x = bullet.x * CANVAS_SCALE + 4;
    const y = bullet.y * CANVAS_SCALE;
    ctx.fillStyle = COLOR_BULLET;
    ctx.fillRect(x, y - 2, 2, CANVAS_SCALE);
    // Bright white tip
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 1, y - 4, 4, 3);
  }

  // 9. Alien Bombs (zigzag rolling bombs)
  if (player.alienBombs) {
    const bombFrame: 0 | 1 = (Math.floor(tick / 2)) % 2 === 0 ? 0 : 1;
    for (const bomb of player.alienBombs) {
      const bx = bomb.x * CANVAS_SCALE + 2;
      const by = bomb.y * CANVAS_SCALE;
      drawBitmap(ctx, SPRITE_BOMB[bombFrame], bx, by, 2, COLOR_BOMB);
    }
  }

  // 10. Active Explosions
  if (options?.explosions) {
    for (const exp of options.explosions) {
      drawBitmap(ctx, SPRITE_EXPLOSION, exp.x, exp.y, 2, exp.color);
    }
  }

  // 11. Floating Score Popups
  if (options?.popups) {
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    for (const pop of options.popups) {
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, pop.y - pop.age * 2.5);
    }
    ctx.textAlign = 'start';
  }

  ctx.restore();
}

/**
 * Mobile instant press button with auto-repeat and tactile pressed feedback
 */
function TouchControlBtn({
  onFire,
  repeatMs,
  className,
  label,
  children,
}: {
  onFire: () => void;
  repeatMs?: number;
  className?: string;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  const timer = React.useRef<number | null>(null);
  const onFireRef = React.useRef(onFire);
  onFireRef.current = onFire;
  const [pressed, setPressed] = React.useState(false);

  const stop = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
    setPressed(false);
  }, []);

  React.useEffect(() => stop, [stop]);

  return (
    <button
      type="button"
      aria-label={label}
      className={`touch-none select-none font-display border-2 border-pa-border active:translate-y-0.5 transition-all duration-75 ${className ?? ''} ${
        pressed ? 'brightness-125 ring-2 ring-pa-cyan shadow-none translate-y-0.5' : ''
      }`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // ignore
        }
        setPressed(true);
        onFireRef.current();
        if (repeatMs) {
          if (timer.current !== null) window.clearInterval(timer.current);
          timer.current = window.setInterval(() => {
            onFireRef.current();
          }, repeatMs);
        }
      }}
      onPointerUp={(e) => {
        try {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }
        } catch {
          // ignore
        }
        stop();
      }}
      onPointerCancel={stop}
    >
      {children}
    </button>
  );
}

/** Tiny Player Ship Icon for Lives count in HUD */
function MiniShipIcon({ color = '#2ee66b' }: { color?: string }) {
  return (
    <svg width={18} height={12} viewBox="0 0 16 10" aria-hidden="true" className="inline-block shrink-0">
      <path
        fill={color}
        d="M7 0 H9 V2 H11 V4 H15 V8 H1 V4 H5 V2 H7 Z M0 8 H16 V10 H0 Z"
      />
    </svg>
  );
}

/**
 * Spectator Mini-Board for another player
 */
function SpaceInvadersSpectatorBoard({
  player,
  displayName,
  color,
}: {
  player: SpaceInvadersPublicPlayer;
  displayName: string;
  color: string;
}): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderPlayfieldCanvas(ctx, player, canvas.width, canvas.height);
  }, [player]);

  return (
    <div className="flex flex-col items-center gap-1.5 p-2 bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)]">
      <div className="flex items-center justify-between w-full text-xs font-display tabular px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-pa-ink font-bold truncate max-w-[90px]">{displayName}</span>
        </div>
        <span className="text-pa-cyan font-bold">{player.score}</span>
      </div>

      <div className="relative border-2 border-pa-border bg-pa-bg">
        <canvas
          ref={canvasRef}
          width={192}
          height={132}
          className="block w-[192px] h-[132px]"
          style={{ imageRendering: 'pixelated' }}
        />
        {player.gameOver && (
          <div className="absolute inset-0 bg-pa-bg/85 flex flex-col items-center justify-center gap-1">
            <span className="font-display text-pa-danger text-xs font-bold tracking-wider">GAME OVER</span>
            <span className="font-display text-[10px] text-pa-ink-dim">SCORE {player.score}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between w-full text-[10px] font-display text-pa-ink-dim px-1">
        <span>WAVE {player.wave}</span>
        <div className="flex gap-1">
          {Array.from({ length: Math.max(0, player.lives) }).map((_, i) => (
            <MiniShipIcon key={i} color={color} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Main SpaceInvadersBoard component
 */
export function SpaceInvadersBoard({
  view,
  players,
  youId,
  legalActions: _legalActions,
  turnEndsAt: _turnEndsAt,
  onAction: _onAction,
}: {
  view: SpaceInvadersView;
  players: unknown;
  youId: string | null;
  legalActions?: string[];
  turnEndsAt?: number | null;
  onAction: (a: SpaceInvadersAction) => void;
}): React.ReactElement {
  const you = view.you;
  const paused = useRoom((s) => s.paused);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Responsive scale & orientation
  const [containerSize, setContainerSize] = React.useState({ w: 800, h: 600 });
  const [isLandscape, setIsLandscape] = React.useState(false);

  // Measure container dimensions for crisp aspect-preserving scaling
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(200, rect.width);
      const h = Math.max(200, rect.height);
      setContainerSize({ w, h });
      setIsLandscape(w > h && w >= 640);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    window.addEventListener('resize', updateSize);
    window.visualViewport?.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
      window.visualViewport?.removeEventListener('resize', updateSize);
    };
  }, []);

  // Audio: play BGM on mount
  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);

  // Ephemeral visual effects refs (explosions and score popups)
  const explosionsRef = React.useRef<EphemeralExplosion[]>([]);
  const scorePopupsRef = React.useRef<EphemeralScorePopup[]>([]);
  const nextEffectIdRef = React.useRef(1);
  const tickCounterRef = React.useRef(0);

  // Marching sound heartbeat tracking
  const prevFormationXRef = React.useRef(you?.formationX ?? 10);
  const prevFormationYRef = React.useRef(you?.formationY ?? 2);
  const heartbeatStepRef = React.useRef(0);

  // State diff tracking for sound & effects
  const prevKilledRef = React.useRef(you?.aliveCount ?? 55);
  const prevWaveRef = React.useRef(you?.wave ?? 1);
  const prevScoreRef = React.useRef(you?.score ?? 0);
  const prevLivesRef = React.useRef(you?.lives ?? 3);
  const prevUfoRef = React.useRef(Boolean(you?.ufo && you.ufo.alive));

  const [waveClearFlash, setWaveClearFlash] = React.useState(false);

  // Alien march sound effect: triggers when formation steps
  React.useEffect(() => {
    if (!you || you.gameOver || view.phase === 'game_over') return;
    if (you.formationX !== prevFormationXRef.current || you.formationY !== prevFormationYRef.current) {
      prevFormationXRef.current = you.formationX;
      prevFormationYRef.current = you.formationY;
      heartbeatStepRef.current += 1;
      customSfx.invaderMarch?.(heartbeatStepRef.current);
    }
  }, [you?.formationX, you?.formationY, you?.gameOver, view.phase, you]);

  // UFO sound effect
  React.useEffect(() => {
    if (!you || you.gameOver || view.phase === 'game_over') return;
    const hasUfo = Boolean(you.ufo && you.ufo.alive);
    if (hasUfo) {
      customSfx.invaderUfo?.();
    }
    prevUfoRef.current = hasUfo;
  }, [you?.ufo?.x, you?.ufo?.alive, you?.gameOver, view.phase, you]);

  // Kills, waves, score gain, lives loss diff reactions
  React.useEffect(() => {
    if (!you) return;

    // Alien killed
    if (you.aliveCount < prevKilledRef.current) {
      customSfx.invaderExplosion?.() ?? sfx.bomb();
      // Add explosion & score popup at current formation position
      const scoreGained = Math.max(8, you.score - prevScoreRef.current);
      const estX = (you.formationX + 16) * CANVAS_SCALE;
      const estY = (you.formationY + 4) * CANVAS_SCALE;
      explosionsRef.current.push({
        id: nextEffectIdRef.current++,
        x: estX,
        y: estY,
        color: COLOR_CRAB,
        age: 0,
      });
      scorePopupsRef.current.push({
        id: nextEffectIdRef.current++,
        x: estX + 10,
        y: estY,
        text: `+${scoreGained}`,
        color: COLOR_BULLET,
        age: 0,
      });
      prevKilledRef.current = you.aliveCount;
    } else if (you.aliveCount > prevKilledRef.current) {
      prevKilledRef.current = you.aliveCount;
    }

    // Player lost life
    if (you.lives < prevLivesRef.current) {
      sfx.gameOver();
      explosionsRef.current.push({
        id: nextEffectIdRef.current++,
        x: you.playerX * CANVAS_SCALE,
        y: you.playerY * CANVAS_SCALE,
        color: COLOR_PLAYER,
        age: 0,
      });
      prevLivesRef.current = you.lives;
    } else if (you.lives > prevLivesRef.current) {
      prevLivesRef.current = you.lives;
    }

    // Wave progression
    if (you.wave > prevWaveRef.current) {
      prevWaveRef.current = you.wave;
      setWaveClearFlash(true);
      sfx.correct();
      const t = window.setTimeout(() => setWaveClearFlash(false), 2000);
      return () => window.clearTimeout(t);
    }

    // UFO destruction or high score pop
    if (you.score > prevScoreRef.current + 40 && prevScoreRef.current > 0) {
      customSfx.invaderExplosion?.() ?? sfx.tembak();
      scorePopupsRef.current.push({
        id: nextEffectIdRef.current++,
        x: CW / 2,
        y: 20,
        text: `+${you.score - prevScoreRef.current}`,
        color: COLOR_UFO,
        age: 0,
      });
    }
    prevScoreRef.current = you.score;
  }, [you?.aliveCount, you?.wave, you?.score, you?.lives, you]);

  // Redraw canvas loop on animation frame / update
  React.useEffect(() => {
    if (!you) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Age out explosions and score popups
    explosionsRef.current = explosionsRef.current
      .map((e) => ({ ...e, age: e.age + 1 }))
      .filter((e) => e.age < 8);
    scorePopupsRef.current = scorePopupsRef.current
      .map((p) => ({ ...p, age: p.age + 1 }))
      .filter((p) => p.age < 18);

    tickCounterRef.current += 1;

    renderPlayfieldCanvas(ctx, you, canvas.width, canvas.height, {
      explosions: explosionsRef.current,
      popups: scorePopupsRef.current,
      tickCount: tickCounterRef.current,
    });
  }, [you]);

  // -------------------------------------------------------------------------
  // Input Responsiveness: Fire-and-forget direct socket emit + coalescing
  // -------------------------------------------------------------------------

  const lastMoveTimeRef = React.useRef(0);
  const lastMoveDirRef = React.useRef<'left' | 'right' | null>(null);

  const dispatchMove = React.useCallback((dir: 'left' | 'right') => {
    const now = performance.now();
    // Coalesce if identical direction was emitted within 35ms, but always dispatch immediately on direction change
    if (lastMoveDirRef.current === dir && now - lastMoveTimeRef.current < 35) {
      return;
    }
    lastMoveTimeRef.current = now;
    lastMoveDirRef.current = dir;
    void emit(EV.gameAction, { type: 'move', dir });
    sfx.blip();
  }, []);

  const dispatchFire = React.useCallback(() => {
    // Fire-and-forget: emit directly without awaiting ack so UI never freezes
    void emit(EV.gameAction, { type: 'fire' });
    customSfx.invaderLaser?.() ?? sfx.tembak();
  }, []);

  // Independent client tick loop dispatching { type: 'tick' } every config.tickMs
  const tickMs = view.config?.tickMs ?? 60;
  React.useEffect(() => {
    if (!you || you.gameOver || view.phase === 'game_over' || paused) return;
    const interval = window.setInterval(() => {
      void emit(EV.gameAction, { type: 'tick' });
    }, tickMs);
    return () => window.clearInterval(interval);
  }, [you?.gameOver, view.phase, paused, tickMs]);

  // Keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }

      if (!you || you.gameOver || view.phase === 'game_over') return;

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        dispatchMove('left');
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        dispatchMove('right');
        return;
      }

      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        if (e.repeat) return; // one shot on keydown, hold does not spam
        dispatchFire();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [you?.gameOver, view.phase, dispatchMove, dispatchFire, you]);

  // Touch directly on canvas: left 40% moves left, right 40% moves right, center taps fire
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!you || you.gameOver || view.phase === 'game_over') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;

    if (relX < 0.38) {
      dispatchMove('left');
    } else if (relX > 0.62) {
      dispatchMove('right');
    } else {
      dispatchFire();
    }
  };

  // Spectator view when !you
  if (!you) {
    const playerList = (players as PlayerLike[]) ?? [];
    const activePlayers = view.players.filter((p) => !p.gameOver);
    const spectated = activePlayers.length > 0 ? activePlayers : view.players;

    return (
      <div className="w-full h-full overflow-auto p-3 sm:p-4 bg-pa-bg">
        <div className="text-center font-display text-xs tracking-widest text-pa-ink-dim mb-4">
          SPACE INVADERS · 1978 SPECTATING
        </div>
        {spectated.length === 0 ? (
          <div className="text-pa-ink-dim text-sm text-center">Waiting for defenders…</div>
        ) : (
          <div className="flex flex-wrap gap-4 justify-center items-start">
            {spectated.map((p) => {
              const info = resolvePlayer(playerList, p.id);
              const color = SEAT_COLORS[p.seat % SEAT_COLORS.length] ?? '#2ee66b';
              return (
                <SpaceInvadersSpectatorBoard
                  key={p.id}
                  player={p}
                  displayName={info.displayName}
                  color={color}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const playerList = (players as PlayerLike[]) ?? [];
  const opponents = view.players.filter((p) => p.id !== you.id);
  const isGameOver = you.gameOver || view.phase === 'game_over';

  // Compute scale to fill available viewport/container height & width
  const reservedHeaderHeight = isLandscape ? 44 : 52;
  const reservedControlsHeight = isLandscape ? 0 : 150;
  const availW = isLandscape ? Math.max(260, containerSize.w - 280) : containerSize.w;
  const availH = Math.max(160, containerSize.h - reservedHeaderHeight - reservedControlsHeight);

  // Aspect ratio is 64 : 44 (16:11)
  const scale = Math.min(availW / CW, availH / CH);
  const displayW = Math.floor(CW * scale);
  const displayH = Math.floor(CH * scale);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col items-center justify-between overflow-hidden bg-pa-bg select-none touch-none"
      style={{
        paddingTop: 'max(6px, env(safe-area-inset-top))',
        paddingBottom: 'max(6px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(6px, env(safe-area-inset-left))',
        paddingRight: 'max(6px, env(safe-area-inset-right))',
      }}
    >
      {/* ----------------- Top Score & Wave HUD ----------------- */}
      <div className="w-full flex items-center justify-between px-3 py-1.5 bg-pa-surface/90 backdrop-blur-sm border-b-2 border-pa-border z-10 shrink-0">
        {/* Left: Score & High Score */}
        <div className="flex items-center gap-4 sm:gap-6 font-display">
          <div>
            <div className="text-[9px] text-pa-ink-dim uppercase tracking-wider">SCORE</div>
            <div className="text-base sm:text-lg text-pa-cyan font-bold tabular leading-none">
              {String(you.score).padStart(5, '0')}
            </div>
          </div>
          <div className="border-l border-pa-border pl-3">
            <div className="text-[9px] text-pa-ink-dim uppercase tracking-wider">WAVE</div>
            <div className="text-base sm:text-lg text-pa-ink font-bold tabular leading-none">
              {you.wave}
            </div>
          </div>
          {you.maxBullets && you.maxBullets > 1 && (
            <div className="hidden sm:inline-block px-1.5 py-0.5 bg-pa-amber/20 border border-pa-amber text-pa-amber text-[9px] font-display rounded animate-pulse">
              RAPID FIRE x{you.maxBullets}
            </div>
          )}
        </div>

        {/* Right: Lives ship icons + rapid indicator */}
        <div className="flex items-center gap-3 font-display">
          <div className="flex flex-col items-end">
            <div className="text-[9px] text-pa-ink-dim uppercase tracking-wider mb-0.5">SHIPS</div>
            <div className="flex items-center gap-1 h-4">
              {Array.from({ length: Math.max(0, you.lives) }).map((_, i) => (
                <MiniShipIcon key={i} color="#2ee66b" />
              ))}
              {you.lives <= 0 && <span className="text-[9px] text-pa-danger font-bold">CRITICAL</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ----------------- Center Playfield Canvas ----------------- */}
      <div className="relative flex-1 w-full flex items-center justify-center min-h-0 overflow-hidden">
        {/* Letterbox & CRT frame wrapper */}
        <div
          className="relative border-4 border-pa-border shadow-[0_0_24px_rgba(0,0,0,0.8)] bg-pa-bg overflow-hidden flex items-center justify-center"
          style={{ width: displayW, height: displayH }}
        >
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            onPointerDown={handleCanvasPointerDown}
            className="w-full h-full block cursor-crosshair"
            style={{ imageRendering: 'pixelated' }}
          />

          {/* CRT Scanline overlay + subtle vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 2px)',
              boxShadow: 'inset 0 0 32px rgba(0,0,0,0.75)',
            }}
          />

          {/* Wave Cleared Flash banner */}
          {waveClearFlash && (
            <div className="absolute inset-0 bg-pa-bg/80 backdrop-blur-[2px] flex flex-col items-center justify-center animate-pulse pointer-events-none z-20">
              <div className="font-display text-pa-cyan text-xl sm:text-3xl font-bold tracking-widest drop-shadow-[0_0_12px_rgba(34,224,255,0.9)]">
                WAVE CLEARED!
              </div>
              <div className="font-display text-pa-ink text-xs sm:text-base mt-2">
                PREPARE FOR WAVE {you.wave}
              </div>
              {you.maxBullets && you.maxBullets > 1 && (
                <div className="font-display text-pa-amber text-xs sm:text-sm mt-1 animate-bounce">
                  ★ RAPID FIRE ACTIVATED ★
                </div>
              )}
            </div>
          )}

          {/* Game Over Overlay */}
          {isGameOver && (
            <div className="absolute inset-0 bg-pa-bg/85 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 z-20">
              <div className="font-display text-pa-danger text-2xl sm:text-4xl font-bold tracking-widest mb-2 animate-bounce">
                GAME OVER
              </div>
              <div className="font-display text-pa-ink text-sm sm:text-lg mb-1">
                FINAL SCORE: <span className="text-pa-cyan font-bold tabular">{you.score}</span>
              </div>
              <div className="font-display text-pa-ink-dim text-xs sm:text-sm">
                SURVIVED TO WAVE {you.wave} · KILLS: {you.aliveCount ? 55 - you.aliveCount : 55}
              </div>
            </div>
          )}
        </div>

        {/* Landscape Floating Side Touch Zones (Left edge = Left/Right, Right edge = Fire) */}
        {isLandscape && (
          <>
            <div className="absolute left-2 bottom-3 flex gap-2 z-30">
              <TouchControlBtn
                label="Move Left"
                onFire={() => dispatchMove('left')}
                repeatMs={80}
                className="w-16 h-16 rounded-xl bg-pa-surface/90 text-xl font-bold flex items-center justify-center shadow-[2px_2px_0_var(--color-pa-shadow)]"
              >
                ◀
              </TouchControlBtn>
              <TouchControlBtn
                label="Move Right"
                onFire={() => dispatchMove('right')}
                repeatMs={80}
                className="w-16 h-16 rounded-xl bg-pa-surface/90 text-xl font-bold flex items-center justify-center shadow-[2px_2px_0_var(--color-pa-shadow)]"
              >
                ▶
              </TouchControlBtn>
            </div>
            <div className="absolute right-3 bottom-3 z-30">
              <TouchControlBtn
                label="Fire Cannon"
                onFire={dispatchFire}
                className="w-20 h-20 rounded-2xl bg-pa-danger/20 border-pa-danger text-pa-danger font-bold text-base flex flex-col items-center justify-center shadow-[0_0_12px_rgba(255,40,61,0.5)]"
              >
                <span className="text-2xl">🔥</span>
                <span className="text-[10px] tracking-wider">FIRE</span>
              </TouchControlBtn>
            </div>
          </>
        )}
      </div>

      {/* ----------------- Opponents Mini Leaderboard Strip ----------------- */}
      {opponents.length > 0 && (
        <div className="w-full flex items-center justify-center gap-2 overflow-x-auto py-1 px-2 z-10 shrink-0">
          {opponents.map((opp) => {
            const info = resolvePlayer(playerList, opp.id);
            const color = SEAT_COLORS[opp.seat % SEAT_COLORS.length] ?? '#2ee66b';
            return (
              <div
                key={opp.id}
                className="flex items-center gap-1.5 px-2 py-0.5 bg-pa-surface/80 border border-pa-border shrink-0 text-[10px] font-display rounded"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="font-bold truncate max-w-[70px]">{info.displayName}</span>
                <span className="text-pa-cyan tabular">{opp.score}</span>
                {opp.gameOver ? (
                  <span className="text-pa-danger text-[8px]">OUT</span>
                ) : (
                  <span className="text-pa-ink-dim text-[8px]">W{opp.wave}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ----------------- Portrait Mobile Touch Controls ----------------- */}
      {/* Huge, easy-to-hit touch zones (min 64px thumb buttons) */}
      {!isLandscape && (
        <div className="w-full max-w-lg px-2 pb-1.5 pt-1 grid grid-cols-3 gap-2 shrink-0 z-20">
          <TouchControlBtn
            label="Move Left"
            onFire={() => dispatchMove('left')}
            repeatMs={80}
            className="h-16 rounded-xl flex items-center justify-center text-base font-bold bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)]"
          >
            ◀ LEFT
          </TouchControlBtn>

          <TouchControlBtn
            label="Fire Cannon"
            onFire={dispatchFire}
            className="h-16 rounded-xl flex flex-col items-center justify-center text-sm font-bold bg-pa-danger/20 border-2 border-pa-danger text-pa-danger shadow-[0_0_12px_rgba(255,40,61,0.35)] active:bg-pa-danger/40"
          >
            <span className="text-lg leading-none mb-0.5">🔥</span>
            <span className="text-[11px] tracking-wider">FIRE</span>
          </TouchControlBtn>

          <TouchControlBtn
            label="Move Right"
            onFire={() => dispatchMove('right')}
            repeatMs={80}
            className="h-16 rounded-xl flex items-center justify-center text-base font-bold bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)]"
          >
            RIGHT ▶
          </TouchControlBtn>
        </div>
      )}
    </div>
  );
}
