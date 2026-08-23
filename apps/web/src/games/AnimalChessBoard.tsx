import * as React from 'react';
import { motion } from 'framer-motion';
import { Trophy, Waves, ShieldAlert, Castle } from 'lucide-react';
import type {
  AnimalChessView,
  AnimalPiece,
  AnimalType,
} from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelCard, PixelPanel } from '../ui/primitives.js';
import { resolvePlayer } from '../ui/seat.js';
import { useReducedMotion } from '../ui/motion.js';
import { sfx } from '../ui/sound.js';
export interface AnimalChessBoardProps {
  view: AnimalChessView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}

const COLS = 7;
const ROWS = 9;
const DEN_0 = 3;
const DEN_1 = 59;
const TRAPS_0 = new Set([2, 4, 10]);
const TRAPS_1 = new Set([58, 60, 52]);
const WATER_SQUARES = new Set([
  22, 23, 29, 30, 36, 37,
  25, 26, 32, 33, 39, 40,
]);

const ANIMAL_INFO: Record<
  AnimalType,
  { rank: number; name: string; zh: string; emoji: string; color: string }
> = {
  elephant: { rank: 8, name: 'Elephant', zh: '象', emoji: '🐘', color: '#c084fc' },
  lion: { rank: 7, name: 'Lion', zh: '狮', emoji: '🦁', color: '#f59e0b' },
  tiger: { rank: 6, name: 'Tiger', zh: '虎', emoji: '🐯', color: '#f97316' },
  leopard: { rank: 5, name: 'Leopard', zh: '豹', emoji: '🐆', color: '#eab308' },
  wolf: { rank: 4, name: 'Wolf', zh: '狼', emoji: '🐺', color: '#94a3b8' },
  dog: { rank: 3, name: 'Dog', zh: '狗', emoji: '🐶', color: '#38bdf8' },
  cat: { rank: 2, name: 'Cat', zh: '猫', emoji: '🐱', color: '#4ade80' },
  rat: { rank: 1, name: 'Rat', zh: '鼠', emoji: '🐭', color: '#f43f5e' },
};

function rowOf(pt: number): number {
  return Math.floor(pt / COLS);
}
function colOf(pt: number): number {
  return pt % COLS;
}

