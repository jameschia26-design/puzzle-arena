import React from 'react';
import type { Connect4Action, Connect4View } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { PixelCard } from '../ui/primitives.js';
import { Countdown } from '../ui/game-bits.js';
import { resolvePlayer } from '../ui/seat.js';
import { cn } from '../ui/cn.js';
import { bgm, sfx, unlockAudioSession } from '../ui/sound.js';
import { Trophy, ChevronDown } from 'lucide-react';

export interface Connect4BoardProps {
  view: unknown;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: Connect4Action) => void;
}

export function Connect4Board({
  view,
  players,
  youId,
  turnEndsAt,
  onAction,
}: Connect4BoardProps): React.ReactElement {
  const v = view as Connect4View | null;
  const [hoverCol, setHoverCol] = React.useState<number | null>(null);

  // Background music
  React.useEffect(() => {
    bgm.play('board');
    return () => {
      bgm.stop();
    };
  }, []);

  if (!v) {
    return (
      <div className="flex items-center justify-center p-12 text-pa-muted font-display text-[14px]">
        Loading Connect 4 arena...
      </div>
    );
  }

  const { board, turn, players: c4Players, lastMove, winningLine, winner, phase, legalCols } = v;
  const youIdx = c4Players.findIndex((p) => p.id === youId);
  const isMyTurn = phase === 'playing' && youIdx === turn;
  const isGameOver = phase === 'game_over';

  const p1 = c4Players[0];
  const p2 = c4Players[1];
  const p1View = resolvePlayer(players, p1?.id ?? 0, 'Player 1');
  const p2View = resolvePlayer(players, p2?.id ?? 1, 'Player 2');
  const winnerPlayer = winner !== null && winner !== undefined ? resolvePlayer(players, winner, 'Winner') : null;

  // Map of winning coordinates for instant lookup
  const winSet = new Set<string>();
  if (winningLine) {
    for (const pos of winningLine) {
      winSet.add(`${pos.row},${pos.col}`);
    }
  }

  const handleDrop = (col: number) => {
    unlockAudioSession();
    if (!isMyTurn || isGameOver || !legalCols.includes(col)) return;
    sfx.drop();
    onAction({ type: 'drop', col });
  };

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto w-full px-2 sm:px-4">
      {/* Players HUD */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {/* Player 1 Card (Red/Pink) */}
        <PixelCard
          className={cn(
            'p-3 sm:p-4 flex items-center justify-between border-2 transition-all',
            turn === 0 && !isGameOver
              ? 'border-pa-pink bg-pa-pink/10 shadow-[0_0_15px_rgba(255,63,142,0.25)]'
              : 'border-pa-border bg-pa-bg-alt',
          )}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-[#ff3f8e] border-2 border-white/80 shadow-[0_0_10px_rgba(255,63,142,0.8)] flex items-center justify-center shrink-0">
              <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-[#ff6b35]/60" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-display text-[12px] sm:text-[14px] truncate">
                {p1View.displayName}
              </span>
              <span className="text-[10px] sm:text-[11px] text-pa-pink font-bold">
                RED {youIdx === 0 ? '(You)' : ''}
              </span>
            </div>
          </div>
          {turn === 0 && !isGameOver && (
            <span className="text-[10px] sm:text-[11px] font-bold text-pa-pink animate-pulse bg-pa-pink/20 px-2 py-1 rounded">
              TURN
            </span>
          )}
        </PixelCard>

        {/* Player 2 Card (Yellow/Amber) */}
        <PixelCard
          className={cn(
            'p-3 sm:p-4 flex items-center justify-between border-2 transition-all',
            turn === 1 && !isGameOver
              ? 'border-pa-amber bg-pa-amber/10 shadow-[0_0_15px_rgba(255,176,32,0.25)]'
              : 'border-pa-border bg-pa-bg-alt',
          )}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-[#ffb020] border-2 border-white/80 shadow-[0_0_10px_rgba(255,176,32,0.8)] flex items-center justify-center shrink-0">
              <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-[#ffd060]/60" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-display text-[12px] sm:text-[14px] truncate">
                {p2View.displayName}
              </span>
              <span className="text-[10px] sm:text-[11px] text-pa-amber font-bold">
                YELLOW {youIdx === 1 ? '(You)' : ''}
              </span>
            </div>
          </div>
          {turn === 1 && !isGameOver && (
            <span className="text-[10px] sm:text-[11px] font-bold text-pa-amber animate-pulse bg-pa-amber/20 px-2 py-1 rounded">
              TURN
            </span>
          )}
        </PixelCard>
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-pa-bg-alt border-2 border-pa-border rounded-lg">
        <div className="flex items-center gap-2 font-display text-[12px] sm:text-[13px]">
          {isGameOver ? (
            <div className="flex items-center gap-2 text-pa-amber">
              <Trophy size={16} />
              <span>
                {winner
                  ? `${winner === youId ? 'YOU WON!' : 'CONNECT 4! WINNER DECIDED!'}`
                  : 'GAME DRAWN!'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-3 h-3 rounded-full animate-ping',
                  turn === 0 ? 'bg-pa-pink' : 'bg-pa-amber',
                )}
              />
              <span>
                {isMyTurn
                  ? 'YOUR TURN - CHOOSE A COLUMN TO DROP'
                  : `WAITING FOR ${turn === 0 ? 'RED' : 'YELLOW'}...`}
              </span>
            </div>
          )}
        </div>

        {turnEndsAt && !isGameOver && (
          <Countdown endsAt={turnEndsAt} className="text-pa-amber font-mono font-bold text-[14px]" />
        )}
      </div>

      {/* Connect 4 Cabinet & Grid Container */}
      <div className="flex flex-col items-center justify-center p-3 sm:p-6 bg-[#080d1a] border-4 border-[#1e3a8a] rounded-2xl shadow-[0_0_35px_rgba(30,58,138,0.4)] no-select touch-none" onContextMenu={(e) => e.preventDefault()}>
        {/* Column Drop Arrow Indicators */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5 mb-2 w-full max-w-[480px] sm:max-w-[560px]">
          {Array.from({ length: 7 }).map((_, c) => {
            const isLegal = legalCols.includes(c);
            const isHovered = hoverCol === c;
            return (
              <button
                key={c}
                type="button"
                disabled={!isLegal || !isMyTurn}
                onClick={() => handleDrop(c)}
                onMouseEnter={() => setHoverCol(c)}
                onMouseLeave={() => setHoverCol(null)}
                onContextMenu={(e) => e.preventDefault()}
                className={cn(
                  'h-8 sm:h-10 flex items-center justify-center rounded-lg transition-all no-select',
                  isLegal && isMyTurn
                    ? 'hover:bg-pa-cyan/20 cursor-pointer'
                    : 'opacity-0 cursor-default pointer-events-none',
                )}
              >
                {isLegal && isMyTurn && (
                  <ChevronDown
                    size={24}
                    className={cn(
                      'transition-transform',
                      isHovered ? 'translate-y-1 text-pa-pink' : 'text-pa-cyan',
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* 6 Rows x 7 Columns Vertical Blue Grid */}
        <div className="p-3 sm:p-4 bg-gradient-to-b from-[#1e40af] to-[#1e3a8a] border-4 border-[#3b82f6] rounded-xl shadow-2xl w-full max-w-[480px] sm:max-w-[560px]">
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5">
            {Array.from({ length: 42 }).map((_, idx) => {
              const r = Math.floor(idx / 7);
              const c = idx % 7;
              const val = board[idx];
              const isWin = winSet.has(`${r},${c}`);
              const isLast = lastMove && lastMove.row === r && lastMove.col === c;
              const isLegal = legalCols.includes(c);

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={!isLegal || !isMyTurn}
                  onClick={() => handleDrop(c)}
                  onMouseEnter={() => setHoverCol(c)}
                  onMouseLeave={() => setHoverCol(null)}
                  onContextMenu={(e) => e.preventDefault()}
                  className={cn(
                    'aspect-square rounded-full flex items-center justify-center bg-[#070b14] border-2 sm:border-3 border-[#172554] shadow-inner relative transition-all overflow-hidden no-select',
                    isLegal && isMyTurn && 'hover:border-pa-cyan/80 cursor-pointer',
                  )}
                >
                  {val !== null ? (
                    <div
                      className={cn(
                        'w-full h-full rounded-full flex items-center justify-center transition-all duration-300 transform',
                        val === 0
                          ? 'bg-gradient-to-br from-[#ff6b35] to-[#ff3f8e] shadow-[0_0_12px_rgba(255,63,142,0.8)] border border-white/40'
                          : 'bg-gradient-to-br from-[#ffd060] to-[#ffb020] shadow-[0_0_12px_rgba(255,176,32,0.8)] border border-white/40',
                        isWin && 'ring-4 ring-white animate-bounce shadow-[0_0_20px_#ffffff]',
                        isLast && 'ring-2 ring-pa-cyan',
                      )}
                    >
                      <div className="w-1/2 h-1/2 rounded-full bg-white/20 border border-white/30" />
                    </div>
                  ) : isLegal && isMyTurn && hoverCol === c ? (
                    /* Ghost Disc Preview */
                    <div
                      className={cn(
                        'w-3/4 h-3/4 rounded-full opacity-30 animate-pulse',
                        turn === 0 ? 'bg-pa-pink' : 'bg-pa-amber',
                      )}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
