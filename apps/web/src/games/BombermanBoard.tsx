import * as React from 'react';
import { useRoom } from '../net/socket.js';
import { sfx, bgm } from '../ui/sound.js';
import { SEAT_COLORS, resolvePlayer, monogram, type PlayerLike } from '../ui/seat.js';
import { cn } from '../ui/cn.js';

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

interface CrumbleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  born: number;
  duration: number;
}

/* ------------------------------------------------------------------ */
/* Retro 16x16 Pixel Sprite Drawing Functions                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 16-Bit Sega Genesis / Mega Drive Palette Constants                 */
/* ------------------------------------------------------------------ */

/**
 * Rich 3-tone seat color ramps for 16-bit Genesis Bomberman sprites.
 * Each seat gets high-contrast highlight, mid, dark shade, boot, and pompom tones.
 */
interface SeatPalette {
  light: string;
  mid: string;
  dark: string;
  boots: string;
  bootSole: string;
  pompom: string;
}

const SEAT_PALETTES: SeatPalette[] = [
  // Seat 0: Classic White / Cyan Bomber
  {
    light: '#6ee4ff',
    mid: '#14b4e8',
    dark: '#0a6ca0',
    boots: '#f0f4fc',
    bootSole: '#141824',
    pompom: '#ff3870',
  },
  // Seat 1: Crimson Red Bomber
  {
    light: '#ff6250',
    mid: '#d82018',
    dark: '#7e0e0c',
    boots: '#ffe8ec',
    bootSole: '#141824',
    pompom: '#ffd420',
  },
  // Seat 2: Electric Cobalt Blue Bomber
  {
    light: '#68a8ff',
    mid: '#1c62f2',
    dark: '#0c32a4',
    boots: '#f0f4fc',
    bootSole: '#141824',
    pompom: '#ff3870',
  },
  // Seat 3: Emerald Jade Green Bomber
  {
    light: '#5ce878',
    mid: '#1cb244',
    dark: '#0c6824',
    boots: '#f0f4fc',
    bootSole: '#141824',
    pompom: '#ffea20',
  },
  // Seat 4: Golden Amber Yellow Bomber
  {
    light: '#ffea48',
    mid: '#e8b210',
    dark: '#8c6204',
    boots: '#f0f4fc',
    bootSole: '#141824',
    pompom: '#ff3870',
  },
  // Seat 5: Royal Violet Purple Bomber
  {
    light: '#d67cff',
    mid: '#9a2ee8',
    dark: '#54108a',
    boots: '#f8f0fc',
    bootSole: '#141824',
    pompom: '#ffd420',
  },
  // Seat 6: Hot Magenta Pink Bomber
  {
    light: '#ff78be',
    mid: '#e82a84',
    dark: '#88104c',
    boots: '#f0f4fc',
    bootSole: '#141824',
    pompom: '#38e0ff',
  },
  // Seat 7: Dark Steel / Ninja Bomber
  {
    light: '#627a9c',
    mid: '#304058',
    dark: '#141c28',
    boots: '#98a8c0',
    bootSole: '#080c14',
    pompom: '#ff3870',
  },
];

/**
 * Arena Floor Tile: Deep blue / purple checkerboard stone arena floor
 * reminiscent of Sega Mega Bomberman stadium tiles with chiseled edges,
 * inner beveling, and stone texture flecks.
 */
function drawFloorTile(ctx: CanvasRenderingContext2D, px: number, py: number, gx: number, gy: number): void {
  const isEven = (gx + gy) % 2 === 0;

  // Deep chiseled mortar frame
  ctx.fillStyle = '#080612';
  ctx.fillRect(px, py, TILE_PX, TILE_PX);

  if (isEven) {
    // Tone A: Deep Royal Violet Flagstone
    // Base stone body
    ctx.fillStyle = '#241e44';
    ctx.fillRect(px + 1, py + 1, 14, 14);

    // Inner darker field
    ctx.fillStyle = '#1c1638';
    ctx.fillRect(px + 2, py + 2, 12, 12);

    // Top/left bevel highlight
    ctx.fillStyle = '#4e3e84';
    ctx.fillRect(px + 1, py + 1, 14, 1);
    ctx.fillRect(px + 1, py + 1, 1, 14);

    // Specular corner glint
    ctx.fillStyle = '#725eb4';
    ctx.fillRect(px + 1, py + 1, 1, 1);

    // Bottom/right bevel shadow
    ctx.fillStyle = '#120e24';
    ctx.fillRect(px + 1, py + 14, 14, 1);
    ctx.fillRect(px + 14, py + 1, 1, 14);

    // Subtle stone texture flecks
    ctx.fillStyle = '#322858';
    ctx.fillRect(px + 4, py + 4, 1, 1);
    ctx.fillRect(px + 11, py + 5, 1, 1);
    ctx.fillRect(px + 5, py + 11, 1, 1);
    ctx.fillRect(px + 10, py + 10, 1, 1);
  } else {
    // Tone B: Deep Midnight Indigo Flagstone
    // Base stone body
    ctx.fillStyle = '#1a2444';
    ctx.fillRect(px + 1, py + 1, 14, 14);

    // Inner darker field
    ctx.fillStyle = '#141c38';
    ctx.fillRect(px + 2, py + 2, 12, 12);

    // Top/left bevel highlight
    ctx.fillStyle = '#3e5288';
    ctx.fillRect(px + 1, py + 1, 14, 1);
    ctx.fillRect(px + 1, py + 1, 1, 14);

    // Specular corner glint
    ctx.fillStyle = '#6480c0';
    ctx.fillRect(px + 1, py + 1, 1, 1);

    // Bottom/right bevel shadow
    ctx.fillStyle = '#0e1428';
    ctx.fillRect(px + 1, py + 14, 14, 1);
    ctx.fillRect(px + 14, py + 1, 1, 14);

    // Subtle stone texture flecks
    ctx.fillStyle = '#26345c';
    ctx.fillRect(px + 5, py + 4, 1, 1);
    ctx.fillRect(px + 10, py + 4, 1, 1);
    ctx.fillRect(px + 4, py + 10, 1, 1);
    ctx.fillRect(px + 11, py + 11, 1, 1);
  }
}

