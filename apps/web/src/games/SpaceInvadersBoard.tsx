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

// Palette & Color Tokens (Sega 16-bit Arcade Cyber Aesthetic)
const COLOR_BG_VOID = '#04050d';
const COLOR_GROUND = '#2ee66b';
const COLOR_PLAYER = '#2ee66b';
const COLOR_BULLET = '#ffe438';
const COLOR_BOMB = '#ff3f8e';
const COLOR_UFO = '#ff283d';
const COLOR_SQUID = '#ff3f8e';
const COLOR_CRAB = '#24d6ff';
const COLOR_OCTOPUS = '#8bff30';

// ---------------------------------------------------------------------------
// 16-Bit Sega Genesis / Arcade Multi-Color Sprites
// ---------------------------------------------------------------------------

// 1. SQUID (Alien Row 0 - Top Magenta / Purple Carapace, High Value)
const PALETTE_SQUID: Record<string, string> = {
  K: '#1e0527', // deep bio-shell outline
  P: '#6a0dad', // dark royal purple shade
  M: '#b026ff', // vibrant neon magenta midtone
  H: '#ff77e9', // glossy specular magenta highlight
  W: '#ffffff', // bright glint
  C: '#00f0ff', // glowing cyan compound eyes
  D: '#70ffff', // neon cyan eye core
  T: '#d500f9', // tentacle bio-plasma
};

const SPRITE_SQUID_16BIT: [string[], string[]] = [
  // Frame 0 (tentacles tucked)
  [
    '..KKWWKK..',
    '.KMMHHMMK.',
    'KMMMPPMMMK',
    'KMCD..DCKM',
    'KCDD..DDCK',
    'KMMHHHMMMK',
    '.KPM..MPK.',
    '..KT..TK..',
    '.KT....TK.',
  ],
  // Frame 1 (tentacles flared)
  [
    '..KKWWKK..',
    '.KMMHHMMK.',
    'KMMMPPMMMK',
    'KMCD..DCKM',
    'KCDD..DDCK',
    'KMMHHHMMMK',
    '.KPM..MPK.',
    '.KT....TK.',
    'KT......TK',
  ],
];

// 2. CRAB (Alien Rows 1 & 2 - Mid Metallic Cyan / Cobalt Shell, Yellow Optical Core)
const PALETTE_CRAB: Record<string, string> = {
  K: '#02182b', // deep navy outline
  B: '#05445e', // cobalt shadow
  C: '#189ab4', // metallic steel cyan
  L: '#22e0ff', // bright electric cyan armor plate
  W: '#d4f1f4', // specular chrome glint
  Y: '#ffea00', // glowing amber-yellow eye/reactor core
  O: '#ff9100', // reactor heat core
  R: '#ff3d00', // central hot spot
};

const SPRITE_CRAB_16BIT: [string[], string[]] = [
  // Frame 0 (pincers up)
  [
    '..LK....KL..',
    '.WCK....KCW.',
    'KWCCLLLLCCWK',
    'KCLBBYYBBLCK',
    'KCLLYYYYLLCK',
    'KCLLBBBBLLCK',
    '.KCC....CCK.',
    '.KBK....KBK.',
    'KB........BK',
  ],
  // Frame 1 (pincers down)
  [
    '..LK....KL..',
    'KWCK....KCWK',
    'KCCLLLLLCCLK',
    'KCLBBYYBBLCK',
    'KCLLYYYYLLCK',
    'KCLLBBBBLLCK',
    '.KCW....WCK.',
    '..KB....BK..',
    '.KB......BK.',
  ],
];

// 3. OCTOPUS (Alien Rows 3 & 4 - Bot Electric Lime / Emerald Beast, Yellow Visor)
const PALETTE_OCTOPUS: Record<string, string> = {
  K: '#09210c', // deep bio-carapace rim
  D: '#1b5e20', // deep emerald shadow
  G: '#2e7d32', // rich jungle green
  L: '#76ff03', // vibrant electric lime armor
  W: '#dcedc8', // pale lime specular highlight
  Y: '#ffeb3b', // menacing amber/yellow visor
  R: '#ff1744', // ruby sensor pupil
};

const SPRITE_OCTOPUS_16BIT: [string[], string[]] = [
  // Frame 0 (legs flared)
  [
    '...KKWWKK...',
    '..KLLLLLLK..',
    '.KLDDDDDDLK.',
    'KLGYYDDYYGLK',
    'KLGYRYYRYGLK',
    'KLLLLLLLLLLK',
    '..KLG..GLK..',
    '.KLD....DLK.',
    'KLD......DLK',
  ],
  // Frame 1 (legs folded)
  [
    '...KKWWKK...',
    '..KLLLLLLK..',
    '.KLDDDDDDLK.',
    'KLGYYDDYYGLK',
    'KLGYRYYRYGLK',
    'KLLLLLLLLLLK',
    '..KLGD..GLK.',
    '...KLDDDLK..',
    '....KLLK....',
  ],
];

// 4. PLAYER STARFIGHTER (Sleek 16-Bit Futuristic Interceptor)
const PALETTE_PLAYER: Record<string, string> = {
  K: '#06170c', // hull contour
  D: '#0d381e', // dark military green shadow
  G: '#1b5e20', // forest green armor
  E: '#00e676', // vibrant emerald metallic plating
  S: '#90a4ae', // silver-grey titanium wing plating
  W: '#ffffff', // white cockpit glint & cannon tips
  C: '#00e5ff', // glowing cyan cockpit canopy
  B: '#0091ea', // blue canopy depth
  A: '#ffab00', // plasma conduit
  Y: '#ffea00', // thruster core
  O: '#ff6d00', // thruster rim
};

const SPRITE_PLAYER_16BIT = [
  '.......W.......',
  '......CWC......',
  '.....CCWCC.....',
  'W...SDCBBCD...W',
  'W...SEEEEES...W',
  'WW..SEEEEES..WW',
  'KSSSEEEGEEESSSK',
  '.KSSDEGDGEDSSK.',
  '..KDD.....DDK..',
  '....YY...YY....',
];

