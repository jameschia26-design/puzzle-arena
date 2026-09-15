import * as React from 'react';
import type {
  BlockBlasterView,
  BlockBlasterPublicPlayer,
  BlockBlasterClearEvent,
} from '@puzzle-arena/games';
import {
  BLOCK_BLASTER_BOARD_SIZE,
  BLOCK_BLASTER_DIFFICULTIES,
  BLOCK_BLASTER_LAYOUTS,
  canPlacePiece,
  type BlockPiece,
  type BlockBlasterDifficulty,
  type BlockBlasterLayout,
} from '@puzzle-arena/shared';
import { PixelButton, PixelPanel } from '../ui/primitives.js';
import { sfx, bgm } from '../ui/sound.js';
import { useRoom } from '../net/socket.js';
import { Flame, Trophy, RotateCcw, Zap, Sparkles, SlidersHorizontal } from 'lucide-react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

interface FloatingText {
  id: number;
  text: string;
  subtext?: string;
  color: string;
  x: number;
  y: number;
}

function getComboTitle(combo: number, lines: number): { title: string; sub: string; color: string } {
  if (combo >= 5) return { title: 'BLASTER GOD!', sub: `COMBO ×${combo}`, color: '#ec4899' };
  if (combo === 4) return { title: 'UNBELIEVABLE!', sub: `COMBO ×${combo}`, color: '#a855f7' };
  if (combo === 3) return { title: 'SUPER!', sub: `COMBO ×${combo}`, color: '#3b82f6' };
  if (combo === 2) return { title: 'COOL!', sub: `COMBO ×${combo}`, color: '#10b981' };
  if (lines >= 3) return { title: 'TRIPLE BLAST!', sub: `+${lines} LINES`, color: '#f59e0b' };
  if (lines === 2) return { title: 'DOUBLE BLAST!', sub: `+${lines} LINES`, color: '#06b6d4' };
  return { title: 'NICE!', sub: '+1 LINE', color: '#38bdf8' };
}