/**
 * Hard Block: 16-bit Sega Genesis steel pillar with 3D bevel, recessed cross plate,
 * and 4 polished steel corner rivets.
 */
function drawHardBlock(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  // Dark drop shadow & outer contour
  ctx.fillStyle = '#060a12';
  ctx.fillRect(px, py, TILE_PX, TILE_PX);

  // Outer steel bevel body
  ctx.fillStyle = '#223046';
  ctx.fillRect(px + 1, py + 1, 14, 14);

  // Top & Left 3D metallic highlight
  ctx.fillStyle = '#7a96bc';
  ctx.fillRect(px + 1, py + 1, 13, 1);
  ctx.fillRect(px + 1, py + 1, 1, 13);
  // Specular top-left corner glint
  ctx.fillStyle = '#d8e8fc';
  ctx.fillRect(px + 1, py + 1, 2, 1);
  ctx.fillRect(px + 1, py + 1, 1, 2);

  // Bottom & Right 3D metallic shadow
  ctx.fillStyle = '#0e1420';
  ctx.fillRect(px + 1, py + 14, 14, 1);
  ctx.fillRect(px + 14, py + 1, 1, 14);

  // Inner raised steel face
  ctx.fillStyle = '#3a4e6c';
  ctx.fillRect(px + 2, py + 2, 12, 12);

  // Recessed center hazard plate / cross-hatch channel
  ctx.fillStyle = '#162030';
  ctx.fillRect(px + 4, py + 4, 8, 8);
  // Inner panel drop shadow
  ctx.fillStyle = '#0e1622';
  ctx.fillRect(px + 4, py + 4, 8, 1);
  ctx.fillRect(px + 4, py + 4, 1, 8);
  // Inner panel highlight
  ctx.fillStyle = '#546c8e';
  ctx.fillRect(px + 4, py + 11, 8, 1);
  ctx.fillRect(px + 11, py + 4, 1, 8);

  // Center embossed steel boss
  ctx.fillStyle = '#4c6284';
  ctx.fillRect(px + 6, py + 6, 4, 4);
  ctx.fillStyle = '#86a2ca';
  ctx.fillRect(px + 6, py + 6, 3, 1);
  ctx.fillRect(px + 6, py + 6, 1, 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px + 7, py + 7, 1, 1);

  // 4 Polished Steel Corner Rivets (with specular reflection & cast shadow)
  const rivets: readonly (readonly [number, number])[] = [
    [2, 2],
    [11, 2],
    [2, 11],
    [11, 11],
  ];
  for (const [rx, ry] of rivets) {
    // Rivet dark shadow socket
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(px + rx, py + ry, 3, 3);
    // Rivet steel head
    ctx.fillStyle = '#566e92';
    ctx.fillRect(px + rx, py + ry, 2, 2);
    // Specular gleam
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + rx, py + ry, 1, 1);
  }
}

/**
 * Soft Block: Destructible terracotta brick wall with warm multi-tone shading,
 * deep mortar grooves, and realistic hairline stress cracks.
 */
function drawSoftBlock(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  // Deep mortar background
  ctx.fillStyle = '#1c0a06';
  ctx.fillRect(px, py, TILE_PX, TILE_PX);

  // Helper to render an individual 16-bit brick with 4-tone depth
  const renderBrick = (bx: number, by: number, bw: number, bh: number, cracked = false) => {
    // Deep brick base shadow
    ctx.fillStyle = '#541406';
    ctx.fillRect(px + bx, py + by, bw, bh);

    // Main brick terracotta body
    ctx.fillStyle = '#942e12';
    ctx.fillRect(px + bx, py + by, bw, bh - 1);

    // Warm sunlit face
    ctx.fillStyle = '#c44618';
    ctx.fillRect(px + bx, py + by, bw - 1, bh - 1);

    // Top highlight rim
    ctx.fillStyle = '#f07234';
    ctx.fillRect(px + bx, py + by, bw, 1);

    // Left edge highlight
    ctx.fillRect(px + bx, py + by, 1, bh - 1);

    // Specular glint
    ctx.fillStyle = '#ff9658';
    ctx.fillRect(px + bx + 1, py + by, Math.max(1, bw - 3), 1);

    if (cracked) {
      // Hairline crack across brick
      ctx.fillStyle = '#220a06';
      ctx.fillRect(px + bx + Math.floor(bw / 2), py + by + 1, 1, bh - 1);
      ctx.fillStyle = '#f07234';
      ctx.fillRect(px + bx + Math.floor(bw / 2) + 1, py + by + 1, 1, 1);
    }
  };

  // Course 0: 2 bricks
  renderBrick(1, 1, 6, 3, false);
  renderBrick(8, 1, 7, 3, true);

  // Course 1: 3 staggered bricks
  renderBrick(1, 5, 3, 3, false);
  renderBrick(5, 5, 6, 3, false);
  renderBrick(12, 5, 3, 3, false);

  // Course 2: 2 bricks (with crack on left)
  renderBrick(1, 9, 7, 3, true);
  renderBrick(9, 9, 6, 3, false);

  // Course 3: 3 staggered bricks at foundation
  renderBrick(1, 13, 4, 2, false);
  renderBrick(6, 13, 5, 2, false);
  renderBrick(12, 13, 3, 2, false);
}

