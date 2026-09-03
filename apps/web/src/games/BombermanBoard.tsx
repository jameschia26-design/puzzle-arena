import * as React from 'react';
import { useRoom } from '../net/socket.js';
import { sfx, bgm } from '../ui/sound.js';
import { SEAT_COLORS, resolvePlayer, monogram, type PlayerLike } from '../ui/seat.js';

import type {
  BombermanView,
  BombermanPublicPlayer,
  BombermanAction,
  PowerUpItem,
  PowerUpKind,
  Dir,
} from '@puzzle-arena/games';

/* ------------------------------------------------------------------ */
/* Constants & Engine Geometry                                        */
/* ------------------------------------------------------------------ */

const ARENA_W = 15;
const ARENA_H = 13;
const ARENA_SIZE = ARENA_W * ARENA_H;
const TILE_PX = 16;
const NATIVE_W = ARENA_W * TILE_PX; // 240 px
const NATIVE_H = ARENA_H * TILE_PX; // 208 px

const TILE_EMPTY = 0;
const TILE_HARD = 1;
const TILE_SOFT = 2;

type BlastSpriteType = 'center' | 'arm_h' | 'arm_v' | 'end_up' | 'end_down' | 'end_left' | 'end_right';

interface FloatingPopup {
  id: number;
  text: string;
  color: string;
  gx: number;
  gy: number;
  born: number;
}

/* ------------------------------------------------------------------ */
/* Retro 16x16 Pixel Sprite Drawing Functions                         */
/* ------------------------------------------------------------------ */

/**
 * Floor tile: Classic emerald green checkerboard turf with subtle border highlights
 */
function drawFloorTile(ctx: CanvasRenderingContext2D, px: number, py: number, gx: number, gy: number): void {
  const isEven = (gx + gy) % 2 === 0;
  ctx.fillStyle = isEven ? '#449e38' : '#3c8c30';
  ctx.fillRect(px, py, TILE_PX, TILE_PX);

  // Top/left highlight
  ctx.fillStyle = isEven ? '#52b844' : '#489e3a';
  ctx.fillRect(px, py, TILE_PX, 1);
  ctx.fillRect(px, py, 1, TILE_PX);

  // Bottom/right shadow
  ctx.fillStyle = isEven ? '#38882e' : '#307426';
  ctx.fillRect(px, py + TILE_PX - 1, TILE_PX, 1);
  ctx.fillRect(px + TILE_PX - 1, py, 1, TILE_PX);

  // Subtle turf texture dots
  ctx.fillStyle = isEven ? '#4cb03e' : '#36802c';
  ctx.fillRect(px + 4, py + 4, 1, 1);
  ctx.fillRect(px + 11, py + 4, 1, 1);
  ctx.fillRect(px + 4, py + 11, 1, 1);
  ctx.fillRect(px + 11, py + 11, 1, 1);
}

/**
 * Hard Block: Indestructible cross-hatch metal pillar with 3D bevel and corner rivets
 */
function drawHardBlock(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  // Outer metallic rim
  ctx.fillStyle = '#101828';
  ctx.fillRect(px, py, TILE_PX, TILE_PX);

  // Top-left 3D highlight
  ctx.fillStyle = '#98b4d8';
  ctx.fillRect(px, py, TILE_PX - 1, 1);
  ctx.fillRect(px, py, 1, TILE_PX - 1);

  // Inner beveled face
  ctx.fillStyle = '#3a5078';
  ctx.fillRect(px + 2, py + 2, 12, 12);

  // Cross recess slots
  ctx.fillStyle = '#1a263c';
  ctx.fillRect(px + 7, py + 4, 2, 8); // vertical groove
  ctx.fillRect(px + 4, py + 7, 8, 2); // horizontal groove

  // Groove highlights
  ctx.fillStyle = '#5274a4';
  ctx.fillRect(px + 6, py + 4, 1, 8);
  ctx.fillRect(px + 4, py + 6, 8, 1);

  // 4 Corner metal rivets
  const rivets = [
    [3, 3],
    [11, 3],
    [3, 11],
    [11, 11],
  ];
  for (const [rx, ry] of rivets) {
    ctx.fillStyle = '#141c2c';
    ctx.fillRect(px + rx, py + ry, 2, 2);
    ctx.fillStyle = '#c0d8f8';
    ctx.fillRect(px + rx, py + ry, 1, 1);
  }
}

/**
 * Soft Block: Destructible terracotta brick wall with mortar grooves
 */
function drawSoftBlock(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  // Mortar background
  ctx.fillStyle = '#261008';
  ctx.fillRect(px, py, TILE_PX, TILE_PX);

  const drawBrick = (bx: number, by: number, bw: number, bh: number) => {
    // Shadow base
    ctx.fillStyle = '#682010';
    ctx.fillRect(px + bx, py + by, bw, bh);
    // Body
    ctx.fillStyle = '#9c401c';
    ctx.fillRect(px + bx, py + by, bw, bh - 1);
    // Top highlight
    ctx.fillStyle = '#cf6030';
    ctx.fillRect(px + bx, py + by, bw, 1);
    // Left edge highlight
    ctx.fillRect(px + bx, py + by, 1, bh - 1);
  };

  // Row 0: 2 bricks
  drawBrick(1, 1, 6, 3);
  drawBrick(8, 1, 7, 3);

  // Row 1: staggered bricks
  drawBrick(1, 5, 3, 3);
  drawBrick(5, 5, 6, 3);
  drawBrick(12, 5, 3, 3);

  // Row 2: 2 bricks
  drawBrick(1, 9, 6, 3);
  drawBrick(8, 9, 7, 3);

  // Row 3: staggered bricks
  drawBrick(1, 13, 3, 2);
  drawBrick(5, 13, 6, 2);
  drawBrick(12, 13, 3, 2);
}

/**
 * Classic Powerup Badge: Glowing retro icon on a dark beveled pedestal
 */
