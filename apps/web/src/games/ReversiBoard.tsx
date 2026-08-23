import React from 'react';
import { Trophy } from 'lucide-react';
import type { ReversiAction, ReversiView } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelCard } from '../ui/primitives.js';
import { resolvePlayer } from '../ui/seat.js';
import { bgm, sfx, unlockAudioSession } from '../ui/sound.js';
export interface ReversiBoardProps {
  view: unknown;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: ReversiAction) => void;
}

export function ReversiBoard({
  view,
  players,
  youId,
  legalActions,
  turnEndsAt,
  onAction,
}: ReversiBoardProps): React.ReactElement {
  const v = view as ReversiView | null;

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
        Loading Reversi arena...
      </div>
    );
  }

  const { board, turn, players: revPlayers, lastMove, winner, winReason, phase, legalMoves } = v;
  const youIdx = revPlayers.findIndex((p) => p.id === youId);
  const isMyTurn = phase === 'playing' && youIdx === turn;
  const isGameOver = phase === 'game_over';

  const darkPlayer = revPlayers[0];
  const lightPlayer = revPlayers[1];
  const darkViewPlayer = resolvePlayer(players, darkPlayer?.id ?? 0, 'Player 1');
  const lightViewPlayer = resolvePlayer(players, lightPlayer?.id ?? 1, 'Player 2');
  const winnerPlayer = winner !== null && winner !== undefined ? resolvePlayer(players, winner, 'Winner') : null;

  const canPass = isMyTurn && legalMoves.length === 0;

  // Set of legal move coordinates for quick lookup
  const legalMap = new Map<string, number>();
  if (isMyTurn) {
    for (const m of legalMoves) {
      legalMap.set(`${m.row},${m.col}`, m.flipsCount);
    }
  }

  const handleSquareClick = (row: number, col: number) => {
    unlockAudioSession();
    if (!isMyTurn || isGameOver) return;
    const key = `${row},${col}`;
    if (!legalMap.has(key)) return;

    sfx.chip();
    onAction({ type: 'place', row, col });
  };

  const handlePass = () => {
    unlockAudioSession();
    if (!canPass) return;
    sfx.turn();
    onAction({ type: 'pass' });
  };

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto w-full px-2 sm:px-4">
      {/* Top Players & Score HUD */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {/* Dark Player Card (Black) */}
        <PixelCard
          className={cn(
            'p-3 sm:p-4 flex items-center justify-between border-2 transition-all',
            turn === 0 && !isGameOver
              ? 'border-pa-pink bg-pa-pink/10 shadow-[0_0_15px_rgba(255,63,142,0.25)]'
              : 'border-pa-border bg-pa-bg-alt',
          )}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-[#151821] border-2 border-pa-pink shadow-[0_0_8px_rgba(255,63,142,0.6)] flex items-center justify-center shrink-0">
              <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-[#0a0c12] border border-pa-pink/60" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-display text-[12px] sm:text-[14px] truncate">
                {darkViewPlayer.displayName}
              </span>
              <span className="text-[10px] sm:text-[11px] text-pa-pink font-bold">
                DARK {youIdx === 0 ? '(You)' : ''}
              </span>
            </div>
          </div>
          <div className="font-mono text-[20px] sm:text-[26px] font-bold text-pa-pink px-2">
            {darkPlayer.discs}
          </div>
        </PixelCard>

        {/* Light Player Card (White) */}
        <PixelCard
          className={cn(
            'p-3 sm:p-4 flex items-center justify-between border-2 transition-all',
            turn === 1 && !isGameOver
              ? 'border-pa-cyan bg-pa-cyan/10 shadow-[0_0_15px_rgba(34,224,255,0.25)]'
              : 'border-pa-border bg-pa-bg-alt',
          )}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-[#e6f4fe] border-2 border-pa-cyan shadow-[0_0_8px_rgba(34,224,255,0.6)] flex items-center justify-center shrink-0">
              <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-[#f8fbff] border border-pa-cyan/60" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-display text-[12px] sm:text-[14px] truncate">
                {lightViewPlayer.displayName}
              </span>
              <span className="text-[10px] sm:text-[11px] text-pa-cyan font-bold">
                LIGHT {youIdx === 1 ? '(You)' : ''}
              </span>
            </div>
          </div>
          <div className="font-mono text-[20px] sm:text-[26px] font-bold text-pa-cyan px-2">
            {lightPlayer.discs}
          </div>
        </PixelCard>
      </div>

      {/* Turn & Status Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-pa-bg-alt border-2 border-pa-border rounded-lg">
        <div className="flex items-center gap-2 font-display text-[12px] sm:text-[13px]">
          {isGameOver ? (
            <div className="flex items-center gap-2 text-pa-amber">
              <Trophy size={16} />
              <span>
                {winner
                  ? `${winner === youId ? 'YOU WON!' : 'GAME OVER - WINNER DECIDED!'}`
                  : 'GAME DRAWN!'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-3 h-3 rounded-full animate-ping',
                  turn === 0 ? 'bg-pa-pink' : 'bg-pa-cyan',
                )}
              />
              <span>
                {isMyTurn
                  ? 'YOUR TURN - PLACE A DISC'
                  : `WAITING FOR ${turn === 0 ? 'DARK' : 'LIGHT'}...`}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canPass && (
            <PixelButton variant="primary" size="sm" onClick={handlePass}>
              PASS TURN
            </PixelButton>
          )}
          {turnEndsAt && !isGameOver && (
            <Countdown endsAt={turnEndsAt} className="text-pa-amber font-mono font-bold text-[14px]" />
          )}
        </div>
      </div>

      {/* Reversi 8x8 Board Container */}
      <div className="flex justify-center p-2 sm:p-4 bg-[#0a1410] border-2 border-[#1a382b] rounded-xl shadow-[0_0_25px_rgba(34,224,255,0.06)]">
        <div className="grid grid-cols-8 gap-1 sm:gap-1.5 p-2 sm:p-3 bg-[#0d2319] border-4 border-[#14422e] rounded-lg shadow-2xl">
          {Array.from({ length: 64 }).map((_, idx) => {
            const r = Math.floor(idx / 8);
            const c = idx % 8;
            const val = board[idx];
            const key = `${r},${c}`;
            const isLegal = legalMap.has(key);
            const flips = legalMap.get(key) ?? 0;
            const isLast = lastMove && lastMove.row === r && lastMove.col === c;

            return (
              <button
                key={idx}
                type="button"
                disabled={!isLegal || !isMyTurn}
                onClick={() => handleSquareClick(r, c)}
                className={cn(
                  'w-9 h-9 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded bg-[#103322] border border-[#194f35] flex items-center justify-center relative transition-all',
                  isLegal && isMyTurn
                    ? 'hover:bg-[#1a4d33] hover:border-pa-cyan cursor-pointer shadow-[0_0_8px_rgba(34,224,255,0.3)]'
                    : 'cursor-default',
                  isLast && 'ring-2 ring-pa-amber shadow-[0_0_12px_rgba(255,176,32,0.5)]',
                )}
              >
                {/* Placed Disc with 3D styling */}
                {val !== null ? (
                  <div
                    className={cn(
                      'w-7 h-7 sm:w-9 sm:h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-transform duration-300 transform shadow-md',
                      val === 0
                        ? 'bg-gradient-to-br from-[#242838] to-[#0b0d14] border-2 border-pa-pink/80 shadow-[0_0_8px_rgba(255,63,142,0.5)]'
                        : 'bg-gradient-to-br from-[#ffffff] to-[#c7e4ff] border-2 border-pa-cyan/80 shadow-[0_0_8px_rgba(34,224,255,0.5)]',
                    )}
                  >
                    <div
                      className={cn(
                        'w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full',
                        val === 0 ? 'bg-[#151824]' : 'bg-[#e2f0fc]',
                      )}
                    />
                  </div>
                ) : isLegal && isMyTurn ? (
                  /* Legal Move Hint Pip */
                  <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-pa-cyan/70 animate-pulse border border-pa-cyan flex items-center justify-center">
                    {flips > 2 && <span className="text-[8px] font-bold text-pa-bg">{flips}</span>}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