/**
 * Classic Powerup Badge: Distinctive 16-bit icons on a dark beveled pedestal
 * with subtle pickup sparkle.
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
  ctx.fillStyle = '#080c16';
  ctx.fillRect(px + 1, by + 1, 14, 14);
  ctx.fillStyle = '#162032';
  ctx.fillRect(px + 2, by + 2, 12, 12);
  ctx.fillStyle = '#425e88';
  ctx.fillRect(px + 1, by + 1, 13, 1);
  ctx.fillRect(px + 1, by + 1, 1, 13);
  ctx.fillStyle = '#0c121e';
  ctx.fillRect(px + 1, by + 14, 14, 1);
  ctx.fillRect(px + 14, by + 1, 1, 14);

  switch (kind) {
    case 'flame': {
      // Fiery 16-bit flame crest (5-tone: deep red outline, scarlet, vivid orange, sun yellow, laser white core)
      ctx.fillStyle = '#780800';
      ctx.fillRect(px + 7, by + 3, 2, 1);
      ctx.fillRect(px + 6, by + 4, 4, 2);
      ctx.fillRect(px + 5, by + 6, 6, 6);
      ctx.fillRect(px + 4, by + 8, 8, 4);

      ctx.fillStyle = '#d81c00';
      ctx.fillRect(px + 7, by + 4, 2, 2);
      ctx.fillRect(px + 6, by + 6, 4, 5);
      ctx.fillRect(px + 5, by + 9, 6, 2);

      ctx.fillStyle = '#ff7000';
      ctx.fillRect(px + 7, by + 5, 2, 3);
      ctx.fillRect(px + 6, by + 8, 4, 3);

      ctx.fillStyle = '#ffea20';
      ctx.fillRect(px + 7, by + 7, 2, 4);
      ctx.fillRect(px + 6, by + 9, 4, 1);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 7, by + 8, 2, 2);
      break;
    }
    case 'bomb': {
      // 16-Bit bomb badge with brass collar, fuse spark, and gold '+1' numeral
      ctx.fillStyle = '#080c14';
      ctx.beginPath();
      ctx.arc(px + 8, by + 9, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1e2c44';
      ctx.beginPath();
      ctx.arc(px + 8, by + 9, 4, 0, Math.PI * 2);
      ctx.fill();

      // Specular shine glint
      ctx.fillStyle = '#7294c2';
      ctx.fillRect(px + 6, by + 6, 2, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 6, by + 6, 1, 1);

      // Brass neck
      ctx.fillStyle = '#d49818';
      ctx.fillRect(px + 7, by + 4, 2, 1);

      // Animated fuse spark
      const sparkFlip = Math.floor(timeMs / 90) % 2;
      ctx.fillStyle = sparkFlip === 0 ? '#ffee24' : '#ff7000';
      ctx.fillRect(px + 9, by + 2, 2, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 10, by + 2, 1, 1);

      // Embossed Gold '1'
      ctx.fillStyle = '#8c6400';
      ctx.fillRect(px + 7, by + 7, 3, 5);
      ctx.fillStyle = '#ffd420';
      ctx.fillRect(px + 8, by + 7, 1, 4);
      ctx.fillRect(px + 7, by + 8, 1, 1);
      ctx.fillRect(px + 7, by + 10, 3, 1);
      break;
    }
    case 'speed': {
      // Golden winged roller skate
      // Wing feathers
      ctx.fillStyle = '#789cc4';
      ctx.fillRect(px + 5, by + 4, 6, 3);
      ctx.fillStyle = '#d0e4fc';
      ctx.fillRect(px + 6, by + 3, 5, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 8, by + 2, 3, 2);
      ctx.fillRect(px + 6, by + 4, 3, 1);

      // Gold boot body
      ctx.fillStyle = '#8a6006';
      ctx.fillRect(px + 4, by + 7, 8, 4);
      ctx.fillStyle = '#e8a810';
      ctx.fillRect(px + 5, by + 7, 6, 3);
      ctx.fillRect(px + 3, by + 9, 8, 2);
      ctx.fillStyle = '#ffe240';
      ctx.fillRect(px + 5, by + 7, 5, 1);
      ctx.fillRect(px + 3, by + 9, 3, 1);

      // Red roller wheels with silver hubs
      ctx.fillStyle = '#d41c1c';
      ctx.fillRect(px + 4, by + 11, 2, 2);
      ctx.fillRect(px + 8, by + 11, 2, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 4, by + 11, 1, 1);
      ctx.fillRect(px + 8, by + 11, 1, 1);
      break;
    }
    case 'pass': {
      // Ethereal phantom silhouette with radiant violet / amethyst aura
      ctx.fillStyle = '#340a54';
      ctx.beginPath();
      ctx.arc(px + 8, by + 6, 5, Math.PI, 0);
      ctx.lineTo(px + 13, by + 12);
      ctx.lineTo(px + 11, by + 10);
      ctx.lineTo(px + 8, by + 12);
      ctx.lineTo(px + 5, by + 10);
      ctx.lineTo(px + 3, by + 12);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#7c20c0';
      ctx.beginPath();
      ctx.arc(px + 8, by + 6, 4, Math.PI, 0);
      ctx.lineTo(px + 12, by + 11);
      ctx.lineTo(px + 10, by + 10);
      ctx.lineTo(px + 8, by + 11);
      ctx.lineTo(px + 6, by + 10);
      ctx.lineTo(px + 4, by + 11);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#b860f8';
      ctx.fillRect(px + 6, by + 5, 4, 4);

      // Glowing white phantom eyes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 6, by + 6, 1, 2);
      ctx.fillRect(px + 9, by + 6, 1, 2);
      break;
    }
  }

  // Subtle Pickup Sparkle: 4-pointed twinkle glint on corner
  const sparkleCycle = (timeMs % 1200) / 1200;
  if (sparkleCycle < 0.3) {
    const sx = px + 12;
    const sy = by + 2;
    ctx.fillStyle = '#ffee60';
    ctx.fillRect(sx, sy - 1, 1, 3);
    ctx.fillRect(sx - 1, sy, 3, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx, sy, 1, 1);
  }
}

/**
 * Bomb Sprite: 16-bit shaded spherical bomb with metallic brass neck,
 * animated fuse spark, pulsating heartbeat scale, and high-contrast danger flash at low fuse.
 */
