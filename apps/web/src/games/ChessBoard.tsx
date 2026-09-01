import * as React from 'react';
import { Trophy } from 'lucide-react';
import type { ChessMove, ChessPiece, ChessView, ChessPieceType as PieceType } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { PixelBadge, PixelButton, PixelCard, PixelDialog } from '../ui/primitives.js';
import { SeatAvatar } from '../ui/game-bits.js';
import { resolvePlayer } from '../ui/seat.js';
import { sfx, unlockAudioSession } from '../ui/sound.js';
import { useRoom } from '../net/socket.js';
import { ActionRow, CapturedTray, ClockChip, MoveListPanel, StillThinkingModal } from './chess-shared.js';

interface ChessBoardProps {
  view: ChessView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}
export function ChessPieceSvg({
  type,
  side,
  className,
}: {
  type: PieceType;
  side: 0 | 1;
  className?: string;
}) {
  const isWhite = side === 0;
  const fill = isWhite ? '#f0f2f8' : '#141724';
  const stroke = isWhite ? '#ffffff' : '#9da7ce';
  const detail = isWhite ? '#242b45' : '#9da7ce';
  const sw = 1.5;

  return (
    <svg
      viewBox="0 0 45 45"
      className={cn('w-full h-full select-none', className)}
      style={{
        filter: isWhite
          ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))'
          : 'drop-shadow(0 2px 4px rgba(0,0,0,0.7))',
      }}
    >
      {type === 'p' && (
        <g>
          <path d="M 10 38 L 35 38 C 35 35 32 33 30 33 L 15 33 C 13 33 10 35 10 38 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M 16 33 C 16 27 19 22 20 18 L 25 18 C 26 22 29 27 29 33 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M 18 19 L 27 19" stroke={detail} strokeWidth={sw} />
          <circle cx="22.5" cy="13.5" r="5.5" fill={fill} stroke={stroke} strokeWidth={sw} />
        </g>
      )}
      {type === 'r' && (
        <g>
          <path d="M 9 38 L 36 38 L 33 33 L 12 33 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M 13 33 L 15 17 L 30 17 L 32 33 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path
            d="M 11 17 L 11 11 L 15 11 L 15 14 L 20 14 L 20 11 L 25 11 L 25 14 L 30 14 L 30 11 L 34 11 L 34 17 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <path d="M 14 25 L 31 25" stroke={detail} strokeWidth={sw} />
          <path d="M 12 17 L 33 17" stroke={detail} strokeWidth={sw} />
        </g>
      )}
      {type === 'n' && (
        <g>
          <path d="M 9 38 L 36 38 L 33 33 L 12 33 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path
            d="M 32 33 C 33 26 31 17 26 11 C 24 8.5 22 7.5 20.5 7.5 C 19.5 7.5 19 8 19 9.5 C 19 10 18.5 10.5 17 11.5 C 15 13 13 15 9.5 19.5 C 8.5 21 8.5 22.5 10 23.5 C 11.5 24.5 14 24 15 23.5 C 13.5 25.5 14 27.5 16.5 28 C 18.5 28.5 20.5 27 21.5 25 C 22.5 23 23 21 24.5 20 C 23.5 25 21 29 13 33 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <circle cx="15.5" cy="15.5" r="1.5" fill={detail} />
          <ellipse cx="11" cy="21.5" rx="1.2" ry="0.7" fill={detail} transform="rotate(-20 11 21.5)" />
          <path d="M 23 11 C 21.5 13.5 20.5 16.5 21.5 19" fill="none" stroke={detail} strokeWidth={sw} />
          <path d="M 27 15 C 25.5 18 24.5 22 25.5 25" fill="none" stroke={detail} strokeWidth={sw} />
          <path d="M 12 33 L 33 33" stroke={detail} strokeWidth={sw} />
        </g>
      )}
      {type === 'b' && (
        <g>
          <path d="M 9 38 L 36 38 L 33 33 L 12 33 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M 15 33 C 13 27 13 18 22.5 12 C 32 18 32 27 30 33 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <circle cx="22.5" cy="9.5" r="2.5" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M 20 17 L 26 23 M 23 16 L 23 27" fill="none" stroke={detail} strokeWidth={sw} />
          <path d="M 15 30 L 30 30" stroke={detail} strokeWidth={sw} />
        </g>
      )}
      {type === 'q' && (
        <g>
          <path d="M 9 38 L 36 38 L 33 33 L 12 33 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path
            d="M 12 33 Q 10 22 8 16 L 15 22 L 22.5 13 L 30 22 L 37 16 Q 35 22 33 33 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <circle cx="8" cy="15" r="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <circle cx="15" cy="21" r="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <circle cx="22.5" cy="12" r="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <circle cx="30" cy="21" r="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <circle cx="37" cy="15" r="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M 13 30 L 32 30" stroke={detail} strokeWidth={sw} />
        </g>
      )}
      {type === 'k' && (
        <g>
          <path d="M 9 38 L 36 38 L 33 33 L 12 33 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path
            d="M 12 33 C 10 25 12 18 22.5 16 C 33 18 35 25 33 33 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <path d="M 22.5 7 L 22.5 15 M 19 9.5 L 26 9.5" fill="none" stroke={stroke} strokeWidth={2} />
          <path d="M 17 17 C 17 13 28 13 28 17" fill="none" stroke={detail} strokeWidth={sw} />
          <path d="M 13 30 L 32 30" stroke={detail} strokeWidth={sw} />
        </g>
      )}
    </svg>
  );
}

