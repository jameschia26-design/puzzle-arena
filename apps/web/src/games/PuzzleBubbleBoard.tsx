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
const COLOR: Record<BubbleColor, { body: string; shade: string; glyph: string; mark: string }> = {
  coral: { body: '#f05c54', shade: '#9c2533', glyph: '#ffd5bb', mark: '●' },
  gold: { body: '#e8b43d', shade: '#94621e', glyph: '#fff5b8', mark: '★' },
  leaf: { body: '#5fbd68', shade: '#25734d', glyph: '#d8ffbb', mark: '◆' },
  sky: { body: '#4a9ed4', shade: '#24507e', glyph: '#c6f5ff', mark: '✦' },
  violet: { body: '#9671ce', shade: '#513b83', glyph: '#ead7ff', mark: '☾' },
  rose: { body: '#d6699c', shade: '#823c69', glyph: '#ffd5eb', mark: '✚' },
  mint: { body: '#54c6ad', shade: '#24776d', glyph: '#caffea', mark: '✦' },
  amber: { body: '#e57d36', shade: '#94411e', glyph: '#ffdaa8', mark: '♛' },
};

function canvasPoint(point: BubblePoint): { x: number; y: number } {
  return { x: Math.round(point.x / 64) + 16, y: Math.round(point.y / 128) + 10 };
}

function aimAngle(x: number, y: number): number {
  return Math.max(-80, Math.min(80, Math.round(Math.atan2(x - 128, Math.max(1, 207 - y)) * (180 / Math.PI))));
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, color: BubbleColor, alpha = 1): void {
  const palette = COLOR[color];
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#151b30';
  ctx.fillRect(x - 13, y - 9, 27, 19);
  ctx.fillStyle = palette.shade;
  ctx.fillRect(x - 12, y - 8, 25, 17);
  ctx.fillStyle = palette.body;
  ctx.fillRect(x - 10, y - 9, 20, 19);
  ctx.fillStyle = palette.glyph;
  ctx.fillRect(x - 6, y - 6, 5, 3);
  ctx.fillStyle = '#18233b';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(palette.mark, x, y + 2);
  ctx.globalAlpha = 1;
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#172650';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#31558a';
  for (let x = 0; x < CANVAS_W; x += 32) {
    ctx.fillRect(x, 16 + ((x / 32) % 2) * 5, 32, 18);
  }
  ctx.fillStyle = '#91c6df';
  for (let x = -8; x < CANVAS_W; x += 48) {
    ctx.fillRect(x, 39, 32, 6);
    ctx.fillRect(x + 7, 33, 18, 6);
  }
  ctx.fillStyle = '#f0c65f';
  ctx.fillRect(0, 188, CANVAS_W, 36);
  ctx.fillStyle = '#c7793c';
  for (let x = 0; x < CANVAS_W; x += 16) {
    ctx.fillRect(x, 200, 8, 8);
    ctx.fillRect(x + 8, 208, 8, 8);
  }
  ctx.fillStyle = '#15213d';
  ctx.fillRect(12, 8, 232, 178);
  ctx.fillStyle = '#263e68';
  ctx.fillRect(15, 11, 226, 172);
}

