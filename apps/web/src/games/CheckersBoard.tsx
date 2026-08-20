import * as React from 'react';
import { motion } from 'framer-motion';
import { Crown, Trophy } from 'lucide-react';
import type { CheckersView, CheckersPos, CheckersSide } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelCard, PixelPanel } from '../ui/primitives.js';
import { STEP_MS, useReducedMotion } from '../ui/motion.js';
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

function matchesPrefix(full: CheckersPos[], prefix: CheckersPos[]): boolean {
  if (prefix.length > full.length) return false;
  return prefix.every((p, i) => sameSquare(p, full[i] as CheckersPos));
}
/** Visual centre of a square as a percentage, respecting board orientation. */
function visualPercent(pos: CheckersPos, flipped: boolean): { left: number; top: number } {
  const vr = flipped ? 9 - pos.row : pos.row;
  const vc = flipped ? 9 - pos.col : pos.col;
  return { left: (vc + 0.5) * 10, top: (vr + 0.5) * 10 };
}

export function CheckersBoard({ view, players, youId, turnEndsAt, onAction }: CheckersBoardProps) {
  const reduced = useReducedMotion();
  const isMyTurn = view.current === youId;
  const mySide = view.you?.side ?? 0;
  const legalMoves = view.you?.legalMoves ?? [];
  const isGameOver = view.phase === 'game_over';
  // Side 0 starts near the top of the raw grid; flip so each player's own
  // pieces always render near the bottom of their own screen.
  const flipped = mySide === 0;

  const [path, setPath] = React.useState<CheckersPos[]>([]);

  // A fresh snapshot from the server always clears any in-progress selection.
  React.useEffect(() => {
    setPath([]);
  }, [view.lastMove, isMyTurn]);

  /* ---------------- last-move animation + highlight ---------------- */
  const [ghost, setGhost] = React.useState<{ path: CheckersPos[]; side: CheckersSide; king: boolean } | null>(
    null,
  );
  const [flash, setFlash] = React.useState<{ from: CheckersPos; to: CheckersPos; captured: CheckersPos[] } | null>(
    null,
  );
  const seenMoveRef = React.useRef<CheckersView['lastMove']>(null);

  React.useEffect(() => {
    const lm = view.lastMove;
    if (!lm || lm === seenMoveRef.current) return;
    seenMoveRef.current = lm;

    const from = lm.path[0] as CheckersPos;
    const to = lm.path[lm.path.length - 1] as CheckersPos;
    const movedPiece = view.board[to.row * 10 + to.col];

    if (lm.captured.length > 0) sfx.tembak();
    else sfx.drop();
    if (lm.promoted) sfx.crown();
    setFlash({ from, to, captured: lm.captured });

    if (!reduced && movedPiece) {
      setGhost({ path: lm.path, side: movedPiece.side, king: movedPiece.king });
    }

    const hopMs = STEP_MS * 2.5;
    const ghostTimer = setTimeout(() => setGhost(null), reduced ? 0 : (lm.path.length - 1) * hopMs + 40);
    const flashTimer = setTimeout(() => setFlash(null), 1800);
    return () => {
      clearTimeout(ghostTimer);
      clearTimeout(flashTimer);
    };
  }, [view.lastMove, view.board, reduced]);

  const candidates = React.useMemo(
    () => legalMoves.filter((m) => matchesPrefix(m.path, path)),
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

  const destinationOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of candidates) {
      const dest = c.path[c.path.length - 1];
      if (dest) set.add(`${dest.row},${dest.col}`);
    }
    return set;
  }, [candidates]);

  const startOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const m of legalMoves) set.add(`${m.path[0]!.row},${m.path[0]!.col}`);
    return set;
  }, [legalMoves]);

  const players0 = players.find((p) => p.id === view.players[0]?.id);
  const players1 = players.find((p) => p.id === view.players[1]?.id);
  const mePlayer = mySide === 0 ? players0 : players1;
  const oppPlayer = mySide === 0 ? players1 : players0;
  const ghostOwner = ghost ? players.find((p) => p.id === view.players[ghost.side]?.id) : null;

  const handleTap = (row: number, col: number): void => {
    if (!isMyTurn || isGameOver) return;
    const target: CheckersPos = { row, col };
    const key = `${row},${col}`;

    if (path.length === 0) {
      if (!startOptions.has(key)) return;
      unlockAudioSession();
      sfx.blip();
      setPath([target]);
      return;
    }

    if (sameSquare(path[0] as CheckersPos, target)) {
      setPath([]); // tapping the selected piece again deselects
      return;
    }

    const isImmediateNext = nextOptions.has(key);
    const destCandidates = candidates.filter(
      (c) => sameSquare(c.path[c.path.length - 1] as CheckersPos, target) && matchesPrefix(c.path, path),
    );

    if (!isImmediateNext && destCandidates.length === 0) {
      // If tapping another startable piece, switch selection directly
      if (startOptions.has(key)) {
        sfx.blip();
        setPath([target]);
      } else {
        setPath([]);
      }
      return;
    }

    if (isImmediateNext) {
      const newPath = [...path, target];
      const matchingCandidates = candidates.filter((c) => matchesPrefix(c.path, newPath));
      const stillLonger = matchingCandidates.some((c) => c.path.length > newPath.length);
      const exactMatch = matchingCandidates.find((c) => c.path.length === newPath.length);

      if (exactMatch && !stillLonger) {
        unlockAudioSession();
        onAction({ type: 'move', path: exactMatch.path });
        setPath([]);
      } else {
        sfx.pickup();
        setPath(newPath);
      }
    } else if (destCandidates.length === 1) {
      // Direct tap on destination for unique jump sequence
      unlockAudioSession();
      onAction({ type: 'move', path: destCandidates[0]!.path });
      setPath([]);
    }
  };

  const rowOrder = flipped ? [...Array(10)].map((_, i) => 9 - i) : [...Array(10)].map((_, i) => i);
  const colOrder = flipped ? [...Array(10)].map((_, i) => 9 - i) : [...Array(10)].map((_, i) => i);

  const winnerPlayer = view.winner ? players.find((p) => p.id === view.winner) : null;
  const ghostDest = ghost ? (ghost.path[ghost.path.length - 1] as CheckersPos) : null;

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

      <div className="relative mx-auto w-full max-w-[520px] aspect-square">
        <div
          className="absolute inset-0 grid border-4 border-pa-border"
          style={{ gridTemplateColumns: 'repeat(10, 1fr)', gridTemplateRows: 'repeat(10, 1fr)' }}
        >
          {rowOrder.flatMap((row) =>
            colOrder.map((col) => {
              const dark = (row + col) % 2 === 1;
              const hideForGhost = ghostDest && sameSquare(ghostDest, { row, col });
              const piece = dark && !hideForGhost ? view.board[row * 10 + col] : null;
              const isSelected = path.length > 0 && sameSquare(path[0] as CheckersPos, { row, col });
              const isNextOption =
                dark && (nextOptions.has(`${row},${col}`) || destinationOptions.has(`${row},${col}`));
              const isStartable = dark && path.length === 0 && isMyTurn && startOptions.has(`${row},${col}`);
              const isLastFrom = flash && sameSquare(flash.from, { row, col });
              const isLastTo = flash && sameSquare(flash.to, { row, col });
              const isLastCaptured = flash?.captured.some((c) => sameSquare(c, { row, col }));
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
                    (isLastFrom || isLastTo) && 'ring-2 ring-pa-lime ring-inset',
                    isLastCaptured && 'bg-pa-danger/25',
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

        {/* The moved piece flies along its whole path (including multi-jump
            hops) instead of the board just snapping to the new position —
            without this a capture chain reads as pieces randomly vanishing. */}
        {ghost && (
          <motion.div
            className="absolute pointer-events-none z-20"
            style={{ width: '7.6%', height: '7.6%', translateX: '-50%', translateY: '-50%' }}
            initial={{
              left: `${visualPercent(ghost.path[0] as CheckersPos, flipped).left}%`,
              top: `${visualPercent(ghost.path[0] as CheckersPos, flipped).top}%`,
            }}
            animate={{
              left: ghost.path.map((p) => `${visualPercent(p, flipped).left}%`),
              top: ghost.path.map((p) => `${visualPercent(p, flipped).top}%`),
            }}
            transition={{ duration: ((ghost.path.length - 1) * STEP_MS * 2.5) / 1000, ease: 'linear' }}
          >
            <span
              className="w-full h-full rounded-full border-2 flex items-center justify-center shadow-lg"
              style={{
                backgroundColor: seatColor(ghostOwner?.seat ?? ghost.side),
                borderColor: 'var(--color-pa-ink)',
              }}
            >
              {ghost.king && <Crown size={16} className="text-pa-bg" strokeWidth={3} />}
            </span>
          </motion.div>
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
