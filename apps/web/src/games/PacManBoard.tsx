import * as React from 'react';
import type { PacManView, GhostState } from '@puzzle-arena/games';
import { useRoom } from '../net/socket.js';
import { sfx, bgm } from '../ui/sound.js';

const GHOST_COLORS: Record<number, string> = {
  0: '#ff3b30',
  1: '#ff8ed6',
  2: '#00d8ff',
  3: '#ffb852',
};
const GHOST_NAMES = ['Blinky', 'Pinky', 'Inky', 'Clyde'];

const CELL = 18; // px per maze cell
const WALL_EDGE_INSET = 4; // px inside a wall tile; leaves room for 22px sprites in 18px corridors
const PAC_ICON_SIZE = 22; // px; intentionally slightly wider than a corridor tile
const GHOST_ICON_SIZE = 22; // px; the SVG body has 1px of viewBox padding
// Engine tick cadence (ms per tile step). The rAF interpolator and chomping
// window use the same cadence so motion and animation stay in sync.
const TICK_MS = 250;

type TilePosition = { x: number; y: number };
/** One sprite's lerp window: previous visual position -> current tick position. */
type SpriteAxis = 'horizontal' | 'vertical';
type SpriteAnim = { from: TilePosition; to: TilePosition; axis: SpriteAxis | null; start: number; duration: number };

function spritePosition(a: SpriteAnim, now: number): TilePosition {
  const dur = a.duration > 0 ? a.duration : TICK_MS;
  const t = Math.min(1, Math.max(0, (now - a.start) / dur));
  return {
    x: a.from.x + (a.to.x - a.from.x) * t,
    y: a.from.y + (a.to.y - a.from.y) * t,
  };
}

function gridStepAxis(from: TilePosition, to: TilePosition): SpriteAxis | null {
  if (from.x !== to.x && from.y === to.y) return 'horizontal';
  if (from.y !== to.y && from.x === to.x) return 'vertical';
  return null;
}

/** Write the interpolated tile position as a translate() transform. */
function applySpriteTransform(el: HTMLElement | null, a: SpriteAnim | null, now: number): TilePosition | null {
  if (!el || !a) return null;
  const position = spritePosition(a, now);
  el.style.transform = `translate(${position.x * CELL}px, ${position.y * CELL}px)`;
  return position;
}

function MazeCell({ tile, fruit }: {
  tile: number;
  fruit: { kind: string; points: number } | null;
}) {
  // tile: 9 wall, 1 dot, 2 pellet, 3 door, 0 empty
  const isWall = tile === 9;
  const isDot = tile === 1;
  const isPellet = tile === 2;
  const isDoor = tile === 3;
  if (isWall) {
    // Wall interiors stay dark; the SVG overlay draws thin blue outline
    // segments on wall/corridor boundaries (authentic line-wall style).
    return <div className="w-full h-full" />;
  }
  return (
    <div className={`w-full h-full relative flex items-center justify-center bg-[#0f1330] ${isDoor ? 'pa-ghost-door' : ''}`}>
      {(isDot || isPellet) && <div className={isPellet ? 'pa-pellet animate-pulse' : 'pa-dot'} />}
      {fruit && <div className="pa-fruit-badge text-[9px] leading-none w-[14px] h-[14px] flex items-center justify-center">{fruitIcon(fruit.kind)}</div>}
    </div>
  );
}
// Pac-Man and ghosts render on a separate absolutely-positioned overlay that
// glides between tiles via rAF interpolation — see the anim refs in
// PacManBoard. Dots stay in the grid underneath, exactly like the arcade.

function fruitIcon(kind: string): string {
  const map: Record<string, string> = { cherry: '🍒', strawberry: '🍓', orange: '🍊', apple: '🍎', melon: '🍈', galaxian: '👾', bell: '🔔', key: '🔑' };
  return map[kind] ?? '🍒';
}
/** Tiny wedge-mouthed Pac-Man for the lives counters. SVG shape, so the
    app-wide `border-radius: 0 !important` flattening can't square it. */
function MiniPacIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" style={{ filter: 'drop-shadow(0 0 2px rgba(255,212,38,0.7))' }}>
      <path fill="#ffd426" d="M6 6 L11.4 8.1 A6 6 0 1 0 11.4 3.9 Z" />
      <circle cx={7.6} cy={2.9} r={0.9} fill="#10142e" />
    </svg>
  );
}

/** 8px ghost silhouette for the legend chips. */
function MiniGhostIcon({ color }: { color: string }) {
  return (
    <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
      <path fill={color} d="M0.5 8 V4.5 A3.5 3.5 0 0 1 7.5 4.5 V8 L6 6.7 L4.5 8 L3 6.7 L1.5 8 Z" />
    </svg>
  );
}