function drawPowerup(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  kind: PowerUpKind,
  timeMs: number
): void {
  // Gentle floating bob
  const bob = Math.round(Math.sin(timeMs / 180) * 1.5);
  const by = py + bob;

  // Dark beveled pedestal
  ctx.fillStyle = '#0c1020';
  ctx.fillRect(px + 1, by + 1, 14, 14);
  ctx.fillStyle = '#223050';
  ctx.fillRect(px + 2, by + 2, 12, 12);
  ctx.fillStyle = '#486494';
  ctx.fillRect(px + 1, by + 1, 13, 1);
  ctx.fillRect(px + 1, by + 1, 1, 13);

  switch (kind) {
    case 'flame': {
      // Fiery flame icon (Yellow core, orange body, red border)
      ctx.fillStyle = '#e81e10';
      ctx.fillRect(px + 7, by + 3, 2, 3);
      ctx.fillRect(px + 5, by + 5, 6, 7);
      ctx.fillRect(px + 4, by + 7, 8, 4);

      ctx.fillStyle = '#ff8810';
      ctx.fillRect(px + 7, by + 4, 2, 3);
      ctx.fillRect(px + 6, by + 6, 4, 5);

      ctx.fillStyle = '#fff030';
      ctx.fillRect(px + 7, by + 7, 2, 4);
      break;
    }
    case 'bomb': {
      // Classic bomb icon with '1' badge
      ctx.fillStyle = '#10141e';
      ctx.beginPath();
      ctx.arc(px + 8, by + 9, 5, 0, Math.PI * 2);
      ctx.fill();

      // Fuse spark
      ctx.fillStyle = '#f0a020';
      ctx.fillRect(px + 7, by + 3, 2, 2);
      ctx.fillStyle = '#ffe030';
      ctx.fillRect(px + 9, by + 2, 2, 2);

      // White shine
      ctx.fillStyle = '#80a0d0';
      ctx.fillRect(px + 6, by + 7, 2, 2);

      // Gold '1'
      ctx.fillStyle = '#ffd020';
      ctx.fillRect(px + 8, by + 7, 1, 4);
      ctx.fillRect(px + 7, by + 8, 1, 1);
      ctx.fillRect(px + 7, by + 10, 3, 1);
      break;
    }
    case 'speed': {
      // Golden winged roller skate
      ctx.fillStyle = '#ffd020';
      ctx.fillRect(px + 5, by + 7, 6, 4);
      ctx.fillRect(px + 3, by + 9, 8, 2);

      // Wing feathers
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 7, by + 4, 4, 2);
      ctx.fillRect(px + 9, by + 3, 3, 2);
      ctx.fillRect(px + 5, by + 5, 3, 2);

      // Wheels
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(px + 4, by + 11, 2, 2);
      ctx.fillRect(px + 8, by + 11, 2, 2);
      break;
    }
    case 'pass': {
      // Ghost / pass-through phantom silhouette
      ctx.fillStyle = '#b070f8';
      ctx.beginPath();
      ctx.arc(px + 8, by + 6, 4, Math.PI, 0);
      ctx.lineTo(px + 12, by + 11);
      ctx.lineTo(px + 10, by + 10);
      ctx.lineTo(px + 8, by + 11);
      ctx.lineTo(px + 6, by + 10);
      ctx.lineTo(px + 4, by + 11);
      ctx.closePath();
      ctx.fill();

      // Ghost eyes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 6, by + 6, 1, 2);
      ctx.fillRect(px + 9, by + 6, 1, 2);
      break;
    }
  }
}

/**
 * Bomb Sprite: 3D round sphere, pulsating urgency crimson blink on last 6 ticks, animated fuse spark
 */
function drawBomb(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  fuse: number,
  timeMs: number
): void {
  const isUrgent = fuse <= 6;
  const blinkRed = isUrgent && Math.floor(timeMs / 100) % 2 === 0;

  // Center of the 16x16 cell
  const cx = px + 8;
  const cy = py + 9;
  const radius = isUrgent ? 5.5 + Math.sin(timeMs / 60) * 0.5 : 5.5;

  // Drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 5, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bomb sphere body
  ctx.fillStyle = blinkRed ? '#ff2040' : '#141724';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // 3D Sphere outline & shading
  ctx.strokeStyle = blinkRed ? '#ffffff' : '#3a4460';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Specular shine glint
  ctx.fillStyle = blinkRed ? '#ffffff' : '#88a4d4';
  ctx.fillRect(cx - 3, cy - 3, 2, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 3, cy - 3, 1, 1);

  // Top brass collar
  ctx.fillStyle = '#d49818';
  ctx.fillRect(cx - 1.5, cy - radius - 1.5, 3, 2);

  // Curved fuse string
  ctx.strokeStyle = '#c4aa80';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius - 1);
  ctx.quadraticCurveTo(cx + 2, cy - radius - 3, cx + 4, cy - radius - 2);
  ctx.stroke();

  // Animated Fuse Spark (2 alternating frames)
  const sparkFrame = Math.floor(timeMs / 90) % 2;
  const sx = cx + 4;
  const sy = cy - radius - 2;

  if (sparkFrame === 0) {
    ctx.fillStyle = '#fff030';
    ctx.fillRect(sx - 1, sy - 1, 3, 3);
    ctx.fillStyle = '#ff6010';
    ctx.fillRect(sx, sy - 2, 1, 1);
    ctx.fillRect(sx + 2, sy, 1, 1);
    ctx.fillRect(sx - 2, sy + 1, 1, 1);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx, sy, 2, 2);
    ctx.fillStyle = '#ff8810';
    ctx.fillRect(sx - 2, sy - 1, 2, 2);
    ctx.fillRect(sx + 1, sy - 2, 2, 1);
    ctx.fillRect(sx + 1, sy + 1, 1, 2);
  }
}

/**
 * Explosion Blast Sprite: Authentic 5-part multi-frame flame burst
 */
