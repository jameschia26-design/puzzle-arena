import * as React from 'react';
import {
  puzzleBubbleRules,
  type BubbleColor,
  type BubblePoint,
  type PuzzleBubbleAction,
  type PuzzleBubblePublicPlayer,
  type PuzzleBubbleView,
} from '@puzzle-arena/games';
import { bgm, sfx } from '../ui/sound.js';

const rules = puzzleBubbleRules;

/**
 * Canvas layout is derived from the shared logical geometry, never guessed.
 * PITCH is one bubble diameter in canvas pixels; everything else follows, so the
 * drawn side walls sit exactly where `traceShot` bounces and the grid fills the
 * playfield instead of huddling in the middle.
 */
const PITCH = 28;
const SCALE = PITCH / (2 * rules.PIXEL_UNIT);
const WALL = 16;
const FIELD_X = WALL;
const FIELD_W = Math.round(rules.BOARD_WIDTH * SCALE);
const CANVAS_W = FIELD_W + WALL * 2;
const CEILING_PX = 24;
const FLOOR_Y = 392;
const CANVAS_H = 416;
const ASSIST_STORAGE_KEY = 'pa:puzzle-bubble-assist';
const MAX_ANGLE = 80;

const COLOR: Record<BubbleColor, { outline: string; shade: string; body: string; rim: string; spec: string }> = {
  coral: { outline: '#52141a', shade: '#99222c', body: '#ee4740', rim: '#ff9288', spec: '#ffffff' },
  gold: { outline: '#503505', shade: '#9a640c', body: '#f3b72b', rim: '#ffe682', spec: '#ffffff' },
  leaf: { outline: '#0e3a1f', shade: '#1e6f3b', body: '#4cb75d', rim: '#98f39c', spec: '#ffffff' },
  sky: { outline: '#102a4a', shade: '#1f5992', body: '#3a9ee4', rim: '#9cd9ff', spec: '#ffffff' },
  violet: { outline: '#2f1548', shade: '#5a2d8a', body: '#9558d4', rim: '#d6aef8', spec: '#ffffff' },
  rose: { outline: '#4e1435', shade: '#8e2762', body: '#db4b98', rim: '#fba0d3', spec: '#ffffff' },
  mint: { outline: '#0f3c37', shade: '#1d7469', body: '#3cc6b2', rim: '#96f5e7', spec: '#ffffff' },
  amber: { outline: '#53230a', shade: '#974513', body: '#eb7526', rim: '#ffb580', spec: '#ffffff' },
};

type BoardCell = PuzzleBubblePublicPlayer['board'][number];
type Shot = NonNullable<PuzzleBubblePublicPlayer['lastShot']>;
type Pixel = { x: number; y: number };

function canvasPoint(point: BubblePoint): Pixel {
  return {
    x: FIELD_X + Math.round(point.x * SCALE),
    y: CEILING_PX + Math.round((point.y - rules.CEILING_Y) * SCALE),
  };
}

const SHOOTER = canvasPoint({ x: rules.SHOOTER_X, y: rules.SHOOTER_Y });
const PIVOT_Y = SHOOTER.y + 16;
const DANGER_LINE_Y = canvasPoint(rules.bubblePoint({ row: rules.DANGER_ROW, col: 0 }, 0)).y - PITCH / 2;

/** A bubble burst, held back until its shot has finished flying. */
type Burst = {
  pops: Array<Pixel & { color: BubbleColor }>;
  drops: Array<Pixel & { color: BubbleColor }>;
  score: number;
  pressureAdded: boolean;
};

/**
 * A drawable instant of the game. Presentation (board, score, loaded bubble)
 * moves as one, so nothing about a shot's outcome is shown before its bubble
 * has finished flying.
 */
type Snapshot = { player: PuzzleBubblePublicPlayer; board: BoardCell[]; rowParity: 0 | 1; version: number };