// 5. MYSTERY UFO CRUISER (Alien Command Dreadnought Saucer)
const PALETTE_UFO: Record<string, string> = {
  K: '#210206', // dark shadow rim
  R: '#7f0000', // deep crimson shadow
  C: '#d50000', // vibrant crimson hull
  H: '#ff5252', // bright ruby hull highlight
  S: '#78909c', // chrome metallic band shadow
  M: '#cfd8dc', // chrome metallic band
  W: '#ffffff', // specular glint
  D: '#ff1744', // ruby dome core
  P: '#b388ff', // anti-gravity energy coil
};

const SPRITE_UFO_16BIT = [
  '.....KKWWKK.....',
  '...KKRDDDDRKK...',
  '..KCHDDDDDDHCK..',
  'KKSSMMWWWWMMSSKK',
  'KCCCCCCCCCCCCCCK',
  'KSM.M...M...MSMK',
  '.KKRRRRRRRRRRKK.',
  '...KKPPPPPPKK...',
  '.....KKWWKK.....',
];

// 6. ALIEN BOMB (Rotating Electric Plasma Pulse)
const PALETTE_BOMB: Record<string, string> = {
  K: '#310020',
  O: '#ff3d00',
  Y: '#ffea00',
  P: '#e040fb',
  W: '#ffffff',
};

const SPRITE_BOMB_16BIT: [string[], string[], string[], string[]] = [
  ['..Y..', '.KYK.', 'YYYYY', '.KYK.', '..Y..'],
  ['P...P', '.OWO.', '..W..', '.OWO.', 'P...P'],
  ['..O..', '.KOK.', 'OOOOO', '.KOK.', '..O..'],
  ['Y...Y', '.PWP.', '..W..', '.PWP.', 'Y...Y'],
];

/**
 * High-performance run-length batched pixel drawer for multi-color 16-bit matrices
 */
function drawIndexedSprite(
  ctx: CanvasRenderingContext2D,
  matrix: string[],
  palette: Record<string, string>,
  startX: number,
  startY: number,
  pixelSize: number,
) {
  const rows = matrix.length;
  for (let r = 0; r < rows; r++) {
    const row = matrix[r]!;
    const cols = row.length;
    let runChar = '.';
    let runStart = 0;
    let runLen = 0;

    for (let c = 0; c < cols; c++) {
      const char = row[c]!;
      if (char === runChar) {
        runLen++;
      } else {
        if (runLen > 0 && runChar !== '.' && palette[runChar]) {
          ctx.fillStyle = palette[runChar]!;
          ctx.fillRect(startX + runStart * pixelSize, startY + r * pixelSize, runLen * pixelSize, pixelSize);
        }
        runChar = char;
        runStart = c;
        runLen = 1;
      }
    }
    if (runLen > 0 && runChar !== '.' && palette[runChar]) {
      ctx.fillStyle = palette[runChar]!;
      ctx.fillRect(startX + runStart * pixelSize, startY + r * pixelSize, runLen * pixelSize, pixelSize);
    }
  }
}

// ---------------------------------------------------------------------------
// Starfield (Deterministic Deep Cosmic Parallax Grid)
// ---------------------------------------------------------------------------

interface Star {
  x: number;
  y: number;
  size: number;
  color: string;
  twinklePhase: number;
  speed: number;
}