function drawBlast(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  type: BlastSpriteType,
  ticksRemaining: number,
  timeMs: number
): void {
  // 3-frame animated flame ripple
  const flameFrame = Math.floor(timeMs / 70) % 3;
  const opacity = Math.min(1, Math.max(0.5, ticksRemaining / 3));
  ctx.save();
  ctx.globalAlpha = opacity;

  // Colors
  const cCore = '#ffffff'; // laser white core
  const cMid = '#ffe020';  // bright flame yellow
  const cOuter = '#ff5500'; // intense orange
  const cEdge = '#cc1100';  // dark flame red

  switch (type) {
    case 'center': {
      // 4-way blast hub
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 1, py + 1, 14, 14);

      ctx.fillStyle = cOuter;
      ctx.fillRect(px + 2, py + 2, 12, 12);
      if (flameFrame === 0) {
        ctx.fillRect(px, py + 4, 16, 8);
        ctx.fillRect(px + 4, py, 8, 16);
      } else {
        ctx.fillRect(px + 1, py + 5, 14, 6);
        ctx.fillRect(px + 5, py + 1, 6, 14);
      }

      ctx.fillStyle = cMid;
      ctx.fillRect(px + 4, py + 4, 8, 8);

      ctx.fillStyle = cCore;
      ctx.fillRect(px + 6, py + 6, 4, 4);
      break;
    }
    case 'arm_h': {
      // Horizontal flame corridor
      ctx.fillStyle = cEdge;
      ctx.fillRect(px, py + 3, TILE_PX, 10);

      ctx.fillStyle = cOuter;
      const ripple = flameFrame === 1 ? 1 : 0;
      ctx.fillRect(px, py + 4 + ripple, TILE_PX, 8 - ripple * 2);

      ctx.fillStyle = cMid;
      ctx.fillRect(px, py + 6, TILE_PX, 4);

      ctx.fillStyle = cCore;
      ctx.fillRect(px, py + 7, TILE_PX, 2);
      break;
    }
    case 'arm_v': {
      // Vertical flame corridor
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 3, py, 10, TILE_PX);

      ctx.fillStyle = cOuter;
      const ripple = flameFrame === 1 ? 1 : 0;
      ctx.fillRect(px + 4 + ripple, py, 8 - ripple * 2, TILE_PX);

      ctx.fillStyle = cMid;
      ctx.fillRect(px + 6, py, 4, TILE_PX);

      ctx.fillStyle = cCore;
      ctx.fillRect(px + 7, py, 2, TILE_PX);
      break;
    }
    case 'end_up': {
      // Rounded flame cap pointing up
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 3, py + 4, 10, 12);
      ctx.fillRect(px + 5, py + 2, 6, 4);
      ctx.fillRect(px + 7, py + 1, 2, 2);

      ctx.fillStyle = cOuter;
      ctx.fillRect(px + 4, py + 5, 8, 11);
      ctx.fillRect(px + 6, py + 3, 4, 4);

      ctx.fillStyle = cMid;
      ctx.fillRect(px + 6, py + 6, 4, 10);

      ctx.fillStyle = cCore;
      ctx.fillRect(px + 7, py + 8, 2, 8);
      break;
    }
    case 'end_down': {
      // Rounded flame cap pointing down
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 3, py, 10, 12);
      ctx.fillRect(px + 5, py + 10, 6, 4);
      ctx.fillRect(px + 7, py + 13, 2, 2);

      ctx.fillStyle = cOuter;
      ctx.fillRect(px + 4, py, 8, 11);
      ctx.fillRect(px + 6, py + 9, 4, 4);

      ctx.fillStyle = cMid;
      ctx.fillRect(px + 6, py, 4, 10);

      ctx.fillStyle = cCore;
      ctx.fillRect(px + 7, py, 2, 8);
      break;
    }
    case 'end_left': {
      // Rounded flame cap pointing left
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 4, py + 3, 12, 10);
      ctx.fillRect(px + 2, py + 5, 4, 6);
      ctx.fillRect(px + 1, py + 7, 2, 2);

      ctx.fillStyle = cOuter;
      ctx.fillRect(px + 5, py + 4, 11, 8);
      ctx.fillRect(px + 3, py + 6, 4, 4);

      ctx.fillStyle = cMid;
      ctx.fillRect(px + 6, py + 6, 10, 4);

      ctx.fillStyle = cCore;
      ctx.fillRect(px + 8, py + 7, 8, 2);
      break;
    }
    case 'end_right': {
      // Rounded flame cap pointing right
      ctx.fillStyle = cEdge;
      ctx.fillRect(px, py + 3, 12, 10);
      ctx.fillRect(px + 10, py + 5, 4, 6);
      ctx.fillRect(px + 13, py + 7, 2, 2);

      ctx.fillStyle = cOuter;
      ctx.fillRect(px, py + 4, 11, 8);
      ctx.fillRect(px + 9, py + 6, 4, 4);

      ctx.fillStyle = cMid;
      ctx.fillRect(px, py + 6, 10, 4);

      ctx.fillStyle = cCore;
      ctx.fillRect(px, py + 7, 8, 2);
      break;
    }
  }

  ctx.restore();
}

