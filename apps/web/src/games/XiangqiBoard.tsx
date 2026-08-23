import * as React from 'react';
import { Trophy } from 'lucide-react';
import type { XiangqiLegalMove, XiangqiPiece, XiangqiPieceType, XiangqiView } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { PixelBadge, PixelButton, PixelCard } from '../ui/primitives.js';
import { SeatAvatar } from '../ui/game-bits.js';
import { resolvePlayer } from '../ui/seat.js';
import { sfx, unlockAudioSession } from '../ui/sound.js';
import { useRoom } from '../net/socket.js';
import { ActionRow, CapturedTray, ClockChip, MoveListPanel, StillThinkingModal } from './chess-shared.js';

interface XiangqiBoardProps {
  view: XiangqiView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}

const RED_GLYPHS: Record<XiangqiPieceType, string> = {
  general: '帥',
  advisor: '仕',
  elephant: '相',
  horse: '傌',
  chariot: '俥',
  cannon: '炮',
  soldier: '兵',
};
const BLACK_GLYPHS: Record<XiangqiPieceType, string> = {
  general: '將',
  advisor: '士',
  elephant: '象',
  horse: '馬',
  chariot: '車',
  cannon: '砲',
  soldier: '卒',
};

function glyphFor(piece: XiangqiPiece): string {
  return piece.side === 0 ? RED_GLYPHS[piece.type] : BLACK_GLYPHS[piece.type];
}

function capturedGlyph(type: string): string {
  return RED_GLYPHS[type as XiangqiPieceType] ?? '?';
}

function rowOf(square: number): number {
  return Math.floor(square / 9);
}
function colOf(square: number): number {
  return square % 9;
}
function pointOf(row: number, col: number): number {
  return row * 9 + col;
}

/** Board row/col already places Red's back rank (row 9) at the bottom, so an
 *  unflipped view needs no transform; a flipped (Black) view rotates 180°. */
function visualRowCol(row: number, col: number, flipped: boolean): { vr: number; vc: number } {
  if (!flipped) return { vr: row, vc: col };
  return { vr: 9 - row, vc: 8 - col };
}

const WIN_REASON_TEXT: Record<string, string> = {
  checkmate: 'Checkmate',
  resign: 'by resignation',
  time: 'on time',
  idle: 'by idle forfeit',
  flag: 'on time',
  stalemate: 'no legal moves for the opponent',
  perpetual_check: 'by perpetual check',
};

const DRAW_REASON_TEXT: Record<string, string> = {
  agreement: 'Draw by agreement',
  perpetual_mutual_check: 'Draw — mutual perpetual check',
  sixty_move: 'Draw — 60 moves with no capture',
  threefold: 'Draw by threefold repetition',
};

/** Grid-line helper: point (row,col) sits at the centre of its cell, so the
 *  SVG coordinates match the piece-layer's `(n + 0.5) / count * 100%` rule. */
const lx = (col: number) => col + 0.5;
const ly = (row: number) => row + 0.5;