type Flight = {
  points: Pixel[];
  distances: number[];
  total: number;
  travelled: number;
  speed: number;
  color: BubbleColor;
  burst: Burst;
};

type VisualParticle = {
  kind: 'drop' | 'ring' | 'score' | 'spark';
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: BubbleColor;
  life: number;
  maxLife: number;
  text?: string;
};

type VisualState = {
  ready: boolean;
  /** What is currently drawn. Lags `latest` while a shot is in the air. */
  view: Snapshot | null;
  /** Latest authoritative board from the server. */
  latest: Snapshot | null;
  flight: Flight | null;
  queuedDescent: boolean;
  lastShotCount: number;
  descents: number;
  loaded: BubbleColor | null;
  particles: VisualParticle[];
  recoil: number;
  recoilVelocity: number;
  shake: number;
  descentOffset: number;
  assistKey: string;
  assistPath: Pixel[];
  assistLanding: Pixel | null;
};

function clampAngle(angle: number): number {
  return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));
}

function aimAngle(x: number, y: number): number {
  return clampAngle(Math.round(Math.atan2(x - SHOOTER.x, Math.max(1, SHOOTER.y - y)) * (180 / Math.PI)));
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, color: BubbleColor, scale = 1, alpha = 1): void {
  const palette = COLOR[color];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  ctx.fillStyle = palette.outline;
  ctx.fillRect(-5, -13, 11, 26);
  ctx.fillRect(-9, -11, 19, 22);
  ctx.fillRect(-11, -9, 23, 18);
  ctx.fillRect(-13, -5, 27, 10);
  ctx.fillStyle = palette.body;
  ctx.fillRect(-4, -12, 9, 24);
  ctx.fillRect(-8, -10, 17, 20);
  ctx.fillRect(-10, -8, 21, 16);
  ctx.fillRect(-12, -4, 25, 8);
  ctx.fillStyle = palette.shade;
  ctx.fillRect(-2, 4, 11, 6);
  ctx.fillRect(1, 0, 9, 8);
  ctx.fillRect(4, -4, 6, 12);
  ctx.fillRect(-6, 8, 12, 3);
  ctx.fillStyle = palette.rim;
  ctx.fillRect(2, 9, 5, 2);
  ctx.fillRect(7, 4, 2, 5);
  ctx.fillStyle = palette.spec;
  ctx.fillRect(-8, -8, 4, 3);
  ctx.fillRect(-9, -6, 3, 5);
  ctx.fillRect(-6, -9, 5, 2);
  ctx.fillRect(-4, -7, 2, 2);
  ctx.fillStyle = palette.rim;
  ctx.fillRect(-1, -1, 3, 3);
  ctx.fillStyle = palette.spec;
  ctx.fillRect(0, 0, 1, 1);
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#0a1020';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#121d35';
  for (let y = 0; y < CANVAS_H; y += 8) {
    for (let x = (y / 8) % 2 === 0 ? 0 : 4; x < CANVAS_W; x += 8) ctx.fillRect(x, y, 1, 1);
  }
  // Playfield interior: exactly the logical wall-to-wall span.
  ctx.fillStyle = '#0d1729';
  ctx.fillRect(FIELD_X - 3, CEILING_PX - 3, FIELD_W + 6, FLOOR_Y - CEILING_PX + 3);
  ctx.fillStyle = '#20385f';
  ctx.fillRect(FIELD_X, CEILING_PX, FIELD_W, FLOOR_Y - CEILING_PX);
  ctx.fillStyle = '#1a2f52';
  for (let y = CEILING_PX; y < FLOOR_Y; y += 16) ctx.fillRect(FIELD_X, y, FIELD_W, 1);
  // Cabinet rails flush against the bounce boundary.
  ctx.fillStyle = '#1b283e';
  ctx.fillRect(0, 0, WALL, FLOOR_Y);
  ctx.fillRect(CANVAS_W - WALL, 0, WALL, FLOOR_Y);
  ctx.fillStyle = '#526882';
  ctx.fillRect(FIELD_X - 4, 0, 4, FLOOR_Y);
  ctx.fillRect(FIELD_X + FIELD_W, 0, 4, FLOOR_Y);
  ctx.fillStyle = '#8fa6c0';
  ctx.fillRect(FIELD_X - 4, 0, 1, FLOOR_Y);
  ctx.fillRect(FIELD_X + FIELD_W + 3, 0, 1, FLOOR_Y);
  // Ceiling rail with rivets.
  ctx.fillStyle = '#445a74';
  ctx.fillRect(FIELD_X - 4, 6, FIELD_W + 8, CEILING_PX - 6);
  ctx.fillStyle = '#a7b8cb';
  ctx.fillRect(FIELD_X - 2, 7, FIELD_W + 4, 1);
  ctx.fillStyle = '#1d2b40';
  for (let x = FIELD_X + 4; x < FIELD_X + FIELD_W - 4; x += PITCH) ctx.fillRect(x, 12, PITCH - 12, 5);
  // Floor.
  ctx.fillStyle = '#d6a142';
  for (let x = FIELD_X - 4; x < FIELD_X + FIELD_W + 4; x += 24) {
    ctx.fillRect(x, FLOOR_Y - 7, 16, 3);
    ctx.fillRect(x + 3, FLOOR_Y - 4, 10, 3);
  }
  ctx.fillStyle = '#6b4123';
  ctx.fillRect(0, FLOOR_Y, CANVAS_W, CANVAS_H - FLOOR_Y);
  ctx.fillStyle = '#9a6330';
  for (let x = 0; x < CANVAS_W; x += 16) {
    ctx.fillRect(x, FLOOR_Y + 4 + ((x / 16) % 2) * 4, 8, 4);
    ctx.fillRect(x + 8, FLOOR_Y + 12 + ((x / 16) % 2) * 4, 8, 4);
  }
}