export function AnimalChessBoard({
  view,
  players,
  youId,
  turnEndsAt,
  onAction,
}: AnimalChessBoardProps) {
  const reduced = useReducedMotion();
  const isMyTurn = view.current === youId;
  const mySide = view.you?.side ?? 0;
  const legalMoves = view.you?.legalMoves ?? [];
  const isGameOver = view.phase === 'game_over';

  // Flipped view: Side 0 (Blue) starts at top by default, so Side 1 (Red) flips
  // board so each player's own base is at the bottom of their screen.
  const flipped = mySide === 0;

  const [selectedPt, setSelectedPt] = React.useState<number | null>(null);

  // Clear selection whenever turn changes or move is accepted
  React.useEffect(() => {
    setSelectedPt(null);
  }, [view.lastMove, isMyTurn]);

  // Audio on move
  const seenMoveRef = React.useRef<AnimalChessView['lastMove']>(null);
  React.useEffect(() => {
    const lm = view.lastMove;
    if (!lm || lm === seenMoveRef.current) return;
    seenMoveRef.current = lm;

    if (lm.captured) {
      sfx.tembak();
    } else if (
      (lm.piece.type === 'lion' || lm.piece.type === 'tiger') &&
      Math.abs(rowOf(lm.from) - rowOf(lm.to)) > 1
    ) {
      sfx.crown(); // River jump
    } else {
      sfx.drop();
    }
  }, [view.lastMove]);

  // Destination squares available for the currently selected piece
  const destinationsForSelected = React.useMemo(() => {
    if (selectedPt === null) return [];
    return legalMoves.filter((m) => m.from === selectedPt).map((m) => m.to);
  }, [selectedPt, legalMoves]);

  const p0 = resolvePlayer(players, view.players[0]?.id ?? 0, 'Blue (Side 0)');
  const p1 = resolvePlayer(players, view.players[1]?.id ?? 1, 'Red (Side 1)');
  const mePlayer = mySide === 0 ? p0 : p1;
  const oppPlayer = mySide === 0 ? p1 : p0;

  const handleSquareClick = (pt: number) => {
    if (!isMyTurn || isGameOver) return;

    const piece = view.board[pt];

    // If clicking on an existing destination for the selected piece -> execute move
    if (selectedPt !== null && destinationsForSelected.includes(pt)) {
      onAction({ type: 'move', from: selectedPt, to: pt });
      setSelectedPt(null);
      return;
    }

    // If clicking on own piece with available legal moves -> select it
    if (piece && piece.side === mySide) {
      const hasMoves = legalMoves.some((m) => m.from === pt);
      if (hasMoves) {
        setSelectedPt(pt === selectedPt ? null : pt);
        return;
      }
    }

    // Otherwise deselect
    setSelectedPt(null);
  };

  // Captured pieces counts
  const capturedPieces = React.useMemo(() => {
    const allAnimals: AnimalType[] = [
      'elephant',
      'lion',
      'tiger',
      'leopard',
      'wolf',
      'dog',
      'cat',
      'rat',
    ];
    const blueAlive = new Set(
      view.board.filter((p): p is AnimalPiece => p !== null && p.side === 0).map((p) => p.type),
    );
    const redAlive = new Set(
      view.board.filter((p): p is AnimalPiece => p !== null && p.side === 1).map((p) => p.type),
    );

    return {
      blueLost: allAnimals.filter((t) => !blueAlive.has(t)),
      redLost: allAnimals.filter((t) => !redAlive.has(t)),
    };
  }, [view.board]);

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-4xl mx-auto select-none">
      {/* Top Banner: Opponent Info */}
      <div className="w-full flex items-center justify-between px-4 py-2 bg-pa-surface border-2 border-pa-border shadow-pixel">
        <div className="flex items-center gap-3">
          <SeatAvatar
            seat={oppPlayer.seat}
            displayName={oppPlayer.displayName}
            avatar={oppPlayer.avatar}
            isBot={oppPlayer.isBot}
            size={36}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-pa-ink text-[14px]">
                {oppPlayer.displayName}
              </span>
              <PixelBadge tone={mySide === 0 ? 'danger' : 'cyan'}>
                {mySide === 0 ? 'Red (Side 1)' : 'Blue (Side 0)'}
              </PixelBadge>
            </div>
            <span className="text-[11px] text-pa-ink-dim">
              {8 - (mySide === 0 ? capturedPieces.redLost.length : capturedPieces.blueLost.length)} animals remaining
            </span>
          </div>
        </div>

        {/* Captured by me */}
        <div className="flex items-center gap-1">
          {(mySide === 0 ? capturedPieces.redLost : capturedPieces.blueLost).map((type) => (
            <span
              key={type}
              title={`${ANIMAL_INFO[type].name} (Rank ${ANIMAL_INFO[type].rank})`}
              className="text-[16px] opacity-75 grayscale hover:grayscale-0 transition-all cursor-help"
            >
              {ANIMAL_INFO[type].emoji}
            </span>
          ))}
        </div>
      </div>

      {/* Main Game Area: Board + Sidebar */}
      <div className="flex flex-col lg:flex-row items-center lg:items-start gap-6 w-full justify-center">
        {/* 7x9 Animal Chess Board */}
        <div
          className="relative bg-[#161a29] p-3 rounded-lg border-4 border-pa-border shadow-2xl"
          style={{ width: 'min(92vw, 460px)', aspectRatio: '7 / 9' }}
        >
          <div className="grid grid-cols-7 grid-rows-9 w-full h-full gap-[3px] bg-[#0d111d] p-1 rounded">
            {Array.from({ length: ROWS }, (_, rawR) => {
              const r = flipped ? ROWS - 1 - rawR : rawR;
              return Array.from({ length: COLS }, (_, rawC) => {
                const c = flipped ? COLS - 1 - rawC : rawC;
                const pt = r * COLS + c;
                const piece = view.board[pt];

                const isWaterSq = WATER_SQUARES.has(pt);
                const isDen0 = pt === DEN_0;
                const isDen1 = pt === DEN_1;
                const isTrap0 = TRAPS_0.has(pt);
                const isTrap1 = TRAPS_1.has(pt);

                const isSelected = selectedPt === pt;
                const isDest = destinationsForSelected.includes(pt);
                const isLastMoveFrom = view.lastMove?.from === pt;
                const isLastMoveTo = view.lastMove?.to === pt;

                return (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => handleSquareClick(pt)}
                    className={cn(
                      'relative flex flex-col items-center justify-center rounded transition-all outline-none font-pixel',
                      // Terrain backgrounds
                      isWaterSq
                        ? 'bg-gradient-to-b from-[#0e3b5e] to-[#0a2540] border border-[#1e5a8a] text-blue-300 shadow-inner'
                        : isDen0 || isDen1
                          ? 'bg-gradient-to-b from-[#4a2828] to-[#2e1515] border-2 border-[#f59e0b]'
                          : isTrap0 || isTrap1
                            ? 'bg-[#261f2d] border border-dashed border-[#a855f7]'
                            : 'bg-[#1b2238] border border-[#273252] hover:bg-[#222b47]',
                      // Selection / Legal destination states
                      isSelected && 'ring-4 ring-yellow-400 z-20 scale-105 bg-[#2d3a60]',
                      isDest && 'ring-2 ring-emerald-400 bg-[#1e4038] cursor-pointer z-10',
                      (isLastMoveFrom || isLastMoveTo) && 'bg-[#312e52]',
                    )}
                  >
                    {/* Terrain Icons & Labels */}
                    {isWaterSq && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-25 pointer-events-none">
                        <Waves size={18} className="text-cyan-300 animate-pulse" />
                      </div>
                    )}
                    {isDen0 && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center opacity-60 pointer-events-none">
                        <Castle size={16} className="text-blue-400" />
                        <span className="text-[8px] font-bold text-blue-300 uppercase tracking-tighter">
                          Blue Den
                        </span>
                      </div>
                    )}
                    {isDen1 && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center opacity-60 pointer-events-none">
                        <Castle size={16} className="text-red-400" />
                        <span className="text-[8px] font-bold text-red-300 uppercase tracking-tighter">
                          Red Den
                        </span>
                      </div>
                    )}
                    {(isTrap0 || isTrap1) && !piece && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center opacity-50 pointer-events-none">
                        <ShieldAlert size={14} className="text-purple-400" />
                        <span className="text-[7px] text-purple-300">TRAP</span>
                      </div>
                    )}

                    {/* Target Move Dot */}
                    {isDest && (
                      <div className="absolute z-30 flex items-center justify-center pointer-events-none">
                        <div
                          className={cn(
                            'rounded-full animate-ping',
                            piece ? 'w-6 h-6 border-2 border-red-400 bg-red-500/40' : 'w-4 h-4 bg-emerald-400 shadow-lg',
                          )}
                        />
                      </div>
                    )}

                    {/* Animal Piece Component */}
                    {piece && (
                      <motion.div
                        layout={!reduced}
                        initial={false}
                        className={cn(
                          'relative z-20 w-[90%] h-[90%] rounded-md flex flex-col items-center justify-between p-[2px] shadow-md border-2 transition-transform cursor-pointer',
                          piece.side === 0
                            ? 'bg-gradient-to-b from-[#1e3a8a] to-[#172554] border-[#60a5fa] text-blue-100'
                            : 'bg-gradient-to-b from-[#7f1d1d] to-[#450a0a] border-[#f87171] text-red-100',
                          isSelected && 'scale-110 shadow-xl border-yellow-300',
                          isMyTurn && piece.side === mySide && 'hover:scale-105',
                        )}
                      >
                        {/* Header: Rank + Chinese Character */}
                        <div className="w-full flex items-center justify-between px-[2px] text-[10px] font-extrabold leading-none">
                          <span
                            className={cn(
                              'px-[3px] py-[1px] rounded text-[9px] font-black',
                              piece.side === 0 ? 'bg-blue-500 text-white' : 'bg-red-500 text-white',
                            )}
                          >
                            {ANIMAL_INFO[piece.type].rank}
                          </span>
                          <span className="text-[11px] font-black tracking-tight drop-shadow">
                            {ANIMAL_INFO[piece.type].zh}
                          </span>
                        </div>

                        {/* Center: Emoji */}
                        <span className="text-[18px] sm:text-[22px] leading-none drop-shadow-md">
                          {ANIMAL_INFO[piece.type].emoji}
                        </span>

                        {/* Footer: English Name */}
                        <span className="text-[8px] font-bold uppercase tracking-tighter opacity-90 truncate max-w-full">
                          {ANIMAL_INFO[piece.type].name}
                        </span>
                      </motion.div>
                    )}
                  </button>
                );
              });
            })}
          </div>
        </div>

        {/* Sidebar: Controls, Turn Status, Animal Hierarchy */}
        <div className="flex flex-col gap-3 w-full lg:w-72">
          {/* Turn Countdown & Status */}
          <PixelCard className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-pa-ink text-[13px]">Turn Status</span>
              {turnEndsAt && !isGameOver && (
                <Countdown endsAt={turnEndsAt} className="text-[12px] font-bold text-pa-pink" />
              )}
            </div>

            {isGameOver ? (
              <div className="flex items-center gap-2 text-yellow-400 font-bold py-1">
                <Trophy size={18} />
                <span>
                  {view.winner ? `${view.winner} won!` : 'Match drawn!'}
                </span>
              </div>
            ) : isMyTurn ? (
              <div className="p-2 bg-emerald-950/40 border border-emerald-500/40 rounded text-emerald-300 font-bold text-[13px] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Your turn — pick an animal!
              </div>
            ) : (
              <div className="p-2 bg-pa-surface border border-pa-border rounded text-pa-ink-dim text-[12px]">
                Waiting for {oppPlayer.displayName}...
              </div>
            )}
          </PixelCard>

          {/* Quick Rank Hierarchy Reference Guide */}
          <PixelPanel title="Animal Hierarchy (Ranks)" className="text-[11px]">
            <div className="grid grid-cols-2 gap-1 py-1">
              {Object.entries(ANIMAL_INFO)
                .sort((a, b) => b[1].rank - a[1].rank)
                .map(([type, info]) => (
                  <div
                    key={type}
                    className="flex items-center justify-between px-2 py-1 bg-pa-surface/70 rounded border border-pa-border/50"
                  >
                    <span className="flex items-center gap-1 font-semibold text-pa-ink">
                      <span>{info.emoji}</span>
                      <span>{info.name}</span>
                    </span>
                    <span className="font-bold text-pa-pink text-[10px]">
                      Lv.{info.rank}
                    </span>
                  </div>
                ))}
            </div>
            <p className="mt-2 text-[10px] text-pa-ink-dim leading-relaxed border-t border-pa-border/40 pt-1">
              • <strong className="text-pa-ink">Rat (1)</strong> swims in river & captures Elephant (8) on land.<br />
              • <strong className="text-pa-ink">Lion (7) / Tiger (6)</strong> can leap across rivers.<br />
              • <strong className="text-pa-ink">Traps</strong> drop enemy rank to 0.<br />
              • <strong className="text-pa-ink">Dens</strong>: enter enemy den to win immediately!
            </p>
          </PixelPanel>
        </div>
      </div>

      {/* Bottom Banner: Your Info */}
      <div className="w-full flex items-center justify-between px-4 py-2 bg-pa-surface border-2 border-pa-border shadow-pixel">
        <div className="flex items-center gap-3">
          <SeatAvatar
            seat={mePlayer.seat}
            displayName={mePlayer.displayName}
            avatar={mePlayer.avatar}
            isBot={mePlayer.isBot}
            size={36}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-pa-ink text-[14px]">
                {mePlayer.displayName} (You)
              </span>
              <PixelBadge tone={mySide === 0 ? 'cyan' : 'danger'}>
                {mySide === 0 ? 'Blue (Side 0)' : 'Red (Side 1)'}
              </PixelBadge>
            </div>
            <span className="text-[11px] text-pa-ink-dim">
              {8 - (mySide === 0 ? capturedPieces.blueLost.length : capturedPieces.redLost.length)} animals remaining
            </span>
          </div>
        </div>

        {/* Captured by Opponent */}
        <div className="flex items-center gap-1">
          {(mySide === 0 ? capturedPieces.blueLost : capturedPieces.redLost).map((type) => (
            <span
              key={type}
              title={`${ANIMAL_INFO[type].name} (Rank ${ANIMAL_INFO[type].rank})`}
              className="text-[16px] opacity-75 grayscale hover:grayscale-0 transition-all cursor-help"
            >
              {ANIMAL_INFO[type].emoji}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
