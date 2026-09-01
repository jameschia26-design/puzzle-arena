import * as React from 'react';
import type { TetrisView, TetrominoKind } from '@puzzle-arena/games';
import { useRoom } from '../net/socket.js';
import { sfx, bgm } from '../ui/sound.js';

const COLORS: Record<TetrominoKind, string> = {
  I: '#22e0ff',
  J: '#3b6bff',
  L: '#ff8c1a',
  O: '#ffd426',
  S: '#2ee66b',
  T: '#8b5cf6',
  Z: '#ff3f8e',
};

const GHOST_ALPHA: Record<TetrominoKind, string> = {
  I: 'rgba(34,224,255,0.22)',
  J: 'rgba(59,107,255,0.22)',
  L: 'rgba(255,140,26,0.22)',
  O: 'rgba(255,212,38,0.22)',
  S: 'rgba(46,230,107,0.22)',
  T: 'rgba(139,92,246,0.22)',
  Z: 'rgba(255,63,142,0.22)',
};
const FLIP_STORAGE_KEY = 'pa:tetris-flip';

function MiniGrid({ cells, color }: { cells: boolean[][]; color: string }) {
  return (
    <div
      className="grid gap-px p-1 bg-pa-bg border-2 border-pa-border"
      style={{ gridTemplateColumns: `repeat(${cells[0]?.length ?? 4}, minmax(0,1fr))` }}
    >
      {cells.flat().map((filled, i) => (
        <div key={i} className="w-2 h-2 lg:w-3 lg:h-3" style={{ background: filled ? color : 'transparent' }} />
      ))}
    </div>
  );
}

function kindToMini(kind: TetrominoKind): boolean[][] {
  const map: Record<TetrominoKind, boolean[][]> = {
    I: [[false,false,false,false],[true,true,true,true],[false,false,false,false],[false,false,false,false]],
    J: [[true,false,false],[true,true,true],[false,false,false]],
    L: [[false,false,true],[true,true,true],[false,false,false]],
    O: [[true,true],[true,true]],
    S: [[false,true,true],[true,true,false],[false,false,false]],
    T: [[false,true,false],[true,true,true],[false,false,false]],
    Z: [[true,true,false],[false,true,true],[false,false,false]],
  };
  return map[kind] ?? [[false]];
}

/**
 * Touch/pointer button that fires on press (not click) so the action lands
 * instantly, with optional auto-repeat while held. Pointer events cover both
 * touch and mouse, so desktop users can also click these.
 */