function drawDangerLine(ctx: CanvasRenderingContext2D, danger: boolean, now: number): void {
  const pulse = danger ? 0.45 + 0.55 * Math.sin(now / 180) ** 2 : 0.7;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = danger ? '#ff4052' : '#f7bf50';
  ctx.lineWidth = danger ? 3 : 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(FIELD_X, DANGER_LINE_Y);
  ctx.lineTo(FIELD_X + FIELD_W, DANGER_LINE_Y);
  ctx.stroke();
  ctx.restore();
}

function drawBoard(ctx: CanvasRenderingContext2D, snapshot: Snapshot, now: number, descentOffset: number): void {
  for (const cell of snapshot.board) {
    if (cell.row > rules.DANGER_ROW) continue;
    const point = canvasPoint(rules.bubblePoint(cell, snapshot.rowParity));
    drawBubble(ctx, point.x, point.y + descentOffset, cell.color);
  }
  drawDangerLine(ctx, snapshot.board.some((cell) => cell.row >= rules.DANGER_ROW - 2), now);
}

function drawLauncher(ctx: CanvasRenderingContext2D, angle: number, current: BubbleColor, recoil: number, firing: boolean): void {
  ctx.save();
  ctx.translate(SHOOTER.x, PIVOT_Y);
  ctx.fillStyle = '#5c3b1b';
  ctx.fillRect(-14, -14, 28, 28);
  ctx.fillStyle = '#d49b42';
  ctx.fillRect(-11, -18, 7, 4);
  ctx.fillRect(4, -18, 7, 4);
  ctx.fillRect(-18, -4, 4, 8);
  ctx.fillRect(14, -4, 4, 8);
  ctx.fillRect(-11, 14, 7, 4);
  ctx.fillRect(4, 14, 7, 4);
  ctx.fillStyle = '#291b18';
  ctx.fillRect(-5, -5, 10, 10);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(0, recoil);
  ctx.fillStyle = '#1a263a';
  ctx.fillRect(-11, -32, 4, 24);
  ctx.fillRect(7, -32, 4, 24);
  ctx.fillStyle = '#9cb2cc';
  ctx.fillRect(-10, -31, 1, 22);
  ctx.fillRect(9, -31, 1, 22);
  if (!firing) drawBubble(ctx, 0, -16, current);
  ctx.fillStyle = '#8f5623';
  ctx.fillRect(-10, -10, 3, 5);
  ctx.fillRect(7, -10, 3, 5);
  ctx.restore();
}

