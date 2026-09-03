import * as React from 'react';
import { useRoom } from '../net/socket.js';
import { sfx, bgm } from '../ui/sound.js';
import { SEAT_COLORS, resolvePlayer, type PlayerLike } from '../ui/seat.js';
import type {
  SpaceInvadersView,
  SpaceInvadersPublicPlayer,
  SpaceInvadersAction,
  Alien,
  Bunker,
  Bullet,
  AlienBomb,
  UFO,
  SpaceInvadersConfig,
} from '@puzzle-arena/games';
const PLAYFIELD_W = 64;
const PLAYFIELD_H = 32;
const CANVAS_SCALE = 10; // 640 x 320 px internal canvas resolution
const CW = PLAYFIELD_W * CANVAS_SCALE;
const CH = PLAYFIELD_H * CANVAS_SCALE;

// Palette (CRT retro vibe)
const COLOR_BG = '#090b14';
const COLOR_GRID = '#11162b';
const COLOR_PLAYER = '#2ee66b';
const COLOR_PLAYER_CANNON = '#ffffff';
const COLOR_BULLET = '#ffd426';
const COLOR_BOMB = '#ff3f8e';
const COLOR_BUNKER = '#2ee66b';
const COLOR_BUNKER_DMG = '#090b14';
const COLOR_UFO = '#ff3344';
const COLOR_SQUID = '#ff3f8e'; // row 0: top magenta
const COLOR_CRAB = '#22e0ff'; // row 1, 2: mid cyan
const COLOR_OCTOPUS = '#9dff3c'; // row 3, 4: bot lime

/**
 * 2-frame retro sprite renderer for Squid (3x1 cells / 30x10px)
 */
function drawSquid(ctx: CanvasRenderingContext2D, x: number, y: number, frame: 0 | 1) {
  ctx.fillStyle = COLOR_SQUID;
  // Frame 0: tentacles inward / Frame 1: tentacles flared
  // Body center
  ctx.fillRect(x + 7, y + 1, 16, 6);
  // Head dome
  ctx.fillRect(x + 10, y, 10, 2);
  // Eyes (cutouts)
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(x + 10, y + 3, 2, 2);
  ctx.fillRect(x + 18, y + 3, 2, 2);
  ctx.fillStyle = COLOR_SQUID;
  if (frame === 0) {
    // Tentacles down & in
    ctx.fillRect(x + 8, y + 7, 3, 3);
    ctx.fillRect(x + 14, y + 7, 2, 3);
    ctx.fillRect(x + 19, y + 7, 3, 3);
    ctx.fillRect(x + 5, y + 3, 2, 3);
    ctx.fillRect(x + 23, y + 3, 2, 3);
  } else {
    // Tentacles out & flared
    ctx.fillRect(x + 6, y + 7, 3, 3);
    ctx.fillRect(x + 13, y + 7, 4, 2);
    ctx.fillRect(x + 21, y + 7, 3, 3);
    ctx.fillRect(x + 4, y + 2, 3, 3);
    ctx.fillRect(x + 23, y + 2, 3, 3);
  }
}

/**
 * 2-frame retro sprite renderer for Crab (3x1 cells / 30x10px)
 */
function drawCrab(ctx: CanvasRenderingContext2D, x: number, y: number, frame: 0 | 1) {
  ctx.fillStyle = COLOR_CRAB;
  // Main body
  ctx.fillRect(x + 6, y + 2, 18, 5);
  // Eyes
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(x + 9, y + 3, 3, 2);
  ctx.fillRect(x + 18, y + 3, 3, 2);
  ctx.fillStyle = COLOR_CRAB;
  if (frame === 0) {
    // Claws up, feet out
    ctx.fillRect(x + 4, y + 0, 3, 3);
    ctx.fillRect(x + 23, y + 0, 3, 3);
    ctx.fillRect(x + 5, y + 7, 4, 3);
    ctx.fillRect(x + 21, y + 7, 4, 3);
    ctx.fillRect(x + 13, y + 7, 4, 2);
  } else {
    // Claws down, feet in
    ctx.fillRect(x + 4, y + 4, 3, 3);
    ctx.fillRect(x + 23, y + 4, 3, 3);
    ctx.fillRect(x + 8, y + 7, 3, 3);
    ctx.fillRect(x + 19, y + 7, 3, 3);
    ctx.fillRect(x + 11, y + 0, 8, 2);
  }
}

