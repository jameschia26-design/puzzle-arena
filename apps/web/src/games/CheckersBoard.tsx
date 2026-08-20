import * as React from 'react';
import { Crown, Trophy } from 'lucide-react';
import type { CheckersView, CheckersPos } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelCard, PixelPanel } from '../ui/primitives.js';
import { seatColor } from '../ui/seat.js';
import { sfx, unlockAudioSession } from '../ui/sound.js';

interface CheckersBoardProps {
  view: CheckersView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}

const SIDE_LABEL = ['Red', 'Cream'] as const;

function sameSquare(a: CheckersPos, b: CheckersPos): boolean {
  return a.row === b.row && a.col === b.col;
}

export function CheckersBoard({ view, players, youId, turnEndsAt, onAction }: CheckersBoardProps) {
  const isMyTurn = view.current === youId;
  const mySide = view.you?.side ?? 0;
  const legalMoves = view.you?.legalMoves ?? [];
  const isGameOver = view.phase === 'game_over';

  const [path, setPath] = React.useState<CheckersPos[]>([]);

  // A fresh snapshot from the server always clears any in-progress selection.
  React.useEffect(() => {
    setPath([]);
  }, [view.lastMove, isMyTurn]);

  React.useEffect(() => {
    if (view.lastMove?.promoted) sfx.crown();
  }, [view.lastMove]);

  const candidates = React.useMemo(
    () => legalMoves.filter((m) => path.every((p, i) => sameSquare(p, m.path[i] as CheckersPos))),
    [legalMoves, path],
  );

  const nextOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of candidates) {
      const next = c.path[path.length];
      if (next) set.add(`${next.row},${next.col}`);
    }
    return set;
  }, [candidates, path]);

  const startOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const m of legalMoves) set.add(`${m.path[0]!.row},${m.path[0]!.col}`);
    return set;
  }, [legalMoves]);

  const players0 = players.find((p) => p.id === view.players[0]?.id);
  const players1 = players.find((p) => p.id === view.players[1]?.id);
  const mePlayer = mySide === 0 ? players0 : players1;
  const oppPlayer = mySide === 0 ? players1 : players0;

  const handleTap = (row: number, col: number): void => {
    if (!isMyTurn || isGameOver) return;
    const key = `${row},${col}`;

    if (path.length === 0) {
      if (!startOptions.has(key)) return;
      unlockAudioSession();
      sfx.blip();
      setPath([{ row, col }]);
      return;
    }

    if (sameSquare(path[0] as CheckersPos, { row, col })) {
      setPath([]); // tapping the selected piece again deselects
      return;
    }

    if (!nextOptions.has(key)) {
      setPath([]); // tapping anywhere else cancels the in-progress selection
      return;
    }

    const newPath = [...path, { row, col }];
    const stillLonger = candidates.some((c) => c.path.length > newPath.length);
    const fullMatch = candidates.find((c) => c.path.length === newPath.length);

    if (fullMatch && !stillLonger) {
      unlockAudioSession();
      const captured = fullMatch.captured.length > 0;
      if (captured) sfx.tembak();
      else sfx.drop();
      onAction({ type: 'move', path: fullMatch.path });
      setPath([]);
    } else {
      sfx.pickup();
      setPath(newPath);
    }
  };

  // Board rows/cols render bottom-up for the player on side 1, so each
  // player's own pieces always sit near the bottom of their screen.
  const rowOrder = mySide === 1 ? [...Array(10)].map((_, i) => 9 - i) : [...Array(10)].map((_, i) => i);
  const colOrder = mySide === 1 ? [...Array(10)].map((_, i) => 9 - i) : [...Array(10)].map((_, i) => i);

  const winnerPlayer = view.winner ? players.find((p) => p.id === view.winner) : null;

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full">
      <PixelCard className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          {isGameOver ? (
            <div className="flex items-center gap-2 text-pa-amber">
              <Trophy size={18} className="text-pa-amber" />
              <span className="font-display text-[12px]">
                {winnerPlayer ? `${winnerPlayer.displayName} WINS!` : 'GAME OVER'}
              </span>
            </div>
          ) : isMyTurn ? (
            <span className="font-display text-[12px] text-pa-cyan">
              YOUR TURN {path.length > 0 ? '— CONTINUE THE CAPTURE' : '— SELECT A PIECE'}
            </span>
          ) : (
            <span className="font-display text-[12px] text-pa-ink-dim">
              WAITING FOR {players.find((p) => p.id === view.current)?.displayName ?? 'OPPONENT'}…
            </span>
          )}
        </div>
        {!isGameOver && turnEndsAt && <Countdown endsAt={turnEndsAt} className="text-[16px]" />}
      </PixelCard>

      <div className="flex items-center justify-between px-1">
        <PlayerBadge player={oppPlayer} label={`${SIDE_LABEL[1 - mySide]} · ${view.players[1 - mySide]?.piecesRemaining ?? 0} left`} />
        <PlayerBadge player={mePlayer} label={`${SIDE_LABEL[mySide]} (you) · ${view.players[mySide]?.piecesRemaining ?? 0} left`} align="right" />
      </div>

      <div
        className="mx-auto grid border-4 border-pa-border w-full max-w-[520px] aspect-square"
        style={{ gridTemplateColumns: 'repeat(10, 1fr)', gridTemplateRows: 'repeat(10, 1fr)' }}
      >
        {rowOrder.flatMap((row) =>
          colOrder.map((col) => {
            const dark = (row + col) % 2 === 1;
            const piece = dark ? view.board[row * 10 + col] : null;
            const isSelected = path.length > 0 && sameSquare(path[0] as CheckersPos, { row, col });
            const isNextOption = dark && nextOptions.has(`${row},${col}`);
            const isStartable = dark && path.length === 0 && isMyTurn && startOptions.has(`${row},${col}`);
            const owner = piece ? players.find((p) => p.id === view.players[piece.side]?.id) : null;

            return (
              <button
                key={`${row}-${col}`}
                type="button"
                disabled={!dark}
                onClick={() => handleTap(row, col)}
                aria-label={dark ? `Square ${row},${col}` : undefined}
                className={cn(
                  'relative flex items-center justify-center',
                  dark ? 'bg-pa-surface-2 cursor-pointer' : 'bg-pa-bg cursor-default',
                  isSelected && 'ring-4 ring-pa-cyan ring-inset',
                  isNextOption && 'ring-2 ring-pa-amber ring-inset',
                )}
              >
                {isStartable && !piece && <span className="w-2 h-2 rounded-full bg-pa-cyan/60" />}
                {isNextOption && !piece && (
                  <span className="w-3 h-3 rounded-full bg-pa-amber animate-pulse" />
                )}
                {piece && (
                  <span
                    className="w-[76%] h-[76%] rounded-full border-2 flex items-center justify-center shadow-md"
                    style={{
                      backgroundColor: seatColor(owner?.seat ?? piece.side),
                      borderColor: 'var(--color-pa-ink)',
                    }}
                  >
                    {piece.king && <Crown size={16} className="text-pa-bg" strokeWidth={3} />}
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>

      {path.length > 0 && (
        <div className="flex justify-center">
          <PixelButton variant="ghost" size="sm" onClick={() => setPath([])}>
            Cancel selection
          </PixelButton>
        </div>
      )}

      <PixelPanel title="Match Log">
        <div className="h-28 overflow-y-auto flex flex-col-reverse gap-1 pr-2 text-[12px] tabular">
          {view.log.length === 0 ? (
            <p className="text-pa-ink-dim italic">Waiting for the first move…</p>
          ) : (
            [...view.log].reverse().map((entry, idx) => (
              <p key={idx} className="text-pa-ink-dim">
                {entry.text}
              </p>
            ))
          )}
        </div>
      </PixelPanel>
    </div>
  );
}

function PlayerBadge({
  player,
  label,
  align = 'left',
}: {
  player: PlayerView | undefined;
  label: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={cn('flex items-center gap-2', align === 'right' && 'flex-row-reverse text-right')}>
      <SeatAvatar seat={player?.seat ?? 0} displayName={player?.displayName ?? '—'} isBot={player?.isBot ?? false} size={28} />
      <div className="flex flex-col">
        <span className="text-[12px] truncate max-w-[140px]">{player?.displayName ?? '—'}</span>
        <PixelBadge>{label}</PixelBadge>
      </div>
    </div>
  );
}