function drawBomb(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  fuse: number,
  timeMs: number
): void {
  const isUrgent = fuse <= 6;
  const blinkRed = isUrgent && Math.floor(timeMs / 80) % 2 === 0;

  // Center of the 16x16 cell
  const cx = px + 8;
  const cy = py + 9;
  const baseRadius = 5.2;
  const radius = isUrgent ? baseRadius + Math.abs(Math.sin(timeMs / 70)) * 1.2 : baseRadius;

  // Ground drop shadow (distinguishes stacked bomb cleanly from floor / powerups)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 5, 5.5, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (blinkRed) {
    // High-contrast Urgent Detonation Flash
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff1838';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff788c';
    ctx.fillRect(cx - 3, cy - 3, 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 3, cy - 3, 1, 1);
  } else {
    // 16-Bit Shaded Spherical Body (4-tone Mega Drive rendering)
    // Outer dark contour
    ctx.fillStyle = '#080c14';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Deep shadow body
    ctx.fillStyle = '#162032';
    ctx.beginPath();
    ctx.arc(cx - 0.5, cy - 0.5, radius - 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Mid slate-blue sphere body
    ctx.fillStyle = '#2a3c58';
    ctx.beginPath();
    ctx.arc(cx - 1, cy - 1, radius - 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Upper-left highlight crest
    ctx.fillStyle = '#4e709a';
    ctx.beginPath();
    ctx.arc(cx - 1.5, cy - 1.5, radius - 2, 0, Math.PI * 2);
    ctx.fill();

    // Specular highlight crescent & glint dot
    ctx.fillStyle = '#7ca0cc';
    ctx.fillRect(cx - 3, cy - 3, 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 3, cy - 3, 1, 1);
  }

  // Top Brass Collar
  ctx.fillStyle = '#78500c';
  ctx.fillRect(cx - 2, cy - radius - 2, 4, 2);
  ctx.fillStyle = '#d49818';
  ctx.fillRect(cx - 1.5, cy - radius - 2, 3, 2);
  ctx.fillStyle = '#ffe440';
  ctx.fillRect(cx - 1.5, cy - radius - 2, 3, 1);

  // Curved Woven Fuse String
  ctx.strokeStyle = '#705838';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius - 1);
  ctx.quadraticCurveTo(cx + 2, cy - radius - 3.5, cx + 4, cy - radius - 2);
  ctx.stroke();
  ctx.strokeStyle = '#bfa878';
  ctx.beginPath();
  ctx.moveTo(cx + 1, cy - radius - 1.5);
  ctx.lineTo(cx + 3, cy - radius - 2.5);
  ctx.stroke();

  // Animated 4-Frame Fuse Spark
  const sparkFrame = Math.floor(timeMs / 60) % 4;
  const sx = cx + 4;
  const sy = cy - radius - 2;

  if (sparkFrame === 0) {
    // 4-point cross flare
    ctx.fillStyle = '#ff6010';
    ctx.fillRect(sx - 2, sy - 1, 5, 3);
    ctx.fillRect(sx - 1, sy - 2, 3, 5);
    ctx.fillStyle = '#ffea20';
    ctx.fillRect(sx - 1, sy - 1, 3, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx, sy, 1, 1);
  } else if (sparkFrame === 1) {
    // Bursting star with flying embers
    ctx.fillStyle = '#ff3800';
    ctx.fillRect(sx - 1, sy - 1, 3, 3);
    ctx.fillStyle = '#ffee24';
    ctx.fillRect(sx, sy, 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx, sy, 1, 1);
    // Embers
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(sx + 2, sy - 2, 1, 1);
    ctx.fillRect(sx - 2, sy + 1, 1, 1);
  } else if (sparkFrame === 2) {
    // Intense center flare
    ctx.fillStyle = '#ff7010';
    ctx.fillRect(sx - 2, sy, 5, 1);
    ctx.fillRect(sx, sy - 2, 1, 5);
    ctx.fillStyle = '#ffea20';
    ctx.fillRect(sx - 1, sy - 1, 3, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 1, sy - 1, 2, 2);
  } else {
    // Dual ember fizzle
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx, sy, 2, 2);
    ctx.fillStyle = '#ff4400';
    ctx.fillRect(sx - 1, sy - 1, 1, 1);
    ctx.fillRect(sx + 1, sy + 1, 1, 1);
    ctx.fillRect(sx + 2, sy - 1, 1, 1);
  }
}

/**
 * Explosion Blast Sprite: Sega Genesis 16-bit multi-frame flame burst with
 * 5 distinct tones (dark ember rim, vivid red, intense orange, bright sun yellow, laser white core),
 * animated flame turbulence, and clear directional caps making blast reach immediately obvious.
 */