function drawAssist(ctx: CanvasRenderingContext2D, path: Pixel[], landing: Pixel | null, color: BubbleColor): void {
  if (path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = '#e8ecff';
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index]!;
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
  if (landing) drawBubble(ctx, landing.x, landing.y, color, 1, 0.28);
}

function flightPosition(flight: Flight): Pixel {
  const travelled = Math.min(flight.total, flight.travelled);
  let index = 1;
  while (index < flight.distances.length - 1 && flight.distances[index]! < travelled) index += 1;
  const from = flight.points[index - 1]!;
  const to = flight.points[index]!;
  const segmentStart = flight.distances[index - 1]!;
  const segment = flight.distances[index]! - segmentStart;
  const fraction = segment <= 0 ? 1 : (travelled - segmentStart) / segment;
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

function drawFlight(ctx: CanvasRenderingContext2D, flight: Flight): void {
  const head = flightPosition(flight);
  for (let trail = 1; trail <= 3; trail += 1) {
    const behind = { ...flight, travelled: Math.max(0, flight.travelled - trail * 7) };
    const point = flightPosition(behind);
    ctx.fillStyle = COLOR[flight.color].rim;
    ctx.globalAlpha = 0.32 - trail * 0.08;
    ctx.fillRect(Math.round(point.x) - 1, Math.round(point.y) - 1, 3, 3);
  }
  ctx.globalAlpha = 1;
  drawBubble(ctx, head.x, head.y, flight.color);
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: VisualParticle[]): void {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index]!;
    particle.life += 1;
    particle.x += particle.vx;
    particle.y += particle.vy;
    const alpha = Math.max(0, 1 - particle.life / particle.maxLife);
    if (particle.kind === 'drop') {
      particle.vy += 0.34;
      drawBubble(ctx, particle.x, particle.y, particle.color, 0.95, alpha);
    } else if (particle.kind === 'ring') {
      const radius = 5 + particle.life * 1.3;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = COLOR[particle.color].rim;
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(particle.x - radius), Math.round(particle.y - radius), radius * 2, radius * 2);
      ctx.restore();
    } else if (particle.kind === 'score') {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffea6c';
      ctx.font = '9px monospace';
      ctx.fillText(particle.text!, Math.round(particle.x), Math.round(particle.y));
      ctx.restore();
    } else {
      particle.vx *= 0.9;
      particle.vy = particle.vy * 0.9 + 0.11;
      ctx.fillStyle = COLOR[particle.color].rim;
      ctx.fillRect(Math.round(particle.x) - 1, Math.round(particle.y) - 1, 3, 3);
    }
    if (particle.life >= particle.maxLife || particle.y > CANVAS_H + 20) particles.splice(index, 1);
  }
}

function snapshotOf(player: PuzzleBubblePublicPlayer, version: number): Snapshot {
  return { player, board: player.board.map((cell) => ({ ...cell })), rowParity: player.rowParity, version };
}

function buildBurst(shot: Shot, before: Snapshot, fired: BubbleColor): Burst {
  const colors = new Map(before.board.map((cell) => [`${cell.row}:${cell.col}`, cell.color]));
  const spot = (slot: { row: number; col: number }) => {
    const point = canvasPoint(rules.bubblePoint(slot, before.rowParity));
    return { x: point.x, y: point.y, color: colors.get(`${slot.row}:${slot.col}`) ?? fired };
  };
  return {
    pops: shot.popped.map(spot),
    drops: shot.dropped.map(spot),
    score: rules.scoreShot(shot.popped.length, shot.dropped.length),
    pressureAdded: shot.pressureAdded,
  };
}