const STARS: Star[] = (() => {
  let s = 1978;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const stars: Star[] = [];
  for (let i = 0; i < 65; i++) {
    const isFg = rand() < 0.2;
    const isMid = rand() < 0.5;
    stars.push({
      x: Math.floor(rand() * CW),
      y: Math.floor(rand() * (CH - 30)),
      size: isFg ? 2 : 1,
      color: isFg
        ? '#ffffff'
        : isMid
          ? rand() < 0.5
            ? '#a5f3fc'
            : '#fde047'
          : rand() < 0.5
            ? '#c084fc'
            : '#86efac',
      twinklePhase: Math.floor(rand() * 8),
      speed: isFg ? 0.8 : isMid ? 0.4 : 0.2,
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
 * Master playfield render routine: draws on any canvas context with authentic 16-bit graphics.
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
    screenShake?: number;
  },
) {
  const scaleX = width / PLAYFIELD_W;
  const scaleY = height / PLAYFIELD_H;
  const tick = options?.tickCount ?? 0;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scaleX / CANVAS_SCALE, scaleY / CANVAS_SCALE);

  // Screen shake on explosions or damage
  if (options?.screenShake && options.screenShake > 0) {
    const intensity = options.screenShake;
    const sx = Math.sin(tick * 2.8) * intensity;
    const sy = Math.cos(tick * 3.4) * intensity * 0.7;
    ctx.translate(sx, sy);
  }

  // 1. 16-Bit Deep Space Nebula Cosmic Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CH);
  bgGrad.addColorStop(0, COLOR_BG_VOID);
  bgGrad.addColorStop(0.4, '#090b1c');
  bgGrad.addColorStop(0.8, '#100e26');
  bgGrad.addColorStop(1, '#050711');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CW, CH);

  // Soft interstellar cosmic dust clouds
  const nebula1 = ctx.createRadialGradient(CW * 0.75, CH * 0.35, 10, CW * 0.75, CH * 0.35, 200);
  nebula1.addColorStop(0, 'rgba(186, 36, 213, 0.14)');
  nebula1.addColorStop(0.6, 'rgba(0, 229, 255, 0.05)');
  nebula1.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebula1;
  ctx.fillRect(0, 0, CW, CH);

  const nebula2 = ctx.createRadialGradient(CW * 0.25, CH * 0.65, 10, CW * 0.25, CH * 0.65, 180);
  nebula2.addColorStop(0, 'rgba(34, 224, 255, 0.09)');
  nebula2.addColorStop(0.6, 'rgba(106, 13, 173, 0.05)');
  nebula2.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebula2;
  ctx.fillRect(0, 0, CW, CH);

  // 2. Parallax Drifting & Twinkling Multi-Tier Starfield
  for (const star of STARS) {
    const starY = (star.y + tick * star.speed * 0.15) % (CH - 30);
    const isDim = (tick + star.twinklePhase) % 5 === 0;
    const isBright = (tick + star.twinklePhase) % 5 === 2;
    const alpha = isDim ? 0.3 : isBright ? 1.0 : 0.7;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = star.color;
    ctx.fillRect(star.x, starY, star.size, star.size);

    // Foreground 4-point cross diffraction sparkle for bright stars
    if (star.size > 1.5 && isBright) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(star.x - 1, starY, 3, 1);
      ctx.fillRect(star.x, starY - 1, 1, 3);
    }
  }
  ctx.globalAlpha = 1.0;

  // 3. Distant Planetary Horizon Arc & Laser Defense Baseline
  const planetGrad = ctx.createLinearGradient(0, 420, 0, 440);
  planetGrad.addColorStop(0, 'rgba(34, 224, 255, 0.0)');
  planetGrad.addColorStop(0.7, 'rgba(34, 224, 255, 0.06)');
  planetGrad.addColorStop(1, 'rgba(46, 230, 107, 0.12)');
  ctx.fillStyle = planetGrad;
  ctx.fillRect(0, 420, CW, 20);

  // High-tech laser defense grid line
  ctx.fillStyle = '#0a3d1f';
  ctx.fillRect(0, 43 * CANVAS_SCALE + 5, CW, 4);
  ctx.fillStyle = COLOR_GROUND;
  ctx.fillRect(0, 43 * CANVAS_SCALE + 6, CW, 2);

  // Moving energy pulse node along ground line
  const pulseX = (tick * 8) % CW;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(pulseX, 43 * CANVAS_SCALE + 5, 8, 3);
  ctx.fillStyle = 'rgba(34, 224, 255, 0.6)';
  ctx.fillRect(pulseX - 6, 43 * CANVAS_SCALE + 6, 20, 2);

  // 4. High-Tech Modular Fortification Bunkers (Armored Composite Alloy & Power Nodes)
  if (player.bunkers) {
    for (const bunker of player.bunkers) {
      const bx = bunker.x * CANVAS_SCALE;
      const by = bunker.y * CANVAS_SCALE;
      for (let r = 0; r < bunker.height; r++) {
        for (let c = 0; c < bunker.width; c++) {
          const solid = bunker.mask[r * bunker.width + c];
          if (solid) {
            const cx = bx + c * CANVAS_SCALE;
            const cy = by + r * CANVAS_SCALE;

            // Armor plate base
            ctx.fillStyle = '#0d4e29';
            ctx.fillRect(cx, cy, 10, 10);

            // Beveled top and left metallic highlight
            ctx.fillStyle = '#2ee66b';
            ctx.fillRect(cx, cy, 10, 2);
            ctx.fillRect(cx, cy, 2, 10);

            // Specular corner rivet glint
            ctx.fillStyle = '#a6ffcb';
            ctx.fillRect(cx, cy, 2, 2);

            // Beveled bottom and right shadow
            ctx.fillStyle = '#062614';
            ctx.fillRect(cx, cy + 8, 10, 2);
            ctx.fillRect(cx + 8, cy, 2, 10);

            // Central power conduit node
            const conduitGlow = (tick + c + r) % 6 === 0;
            ctx.fillStyle = conduitGlow ? '#00f0ff' : '#148045';
            ctx.fillRect(cx + 3, cy + 3, 4, 4);
            ctx.fillStyle = conduitGlow ? '#ffffff' : '#38ef7d';
            ctx.fillRect(cx + 4, cy + 4, 2, 2);
          }
        }
      }
    }
  }

  // 5. 16-Bit Aliens with Parity-Based March Animation
  const frame: 0 | 1 = Math.abs(player.formationX) % 2 === 0 ? 0 : 1;
  if (player.aliens) {
    for (const alien of player.aliens) {
      if (!alien.alive) continue;
      const ax = (player.formationX + alien.col * 4) * CANVAS_SCALE;
      const ay = (player.formationY + alien.row * 2) * CANVAS_SCALE;

      if (alien.type === 'squid') {
        drawIndexedSprite(ctx, SPRITE_SQUID_16BIT[frame], PALETTE_SQUID, ax + 5, ay - 3, 2);
      } else if (alien.type === 'crab') {
        drawIndexedSprite(ctx, SPRITE_CRAB_16BIT[frame], PALETTE_CRAB, ax + 3, ay - 3, 2);
      } else {
        drawIndexedSprite(ctx, SPRITE_OCTOPUS_16BIT[frame], PALETTE_OCTOPUS, ax + 3, ay - 3, 2);
      }
    }
  }

  // 6. Mystery UFO Cruiser Dreadnought
  if (player.ufo && player.ufo.alive) {
    const ux = player.ufo.x * CANVAS_SCALE;
    const uy = player.ufo.y * CANVAS_SCALE;

    // Anti-gravity downward ion energy pulse
    const ionGrad = ctx.createLinearGradient(ux + 20, uy + 14, ux + 20, uy + 26);
    ionGrad.addColorStop(0, 'rgba(0, 229, 255, 0.45)');
    ionGrad.addColorStop(0.6, 'rgba(224, 64, 251, 0.2)');
    ionGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ionGrad;
    ctx.beginPath();
    ctx.moveTo(ux + 14, uy + 14);
    ctx.lineTo(ux + 26, uy + 14);
    ctx.lineTo(ux + 32, uy + 26);
    ctx.lineTo(ux + 8, uy + 26);
    ctx.closePath();
    ctx.fill();

    // 16-Bit Dreadnought Hull
    drawIndexedSprite(ctx, SPRITE_UFO_16BIT, PALETTE_UFO, ux + 4, uy - 3, 2);

    // Dynamic cycling running lights along perimeter
    const lightColors = ['#ffea00', '#00f0ff', '#76ff03', '#ff007f'];
    const lightOffset = Math.floor(tick / 2) % 4;
    ctx.fillStyle = lightColors[(0 + lightOffset) % 4]!;
    ctx.fillRect(ux + 10, uy + 7, 3, 2);
    ctx.fillStyle = lightColors[(1 + lightOffset) % 4]!;
    ctx.fillRect(ux + 16, uy + 7, 3, 2);
    ctx.fillStyle = lightColors[(2 + lightOffset) % 4]!;
    ctx.fillRect(ux + 22, uy + 7, 3, 2);
    ctx.fillStyle = lightColors[(3 + lightOffset) % 4]!;
    ctx.fillRect(ux + 28, uy + 7, 3, 2);
  }

  // 7. Player Interceptor Starfighter
  if (!player.gameOver) {
    const isBlinking =
      player.respawnGraceTicks !== undefined &&
      player.respawnGraceTicks > 0 &&
      Math.floor(player.respawnGraceTicks / 2) % 2 === 0;
    if (!isBlinking) {
      const px = player.playerX * CANVAS_SCALE;
      const py = player.playerY * CANVAS_SCALE;

      // 16-bit starfighter hull (30px wide, exactly 3 playfield cells)
      drawIndexedSprite(ctx, SPRITE_PLAYER_16BIT, PALETTE_PLAYER, px, py - 4, 2);

      // Animated twin rocket thruster exhaust plumes
      const flameStep = tick % 3;
      const flameH = flameStep === 0 ? 6 : flameStep === 1 ? 8 : 5;
      // Left thruster flame
      ctx.fillStyle = flameStep === 1 ? '#00e5ff' : '#ffea00';
      ctx.fillRect(px + 8, py + 16, 2, flameH);
      ctx.fillStyle = '#ff6d00';
      ctx.fillRect(px + 9, py + 16, 1, flameH + 2);
      // Right thruster flame
      ctx.fillStyle = flameStep === 1 ? '#00e5ff' : '#ffea00';
      ctx.fillRect(px + 20, py + 16, 2, flameH);
      ctx.fillStyle = '#ff6d00';
      ctx.fillRect(px + 20, py + 16, 1, flameH + 2);
    }
  }

  // 8. Player Dual Plasma Laser Bolts
  const bullets =
    player.bullets && player.bullets.length > 0 ? player.bullets : player.bullet ? [player.bullet] : [];
  for (const bullet of bullets) {
    const x = bullet.x * CANVAS_SCALE + 4;
    const y = bullet.y * CANVAS_SCALE;

    // Radiant outer plasma halo
    ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.fillRect(x - 2, y - 4, 6, CANVAS_SCALE + 6);

    // Twin plasma bolts
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(x - 1, y - 2, 1, CANVAS_SCALE);
    ctx.fillRect(x + 2, y - 2, 1, CANVAS_SCALE);

    // White-hot plasma core
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y - 3, 2, CANVAS_SCALE);

    // Trailing ion sparks
    const sparkY = y + CANVAS_SCALE + (tick % 3) * 2;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
    ctx.fillRect(x + 0.5, sparkY, 1, 2);
  }

  // 9. Alien Bombs (Rotating Electric Plasma Spikes)
  if (player.alienBombs) {
    const bombFrame = Math.floor(tick / 2) % 4;
    for (const bomb of player.alienBombs) {
      const bx = bomb.x * CANVAS_SCALE + 2;
      const by = bomb.y * CANVAS_SCALE;

      // Electric plasma corona
      ctx.fillStyle = 'rgba(224, 64, 251, 0.28)';
      ctx.fillRect(bx - 1, by - 1, 12, 12);

      drawIndexedSprite(ctx, SPRITE_BOMB_16BIT[bombFrame], PALETTE_BOMB, bx, by, 2);
    }
  }

  // 10. Multi-Frame 16-Bit Explosions & Impact FX
  if (options?.explosions) {
    for (const exp of options.explosions) {
      const ex = exp.x;
      const ey = exp.y;
      const age = exp.age;

      if (age <= 1) {
        // White-hot flash & circular shockwave
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex + 12, ey + 8, 8 + age * 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#22e0ff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (age <= 3) {
        // Expanding 16-bit fireball with yellow core, orange midtone, magenta rim
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(ex + 8, ey + 4, 8, 8);
        ctx.fillStyle = '#ffea00';
        ctx.fillRect(ex + 4, ey + 2, 16, 12);
        ctx.fillStyle = '#ff6d00';
        ctx.fillRect(ex + 2, ey, 20, 16);
        ctx.fillStyle = '#ff007f';
        ctx.fillRect(ex, ey - 2, 24, 20);

        // Flying sparks in 4 directions
        ctx.fillStyle = '#ffffff';
        const sp = (age - 1) * 6;
        ctx.fillRect(ex + 12 + sp, ey + 8, 2, 2);
        ctx.fillRect(ex + 12 - sp, ey + 8, 2, 2);
        ctx.fillRect(ex + 12, ey + 8 + sp, 2, 2);
        ctx.fillRect(ex + 12, ey + 8 - sp, 2, 2);
      } else if (age <= 5) {
        // Dispersing spark burst & smoke ring
        ctx.fillStyle = 'rgba(255, 109, 0, 0.7)';
        const sp = (age - 1) * 5;
        ctx.fillRect(ex + 12 + sp, ey + 8 + sp, 3, 3);
        ctx.fillRect(ex + 12 - sp, ey + 8 + sp, 3, 3);
        ctx.fillRect(ex + 12 + sp, ey + 8 - sp, 3, 3);
        ctx.fillRect(ex + 12 - sp, ey + 8 - sp, 3, 3);

        ctx.fillStyle = 'rgba(255, 234, 0, 0.8)';
        ctx.fillRect(ex + 12 + sp * 1.3, ey + 8, 2, 2);
        ctx.fillRect(ex + 12 - sp * 1.3, ey + 8, 2, 2);
        ctx.fillRect(ex + 12, ey + 8 + sp * 1.3, 2, 2);
        ctx.fillRect(ex + 12, ey + 8 - sp * 1.3, 2, 2);

        // Lingering smoke
        ctx.fillStyle = 'rgba(80, 50, 90, 0.35)';
        ctx.fillRect(ex + 6, ey + 4, 12, 10);
      } else {
        // Fading dark smoke puffs
        ctx.fillStyle = 'rgba(50, 40, 60, 0.25)';
        const sp = age * 4;
        ctx.fillRect(ex + 12 + sp, ey + 8 - sp * 0.5, 3, 3);
        ctx.fillRect(ex + 12 - sp, ey + 8 - sp * 0.5, 3, 3);
      }
    }
  }

  // 11. Floating 16-Bit Score Popups
  if (options?.popups) {
    ctx.font = 'bold 12px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    for (const pop of options.popups) {
      const py = pop.y - pop.age * 2;
      // High-contrast dark shadow outline
      ctx.fillStyle = '#05060d';
      ctx.fillText(pop.text, pop.x + 1, py + 1);
      ctx.fillText(pop.text, pop.x - 1, py - 1);
      ctx.fillText(pop.text, pop.x + 1, py - 1);
      ctx.fillText(pop.text, pop.x - 1, py + 1);
      // Glowing text
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, py);
    }
    ctx.textAlign = 'start';
  }

  ctx.restore();
}