function PacIcon({ dir, moving }: { dir: string; moving: boolean }) {
  // Eye orientation fix: rotating 180deg for `left` flipped the eye to the
  // BOTTOM of the mouth ("upside down eye"). Horizontal mirror keeps the
  // eye on the top half for every heading; up/down rotate the whole frame
  // (arcade-authentic) which only ever turns the eye sideways, never under.
  const flipped = dir === 'left';
  const rot = dir === 'up' ? -90 : dir === 'down' ? 90 : 0;
  return (
    <div className="relative shrink-0" style={{ width: PAC_ICON_SIZE, height: PAC_ICON_SIZE, transform: flipped ? 'scaleX(-1)' : `rotate(${rot}deg)` }}>
      <div className={`pa-pac-trail ${moving ? 'pa-pac-trail-on' : ''}`} />
      <div className="pa-pac-body" style={{ filter: 'drop-shadow(0 0 4px rgba(255,212,38,0.6))' }}>
        {/* Two half-disc jaws hinged at the body center. At rest they sit
            flush (0deg) and together form a solid circle — the classic
            arcade "closed mouth" frame. While moving, plain CSS
            `transform: rotate()` (see theme.css) swings them apart into a
            wide wedge and snaps them shut on a fast loop: no `d: path()`
            interpolation, which many SVG renderers ignore or refuse to
            animate across differing path structures. */}
        <div className={`pa-pac-jaw pa-pac-jaw-top${moving ? ' pa-pac-chomping' : ''}`}>
          <svg width={PAC_ICON_SIZE} height={PAC_ICON_SIZE} viewBox="0 0 18 18" aria-hidden="true">
            <defs>
              <radialGradient id="paPacGlossTop" cx="35%" cy="28%" r="80%">
                <stop offset="0%" stopColor="#fff7c2" />
                <stop offset="45%" stopColor="#ffd426" />
                <stop offset="100%" stopColor="#eda200" />
              </radialGradient>
            </defs>
            <path fill="url(#paPacGlossTop)" d="M9 9 L18 9 A9 9 0 0 0 0 9 Z" />
          </svg>
        </div>
        <div className={`pa-pac-jaw pa-pac-jaw-bottom${moving ? ' pa-pac-chomping' : ''}`}>
          <svg width={PAC_ICON_SIZE} height={PAC_ICON_SIZE} viewBox="0 0 18 18" aria-hidden="true">
            <defs>
              <radialGradient id="paPacGlossBottom" cx="35%" cy="28%" r="80%">
                <stop offset="0%" stopColor="#fff7c2" />
                <stop offset="45%" stopColor="#ffd426" />
                <stop offset="100%" stopColor="#eda200" />
              </radialGradient>
            </defs>
            <path fill="url(#paPacGlossBottom)" d="M9 9 L18 9 A9 9 0 0 1 0 9 Z" />
          </svg>
        </div>
        {/* eye + gleam sit at ~63° off the mouth axis so they survive a
            fully-open chomp; frame rotation makes them direction-aware.
            Rendered outside the jaws so the chomp never rotates them. */}
        <svg width={PAC_ICON_SIZE} height={PAC_ICON_SIZE} viewBox="0 0 18 18" className="pa-pac-eye-layer" aria-hidden="true">
          <circle cx={11.6} cy={3.8} r={1.4} fill="#10142e" />
          <circle cx={12.1} cy={3.3} r={0.5} fill="#ffffff" opacity={0.85} />
        </svg>
      </div>
    </div>
  );
}

function GhostIcon({ ghost }: { ghost: GhostState }) {
  const isFright = ghost.mode === 'frightened';
  const isEaten = ghost.eaten || ghost.mode === 'eaten';
  const flashing = isFright && ghost.frightTicks < 14;
  const bg = flashing ? '#f4f7ff' : isFright ? '#2f6bff' : (GHOST_COLORS[ghost.id] ?? '#fff');
  // pupils track travel direction
  const dx = ghost.dir === 'left' ? -1.1 : ghost.dir === 'right' ? 1.1 : 0;
  const dy = ghost.dir === 'up' ? -1.1 : ghost.dir === 'down' ? 1.1 : 0;
  if (isEaten) {
    // eaten ghosts are just drifting eyes
    return (
      <svg className="shrink-0" width={GHOST_ICON_SIZE} height={GHOST_ICON_SIZE} viewBox="0 0 16 16" aria-hidden="true">
        <ellipse cx={5.4} cy={7} rx={2.6} ry={3.1} fill="#fff" />
        <ellipse cx={10.6} cy={7} rx={2.6} ry={3.1} fill="#fff" />
        <circle cx={5.4 + dx} cy={7 + dy} r={1.3} fill="#2f6bff" />
        <circle cx={10.6 + dx} cy={7 + dy} r={1.3} fill="#2f6bff" />
      </svg>
    );
  }
  return (
    <svg
      className={`pa-ghost-walk shrink-0 ${isFright ? 'pa-ghost-fright' : ''}`}
      width={GHOST_ICON_SIZE}
      height={GHOST_ICON_SIZE}
      viewBox="0 0 16 16"
      style={{ filter: `drop-shadow(0 0 3px ${bg}66)` }}
      aria-hidden="true"
    >
      {/* dome + wavy skirt; the skirt's `d` alternates via CSS (theme.css) */}
      <path
        className="pa-ghost-skirt"
        fill={bg}
        stroke="rgba(6,8,24,0.5)"
        strokeWidth={0.6}
        strokeLinejoin="round"
        d="M1 15 V7 A7 7 0 0 1 15 7 V15 L13.3 13 L11.5 15 L9.7 13 L8 15 L6.3 13 L4.5 15 L2.7 13 L1 15 Z"
      />
      {isFright ? (
        <>
          <rect x={3.2} y={6} width={2.8} height={1.5} rx={0.75} fill="#f4f7ff" />
          <rect x={10} y={6} width={2.8} height={1.5} rx={0.75} fill="#f4f7ff" />
          <path d="M3.4 11 L5 12.6 L6.6 11 L8 12.6 L9.4 11 L11 12.6 L12.6 11" fill="none" stroke="#f4f7ff" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <ellipse cx={5.4} cy={7.2} rx={2.7} ry={3.2} fill="#fff" />
          <ellipse cx={10.6} cy={7.2} rx={2.7} ry={3.2} fill="#fff" />
          <circle cx={5.4 + dx} cy={7.2 + dy} r={1.4} fill="#1b2aff" />
          <circle cx={10.6 + dx} cy={7.2 + dy} r={1.4} fill="#1b2aff" />
        </>
      )}
    </svg>
  );
}