/**
 * Authentic Bomberman Player Silhouette: White helmet, pink antenna ball, pink face,
 * distinct seat-colored suit, belt, boots, and 4-directional poses.
 */
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  player: BombermanPublicPlayer,
  isYou: boolean,
  facing: Dir,
  timeMs: number
): void {
  const seatColor = SEAT_COLORS[player.seat % SEAT_COLORS.length] ?? '#2ee66b';

  // Dead Player: Cute floating ghost silhouette
  if (!player.alive || player.gameOver) {
    const floatY = Math.round(Math.sin(timeMs / 200) * 1.5);
    const gy = py + floatY;

    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#d0e4ff';
    ctx.beginPath();
    ctx.arc(px + 8, gy + 6, 5, Math.PI, 0);
    ctx.lineTo(px + 13, gy + 12);
    ctx.lineTo(px + 11, gy + 10);
    ctx.lineTo(px + 8, gy + 12);
    ctx.lineTo(px + 5, gy + 10);
    ctx.lineTo(px + 3, gy + 12);
    ctx.closePath();
    ctx.fill();

    // Angel halo
    ctx.strokeStyle = '#ffd820';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(px + 8, gy + 1, 4, 1.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Ghost dead 'X' eyes
    ctx.strokeStyle = '#203050';
    ctx.beginPath();
    ctx.moveTo(px + 5, gy + 5);
    ctx.lineTo(px + 7, gy + 7);
    ctx.moveTo(px + 7, gy + 5);
    ctx.lineTo(px + 5, gy + 7);
    ctx.moveTo(px + 9, gy + 5);
    ctx.lineTo(px + 11, gy + 7);
    ctx.moveTo(px + 11, gy + 5);
    ctx.lineTo(px + 9, gy + 7);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Walk bob animation
  const bob = Math.floor(timeMs / 150) % 2 === 0 ? 0 : 1;

  // Drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.ellipse(px + 8, py + 14, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // 1. Antenna Ball (Pompom)
  ctx.fillStyle = '#ff4878';
  ctx.fillRect(px + 7, py + 0 + bob, 2, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px + 7, py + 0 + bob, 1, 1);

  // 2. White Helmet Base
  ctx.fillStyle = '#b8c4d8'; // helmet shade
  ctx.fillRect(px + 3, py + 2 + bob, 10, 7);
  ctx.fillStyle = '#f0f4fc'; // helmet main
  ctx.fillRect(px + 4, py + 2 + bob, 8, 7);
  ctx.fillStyle = '#ffffff'; // helmet top shine
  ctx.fillRect(px + 5, py + 2 + bob, 6, 2);

  // 3. Face Plate & Eyes based on facing
  if (facing === 'down') {
    // Front facing
    ctx.fillStyle = '#ffc0a8'; // face visor
    ctx.fillRect(px + 5, py + 4 + bob, 6, 4);

    // Oval black eyes
    ctx.fillStyle = '#101424';
    ctx.fillRect(px + 6, py + 5 + bob, 1, 2);
    ctx.fillRect(px + 9, py + 5 + bob, 1, 2);
    // Eye shines
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 6, py + 5 + bob, 1, 1);
    ctx.fillRect(px + 9, py + 5 + bob, 1, 1);
  } else if (facing === 'up') {
    // Back facing: helmet only with blue-gray collar
    ctx.fillStyle = '#9aaac4';
    ctx.fillRect(px + 5, py + 6 + bob, 6, 2);
  } else if (facing === 'left') {
    // Profile facing left
    ctx.fillStyle = '#ffc0a8';
    ctx.fillRect(px + 4, py + 4 + bob, 5, 4);
    ctx.fillStyle = '#101424';
    ctx.fillRect(px + 5, py + 5 + bob, 1, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 5, py + 5 + bob, 1, 1);
  } else if (facing === 'right') {
    // Profile facing right
    ctx.fillStyle = '#ffc0a8';
    ctx.fillRect(px + 7, py + 4 + bob, 5, 4);
    ctx.fillStyle = '#101424';
    ctx.fillRect(px + 10, py + 5 + bob, 1, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 10, py + 5 + bob, 1, 1);
  }

  // 4. Body Suit (Seat Color)
  ctx.fillStyle = seatColor;
  ctx.fillRect(px + 4, py + 9 + bob, 8, 3);

  // 5. Dark Belt with Gold Buckle
  ctx.fillStyle = '#181824';
  ctx.fillRect(px + 4, py + 12 + bob, 8, 1);
  ctx.fillStyle = '#ffd020';
  ctx.fillRect(px + 7, py + 12 + bob, 2, 1);

  // 6. Boots
  ctx.fillStyle = '#f0f4fc';
  ctx.fillRect(px + 4, py + 13 + bob, 3, 2);
  ctx.fillRect(px + 9, py + 13 + bob, 3, 2);
  ctx.fillStyle = '#181824'; // Soles
  ctx.fillRect(px + 4, py + 15, 3, 1);
  ctx.fillRect(px + 9, py + 15, 3, 1);

  // 7. "YOU" Indicator Arrow
  if (isYou) {
    const arrowY = py - 4 + Math.round(Math.sin(timeMs / 120) * 1.5);
    ctx.fillStyle = '#22e0ff';
    ctx.beginPath();
    ctx.moveTo(px + 8, arrowY + 3);
    ctx.lineTo(px + 5, arrowY);
    ctx.lineTo(px + 11, arrowY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#003050';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* Touch Control Button with hold-to-repeat                           */
/* ------------------------------------------------------------------ */

function TouchButton({
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
      className={`touch-none select-none font-display border-2 border-pa-border active:translate-y-0.5 transition-colors cursor-pointer ${className ?? ''} ${
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

/* ------------------------------------------------------------------ */
/* Main BombermanBoard Component                                      */
/* ------------------------------------------------------------------ */

export function BombermanBoard({
  view,
  players,
  youId,
  legalActions: _legalActions,
  turnEndsAt: _turnEndsAt,
  onAction,
}: {
  view: BombermanView;
  players: unknown;
  youId: string | null;
  legalActions?: string[];
  turnEndsAt?: number | null;
  onAction: (a: BombermanAction) => void;
}): React.ReactElement {
  // Safe defaults for all properties on view
  const safeView = view ?? ({} as Partial<BombermanView>);
  const grid = safeView.grid ?? [];
  const bombs = safeView.bombs ?? [];
  const blasts = safeView.blasts ?? [];
  const viewPlayers = safeView.players ?? [];
  const visiblePowerups = safeView.visiblePowerups ?? [];
  const you = safeView.you ?? null;
  const isGameOver = safeView.phase === 'game_over';

  const paused = useRoom((s) => s.paused);
  const actionRef = React.useRef<(a: BombermanAction) => void>(onAction);
  actionRef.current = onAction;

  const playerList = (players as PlayerLike[]) ?? [];
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Layout sizing state: integer cellSize ensures razor-sharp pixel art
  const [cellSize, setCellSize] = React.useState(28); // default fallback
  const [padAlign, setPadAlign] = React.useState<'left' | 'center' | 'right'>('center');
  const [isLandscape, setIsLandscape] = React.useState(false);

  // Direction facing tracking per player (id -> dir)
  const facingMapRef = React.useRef<Record<string, Dir>>({});
  const lastPlayerPosRef = React.useRef<Record<string, { x: number; y: number }>>({});

  // Screen shake on detonations
  const shakeRef = React.useRef(0);

  // Floating notifications (+1000 KOS, powerup badges)
  const popupsRef = React.useRef<FloatingPopup[]>([]);
  const nextPopupIdRef = React.useRef(1);

  const addPopup = (text: string, color: string, gx: number, gy: number) => {
    popupsRef.current.push({
      id: nextPopupIdRef.current++,
      text,
      color,
      gx,
      gy,
      born: Date.now(),
    });
  };

  // Play BGM on mount, stop on unmount
  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);

  // Update facing direction when players move
  React.useEffect(() => {
    for (const p of viewPlayers) {
      const prev = lastPlayerPosRef.current[p.id];
      if (prev) {
        if (p.x > prev.x) facingMapRef.current[p.id] = 'right';
        else if (p.x < prev.x) facingMapRef.current[p.id] = 'left';
        else if (p.y > prev.y) facingMapRef.current[p.id] = 'down';
        else if (p.y < prev.y) facingMapRef.current[p.id] = 'up';
      }
      lastPlayerPosRef.current[p.id] = { x: p.x, y: p.y };
    }
  }, [viewPlayers]);

  // Audio cues and juice on state transitions
  const prevBombsCount = React.useRef(bombs.length);
  const prevBlastsCount = React.useRef(blasts.length);
  const prevKills = React.useRef(you?.kills ?? 0);
  const prevPowers = React.useRef({
    radius: you?.blastRadius ?? 2,
    bombs: you?.maxBombs ?? 1,
    speed: you?.speed ?? 0,
    pass: you?.hasPass ?? false,
  });

  React.useEffect(() => {
    // Bomb drop
    if (bombs.length > prevBombsCount.current) {
      sfx.drop();
    }
    prevBombsCount.current = bombs.length;

    // Detonation: trigger sound and screen shake
    if (blasts.length > prevBlastsCount.current) {
      sfx.bomb();
      shakeRef.current = Math.min(8, shakeRef.current + 5);
    }
    prevBlastsCount.current = blasts.length;

    if (!you) return;

    // Kill popup & sound
    if (you.kills > prevKills.current) {
      sfx.tembak();
      addPopup('+1000 KOS!', '#22e0ff', you.x, you.y);
      prevKills.current = you.kills;
    }

    // Powerup collection popup & sound
    if (you.blastRadius > prevPowers.current.radius) {
      sfx.extraTurn();
      addPopup('+1 FIRE!', '#ff8810', you.x, you.y);
    } else if (you.maxBombs > prevPowers.current.bombs) {
      sfx.extraTurn();
      addPopup('+1 BOMB!', '#ffd020', you.x, you.y);
    } else if (you.speed > prevPowers.current.speed) {
      sfx.extraTurn();
      addPopup('+1 SPEED!', '#22e0ff', you.x, you.y);
    } else if (!prevPowers.current.pass && you.hasPass) {
      sfx.extraTurn();
      addPopup('PASS THRU!', '#c084fc', you.x, you.y);
    }

    prevPowers.current = {
      radius: you.blastRadius,
      bombs: you.maxBombs,
      speed: you.speed,
      pass: you.hasPass,
    };
  }, [bombs.length, blasts.length, you?.kills, you?.blastRadius, you?.maxBombs, you?.speed, you?.hasPass, you]);

  // Victory / Game over sound
  const gameOverHandled = React.useRef(false);
  React.useEffect(() => {
    if (isGameOver && !gameOverHandled.current) {
      gameOverHandled.current = true;
      if (safeView.winner && safeView.winner === youId) {
        sfx.victory();
      } else {
        sfx.gameOver();
      }
    }
  }, [isGameOver, safeView.winner, youId]);

  // Client tick loop fallback
  const tickMs = safeView.config?.tickMs ?? 60;
  React.useEffect(() => {
    if (!you || !you.alive || isGameOver || paused) return;
    const interval = window.setInterval(() => {
      actionRef.current({ type: 'tick' });
    }, tickMs);
    return () => window.clearInterval(interval);
  }, [you?.alive, isGameOver, paused, tickMs]);

  // Keyboard navigation: WASD / Arrows with repeat, Space for bomb
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          Boolean(target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')))
      ) {
        return;
      }

      if (!you || !you.alive || isGameOver) return;

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          actionRef.current({ type: 'move', dir: 'up' });
          sfx.blip();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          actionRef.current({ type: 'move', dir: 'down' });
          sfx.blip();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          actionRef.current({ type: 'move', dir: 'left' });
          sfx.blip();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          actionRef.current({ type: 'move', dir: 'right' });
          sfx.blip();
          break;
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          if (e.repeat) return;
          actionRef.current({ type: 'bomb' });
          sfx.pop();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [you?.alive, isGameOver, you]);

  // ResizeObserver: compute crisp integer cell size dynamically to fill screen while preserving aspect
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const landscape = w > h * 1.15;
      setIsLandscape(landscape);

      // Reserve space for top HUD (approx 52px) and bottom touch controls (approx 200px in portrait)
      const availW = landscape ? Math.max(180, w - 240) : Math.max(180, w - 16);
      const availH = landscape ? Math.max(160, h - 60) : Math.max(160, h - 260);

      const maxCellW = Math.floor(availW / ARENA_W);
      const maxCellH = Math.floor(availH / ARENA_H);
      const chosen = Math.max(16, Math.min(maxCellW, maxCellH, 52));
      setCellSize(chosen);
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Offscreen 240x208 canvas for pixel-perfect native rendering
  const offscreenRef = React.useRef<HTMLCanvasElement | null>(null);
  if (!offscreenRef.current && typeof document !== 'undefined') {
    const off = document.createElement('canvas');
    off.width = NATIVE_W;
    off.height = NATIVE_H;
    offscreenRef.current = off;
  }

  // Animation render loop for canvas (runs at 60fps)
  React.useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      const offscreen = offscreenRef.current;
      if (!canvas || !offscreen) {
        animId = requestAnimationFrame(render);
        return;
      }

      const octx = offscreen.getContext('2d');
      const ctx = canvas.getContext('2d');
      if (!octx || !ctx) {
        animId = requestAnimationFrame(render);
        return;
      }

      const now = Date.now();

      // 1. Draw Native 240x208 Pixel Art onto offscreen canvas
      octx.clearRect(0, 0, NATIVE_W, NATIVE_H);

      // (a) Base Floor Tiles
      for (let idx = 0; idx < ARENA_SIZE; idx++) {
        const gx = idx % ARENA_W;
        const gy = Math.floor(idx / ARENA_W);
        const px = gx * TILE_PX;
        const py = gy * TILE_PX;
        drawFloorTile(octx, px, py, gx, gy);
      }

      // (b) Visible Powerups on Floor
      for (const p of visiblePowerups) {
        const px = p.x * TILE_PX;
        const py = p.y * TILE_PX;
        drawPowerup(octx, px, py, p.kind, now);
      }

      // (c) Hard and Soft Blocks
      for (let idx = 0; idx < ARENA_SIZE; idx++) {
        const gx = idx % ARENA_W;
        const gy = Math.floor(idx / ARENA_W);
        const px = gx * TILE_PX;
        const py = gy * TILE_PX;
        const tile = grid[idx] ?? TILE_EMPTY;

        if (tile === TILE_HARD) {
          drawHardBlock(octx, px, py);
        } else if (tile === TILE_SOFT) {
          drawSoftBlock(octx, px, py);
        }
      }

      // (d) Live Bombs
      for (const b of bombs) {
        const px = b.x * TILE_PX;
        const py = b.y * TILE_PX;
        drawBomb(octx, px, py, b.fuse, now);
      }

      // (e) Explosion Blasts (Connect fire streams with 5 distinct sprites)
      const blastSet = new Set(blasts.map((b) => `${b.x},${b.y}`));
      for (const b of blasts) {
        const px = b.x * TILE_PX;
        const py = b.y * TILE_PX;

        const hasUp = blastSet.has(`${b.x},${b.y - 1}`);
        const hasDown = blastSet.has(`${b.x},${b.y + 1}`);
        const hasLeft = blastSet.has(`${b.x - 1},${b.y}`);
        const hasRight = blastSet.has(`${b.x + 1},${b.y}`);

        let type: BlastSpriteType = 'center';
        if (hasLeft && hasRight && !hasUp && !hasDown) {
          type = 'arm_h';
        } else if (hasUp && hasDown && !hasLeft && !hasRight) {
          type = 'arm_v';
        } else if (hasDown && !hasUp && !hasLeft && !hasRight) {
          type = 'end_up';
        } else if (hasUp && !hasDown && !hasLeft && !hasRight) {
          type = 'end_down';
        } else if (hasRight && !hasLeft && !hasUp && !hasDown) {
          type = 'end_left';
        } else if (hasLeft && !hasRight && !hasUp && !hasDown) {
          type = 'end_right';
        } else {
          type = 'center';
        }

        drawBlast(octx, px, py, type, b.ticksRemaining, now);
      }

      // (f) Players (Sorted by Y so front players overlap naturally)
      const sortedPlayers = [...viewPlayers].sort((a, b) => a.y - b.y);
      for (const p of sortedPlayers) {
        const px = p.x * TILE_PX;
        const py = p.y * TILE_PX;
        const facing = facingMapRef.current[p.id] ?? 'down';
        drawPlayer(octx, px, py, p, p.id === youId, facing, now);
      }

      // 2. Render to Display Canvas with crisp pixel art scaling + Screen Shake
      const dw = ARENA_W * cellSize;
      const dh = ARENA_H * cellSize;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Screen shake offset
      let shakeX = 0;
      let shakeY = 0;
      if (shakeRef.current > 0.2) {
        shakeX = (Math.random() - 0.5) * shakeRef.current * 1.5;
        shakeY = (Math.random() - 0.5) * shakeRef.current * 1.5;
        shakeRef.current *= 0.88;
      } else {
        shakeRef.current = 0;
      }

      ctx.translate(shakeX, shakeY);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, 0, 0, NATIVE_W, NATIVE_H, 0, 0, dw, dh);

      // (g) Floating Score / Kill Popups
      popupsRef.current = popupsRef.current.filter((pop) => now - pop.born < 1200);
      for (const pop of popupsRef.current) {
        const age = now - pop.born;
        const progress = age / 1200;
        const alpha = Math.max(0, 1 - progress);
        const floatOffset = progress * 24;

        const screenX = pop.gx * cellSize + cellSize / 2;
        const screenY = pop.gy * cellSize - floatOffset;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000000';
        ctx.fillText(pop.text, screenX + 1, screenY + 1);
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, screenX, screenY);
        ctx.restore();
      }

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [cellSize, viewPlayers, bombs, blasts, visiblePowerups, grid, youId]);

  const alivePlayers = viewPlayers.filter((p) => p.alive);
  const winnerInfo = safeView.winner ? resolvePlayer(playerList, safeView.winner) : null;
  const totalW = ARENA_W * cellSize;
  const totalH = ARENA_H * cellSize;

  // Alignment classes for portrait D-Pad
  const padAlignClass =
    padAlign === 'left' ? 'justify-start' : padAlign === 'right' ? 'justify-end' : 'justify-center';

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col items-center justify-between p-1 sm:p-3 overflow-hidden select-none touch-none bg-pa-bg font-display"
    >
      {/* TOP HUD BAR */}
      <div className="w-full max-w-2xl flex items-center justify-between px-3 py-1.5 bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)] z-20 text-xs shrink-0">
        {/* Alive & Kills */}
        <div className="flex items-center gap-3">
          <div>
            <span className="text-[10px] text-pa-ink-dim uppercase mr-1">ALIVE:</span>
            <span className="font-bold text-pa-cyan tabular">
              {alivePlayers.length}/{viewPlayers.length}
            </span>
          </div>
          {you && (
            <div className="border-l-2 border-pa-border pl-3">
              <span className="text-[10px] text-pa-ink-dim uppercase mr-1">KILLS:</span>
              <span className="font-bold text-pa-danger tabular">💀 {you.kills}</span>
            </div>
          )}
        </div>

        {/* Powers HUD (Blast Radius, Max Bombs, Speed, Pass) */}
        {you ? (
          <div className="flex items-center gap-2.5">
            <div title="Blast Radius" className="flex items-center gap-1">
              <span>🔥</span>
              <span className="font-bold text-pa-ink tabular">{you.blastRadius}</span>
            </div>
            <div title="Max Bombs" className="flex items-center gap-1">
              <span>💣</span>
              <span className="font-bold text-pa-ink tabular">{you.maxBombs}</span>
            </div>
            {you.speed > 0 && (
              <div title="Speed Boost" className="flex items-center gap-0.5 text-yellow-400">
                <span>⚡</span>
                <span className="font-bold tabular">+{you.speed}</span>
              </div>
            )}
            {you.hasPass && (
              <div title="Pass Through Bombs" className="flex items-center gap-0.5 text-purple-400">
                <span>👻</span>
                <span className="text-[9px] font-bold">PASS</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] font-bold tracking-wider text-pa-cyan animate-pulse">
            SPECTATING
          </div>
        )}
      </div>

      {/* CENTER ARENA AREA */}
      <div className="relative flex-1 w-full flex items-center justify-center my-auto min-h-0">
        <div
          className="relative border-4 border-pa-border shadow-[4px_4px_0_var(--color-pa-shadow)] bg-[#0b101c] overflow-hidden"
          style={{
            width: totalW,
            height: totalH,
          }}
        >
          <canvas
            ref={canvasRef}
            width={totalW}
            height={totalH}
            className="block"
            style={{ imageRendering: 'pixelated' }}
          />

          {/* Retro subtle CRT scanline overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage:
                'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.4) 50%)',
              backgroundSize: '100% 4px',
            }}
          />

          {/* Winner Banner Overlay */}
          {isGameOver && (
            <div className="absolute inset-0 bg-pa-bg/85 flex flex-col items-center justify-center p-4 z-30 animate-fade-in">
              <div className="font-display text-xl sm:text-2xl font-bold tracking-wider mb-2 animate-bounce">
                {you && safeView.winner === you.id ? (
                  <span className="text-pa-cyan">VICTORY! YOU WIN!</span>
                ) : winnerInfo ? (
                  <span className="text-pa-ink">{winnerInfo.displayName} WINS!</span>
                ) : (
                  <span className="text-pa-danger">MUTUAL DRAW!</span>
                )}
              </div>
              {you && (
                <div className="font-display text-xs text-pa-ink-dim">
                  TOTAL KILLS: <span className="text-pa-danger font-bold">{you.kills}</span>
                </div>
              )}
            </div>
          )}

          {/* Eliminated Overlay for You while game continues */}
          {you && !you.alive && !isGameOver && (
            <div className="absolute top-2 left-2 right-2 bg-pa-danger/90 text-white font-display text-center py-1 text-xs font-bold tracking-wider z-30 shadow-md">
              ELIMINATED — SPECTATING
            </div>
          )}
        </div>
      </div>

      {/* MOBILE CONTROLS & SPECTATOR ROSTER */}
      {you && you.alive && !isGameOver ? (
        isLandscape ? (
          /* Landscape Split Controls: D-pad left, Bomb right */
          <div className="w-full flex items-center justify-between px-4 py-1 z-20 shrink-0">
            {/* Left D-pad */}
            <div className="grid grid-cols-3 grid-rows-3 w-32 h-32 gap-1 touch-none select-none">
              <div />
              <TouchButton
                label="Move Up"
                onFire={() => {
                  actionRef.current({ type: 'move', dir: 'up' });
                  sfx.blip();
                }}
                repeatMs={110}
                className="flex items-center justify-center text-xl font-bold"
              >
                ▲
              </TouchButton>
              <div />

              <TouchButton
                label="Move Left"
                onFire={() => {
                  actionRef.current({ type: 'move', dir: 'left' });
                  sfx.blip();
                }}
                repeatMs={110}
                className="flex items-center justify-center text-xl font-bold"
              >
                ◀
              </TouchButton>
              <div className="bg-pa-surface-2 border border-pa-border flex items-center justify-center pointer-events-none" />
              <TouchButton
                label="Move Right"
                onFire={() => {
                  actionRef.current({ type: 'move', dir: 'right' });
                  sfx.blip();
                }}
                repeatMs={110}
                className="flex items-center justify-center text-xl font-bold"
              >
                ▶
              </TouchButton>

              <div />
              <TouchButton
                label="Move Down"
                onFire={() => {
                  actionRef.current({ type: 'move', dir: 'down' });
                  sfx.blip();
                }}
                repeatMs={110}
                className="flex items-center justify-center text-xl font-bold"
              >
                ▼
              </TouchButton>
              <div />
            </div>

            {/* Right Dedicated Bomb Button */}
            <TouchButton
              label="Place Bomb"
              onFire={() => {
                actionRef.current({ type: 'bomb' });
                sfx.pop();
              }}
              className="w-20 h-20 rounded-full flex flex-col items-center justify-center bg-pa-surface-2 border-4 border-pa-danger text-pa-danger shadow-[3px_3px_0_var(--color-pa-shadow)] active:scale-95"
            >
              <span className="text-2xl">💣</span>
              <span className="text-[9px] font-bold tracking-widest mt-0.5">BOMB</span>
            </TouchButton>
          </div>
        ) : (
          /* Portrait Controls: Big 64px D-Pad (192px) + BOMB button bottom-right */
          <div className="w-full max-w-md flex flex-col items-center gap-1 z-20 shrink-0">
            {/* Pad Alignment Selector */}
            <div className="flex items-center gap-1 text-[9px] font-display text-pa-ink-dim self-end pr-2">
              <span>PAD:</span>
              <button
                type="button"
                onClick={() => setPadAlign('left')}
                className={`px-1.5 py-0.5 border cursor-pointer ${
                  padAlign === 'left' ? 'bg-pa-cyan text-pa-bg font-bold' : 'border-pa-border bg-pa-surface'
                }`}
              >
                L
              </button>
              <button
                type="button"
                onClick={() => setPadAlign('center')}
                className={`px-1.5 py-0.5 border cursor-pointer ${
                  padAlign === 'center' ? 'bg-pa-cyan text-pa-bg font-bold' : 'border-pa-border bg-pa-surface'
                }`}
              >
                C
              </button>
              <button
                type="button"
                onClick={() => setPadAlign('right')}
                className={`px-1.5 py-0.5 border cursor-pointer ${
                  padAlign === 'right' ? 'bg-pa-cyan text-pa-bg font-bold' : 'border-pa-border bg-pa-surface'
                }`}
              >
                R
              </button>
            </div>

            <div className={`w-full flex ${padAlignClass} items-center gap-4 px-2`}>
              {/* 192px D-Pad (64px buttons) */}
              <div className="grid grid-cols-3 grid-rows-3 w-[192px] h-[192px] gap-1 touch-none select-none">
                <div />
                <TouchButton
                  label="Move Up"
                  onFire={() => {
                    actionRef.current({ type: 'move', dir: 'up' });
                    sfx.blip();
                  }}
                  repeatMs={110}
                  className="w-full h-full flex items-center justify-center text-2xl font-bold"
                >
                  ▲
                </TouchButton>
                <div />

                <TouchButton
                  label="Move Left"
                  onFire={() => {
                    actionRef.current({ type: 'move', dir: 'left' });
                    sfx.blip();
                  }}
                  repeatMs={110}
                  className="w-full h-full flex items-center justify-center text-2xl font-bold"
                >
                  ◀
                </TouchButton>
                <div className="bg-pa-surface border-2 border-pa-border flex items-center justify-center pointer-events-none select-none" />
                <TouchButton
                  label="Move Right"
                  onFire={() => {
                    actionRef.current({ type: 'move', dir: 'right' });
                    sfx.blip();
                  }}
                  repeatMs={110}
                  className="w-full h-full flex items-center justify-center text-2xl font-bold"
                >
                  ▶
                </TouchButton>

                <div />
                <TouchButton
                  label="Move Down"
                  onFire={() => {
                    actionRef.current({ type: 'move', dir: 'down' });
                    sfx.blip();
                  }}
                  repeatMs={110}
                  className="w-full h-full flex items-center justify-center text-2xl font-bold"
                >
                  ▼
                </TouchButton>
                <div />
              </div>

              {/* Dedicated BOMB Button */}
              <TouchButton
                label="Place Bomb"
                onFire={() => {
                  actionRef.current({ type: 'bomb' });
                  sfx.pop();
                }}
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex flex-col items-center justify-center bg-pa-surface-2 border-4 border-pa-danger text-pa-danger shadow-[4px_4px_0_var(--color-pa-shadow)] active:scale-95 shrink-0"
              >
                <span className="text-2xl sm:text-3xl">💣</span>
                <span className="text-[10px] font-bold tracking-widest mt-1">BOMB</span>
              </TouchButton>
            </div>
          </div>
        )
      ) : (
        /* Spectator Player Roster when spectating or eliminated */
        <div className="w-full max-w-2xl px-3 py-2 bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)] z-20 shrink-0">
          <div className="text-[10px] text-pa-ink-dim uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span>PLAYERS ({alivePlayers.length}/{viewPlayers.length} ALIVE)</span>
            {!you?.alive && <span className="text-pa-danger font-bold">YOU ARE SPECTATING</span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {viewPlayers.map((p) => {
              const info = resolvePlayer(playerList, p.id);
              const color = SEAT_COLORS[p.seat % SEAT_COLORS.length] ?? '#2ee66b';
              const isYouItem = p.id === youId;
              return (
                <div
                  key={p.id}
                  className={`p-1.5 border-2 text-[11px] flex flex-col gap-0.5 ${
                    p.alive
                      ? isYouItem
                        ? 'bg-pa-surface-2 border-pa-cyan'
                        : 'bg-pa-bg border-pa-border'
                      : 'bg-pa-bg/60 border-pa-border/40 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-1 font-bold truncate">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="truncate">{info.displayName}</span>
                    {isYouItem && <span className="text-pa-cyan text-[9px]">(YOU)</span>}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-pa-ink-dim">
                    <span>💀 {p.kills}</span>
                    <span>🔥 {p.blastRadius}</span>
                    <span>💣 {p.maxBombs}</span>
                  </div>
                  {!p.alive && <span className="text-pa-danger text-[9px] font-bold">ELIMINATED</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