function drawBoard(ctx: CanvasRenderingContext2D, player: PuzzleBubblePublicPlayer): void {
  for (const cell of player.board) {
    if (cell.row > 12) continue;
    const point = canvasPoint(puzzleBubbleRules.bubblePoint(cell, player.rowParity));
    drawBubble(ctx, point.x, point.y, cell.color);
  }
  ctx.strokeStyle = player.gameOver ? '#ff4d4d' : '#f7bf50';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(14, 175);
  ctx.lineTo(242, 175);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLauncher(ctx: CanvasRenderingContext2D, angle: number, current: BubbleColor): void {
  const radians = (angle * Math.PI) / 180;
  const x = 128 + Math.round(Math.sin(radians) * 18);
  const y = 202 - Math.round(Math.cos(radians) * 18);
  ctx.strokeStyle = '#543020';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(128, 207);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = '#f4d076';
  ctx.fillRect(116, 206, 24, 7);
  ctx.fillStyle = '#9d4f2b';
  ctx.fillRect(121, 211, 14, 5);
  drawBubble(ctx, x, y, current);
}

function drawAssist(ctx: CanvasRenderingContext2D, player: PuzzleBubblePublicPlayer, angle: number): void {
  const trace = puzzleBubbleRules.traceShot(player.board, player.rowParity, angle);
  const landing = puzzleBubbleRules.resolveLanding(player.board, player.rowParity, trace);
  ctx.strokeStyle = '#e8ecff';
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  trace.path.map(canvasPoint).forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (landing) {
    const point = canvasPoint(puzzleBubbleRules.bubblePoint(landing, player.rowParity));
    drawBubble(ctx, point.x, point.y, player.current, 0.35);
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
          return <span key={`${cell.row}:${cell.col}`} className="absolute h-3 w-3 border border-[#15213d]" style={{ left: `${left}%`, top: `${cell.row * 10}%`, backgroundColor: COLOR[cell.color].body }} />;
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

  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);
  React.useEffect(() => () => {
    if (lockTimer.current !== null) window.clearTimeout(lockTimer.current);
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !you) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    drawBackground(ctx);
    drawBoard(ctx, you);
    if (assist && !you.gameOver) drawAssist(ctx, you, angle);
    drawLauncher(ctx, angle, you.current);
  }, [angle, assist, you]);

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

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setAngle((value) => Math.max(-80, value - 4));
      } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setAngle((value) => Math.min(80, value + 4));
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
  }, [fire]);

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

  const aimFromPointer = (event: React.PointerEvent<HTMLCanvasElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextAngle = aimAngle(((event.clientX - rect.left) / rect.width) * CANVAS_W, ((event.clientY - rect.top) / rect.height) * CANVAS_H);
    setAngle(nextAngle);
    return nextAngle;
  };

  if (!you) return <div className="p-4 text-pa-ink-dim">Waiting for your Puzzle Bubble board…</div>;
  const opponent = view.players.find((player) => player.id !== youId);
  const pressure = puzzleBubbleRules.pressureLimit(view.config.speed);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-2 sm:p-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-pa-border bg-pa-surface p-2 pa-shadow">
          <div><span className="font-display text-[9px] text-pa-ink-dim">SCORE </span><span className="font-display text-[18px] text-pa-amber tabular-nums">{you.score.toLocaleString()}</span></div>
          <div className="font-display text-[9px] text-pa-ink-dim">WAVE {you.wave} · {view.config.speed.toUpperCase()}</div>
          <div className="font-display text-[9px] text-pa-ink-dim">PRESSURE {you.pressureRemaining}/{pressure}</div>
          <div className="flex items-center gap-1"><span className="text-[11px] text-pa-ink-dim">NEXT</span><span className="h-5 w-5 border-2 border-[#15213d]" style={{ backgroundColor: COLOR[you.next].body }} aria-label={`Next ${you.next} bubble`} /></div>
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
          onPointerUp={(event) => {
            fire(aimFromPointer(event));
          }}
          aria-label="Puzzle Bubble playfield. Move to aim and release to fire."
        />
      </div>
      <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-2 sm:mx-auto sm:w-[min(100%,640px)]">
        <button type="button" className="min-h-11 border-2 border-pa-border bg-pa-surface font-display text-[12px] text-pa-cyan pa-shadow active:translate-y-0.5" onClick={() => setAngle((value) => Math.max(-80, value - 4))}>LEFT</button>
        <button type="button" className="min-h-11 border-2 border-pa-amber bg-pa-amber font-display text-[12px] text-pa-shadow pa-shadow disabled:opacity-45" disabled={locked || you.gameOver || view.phase === 'game_over'} onClick={fire}>{you.gameOver ? 'OUT' : locked ? 'AIMING…' : 'FIRE'}</button>
        <button type="button" className="min-h-11 border-2 border-pa-border bg-pa-surface font-display text-[12px] text-pa-cyan pa-shadow active:translate-y-0.5" onClick={() => setAngle((value) => Math.min(80, value + 4))}>RIGHT</button>
      </div>
      <button type="button" className="self-center border-2 border-pa-border bg-pa-surface px-3 py-2 font-display text-[9px] text-pa-ink-dim pa-shadow" onClick={toggleAssist}>ASSIST: {assist ? 'ON' : 'OFF'} · G</button>
    </div>
  );
}
