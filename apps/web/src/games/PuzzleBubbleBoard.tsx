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

const CANVAS_W = 256;
const CANVAS_H = 224;
const ASSIST_STORAGE_KEY = 'pa:puzzle-bubble-assist';
const BUBBLE_RENDER_SCALE = 0.6;
const DISPLAY_BUBBLE_PITCH = 16;
const LOGICAL_SHOOTER_X = 7 * 1024;
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
  descents: number;
  lastShotCount: number;
  previousCurrent: BubbleColor | null;
  previousBoard: Map<string, BubbleColor>;
  previousParity: 0 | 1;
  particles: VisualParticle[];
  recoil: number;
  recoilVelocity: number;
  shake: number;
  descentOffset: number;
  shotColor: BubbleColor | null;
  shotPath: Array<{ x: number; y: number }>;
  shotProgress: number;
};

function canvasPoint(point: BubblePoint): { x: number; y: number } {
  return {
    x: Math.round(128 + (point.x - LOGICAL_SHOOTER_X) * (DISPLAY_BUBBLE_PITCH / (2 * 1024))),
    y: Math.round(point.y / 128) + 10,
  };
}

function aimAngle(x: number, y: number): number {
  return Math.max(-80, Math.min(80, Math.round(Math.atan2(x - 128, Math.max(1, 207 - y)) * (180 / Math.PI))));
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, color: BubbleColor, scale = BUBBLE_RENDER_SCALE, alpha = 1): void {
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
  ctx.fillStyle = '#1b283e';
  ctx.fillRect(0, 0, 16, 224);
  ctx.fillRect(240, 0, 16, 224);
  ctx.fillStyle = '#526882';
  ctx.fillRect(2, 0, 3, 224);
  ctx.fillRect(251, 0, 3, 224);
  ctx.fillStyle = '#0d1729';
  ctx.fillRect(13, 7, 230, 181);
  ctx.fillStyle = '#20385f';
  ctx.fillRect(16, 11, 224, 173);
  ctx.fillStyle = '#314f7a';
  ctx.fillRect(16, 11, 224, 3);
  ctx.fillStyle = '#445a74';
  ctx.fillRect(16, 5, 224, 6);
  ctx.fillStyle = '#a7b8cb';
  ctx.fillRect(18, 6, 220, 1);
  ctx.fillStyle = '#1d2b40';
  for (let x = 20; x < 238; x += 16) ctx.fillRect(x, 11, 8, 4);
  ctx.fillStyle = '#d6a142';
  for (let x = 8; x < 248; x += 24) {
    ctx.fillRect(x, 189, 16, 3);
    ctx.fillRect(x + 3, 193, 10, 3);
  }
  ctx.fillStyle = '#6b4123';
  ctx.fillRect(0, 199, 256, 25);
  ctx.fillStyle = '#9a6330';
  for (let x = 0; x < 256; x += 16) {
    ctx.fillRect(x, 203 + ((x / 16) % 2) * 4, 8, 4);
    ctx.fillRect(x + 8, 211 + ((x / 16) % 2) * 4, 8, 4);
  }
}

function drawDangerLine(ctx: CanvasRenderingContext2D, danger: boolean, now: number): void {
  const pulse = danger ? 0.45 + 0.55 * Math.sin(now / 180) ** 2 : 0.75;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = danger ? '#ff4052' : '#f7bf50';
  ctx.lineWidth = danger ? 3 : 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(16, 175);
  ctx.lineTo(240, 175);
  ctx.stroke();
  ctx.restore();
}

function drawBoard(ctx: CanvasRenderingContext2D, player: PuzzleBubblePublicPlayer, now: number, descentOffset: number): void {
  for (const cell of player.board) {
    if (cell.row > 12) continue;
    const point = canvasPoint(puzzleBubbleRules.bubblePoint(cell, player.rowParity));
    drawBubble(ctx, point.x, point.y + descentOffset, cell.color);
  }
  drawDangerLine(ctx, player.gameOver || player.board.some((cell) => cell.row >= 10), now);
}