const WHITE_GLYPHS: Record<PieceType, string> = { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' };
const BLACK_GLYPHS: Record<PieceType, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

function capturedGlyph(type: string): string {
  return WHITE_GLYPHS[type as PieceType] ?? '?';
}
function file(sq: number): number {
  return sq & 7;
}
function rank(sq: number): number {
  return sq >> 3;
}
function sq(f: number, r: number): number {
  return r * 8 + f;
}
function squareName(square: number): string {
  return `${'abcdefgh'[file(square)]}${rank(square) + 1}`;
}

/** Visual (row,col), 0,0 = top-left, back to the actual board square index. */
function squareForVisual(row: number, col: number, flipped: boolean): number {
  if (!flipped) return sq(col, 7 - row);
  return sq(7 - col, row);
}

const WIN_REASON_TEXT: Record<string, string> = {
  checkmate: 'Checkmate',
  resign: 'by resignation',
  time: 'on time',
  idle: 'by idle forfeit',
  flag: 'on time',
};

const DRAW_REASON_TEXT: Record<string, string> = {
  agreement: 'Draw by agreement',
  stalemate: 'Draw by stalemate',
  fifty: 'Draw by the fifty-move rule',
  threefold: 'Draw by threefold repetition',
  material: 'Draw by insufficient material',
};

export default function ChessBoard({ view, players, youId, legalActions, onAction }: ChessBoardProps) {
  const clocks = useRoom((s) => s.clocks);
  const clockActor = useRoom((s) => s.clockActor);
  const clockRunningSince = useRoom((s) => s.clockRunningSince);

  const isMyTurn = view.current === youId;
  const mySide = view.you?.side ?? 0;
  const legalMoves = view.you?.legalMoves ?? [];
  const isGameOver = view.phase === 'game_over';
  const flipped = mySide === 1;

  const [selected, setSelected] = React.useState<number | null>(null);
  const [pendingPromotion, setPendingPromotion] = React.useState<{ from: number; to: number } | null>(null);

  // Fresh snapshot => selection is stale; the server is authoritative.
  React.useEffect(() => {
    setSelected(null);
    setPendingPromotion(null);
  }, [view.history.length]);

  const seenMoveRef = React.useRef(view.history.length);
  React.useEffect(() => {
    if (view.history.length === seenMoveRef.current) return;
    seenMoveRef.current = view.history.length;
    const last = view.history.at(-1);
    if (!last) return;
    if (last.captured !== undefined || last.isEnPassant) sfx.tembak();
    else sfx.drop();
    if (last.promotion) sfx.crown();
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

  const players0 = resolvePlayer(players, view.players[0]?.id ?? 0, 'White');
  const players1 = resolvePlayer(players, view.players[1]?.id ?? 1, 'Black');
  const mePlayer = mySide === 0 ? players0 : players1;
  const oppPlayer = mySide === 0 ? players1 : players0;
  const meId = view.players[mySide]?.id ?? null;
  const oppId = view.players[1 - mySide]?.id ?? null;

  const meClock = clocks?.find((c) => c.playerId === meId) ?? null;
  const oppClock = clocks?.find((c) => c.playerId === oppId) ?? null;

  const lastMove = view.history.at(-1);

  const commitMove = (from: number, to: number, promotion?: 'q' | 'r' | 'b' | 'n') => {
    unlockAudioSession();
    onAction({ type: 'move', from, to, promotion });
    setSelected(null);
    setPendingPromotion(null);
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

    const matches = candidatesFromSelected.filter((m) => m.to === square);
    if (matches.length === 0) {
      if (legalFrom.has(square)) {
        sfx.blip();
        setSelected(square);
      } else {
        setSelected(null);
      }
      return;
    }

    if (matches.length === 1) {
      const m = matches[0] as ChessMove;
      commitMove(m.from, m.to, m.promotion as ('q' | 'r' | 'b' | 'n') | undefined);
    } else {
      // Multiple candidates sharing the same `to` differ only by promotion.
      setPendingPromotion({ from: selected, to: square });
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

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full lg:flex-row lg:items-start">
      <div className="flex flex-col gap-4 w-full lg:max-w-[560px] mx-auto">
        <PixelCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            {isGameOver && <Trophy size={18} className="text-pa-amber" />}
            <span className={cn('font-display text-[12px]', isGameOver ? 'text-pa-amber' : view.you?.inCheck ? 'text-pa-danger' : 'text-pa-cyan')}>
              {bannerText}
            </span>
          </div>
        </PixelCard>

        <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
          <PlayerRow player={oppPlayer} label="Opponent">
            <ClockChip
              remainingMs={oppClock?.remainingMs}
              isRunning={clockActor === oppId}
              runningSince={clockRunningSince}
              label={mySide === 0 ? 'Black' : 'White'}
            />
          </PlayerRow>
          <PlayerRow player={mePlayer} label="You" align="right">
            <ClockChip
              remainingMs={meClock?.remainingMs}
              isRunning={clockActor === meId}
              runningSince={clockRunningSince}
              label={mySide === 0 ? 'White' : 'Black'}
            />
          </PlayerRow>
        </div>

        <div className="relative mx-auto w-full max-w-[min(94vw,560px)] aspect-square">
          <div
            className="absolute inset-0 grid border-4 border-pa-border no-select touch-none"
            style={{ gridTemplateColumns: 'repeat(8, 1fr)', gridTemplateRows: 'repeat(8, 1fr)' }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {Array.from({ length: 8 }).flatMap((_, row) =>
              Array.from({ length: 8 }).map((__, col) => {
                const square = squareForVisual(row, col, flipped);
                const piece = view.board[square] ?? null;
                const dark = (file(square) + rank(square)) % 2 === 0;
                const isSelected = selected === square;
                const isDest = destOptions.has(square);
                const isStartable = selected === null && isMyTurn && legalFrom.has(square);
                const isLastFrom = lastMove && lastMove.from === square;
                const isLastTo = lastMove && lastMove.to === square;
                const isKingInCheck =
                  view.you?.inCheck && piece?.type === 'k' && piece.side === mySide;

                return (
                  <button
                    key={square}
                    type="button"
                    onClick={() => handleTap(square)}
                    onContextMenu={(e) => e.preventDefault()}
                    aria-label={`Square ${squareName(square)}`}
                    className={cn(
                      'relative flex items-center justify-center cursor-pointer no-select',
                      dark ? 'bg-[#181c30]' : 'bg-[#464f7c]',
                      isSelected && 'ring-4 ring-pa-cyan ring-inset',
                      (isLastFrom || isLastTo) && 'ring-2 ring-pa-lime ring-inset',
                      isKingInCheck && 'bg-pa-danger/30',
                    )}
                  >
                    {isStartable && !piece && <span className="w-2 h-2 rounded-full bg-pa-cyan/50" />}
                    {isDest && !piece && <span className="w-3 h-3 rounded-full bg-pa-amber animate-pulse" />}
                    {isDest && piece && <span className="absolute inset-0 ring-2 ring-pa-amber ring-inset" />}
                    {piece && (
                      <div className="w-[84%] h-[84%] flex items-center justify-center pointer-events-none">
                        <ChessPieceSvg type={piece.type} side={piece.side} />
                      </div>
                    )}
                  </button>
                );
              }),
            )}
          </div>
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
          whiteLabel={players0?.displayName ?? 'White'}
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

      <PixelDialog
        open={pendingPromotion !== null}
        onOpenChange={(v) => !v && setPendingPromotion(null)}
        title="Promote pawn to…"
      >
        <div className="flex gap-3 justify-center">
          {(['q', 'r', 'b', 'n'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className="w-14 h-14 p-2 flex items-center justify-center border-2 border-pa-border bg-pa-surface-2 hover:border-pa-cyan cursor-pointer"
              onClick={() => {
                if (pendingPromotion) commitMove(pendingPromotion.from, pendingPromotion.to, p);
              }}
            >
              <div className="w-full h-full flex items-center justify-center">
                <ChessPieceSvg type={p} side={mySide} />
              </div>
            </button>
          ))}
        </div>
      </PixelDialog>

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
        seat={player?.seat ?? (label === 'White' ? 0 : 1)}
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