/**
 * 2-frame retro sprite renderer for Octopus (3x1 cells / 30x10px)
 */
function drawOctopus(ctx: CanvasRenderingContext2D, x: number, y: number, frame: 0 | 1) {
  ctx.fillStyle = COLOR_OCTOPUS;
  // Broad head
  ctx.fillRect(x + 7, y + 0, 16, 6);
  // Brow notch
  ctx.fillRect(x + 5, y + 2, 20, 4);
  // Eyes
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(x + 8, y + 3, 3, 2);
  ctx.fillRect(x + 19, y + 3, 3, 2);
  ctx.fillStyle = COLOR_OCTOPUS;
  if (frame === 0) {
    // 4 wavy legs open
    ctx.fillRect(x + 4, y + 6, 3, 4);
    ctx.fillRect(x + 10, y + 6, 3, 3);
    ctx.fillRect(x + 17, y + 6, 3, 3);
    ctx.fillRect(x + 23, y + 6, 3, 4);
  } else {
    // 4 wavy legs folded in
    ctx.fillRect(x + 7, y + 6, 3, 4);
    ctx.fillRect(x + 12, y + 6, 6, 3);
    ctx.fillRect(x + 20, y + 6, 3, 4);
    ctx.fillRect(x + 3, y + 3, 2, 3);
    ctx.fillRect(x + 25, y + 3, 2, 3);
  }
}

/**
 * Draw player tank (3x1 cells / 30x10px)
 */
function drawPlayerShip(ctx: CanvasRenderingContext2D, px: number, py: number) {
  const x = px * CANVAS_SCALE;
  const y = py * CANVAS_SCALE;
  ctx.fillStyle = COLOR_PLAYER;
  // Base tread
  ctx.fillRect(x + 2, y + 5, 26, 5);
  // Body armor
  ctx.fillRect(x + 5, y + 2, 20, 4);
  // Turret base
  ctx.fillRect(x + 11, y, 8, 3);
  // Cannon barrel
  ctx.fillStyle = COLOR_PLAYER_CANNON;
  ctx.fillRect(x + 13, y - 3, 4, 4);
}

/**
 * Draw UFO (4x1 cells / 40x10px)
 */
function drawUfo(ctx: CanvasRenderingContext2D, ux: number, uy: number) {
  const x = ux * CANVAS_SCALE;
  const y = uy * CANVAS_SCALE;
  ctx.fillStyle = COLOR_UFO;
  // Saucer dome
  ctx.fillRect(x + 14, y, 12, 3);
  // Saucer ridge
  ctx.fillRect(x + 6, y + 3, 28, 4);
  // Bottom disc
  ctx.fillRect(x + 2, y + 5, 36, 3);
  // Blinking navigation pods
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 8, y + 6, 3, 2);
  ctx.fillRect(x + 18, y + 6, 4, 2);
  ctx.fillRect(x + 29, y + 6, 3, 2);
}

/**
 * Master playfield render routine: draws on any canvas context.
 */