function drawBlast(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  type: BlastSpriteType,
  ticksRemaining: number,
  timeMs: number
): void {
  // 4-frame animated flame ripple with spatial offset for organic wave propagation
  const flameFrame = Math.floor(timeMs / 55 + px * 0.2 + py * 0.3) % 4;
  const opacity = Math.min(1, Math.max(0.55, ticksRemaining / 3));
  ctx.save();
  ctx.globalAlpha = opacity;

  // 5-Tone Sega Genesis Flame Palette
  const cEdge = '#540400';    // dark ember edge
  const cRed = '#e82a00';     // vivid flame red
  const cOrange = '#ff7200';  // hot flame orange
  const cYellow = '#ffee24';  // bright sun yellow
  const cWhite = '#ffffff';   // laser white core

  switch (type) {
    case 'center': {
      // 4-Way Detonation Hub
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 1, py + 1, 14, 14);
      // Flame spikes
      ctx.fillRect(px, py + 3, 16, 10);
      ctx.fillRect(px + 3, py, 10, 16);

      ctx.fillStyle = cRed;
      ctx.fillRect(px + 2, py + 2, 12, 12);
      if (flameFrame % 2 === 0) {
        ctx.fillRect(px + 1, py + 4, 14, 8);
        ctx.fillRect(px + 4, py + 1, 8, 14);
      } else {
        ctx.fillRect(px + 1, py + 3, 14, 10);
        ctx.fillRect(px + 3, py + 1, 10, 14);
      }

      ctx.fillStyle = cOrange;
      ctx.fillRect(px + 3, py + 3, 10, 10);
      ctx.fillRect(px + 2, py + 5, 12, 6);
      ctx.fillRect(px + 5, py + 2, 6, 12);

      ctx.fillStyle = cYellow;
      ctx.fillRect(px + 4, py + 4, 8, 8);

      ctx.fillStyle = cWhite;
      ctx.fillRect(px + 6, py + 6, 4, 4);
      // Diagonal core glints
      ctx.fillRect(px + 5, py + 7, 6, 2);
      ctx.fillRect(px + 7, py + 5, 2, 6);
      break;
    }
    case 'arm_h': {
      // Horizontal Flame Corridor
      const wav = flameFrame % 2;
      ctx.fillStyle = cEdge;
      ctx.fillRect(px, py + 2 + wav, TILE_PX, 12 - wav * 2);

      ctx.fillStyle = cRed;
      ctx.fillRect(px, py + 3 + wav, TILE_PX, 10 - wav * 2);

      ctx.fillStyle = cOrange;
      ctx.fillRect(px, py + 5, TILE_PX, 6);

      ctx.fillStyle = cYellow;
      ctx.fillRect(px, py + 6, TILE_PX, 4);

      ctx.fillStyle = cWhite;
      ctx.fillRect(px, py + 7, TILE_PX, 2);
      break;
    }
    case 'arm_v': {
      // Vertical Flame Corridor
      const wav = flameFrame % 2;
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 2 + wav, py, 12 - wav * 2, TILE_PX);

      ctx.fillStyle = cRed;
      ctx.fillRect(px + 3 + wav, py, 10 - wav * 2, TILE_PX);

      ctx.fillStyle = cOrange;
      ctx.fillRect(px + 5, py, 6, TILE_PX);

      ctx.fillStyle = cYellow;
      ctx.fillRect(px + 6, py, 4, TILE_PX);

      ctx.fillStyle = cWhite;
      ctx.fillRect(px + 7, py, 2, TILE_PX);
      break;
    }
    case 'end_up': {
      // Rounded flame arrowhead pointing UP (blast reach edge)
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 3, py + 4, 10, 12);
      ctx.fillRect(px + 5, py + 2, 6, 4);
      ctx.fillRect(px + 7, py + 1, 2, 2);

      ctx.fillStyle = cRed;
      ctx.fillRect(px + 4, py + 5, 8, 11);
      ctx.fillRect(px + 6, py + 3, 4, 4);
      ctx.fillRect(px + 7, py + 2, 2, 2);

      ctx.fillStyle = cOrange;
      ctx.fillRect(px + 5, py + 6, 6, 10);
      ctx.fillRect(px + 6, py + 4, 4, 3);

      ctx.fillStyle = cYellow;
      ctx.fillRect(px + 6, py + 7, 4, 9);
      ctx.fillRect(px + 7, py + 5, 2, 3);

      ctx.fillStyle = cWhite;
      ctx.fillRect(px + 7, py + 8, 2, 8);
      break;
    }
    case 'end_down': {
      // Rounded flame arrowhead pointing DOWN (blast reach edge)
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 3, py, 10, 12);
      ctx.fillRect(px + 5, py + 10, 6, 4);
      ctx.fillRect(px + 7, py + 13, 2, 2);

      ctx.fillStyle = cRed;
      ctx.fillRect(px + 4, py, 8, 11);
      ctx.fillRect(px + 6, py + 9, 4, 4);
      ctx.fillRect(px + 7, py + 12, 2, 2);

      ctx.fillStyle = cOrange;
      ctx.fillRect(px + 5, py, 6, 10);
      ctx.fillRect(px + 6, py + 9, 4, 3);

      ctx.fillStyle = cYellow;
      ctx.fillRect(px + 6, py, 4, 9);
      ctx.fillRect(px + 7, py + 8, 2, 3);

      ctx.fillStyle = cWhite;
      ctx.fillRect(px + 7, py, 2, 8);
      break;
    }
    case 'end_left': {
      // Rounded flame arrowhead pointing LEFT (blast reach edge)
      ctx.fillStyle = cEdge;
      ctx.fillRect(px + 4, py + 3, 12, 10);
      ctx.fillRect(px + 2, py + 5, 4, 6);
      ctx.fillRect(px + 1, py + 7, 2, 2);

      ctx.fillStyle = cRed;
      ctx.fillRect(px + 5, py + 4, 11, 8);
      ctx.fillRect(px + 3, py + 6, 4, 4);
      ctx.fillRect(px + 2, py + 7, 2, 2);

      ctx.fillStyle = cOrange;
      ctx.fillRect(px + 6, py + 5, 10, 6);
      ctx.fillRect(px + 4, py + 6, 3, 4);

      ctx.fillStyle = cYellow;
      ctx.fillRect(px + 7, py + 6, 9, 4);
      ctx.fillRect(px + 5, py + 7, 3, 2);

      ctx.fillStyle = cWhite;
      ctx.fillRect(px + 8, py + 7, 8, 2);
      break;
    }
    case 'end_right': {
      // Rounded flame arrowhead pointing RIGHT (blast reach edge)
      ctx.fillStyle = cEdge;
      ctx.fillRect(px, py + 3, 12, 10);
      ctx.fillRect(px + 10, py + 5, 4, 6);
      ctx.fillRect(px + 13, py + 7, 2, 2);

      ctx.fillStyle = cRed;
      ctx.fillRect(px, py + 4, 11, 8);
      ctx.fillRect(px + 9, py + 6, 4, 4);
      ctx.fillRect(px + 12, py + 7, 2, 2);

      ctx.fillStyle = cOrange;
      ctx.fillRect(px, py + 5, 10, 6);
      ctx.fillRect(px + 9, py + 6, 3, 4);

      ctx.fillStyle = cYellow;
      ctx.fillRect(px, py + 6, 9, 4);
      ctx.fillRect(px + 8, py + 7, 3, 2);

      ctx.fillStyle = cWhite;
      ctx.fillRect(px, py + 7, 8, 2);
      break;
    }
  }

  // Short-lived animated flame spark embers around perimeter
  if (flameFrame === 1 || flameFrame === 3) {
    ctx.fillStyle = cYellow;
    ctx.fillRect(px + 2, py + 2, 1, 1);
    ctx.fillRect(px + 13, py + 13, 1, 1);
  }

  ctx.restore();
}