function buildFlight(shot: Shot, before: Snapshot, fired: BubbleColor, durationMs: number): Flight {
  const raw = [...shot.path, rules.bubblePoint(shot.landing, before.rowParity)].map(canvasPoint);
  const points = raw.filter((point, index) => index === 0 || point.x !== raw[index - 1]!.x || point.y !== raw[index - 1]!.y);
  if (points.length < 2) points.push({ ...points[0]!, y: points[0]!.y - 1 });
  const distances = [0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
    distances.push(total);
  }
  return {
    points,
    distances,
    total,
    travelled: 0,
    speed: total / Math.max(1, durationMs),
    color: fired,
    burst: buildBurst(shot, before, fired),
  };
}

function MiniBoard({ player }: { player: PuzzleBubblePublicPlayer }): React.ReactElement {
  return (
    <div className="border-2 border-pa-border bg-[#15213d] p-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2 font-display text-[9px] text-pa-ink-dim">
        <span>OPPONENT</span><span className="text-pa-amber">{player.score.toLocaleString()}</span>
      </div>
      <div className="relative mt-2 h-24 overflow-hidden border border-[#31558a] bg-[#263e68]">
        {player.board.filter((cell) => cell.row <= rules.DANGER_ROW).map((cell) => {
          const longRow = (cell.row + player.rowParity) % 2 === 0;
          const left = longRow ? cell.col * 12.5 : cell.col * 12.5 + 6.25;
          return (
            <span
              key={`${cell.row}:${cell.col}`}
              className="absolute rounded-full border border-[#15213d]"
              style={{
                left: `${left}%`,
                top: `${(cell.row * 100) / (rules.DANGER_ROW + 1)}%`,
                width: '12.5%',
                height: `${100 / (rules.DANGER_ROW + 1)}%`,
                backgroundColor: COLOR[cell.color].body,
              }}
            />
          );
        })}
      </div>
      <div className="mt-1 text-right font-display text-[8px] text-pa-ink-dim">WAVE {player.wave}{player.gameOver ? ' · OUT' : ''}</div>
    </div>
  );
}