/**
 * Tactile arcade pushbutton with auto-repeat on hold and instant active states
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
      className={`touch-none select-none font-display transition-all duration-75 cursor-pointer ${
        className ?? ''
      } ${pressed ? 'btn-pressed translate-y-0.5' : ''}`}
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

/**
 * 16-Bit Mini Starfighter Icon for HUD Ships / Lives
 */
function MiniShipIcon({ color = '#2ee66b' }: { color?: string }) {
  return (
    <svg
      width={20}
      height={14}
      viewBox="0 0 20 14"
      aria-hidden="true"
      className="inline-block shrink-0 drop-shadow-[0_0_4px_rgba(46,230,107,0.5)]"
    >
      {/* Hull & Wings */}
      <path
        fill={color}
        d="M9 1h2v2h2v2h4v5h-2v2h-1v-2h-3v1h-2v-1H6v2H5v-2H3V5h4V3h2V1z"
      />
      {/* White Aerodynamic Highlights & Cannon Tips */}
      <path fill="#ffffff" d="M9 1h2v1H9z M3 5h2v2H3z M15 5h2v2h-2z" />
      {/* Glowing Cyan Canopy */}
      <path fill="#00e5ff" d="M9 4h2v2H9z" />
      {/* Ion Thrusters */}
      <path fill="#ffab00" d="M7 11h2v2H7z M11 11h2v2h-2z" />
    </svg>
  );
}