/**
 * Authentic 16-Bit Bomberman Player Character: White spherical helmet with pompom,
 * expressive face visor with eye shines and blush, color-coded multi-tone suit per seat,
 * leather belt with gold buckle, boots, and directional walking step bob.
 */
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  player: BombermanPublicPlayer,
  isYou: boolean,
  facing: Dir,
  timeMs: number,
  isOnBomb = false
): void {
  const pal = SEAT_PALETTES[player.seat % SEAT_PALETTES.length] ?? SEAT_PALETTES[0]!;

  // Dead Player: 16-Bit floating angel ghost
  if (!player.alive || player.gameOver) {
    const floatY = Math.round(Math.sin(timeMs / 200) * 1.5);
    const gy = py + floatY;

    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#b8d4fc';
    ctx.beginPath();
    ctx.arc(px + 8, gy + 6, 5, Math.PI, 0);
    ctx.lineTo(px + 13, gy + 12);
    ctx.lineTo(px + 11, gy + 10);
    ctx.lineTo(px + 8, gy + 12);
    ctx.lineTo(px + 5, gy + 10);
    ctx.lineTo(px + 3, gy + 12);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#e4f0ff';
    ctx.fillRect(px + 5, gy + 4, 6, 4);

    // Angel golden halo
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(px + 8, gy + 1, 4, 1.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Ghost dead 'X' eyes
    ctx.strokeStyle = '#182438';
    ctx.lineWidth = 1;
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

  // Walk step animation: 2-frame walking cycle every 140ms
  const step = Math.floor(timeMs / 140) % 2;
  const bob = step === 0 ? 0 : 1;

  // Drop shadow underneath player
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(px + 8, py + 14, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // If player is standing on a bomb, draw an amber hazard indicator under feet so danger zone is never obscured
  if (isOnBomb) {
    const pulseFlash = Math.floor(timeMs / 100) % 2 === 0;
    ctx.strokeStyle = pulseFlash ? '#ffea20' : '#ff4400';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(px + 8, py + 14, 6.5, 2.8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 1. Antenna Pompom (Pink / Seat ball with 1 px wiggle during walk)
  const pomWiggle = step === 1 && (facing === 'left' || facing === 'right') ? (facing === 'left' ? 1 : -1) : 0;
  ctx.fillStyle = '#202838';
  ctx.fillRect(px + 7 + pomWiggle, py + 1 + bob, 2, 1);

  ctx.fillStyle = pal.pompom;
  ctx.fillRect(px + 6 + pomWiggle, py - 1 + bob, 4, 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px + 7 + pomWiggle, py - 1 + bob, 1, 1);

  // 2. White Spherical Helmet (4-tone 16-bit shading)
  // Helmet dark contour
  ctx.fillStyle = '#101420';
  ctx.fillRect(px + 3, py + 2 + bob, 10, 7);

  // Deep shadow edge
  ctx.fillStyle = '#7c8ea6';
  ctx.fillRect(px + 3, py + 4 + bob, 10, 5);

  // Mid-tone helmet shade
  ctx.fillStyle = '#a8bcd4';
  ctx.fillRect(px + 4, py + 3 + bob, 8, 6);

  // Bright white helmet face
  ctx.fillStyle = '#e8f0fc';
  ctx.fillRect(px + 4, py + 2 + bob, 8, 6);

  // Top specular highlight
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px + 5, py + 2 + bob, 6, 2);

  // 3. Face Plate & Eyes based on facing direction
  if (facing === 'down') {
    // Front facing visor
    ctx.fillStyle = '#20283c'; // visor bezel
    ctx.fillRect(px + 4, py + 3 + bob, 8, 5);

    ctx.fillStyle = '#ffb498'; // warm peach face
    ctx.fillRect(px + 5, py + 4 + bob, 6, 4);

    // Cute pink blush
    ctx.fillStyle = '#ff708c';
    ctx.fillRect(px + 5, py + 7 + bob, 1, 1);
    ctx.fillRect(px + 10, py + 7 + bob, 1, 1);

    // 2 Oval pill eyes with white glints
    ctx.fillStyle = '#0e1220';
    ctx.fillRect(px + 6, py + 5 + bob, 1, 2);
    ctx.fillRect(px + 9, py + 5 + bob, 1, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 6, py + 5 + bob, 1, 1);
    ctx.fillRect(px + 9, py + 5 + bob, 1, 1);
  } else if (facing === 'up') {
    // Back facing: helmet rear with dark blue-gray neckline seam
    ctx.fillStyle = '#8294ac';
    ctx.fillRect(px + 5, py + 6 + bob, 6, 2);
    ctx.fillStyle = '#283448';
    ctx.fillRect(px + 5, py + 8 + bob, 6, 1);
  } else if (facing === 'left') {
    // Profile facing left
    ctx.fillStyle = '#20283c';
    ctx.fillRect(px + 3, py + 3 + bob, 7, 5);

    ctx.fillStyle = '#ffb498';
    ctx.fillRect(px + 4, py + 4 + bob, 5, 4);

    ctx.fillStyle = '#ff708c';
    ctx.fillRect(px + 4, py + 7 + bob, 1, 1);

    // Single profile pill eye
    ctx.fillStyle = '#0e1220';
    ctx.fillRect(px + 5, py + 5 + bob, 1, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 5, py + 5 + bob, 1, 1);
  } else if (facing === 'right') {
    // Profile facing right
    ctx.fillStyle = '#20283c';
    ctx.fillRect(px + 6, py + 3 + bob, 7, 5);

    ctx.fillStyle = '#ffb498';
    ctx.fillRect(px + 7, py + 4 + bob, 5, 4);

    ctx.fillStyle = '#ff708c';
    ctx.fillRect(px + 11, py + 7 + bob, 1, 1);

    // Single profile pill eye
    ctx.fillStyle = '#0e1220';
    ctx.fillRect(px + 10, py + 5 + bob, 1, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 10, py + 5 + bob, 1, 1);
  }

  // 4. Color-Coded Multi-Tone Body Suit
  // Deep shadow sides
  ctx.fillStyle = pal.dark;
  ctx.fillRect(px + 4, py + 9 + bob, 8, 3);
  // Mid suit body
  ctx.fillStyle = pal.mid;
  ctx.fillRect(px + 5, py + 9 + bob, 6, 3);
  // Light chest highlight
  ctx.fillStyle = pal.light;
  ctx.fillRect(px + 6, py + 9 + bob, 4, 1);

  // White gloved hands
  ctx.fillStyle = '#f0f4fc';
  ctx.fillRect(px + 3, py + 10 + bob, 1, 2);
  ctx.fillRect(px + 12, py + 10 + bob, 1, 2);

  // 5. Dark Leather Belt with Golden Buckle
  ctx.fillStyle = '#10141c';
  ctx.fillRect(px + 4, py + 12 + bob, 8, 1);
  ctx.fillStyle = '#ffd420';
  ctx.fillRect(px + 7, py + 12 + bob, 2, 1);

  // 6. Shaded Boots with Step Walking Animation
  const footL = step === 0 ? 0 : 1;
  const footR = step === 0 ? 1 : 0;

  // Left boot
  ctx.fillStyle = pal.boots;
  ctx.fillRect(px + 4, py + 13 + footL, 3, 2);
  ctx.fillStyle = pal.bootSole;
  ctx.fillRect(px + 4, py + 15, 3, 1);

  // Right boot
  ctx.fillStyle = pal.boots;
  ctx.fillRect(px + 9, py + 13 + footR, 3, 2);
  ctx.fillStyle = pal.bootSole;
  ctx.fillRect(px + 9, py + 15, 3, 1);

  // 7. "YOU" Indicator Arrow
  if (isYou) {
    const arrowY = py - 6 + Math.round(Math.sin(timeMs / 120) * 1.5);
    // Drop shadow
    ctx.fillStyle = '#06101c';
    ctx.beginPath();
    ctx.moveTo(px + 8, arrowY + 5);
    ctx.lineTo(px + 4, arrowY + 1);
    ctx.lineTo(px + 12, arrowY + 1);
    ctx.closePath();
    ctx.fill();

    // Cyan arrow body
    ctx.fillStyle = '#28e4ff';
    ctx.beginPath();
    ctx.moveTo(px + 8, arrowY + 4);
    ctx.lineTo(px + 5, arrowY);
    ctx.lineTo(px + 11, arrowY);
    ctx.closePath();
    ctx.fill();

    // Bright highlight edge
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 7, arrowY + 1, 2, 1);
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
  const [isLandscape, setIsLandscape] = React.useState(false);

  const [flipped, setFlipped] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('bomberman_controls_flipped') === 'true';
    } catch {
      return false;
    }
  });

  const toggleFlip = React.useCallback(() => {
    setFlipped((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('bomberman_controls_flipped', String(next));
      } catch {
        /* private browsing */
      }
      sfx.blip();
      return next;
    });
  }, []);

  // Direction facing tracking per player (id -> dir)
  const facingMapRef = React.useRef<Record<string, Dir>>({});
  const lastPlayerPosRef = React.useRef<Record<string, { x: number; y: number }>>({});

  // Screen shake on detonations
  const shakeRef = React.useRef(0);

  // Floating notifications (+1000 KOS, powerup badges)
  const popupsRef = React.useRef<FloatingPopup[]>([]);
  const nextPopupIdRef = React.useRef(1);

  // Soft block destruction crumble particles (capped at 48 max for mobile performance)
  const crumblesRef = React.useRef<CrumbleParticle[]>([]);
  const prevGridRef = React.useRef<number[]>([]);

  // Detect soft blocks destroyed by blast detonations and spawn 16-bit brick rubble
  React.useEffect(() => {
    if (prevGridRef.current.length === grid.length) {
      const rubbleColors = ['#f07438', '#c84a1c', '#9c3214', '#5c1808', '#ff9a5c', '#d65824'];
      for (let i = 0; i < grid.length; i++) {
        if (prevGridRef.current[i] === TILE_SOFT && grid[i] === TILE_EMPTY) {
          const gx = i % ARENA_W;
          const gy = Math.floor(i / ARENA_W);
          const px = gx * TILE_PX + 2;
          const py = gy * TILE_PX + 2;
          // Spawn 6-8 particles
          for (let p = 0; p < 7; p++) {
            if (crumblesRef.current.length >= 48) {
              crumblesRef.current.shift();
            }
            crumblesRef.current.push({
              x: px + (p % 3) * 4 + Math.random() * 2,
              y: py + Math.floor(p / 3) * 4 + Math.random() * 2,
              vx: (Math.random() - 0.5) * 1.8,
              vy: -Math.random() * 1.6 - 0.4,
              color: rubbleColors[p % rubbleColors.length]!,
              size: p % 2 === 0 ? 2 : 1,
              born: Date.now(),
              duration: 380,
            });
          }
        }
      }
    }
    prevGridRef.current = [...grid];
  }, [grid]);

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

      // Reserve space for top HUD (~40px) and bottom touch controls (~175px in portrait)
      const availW = landscape ? Math.max(180, w - 240) : Math.max(180, w - 16);
      const availH = landscape ? Math.max(160, h - 50) : Math.max(160, h - 220);
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

      // (c2) Draw Destruction Crumble Particles
      crumblesRef.current = crumblesRef.current.filter((p) => now - p.born < p.duration);
      for (const p of crumblesRef.current) {
        const age = (now - p.born) / 1000;
        const curX = p.x + p.vx * age * 28;
        const curY = p.y + p.vy * age * 28 + 0.5 * 160 * age * age; // gravity fall
        octx.fillStyle = p.color;
        octx.fillRect(Math.round(curX), Math.round(curY), p.size, p.size);
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
      const bombSet = new Set(bombs.map((b) => `${b.x},${b.y}`));
      const sortedPlayers = [...viewPlayers].sort((a, b) => a.y - b.y);
      for (const p of sortedPlayers) {
        const px = p.x * TILE_PX;
        const py = p.y * TILE_PX;
        const facing = facingMapRef.current[p.id] ?? 'down';
        const isOnBomb = bombSet.has(`${p.x},${p.y}`);
        drawPlayer(octx, px, py, p, p.id === youId, facing, now, isOnBomb);
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
        ctx.fillText(pop.text, screenX + 1, screenY);
        ctx.fillText(pop.text, screenX - 1, screenY);
        ctx.fillText(pop.text, screenX, screenY + 1);
        ctx.fillText(pop.text, screenX, screenY - 1);
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

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col items-center justify-start gap-1 p-1 sm:p-2 overflow-hidden select-none touch-none bg-pa-bg font-display"
    >
      {/* TOP HUD BAR: 16-Bit Sega Genesis Arcade Dashboard */}
      <div className="w-full max-w-2xl flex items-center justify-between px-3 py-1.5 bg-[#0e1424] border-2 border-[#243454] shadow-[0_2px_8px_rgba(0,0,0,0.6),2px_2px_0_#060810] z-20 text-xs shrink-0">
        {/* Alive & Kills */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#141e36] px-2 py-0.5 border border-[#2a406c] shadow-[1px_1px_0_#000]">
            <span className="text-[9px] text-[#7ea0d4] uppercase tracking-wider font-bold">ALIVE:</span>
            <span className="font-bold text-[#38e0ff] tabular text-[11px]">
              {alivePlayers.length}/{viewPlayers.length}
            </span>
          </div>
          {you && (
            <div className="flex items-center gap-1 bg-[#240e14] px-2 py-0.5 border border-[#641c28] shadow-[1px_1px_0_#000]">
              <span className="text-[10px]">💀</span>
              <span className="text-[9px] text-[#ff8094] uppercase tracking-wider font-bold">KOS:</span>
              <span className="font-bold text-[#ff3858] tabular text-[11px]">{you.kills}</span>
            </div>
          )}
        </div>

        {/* Powers HUD & Flip Control Button */}
        {you ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Flip D-Pad and Bomb controls layout (left/right hand)"
              title="Flip D-Pad and Bomb controls layout (left/right hand)"
              onClick={toggleFlip}
              className="h-6 px-1.5 bg-[#141e36] border border-[#2a406c] text-pa-amber hover:text-pa-ink font-display text-[8px] sm:text-[9px] font-semibold flex items-center gap-1 active:bg-[#1a2848] cursor-pointer shadow-[1px_1px_0_#000] select-none touch-manipulation shrink-0"
            >
              <span className="text-[10px] leading-none">⇄</span>
              <span>{flipped ? 'PAD R' : 'PAD L'}</span>
            </button>
            <div title="Blast Radius" className="flex items-center gap-1 bg-[#241006] px-2 py-0.5 border border-[#68240a] shadow-[1px_1px_0_#000]">
              <span className="text-[10px]">🔥</span>
              <span className="text-[9px] text-[#ff9438] font-bold">R</span>
              <span className="font-bold text-[#ffea20] tabular text-[11px]">{you.blastRadius}</span>
            </div>
            <div title="Max Bombs" className="flex items-center gap-1 bg-[#141a28] px-2 py-0.5 border border-[#2c3e60] shadow-[1px_1px_0_#000]">
              <span className="text-[10px]">💣</span>
              <span className="text-[9px] text-[#90b2e8] font-bold">B</span>
              <span className="font-bold text-[#ffd420] tabular text-[11px]">{you.maxBombs}</span>
            </div>
            {you.speed > 0 && (
              <div title="Speed Boost" className="flex items-center gap-1 bg-[#0a2024] px-1.5 py-0.5 border border-[#14545e] shadow-[1px_1px_0_#000]">
                <span className="text-[10px]">⚡</span>
                <span className="font-bold text-[#28e4ff] tabular text-[11px]">+{you.speed}</span>
              </div>
            )}
            {you.hasPass && (
              <div title="Pass Through Bombs" className="flex items-center gap-1 bg-[#200c30] px-1.5 py-0.5 border border-[#5c1c8a] shadow-[1px_1px_0_#000] text-[#d67cff]">
                <span className="text-[10px]">👻</span>
                <span className="text-[9px] font-bold tracking-wider">PASS</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-[#141e36] px-2 py-0.5 border border-[#2a406c] text-[10px] font-bold tracking-wider text-[#38e0ff] animate-pulse">
            <span>👁️</span> SPECTATING
          </div>
        )}
      </div>

      {/* CENTER ARENA AREA */}
      <div className="relative w-full flex items-center justify-center my-0.5 sm:my-1 min-h-0 shrink-0">
        <div
          className="relative border-4 border-[#1e2a44] shadow-[0_0_16px_rgba(0,0,0,0.8),3px_3px_0_#080c14] bg-[#080c18] overflow-hidden"
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
          <div className={cn(
            'w-full flex items-center justify-between px-4 py-1 z-20 shrink-0',
            flipped && 'flex-row-reverse',
          )}>
            {/* D-pad */}
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

            {/* Dedicated Bomb Button */}
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
          /* Portrait Controls: D-Pad + BOMB button with left/right hand flipping (matching Tetris) */
          <div className="w-full max-w-md flex flex-col items-center gap-1 z-20 shrink-0 mt-0.5">
            {/* Handedness Alignment Selector */}
            <div className="w-full flex items-center justify-between px-3 pb-0.5 text-[9px] font-display text-pa-ink-dim">
              <span>CONTROLS:</span>
              <button
                type="button"
                onClick={toggleFlip}
                aria-label="Flip D-Pad and Bomb button layout (left/right hand)"
                title="Flip D-Pad and Bomb button layout (left/right hand)"
                className="px-2 py-0.5 border border-pa-border bg-pa-surface text-pa-amber hover:text-pa-ink flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-[1px_1px_0_var(--color-pa-shadow)] select-none touch-manipulation font-semibold"
              >
                <span>⇄</span>
                <span>{flipped ? 'D-PAD: RIGHT (FLIPPED)' : 'D-PAD: LEFT (DEFAULT)'}</span>
              </button>
            </div>

            <div className={cn(
              'w-full flex items-center justify-between gap-3 px-3 sm:px-6',
              flipped && 'flex-row-reverse',
            )}>
              {/* 165px D-Pad */}
              <div className="grid grid-cols-3 grid-rows-3 w-[165px] h-[165px] sm:w-[180px] sm:h-[180px] gap-1 touch-none select-none shrink-0">
                <div />
                <TouchButton
                  label="Move Up"
                  onFire={() => {
                    actionRef.current({ type: 'move', dir: 'up' });
                    sfx.blip();
                  }}
                  repeatMs={110}
                  className="w-full h-full flex items-center justify-center text-xl sm:text-2xl font-bold"
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
                  className="w-full h-full flex items-center justify-center text-xl sm:text-2xl font-bold"
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
                  className="w-full h-full flex items-center justify-center text-xl sm:text-2xl font-bold"
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
                  className="w-full h-full flex items-center justify-center text-xl sm:text-2xl font-bold"
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
