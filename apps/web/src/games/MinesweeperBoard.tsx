import React from 'react';
import {
  minesweeper,
  type MinesweeperPlayerState,
  type MinesweeperPuzzle,
  type MinesweeperSolution,
} from '@puzzle-arena/puzzles';
import type { PlayerView } from '@puzzle-arena/shared';
import { PixelPanel } from '../ui/primitives.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { cn } from '../ui/cn.js';
import { bgm, sfx, unlockAudioSession } from '../ui/sound.js';
import { Flag, Trophy, Bomb } from 'lucide-react';

const { revealCell, getNeighbors, MINE } = minesweeper;

export interface MinesweeperBoardProps {
  puzzle: MinesweeperPuzzle;
  board: unknown;
  solution: MinesweeperSolution | null;
  players: PlayerView[];
  youId: string | null;
  turnEndsAt?: number | null;
  onCommit: (path: string, value: number | string | null) => void;
  onHint?: () => void;
}

const NUMBER_COLORS: Record<number, string> = {
  1: 'text-[#38bdf8]',
  2: 'text-[#4ade80]',
  3: 'text-[#f87171]',
  4: 'text-[#818cf8]',
  5: 'text-[#fb923c]',
  6: 'text-[#2dd4bf]',
  7: 'text-[#c084fc]',
  8: 'text-[#94a3b8]',
};