export default function XiangqiBoard({ view, players, youId, legalActions, onAction }: XiangqiBoardProps) {
  const clocks = useRoom((s) => s.clocks);
  const clockActor = useRoom((s) => s.clockActor);
  const clockRunningSince = useRoom((s) => s.clockRunningSince);

  const isMyTurn = view.current === youId;
  const mySide = view.you?.side ?? 0;
  const legalMoves = view.you?.legalMoves ?? [];
  const isGameOver = view.phase === 'game_over';
  const flipped = mySide === 1;

  const [selected, setSelected] = React.useState<number | null>(null);

  React.useEffect(() => {
    setSelected(null);
  }, [view.history.length]);

  const seenMoveRef = React.useRef(view.history.length);
  React.useEffect(() => {
    if (view.history.length === seenMoveRef.current) return;
    seenMoveRef.current = view.history.length;
    const last = view.history.at(-1);
    if (!last) return;
    if (last.captured) sfx.tembak();
    else sfx.drop();
    if (isGameOver) sfx.victory();
  }, [view.history.length, isGameOver]);

  const legalFrom = React.useMemo(() => {
    const set = new Set<number>();
    for (const m of legalMoves) set.add(m.from);
    return set;
  }, [legalMoves]);

  const candidatesFromSelected = React.useMemo(() => {
    if (selected === null) return [];
    return legalMoves.filter((m) => m.from === selected);
  }, [legalMoves, selected]);

  const destOptions = React.useMemo(() => {
    const set = new Set<number>();
    for (const m of candidatesFromSelected) set.add(m.to);
    return set;
  }, [candidatesFromSelected]);

  const players0 = resolvePlayer(players, view.players[0]?.id ?? 0, 'Red');
  const players1 = resolvePlayer(players, view.players[1]?.id ?? 1, 'Black');
  const mePlayer = mySide === 0 ? players0 : players1;
  const oppPlayer = mySide === 0 ? players1 : players0;
  const meId = view.players[mySide]?.id ?? null;
  const oppId = view.players[1 - mySide]?.id ?? null;

  const meClock = clocks?.find((c) => c.playerId === meId) ?? null;
  const oppClock = clocks?.find((c) => c.playerId === oppId) ?? null;

  const lastMove = view.history.at(-1);

  const commitMove = (from: number, to: number) => {
    unlockAudioSession();
    onAction({ type: 'move', from, to });
    setSelected(null);
  };

  const handleTap = (square: number): void => {
    if (!isMyTurn || isGameOver) return;

    if (selected === null) {
      if (!legalFrom.has(square)) return;
      unlockAudioSession();
      sfx.blip();
      setSelected(square);
      return;
    }

    if (selected === square) {
      setSelected(null);
      return;
    }

    const match = candidatesFromSelected.find((m: XiangqiLegalMove) => m.to === square);
    if (match) {
      commitMove(match.from, match.to);
      return;
    }

    if (legalFrom.has(square)) {
      sfx.blip();
      setSelected(square);
    } else {
      setSelected(null);
    }
  };

  const currentActor = resolvePlayer(players, view.current, 'Opponent');
  const winnerPlayer = view.winner ? resolvePlayer(players, view.winner, 'Winner') : null;
  const isDraw = isGameOver && view.winner === null;

  const bannerText = isGameOver
    ? isDraw
      ? (view.drawReason && DRAW_REASON_TEXT[view.drawReason]) || 'Draw'
      : `${winnerPlayer?.displayName ?? 'Winner'} wins${view.winReason ? ` — ${WIN_REASON_TEXT[view.winReason] ?? view.winReason}` : ''}`
    : isMyTurn
      ? view.you?.inCheck
        ? 'YOU ARE IN CHECK — YOUR TURN'
        : 'YOUR TURN'
      : `WAITING FOR ${currentActor.displayName}…`;

  const points = React.useMemo(() => {
    const list: { square: number; row: number; col: number }[] = [];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 9; col++) list.push({ square: pointOf(row, col), row, col });
    }
    return list;
  }, []);

  const vGrid: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const hGrid: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full lg:flex-row lg:items-start">
      <div className="flex flex-col gap-4 w-full lg:max-w-[520px] mx-auto">
        <PixelCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            {isGameOver && <Trophy size={18} className="text-pa-amber" />}
            <span className={cn('font-display text-[12px]', isGameOver ? 'text-pa-amber' : view.you?.inCheck ? 'text-pa-danger' : 'text-pa-cyan')}>
              {bannerText}
            </span>
          </div>
        </PixelCard>

        <div className="flex items-center justify-between px-1">
          <PlayerRow player={oppPlayer} label="Opponent">
            <ClockChip
              remainingMs={oppClock?.remainingMs}
              isRunning={clockActor === oppId}
              runningSince={clockRunningSince}
              label={mySide === 0 ? 'Black' : 'Red'}
            />
          </PlayerRow>
          <PlayerRow player={mePlayer} label="You" align="right">
            <ClockChip
              remainingMs={meClock?.remainingMs}
              isRunning={clockActor === meId}
              runningSince={clockRunningSince}
              label={mySide === 0 ? 'Red' : 'Black'}
            />
          </PlayerRow>
        </div>

        <div className="relative mx-auto w-full max-w-[min(94vw,520px)] aspect-[9/10] bg-[#e8d8b8]">
          <svg viewBox="0 0 9 10" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            {hGrid.map((row) => (
              <line key={`h${row}`} x1={lx(0)} y1={ly(row)} x2={lx(8)} y2={ly(row)} stroke="#5a4a30" strokeWidth={0.03} />
            ))}
            {vGrid.map((col) => {
              if (col === 0 || col === 8) {
                return <line key={`v${col}`} x1={lx(col)} y1={ly(0)} x2={lx(col)} y2={ly(9)} stroke="#5a4a30" strokeWidth={0.03} />;
              }
              return (
                <React.Fragment key={`v${col}`}>
                  <line x1={lx(col)} y1={ly(0)} x2={lx(col)} y2={ly(4)} stroke="#5a4a30" strokeWidth={0.03} />
                  <line x1={lx(col)} y1={ly(5)} x2={lx(col)} y2={ly(9)} stroke="#5a4a30" strokeWidth={0.03} />
                </React.Fragment>
              );
            })}
            {/* Palace diagonals */}
            <line x1={lx(3)} y1={ly(0)} x2={lx(5)} y2={ly(2)} stroke="#5a4a30" strokeWidth={0.03} />
            <line x1={lx(5)} y1={ly(0)} x2={lx(3)} y2={ly(2)} stroke="#5a4a30" strokeWidth={0.03} />
            <line x1={lx(3)} y1={ly(7)} x2={lx(5)} y2={ly(9)} stroke="#5a4a30" strokeWidth={0.03} />
            <line x1={lx(5)} y1={ly(7)} x2={lx(3)} y2={ly(9)} stroke="#5a4a30" strokeWidth={0.03} />
            {/* River */}
            <text x={lx(1.6)} y={ly(4.5)} fontSize={0.4} textAnchor="middle" dominantBaseline="middle" fill="#5a4a30" className="font-cjk">
              楚河
            </text>
            <text x={lx(6.4)} y={ly(4.5)} fontSize={0.4} textAnchor="middle" dominantBaseline="middle" fill="#5a4a30" className="font-cjk">
              漢界
            </text>
          </svg>

          {points.map(({ square, row, col }) => {
            const { vr, vc } = visualRowCol(row, col, flipped);
            const piece = view.board[square] ?? null;
            const isSelected = selected === square;
            const isDest = destOptions.has(square);
            const isStartable = selected === null && isMyTurn && legalFrom.has(square);
            const isLastFrom = lastMove && lastMove.from === square;
            const isLastTo = lastMove && lastMove.to === square;
            const isGeneralInCheck = view.you?.inCheck && piece?.type === 'general' && piece.side === mySide;

            return (
              <button
                key={square}
                type="button"
                onClick={() => handleTap(square)}
                aria-label={`Point ${row},${col}`}
                className="absolute flex items-center justify-center cursor-pointer"
                style={{
                  left: `${((vc + 0.5) / 9) * 100}%`,
                  top: `${((vr + 0.5) / 10) * 100}%`,
                  width: '10%',
                  height: '9%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {isStartable && !piece && <span className="w-2 h-2 rounded-full bg-pa-cyan/60" />}
                {isDest && !piece && <span className="w-3 h-3 rounded-full bg-pa-amber animate-pulse" />}
                {piece && (
                  <span
                    className={cn(
                      'w-[82%] h-[82%] rounded-full border-2 flex items-center justify-center shadow-md font-cjk select-none',
                      isSelected && 'ring-4 ring-pa-cyan',
                      (isLastFrom || isLastTo) && 'ring-2 ring-pa-lime',
                      isGeneralInCheck && 'ring-2 ring-pa-danger',
                    )}
                    style={{
                      backgroundColor: piece.side === 0 ? '#fbe4d8' : '#dfe3ee',
                      borderColor: piece.side === 0 ? '#c23b2c' : '#1c1f2b',
                      color: piece.side === 0 ? '#c23b2c' : '#1c1f2b',
                      fontSize: 'min(6vw, 26px)',
                    }}
                  >
                    {glyphFor(piece)}
                  </span>
                )}
                {isDest && piece && (
                  <span className="absolute inset-0 rounded-full ring-2 ring-pa-amber pointer-events-none" />
                )}
              </button>
            );
          })}
        </div>

        {selected !== null && (
          <div className="flex justify-center">
            <PixelButton variant="ghost" size="sm" onClick={() => setSelected(null)}>
              Cancel selection
            </PixelButton>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 w-full lg:w-72 shrink-0">
        <MoveListPanel
          history={view.history}
          whiteLabel={players0?.displayName ?? 'Red'}
          blackLabel={players1?.displayName ?? 'Black'}
        />
        <PixelCard className="p-3">
          <p className="text-[10px] uppercase text-pa-ink-dim mb-2">Captured</p>
          <CapturedTray history={view.history} pieceGlyph={capturedGlyph} />
        </PixelCard>
        <PixelCard className="p-3">
          <ActionRow
            legalActions={legalActions}
            drawOfferBy={view.drawOffer}
            takebackOfferBy={view.takebackOffer}
            youId={youId}
            opponentName={oppPlayer?.displayName ?? 'Opponent'}
            onAction={onAction}
          />
        </PixelCard>
      </div>

      <StillThinkingModal youId={youId} historyLength={view.history.length} />
    </div>
  );
}

function PlayerRow({
  player,
  label,
  align = 'left',
  children,
}: {
  player: { seat: number; displayName: string; avatar: string | null; isBot: boolean } | undefined;
  label: string;
  align?: 'left' | 'right';
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-2', align === 'right' && 'flex-row-reverse text-right')}>
      <SeatAvatar
        seat={player?.seat ?? (label === 'Red' ? 0 : 1)}
        displayName={player?.displayName ?? label}
        avatar={player?.avatar}
        isBot={player?.isBot ?? false}
        size={28}
      />
      <div className="flex flex-col">
        <span className="text-[12px] truncate max-w-[120px]">{player?.displayName ?? label}</span>
        <PixelBadge>{label}</PixelBadge>
      </div>
      {children}
    </div>
  );
}