export function PuzzleBubbleBoard({
  view,
  youId,
  onAction,
}: {
  view: PuzzleBubbleView;
  players: unknown;
  youId: string | null;
  legalActions: string[];
  turnEndsAt: number | null;
  onAction: (action: PuzzleBubbleAction) => void;
}): React.ReactElement {
  const you = view.you;
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [angle, setAngle] = React.useState(0);
  const [assist, setAssist] = React.useState(() => {
    try {
      return localStorage.getItem(ASSIST_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [locked, setLocked] = React.useState(false);
  const lockTimer = React.useRef<number | null>(null);
  const aimHoldDelay = React.useRef<number | null>(null);
  const aimHoldInterval = React.useRef<number | null>(null);
  const angleRef = React.useRef(angle);
  const assistRef = React.useRef(assist);
  const playerRef = React.useRef(you);
  const fxRef = React.useRef<VisualState>({
    ready: false,
    view: null,
    latest: null,
    flight: null,
    queuedDescent: false,
    lastShotCount: -1,
    descents: 0,
    loaded: null,
    particles: [],
    recoil: 0,
    recoilVelocity: 0,
    shake: 0,
    descentOffset: 0,
    assistKey: '',
    assistPath: [],
    assistLanding: null,
  });
  const [clockNow, setClockNow] = React.useState(() => Date.now());
  /** The board instant the HUD reflects — held back with the canvas during a flight. */
  const [shown, setShown] = React.useState<PuzzleBubblePublicPlayer | null>(you);
  angleRef.current = angle;
  assistRef.current = assist;
  playerRef.current = you;

  /** Swap the drawn board to the newest server truth and release its held-back effects. */
  const commit = React.useCallback((burst: Burst | null) => {
    const fx = fxRef.current;
    if (!fx.latest) return;
    fx.view = fx.latest;
    setShown(fx.latest.player);
    if (burst) {
      for (const pop of burst.pops) {
        fx.particles.push({ kind: 'ring', x: pop.x, y: pop.y, vx: 0, vy: 0, color: pop.color, life: 0, maxLife: 16 });
        for (let shard = 0; shard < 6; shard += 1) {
          const radians = (shard * Math.PI) / 3;
          fx.particles.push({
            kind: 'spark',
            x: pop.x,
            y: pop.y,
            vx: Math.cos(radians) * 2,
            vy: Math.sin(radians) * 2,
            color: pop.color,
            life: 0,
            maxLife: 20,
          });
        }
      }
      for (const drop of burst.drops) {
        fx.particles.push({ kind: 'drop', x: drop.x, y: drop.y, vx: ((drop.x % 3) - 1) * 0.6, vy: -1.8, color: drop.color, life: 0, maxLife: 90 });
      }
      if (burst.pops.length > 0) {
        const first = burst.pops[0]!;
        fx.particles.push({ kind: 'score', x: first.x - 9, y: first.y - 8, vx: 0, vy: -0.5, color: first.color, life: 0, maxLife: 42, text: `+${burst.score}` });
        sfx.pop();
      } else {
        sfx.chip();
      }
      if (burst.pressureAdded) {
        fx.shake = 3.5;
        fx.descentOffset = -14;
      }
    }
    if (fx.queuedDescent) {
      fx.queuedDescent = false;
      fx.shake = 3.5;
      fx.descentOffset = -14;
    }
  }, []);

  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);
  React.useEffect(() => () => {
    if (lockTimer.current !== null) window.clearTimeout(lockTimer.current);
    if (aimHoldDelay.current !== null) window.clearTimeout(aimHoldDelay.current);
    if (aimHoldInterval.current !== null) window.clearInterval(aimHoldInterval.current);
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let frame = 0;
    let previous = performance.now();
    const render = (now: number) => {
      const delta = Math.min(50, now - previous);
      previous = now;
      const player = playerRef.current;
      const fx = fxRef.current;
      const spring = -0.28 * fx.recoil - 0.68 * fx.recoilVelocity;
      fx.recoilVelocity += spring;
      fx.recoil += fx.recoilVelocity;
      if (Math.abs(fx.recoil) < 0.05 && Math.abs(fx.recoilVelocity) < 0.05) {
        fx.recoil = 0;
        fx.recoilVelocity = 0;
      }
      fx.descentOffset *= 0.78;
      if (Math.abs(fx.descentOffset) < 0.05) fx.descentOffset = 0;
      fx.shake *= 0.82;
      if (fx.flight) {
        fx.flight.travelled += fx.flight.speed * delta;
        if (fx.flight.travelled >= fx.flight.total) {
          const burst = fx.flight.burst;
          fx.flight = null;
          commit(burst);
        }
      }
      const shake = Math.round(Math.sin(now * 0.08) * fx.shake);
      ctx.save();
      ctx.translate(0, shake);
      drawBackground(ctx);
      const drawn = fx.view;
      if (player && drawn) {
        drawBoard(ctx, drawn, now, fx.descentOffset);
        if (assistRef.current && !drawn.player.gameOver && !fx.flight) {
          const key = `${angleRef.current}:${drawn.version}`;
          if (key !== fx.assistKey) {
            const trace = rules.traceShot(drawn.board, drawn.rowParity, angleRef.current);
            const landing = rules.resolveLanding(drawn.board, drawn.rowParity, trace);
            fx.assistKey = key;
            fx.assistPath = trace.path.map(canvasPoint);
            fx.assistLanding = landing ? canvasPoint(rules.bubblePoint(landing, drawn.rowParity)) : null;
          }
          drawAssist(ctx, fx.assistPath, fx.assistLanding, drawn.player.current);
        }
        if (fx.flight) drawFlight(ctx, fx.flight);
        // The barrel stays empty while a bubble is in the air, then reloads.
        drawLauncher(ctx, angleRef.current, drawn.player.current, fx.recoil, fx.flight !== null);
        drawParticles(ctx, fx.particles);
      }
      ctx.restore();
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, [commit]);

  React.useEffect(() => {
    if (!you) return;
    const fx = fxRef.current;
    if (!fx.ready) {
      const initial = snapshotOf(you, 1);
      fx.ready = true;
      fx.view = initial;
      fx.latest = initial;
      fx.lastShotCount = you.shots;
      fx.descents = you.descents;
      fx.loaded = you.current;
      setShown(you);
      return;
    }
    const before = fx.view;
    if (!before) return;
    fx.latest = snapshotOf(you, before.version + 1);
    if (you.descents > fx.descents) {
      fx.descents = you.descents;
      fx.queuedDescent = true;
    }
    const shot = you.shots > fx.lastShotCount ? you.lastShot : null;
    if (shot) {
      fx.lastShotCount = you.shots;
      // Never overlap two flights: land the previous one instantly.
      if (fx.flight) {
        const pending = fx.flight.burst;
        fx.flight = null;
        commit(pending);
      }
      fx.flight = buildFlight(shot, before, fx.loaded ?? you.current, rules.shotAnimationMs(view.config.speed));
      fx.recoil = 5;
    }
    if (!fx.flight) commit(null);
    fx.loaded = you.current;
  }, [commit, view.config.speed, you]);

  React.useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  const fire = React.useCallback((angleDeg = angle) => {
    if (!you || locked || you.gameOver || view.phase === 'game_over') return;
    onAction({ type: 'shoot', angleDeg });
    sfx.tembak();
    setLocked(true);
    if (lockTimer.current !== null) window.clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(() => {
      lockTimer.current = null;
      setLocked(false);
    }, rules.shotAnimationMs(view.config.speed));
  }, [angle, locked, onAction, view.config.speed, view.phase, you]);

  const nudgeAim = React.useCallback((delta: number) => {
    setAngle((value) => clampAngle(value + delta));
  }, []);

  const stopAimHold = React.useCallback(() => {
    if (aimHoldDelay.current !== null) {
      window.clearTimeout(aimHoldDelay.current);
      aimHoldDelay.current = null;
    }
    if (aimHoldInterval.current !== null) {
      window.clearInterval(aimHoldInterval.current);
      aimHoldInterval.current = null;
    }
  }, []);

  const startAimHold = React.useCallback((event: React.PointerEvent<HTMLButtonElement>, delta: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    stopAimHold();
    nudgeAim(delta);
    aimHoldDelay.current = window.setTimeout(() => {
      aimHoldDelay.current = null;
      aimHoldInterval.current = window.setInterval(() => nudgeAim(delta), 60);
    }, 260);
  }, [nudgeAim, stopAimHold]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
        event.preventDefault();
        nudgeAim(-3);
      } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
        event.preventDefault();
        nudgeAim(3);
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        fire();
      } else if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        setAssist((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fire, nudgeAim]);

  const toggleAssist = () => {
    setAssist((value) => {
      const next = !value;
      try {
        localStorage.setItem(ASSIST_STORAGE_KEY, String(next));
      } catch {
        // Private browsing can block persistence; the current session still works.
      }
      return next;
    });
  };

  const aimFromPointer = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    setAngle(aimAngle(((event.clientX - rect.left) / rect.width) * CANVAS_W, ((event.clientY - rect.top) / rect.height) * CANVAS_H));
  };

  if (!you) return <div className="p-4 text-pa-ink-dim">Waiting for your Puzzle Bubble board…</div>;
  const opponent = view.players.find((player) => player.id !== youId);
  // Interactivity follows the server; the numbers follow what is on screen.
  const hud = shown ?? you;
  const pressure = rules.pressureLimit(view.config.speed);
  const descentMs = view.pressureEndsAtMs === null || view.pressureEndsAtMs === undefined
    ? rules.descentIntervalMs(view.config.speed)
    : Math.max(0, view.pressureEndsAtMs - clockNow);
  const descentSeconds = Math.ceil(descentMs / 1_000);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-2 sm:p-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-pa-border bg-pa-surface p-2 pa-shadow">
          <div><span className="font-display text-[9px] text-pa-ink-dim">SCORE </span><span className="font-display text-[18px] text-pa-amber tabular-nums">{hud.score.toLocaleString()}</span></div>
          <div className="font-display text-[9px] text-pa-ink-dim">WAVE {hud.wave} · {view.config.speed.toUpperCase()}</div>
          <div className="font-display text-[9px] text-pa-ink-dim">CEILING {String(Math.floor(descentSeconds / 60)).padStart(2, '0')}:{String(descentSeconds % 60).padStart(2, '0')}</div>
          <div className="font-display text-[9px] text-pa-ink-dim">PRESSURE {hud.pressureRemaining}/{pressure}</div>
          <div className="flex items-center gap-1"><span className="text-[11px] text-pa-ink-dim">NEXT</span><span className="h-5 w-5 rounded-full border-2 border-[#15213d]" style={{ backgroundColor: COLOR[hud.next].body }} aria-label={`Next ${hud.next} bubble`} /></div>
        </div>
        {opponent && <MiniBoard player={opponent} />}
      </div>
      <div className="flex w-full justify-center">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block border-4 border-[#15213d] bg-[#091126] pa-shadow touch-none select-none"
          style={{ imageRendering: 'pixelated', height: 'min(62vh, 620px, 142vw)', width: 'auto' }}
          onPointerMove={aimFromPointer}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            aimFromPointer(event);
          }}
          aria-label="Puzzle Bubble playfield. Drag to aim, then press Fire to shoot."
        />
      </div>
      <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-2 sm:mx-auto sm:w-[min(100%,420px)]">
        <button
          type="button"
          className="min-h-11 touch-none select-none border-2 border-pa-border bg-pa-surface font-display text-[12px] text-pa-cyan pa-shadow active:translate-y-0.5"
          onPointerDown={(event) => startAimHold(event, -3)}
          onPointerUp={stopAimHold}
          onPointerCancel={stopAimHold}
          onLostPointerCapture={stopAimHold}
          onClick={(event) => { if (event.detail === 0) nudgeAim(-3); }}
        >LEFT</button>
        <button type="button" className="min-h-11 select-none border-2 border-pa-amber bg-pa-amber font-display text-[12px] text-pa-shadow pa-shadow disabled:opacity-45" disabled={locked || you.gameOver || view.phase === 'game_over'} onClick={() => fire()}>{you.gameOver ? 'OUT' : locked ? 'AIMING…' : 'FIRE'}</button>
        <button
          type="button"
          className="min-h-11 touch-none select-none border-2 border-pa-border bg-pa-surface font-display text-[12px] text-pa-cyan pa-shadow active:translate-y-0.5"
          onPointerDown={(event) => startAimHold(event, 3)}
          onPointerUp={stopAimHold}
          onPointerCancel={stopAimHold}
          onLostPointerCapture={stopAimHold}
          onClick={(event) => { if (event.detail === 0) nudgeAim(3); }}
        >RIGHT</button>
      </div>
      <button type="button" className="self-center border-2 border-pa-border bg-pa-surface px-3 py-2 font-display text-[9px] text-pa-ink-dim pa-shadow" onClick={toggleAssist}>ASSIST: {assist ? 'ON' : 'OFF'} · G</button>
    </div>
  );
}