export function BlockBlasterBoard({
  view,
  players: _allPlayers,
  youId,
  legalActions: _legalActions,
  turnEndsAt: _turnEndsAt,
  onAction,
}: {
  view: BlockBlasterView;
  players: unknown;
  youId: string | null;
  legalActions: string[];
  turnEndsAt: number | null;
  onAction: (a: unknown) => void;
}): React.ReactElement {
  const you = view.you;
  const paused = useRoom((s) => s.paused);

  // Refs mirroring the latest props/derived values so drag/keyboard listeners
  // never need to tear down and reattach mid-gesture just because a parent
  // re-render (bot tick, leaderboard broadcast, socket reconnect) produced a
  // new `onAction`/`view` reference. Only real gesture start/stop (dragInfo)
  // or genuine input changes should resubscribe.
  const youRef = React.useRef(you);
  youRef.current = you;
  const onActionRef = React.useRef(onAction);
  onActionRef.current = onAction;
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;

  // Play arcade BGM on mount
  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);

  // Board DOM ref for coordinate math
  const boardRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // Dynamic cell size in pixels
  const [boardPixelSize, setBoardPixelSize] = React.useState<number>(360);
  const cellSize = boardPixelSize / BLOCK_BLASTER_BOARD_SIZE;

  // Track board size on resize
  React.useEffect(() => {
    const updateSize = () => {
      if (boardRef.current) {
        const rect = boardRef.current.getBoundingClientRect();
        if (rect.width > 0) setBoardPixelSize(rect.width);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Whether the current piece is selected for click-to-place / keyboard controls
  const [selected, setSelected] = React.useState(false);

  // Dragging state
  const [dragInfo, setDragInfo] = React.useState<{
    piece: BlockPiece;
    isTouch: boolean;
  } | null>(null);
  const [dragPointer, setDragPointer] = React.useState<{ x: number; y: number } | null>(null);
  const [hoverPos, setHoverPos] = React.useState<{ row: number; col: number; valid: boolean } | null>(null);

  const hoverPosRef = React.useRef(hoverPos);
  hoverPosRef.current = hoverPos;

  // Track pointer start to distinguish click/tap from drag
  const dragStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);

  // Difficulty & Layout controls menu
  const [showConfigMenu, setShowConfigMenu] = React.useState(false);
  const activeDifficulty: BlockBlasterDifficulty = view.config.difficulty ?? 'normal';
  const activeLayout: BlockBlasterLayout = view.config.startingLayout ?? 'templated';

  // Particle & floating announcements state
  const particlesRef = React.useRef<Particle[]>([]);
  const [floatingAnnouncements, setFloatingAnnouncements] = React.useState<FloatingText[]>([]);
  const nextFloatId = React.useRef(1);

  // Blasting lines animation state
  const [blastingRows, setBlastingRows] = React.useState<number[]>([]);
  const [blastingCols, setBlastingCols] = React.useState<number[]>([]);

  // Track previous lines & lastClear for triggering FX
  const prevPiecesPlaced = React.useRef(you?.piecesPlaced ?? 0);
  const prevClear = React.useRef<BlockBlasterClearEvent | null>(null);

  // Watch for clear events to spawn audio & particles
  React.useEffect(() => {
    if (!you) return;
    if (you.piecesPlaced > prevPiecesPlaced.current) {
      prevPiecesPlaced.current = you.piecesPlaced;
      if (you.lastClear && you.lastClear !== prevClear.current) {
        prevClear.current = you.lastClear;
        const { rows, cols, points, combo } = you.lastClear;
        const totalLines = rows.length + cols.length;

        if (totalLines > 0) {
          sfx.blockBlastClear(combo);
          setBlastingRows(rows);
          setBlastingCols(cols);

          if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            const cs = rect.width / BLOCK_BLASTER_BOARD_SIZE;

            const clearedCells = new Set<string>();
            for (const r of rows) {
              for (let c = 0; c < BLOCK_BLASTER_BOARD_SIZE; c++) clearedCells.add(`${r},${c}`);
            }
            for (const c of cols) {
              for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) clearedCells.add(`${r},${c}`);
            }

            clearedCells.forEach((key) => {
              const [rStr, cStr] = key.split(',');
              const r = Number(rStr);
              const c = Number(cStr);
              const cx = c * cs + cs / 2;
              const cy = r * cs + cs / 2;

              for (let i = 0; i < 9; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 2 + Math.random() * 4;
                particlesRef.current.push({
                  x: cx,
                  y: cy,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed,
                  size: 3 + Math.random() * 4,
                  color: '#fbbf24',
                  alpha: 1,
                  life: 0,
                  maxLife: 22 + Math.random() * 14,
                });
              }
            });

            const comboInfo = getComboTitle(combo, totalLines);
            setFloatingAnnouncements((prev) => [
              ...prev,
              {
                id: nextFloatId.current++,
                text: comboInfo.title,
                subtext: `${comboInfo.sub} (+${points} PTS)`,
                color: comboInfo.color,
                x: rect.width / 2,
                y: rect.height / 2,
              },
            ]);
          }

          setTimeout(() => {
            setBlastingRows([]);
            setBlastingCols([]);
          }, 240);
        }
      }
    }
  }, [you?.piecesPlaced, you?.lastClear, you]);

  // Particle animation canvas loop
  React.useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.09;
        p.alpha = Math.max(0, 1 - p.life / p.maxLife);

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Sync canvas size with board
  React.useEffect(() => {
    const updateCanvas = () => {
      if (boardRef.current && canvasRef.current) {
        const rect = boardRef.current.getBoundingClientRect();
        canvasRef.current.width = rect.width;
        canvasRef.current.height = rect.height;
      }
    };
    updateCanvas();
    window.addEventListener('resize', updateCanvas);
    return () => window.removeEventListener('resize', updateCanvas);
  }, [boardPixelSize]);

  // Clear floating announcements
  React.useEffect(() => {
    if (floatingAnnouncements.length === 0) return;
    const timer = setTimeout(() => {
      setFloatingAnnouncements((prev) => prev.slice(1));
    }, 1200);
    return () => clearTimeout(timer);
  }, [floatingAnnouncements]);

  // Currently active piece (either being dragged or selected via tap)
  const activePiece: BlockPiece | null =
    dragInfo !== null ? dragInfo.piece : selected ? (you?.current ?? null) : null;

  // Calculate coordinates on the board given pointer position. Reads the
  // latest `you` via ref so its identity stays stable across renders - it
  // must NOT be a dependency of the drag-tracking effect below.
  const computeTargetCoordinates = React.useCallback(
    (clientX: number, clientY: number, piece: BlockPiece, isTouch: boolean) => {
      const currentYou = youRef.current;
      if (!boardRef.current || !currentYou) return null;
      const rect = boardRef.current.getBoundingClientRect();

      // Touch offset: finger sits 70px below visual piece
      const touchOffsetY = isTouch ? -70 : 0;
      const visualCenterX = clientX;
      const visualCenterY = clientY + touchOffsetY;

      const cs = rect.width / BLOCK_BLASTER_BOARD_SIZE;
      const pieceTopLeftX = visualCenterX - (piece.width * cs) / 2;
      const pieceTopLeftY = visualCenterY - (piece.height * cs) / 2;

      const col = Math.round((pieceTopLeftX - rect.left) / cs);
      const row = Math.round((pieceTopLeftY - rect.top) / cs);

      const valid = canPlacePiece(currentYou.board, piece, row, col);
      return { row, col, valid };
    },
    [],
  );

  // Global window drag event listeners
  React.useEffect(() => {
    if (!dragInfo) return;

    const onWindowPointerMove = (e: PointerEvent) => {
      setDragPointer({ x: e.clientX, y: e.clientY });
      const target = computeTargetCoordinates(e.clientX, e.clientY, dragInfo.piece, dragInfo.isTouch);
      setHoverPos(target);
    };

    const onWindowPointerUp = (e: PointerEvent) => {
      const start = dragStartRef.current;
      const dist = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 100;
      const currentHover = hoverPosRef.current;

      if (dist < 8) {
        // Tap/click on piece: toggle selection
        setSelected((prev) => !prev);
        sfx.blip();
        setHoverPos(null);
      } else {
        // Drag release
        if (currentHover && currentHover.valid) {
          sfx.blockPlace();
          onActionRef.current({
            type: 'place',
            row: currentHover.row,
            col: currentHover.col,
          });
          setSelected(false);
          setHoverPos(null);
        } else {
          sfx.blockInvalid();
          setHoverPos(null);
        }
      }

      setDragInfo(null);
      setDragPointer(null);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, [dragInfo, computeTargetCoordinates]);

  // Pointer down on the current piece
  const handleCurrentPiecePointerDown = (e: React.PointerEvent) => {
    if (paused || you?.gameOver) return;
    const piece = you?.current;
    if (!piece) return;

    const isTouch = e.pointerType === 'touch';
    dragStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    setDragInfo({ piece, isTouch });
    setDragPointer({ x: e.clientX, y: e.clientY });

    const target = computeTargetCoordinates(e.clientX, e.clientY, piece, isTouch);
    setHoverPos(target);
  };

  // Hovering over board cells in Click-to-Place mode
  const handleBoardPointerMove = (e: React.PointerEvent) => {
    if (dragInfo || !selected || !you) return;
    const piece = you.current;
    if (!piece || !boardRef.current) return;

    const rect = boardRef.current.getBoundingClientRect();
    const cs = rect.width / BLOCK_BLASTER_BOARD_SIZE;
    const col = Math.floor((e.clientX - rect.left) / cs);
    const row = Math.floor((e.clientY - rect.top) / cs);

    const valid = canPlacePiece(you.board, piece, row, col);
    setHoverPos({ row, col, valid });
  };

  // Clicking a cell in Click-to-Place mode
  const handleCellClick = (r: number, c: number) => {
    if (paused || you?.gameOver) return;
    if (!selected || !you) return;
    const piece = you.current;
    if (!piece) return;

    if (canPlacePiece(you.board, piece, r, c)) {
      sfx.blockPlace();
      onActionRef.current({
        type: 'place',
        row: r,
        col: c,
      });
      setSelected(false);
      setHoverPos(null);
    } else {
      sfx.blockInvalid();
    }
  };
  // Keyboard controls for full accessibility
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const currentYou = youRef.current;
      if (pausedRef.current || currentYou?.gameOver) return;
      if (e.key === 'Escape') {
        setSelected(false);
        setHoverPos(null);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!selected) {
          if (currentYou?.current) {
            setSelected(true);
            sfx.blip();
          }
        } else if (hoverPosRef.current?.valid) {
          sfx.blockPlace();
          onActionRef.current({
            type: 'place',
            row: hoverPosRef.current.row,
            col: hoverPosRef.current.col,
          });
          setSelected(false);
          setHoverPos(null);
        }
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selected) {
        e.preventDefault();
        const piece = currentYou?.current;
        if (!piece || !currentYou) return;

        setHoverPos((prev) => {
          const curR = prev?.row ?? 0;
          const curC = prev?.col ?? 0;
          let nextR = curR;
          let nextC = curC;
          if (e.key === 'ArrowUp') nextR = Math.max(0, curR - 1);
          if (e.key === 'ArrowDown') nextR = Math.min(BLOCK_BLASTER_BOARD_SIZE - piece.height, curR + 1);
          if (e.key === 'ArrowLeft') nextC = Math.max(0, curC - 1);
          if (e.key === 'ArrowRight') nextC = Math.min(BLOCK_BLASTER_BOARD_SIZE - piece.width, curC + 1);
          return { row: nextR, col: nextC, valid: canPlacePiece(currentYou.board, piece, nextR, nextC) };
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  // Compute ghost preview and lines that would be completed
  const ghostPreview = React.useMemo(() => {
    if (!you || !activePiece || !hoverPos || !hoverPos.valid) return null;
    const { row, col } = hoverPos;

    const testBoard = you.board.map((r) => [...r]);
    for (let r = 0; r < activePiece.shape.length; r++) {
      const sRow = activePiece.shape[r];
      if (!sRow) continue;
      for (let c = 0; c < sRow.length; c++) {
        if (sRow[c] === 1) {
          const bRow = testBoard[row + r];
          if (bRow) bRow[col + c] = activePiece.color;
        }
      }
    }

    const fullRows: number[] = [];
    const fullCols: number[] = [];
    for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
      const rRow = testBoard[r];
      if (rRow && rRow.every((cell) => cell !== 0)) fullRows.push(r);
    }
    for (let c = 0; c < BLOCK_BLASTER_BOARD_SIZE; c++) {
      let isColFull = true;
      for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
        const rRow = testBoard[r];
        if (!rRow || rRow[c] === 0) {
          isColFull = false;
          break;
        }
      }
      if (isColFull) fullCols.push(c);
    }

    return {
      row,
      col,
      fullRows,
      fullCols,
      shape: activePiece.shape,
      color: activePiece.color,
    };
  }, [you, activePiece, hoverPos]);

  const handleRestart = (diff?: BlockBlasterDifficulty, lay?: BlockBlasterLayout) => {
    sfx.blip();
    onAction({
      type: 'restart',
      difficulty: diff ?? activeDifficulty,
      startingLayout: lay ?? activeLayout,
    });
    setSelected(false);
    setHoverPos(null);
    setShowConfigMenu(false);
  };

  return (
    <div className="relative flex flex-col items-center justify-between w-full max-w-4xl mx-auto p-2 sm:p-4 select-none touch-none">
      {/* Top Arcade HUD */}
      <div className="w-full flex items-center justify-between gap-2 mb-3 px-3 py-2 bg-pa-surface border-2 border-pa-border pa-shadow">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim">Score</span>
            <span className="font-display text-2xl sm:text-3xl text-pa-cyan font-bold tracking-tight">
              {you?.score ?? 0}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim flex items-center gap-1">
              <Trophy size={10} className="text-yellow-400" /> Best
            </span>
            <span className="font-display text-sm sm:text-base text-yellow-400 font-bold">
              {Math.max(you?.highScore ?? 0, you?.score ?? 0)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* Difficulty Badge */}
          <button
            type="button"
            onClick={() => setShowConfigMenu((prev) => !prev)}
            className="flex items-center gap-1 px-2 py-1 bg-pa-bg border border-pa-border rounded hover:border-pa-cyan cursor-pointer transition-colors"
          >
            <SlidersHorizontal size={12} className="text-pa-cyan" />
            <span className="font-display text-[9px] uppercase text-pa-cyan font-bold">
              {activeDifficulty}
            </span>
          </button>

          {/* Combo Streak Indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-pa-bg border border-pa-border rounded">
            <Flame
              size={16}
              className={you?.comboStreak && you.comboStreak > 0 ? 'text-orange-500 animate-pulse' : 'text-pa-ink-dim'}
            />
            <div className="flex flex-col items-start leading-none">
              <span className="font-display text-[8px] uppercase text-pa-ink-dim">Combo</span>
              <span
                className={`font-display text-xs sm:text-sm font-bold ${
                  you?.comboStreak && you.comboStreak > 0 ? 'text-orange-400' : 'text-pa-ink-dim'
                }`}
              >
                {you?.comboStreak && you.comboStreak > 0 ? `×${you.comboStreak}` : '0'}
              </span>
            </div>
          </div>

          <div className="hidden xs:flex flex-col items-end">
            <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim flex items-center gap-1">
              <Zap size={10} className="text-pa-cyan" /> Blasted
            </span>
            <span className="font-display text-xs sm:text-sm text-pa-ink font-bold">
              {you?.linesCleared ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* Difficulty & Starting Template Menu Dropdown */}
      {showConfigMenu && (
        <div className="w-full mb-3 p-3 bg-pa-surface border-2 border-pa-cyan pa-shadow rounded-sm animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-2">
            <span className="font-display text-xs text-pa-cyan font-bold flex items-center gap-1">
              <Sparkles size={13} /> SELECT DIFFICULTY &amp; STARTING BOARD
            </span>
            <button
              type="button"
              onClick={() => setShowConfigMenu(false)}
              className="text-xs text-pa-ink-dim hover:text-white px-2 py-0.5 border border-pa-border rounded"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <span className="font-display text-[9px] uppercase text-pa-ink-dim mb-1 block">Difficulty</span>
              <div className="flex gap-1.5">
                {BLOCK_BLASTER_DIFFICULTIES.map((d: BlockBlasterDifficulty) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleRestart(d, activeLayout)}
                    className={`flex-1 py-1.5 px-2 text-xs font-display uppercase tracking-wider border rounded cursor-pointer ${
                      activeDifficulty === d
                        ? 'bg-pa-cyan text-black border-pa-cyan font-bold'
                        : 'bg-pa-bg text-pa-ink border-pa-border hover:border-pa-cyan'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-2">
              <span className="font-display text-[9px] uppercase text-pa-ink-dim mb-1 block">Starting Board</span>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {BLOCK_BLASTER_LAYOUTS.map((lay: BlockBlasterLayout) => (
                  <button
                    key={lay}
                    type="button"
                    onClick={() => handleRestart(activeDifficulty, lay)}
                    className={`py-1.5 px-1 text-[10px] font-display uppercase tracking-tight border rounded cursor-pointer truncate ${
                      activeLayout === lay
                        ? 'bg-pa-cyan text-black border-pa-cyan font-bold'
                        : 'bg-pa-bg text-pa-ink border-pa-border hover:border-pa-cyan'
                    }`}
                    title={lay}
                  >
                    {lay}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-4 w-full">
        {/* Main 8x8 Board Container */}
        <div className="relative flex flex-col items-center">
          <div
            ref={boardRef}
            onPointerMove={handleBoardPointerMove}
            className="relative grid grid-cols-8 grid-rows-8 gap-1 p-2 sm:p-2.5 bg-slate-950 border-4 border-pa-border pa-shadow rounded-sm w-[320px] h-[320px] xs:w-[350px] xs:h-[350px] sm:w-[410px] sm:h-[410px]"
            style={{
              boxShadow: 'inset 0 0 20px rgba(0,0,0,0.8), 0 0 12px rgba(0,0,0,0.5)',
            }}
          >
            {/* 8x8 Cells */}
            {Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }).map((_, r) =>
              Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }).map((_, c) => {
                const cellVal = you?.board[r]?.[c] ?? 0;
                const isOccupied = cellVal !== 0;

                // Ghost Preview check
                let isGhost = false;
                let ghostColor = '';
                if (ghostPreview) {
                  const pr = r - ghostPreview.row;
                  const pc = c - ghostPreview.col;
                  if (
                    pr >= 0 &&
                    pr < ghostPreview.shape.length &&
                    pc >= 0 &&
                    pc < (ghostPreview.shape[pr]?.length ?? 0)
                  ) {
                    if (ghostPreview.shape[pr]?.[pc] === 1) {
                      isGhost = true;
                      ghostColor = ghostPreview.color;
                    }
                  }
                }

                // Line clearing highlight cue
                const isRowGlowing = ghostPreview?.fullRows.includes(r);
                const isColGlowing = ghostPreview?.fullCols.includes(c);
                const isBlasting = blastingRows.includes(r) || blastingCols.includes(c);

                return (
                  <div
                    key={`${r}-${c}`}
                    onClick={() => handleCellClick(r, c)}
                    className={`relative rounded-xs transition-all duration-75 flex items-center justify-center ${
                      isOccupied
                        ? 'pa-press'
                        : 'bg-slate-900/90 border border-slate-800/80 hover:border-slate-500'
                    } ${
                      (isRowGlowing || isColGlowing) && !isOccupied
                        ? 'ring-2 ring-yellow-400 bg-yellow-400/30 animate-pulse'
                        : ''
                    } ${isBlasting ? 'scale-75 opacity-40 brightness-150' : ''}`}
                    style={{
                      backgroundColor: isOccupied
                        ? (cellVal as string)
                        : isGhost
                          ? ghostColor
                          : undefined,
                      opacity: isGhost ? 0.65 : 1,
                      boxShadow: isOccupied
                        ? 'inset 2px 2px 0px rgba(255,255,255,0.45), inset -2px -2px 0px rgba(0,0,0,0.5)'
                        : isGhost
                          ? `0 0 10px ${ghostColor}, inset 1px 1px 0px rgba(255,255,255,0.4)`
                          : undefined,
                    }}
                  >
                    {isOccupied && (
                      <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-white/40 rounded-xs pointer-events-none" />
                    )}
                  </div>
                );
              }),
            )}

            {/* Particle canvas overlay */}
            <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-10" />

            {/* Floating combo announcements */}
            {floatingAnnouncements.map((ann) => (
              <div
                key={ann.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 flex flex-col items-center animate-bounce"
                style={{
                  left: `${ann.x}px`,
                  top: `${ann.y}px`,
                }}
              >
                <span
                  className="font-display text-xl sm:text-2xl font-black drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] tracking-wider px-3 py-1 bg-black/85 border-2 border-white rounded-md"
                  style={{ color: ann.color }}
                >
                  {ann.text}
                </span>
                {ann.subtext && (
                  <span className="font-display text-xs font-bold text-yellow-300 drop-shadow mt-0.5">
                    {ann.subtext}
                  </span>
                )}
              </div>
            ))}

            {/* Game Over Screen Overlay */}
            {you?.gameOver && (
              <div className="absolute inset-0 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 z-30 rounded-sm">
                <span className="font-display text-2xl sm:text-3xl font-black text-pa-danger tracking-wider mb-2 animate-pulse">
                  GAME OVER
                </span>
                <span className="font-display text-xs sm:text-sm text-pa-ink-dim mb-1">
                  NO MOVES LEFT
                </span>

                <div className="flex flex-col items-center my-3 gap-1">
                  <span className="font-display text-sm text-pa-ink-dim uppercase">Final Score</span>
                  <span className="font-display text-3xl font-bold text-pa-cyan">{you.score}</span>
                </div>

                <PixelButton
                  size="md"
                  variant="primary"
                  className="mt-2"
                  onClick={() => handleRestart(activeDifficulty, activeLayout)}
                >
                  <RotateCcw size={14} className="mr-1" />
                  PLAY AGAIN
                </PixelButton>
              </div>
            )}
          </div>

          {/* Current piece to place + preview of what's coming next */}
          <div className="flex items-end justify-center gap-6 sm:gap-8 mt-4 w-full">
            <div className="flex flex-col items-center gap-1">
              <span className="font-display text-[8px] uppercase tracking-wider text-pa-ink-dim/70">Next</span>
              {you?.next && (
                <div className="relative flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-pa-surface/60 border-2 border-pa-border rounded-sm opacity-70 select-none">
                  <div
                    className="grid gap-0.5"
                    style={{
                      gridTemplateRows: `repeat(${you.next.height}, minmax(0, 1fr))`,
                      gridTemplateColumns: `repeat(${you.next.width}, minmax(0, 1fr))`,
                    }}
                  >
                    {you.next.shape.map((row, r) =>
                      row.map((val, c) => (
                        <div
                          key={`${r}-${c}`}
                          className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-xs"
                          style={{ backgroundColor: val === 1 ? you.next.color : 'transparent' }}
                        />
                      )),
                    )}
                  </div>
                </div>
              )}
            </div>

            {you?.current && (() => {
              const piece = you.current;
              return (
                <div
                  onPointerDown={handleCurrentPiecePointerDown}
                  className={`relative flex items-center justify-center w-28 h-28 sm:w-32 sm:h-32 bg-pa-surface border-2 rounded-sm pa-shadow cursor-grab active:cursor-grabbing transition-transform select-none ${
                    selected
                      ? 'border-pa-cyan ring-4 ring-pa-cyan/60 scale-105 shadow-[0_0_12px_rgba(34,211,238,0.5)]'
                      : 'border-pa-border'
                  } ${
                    you.gameOver ? 'border-red-500 ring-2 ring-red-500/80 animate-pulse' : ''
                  } ${dragInfo !== null ? 'opacity-20' : 'hover:border-pa-cyan/70'}`}
                >
                  <div
                    className="grid gap-0.5"
                    style={{
                      gridTemplateRows: `repeat(${piece.height}, minmax(0, 1fr))`,
                      gridTemplateColumns: `repeat(${piece.width}, minmax(0, 1fr))`,
                    }}
                  >
                    {piece.shape.map((row, r) =>
                      row.map((val, c) => (
                        <div
                          key={`${r}-${c}`}
                          className="w-5 h-5 sm:w-6 sm:h-6 rounded-xs"
                          style={{
                            backgroundColor: val === 1 ? piece.color : 'transparent',
                            boxShadow:
                              val === 1
                                ? 'inset 1px 1px 0px rgba(255,255,255,0.45), inset -1px -1px 0px rgba(0,0,0,0.45)'
                                : undefined,
                          }}
                        />
                      )),
                    )}
                  </div>

                  {selected && (
                    <span className="absolute -bottom-2 text-[8px] font-display bg-pa-cyan text-black px-1 rounded uppercase font-bold tracking-tight">
                      Selected
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim/70">
              Drag piece to grid, tap to select, or press Enter
            </span>
          </div>
        </div>

        {/* Multiplayer Opponent Spectator Boards */}
        {view.players.length > 1 && (
          <div className="flex flex-col gap-3 w-full lg:w-48 mt-4 lg:mt-0">
            <PixelPanel title="Rivals" className="w-full">
              <div className="flex flex-row lg:flex-col gap-3 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
                {view.players
                  .filter((p) => p.id !== youId)
                  .map((opponent: BlockBlasterPublicPlayer) => (
                    <div
                      key={opponent.id}
                      className="flex flex-col items-center bg-pa-bg border border-pa-border p-2 rounded shrink-0 w-28 lg:w-full"
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="font-display text-[9px] font-bold text-pa-ink truncate">
                          Seat {opponent.seat + 1}
                        </span>
                        {opponent.gameOver && (
                          <span className="font-display text-[8px] text-pa-danger font-bold uppercase">
                            OUT
                          </span>
                        )}
                      </div>

                      {/* Mini 8x8 Board */}
                      <div className="grid grid-cols-8 grid-rows-8 gap-px p-1 bg-black border border-pa-border w-16 h-16 sm:w-20 sm:h-20">
                        {Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }).map((_, mr) =>
                          Array.from({ length: BLOCK_BLASTER_BOARD_SIZE }).map((_, mc) => {
                            const val = opponent.board[mr]?.[mc] ?? 0;
                            return (
                              <div
                                key={`m-${mr}-${mc}`}
                                className="rounded-2xs"
                                style={{
                                  backgroundColor: val !== 0 ? (val as string) : 'transparent',
                                }}
                              />
                            );
                          }),
                        )}
                      </div>

                      <div className="flex items-center justify-between w-full mt-1.5">
                        <span className="font-display text-[9px] font-bold text-pa-cyan">
                          {opponent.score} pts
                        </span>
                        {opponent.comboStreak > 1 && (
                          <span className="font-display text-[8px] font-bold text-orange-400">
                            ×{opponent.comboStreak}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </PixelPanel>
          </div>
        )}
      </div>

      {/* Floating Dragged Piece matching exact board cell scale */}
      {dragInfo !== null && dragPointer && activePiece && (
        <div
          className="fixed pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2 transition-opacity"
          style={{
            left: `${dragPointer.x}px`,
            top: `${dragPointer.y + (dragInfo.isTouch ? -70 : 0)}px`,
          }}
        >
          <div
            className="grid gap-1 p-1 bg-slate-900/80 rounded-sm border-2 border-pa-cyan shadow-2xl backdrop-blur-xs"
            style={{
              gridTemplateRows: `repeat(${activePiece.height}, minmax(0, 1fr))`,
              gridTemplateColumns: `repeat(${activePiece.width}, minmax(0, 1fr))`,
            }}
          >
            {activePiece.shape.map((row, r) =>
              row.map((val, c) => (
                <div
                  key={`drag-${r}-${c}`}
                  className="rounded-xs"
                  style={{
                    width: `${cellSize}px`,
                    height: `${cellSize}px`,
                    backgroundColor: val === 1 ? activePiece.color : 'transparent',
                    boxShadow:
                      val === 1
                        ? 'inset 2px 2px 0px rgba(255,255,255,0.5), inset -2px -2px 0px rgba(0,0,0,0.5), 0 0 10px rgba(0,0,0,0.5)'
                        : undefined,
                  }}
                />
              )),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
