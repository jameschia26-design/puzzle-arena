import * as React from 'react';
import type {
  BlockBlasterView,
  BlockBlasterPublicPlayer,
  BlockBlasterClearEvent,
} from '@puzzle-arena/games';
import {
  BLOCK_BLASTER_BOARD_SIZE,
  canPlacePiece,
  type BlockPiece,
} from '@puzzle-arena/shared';
import { PixelButton, PixelPanel } from '../ui/primitives.js';
import { sfx, bgm } from '../ui/sound.js';
import { useRoom } from '../net/socket.js';
import { Flame, Trophy, RotateCcw, Zap } from 'lucide-react';

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

  // Play arcade BGM on mount
  React.useEffect(() => {
    bgm.play('arcade');
    return () => bgm.stop();
  }, []);

  // Board DOM ref for coordinate math
  const boardRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // Selected piece from tray for click-to-place fallback
  const [selectedPieceIdx, setSelectedPieceIdx] = React.useState<number | null>(null);

  // Dragging state
  const [draggedIdx, setDraggedIdx] = React.useState<number | null>(null);
  const [dragPointer, setDragPointer] = React.useState<{ x: number; y: number } | null>(null);
  const [hoverPos, setHoverPos] = React.useState<{ row: number; col: number; valid: boolean } | null>(null);

  // Particle & floating announcements state
  const particlesRef = React.useRef<Particle[]>([]);
  const [floatingAnnouncements, setFloatingAnnouncements] = React.useState<FloatingText[]>([]);
  const nextFloatId = React.useRef(1);

  const prevClear = React.useRef<BlockBlasterClearEvent | null>(null);
  const [blastingRows, setBlastingRows] = React.useState<number[]>([]);
  const [blastingCols, setBlastingCols] = React.useState<number[]>([]);

  // Track previous lines & lastClear for triggering FX
  const prevPiecesPlaced = React.useRef(you?.piecesPlaced ?? 0);

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

          // Spawn particle bursts for each cleared cell
          if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            const cellSize = rect.width / BLOCK_BLASTER_BOARD_SIZE;

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
              const cx = c * cellSize + cellSize / 2;
              const cy = r * cellSize + cellSize / 2;

              for (let i = 0; i < 8; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 1.5 + Math.random() * 3.5;
                particlesRef.current.push({
                  x: cx,
                  y: cy,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed,
                  size: 3 + Math.random() * 4,
                  color: '#fbbf24',
                  alpha: 1,
                  life: 0,
                  maxLife: 20 + Math.random() * 15,
                });
              }
            });

            // Add floating banner
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
        p.vy += 0.08; // gravity
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
  }, []);

  // Clear floating announcements after timeout
  React.useEffect(() => {
    if (floatingAnnouncements.length === 0) return;
    const timer = setTimeout(() => {
      setFloatingAnnouncements((prev) => prev.slice(1));
    }, 1200);
    return () => clearTimeout(timer);
  }, [floatingAnnouncements]);

  // Active dragged piece
  const activePiece: BlockPiece | null =
    draggedIdx !== null ? (you?.tray[draggedIdx] ?? null) : selectedPieceIdx !== null ? (you?.tray[selectedPieceIdx] ?? null) : null;

  // Compute ghost placement and lines that would be completed
  const ghostPreview = React.useMemo(() => {
    if (!you || !activePiece || !hoverPos || !hoverPos.valid) return null;
    const { row, col } = hoverPos;

    // Simulate placing piece on board to see what rows/cols complete
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

  // Pointer drag event handlers
  const handlePointerDownPiece = (e: React.PointerEvent, idx: number) => {
    if (paused || you?.gameOver) return;
    const piece = you?.tray[idx];
    if (!piece) return;

    // Select for click-to-place
    setSelectedPieceIdx(idx);

    // Set drag
    setDraggedIdx(idx);
    setDragPointer({ x: e.clientX, y: e.clientY });

    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if unsupported
    }
  };

  const updateHoverCoordinates = (clientX: number, clientY: number, isTouch: boolean, piece: BlockPiece) => {
    if (!boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();

    // Mobile/touch offset: shift Y upward by -70px so thumb doesn't obscure placement
    const touchOffsetY = isTouch ? -70 : 0;
    const px = clientX - rect.left;
    const py = clientY + touchOffsetY - rect.top;

    const cellSize = rect.width / BLOCK_BLASTER_BOARD_SIZE;
    const piecePixelW = piece.width * cellSize;
    const piecePixelH = piece.height * cellSize;

    // Center piece around pointer
    const targetCol = Math.round((px - piecePixelW / 2) / cellSize);
    const targetRow = Math.round((py - piecePixelH / 2) / cellSize);

    if (you) {
      const valid = canPlacePiece(you.board, piece, targetRow, targetCol);
      setHoverPos({ row: targetRow, col: targetCol, valid });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggedIdx === null || !you) return;
    const piece = you.tray[draggedIdx];
    if (!piece) return;

    setDragPointer({ x: e.clientX, y: e.clientY });
    const isTouch = e.pointerType === 'touch';
    updateHoverCoordinates(e.clientX, e.clientY, isTouch, piece);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggedIdx === null || !you) return;
    const pieceIdx = draggedIdx;
    const piece = you.tray[pieceIdx];

    setDraggedIdx(null);
    setDragPointer(null);

    if (piece && hoverPos && hoverPos.valid) {
      // Commit placement
      sfx.blockPlace();
      onAction({
        type: 'place',
        pieceIndex: pieceIdx,
        row: hoverPos.row,
        col: hoverPos.col,
      });
      setSelectedPieceIdx(null);
      setHoverPos(null);
    } else {
      if (hoverPos && !hoverPos.valid) {
        sfx.blockInvalid();
      }
      setHoverPos(null);
    }

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  // Click-to-place tap on board cell
  const handleCellClick = (r: number, c: number) => {
    if (paused || you?.gameOver) return;
    if (selectedPieceIdx === null || !you) return;
    const piece = you.tray[selectedPieceIdx];
    if (!piece) return;

    if (canPlacePiece(you.board, piece, r, c)) {
      sfx.blockPlace();
      onAction({
        type: 'place',
        pieceIndex: selectedPieceIdx,
        row: r,
        col: c,
      });
      setSelectedPieceIdx(null);
      setHoverPos(null);
    } else {
      sfx.blockInvalid();
    }
  };

  return (
    <div
      className="relative flex flex-col items-center justify-between w-full max-w-4xl mx-auto p-2 sm:p-4 select-none touch-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Top Arcade HUD */}
      <div className="w-full flex items-center justify-between gap-2 mb-3 px-2 sm:px-4 py-2 bg-pa-surface border-2 border-pa-border pa-shadow">
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

        <div className="flex items-center gap-3 sm:gap-6">
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

          <div className="flex flex-col items-end">
            <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim flex items-center gap-1">
              <Zap size={10} className="text-pa-cyan" /> Blasted
            </span>
            <span className="font-display text-xs sm:text-sm text-pa-ink font-bold">
              {you?.linesCleared ?? 0}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-4 w-full">
        {/* Main 8x8 Board Container */}
        <div className="relative flex flex-col items-center">
          <div
            ref={boardRef}
            className="relative grid grid-cols-8 grid-rows-8 gap-1 p-2 sm:p-2.5 bg-slate-950 border-4 border-pa-border pa-shadow rounded-sm w-[320px] h-[320px] xs:w-[350px] xs:h-[350px] sm:w-[410px] sm:h-[410px]"
            style={{
              boxShadow: 'inset 0 0 20px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5)',
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
                    className={`relative rounded-sm transition-all duration-75 cursor-pointer flex items-center justify-center ${
                      isOccupied
                        ? 'pa-press'
                        : 'bg-slate-900/90 border border-slate-800/80 hover:border-slate-600/60'
                    } ${
                      (isRowGlowing || isColGlowing) && !isOccupied
                        ? 'ring-2 ring-yellow-400 bg-yellow-400/25 animate-pulse'
                        : ''
                    } ${isBlasting ? 'scale-75 opacity-50 brightness-150' : ''}`}
                    style={{
                      backgroundColor: isOccupied
                        ? (cellVal as string)
                        : isGhost
                          ? ghostColor
                          : undefined,
                      opacity: isGhost ? 0.6 : 1,
                      boxShadow: isOccupied
                        ? 'inset 2px 2px 0px rgba(255,255,255,0.4), inset -2px -2px 0px rgba(0,0,0,0.45)'
                        : isGhost
                          ? `0 0 8px ${ghostColor}`
                          : undefined,
                    }}
                  >
                    {/* Retro inner highlight reflection on occupied blocks */}
                    {isOccupied && (
                      <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-white/40 rounded-xs pointer-events-none" />
                    )}
                  </div>
                );
              }),
            )}

            {/* Particle canvas overlay */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 pointer-events-none z-10"
            />

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
                  className="font-display text-xl sm:text-2xl font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] tracking-wider px-3 py-1 bg-black/80 border-2 border-white rounded-md"
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
                  <span className="font-display text-3xl font-bold text-pa-cyan">
                    {you.score}
                  </span>
                </div>

                <PixelButton
                  size="md"
                  variant="primary"
                  className="mt-2"
                  onClick={() => onAction({ type: 'restart' })}
                >
                  <RotateCcw size={14} className="mr-1" />
                  PLAY AGAIN
                </PixelButton>
              </div>
            )}
          </div>

          {/* 3-Slot Piece Tray */}
          <div className="flex items-center justify-center gap-3 sm:gap-6 mt-4 w-full">
            {you?.tray.map((piece, idx) => {
              const isSelected = selectedPieceIdx === idx;
              const isDraggingThis = draggedIdx === idx;
              const hasMoves = piece && !canPlacePiece(you.board, piece, 0, 0) ? false : true;

              return (
                <div
                  key={piece?.id ?? `empty-${idx}`}
                  onPointerDown={(e) => handlePointerDownPiece(e, idx)}
                  className={`relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 bg-pa-surface border-2 rounded-sm pa-shadow cursor-grab active:cursor-grabbing transition-transform select-none ${
                    isSelected ? 'border-pa-cyan ring-2 ring-pa-cyan/50 scale-105' : 'border-pa-border'
                  } ${
                    you?.gameOver && piece && !hasMoves
                      ? 'border-red-500 ring-2 ring-red-500/80 animate-pulse'
                      : ''
                  } ${isDraggingThis ? 'opacity-30' : 'hover:border-pa-cyan/70'}`}
                >
                  {piece ? (
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
                            className="w-4 h-4 sm:w-5 sm:h-5 rounded-xs"
                            style={{
                              backgroundColor: val === 1 ? piece.color : 'transparent',
                              boxShadow:
                                val === 1
                                  ? 'inset 1px 1px 0px rgba(255,255,255,0.4), inset -1px -1px 0px rgba(0,0,0,0.4)'
                                  : undefined,
                            }}
                          />
                        )),
                      )}
                    </div>
                  ) : (
                    <span className="font-display text-[9px] text-pa-ink-dim/40 uppercase">
                      Empty
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <span className="font-display text-[9px] uppercase tracking-wider text-pa-ink-dim/70 mt-2">
            Drag piece to grid or tap to select
          </span>
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

      {/* Floating Dragged Piece following cursor/finger */}
      {draggedIdx !== null && dragPointer && activePiece && (
        <div
          className="fixed pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2 transition-opacity"
          style={{
            left: `${dragPointer.x}px`,
            top: `${dragPointer.y - 70}px`, // -70px touch offset so piece hovers above touch point
          }}
        >
          <div
            className="grid gap-1 p-1 bg-slate-900/60 rounded border border-white/20 shadow-2xl backdrop-blur-xs scale-110"
            style={{
              gridTemplateRows: `repeat(${activePiece.height}, minmax(0, 1fr))`,
              gridTemplateColumns: `repeat(${activePiece.width}, minmax(0, 1fr))`,
            }}
          >
            {activePiece.shape.map((row, r) =>
              row.map((val, c) => (
                <div
                  key={`drag-${r}-${c}`}
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-xs"
                  style={{
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