function PressButton({
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
      className={`${className ?? ''} ${pressed ? 'bg-pa-surface-2' : ''}`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        setPressed(true);
        onFire();
        if (repeatMs) timer.current = window.setInterval(onFire, repeatMs);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      {children}
    </button>
  );
}

/**
 * Board cell size in px. The 10×20 board must fit between the sticky header,
 * the mobile info strip, mobile side controls, and the bottom action buttons,
 * so on narrow screens the cell is derived from the visual viewport
 * (dvh-safe via visualViewport) instead of being a fixed 22px.
 */
function useCellSize(): number {
  const calc = React.useCallback((): number => {
    if (typeof window === 'undefined') return 22;
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    if (vw >= 1024) return Math.max(14, Math.min(30, Math.floor((vh - 150) / 20)));
    // Mobile portrait: fit info strip, board, side controls, and action buttons without scrolling
    const maxH = Math.max(200, vh - 220);
    const maxW = Math.max(160, vw - 64);
    return Math.max(14, Math.floor(Math.min(maxW / 10, maxH / 20, 30)));
  }, []);
  const [cell, setCell] = React.useState<number>(() => {
    if (typeof window === 'undefined') return 22;
    return calc();
  });
  React.useEffect(() => {
    const onResize = () => setCell(calc());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [calc]);
  return cell;
}

export function TetrisBoard({
  view,
  youId,
  onAction,
}: {
  view: TetrisView;
  players: unknown;
  youId: string | null;
  legalActions: string[];
  turnEndsAt: number | null;
  onAction: (a: unknown) => void;
}): React.ReactElement {
  const you = view.you;
  const paused = useRoom((s) => s.paused);
  const cell = useCellSize();
  // Play BGM when view mounted; stop on unmount
  React.useEffect(() => {
    bgm.play('tetris' as never);
    return () => bgm.stop();
  }, []);
  const [flipped, setFlipped] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(FLIP_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleFlip = React.useCallback(() => {
    setFlipped((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FLIP_STORAGE_KEY, String(next));
      } catch {
        /* private browsing */
      }
      sfx.blip();
      return next;
    });
  }, []);


  const [levelUpFlash, setLevelUpFlash] = React.useState(false);
  const prevLevel = React.useRef(you?.level ?? 1);
  React.useEffect(() => {
    if (you && you.level !== prevLevel.current) {
      prevLevel.current = you.level;
      setLevelUpFlash(true);
      sfx.extraTurn();
      setTimeout(() => setLevelUpFlash(false), 600);
    }
  }, [you?.level, you]);

  const [clearedRows, setClearedRows] = React.useState<number[]>([]);
  const prevBoard = React.useRef(you?.board ?? []);
  const prevLines = React.useRef(you?.lines ?? 0);
  const clearFlashTimer = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!you) return;
    if (you.lines > prevLines.current) {
      const fullRows = Array.from({ length: 20 }, (_, y) => y)
        .filter((y) => prevBoard.current.slice(y * 10, (y + 1) * 10).every(Boolean));
      // The active piece is rendered separately from board, so a just-locked
      // piece can make the exact cleared row unavailable in the prior grid.
      // In that case flash the board rather than dropping the clear animation.
      const rows = fullRows.length > 0 ? fullRows : Array.from({ length: 20 }, (_, y) => y);
      if (clearFlashTimer.current !== null) window.clearTimeout(clearFlashTimer.current);
      setClearedRows(rows);
      clearFlashTimer.current = window.setTimeout(() => {
        clearFlashTimer.current = null;
        setClearedRows([]);
      }, 240);
    }
    prevBoard.current = you.board;
    prevLines.current = you.lines;
  }, [you?.board, you?.lines]);
  React.useEffect(() => () => {
    if (clearFlashTimer.current !== null) window.clearTimeout(clearFlashTimer.current);
  }, []);

  // Keyboard handling
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!you || you.gameOver || view.phase === 'game_over') return;
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); onAction({ type: 'move', dir: 'left' }); sfx.blip(); break;
        case 'ArrowRight': e.preventDefault(); onAction({ type: 'move', dir: 'right' }); sfx.blip(); break;
        case 'ArrowDown': e.preventDefault(); onAction({ type: 'softDrop' }); sfx.chip(); break;
        case 'ArrowUp': e.preventDefault(); onAction({ type: 'rotate', dir: 'cw' }); sfx.turn(); break;
        case 'z': case 'Z': e.preventDefault(); onAction({ type: 'rotate', dir: 'ccw' }); sfx.turn(); break;
        case ' ': e.preventDefault(); onAction({ type: 'hardDrop' }); sfx.tembak(); break;
        case 'g': case 'G': e.preventDefault(); onAction({ type: 'toggleAssist' }); sfx.blip(); break;
        case 'c': case 'C': e.preventDefault(); onAction({ type: 'hold' }); sfx.deal(); break;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [you, view.phase, onAction]);

  // Prevent browser scroll/zoom for gestures that begin in the playable area.
  // React's touch listeners are passive, so this must be native and non-passive.
  const playAreaRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const playArea = playAreaRef.current;
    if (!playArea) return;
    const preventDefault = (e: Event) => e.preventDefault();
    playArea.addEventListener('touchmove', preventDefault, { passive: false });
    playArea.addEventListener('gesturestart', preventDefault);
    playArea.addEventListener('gesturechange', preventDefault);
    playArea.addEventListener('dblclick', preventDefault);
    return () => {
      playArea.removeEventListener('touchmove', preventDefault);
      playArea.removeEventListener('gesturestart', preventDefault);
      playArea.removeEventListener('gesturechange', preventDefault);
      playArea.removeEventListener('dblclick', preventDefault);
    };
  }, []);

  // The board supports horizontal drag-steering plus delayed single-tap
  // rotation, so a second tap can be recognized as a soft drop.
  const boardTap = React.useRef<{
    id: number;
    startX: number;
    startY: number;
    refX: number;
    refY: number;
    startedAt: number;
    moved: boolean;
  } | null>(null);
  const tapTimerRef = React.useRef<number | null>(null);
  const lastTapAtRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    window.clearTimeout(tapTimerRef.current);
  }, []);

  // Gravity tick loop (client-driven). Level determines interval; we tick the server while alive.
  const gravityRef = React.useRef<number>(0);
  const tickRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!you || you.gameOver || view.phase === 'game_over' || paused) return;
    const gravityMs = Math.max(80, 1000 - (you.level - 1) * 80);
    const loop = () => {
      onAction({ type: 'tick' });
      tickRef.current = setTimeout(loop, gravityMs);
    };
    tickRef.current = setTimeout(loop, gravityMs);
    return () => { if (tickRef.current) clearTimeout(tickRef.current); };

  }, [you?.level, you?.gameOver, view.phase, paused, onAction]);
  if (!you) {
    return <div className="text-pa-ink-dim text-sm">Loading Tetris…</div>;
  }

  const dead = you.gameOver || view.phase === 'game_over';
  const board = you.board;
  const active = you.active;
  const ghostY = you.ghostY;

  const boardTouch = {
    onPointerDown: (e: React.PointerEvent) => {
      if (window.innerWidth >= 1024) return;
      e.preventDefault();
      boardTap.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        refX: e.clientX,
        refY: e.clientY,
        startedAt: Date.now(),
        moved: false,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const tap = boardTap.current;
      if (!tap || tap.id !== e.pointerId || dead || window.innerWidth >= 1024) return;
      const totalDistance = Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY);
      if (totalDistance >= 14) {
        tap.moved = true;
        if (tapTimerRef.current !== null) {
          window.clearTimeout(tapTimerRef.current);
          tapTimerRef.current = null;
          lastTapAtRef.current = null;
        }
      }

      // Keep the original y reference, but advance x by exactly one cell for
      // every crossed threshold so a long continuous drag keeps moving.
      let dx = e.clientX - tap.refX;
      while (Math.abs(dx) >= cell) {
        const dir = dx > 0 ? 'right' : 'left';
        onAction({ type: 'move', dir });
        sfx.blip();
        tap.moved = true;
        tap.refX += dir === 'right' ? cell : -cell;
        dx = e.clientX - tap.refX;
      }
      e.preventDefault();
    },
    onPointerUp: (e: React.PointerEvent) => {
      const tap = boardTap.current;
      boardTap.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }
      if (!tap || tap.id !== e.pointerId || dead || window.innerWidth >= 1024) return;
      e.preventDefault();
      const isTap = !tap.moved && Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY) < 14;
      if (!isTap) {
        if (tapTimerRef.current !== null) {
          window.clearTimeout(tapTimerRef.current);
          tapTimerRef.current = null;
          lastTapAtRef.current = null;
        }
        return;
      }

      const now = Date.now();
      const previousTapAt = lastTapAtRef.current;
      if (tapTimerRef.current !== null && previousTapAt !== null && now - previousTapAt <= 280) {
        window.clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
        lastTapAtRef.current = null;
        onAction({ type: 'softDrop' });
        sfx.chip();
        return;
      }

      window.clearTimeout(tapTimerRef.current);
      lastTapAtRef.current = now;
      tapTimerRef.current = window.setTimeout(() => {
        tapTimerRef.current = null;
        lastTapAtRef.current = null;
        if (!dead) {
          onAction({ type: 'rotate', dir: 'cw' });
          sfx.turn();
        }
      }, 280);
    },
    onPointerCancel: () => { boardTap.current = null; },
  };


  // Build cell set for ghost and active to render
  const activeCells = new Set<string>();
  const ghostCells = new Set<string>();
  if (active && ghostY !== null) {
    const { tetrominoCells } = (() => {
      // inline: compute cells (duplicate logic from rules but keep view simple)
      const BASE: Record<string, [number, number][]> = {
        I: [[-1,0],[0,0],[1,0],[2,0]], J: [[-1,0],[-1,1],[0,0],[1,0]], L: [[-1,0],[0,0],[1,0],[1,1]],
        O: [[0,0],[1,0],[0,1],[1,1]], S: [[-1,1],[0,1],[0,0],[1,0]], T: [[-1,0],[0,0],[1,0],[0,1]], Z: [[-1,0],[0,0],[0,1],[1,1]],
      };
      const rot = (off: [number, number][], r: number) => {
        let cs = off.map(c=>[...c] as [number, number]);
        for(let i=0;i<(((r%4)+4)%4);i++) cs = cs.map(([x,y])=>[y,-x] as [number,number]);
        return cs;
      };
      return { tetrominoCells: (t: {kind:string;x:number;y:number;rot:number}) => rot((BASE[t.kind]??[]), t.rot).map(([dx,dy])=>[t.x+dx,t.y+dy] as [number,number]) };
    })();
    if (active) {
      for (const [cx, cy] of tetrominoCells(active as never)) if (cy>=0) activeCells.add(`${cx},${cy}`);
      for (const [cx, cy] of tetrominoCells({ ...active, y: ghostY } as never)) if (cy>=0 && !activeCells.has(`${cx},${cy}`)) ghostCells.add(`${cx},${cy}`);
    }
  }

  const guard = (fn: () => void) => () => {
    if (dead) return;
    fn();
  };

  return (
    <div
      className="w-full h-full max-h-full overflow-hidden flex flex-col lg:flex-row gap-2 lg:gap-4 items-center lg:items-start justify-between min-w-0 p-2 sm:p-3"
      style={{
        paddingTop: 'max(8px, env(safe-area-inset-top))',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(8px, env(safe-area-inset-left))',
        paddingRight: 'max(8px, env(safe-area-inset-right))',
      }}
    >
      {/*
        Mobile: one info strip (hold | stats | next). On desktop (`lg:contents`)
        the strip dissolves so its children flow as columns of the row layout.
        Stacked/flex-wrapped so narrow 360px viewports never overflow.
      */}
      <div className="order-1 w-full max-w-full overflow-x-hidden flex items-start justify-between gap-2 lg:contents min-w-0 pr-9 lg:pr-0">
        {/* Hold */}
        <div className="flex flex-col gap-1 lg:gap-2 shrink-0 lg:order-1">
          <div className="font-display text-[10px] tracking-widest text-pa-ink-dim">HOLD</div>
          <div className="w-[70px] h-[54px] sm:w-[76px] sm:h-[58px] lg:w-[92px] lg:h-[72px] bg-pa-surface border-2 border-pa-border flex items-center justify-center">
            {you.hold ? <MiniGrid cells={kindToMini(you.hold)} color={COLORS[you.hold]} /> : <span className="text-pa-ink-dim text-xs">—</span>}
          </div>
        </div>

        {/* Stats + assist + (desktop) mouse controls */}
        <div className="flex flex-row flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-body min-w-0 lg:flex-col lg:items-stretch lg:gap-2 lg:min-w-[92px] lg:order-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 lg:block lg:space-y-1">
            <div className="flex items-baseline gap-1 lg:justify-between">
              <span className="text-pa-ink-dim text-[11px] sm:text-xs">Score</span><span className="font-display text-pa-cyan text-[11px] sm:text-xs tabular">{you.score}</span>
            </div>
            <div className="flex items-baseline gap-1 lg:justify-between">
              <span className="text-pa-ink-dim text-[11px] sm:text-xs">Lines</span><span className="font-display text-pa-ink text-[11px] sm:text-xs tabular">{you.lines}</span>
            </div>
            <div className={`inline-flex items-center gap-1 px-1 py-0.5 border border-pa-amber/60 bg-pa-surface lg:border-0 lg:bg-transparent lg:p-0 lg:flex lg:justify-between ${levelUpFlash ? 'animate-pulse border-pa-amber bg-pa-amber/20' : ''}`}>
              <span className="font-display text-[8px] sm:text-[9px] text-pa-ink-dim tracking-wider lg:hidden">LVL</span>
              <span className="text-pa-ink-dim text-xs hidden lg:inline">Level</span>
              <span className="font-display text-pa-amber text-[10px] sm:text-xs font-bold tabular">{you.level}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {you.combo >= 0 && <span className="text-pa-lime text-[10px] sm:text-xs">Combo x{you.combo + 1}</span>}
            {you.backToBack && <span className="text-pa-magenta text-[10px] sm:text-xs">B2B</span>}
          </div>
          <button
            className={`h-7 sm:h-8 px-2 lg:px-0 lg:w-full border-2 text-[8px] sm:text-[9px] lg:text-[10px] font-display tracking-widest ${view.config.assist ? 'bg-pa-cyan text-pa-bg border-pa-cyan' : 'bg-pa-surface text-pa-ink-dim border-pa-border hover:bg-pa-surface-2'}`}
            onClick={() => { onAction({ type: 'toggleAssist' }); sfx.blip(); }}
          >
            ASSIST {view.config.assist ? 'ON' : 'OFF'}
          </button>
          {/* Mouse-clickable controls (desktop only; mobile gets the touch pad below the board) */}
          <div className="hidden lg:grid grid-cols-3 gap-1 mt-2">
            <button className="h-8 bg-pa-surface border-2 border-pa-border text-[10px] font-display hover:bg-pa-surface-2" onClick={() => { onAction({type:'move', dir:'left'}); sfx.blip();}}>◀</button>
            <button className="h-8 bg-pa-surface border-2 border-pa-border text-[10px] font-display hover:bg-pa-surface-2" onClick={() => { onAction({type:'rotate', dir:'cw'}); sfx.turn();}}>⟳</button>
            <button className="h-8 bg-pa-surface border-2 border-pa-border text-[10px] font-display hover:bg-pa-surface-2" onClick={() => { onAction({type:'move', dir:'right'}); sfx.blip();}}>▶</button>
            <button className="h-8 bg-pa-cyan text-pa-bg border-2 border-pa-cyan font-display text-[10px] col-span-3" onClick={() => { onAction({type:'hardDrop'}); sfx.tembak();}}>HARD DROP</button>
            <button className="h-7 bg-pa-surface border-2 border-pa-border text-[10px] font-display col-span-3" onClick={() => { onAction({type:'softDrop'}); sfx.chip();}}>soft</button>
            <button className="h-7 bg-pa-surface border-2 border-pa-border text-[10px] font-display col-span-3" onClick={() => { onAction({type:'hold'}); sfx.deal();}}>HOLD (C)</button>
          </div>
        </div>

        {/* Next queue (+ keyboard legend on desktop) */}
        <div className="flex flex-col gap-1 lg:gap-2 shrink-0 lg:order-4">
          <div className="font-display text-[10px] tracking-widest text-pa-ink-dim">NEXT</div>
          <div className="flex lg:flex-col gap-1.5 lg:gap-2">
            {you.next.slice(0, 5).map((k, i) => (
              <div
                key={i}
                className={`bg-pa-surface border-2 ${i === 0 ? 'border-pa-cyan' : 'border-pa-border'} p-0.5 lg:p-1 flex justify-center ${i >= 3 ? 'hidden lg:flex' : ''}`}
                style={{ opacity: 1 - i * 0.12 }}
              >
                <MiniGrid cells={kindToMini(k)} color={COLORS[k]} />
              </div>
            ))}
          </div>
          <div className="hidden lg:block text-[11px] text-pa-ink-dim leading-relaxed max-w-[200px] mt-2">
            ← → move • ↑ / Z rotate • ↓ soft • Space hard • C hold • G assist
          </div>
        </div>
      </div>

      {/* On phones, broad side zones flank the board; the board itself is the rotate target. */}
      <div className="order-2 lg:order-3 flex flex-col items-center gap-1.5 sm:gap-2 lg:gap-4 min-w-0 w-full max-w-full overflow-hidden flex-1 justify-center">
        <div ref={playAreaRef} className="flex items-stretch justify-center w-full touch-none lg:contents">
          <PressButton
            label="Move left"
            className="lg:hidden flex-1 min-w-6 self-stretch bg-pa-surface/30 border border-pa-border/40 text-[9px] font-display text-pa-ink-dim touch-none active:bg-pa-surface/60"
            onFire={guard(() => { onAction({ type: 'move', dir: 'left' }); sfx.blip(); })}
          >
            <span className="[writing-mode:vertical-rl]">LEFT</span>
          </PressButton>
          <div
            className="relative bg-pa-bg border-2 border-pa-border p-0.5 sm:p-1 shadow-[4px_4px_0_var(--color-pa-shadow)] touch-none select-none shrink-0 mx-auto"
            onContextMenu={(e) => e.preventDefault()}
            {...boardTouch}
          >
            <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(10, ${cell}px)` }}>
              {Array.from({ length: 200 }).map((_, i) => {
                const x = i % 10;
                const y = Math.floor(i / 10);
                const key = `${x},${y}`;
                const filled = board[y * 10 + x];
                const isActive = activeCells.has(key);
                const isGhost = ghostCells.has(key);
                const color = isActive ? COLORS[active!.kind] : filled ? COLORS[filled as TetrominoKind] : undefined;
                return (
                  <div
                    key={i}
                    className="border border-pa-border/40 flex items-center justify-center"
                    style={{
                      width: cell,
                      height: cell,
                      background: isActive ? color : isGhost ? GHOST_ALPHA[active!.kind] : filled ? color : '#161a2e',
                      borderStyle: isGhost ? 'dashed' : 'solid',
                      boxShadow: isActive || filled ? 'inset 2px 2px 0 rgba(255,255,255,0.22), inset -2px -2px 0 rgba(0,0,0,0.25)' : undefined,
                    }}
                  />
                );
              })}
            </div>
            {clearedRows.map((y) => (
              <div
                key={y}
                className="pointer-events-none absolute z-10 bg-pa-cyan/90 animate-pulse"
                style={{ left: 4, top: 4 + y * (cell + 1), width: cell * 10 + 9, height: cell, animationDuration: '240ms' }}
              />
            ))}
            {(you.gameOver || view.phase === 'game_over') && (
              <div className="absolute inset-0 bg-pa-bg/80 flex flex-col items-center justify-center gap-2">
                <div className="font-display text-pa-danger text-sm">TOP OUT</div>
                <div className="text-pa-ink text-xs">{view.winner === youId ? 'You win!' : view.winner ? 'Game over' : 'Game over'}</div>
              </div>
            )}
          </div>
          <PressButton
            label="Move right"
            className="lg:hidden flex-1 min-w-6 self-stretch bg-pa-surface/30 border border-pa-border/40 text-[9px] font-display text-pa-ink-dim touch-none active:bg-pa-surface/60"
            onFire={guard(() => { onAction({ type: 'move', dir: 'right' }); sfx.blip(); })}
          >
            <span className="[writing-mode:vertical-rl]">RIGHT</span>
          </PressButton>
        </div>

        <div
          className="lg:hidden w-full max-w-[440px] grid grid-cols-2 gap-1.5 sm:gap-2 select-none px-1"
          style={{ touchAction: 'none' }}
        >
          {flipped ? (
            <>
              <PressButton
                label="Down"
                className="h-10 sm:h-12 bg-pa-surface border-2 border-pa-border text-pa-ink font-display text-xs touch-none"
                onFire={guard(() => { onAction({ type: 'softDrop' }); sfx.chip(); })}
              >
                DOWN
              </PressButton>
              <PressButton
                label="Hard Drop"
                className="h-10 sm:h-12 bg-pa-cyan text-pa-bg border-2 border-pa-cyan font-display text-xs touch-none"
                onFire={guard(() => { onAction({ type: 'hardDrop' }); sfx.tembak(); })}
              >
                HARD DROP
              </PressButton>
            </>
          ) : (
            <>
              <PressButton
                label="Hard Drop"
                className="h-10 sm:h-12 bg-pa-cyan text-pa-bg border-2 border-pa-cyan font-display text-xs touch-none"
                onFire={guard(() => { onAction({ type: 'hardDrop' }); sfx.tembak(); })}
              >
                HARD DROP
              </PressButton>
              <PressButton
                label="Down"
                className="h-10 sm:h-12 bg-pa-surface border-2 border-pa-border text-pa-ink font-display text-xs touch-none"
                onFire={guard(() => { onAction({ type: 'softDrop' }); sfx.chip(); })}
              >
                DOWN
              </PressButton>
            </>
          )}
          <div className="col-span-2 flex gap-1.5 sm:gap-2">
            <PressButton
              label="Rotate"
              className="flex-1 h-10 sm:h-12 bg-pa-surface border-2 border-pa-border text-pa-ink font-display text-xs touch-none"
              onFire={guard(() => { onAction({ type: 'rotate', dir: 'cw' }); sfx.turn(); })}
            >
              ROTATE
            </PressButton>
            <button
              type="button"
              aria-label="Flip drop buttons layout"
              title="Flip drop buttons layout"
              className="h-10 sm:h-12 px-3 bg-pa-surface border-2 border-pa-border text-pa-ink-dim hover:text-pa-ink font-display text-[10px] sm:text-xs shrink-0 flex items-center justify-center gap-1 active:bg-pa-surface-2 touch-none"
              onClick={toggleFlip}
            >
              <span className="text-xs">⇄</span>
              <span>FLIP</span>
            </button>
          </div>
        </div>
      </div>

      {/* Standings */}
      {view.players.length > 1 && (
        <div className="order-3 lg:order-5 w-full lg:w-[200px]">
          <div className="hidden lg:block font-display text-[10px] text-pa-ink-dim mb-1">STANDINGS</div>
          <div className="flex gap-2 lg:block lg:space-y-1">
            {[...view.players].sort((a,b)=> b.score - a.score).map((p) => (
              <div key={p.id} className={`flex justify-between text-xs px-2 py-1 border-2 ${p.id===youId ? 'border-pa-cyan bg-pa-surface' : 'border-pa-border bg-pa-surface/60'}`}>
                <span className="truncate">{p.id===youId ? 'YOU' : `P${p.seat+1}`}</span>
                <span className="font-display text-[10px] tabular">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