export function renderPlayfieldCanvas(
  ctx: CanvasRenderingContext2D,
  player: SpaceInvadersPublicPlayer,
  width: number,
  height: number,
) {
  const scaleX = width / PLAYFIELD_W;
  const scaleY = height / PLAYFIELD_H;

  ctx.save();
  ctx.scale(scaleX / CANVAS_SCALE, scaleY / CANVAS_SCALE);

  // 1. Clear background
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, CW, CH);

  // Subtle starry background dots
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  const starCoords: [number, number][] = [
    [10, 15], [30, 40], [90, 20], [150, 70], [220, 30], [310, 80],
    [380, 25], [440, 90], [520, 35], [580, 75], [70, 180], [180, 210],
    [260, 170], [340, 200], [420, 160], [500, 220], [600, 190],
  ];
  for (const star of starCoords) {
    ctx.fillRect(star[0], star[1], 2, 2);
  }

  // 2. Bunkers (4 bunkers, 8x7 mask)
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
            // Subtle brick detail highlight
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillRect(bx + c * CANVAS_SCALE, by + r * CANVAS_SCALE, CANVAS_SCALE, 2);
          }
        }
      }
    }
  }

  // 3. Aliens (squid / crab / octopus) with 2-frame animation based on formation march parity
  const frame: 0 | 1 = Math.abs(player.formationX) % 2 === 0 ? 0 : 1;
  if (player.aliens) {
    for (const alien of player.aliens) {
      if (!alien.alive) continue;
      const ax = (player.formationX + alien.col * 4) * CANVAS_SCALE;
      const ay = (player.formationY + alien.row * 2) * CANVAS_SCALE;

      if (alien.type === 'squid') {
        drawSquid(ctx, ax, ay, frame);
      } else if (alien.type === 'crab') {
        drawCrab(ctx, ax, ay, frame);
      } else {
        drawOctopus(ctx, ax, ay, frame);
      }
    }
  }

  // 4. UFO
  if (player.ufo && player.ufo.alive) {
    drawUfo(ctx, player.ufo.x, player.ufo.y);
  }

  // 5. Player Ship
  if (!player.gameOver) {
    drawPlayerShip(ctx, player.playerX, player.playerY);
  }

  // 6. Player Bullet
  const bullet = player.bullet ?? player.bullets?.[0] ?? null;
  if (bullet) {
    const x = bullet.x * CANVAS_SCALE + 4;
    const y = bullet.y * CANVAS_SCALE;
    ctx.fillStyle = COLOR_BULLET;
    ctx.fillRect(x, y - 2, 2, CANVAS_SCALE + 2);
    // Glow tip
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 1, y - 3, 4, 3);
  }

  // 7. Alien Bombs (zig-zag spikes)
  if (player.alienBombs) {
    ctx.fillStyle = COLOR_BOMB;
    for (const bomb of player.alienBombs) {
      const bx = bomb.x * CANVAS_SCALE + 4;
      const by = bomb.y * CANVAS_SCALE;
      // Zig zag shape
      ctx.fillRect(bx, by, 3, 3);
      ctx.fillRect(bx + (frame === 0 ? 2 : -2), by + 3, 3, 3);
      ctx.fillRect(bx, by + 6, 3, 4);
    }
  }

  // 8. Ground defense line
  ctx.fillStyle = 'rgba(46, 230, 107, 0.4)';
  ctx.fillRect(0, 31 * CANVAS_SCALE + 8, CW, 2);

  ctx.restore();
}