export function PacManBoard({
  view,
  youId,
  onAction,
}: {
  view: PacManView;
  players: unknown;
  youId: string | null;
  legalActions: string[];
  turnEndsAt: number | null;
  onAction: (a: unknown) => void;
}): React.ReactElement {
  const you = view.you;
  const paused = useRoom((s) => s.paused);
  const W = view.mazeW;
  const H = view.mazeH;

  type ControlMode = 'joystick' | 'pad';
  type PadAlign = 'left' | 'center' | 'right';

  const [controlMode, setControlMode] = React.useState<ControlMode>(() => {
    try {
      const saved = localStorage.getItem('pa:pacman-controls');
      return saved === 'pad' ? 'pad' : 'joystick';
    } catch {
      return 'joystick';
    }
  });

  const [padAlign, setPadAlign] = React.useState<PadAlign>(() => {
    try {
      const saved = localStorage.getItem('pa:pacman-pad-align');
      return saved === 'left' || saved === 'right' ? saved : 'center';
    } catch {
      return 'center';
    }
  });

  const handleSetControlMode = (mode: ControlMode) => {
    setControlMode(mode);
    try {
      localStorage.setItem('pa:pacman-controls', mode);
    } catch {}
  };

  const handleSetPadAlign = (align: PadAlign) => {
    setPadAlign(align);
    try {
      localStorage.setItem('pa:pacman-pad-align', align);
    } catch {}
  };

  // Touch and tick loops outlive individual room snapshots; keep them pointed
  // at the latest socket action callback without re-arming the loops.
  const actionRef = React.useRef(onAction);
  actionRef.current = onAction;

  React.useEffect(() => {
    bgm.play('pacman' as never);
    return () => bgm.stop();
  }, []);

  const prevScore = React.useRef(you?.score ?? 0);
  const prevDots = React.useRef(you?.dotsRemaining ?? 244);
  React.useEffect(() => {
    if (!you) return;
    if (you.score > prevScore.current) {
      if (you.dotsRemaining < prevDots.current) {
        // ate pellet
        if (you.score - prevScore.current >= 50) sfx.pacPower && sfx.pacPower();
        else sfx.pacWaka && sfx.pacWaka();
      } else if (you.score - prevScore.current >= 200) {
        sfx.pacEatGhost && sfx.pacEatGhost();
      }
    }
    prevScore.current = you.score;
    prevDots.current = you.dotsRemaining;
  }, [you?.score, you?.dotsRemaining, you]);

  // Keyboard
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!you || you.gameOver || view.phase === 'game_over') return;
      let dir: string | null = null;
      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W': dir = 'up'; break;
        case 'ArrowDown': case 's': case 'S': dir = 'down'; break;
        case 'ArrowLeft': case 'a': case 'A': dir = 'left'; break;
        case 'ArrowRight': case 'd': case 'D': dir = 'right'; break;
      }
      if (dir) {
        e.preventDefault();
        onAction({ type: 'dir', dir });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [you, view.phase, onAction]);

  // Pac-Man is client-driven: the server watchdog is only a one-second
  // recovery path. Emit authoritative logic ticks at the engine cadence while
  // this player is alive; rAF below makes each resulting tile step smooth.
  React.useEffect(() => {
    if (!you || you.gameOver || view.phase === 'game_over' || paused) return;
    const interval = window.setInterval(() => actionRef.current({ type: 'tick' }), TICK_MS);
    return () => window.clearInterval(interval);
  }, [you?.gameOver, view.phase, paused]);



  // --- Responsive maze scaling -------------------------------------------
  // 28x31 cells at 18px is 504x558 — wider than a 390px portrait phone.
  // The maze renders at fixed CELL geometry and is scaled to fit the space
  // left over after the HUD (top) and D-pad (bottom thumb zone).
  const mazeBoxRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const update = () => {
      const el = mazeBoxRef.current;
      if (!el) return;
      const shellChrome = 20;
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const availW = Math.max(0, (vw < 1024 ? vw : el.clientWidth) - shellChrome - 16);
      if (vw < 1024) {
        // Mobile portrait: top HUD (~42px), ghost legend (~24px), Joypad (~135px), safe areas + gaps (~30px)
        const nonMazeHeight = 235;
        const availH = Math.max(180, vh - nonMazeHeight);
        const s = Math.min(availW / (W * CELL), availH / (H * CELL));
        setScale(Math.max(0.35, Math.min(s, 2.5)));
      } else {
        const top = el.getBoundingClientRect().top;
        const availH = Math.max(220, vh - top - 40);
        const s = Math.min(availW / (W * CELL), availH / (H * CELL));
        setScale(Math.max(0.35, Math.min(s, 1.35)));
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (mazeBoxRef.current) ro.observe(mazeBoxRef.current);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [W, H]);

  // Chomping belongs to the actual interpolation window, not to a one-render
  // comparison of server snapshots. Room-state updates that arrive mid-glide
  // must not close Pac-Man's mouth before the sprite has reached its tile.
  const [pacMoving, setPacMoving] = React.useState(false);
  const pacMotionSeqRef = React.useRef(0);
  const pacMotionTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (pacMotionTimerRef.current !== null) window.clearTimeout(pacMotionTimerRef.current);
  }, []);

  const stopPacChomp = () => {
    pacMotionSeqRef.current += 1;
    if (pacMotionTimerRef.current !== null) {
      window.clearTimeout(pacMotionTimerRef.current);
      pacMotionTimerRef.current = null;
    }
    setPacMoving(false);
  };

  const startPacChomp = () => {
    const seq = pacMotionSeqRef.current + 1;
    pacMotionSeqRef.current = seq;
    if (pacMotionTimerRef.current !== null) window.clearTimeout(pacMotionTimerRef.current);
    setPacMoving(true);
    pacMotionTimerRef.current = window.setTimeout(() => {
      if (pacMotionSeqRef.current === seq) {
        pacMotionTimerRef.current = null;
        setPacMoving(false);
      }
    }, TICK_MS);
  };

  // --- Smooth sprite interpolation ---------------------------------------
  // The engine moves one tile per tick (TICK_MS); rendering bare tick
  // snapshots makes Pac-Man and ghosts pop tile-by-tile. The rAF loop tracks
  // each sprite's rendered float position. A tick that continues along the
  // same axis starts from that float; a turn instead starts at the last
  // confirmed tile, preserving its orthogonal corner. Tunnel wraps and
  // respawns (|delta| > 1 tile) still snap instantly — never fly linearly
  // across tunnel mouths.
  const pacElRef = React.useRef<HTMLDivElement | null>(null);
  const ghostElsRef = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const spriteAnimRef = React.useRef<{ pac: SpriteAnim | null; ghosts: Map<number, SpriteAnim> }>({
    pac: null,
    ghosts: new Map(),
  });
  const spriteVisualRef = React.useRef<{ pac: TilePosition | null; ghosts: Map<number, TilePosition> }>({
    pac: null,
    ghosts: new Map(),
  });
  const lastPacPosRef = React.useRef<TilePosition | null>(null);
  const lastGhostPosRef = React.useRef<Map<number, TilePosition>>(new Map());

  // Re-arm targets only when a tick actually changes a sprite's tile.
  // useLayoutEffect writes its current visual position before paint, so
  // sprites never flash or reset to an older tile when socket timing varies.
  React.useLayoutEffect(() => {
    const now = performance.now();
    const anim = spriteAnimRef.current;
    const visual = spriteVisualRef.current;
    if (you) {
      const cur = you.pacPos;
      const last = lastPacPosRef.current;
      if (!last || last.x !== cur.x || last.y !== cur.y) {
        const axis = last ? gridStepAxis(last, cur) : null;
        const snap = !last || !axis || Math.abs(cur.x - last.x) > 1 || Math.abs(cur.y - last.y) > 1;
        // A turn must start at its last confirmed tile, not a fractional
        // position still travelling along the prior axis.
        const from = !snap && axis === anim.pac?.axis && visual.pac
          ? visual.pac
          : snap
            ? { ...cur }
            : { ...last! };
        const duration = Math.max(1, Math.hypot(cur.x - from.x, cur.y - from.y) * TICK_MS);
        anim.pac = { from, to: { ...cur }, axis, start: now, duration };
        visual.pac = from;
        if (snap) stopPacChomp();
        else startPacChomp();
      }
      lastPacPosRef.current = { ...cur };
      for (const g of you.ghosts) {
        const gLast = lastGhostPosRef.current.get(g.id);
        if (!gLast || gLast.x !== g.pos.x || gLast.y !== g.pos.y) {
          const axis = gLast ? gridStepAxis(gLast, g.pos) : null;
          const snap = !gLast || !axis || Math.abs(g.pos.x - gLast.x) > 1 || Math.abs(g.pos.y - gLast.y) > 1;
          const previous = anim.ghosts.get(g.id);
          const visualPosition = visual.ghosts.get(g.id);
          const from = !snap && axis === previous?.axis && visualPosition
            ? visualPosition
            : snap
              ? { ...g.pos }
              : { ...gLast! };
          const duration = Math.max(1, Math.hypot(g.pos.x - from.x, g.pos.y - from.y) * TICK_MS);
          anim.ghosts.set(g.id, { from, to: { ...g.pos }, axis, start: now, duration });
        }
        lastGhostPosRef.current.set(g.id, { ...g.pos });
      }
    }
    const pacVisual = applySpriteTransform(pacElRef.current, anim.pac, now);
    if (pacVisual) visual.pac = pacVisual;
    for (const [id, a] of anim.ghosts) {
      const ghostVisual = applySpriteTransform(ghostElsRef.current.get(id) ?? null, a, now);
      if (ghostVisual) visual.ghosts.set(id, ghostVisual);
    }
  });

  // 60 FPS glide: lerp every sprite toward its tick target. Transform is
  // written straight to the DOM — React stays out of the animation path.
  React.useEffect(() => {
    let raf = 0;
    const step = () => {
      const now = performance.now();
      const anim = spriteAnimRef.current;
      const visual = spriteVisualRef.current;
      const pacVisual = applySpriteTransform(pacElRef.current, anim.pac, now);
      if (pacVisual) visual.pac = pacVisual;
      for (const [id, a] of anim.ghosts) {
        const ghostVisual = applySpriteTransform(ghostElsRef.current.get(id) ?? null, a, now);
        if (ghostVisual) visual.ghosts.set(id, ghostVisual);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!you) {
    return <div className="text-pa-ink-dim text-sm">Loading Pac-Man…</div>;
  }

  // Line-wall path: for each wall tile draw a thin segment on every edge that
  // faces a corridor (or the outside) — authentic thin-outline maze. Door
  // tiles count as wall so the dashed door line is the only line there.
  const isWallAt = (x: number, y: number) =>
    x >= 0 && x < W && y >= 0 && y < H && (you.maze[y * W + x] ?? 9) === 9;
  const doorAt = (x: number, y: number) =>
    x >= 0 && x < W && y >= 0 && y < H && you.maze[y * W + x] === 3;
  // Keep the grid's collision edges unchanged, but put each visual wall line
  // inside its wall tile. A centered 22px sprite otherwise overlaps the
  // boundary stroke of an 18px-wide corridor.
  let wallPath = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isWallAt(x, y)) continue;
      if (!isWallAt(x, y - 1) && !doorAt(x, y - 1)) wallPath += `M${x * CELL} ${y * CELL + WALL_EDGE_INSET}h${CELL}`;
      if (!isWallAt(x, y + 1) && !doorAt(x, y + 1)) wallPath += `M${x * CELL} ${(y + 1) * CELL - WALL_EDGE_INSET}h${CELL}`;
      if (!isWallAt(x - 1, y) && !doorAt(x - 1, y)) wallPath += `M${x * CELL + WALL_EDGE_INSET} ${y * CELL}v${CELL}`;
      if (!isWallAt(x + 1, y) && !doorAt(x + 1, y)) wallPath += `M${(x + 1) * CELL - WALL_EDGE_INSET} ${y * CELL}v${CELL}`;
    }
  }
  return (

    <div
      className="w-full h-full max-h-full overflow-hidden flex flex-col lg:flex-row gap-1 lg:gap-4 items-center lg:items-start justify-start lg:justify-between min-w-0 p-1.5 sm:p-2"
      style={{
        paddingTop: 'max(6px, env(safe-area-inset-top))',
        paddingBottom: 'max(6px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(6px, env(safe-area-inset-left))',
        paddingRight: 'max(6px, env(safe-area-inset-right))',
      }}
    >
      {/* Desktop left HUD rail */}
      <div className="hidden lg:flex flex-col gap-3 min-w-[160px]">
        <div className="bg-pa-surface border-2 border-pa-border p-3 shadow-[4px_4px_0_var(--color-pa-shadow)]">
          <div className="font-display text-[10px] text-pa-ink-dim tracking-widest">SCORE</div>
          <div className="font-display text-[18px] text-pa-amber tabular-nums">{you.score.toLocaleString()}</div>
          <div className="flex gap-2 mt-2 text-xs font-body">
            <span className="text-pa-ink-dim">Level</span><span className="text-pa-cyan font-bold">{you.level}</span>
            <span className="text-pa-ink-dim">Dots</span><span className="text-pa-ink">{you.dotsRemaining}</span>
          </div>
          {you.fruit && <div className="mt-2 text-xs text-pa-lime animate-pulse">{fruitIcon(you.fruit.kind)} {you.fruit.kind} {you.fruit.points}</div>}
        </div>
        <div className="bg-pa-surface border-2 border-pa-border p-2 flex items-center gap-1">
          <span className="font-display text-[9px] text-pa-ink-dim">LIVES</span>
          <span className="flex gap-1 ml-1">
            {Array.from({ length: Math.max(0, you.lives) }).map((_, i) => (
              <MiniPacIcon key={i} />
            ))}
            {you.lives === 0 && <span className="text-pa-danger text-xs font-display">0</span>}
          </span>
        </div>
        <div className="text-[11px] text-pa-ink-dim leading-relaxed">
          Arrow keys / WASD to steer • Eat <span className="text-pa-amber">○</span> power pellets to frighten ghosts • <span className="text-pa-cyan">200</span>/<span className="text-pa-cyan">400</span>/<span className="text-pa-cyan">800</span>/<span className="text-pa-cyan">1600</span> per ghost
        </div>
        {view.players.length > 1 && (
          <div className="bg-pa-surface border-2 border-pa-border p-2">
            <div className="font-display text-[9px] text-pa-ink-dim mb-1">STANDINGS</div>
            {[...view.players].sort((a, b) => (b as PacManView['players'][number]).score - (a as PacManView['players'][number]).score).map((p) => (
              <div key={p.id} className={`flex justify-between text-xs px-2 py-1 border ${p.id === youId ? 'border-pa-cyan bg-pa-surface-2' : 'border-pa-border'}`}>
                <span>{p.id === youId ? 'YOU' : `P${p.seat + 1}`}</span><span className="font-display text-[10px]">{p.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mobile compact HUD (top bar) */}
      <div className="lg:hidden w-full flex items-center justify-between gap-2 bg-pa-surface border-2 border-pa-border px-3 py-1.5 pa-shadow pr-10">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[9px] text-pa-ink-dim">SCORE</span>
          <span className="font-display text-[13px] text-pa-amber tabular-nums">{you.score.toLocaleString()}</span>
        </div>
        {you.fruit && <span className="text-pa-lime animate-pulse text-sm">{fruitIcon(you.fruit.kind)}</span>}
        <span className="flex gap-1 items-center" aria-label={`Lives ${you.lives}`}>
          {Array.from({ length: Math.max(0, you.lives) }).map((_, i) => (
            <MiniPacIcon key={i} size={10} />
          ))}
          {you.lives === 0 && <span className="text-pa-danger text-xs font-display">0</span>}
        </span>
        <div className="flex items-baseline gap-1.5 text-xs font-body">
          <span className="text-pa-ink-dim">Lv</span><span className="text-pa-cyan font-bold">{you.level}</span>
          <span className="text-pa-ink-dim ml-1.5">Dots</span><span className="text-pa-ink">{you.dotsRemaining}</span>
        </div>
      </div>
      {/* Maze — fixed CELL geometry scaled to fill portrait */}
      <div className="w-full lg:w-auto flex flex-col items-center gap-1 lg:gap-2">

        <div ref={mazeBoxRef} className="w-full flex justify-center">
          <div
            className="relative pa-maze-shell"
            style={{ width: W * CELL * scale + 20, height: H * CELL * scale + 20 }}
          >
            <div className="relative overflow-hidden select-none pa-maze-clip" style={{ width: W * CELL * scale, height: H * CELL * scale }}>
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{ width: W * CELL, height: H * CELL, transform: `scale(${scale})` }}
              >
                <div
                  className="grid gap-0"
                  style={{ gridTemplateColumns: `repeat(${W}, ${CELL}px)`, gridTemplateRows: `repeat(${H}, ${CELL}px)`, width: W * CELL, height: H * CELL }}
                >
                  {Array.from({ length: W * H }).map((_, i) => {
                    const x = i % W;
                    const y = Math.floor(i / W);
                    const fruit = you.fruit && you.fruit.pos.x === x && you.fruit.pos.y === y ? you.fruit : null;
                    return (
                      <div key={i} style={{ width: CELL, height: CELL }}>
                        <MazeCell tile={you.maze[i] ?? 9} fruit={fruit as never} />
                      </div>
                    );
                  })}
                </div>
                {/* Gliding sprite layer — Pac-Man and ghosts interpolate
                    between tick positions via rAF (see spriteAnimRef above).
                    Ghosts render first so Pac-Man eats visually on overlap. */}
                <div className="absolute inset-0 pointer-events-none">
                  {you.ghosts.map((g) => (
                    <div
                      key={g.id}
                      ref={(el) => {
                        if (el) ghostElsRef.current.set(g.id, el);
                        else ghostElsRef.current.delete(g.id);
                      }}
                      className="absolute top-0 left-0 flex items-center justify-center"
                      style={{ width: CELL, height: CELL }}
                    >
                      <GhostIcon ghost={g} />
                    </div>
                  ))}
                  {you.dyingTicks === 0 && (
                    <div
                      ref={pacElRef}
                      className="absolute top-0 left-0 flex items-center justify-center"
                      style={{ width: CELL, height: CELL }}
                    >
                      <PacIcon dir={you.pacDir} moving={pacMoving} />
                    </div>
                  )}
                </div>
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={W * CELL}
                  height={H * CELL}
                  viewBox={`0 0 ${W * CELL} ${H * CELL}`}
                  aria-hidden="true"
                >
                  <defs>
                    <filter id="paWallGlow" x="-15%" y="-15%" width="130%" height="130%">
                      <feGaussianBlur stdDeviation="1" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {/* neon triple-stroke: soft halo, bright body, cool highlight */}
                  <path d={wallPath} fill="none" stroke="#1a3cff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.4} filter="url(#paWallGlow)" />
                  <path d={wallPath} fill="none" stroke="#3d5bff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={wallPath} fill="none" stroke="#9db4ff" strokeWidth={0.7} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
                </svg>
              </div>
              {(you.gameOver || view.phase === 'game_over') && (
                <div className="absolute inset-0 bg-pa-bg/85 flex flex-col items-center justify-center gap-2">
                  <div className="font-display text-pa-danger text-sm">GAME OVER</div>
                  <div className="text-pa-ink text-xs">{view.winner === youId ? 'You win!' : view.winner ? 'Game over' : 'Game over'}</div>
                  <div className="font-display text-pa-amber">{you.score} PTS</div>
                </div>
              )}
              {you.dyingTicks > 0 && !you.gameOver && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="font-display text-pa-danger text-xs bg-pa-bg border-2 border-pa-danger px-3 py-1">— HIT —</div>
                </div>
              )}
              {you.levelClearTicks > 0 && (
                <div className="absolute inset-0 bg-pa-amber/10 flex items-center justify-center">
                  <div className="font-display text-pa-amber text-sm animate-pulse">LEVEL CLEAR!</div>
                </div>
              )}
              </div>
            </div>
        </div>
        {/* Ghost legend */}
        <div className="flex gap-1 lg:gap-2 justify-center">
          {GHOST_NAMES.map((n, i) => (
            <span key={i} className="pa-chip text-[9px] font-display px-2 py-0.5 border flex items-center gap-1" style={{ borderColor: GHOST_COLORS[i], color: GHOST_COLORS[i], background: 'rgba(0,0,0,0.35)' }}>
              <MiniGhostIcon color={GHOST_COLORS[i] ?? '#fff'} />
            </span>
          ))}
          <span className="pa-chip text-[9px] font-display text-pa-amber border border-pa-amber px-2">○ POWER</span>
        </div>
      </div>
      {/* Mobile Controls & Mode / Alignment Settings */}
      <div className="lg:hidden w-full max-w-sm mx-auto px-2 flex flex-col items-center gap-1">
        {/* Compact Settings row */}
        <div className="w-full flex items-center justify-between gap-2 px-1 text-[9px] font-display">
          {/* Mode toggle: STICK | PAD */}
          <div className="flex items-center gap-1.5">
            <span className="text-pa-ink-dim tracking-wider">CTRL:</span>
            <div className="inline-flex border-2 border-pa-border bg-pa-surface shadow-[1px_1px_0_var(--color-pa-shadow)]">
              <button
                type="button"
                onClick={() => handleSetControlMode('joystick')}
                className={`px-2 py-0.5 cursor-pointer transition-colors ${
                  controlMode === 'joystick'
                    ? 'bg-pa-cyan text-pa-bg font-bold'
                    : 'text-pa-ink-dim hover:text-pa-ink'
                }`}
                aria-pressed={controlMode === 'joystick'}
              >
                STICK
              </button>
              <button
                type="button"
                onClick={() => handleSetControlMode('pad')}
                className={`px-2 py-0.5 cursor-pointer transition-colors border-l-2 border-pa-border ${
                  controlMode === 'pad'
                    ? 'bg-pa-cyan text-pa-bg font-bold'
                    : 'text-pa-ink-dim hover:text-pa-ink'
                }`}
                aria-pressed={controlMode === 'pad'}
              >
                PAD
              </button>
            </div>
          </div>

          {/* Alignment toggle (shown in both STICK and PAD modes) */}
          <div className="flex items-center gap-1.5">
            <span className="text-pa-ink-dim tracking-wider">ALIGN:</span>
            <div className="inline-flex border-2 border-pa-border bg-pa-surface shadow-[1px_1px_0_var(--color-pa-shadow)]">
              <button
                type="button"
                onClick={() => handleSetPadAlign('left')}
                className={`px-1.5 py-0.5 cursor-pointer transition-colors ${
                  padAlign === 'left'
                    ? 'bg-pa-amber text-pa-bg font-bold'
                    : 'text-pa-ink-dim hover:text-pa-ink'
                }`}
                aria-label="Align left"
                title="Align left"
                aria-pressed={padAlign === 'left'}
              >
                L
              </button>
              <button
                type="button"
                onClick={() => handleSetPadAlign('center')}
                className={`px-1.5 py-0.5 cursor-pointer transition-colors border-l-2 border-pa-border ${
                  padAlign === 'center'
                    ? 'bg-pa-amber text-pa-bg font-bold'
                    : 'text-pa-ink-dim hover:text-pa-ink'
                }`}
                aria-label="Align center"
                title="Align center"
                aria-pressed={padAlign === 'center'}
              >
                C
              </button>
              <button
                type="button"
                onClick={() => handleSetPadAlign('right')}
                className={`px-1.5 py-0.5 cursor-pointer transition-colors border-l-2 border-pa-border ${
                  padAlign === 'right'
                    ? 'bg-pa-amber text-pa-bg font-bold'
                    : 'text-pa-ink-dim hover:text-pa-ink'
                }`}
                aria-label="Align right"
                title="Align right"
                aria-pressed={padAlign === 'right'}
              >
                R
              </button>
            </div>
          </div>
        </div>

        {/* Persistent Joystick or Joypad widget */}
        {controlMode === 'joystick' ? (
          <Joystick
            align={padAlign}
            onDir={(dir) => onAction({ type: 'dir', dir })}
          />
        ) : (
          <Joypad
            align={padAlign}
            onDir={(dir) => onAction({ type: 'dir', dir })}
          />
        )}
      </div>

      {/* Right rail log */}
      <div className="min-w-[180px] max-w-[220px] hidden lg:block">
        <div className="font-display text-[10px] text-pa-ink-dim mb-1">LOG</div>
        <div className="bg-pa-surface border-2 border-pa-border p-2 h-[280px] overflow-auto text-xs font-body space-y-1">
          {view.log.slice(-12).map((e, i) => (
            <div key={i} className="text-pa-ink-dim leading-tight">• {e.text}</div>
          ))}
          {view.log.length === 0 && <div className="text-pa-ink-dim italic">No events yet</div>}
        </div>
      </div>
    </div>
  );
}

/** Cross-shaped mobile Joypad: UP top, LEFT/RIGHT sides, DOWN bottom, center hub. */
function Joypad({
  onDir,
  align,
}: {
  onDir: (dir: 'up' | 'down' | 'left' | 'right') => void;
  align: 'left' | 'center' | 'right';
}) {
  const press = (dir: 'up' | 'down' | 'left' | 'right') => (e: React.PointerEvent) => {
    e.preventDefault();
    onDir(dir);
  };

  const btnBase =
    'bg-pa-surface border-2 border-pa-border text-pa-ink font-display cursor-pointer touch-none select-none ' +
    'active:bg-pa-surface-2 active:border-pa-cyan active:text-pa-cyan active:translate-y-[1px] ' +
    'shadow-[2px_2px_0_var(--color-pa-shadow)] flex items-center justify-center';

  const alignClass =
    align === 'left' ? 'justify-start pl-2' : align === 'right' ? 'justify-end pr-2' : 'justify-center';

  return (
    <div className={`w-full flex ${alignClass} py-0.5`} role="group" aria-label="Mobile Joypad">
      <div className="grid grid-cols-3 grid-rows-3 w-[120px] h-[120px] touch-none select-none">
        {/* Row 1: UP */}
        <div className="invisible pointer-events-none" />
        <button
          type="button"
          className={`${btnBase} w-full h-full text-sm`}
          onPointerDown={press('up')}
          aria-label="Move up"
        >
          <span>▲</span>
        </button>
        <div className="invisible pointer-events-none" />

        {/* Row 2: LEFT - CENTER HUB - RIGHT */}
        <button
          type="button"
          className={`${btnBase} w-full h-full text-sm`}
          onPointerDown={press('left')}
          aria-label="Move left"
        >
          <span>◀</span>
        </button>
        <div
          className="bg-pa-surface border-2 border-pa-border flex items-center justify-center pointer-events-none select-none shadow-[2px_2px_0_var(--color-pa-shadow)]"
          aria-hidden="true"
        >
          <div className="w-2 h-2 rounded-full bg-pa-border/70" />
        </div>
        <button
          type="button"
          className={`${btnBase} w-full h-full text-sm`}
          onPointerDown={press('right')}
          aria-label="Move right"
        >
          <span>▶</span>
        </button>

        {/* Row 3: DOWN */}
        <div className="invisible pointer-events-none" />
        <button
          type="button"
          className={`${btnBase} w-full h-full text-sm`}
          onPointerDown={press('down')}
          aria-label="Move down"
        >
          <span>▼</span>
        </button>
        <div className="invisible pointer-events-none" />
      </div>
    </div>
  );
}

/** Persistent mobile Joystick: cyan base ring, amber draggable nub with axis locking. */
function Joystick({
  onDir,
  align,
}: {
  onDir: (dir: 'up' | 'down' | 'left' | 'right') => void;
  align: 'left' | 'center' | 'right';
}) {
  const [nub, setNub] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const dragRef = React.useRef<{
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  const THRESHOLD = 14;
  const MARGIN_RATIO = 0.65;
  const MAX_NUB_DISTANCE = 42;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dragRef.current !== null) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const from = dragRef.current;
    if (!from || from.id !== e.pointerId) return;
    e.preventDefault();

    const dragX = e.clientX - from.startX;
    const dragY = e.clientY - from.startY;
    const absDragX = Math.abs(dragX);
    const absDragY = Math.abs(dragY);

    // Snap to dominant compass direction; nub locks visually to that single axis line only
    let nubX = 0;
    let nubY = 0;
    if (absDragX >= absDragY) {
      nubX = Math.sign(dragX) * Math.min(absDragX, MAX_NUB_DISTANCE);
      nubY = 0;
    } else {
      nubX = 0;
      nubY = Math.sign(dragY) * Math.min(absDragY, MAX_NUB_DISTANCE);
    }

    setNub({ x: nubX, y: nubY });

    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Dispatch only along the locked dominant axis; preserve hysteresis thresholds
    if (absDragX >= absDragY) {
      if (absDx >= THRESHOLD && absDy <= absDx * MARGIN_RATIO) {
        onDir(dx > 0 ? 'right' : 'left');
        dragRef.current = { ...from, x: e.clientX, y: e.clientY };
      }
    } else {
      if (absDy >= THRESHOLD && absDx <= absDy * MARGIN_RATIO) {
        onDir(dy > 0 ? 'down' : 'up');
        dragRef.current = { ...from, x: e.clientX, y: e.clientY };
      }
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const from = dragRef.current;
    if (from && from.id === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      dragRef.current = null;
      setIsDragging(false);
      setNub({ x: 0, y: 0 });
    }
  };

  const alignClass =
    align === 'left' ? 'justify-start pl-2' : align === 'right' ? 'justify-end pr-2' : 'justify-center';

  return (
    <div className={`w-full flex ${alignClass} py-0.5`} role="group" aria-label="Mobile Joystick">
      <div
        className="relative w-[124px] h-[124px] touch-none select-none cursor-pointer flex items-center justify-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid="pacman-joystick"
      >
        {/* Cyan base ring */}
        <svg
          className="absolute inset-0 h-full w-full drop-shadow-[0_0_12px_rgba(0,216,255,0.7)] pointer-events-none"
          viewBox="0 0 124 124"
          aria-hidden="true"
        >
          <circle cx="62" cy="62" r="59" fill="#00d8ff" fillOpacity="0.14" stroke="#00d8ff" strokeOpacity="0.9" strokeWidth="2" />
          <circle cx="62" cy="62" r="46" fill="none" stroke="#ffd426" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="4 6" />
          <path d="M62 10v16M62 98v16M10 62h16M98 62h16" stroke="#00d8ff" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
        </svg>

        {/* Amber draggable nub */}
        <svg
          className="absolute left-[39px] top-[39px] h-[46px] w-[46px] drop-shadow-[0_0_10px_rgba(255,212,38,0.9)] will-change-transform pointer-events-none"
          viewBox="0 0 46 46"
          style={{
            transform: `translate(${nub.x}px, ${nub.y}px)`,
            transition: isDragging ? 'none' : 'transform 120ms ease-out',
          }}
          data-testid="pacman-joystick-nub"
          aria-hidden="true"
        >
          <circle cx="23" cy="23" r="21" fill="#ffd426" fillOpacity="0.74" stroke="#fff3ad" strokeWidth="2" />
          <circle cx="17" cy="17" r="5" fill="#fff7c2" fillOpacity="0.85" />
        </svg>
      </div>
    </div>
  );
}
