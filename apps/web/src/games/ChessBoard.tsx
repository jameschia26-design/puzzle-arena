import * as React from 'react';
import { Trophy } from 'lucide-react';
import type { ChessMove, ChessPiece, ChessView, ChessPieceType as PieceType } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { PixelBadge, PixelButton, PixelCard, PixelDialog } from '../ui/primitives.js';
import { SeatAvatar } from '../ui/game-bits.js';
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

const WHITE_GLYPHS: Record<PieceType, string> = { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' };
const BLACK_GLYPHS: Record<PieceType, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

function glyphFor(piece: ChessPiece): string {
  return piece.side === 0 ? WHITE_GLYPHS[piece.type] : BLACK_GLYPHS[piece.type];
}

function capturedGlyph(type: string): string {
  // Captured-tray glyphs are shown neutral (white-style) since the tray is
  // side-agnostic (it just lists what was taken).
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

  const players0 = players.find((p) => p.id === view.players[0]?.id);
  const players1 = players.find((p) => p.id === view.players[1]?.id);
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

  const winnerPlayer = view.winner ? players.find((p) => p.id === view.winner) : null;
  const isDraw = isGameOver && view.winner === null;

  const bannerText = isGameOver
    ? isDraw
      ? (view.drawReason && DRAW_REASON_TEXT[view.drawReason]) || 'Draw'
      : `${winnerPlayer?.displayName ?? 'Winner'} wins${view.winReason ? ` — ${WIN_REASON_TEXT[view.winReason] ?? view.winReason}` : ''}`
    : isMyTurn
      ? view.you?.inCheck
        ? 'YOU ARE IN CHECK — YOUR TURN'
        : 'YOUR TURN'
      : `WAITING FOR ${players.find((p) => p.id === view.current)?.displayName ?? 'OPPONENT'}…`;

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

        <div className="flex items-center justify-between px-1">
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
            className="absolute inset-0 grid border-4 border-pa-border"
            style={{ gridTemplateColumns: 'repeat(8, 1fr)', gridTemplateRows: 'repeat(8, 1fr)' }}
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
                    aria-label={`Square ${squareName(square)}`}
                    className={cn(
                      'relative flex items-center justify-center cursor-pointer',
                      dark ? 'bg-pa-surface-2' : 'bg-pa-surface',
                      isSelected && 'ring-4 ring-pa-cyan ring-inset',
                      (isLastFrom || isLastTo) && 'ring-2 ring-pa-lime ring-inset',
                      isKingInCheck && 'bg-pa-danger/30',
                    )}
                  >
                    {isStartable && !piece && <span className="w-2 h-2 rounded-full bg-pa-cyan/50" />}
                    {isDest && !piece && <span className="w-3 h-3 rounded-full bg-pa-amber animate-pulse" />}
                    {isDest && piece && <span className="absolute inset-0 ring-2 ring-pa-amber ring-inset" />}
                    {piece && (
                      <span
                        className="select-none leading-none"
                        style={{
                          fontSize: 'min(9vw, 46px)',
                          color: piece.side === 0 ? '#f4f6ff' : '#0b0d17',
                          filter:
                            piece.side === 0
                              ? 'drop-shadow(1px 1px 0 #05060d)'
                              : 'drop-shadow(1px 1px 0 #e8ecff)',
                        }}
                      >
                        {glyphFor(piece)}
                      </span>
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
              className="w-14 h-14 flex items-center justify-center border-2 border-pa-border bg-pa-surface-2 hover:border-pa-cyan cursor-pointer"
              onClick={() => {
                if (pendingPromotion) commitMove(pendingPromotion.from, pendingPromotion.to, p);
              }}
            >
              <span style={{ fontSize: 32, color: mySide === 0 ? '#f4f6ff' : '#0b0d17' }}>
                {mySide === 0 ? WHITE_GLYPHS[p] : BLACK_GLYPHS[p]}
              </span>
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
  player: PlayerView | undefined;
  label: string;
  align?: 'left' | 'right';
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-2', align === 'right' && 'flex-row-reverse text-right')}>
      <SeatAvatar seat={player?.seat ?? 0} displayName={player?.displayName ?? '—'} isBot={player?.isBot ?? false} size={28} />
      <div className="flex flex-col">
        <span className="text-[12px] truncate max-w-[120px]">{player?.displayName ?? '—'}</span>
        <PixelBadge>{label}</PixelBadge>
      </div>
      {children}
    </div>
  );
}