function drawLauncher(ctx: CanvasRenderingContext2D, angle: number, current: BubbleColor, recoil: number): void {
  const radians = (angle * Math.PI) / 180;
  ctx.save();
  ctx.translate(128, 207);
  ctx.fillStyle = '#5c3b1b';
  ctx.fillRect(-12, -12, 24, 24);
  ctx.fillStyle = '#d49b42';
  ctx.fillRect(-9, -15, 6, 4);
  ctx.fillRect(3, -15, 6, 4);
  ctx.fillRect(-15, -3, 4, 6);
  ctx.fillRect(11, -3, 4, 6);
  ctx.fillRect(-9, 11, 6, 4);
  ctx.fillRect(3, 11, 6, 4);
  ctx.fillStyle = '#291b18';
  ctx.fillRect(-4, -4, 8, 8);
  ctx.rotate(radians);
  ctx.translate(0, recoil);
  ctx.fillStyle = '#1a263a';
  ctx.fillRect(-10, -29, 3, 22);
  ctx.fillRect(7, -29, 3, 22);
  ctx.fillStyle = '#9cb2cc';
  ctx.fillRect(-9, -28, 1, 20);
  ctx.fillRect(8, -28, 1, 20);
  drawBubble(ctx, 0, -16, current, BUBBLE_RENDER_SCALE * 1.15);
  ctx.fillStyle = '#8f5623';
  ctx.fillRect(-9, -10, 3, 4);
  ctx.fillRect(6, -10, 3, 4);
  ctx.restore();
}