export function MinesweeperBoard({
  puzzle,
  board,
  solution: propsSolution,
  players,
  youId,
  turnEndsAt,
  onCommit,
  onHint,
}: MinesweeperBoardProps): React.ReactElement {
  const { rows, cols, totalMines } = puzzle;
  const totalCells = rows * cols;
  const totalNonMines = totalCells - totalMines;

  // Derive solution locally from seed if available
  const solution = React.useMemo(() => {
    if (propsSolution) return propsSolution;
    if (puzzle.seed !== undefined) {
      return minesweeper.generate({
        seed: puzzle.seed,
        difficulty: puzzle.difficulty ?? (puzzle.rows === 9 ? 'easy' : puzzle.rows === 16 ? 'medium' : 'hard'),
      }).solution;
    }
    return null;
  }, [propsSolution, puzzle]);

  // Local private flags — strictly client-side, never exposed to other players!
  const [flags, setFlags] = React.useState<Set<number>>(new Set());
  const [flagMode, setFlagMode] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  // Local revealed and detonated state for instant responsive visual feedback
  const [localRevealed, setLocalRevealed] = React.useState<boolean[]>(() => {
    if (board && typeof board === 'object' && 'revealed' in board && Array.isArray(board.revealed)) {
      return (board.revealed as boolean[]).slice(0, totalCells);
    }
    return new Array<boolean>(totalCells).fill(false);
  });
  const [localDetonated, setLocalDetonated] = React.useState<boolean>(() => {
    if (board && typeof board === 'object' && 'detonated' in board) {
      return Boolean(board.detonated);
    }
    return false;
  });
  // Synchronize with incoming server state updates
  React.useEffect(() => {
    if (board && typeof board === 'object') {
      const b = board as MinesweeperPlayerState;
      if (Array.isArray(b.revealed)) {
        setLocalRevealed((prev) => {
          const next = [...prev];
          for (let i = 0; i < totalCells; i++) {
            if (b.revealed[i]) next[i] = true;
          }
          return next;
        });
      }
      if (b.detonated) setLocalDetonated(true);
    }
  }, [board, totalCells]);

  const revealed = localRevealed;
  const isDetonated = localDetonated;

  // Count revealed non-mines
  let revealedNonMines = 0;
  if (solution) {
    for (let i = 0; i < totalCells; i++) {
      if (revealed[i] && solution.grid[i] !== MINE) revealedNonMines++;
    }
  } else {
    revealedNonMines = revealed.filter(Boolean).length;
  }

  const isCompleted = !isDetonated && revealedNonMines >= totalNonMines;
  const remainingMines = Math.max(0, totalMines - flags.size);

  // Play background music
  React.useEffect(() => {
    bgm.play('puzzle');
    return () => {
      bgm.stop();
    };
  }, []);

  // Handle cell reveal (Left-Click or Tap in dig mode)
  const handleReveal = React.useCallback(
    (row: number, col: number) => {
      unlockAudioSession();
      if (isDetonated || isCompleted) return;
      const idx = row * cols + col;
      if (flags.has(idx) || revealed[idx]) return;

      if (solution) {
        const res = revealCell(solution, revealed, row, col);
        setLocalRevealed(res.revealed);
        if (res.detonated) {
          setLocalDetonated(true);
          sfx.bomb();
          onCommit(`${row},${col}`, 'detonated');
        } else {
          sfx.pop();
          if (res.countRevealed > 1) sfx.turn();
          // Send all newly revealed cell indices
          const newIndices: number[] = [];
          for (let i = 0; i < totalCells; i++) {
            if (res.revealed[i] && !revealed[i]) newIndices.push(i);
          }
          if (newIndices.length > 0) {
            onCommit(`${row},${col}`, newIndices.join(';'));
          }
        }
      } else {
        sfx.pop();
        onCommit(`${row},${col}`, 1);
      }
    },
    [cols, flags, isCompleted, isDetonated, onCommit, revealed, solution, totalCells],
  );

  // Handle cell flag (Right-Click, Long-Press, or Tap in flag mode)
  const handleToggleFlag = React.useCallback(
    (row: number, col: number, e?: React.SyntheticEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      unlockAudioSession();
      if (isDetonated || isCompleted) return;
      const idx = row * cols + col;
      if (revealed[idx]) return;

      setFlags((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) {
          next.delete(idx);
          sfx.chip();
        } else {
          next.add(idx);
          sfx.flag();
        }
        return next;
      });
    },
    [cols, isCompleted, isDetonated, revealed],
  );

  // Mobile Touch Long-Press Timer
  const longPressTimerRef = React.useRef<number | undefined>(undefined);
  const isLongPressRef = React.useRef(false);
  const touchStartPosRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const startLongPress = React.useCallback(
    (row: number, col: number, e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      isLongPressRef.current = false;
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = window.setTimeout(() => {
        isLongPressRef.current = true;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(40);
        }
        handleToggleFlag(row, col);
      }, 300);
    },
    [handleToggleFlag],
  );

  const cancelLongPress = React.useCallback(() => {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
  }, []);

  const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
      if (dx > 8 || dy > 8) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = undefined;
      }
    }
  }, []);

  // Handle chord click on revealed numbers
  const handleChord = React.useCallback(
    (row: number, col: number) => {
      unlockAudioSession();
      if (isDetonated || isCompleted || !solution) return;
      const idx = row * cols + col;
      if (!revealed[idx]) return;

      const num = solution.grid[idx];
      if (num === undefined || num <= 0 || num === MINE) return;

      // Count surrounding flags
      const neighbors = getNeighbors(row, col, rows, cols);
      let flagCount = 0;
      for (const n of neighbors) {
        if (flags.has(n.r * cols + n.c)) flagCount++;
      }

      if (flagCount === num) {
        // Reveal all unflagged unrevealed neighbors
        let currentRevealed = [...revealed];
        let anyDetonated = false;
        let detonatedPos = { r: row, c: col };
        const newIndices: number[] = [];

        for (const n of neighbors) {
          const nIdx = n.r * cols + n.c;
          if (!flags.has(nIdx) && !currentRevealed[nIdx]) {
            const res = revealCell(solution, currentRevealed, n.r, n.c);
            currentRevealed = res.revealed;
            if (res.detonated) {
              anyDetonated = true;
              detonatedPos = n;
            }
          }
        }

        setLocalRevealed(currentRevealed);
        if (anyDetonated) {
          setLocalDetonated(true);
          sfx.bomb();
          onCommit(`${detonatedPos.r},${detonatedPos.c}`, 'detonated');
        } else {
          sfx.chord();
          for (let i = 0; i < totalCells; i++) {
            if (currentRevealed[i] && !revealed[i]) newIndices.push(i);
          }
          if (newIndices.length > 0) {
            onCommit(`${row},${col}`, newIndices.join(';'));
          }
        }
      } else {
        sfx.blip();
      }
    },
    [cols, flags, isCompleted, isDetonated, onCommit, revealed, rows, solution, totalCells],
  );

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full px-2 sm:px-4">
      {/* Header HUD with digital displays and retro smiley */}
      <PixelPanel className="p-3 bg-[#0d1117] border-2 border-pa-border shadow-[0_0_15px_rgba(34,224,255,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Mine Counter */}
          <div className="flex items-center gap-2 bg-[#05070d] px-3 py-1.5 rounded border border-pa-border/60">
            <Bomb size={18} className="text-pa-pink animate-pulse" />
            <div className="font-mono font-bold text-[18px] text-pa-pink tracking-widest">
              {String(remainingMines).padStart(3, '0')}
            </div>
          </div>

          {/* Smiley Status Face Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="w-10 h-10 rounded border-2 border-pa-border bg-pa-bg-alt hover:bg-pa-border/40 text-[22px] flex items-center justify-center shadow-inner transition-transform active:scale-95 cursor-pointer"
              title="Status"
            >
              {isCompleted ? '😎' : isDetonated ? '😵' : '🙂'}
            </button>
          </div>

          {/* Flag Mode Mobile Toggle & Timer */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                unlockAudioSession();
                setFlagMode((prev) => !prev);
                sfx.chip();
              }}
              className={cn(
                'px-3 py-2 rounded border-2 text-[12px] font-display flex items-center gap-2 transition-all cursor-pointer select-none',
                flagMode
                  ? 'bg-pa-pink text-pa-bg border-pa-pink shadow-[0_0_10px_rgba(255,63,142,0.6)] font-bold'
                  : 'bg-pa-cyan/20 text-pa-cyan border-pa-cyan hover:bg-pa-cyan/30 font-bold',
              )}
            >
              <Flag size={14} className={flagMode ? 'fill-pa-bg text-pa-bg' : 'text-pa-cyan'} />
              <span>{flagMode ? '🚩 FLAG MODE' : '⛏️ DIG MODE'}</span>
            </button>

            {turnEndsAt && (
              <div className="bg-[#05070d] px-3 py-1.5 rounded border border-pa-border/60">
                <Countdown endsAt={turnEndsAt} className="text-[16px] text-pa-amber font-mono font-bold" />
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-pa-border/40 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-pa-ink-dim font-mono bg-pa-surface px-2 py-1 border border-pa-border/70">
            Arrows/WASD · Space/Z (Dig) · F/X (Flag) · C (Chord)
          </span>
          <span className="text-[11px] text-pa-ink-dim font-mono">
            Right-click / Long-press flags · Middle-click chords
          </span>
        </div>
      </PixelPanel>

      {/* Grid Container — Horizontal scrollable on narrow screens, naturally scrollable vertically */}
      <div className="w-full overflow-x-auto p-2 sm:p-4 bg-[#090d16] border-2 border-pa-border rounded-lg flex justify-start sm:justify-center">
        <div
          role="grid"
          tabIndex={0}
          aria-label="Minesweeper field"
          onKeyDown={(e) => {
            const r = Math.floor(cursor / cols);
            const c = cursor % cols;
            const key = e.key;
            const keyLower = key.toLowerCase();

            if (key === 'ArrowUp' || keyLower === 'w') setCursor(((r + rows - 1) % rows) * cols + c);
            else if (key === 'ArrowDown' || keyLower === 's') setCursor(((r + 1) % rows) * cols + c);
            else if (key === 'ArrowLeft' || keyLower === 'a') setCursor(r * cols + ((c + cols - 1) % cols));
            else if (key === 'ArrowRight' || keyLower === 'd') setCursor(r * cols + ((c + 1) % cols));
            else if (key === ' ' || key === 'Enter' || keyLower === 'z') {
              if (flagMode) handleToggleFlag(r, c);
              else handleReveal(r, c);
            } else if (keyLower === 'f' || keyLower === 'x') {
              handleToggleFlag(r, c);
            } else if (keyLower === 'c') {
              handleChord(r, c);
            } else if (keyLower === 'm') {
              unlockAudioSession();
              setFlagMode((prev) => !prev);
              sfx.chip();
            } else return;
            e.preventDefault();
          }}
          className="grid gap-[2px] p-2 bg-[#05070f] border-2 border-[#1f293d] rounded select-none m-auto shrink-0 outline-none"
          style={{
            gridTemplateColumns: `repeat(${cols}, 32px)`,
            width: 'max-content',
            WebkitTouchCallout: 'none',
          }}
        >
          {Array.from({ length: totalCells }).map((_, idx) => {
            const r = Math.floor(idx / cols);
            const c = idx % cols;
            const isRev = revealed[idx];
            const isFlg = flags.has(idx);
            const isCursor = cursor === idx;
            const val = solution ? solution.grid[idx] : 0;
            const isMine = val === MINE;
            return (
              <button
                key={idx}
                type="button"
                role="gridcell"
                aria-label={`Row ${r + 1} column ${c + 1}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleToggleFlag(r, c, e);
                }}
                onTouchStart={(e) => startLongPress(r, c, e)}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                onClick={(e) => {
                  setCursor(idx);
                  if (isLongPressRef.current) {
                    isLongPressRef.current = false;
                    return;
                  }
                  if (flagMode) {
                    handleToggleFlag(r, c, e);
                  } else if (isRev) {
                    handleChord(r, c);
                  } else {
                    handleReveal(r, c);
                  }
                }}
                className={cn(
                  'w-8 h-8 min-w-[32px] min-h-[32px] sm:w-9 sm:h-9 sm:min-w-[36px] sm:min-h-[36px] aspect-square shrink-0 relative',
                  'text-[14px] sm:text-[16px] font-bold font-mono flex items-center justify-center transition-all cursor-pointer select-none touch-manipulation',
                  isCursor && 'ring-2 ring-pa-amber ring-inset z-10',
                  isRev
                    ? isMine
                      ? 'bg-red-950 border border-red-500 text-pa-pink shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-bounce'
                      : 'bg-[#121826] border border-[#1f293d]/50 shadow-inner'
                    : isFlg
                      ? 'bg-pa-bg-alt border-2 border-t-pa-pink/80 border-l-pa-pink/80 border-b-pa-pink/30 border-r-pa-pink/30 shadow'
                      : 'bg-[#1b2333] hover:bg-[#253047] border-2 border-t-[#3b4b6b] border-l-[#3b4b6b] border-b-[#0b101b] border-r-[#0b101b] active:border-[#121826]',
                )}
              >
                {isRev ? (
                  isMine ? (
                    <Bomb size={18} className="text-red-400 animate-bounce" />
                  ) : val && val > 0 ? (
                    <span className={cn('drop-shadow-[0_0_4px_currentColor]', NUMBER_COLORS[val])}>
                      {val}
                    </span>
                  ) : (
                    ''
                  )
                ) : isFlg ? (
                  <Flag size={16} className="text-pa-pink fill-pa-pink animate-pulse" />
                ) : (
                  ''
                )}
              </button>
            );
          })}
        </div>
      </div>
      {isCompleted && (
        <div className="p-3 bg-emerald-950/80 border-2 border-emerald-400 text-emerald-200 rounded flex items-center justify-center gap-2 font-display text-[14px] shadow-[0_0_20px_rgba(74,222,128,0.3)] animate-pulse">
          <Trophy size={18} className="text-pa-amber" />
          <span>MINEFIELD CLEARED! PERFECT RUN!</span>
        </div>
      )}

      {isDetonated && (
        <div className="p-3 bg-red-950/80 border-2 border-red-500 text-red-200 rounded flex items-center justify-center gap-2 font-display text-[14px] shadow-[0_0_20px_rgba(239,68,68,0.3)]">
          <Bomb size={18} className="text-pa-pink" />
          <span>DETONATION! A MINE EXPLODED!</span>
        </div>
      )}

      {/* Opponents Progress List */}
      {players.length > 1 && (
        <PixelPanel title="Competitors" className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {players.map((p) => {
              const isYou = p.id === youId;
              return (
                <div
                  key={p.id}
                  className={cn(
                    'p-2 rounded border flex items-center gap-2 bg-pa-bg-alt',
                    isYou ? 'border-pa-cyan bg-pa-cyan/10' : 'border-pa-border',
                  )}
                >
                  <SeatAvatar seat={p.seat} displayName={p.displayName} avatar={p.avatar} isBot={p.isBot} size={28} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-[11px] truncate">
                      {p.displayName} {isYou ? '(You)' : ''}
                    </span>
                    <span className="text-[10px] text-pa-muted">
                      {p.isBot ? 'Bot' : 'Player'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </PixelPanel>
      )}
    </div>
  );
}