/**
 * Spectator Mini-Board for another player with 16-bit rendering
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
    <div className="flex flex-col items-center gap-1.5 p-2 bg-pa-surface border-2 border-pa-border shadow-[2px_2px_0_var(--color-pa-shadow)] rounded-xl">
      <div className="flex items-center justify-between w-full text-xs font-display tabular px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-pa-ink font-bold truncate max-w-[90px]">{displayName}</span>
        </div>
        <span className="text-pa-cyan font-bold">{player.score}</span>
      </div>

      <div className="relative border-2 border-pa-border bg-pa-bg rounded-lg overflow-hidden">
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
  youId: _youId,
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
  const youRef = React.useRef(you);
  youRef.current = you;

  const paused = useRoom((s) => s.paused);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const slideTrackRef = React.useRef<HTMLDivElement | null>(null);

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
      setIsLandscape(w > h && w >= 680);
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

  // Ephemeral visual effects refs (explosions, score popups, screen shake)
  const explosionsRef = React.useRef<EphemeralExplosion[]>([]);
  const scorePopupsRef = React.useRef<EphemeralScorePopup[]>([]);
  const nextEffectIdRef = React.useRef(1);
  const tickCounterRef = React.useRef(0);
  const screenShakeRef = React.useRef(0);

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
  const [touchActiveX, setTouchActiveX] = React.useState<number | null>(null);

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

    // Player lost life: trigger explosion + screen shake
    if (you.lives < prevLivesRef.current) {
      sfx.gameOver();
      screenShakeRef.current = 8;
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
      screenShakeRef.current = 4;
      sfx.correct();
      const t = window.setTimeout(() => setWaveClearFlash(false), 2000);
      return () => window.clearTimeout(t);
    }

    // UFO destruction or high score pop
    if (you.score > prevScoreRef.current + 40 && prevScoreRef.current > 0) {
      customSfx.invaderExplosion?.() ?? sfx.tembak();
      screenShakeRef.current = 6;
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

  // -------------------------------------------------------------------------
  // Input Responsiveness: Fire-and-forget direct socket emit + coalescing
  // -------------------------------------------------------------------------

  const lastMoveTimeRef = React.useRef(0);
  const lastMoveDirRef = React.useRef<'left' | 'right' | null>(null);

  const dispatchMove = React.useCallback((dir: 'left' | 'right') => {
    const now = performance.now();
    if (lastMoveDirRef.current === dir && now - lastMoveTimeRef.current < 35) {
      return;
    }
    lastMoveTimeRef.current = now;
    lastMoveDirRef.current = dir;
    void emit(EV.gameAction, { type: 'move', dir });
    sfx.blip();
  }, []);

  const dispatchFire = React.useCallback(() => {
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

  // Continuous 60fps RequestAnimationFrame render loop for smooth star twinkling & thruster animation
  React.useEffect(() => {
    let animId: number;
    const render = () => {
      const canvas = canvasRef.current;
      const currentPlayer = youRef.current;
      if (canvas && currentPlayer) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          tickCounterRef.current += 1;

          // Decay screen shake
          if (screenShakeRef.current > 0) {
            screenShakeRef.current = Math.max(0, screenShakeRef.current - 0.4);
          }

          // Age out explosions and score popups at steady cadence
          if (tickCounterRef.current % 4 === 0) {
            explosionsRef.current = explosionsRef.current
              .map((e) => ({ ...e, age: e.age + 1 }))
              .filter((e) => e.age < 8);
            scorePopupsRef.current = scorePopupsRef.current
              .map((p) => ({ ...p, age: p.age + 1 }))
              .filter((p) => p.age < 20);
          }

          renderPlayfieldCanvas(ctx, currentPlayer, canvas.width, canvas.height, {
            explosions: explosionsRef.current,
            popups: scorePopupsRef.current,
            tickCount: tickCounterRef.current,
            screenShake: screenShakeRef.current,
          });
        }
      }
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

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
        if (e.repeat) return;
        dispatchFire();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [you?.gameOver, view.phase, dispatchMove, dispatchFire, you]);

  // -------------------------------------------------------------------------
  // Touch Slide / Drag & Tap-to-Fire Gestures (Canvas & Navigation Runway)
  // -------------------------------------------------------------------------
  const slideGestureRef = React.useRef<{
    startX: number;
    lastX: number;
    hasMoved: boolean;
  } | null>(null);

  const handlePointerDownGesture = (e: React.PointerEvent<HTMLElement>) => {
    if (!you || you.gameOver || view.phase === 'game_over') return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setTouchActiveX(e.clientX - rect.left);
    slideGestureRef.current = {
      startX: e.clientX,
      lastX: e.clientX,
      hasMoved: false,
    };
  };

  const handlePointerMoveGesture = (e: React.PointerEvent<HTMLElement>) => {
    if (!slideGestureRef.current || !you || you.gameOver || view.phase === 'game_over') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTouchActiveX(e.clientX - rect.left);

    const deltaFromLast = e.clientX - slideGestureRef.current.lastX;
    const totalDelta = Math.abs(e.clientX - slideGestureRef.current.startX);

    if (totalDelta > 6) {
      slideGestureRef.current.hasMoved = true;
    }

    // Direct step threshold: ~8px per move action
    if (Math.abs(deltaFromLast) >= 8) {
      const dir = deltaFromLast > 0 ? 'right' : 'left';
      dispatchMove(dir);
      slideGestureRef.current.lastX = e.clientX;
    }
  };

  const handlePointerUpGesture = (e: React.PointerEvent<HTMLElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }
    } catch {
      // ignore
    }
    if (slideGestureRef.current && !slideGestureRef.current.hasMoved) {
      // Direct tap without drag -> Fire cannon!
      dispatchFire();
    }
    slideGestureRef.current = null;
    setTouchActiveX(null);
  };

  // Spectator view when !you
  if (!you) {
    const playerList = (players as PlayerLike[]) ?? [];
    const activePlayers = view.players.filter((p) => !p.gameOver);
    const spectated = activePlayers.length > 0 ? activePlayers : view.players;

    return (
      <div className="w-full h-full overflow-auto p-3 sm:p-4 bg-pa-bg flex flex-col items-center">
        <div className="text-center font-display text-xs tracking-widest text-pa-cyan mb-4 drop-shadow-[0_0_8px_rgba(34,224,255,0.5)]">
          ★ SEGA 16-BIT ARCADE SPECTATOR STATION ★
        </div>
        {spectated.length === 0 ? (
          <div className="text-pa-ink-dim text-sm text-center">Waiting for starfighters…</div>
        ) : (
          <div className="flex flex-wrap gap-4 justify-center items-start max-w-5xl">
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

  // Responsive canvas dimensions (64:44 aspect ratio)
  // In portrait: canvas fills the width of the screen naturally (max 540px), maximizing screen real estate
  // In landscape: centered cabinet monitor
  const reservedHeaderHeight = isLandscape ? 52 : 56;
  const reservedControlsHeight = isLandscape ? 0 : 180;
  const availW = isLandscape ? Math.max(300, containerSize.w - 320) : Math.min(containerSize.w - 12, 540);
  const availH = Math.max(160, containerSize.h - reservedHeaderHeight - reservedControlsHeight);

  const scale = Math.min(availW / CW, availH / CH);
  const displayW = Math.floor(CW * scale);
  const displayH = Math.floor(CH * scale);

  const highestScore = Math.max(you.score, ...view.players.map((p) => p.score));

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
      {/* 16-Bit Sega Arcade Custom Style Rules */}
      <style>{`
        @keyframes arcade-glow-ring {
          0%, 100% {
            box-shadow: 0 0 16px rgba(255, 40, 61, 0.6), inset 0 0 10px rgba(255, 40, 61, 0.4);
          }
          50% {
            box-shadow: 0 0 30px rgba(255, 40, 61, 0.95), 0 0 45px rgba(255, 77, 77, 0.45), inset 0 0 16px rgba(255, 77, 77, 0.6);
          }
        }
        .arcade-fire-btn {
          animation: arcade-glow-ring 2s ease-in-out infinite;
          border-radius: 20px !important;
        }
        .arcade-fire-btn:active, .arcade-fire-btn.btn-pressed {
          transform: translateY(3px) scale(0.96);
          box-shadow: 0 0 32px rgba(255, 40, 61, 1), inset 0 0 24px rgba(255, 255, 255, 0.9) !important;
        }
        .arcade-thumb-btn {
          border-radius: 18px !important;
          box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.2), 0 4px 0 var(--color-pa-shadow);
        }
        .arcade-thumb-btn:active, .arcade-thumb-btn.btn-pressed {
          transform: translateY(3px);
          box-shadow: inset 0 3px 6px rgba(0, 0, 0, 0.6), 0 1px 0 var(--color-pa-shadow) !important;
        }
        .arcade-cabinet-frame {
          border-radius: 16px !important;
          box-shadow: 0 0 36px rgba(0, 0, 0, 0.9), inset 0 0 20px rgba(0, 0, 0, 0.85);
        }
      `}</style>

      {/* ----------------- Top 16-Bit Arcade Marquee HUD ----------------- */}
      <div className="w-full max-w-4xl flex items-center justify-between px-3 sm:px-5 py-2 bg-gradient-to-b from-pa-surface/95 to-pa-bg/95 backdrop-blur-md border-b-2 border-pa-border z-10 shrink-0 shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
        {/* 1UP & Current Score */}
        <div className="flex items-center gap-4 sm:gap-6 font-display">
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="text-[10px] text-pa-magenta font-bold tracking-wider animate-pulse drop-shadow-[0_0_6px_rgba(255,63,142,0.8)]">
                1UP
              </span>
              <span className="text-[9px] text-pa-ink-dim tracking-wider uppercase">SCORE</span>
            </div>
            <div className="text-base sm:text-xl text-pa-cyan font-bold tabular tracking-wider drop-shadow-[0_0_8px_rgba(34,224,255,0.7)] mt-0.5">
              {String(you.score).padStart(5, '0')}
            </div>
          </div>

          {/* High Score */}
          <div className="border-l border-pa-border/80 pl-3 sm:pl-4">
            <div className="text-[9px] text-pa-amber font-bold tracking-wider uppercase drop-shadow-[0_0_4px_rgba(255,176,32,0.5)]">
              HIGH
            </div>
            <div className="text-base sm:text-xl text-pa-amber font-bold tabular tracking-wider drop-shadow-[0_0_8px_rgba(255,176,32,0.6)] mt-0.5">
              {String(highestScore).padStart(5, '0')}
            </div>
          </div>

          {/* Rapid Fire Indicator */}
          {you.maxBullets && you.maxBullets > 1 && (
            <div className="hidden sm:inline-block px-2 py-0.5 bg-pa-amber/20 border border-pa-amber text-pa-amber text-[9px] font-display rounded-md animate-pulse shadow-[0_0_8px_rgba(255,176,32,0.4)]">
              RAPID FIRE x{you.maxBullets}
            </div>
          )}
        </div>

        {/* Wave & Lives Ship Fleet */}
        <div className="flex items-center gap-4 font-display">
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5 leading-none">
              <span className="text-[9px] text-pa-lime font-bold tracking-wider uppercase">
                WAVE {you.wave}
              </span>
              <span className="text-[9px] text-pa-ink-dim tracking-wider uppercase">LIVES</span>
            </div>
            <div className="flex items-center justify-end gap-1.5 h-4 mt-1">
              {Array.from({ length: Math.max(0, you.lives) }).map((_, i) => (
                <MiniShipIcon key={i} color="#2ee66b" />
              ))}
              {you.lives <= 0 && (
                <span className="text-[9px] text-pa-danger font-bold animate-pulse">CRITICAL</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ----------------- Center Playfield & Cabinet Screen ----------------- */}
      <div className="relative flex-1 w-full flex items-center justify-center min-h-0 overflow-hidden py-1">
        {/* Landscape Left Arcade Marquee Card */}
        {isLandscape && (
          <div className="hidden lg:flex flex-col gap-3 w-56 p-3 mr-4 bg-pa-surface/85 border-2 border-pa-border rounded-xl shadow-[2px_2px_0_var(--color-pa-shadow)] font-display text-xs z-10 shrink-0">
            <div className="text-center font-bold text-pa-cyan tracking-wider border-b border-pa-border pb-1.5 text-[11px]">
              ★ SEGA 16-BIT CAB ★
            </div>
            <div className="space-y-2 text-[10px]">
              <div className="flex justify-between">
                <span className="text-pa-ink-dim">CANNON</span>
                <span className="text-pa-success font-bold">STARFIGHTER</span>
              </div>
              <div className="flex justify-between">
                <span className="text-pa-ink-dim">KILLS</span>
                <span className="text-pa-ink font-bold tabular">{55 - (you.aliveCount ?? 55)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-pa-ink-dim">FIRE RATE</span>
                <span className="text-pa-amber font-bold">{you.maxBullets && you.maxBullets > 1 ? `x${you.maxBullets} RAPID` : 'NORMAL'}</span>
              </div>
            </div>

            <div className="border-t border-pa-border pt-2 text-[9px] text-pa-ink-dim space-y-1">
              <div className="text-pa-ink font-bold">KEYBOARD:</div>
              <div>[A] / [◀] STEER LEFT</div>
              <div>[D] / [▶] STEER RIGHT</div>
              <div>[SPACE] FIRE CANNON</div>
            </div>
          </div>
        )}

        {/* Master Game Cabinet Bezel */}
        <div
          className="relative border-4 border-pa-border bg-pa-bg overflow-hidden flex items-center justify-center arcade-cabinet-frame shadow-[0_0_28px_rgba(0,0,0,0.85)]"
          style={{ width: displayW, height: displayH }}
        >
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            onPointerDown={handlePointerDownGesture}
            onPointerMove={handlePointerMoveGesture}
            onPointerUp={handlePointerUpGesture}
            onPointerCancel={handlePointerUpGesture}
            className="w-full h-full block cursor-crosshair touch-none"
            style={{ imageRendering: 'pixelated' }}
          />

          {/* CRT Scanline Overlay & Subtle CRT Tube Vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1px, transparent 1px, transparent 2px)',
              boxShadow: 'inset 0 0 36px rgba(0,0,0,0.8)',
            }}
          />

          {/* Wave Cleared Flash Banner */}
          {waveClearFlash && (
            <div className="absolute inset-0 bg-pa-bg/85 backdrop-blur-[2px] flex flex-col items-center justify-center animate-pulse pointer-events-none z-20">
              <div className="font-display text-pa-cyan text-xl sm:text-3xl font-bold tracking-widest drop-shadow-[0_0_14px_rgba(34,224,255,1)]">
                WAVE CLEARED!
              </div>
              <div className="font-display text-pa-ink text-xs sm:text-base mt-2">
                PREPARE FOR WAVE {you.wave}
              </div>
              {you.maxBullets && you.maxBullets > 1 && (
                <div className="font-display text-pa-amber text-xs sm:text-sm mt-1 animate-bounce">
                  ★ RAPID PLASMA ACTIVATED ★
                </div>
              )}
            </div>
          )}

          {/* Game Over Overlay */}
          {isGameOver && (
            <div className="absolute inset-0 bg-pa-bg/90 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 z-20">
              <div className="font-display text-pa-danger text-2xl sm:text-4xl font-bold tracking-widest mb-2 animate-bounce drop-shadow-[0_0_12px_rgba(255,77,77,0.8)]">
                GAME OVER
              </div>
              <div className="font-display text-pa-ink text-sm sm:text-lg mb-1">
                FINAL SCORE: <span className="text-pa-cyan font-bold tabular">{you.score}</span>
              </div>
              <div className="font-display text-pa-ink-dim text-xs sm:text-sm">
                SURVIVED TO WAVE {you.wave} · KILLS: {55 - (you.aliveCount ?? 55)}
              </div>
            </div>
          )}
        </div>

        {/* Landscape Right Opponents Spectator Panel */}
        {isLandscape && opponents.length > 0 && (
          <div className="hidden xl:flex flex-col gap-3 w-56 ml-4 max-h-[440px] overflow-y-auto z-10 shrink-0">
            <div className="text-center font-display text-[10px] text-pa-ink-dim tracking-wider uppercase">
              RIVAL DEFENDERS
            </div>
            {opponents.map((opp) => {
              const info = resolvePlayer(playerList, opp.id);
              const color = SEAT_COLORS[opp.seat % SEAT_COLORS.length] ?? '#2ee66b';
              return (
                <SpaceInvadersSpectatorBoard
                  key={opp.id}
                  player={opp}
                  displayName={info.displayName}
                  color={color}
                />
              );
            })}
          </div>
        )}

        {/* Floating Side Touch Controls for Landscape Tablets / Handhelds */}
        {isLandscape && (
          <>
            <div className="absolute left-3 bottom-3 flex gap-2 z-30">
              <TouchControlBtn
                label="Move Left"
                onFire={() => dispatchMove('left')}
                repeatMs={70}
                className="w-16 h-16 bg-pa-surface/90 text-xl font-bold flex items-center justify-center border-2 border-pa-border arcade-thumb-btn text-pa-cyan"
              >
                ◀
              </TouchControlBtn>
              <TouchControlBtn
                label="Move Right"
                onFire={() => dispatchMove('right')}
                repeatMs={70}
                className="w-16 h-16 bg-pa-surface/90 text-xl font-bold flex items-center justify-center border-2 border-pa-border arcade-thumb-btn text-pa-cyan"
              >
                ▶
              </TouchControlBtn>
            </div>
            <div className="absolute right-3 bottom-3 z-30">
              <TouchControlBtn
                label="Fire Cannon"
                onFire={dispatchFire}
                repeatMs={130}
                className="w-20 h-20 bg-gradient-to-b from-red-600 to-red-950 border-2 border-red-400 text-white font-bold text-base flex flex-col items-center justify-center arcade-fire-btn"
              >
                <span className="text-2xl">🔥</span>
                <span className="text-[10px] tracking-wider font-display">FIRE</span>
              </TouchControlBtn>
            </div>
          </>
        )}
      </div>

      {/* ----------------- Opponents Mini Leaderboard Strip ----------------- */}
      {opponents.length > 0 && !isLandscape && (
        <div className="w-full max-w-lg flex items-center justify-center gap-2 overflow-x-auto py-1 px-2 z-10 shrink-0">
          {opponents.map((opp) => {
            const info = resolvePlayer(playerList, opp.id);
            const color = SEAT_COLORS[opp.seat % SEAT_COLORS.length] ?? '#2ee66b';
            return (
              <div
                key={opp.id}
                className="flex items-center gap-1.5 px-2 py-0.5 bg-pa-surface/85 border border-pa-border shrink-0 text-[10px] font-display rounded-md shadow-sm"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="font-bold truncate max-w-[70px] text-pa-ink">{info.displayName}</span>
                <span className="text-pa-cyan tabular font-bold">{opp.score}</span>
                {opp.gameOver ? (
                  <span className="text-pa-danger text-[8px] font-bold">OUT</span>
                ) : (
                  <span className="text-pa-ink-dim text-[8px]">W{opp.wave}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ----------------- Portrait Mobile Ergonomic Touch Cockpit ----------------- */}
      {!isLandscape && (
        <div className="w-full max-w-lg px-2 pb-2 pt-1 flex flex-col gap-2 shrink-0 z-20">
          {/* 1. Full-Width Radar Slide / Drag Runway (Drag to Steer · Tap to Fire) */}
          <div
            ref={slideTrackRef}
            aria-label="Touch Navigation Radar Track"
            onPointerDown={handlePointerDownGesture}
            onPointerMove={handlePointerMoveGesture}
            onPointerUp={handlePointerUpGesture}
            onPointerCancel={handlePointerUpGesture}
            className="relative w-full h-11 rounded-xl bg-gradient-to-r from-pa-surface via-pa-surface-2 to-pa-surface border-2 border-pa-border flex items-center justify-between px-3 overflow-hidden cursor-ew-resize select-none touch-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]"
          >
            {/* Illuminated radar hash marks */}
            <div
              className="absolute inset-0 pointer-events-none opacity-25"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(90deg, var(--color-pa-cyan) 0px, var(--color-pa-cyan) 1px, transparent 1px, transparent 14px)',
              }}
            />

            {/* Glowing neon slider tracking indicator */}
            {touchActiveX !== null && (
              <div
                className="absolute top-1 bottom-1 w-10 -ml-5 bg-pa-cyan/35 border-2 border-pa-cyan rounded-md pointer-events-none shadow-[0_0_12px_var(--color-pa-cyan)]"
                style={{
                  left: `${Math.max(20, Math.min((slideTrackRef.current?.clientWidth ?? 300) - 20, touchActiveX))}px`,
                }}
              />
            )}

            <span className="font-display text-[10px] text-pa-cyan font-bold tracking-widest pointer-events-none z-10 flex items-center gap-1">
              ◀ <span className="hidden xs:inline">SLIDE</span>
            </span>
            <span className="font-display text-[9px] text-pa-ink tracking-wider pointer-events-none z-10 uppercase text-center drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              Drag to Steer · Tap to Fire
            </span>
            <span className="font-display text-[10px] text-pa-cyan font-bold tracking-widest pointer-events-none z-10 flex items-center gap-1">
              <span className="hidden xs:inline">SLIDE</span> ▶
            </span>
          </div>

          {/* 2. Ergonomic Two-Thumb Arcade Push-Buttons */}
          <div className="w-full flex items-center justify-between gap-3">
            {/* Left Thumb: Directional Arcade Push-Buttons */}
            <div className="flex items-center gap-2 flex-1">
              <TouchControlBtn
                label="Move Left"
                onFire={() => dispatchMove('left')}
                repeatMs={70}
                className="flex-1 h-17 bg-gradient-to-b from-pa-surface to-pa-bg border-2 border-pa-border flex flex-col items-center justify-center font-display text-xs font-bold text-pa-ink arcade-thumb-btn active:border-pa-cyan"
              >
                <span className="text-xl leading-none mb-0.5 text-pa-cyan drop-shadow-[0_0_6px_rgba(34,224,255,0.7)]">
                  ◀
                </span>
                <span className="text-[10px] tracking-wider text-pa-ink">LEFT</span>
              </TouchControlBtn>

              <TouchControlBtn
                label="Move Right"
                onFire={() => dispatchMove('right')}
                repeatMs={70}
                className="flex-1 h-17 bg-gradient-to-b from-pa-surface to-pa-bg border-2 border-pa-border flex flex-col items-center justify-center font-display text-xs font-bold text-pa-ink arcade-thumb-btn active:border-pa-cyan"
              >
                <span className="text-xl leading-none mb-0.5 text-pa-cyan drop-shadow-[0_0_6px_rgba(34,224,255,0.7)]">
                  ▶
                </span>
                <span className="text-[10px] tracking-wider text-pa-ink">RIGHT</span>
              </TouchControlBtn>
            </div>

            {/* Right Thumb: Giant Glowing Arcade FIRE Push-Button */}
            <div className="shrink-0">
              <TouchControlBtn
                label="Fire Plasma Cannon"
                onFire={dispatchFire}
                repeatMs={130}
                className="w-26 sm:w-28 h-17 bg-gradient-to-b from-red-600 to-red-950 border-2 border-red-400 text-white font-display flex flex-col items-center justify-center arcade-fire-btn ring-2 ring-red-500/50 shadow-[0_0_22px_rgba(255,40,61,0.65)]"
              >
                <span className="text-2xl leading-none filter drop-shadow-[0_0_8px_rgba(255,255,255,0.9)]">
                  🔥
                </span>
                <span className="text-xs font-bold tracking-widest text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] mt-0.5">
                  FIRE
                </span>
              </TouchControlBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