function drawAssist(ctx: CanvasRenderingContext2D, player: PuzzleBubblePublicPlayer, angle: number): void {
  const trace = puzzleBubbleRules.traceShot(player.board, player.rowParity, angle);
  const landing = puzzleBubbleRules.resolveLanding(player.board, player.rowParity, trace);
  ctx.save();
  ctx.strokeStyle = '#e8ecff';
  ctx.globalAlpha = 0.68;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  for (let index = 0; index < trace.path.length; index += 1) {
    const point = canvasPoint(trace.path[index]!);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  if (landing) {
    const point = canvasPoint(puzzleBubbleRules.bubblePoint(landing, player.rowParity));
    drawBubble(ctx, point.x, point.y, player.current, BUBBLE_RENDER_SCALE, 0.3);
  }
  ctx.restore();
}

function drawFlyingShot(ctx: CanvasRenderingContext2D, path: Array<{ x: number; y: number }>, color: BubbleColor, progress: number): void {
  if (path.length === 0) return;
  const scaled = Math.min(path.length - 1, progress * (path.length - 1));
  const index = Math.floor(scaled);
  const from = path[index]!;
  const to = path[Math.min(path.length - 1, index + 1)]!;
  const fraction = scaled - index;
  const x = from.x + (to.x - from.x) * fraction;
  const y = from.y + (to.y - from.y) * fraction;
  for (let trail = 1; trail <= 3; trail += 1) {
    const behind = Math.max(0, scaled - trail * 0.45);
    const trailIndex = Math.floor(behind);
    const trailPoint = path[trailIndex]!;
    ctx.fillStyle = COLOR[color].rim;
    ctx.globalAlpha = 0.35 - trail * 0.08;
    ctx.fillRect(Math.round(trailPoint.x) - 1, Math.round(trailPoint.y) - 1, 3, 3);
  }
  ctx.globalAlpha = 1;
  drawBubble(ctx, x, y, color, BUBBLE_RENDER_SCALE * 1.08);
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
      drawBubble(ctx, particle.x, particle.y, particle.color, BUBBLE_RENDER_SCALE * 0.92, alpha);
    } else if (particle.kind === 'ring') {
      const radius = 4 + particle.life;
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
      ctx.font = '8px monospace';
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

function MiniBoard({ player }: { player: PuzzleBubblePublicPlayer }): React.ReactElement {
  return (
    <div className="border-2 border-pa-border bg-[#15213d] p-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2 font-display text-[9px] text-pa-ink-dim">
        <span>OPPONENT</span><span className="text-pa-amber">{player.score.toLocaleString()}</span>
      </div>
      <div className="relative mt-2 h-20 overflow-hidden border border-[#31558a] bg-[#263e68]">
        {player.board.filter((cell) => cell.row < 9).map((cell) => {
          const longRow = (cell.row + player.rowParity) % 2 === 0;
          const left = longRow ? cell.col * 12.2 : cell.col * 12.2 + 6.1;
          return <span key={`${cell.row}:${cell.col}`} className="absolute h-3 w-3 rounded-full border border-[#15213d]" style={{ left: `${left}%`, top: `${cell.row * 10}%`, backgroundColor: COLOR[cell.color].body }} />;
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
    descents: -1,
    lastShotCount: -1,
    previousBoard: new Map(),
    previousCurrent: null,
    previousParity: 0,
    particles: [],
    recoil: 0,
    recoilVelocity: 0,
    shake: 0,
    descentOffset: 0,
    shotColor: null,
    shotPath: [],
    shotProgress: 1,
  });
  const [clockNow, setClockNow] = React.useState(() => Date.now());
  angleRef.current = angle;
  assistRef.current = assist;
  playerRef.current = you;

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
    const render = () => {
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
      const shake = Math.round(Math.sin(performance.now() * 0.08) * fx.shake);
      ctx.save();
      ctx.translate(0, shake);
      drawBackground(ctx);
      if (player) {
        drawBoard(ctx, player, performance.now(), fx.descentOffset);
        if (assistRef.current && !player.gameOver) drawAssist(ctx, player, angleRef.current);
        if (fx.shotColor && fx.shotProgress < 1) {
          drawFlyingShot(ctx, fx.shotPath, fx.shotColor, fx.shotProgress);
          fx.shotProgress = Math.min(1, fx.shotProgress + 0.045);
        }
        drawLauncher(ctx, angleRef.current, player.current, fx.recoil);
        drawParticles(ctx, fx.particles);
      }
      ctx.restore();
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  React.useEffect(() => {
    if (!you) return;
    const fx = fxRef.current;
    if (fx.previousBoard.size === 0) {
      for (const cell of you.board) fx.previousBoard.set(`${cell.row}:${cell.col}`, cell.color);
      fx.previousCurrent = you.current;
      fx.previousParity = you.rowParity;
      fx.lastShotCount = you.shots;
      fx.descents = you.descents;
      return;
    }
    if (you.shots > fx.lastShotCount && you.lastShot) {
      const shot = you.lastShot;
      fx.shotPath = shot.path.map(canvasPoint);
      fx.shotColor = fx.previousCurrent ?? you.current;
      fx.shotProgress = 0;
      const colorAt = (row: number, col: number) => fx.previousBoard.get(`${row}:${col}`) ?? fx.previousCurrent ?? you.current;
      for (const slot of shot.popped) {
        const point = canvasPoint(puzzleBubbleRules.bubblePoint(slot, fx.previousParity));
        const color = colorAt(slot.row, slot.col);
        fx.particles.push({ kind: 'ring', x: point.x, y: point.y, vx: 0, vy: 0, color, life: 0, maxLife: 16 });
        for (let shard = 0; shard < 6; shard += 1) {
          const radians = (shard * Math.PI) / 3;
          fx.particles.push({ kind: 'spark', x: point.x, y: point.y, vx: Math.cos(radians) * 1.8, vy: Math.sin(radians) * 1.8, color, life: 0, maxLife: 20 });
        }
      }
      for (const slot of shot.dropped) {
        const point = canvasPoint(puzzleBubbleRules.bubblePoint(slot, fx.previousParity));
        fx.particles.push({ kind: 'drop', x: point.x, y: point.y, vx: ((slot.col % 3) - 1) * 0.6, vy: -1.8, color: colorAt(slot.row, slot.col), life: 0, maxLife: 72 });
      }
      if (shot.popped.length > 0) {
        const point = canvasPoint(puzzleBubbleRules.bubblePoint(shot.popped[0]!, fx.previousParity));
        fx.particles.push({ kind: 'score', x: point.x - 8, y: point.y - 5, vx: 0, vy: -0.5, color: you.current, life: 0, maxLife: 40, text: `+${puzzleBubbleRules.scoreShot(shot.popped.length, shot.dropped.length)}` });
      }
      fx.recoil = 4.5;
      if (shot.pressureAdded) {
        fx.shake = 3.5;
        fx.descentOffset = -14;
      }
      fx.lastShotCount = you.shots;
    }
    if (you.descents > fx.descents) {
      fx.shake = 3.5;
      fx.descentOffset = -14;
    }
    fx.previousBoard = new Map(you.board.map((cell) => [`${cell.row}:${cell.col}`, cell.color]));
    fx.previousCurrent = you.current;
    fx.previousParity = you.rowParity;
    fx.descents = you.descents;
  }, [you]);

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
    }, puzzleBubbleRules.shotAnimationMs(view.config.speed));
  }, [angle, locked, onAction, view.config.speed, view.phase, you]);

  const nudgeAim = React.useCallback((delta: number) => {
    setAngle((value) => Math.max(-80, Math.min(80, value + delta)));
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
        nudgeAim(-4);
      } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
        event.preventDefault();
        nudgeAim(4);
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
  const pressure = puzzleBubbleRules.pressureLimit(view.config.speed);
  const descentMs = view.pressureEndsAtMs === null || view.pressureEndsAtMs === undefined
    ? puzzleBubbleRules.descentIntervalMs(view.config.speed)
    : Math.max(0, view.pressureEndsAtMs - clockNow);
  const descentSeconds = Math.ceil(descentMs / 1_000);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-2 sm:p-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-pa-border bg-pa-surface p-2 pa-shadow">
          <div><span className="font-display text-[9px] text-pa-ink-dim">SCORE </span><span className="font-display text-[18px] text-pa-amber tabular-nums">{you.score.toLocaleString()}</span></div>
          <div className="font-display text-[9px] text-pa-ink-dim">WAVE {you.wave} · {view.config.speed.toUpperCase()}</div>
          <div className="font-display text-[9px] text-pa-ink-dim">CEILING {String(Math.floor(descentSeconds / 60)).padStart(2, '0')}:{String(descentSeconds % 60).padStart(2, '0')}</div>
          <div className="font-display text-[9px] text-pa-ink-dim">PRESSURE {you.pressureRemaining}/{pressure}</div>
          <div className="flex items-center gap-1"><span className="text-[11px] text-pa-ink-dim">NEXT</span><span className="h-5 w-5 rounded-full border-2 border-[#15213d]" style={{ backgroundColor: COLOR[you.next].body }} aria-label={`Next ${you.next} bubble`} /></div>
        </div>
        {opponent && <MiniBoard player={opponent} />}
      </div>
      <div className="mx-auto w-full max-w-[640px] border-4 border-[#15213d] bg-[#091126] p-1 pa-shadow">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block h-auto w-full touch-none select-none"
          style={{ imageRendering: 'pixelated' }}
          onPointerMove={aimFromPointer}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            aimFromPointer(event);
          }}
          aria-label="Puzzle Bubble playfield. Drag to aim, then press Fire to shoot."
        />
      </div>
      <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-2 sm:mx-auto sm:w-[min(100%,640px)]">
        <button
          type="button"
          className="min-h-11 touch-none select-none border-2 border-pa-border bg-pa-surface font-display text-[12px] text-pa-cyan pa-shadow active:translate-y-0.5"
          onPointerDown={(event) => startAimHold(event, -4)}
          onPointerUp={stopAimHold}
          onPointerCancel={stopAimHold}
          onLostPointerCapture={stopAimHold}
          onClick={(event) => { if (event.detail === 0) nudgeAim(-4); }}
        >LEFT</button>
        <button type="button" className="min-h-11 select-none border-2 border-pa-amber bg-pa-amber font-display text-[12px] text-pa-shadow pa-shadow disabled:opacity-45" disabled={locked || you.gameOver || view.phase === 'game_over'} onClick={() => fire()}>{you.gameOver ? 'OUT' : locked ? 'AIMING…' : 'FIRE'}</button>
        <button
          type="button"
          className="min-h-11 touch-none select-none border-2 border-pa-border bg-pa-surface font-display text-[12px] text-pa-cyan pa-shadow active:translate-y-0.5"
          onPointerDown={(event) => startAimHold(event, 4)}
          onPointerUp={stopAimHold}
          onPointerCancel={stopAimHold}
          onLostPointerCapture={stopAimHold}
          onClick={(event) => { if (event.detail === 0) nudgeAim(4); }}
        >RIGHT</button>
      </div>
      <button type="button" className="self-center border-2 border-pa-border bg-pa-surface px-3 py-2 font-display text-[9px] text-pa-ink-dim pa-shadow" onClick={toggleAssist}>ASSIST: {assist ? 'ON' : 'OFF'} · G</button>
    </div>
  );
}