/**
 * Mobile instant press button with optional auto-repeat
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
      className={`touch-none select-none font-display text-xs border-2 border-pa-border active:translate-y-0.5 transition-colors ${className ?? ''} ${
        pressed ? 'bg-pa-surface-2 border-pa-cyan text-pa-cyan' : 'bg-pa-surface text-pa-ink'
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
    <svg width={16} height={10} viewBox="0 0 16 10" aria-hidden="true" className="inline-block">
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
          height={96}
          className="block w-[192px] h-[96px]"
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
  legalActions,
  turnEndsAt: _turnEndsAt,
  onAction,
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
  const actionRef = React.useRef<(a: SpaceInvadersAction) => void>(onAction);
  actionRef.current = onAction;

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Play BGM on mount, stop on unmount
  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);

  // Track previous kills / waves / score for sound effects
  const prevKilledRef = React.useRef(you?.aliveCount ?? 55);
  const prevWaveRef = React.useRef(you?.wave ?? 1);
  const prevScoreRef = React.useRef(you?.score ?? 0);

  const [waveClearFlash, setWaveClearFlash] = React.useState(false);

  React.useEffect(() => {
    if (!you) return;
    // Alien killed sound
    if (you.aliveCount < prevKilledRef.current) {
      sfx.bomb();
      prevKilledRef.current = you.aliveCount;
    } else if (you.aliveCount > prevKilledRef.current) {
      prevKilledRef.current = you.aliveCount;
    }

    // Wave progression sound & banner
    if (you.wave > prevWaveRef.current) {
      prevWaveRef.current = you.wave;
      setWaveClearFlash(true);
      sfx.correct();
      const t = window.setTimeout(() => setWaveClearFlash(false), 1800);
      return () => window.clearTimeout(t);
    }

    // Score gain (e.g. UFO hit)
    if (you.score > prevScoreRef.current + 40) {
      sfx.tembak();
    }
    prevScoreRef.current = you.score;
  }, [you?.aliveCount, you?.wave, you?.score, you]);

  // Redraw canvas whenever 'you' updates
  React.useEffect(() => {
    if (!you) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderPlayfieldCanvas(ctx, you, canvas.width, canvas.height);
  }, [you]);

  // Client tick loop dispatching { type: 'tick' } every config.tickMs
  const tickMs = view.config?.tickMs ?? 60;
  React.useEffect(() => {
    if (!you || you.gameOver || view.phase === 'game_over' || paused) return;
    const interval = window.setInterval(() => {
      actionRef.current({ type: 'tick' });
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
        actionRef.current({ type: 'move', dir: 'left' });
        sfx.blip();
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        actionRef.current({ type: 'move', dir: 'right' });
        sfx.blip();
        return;
      }

      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (e.repeat) return; // Enforce one-shot on single key press
        if (legalActions && !legalActions.includes('fire')) return;
        actionRef.current({ type: 'fire' });
        sfx.tembak();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [you?.gameOver, view.phase, legalActions, you]);

  // Touch on the canvas play area: left half moves left, right half moves right, center taps fire
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!you || you.gameOver || view.phase === 'game_over') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;

    if (relX < 0.38) {
      actionRef.current({ type: 'move', dir: 'left' });
      sfx.blip();
    } else if (relX > 0.62) {
      actionRef.current({ type: 'move', dir: 'right' });
      sfx.blip();
    } else {
      actionRef.current({ type: 'fire' });
      sfx.tembak();
    }
  };

  // Spectator branch when !you
  if (!you) {
    const playerList = (players as PlayerLike[]) ?? [];
    const activePlayers = view.players.filter((p) => !p.gameOver);
    const spectated = activePlayers.length > 0 ? activePlayers : view.players;

    return (
      <div className="w-full h-full overflow-auto p-3 sm:p-4">
        <div className="text-center font-display text-xs tracking-widest text-pa-ink-dim mb-4">
          SPACE INVADERS · SPECTATING
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

  return (
    <div className="w-full h-full flex flex-col items-center justify-between p-2 sm:p-4 max-w-4xl mx-auto touch-none select-none">
      {/* Top HUD */}
      <div className="w-full max-w-2xl flex items-center justify-between px-3 py-2 bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)] mb-2">
        {/* Score & Wave */}
        <div className="flex items-center gap-4 font-display">
          <div>
            <div className="text-[10px] text-pa-ink-dim uppercase tracking-wider">SCORE</div>
            <div className="text-base sm:text-lg text-pa-cyan font-bold tabular leading-none">
              {String(you.score).padStart(5, '0')}
            </div>
          </div>
          <div className="border-l-2 border-pa-border pl-3">
            <div className="text-[10px] text-pa-ink-dim uppercase tracking-wider">WAVE</div>
            <div className="text-base sm:text-lg text-pa-ink font-bold tabular leading-none">
              {you.wave}
            </div>
          </div>
        </div>

        {/* Lives counter with ship icons */}
        <div className="flex flex-col items-end font-display">
          <div className="text-[10px] text-pa-ink-dim uppercase tracking-wider mb-0.5">SHIPS</div>
          <div className="flex items-center gap-1.5 h-4">
            {Array.from({ length: Math.max(0, you.lives) }).map((_, i) => (
              <MiniShipIcon key={i} color="#2ee66b" />
            ))}
            {you.lives <= 0 && <span className="text-[10px] text-pa-danger font-bold">CRITICAL</span>}
          </div>
        </div>
      </div>

      {/* Main Playfield Canvas Area */}
      <div className="relative w-full max-w-2xl aspect-[2/1] bg-pa-bg border-4 border-pa-border shadow-[4px_4px_0_var(--color-pa-shadow)] overflow-hidden">
        <canvas
          ref={canvasRef}
          width={CW}
          height={CH}
          onPointerDown={handleCanvasPointerDown}
          className="w-full h-full block cursor-crosshair"
          style={{ imageRendering: 'pixelated' }}
        />

        {/* Wave Cleared Flash banner */}
        {waveClearFlash && (
          <div className="absolute inset-0 bg-pa-bg/75 flex flex-col items-center justify-center animate-pulse pointer-events-none">
            <div className="font-display text-pa-cyan text-xl sm:text-2xl font-bold tracking-widest drop-shadow-[0_0_8px_rgba(34,224,255,0.8)]">
              WAVE CLEARED!
            </div>
            <div className="font-display text-pa-ink text-xs sm:text-sm mt-1">
              PREPARE FOR WAVE {you.wave}
            </div>
          </div>
        )}

        {/* Game Over Overlay */}
        {isGameOver && (
          <div className="absolute inset-0 bg-pa-bg/85 flex flex-col items-center justify-center p-4">
            <div className="font-display text-pa-danger text-2xl sm:text-3xl font-bold tracking-widest mb-2 animate-bounce">
              GAME OVER
            </div>
            <div className="font-display text-pa-ink text-sm sm:text-base mb-1">
              FINAL SCORE: <span className="text-pa-cyan font-bold">{you.score}</span>
            </div>
            <div className="font-display text-pa-ink-dim text-xs">
              SURVIVED TO WAVE {you.wave}
            </div>
          </div>
        )}
      </div>

      {/* Opponents Mini Strip (Tetris-style leaderboard) */}
      {opponents.length > 0 && (
        <div className="w-full max-w-2xl flex items-center gap-2 overflow-x-auto py-1 mt-2">
          {opponents.map((opp) => {
            const info = resolvePlayer(playerList, opp.id);
            const color = SEAT_COLORS[opp.seat % SEAT_COLORS.length] ?? '#2ee66b';
            return (
              <div
                key={opp.id}
                className="flex items-center gap-2 px-2 py-1 bg-pa-surface border-2 border-pa-border shrink-0 text-xs font-display"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="font-bold truncate max-w-[80px]">{info.displayName}</span>
                <span className="text-pa-cyan tabular">{opp.score}</span>
                {opp.gameOver ? (
                  <span className="text-pa-danger text-[9px]">OUT</span>
                ) : (
                  <span className="text-pa-ink-dim text-[9px]">W{opp.wave}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mobile Touch Action Controls (Left / Fire / Right) */}
      <div className="w-full max-w-md grid grid-cols-3 gap-2 mt-3 sm:hidden">
        <TouchControlBtn
          label="Move Left"
          onFire={() => {
            actionRef.current({ type: 'move', dir: 'left' });
            sfx.blip();
          }}
          repeatMs={90}
          className="h-12 flex items-center justify-center text-sm font-bold shadow-[2px_2px_0_var(--color-pa-shadow)]"
        >
          ◀ LEFT
        </TouchControlBtn>

        <TouchControlBtn
          label="Fire Cannon"
          onFire={() => {
            actionRef.current({ type: 'fire' });
            sfx.tembak();
          }}
          className="h-12 flex items-center justify-center text-sm font-bold bg-pa-surface-2 border-pa-danger text-pa-danger shadow-[2px_2px_0_var(--color-pa-shadow)]"
        >
          🔥 FIRE
        </TouchControlBtn>

        <TouchControlBtn
          label="Move Right"
          onFire={() => {
            actionRef.current({ type: 'move', dir: 'right' });
            sfx.blip();
          }}
          repeatMs={90}
          className="h-12 flex items-center justify-center text-sm font-bold shadow-[2px_2px_0_var(--color-pa-shadow)]"
        >
          RIGHT ▶
        </TouchControlBtn>
      </div>
    </div>
  );
}
