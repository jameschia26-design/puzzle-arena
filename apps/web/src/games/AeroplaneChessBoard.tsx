import * as React from 'react';
import { Plane, Trophy } from 'lucide-react';
import type { AeroplaneChessView } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelPanel } from '../ui/primitives.js';
import { DICE_FRAME_MS, useReducedMotion } from '../ui/motion.js';
import { SEAT_COLORS } from '../ui/seat.js';
import { sfx, unlockAudioSession } from '../ui/sound.js';

interface AeroplaneChessBoardProps {
  view: AeroplaneChessView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}

const RING_SIZE = 52;
const SAFE_SQUARES = new Set([0, 13, 26, 39]);
const FLY_SOURCES = new Set([4, 17, 30, 43]);
const GRID = 14; // 14x14 perimeter has exactly 52 cells, matching the ring

function ringToGrid(i: number): { row: number; col: number } {
  const n = ((i % RING_SIZE) + RING_SIZE) % RING_SIZE;
  if (n <= 13) return { row: 0, col: n };
  if (n <= 26) return { row: n - 13, col: 13 };
  if (n <= 39) return { row: 13, col: 13 - (n - 26) };
  return { row: 13 - (n - 39), col: 0 };
}

function entrySquare(quadrant: number): number {
  return quadrant * 13;
}

function absoluteSquare(quadrant: number, relSteps: number): number {
  return (entrySquare(quadrant) + relSteps) % RING_SIZE;
}

const quadrantColor = (q: number): string => SEAT_COLORS[q % SEAT_COLORS.length] as string;

/** Six discrete face swaps, then settle on the server's value — same
 *  cosmetic pattern as Property Tycoon's two-die widget. */
function Die({ value }: { value: number | null }): React.ReactElement {
  const reduced = useReducedMotion();
  const [face, setFace] = React.useState<number | null>(value);

  React.useEffect(() => {
    if (value === null) return;
    if (reduced) {
      setFace(value);
      return;
    }
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      if (frame >= 6) {
        clearInterval(timer);
        setFace(value);
        return;
      }
      setFace(1 + ((frame * 3) % 6));
    }, DICE_FRAME_MS);
    return () => clearInterval(timer);
  }, [value, reduced]);

  return (
    <span className="grid h-12 w-12 place-items-center border-2 border-pa-ink bg-pa-surface font-display text-[20px] tabular">
      {face ?? '–'}
    </span>
  );
}

export function AeroplaneChessBoard({ view, players, youId, turnEndsAt, onAction }: AeroplaneChessBoardProps) {
  const isMyTurn = view.current === youId;
  const isGameOver = view.phase === 'game_over';
  const legalTokens = new Set(view.you?.legalTokens ?? []);

  React.useEffect(() => {
    if (!view.lastMove) return;
    if (view.lastMove.captured.length > 0) sfx.tembak();
    else if (view.lastMove.released) sfx.launch();
    else if (view.lastMove.flew) sfx.extraTurn();
    else if (view.lastMove.reachedHome) sfx.victory();
    else sfx.drop();
  }, [view.lastMove]);

  React.useEffect(() => {
    if (view.lastRoll) sfx.rollDice();
  }, [view.lastRoll]);

  const roll = (): void => {
    unlockAudioSession();
    onAction({ type: 'roll' });
  };

  const movePlane = (tokenIndex: number): void => {
    if (!legalTokens.has(tokenIndex)) return;
    unlockAudioSession();
    onAction({ type: 'movePlane', tokenIndex });
  };

  // Every token currently on the shared ring, grouped by absolute square.
  const tokensBySquare = new Map<number, { playerId: string; quadrant: number; tokenIndex: number }[]>();
  for (const p of view.players) {
    p.tokens.forEach((t, i) => {
      if (t.steps < 0 || t.steps > 50) return;
      const abs = absoluteSquare(p.quadrant, t.steps);
      const list = tokensBySquare.get(abs) ?? [];
      list.push({ playerId: p.id, quadrant: p.quadrant, tokenIndex: i });
      tokensBySquare.set(abs, list);
    });
  }

  const winnerPlayer = view.winner ? players.find((p) => p.id === view.winner) : null;

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full">
      <PixelPanel
        title={isGameOver ? 'Game over' : isMyTurn ? 'Your turn' : 'Waiting'}
        action={!isGameOver && turnEndsAt ? <Countdown endsAt={turnEndsAt} className="text-[16px]" /> : undefined}
      >
        <div className="flex flex-wrap items-center gap-4">
          {isGameOver ? (
            <div className="flex items-center gap-2 text-pa-amber">
              <Trophy size={18} />
              <span className="font-display text-[12px]">
                {winnerPlayer ? `${winnerPlayer.displayName} WINS!` : 'GAME OVER'}
              </span>
            </div>
          ) : (
            <>
              <Die value={view.dice} />
              {isMyTurn && view.phase === 'awaiting_roll' && (
                <PixelButton onClick={roll}>Roll</PixelButton>
              )}
              {isMyTurn && view.phase === 'awaiting_move' && (
                <span className="font-display text-[11px] text-pa-cyan">
                  PICK A PLANE TO MOVE {view.dice}
                </span>
              )}
              {!isMyTurn && (
                <span className="font-display text-[11px] text-pa-ink-dim">
                  {players.find((p) => p.id === view.current)?.displayName ?? 'Opponent'}'s turn…
                </span>
              )}
            </>
          )}
        </div>
      </PixelPanel>

      {/* ---------------- Board ---------------- */}
      <div className="mx-auto w-full max-w-[560px] aspect-square relative">
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)`, gridTemplateRows: `repeat(${GRID}, 1fr)` }}
        >
          {Array.from({ length: RING_SIZE }, (_, i) => {
            const { row, col } = ringToGrid(i);
            const occupants = tokensBySquare.get(i) ?? [];
            const safe = SAFE_SQUARES.has(i);
            const fly = FLY_SOURCES.has(i);
            const entryQuadrant = safe ? i / 13 : null;
            return (
              <div
                key={i}
                style={{ gridRow: row + 1, gridColumn: col + 1 }}
                className={cn(
                  'relative border border-pa-border/60 flex items-center justify-center',
                  safe ? 'bg-pa-surface-2' : 'bg-pa-bg',
                )}
                title={safe ? 'Safe square' : fly ? 'Tailwind square' : undefined}
              >
                {entryQuadrant !== null && (
                  <span
                    className="absolute inset-1 opacity-30"
                    style={{ backgroundColor: quadrantColor(entryQuadrant) }}
                  />
                )}
                {fly && <span className="absolute text-[10px] text-pa-amber">✈</span>}
                <div className="relative flex flex-wrap items-center justify-center gap-[1px] z-10">
                  {occupants.slice(0, 4).map((o) => (
                    <span
                      key={`${o.playerId}-${o.tokenIndex}`}
                      className="w-2.5 h-2.5 rounded-full border border-pa-ink"
                      style={{ backgroundColor: quadrantColor(o.quadrant) }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------- Players / hangars / runways ---------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {view.players.map((p) => {
          const info = players.find((pl) => pl.id === p.id);
          const mine = p.id === youId;
          return (
            <PixelPanel
              key={p.id}
              title={
                <span className="flex items-center gap-2">
                  <SeatAvatar seat={info?.seat ?? p.seat} displayName={info?.displayName ?? p.id} isBot={info?.isBot ?? false} size={20} />
                  <span
                    className="w-3 h-3 border border-pa-ink inline-block"
                    style={{ backgroundColor: quadrantColor(p.quadrant) }}
                  />
                  {info?.displayName ?? p.id}
                  {mine && <PixelBadge tone="cyan">You</PixelBadge>}
                  {view.current === p.id && !isGameOver && <PixelBadge tone="success">Turn</PixelBadge>}
                </span>
              }
            >
              <div className="flex items-center gap-3 flex-wrap">
                {p.tokens.map((t, i) => {
                  const inHangar = t.steps === -1;
                  const home = t.steps === 57;
                  const inStretch = t.steps >= 51 && t.steps <= 56;
                  const clickable = mine && isMyTurn && legalTokens.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!clickable}
                      onClick={() => movePlane(i)}
                      aria-label={`Plane ${i + 1}${inHangar ? ' (in hangar)' : home ? ' (home)' : ''}`}
                      className={cn(
                        'w-10 h-10 border-2 flex items-center justify-center relative',
                        clickable ? 'cursor-pointer border-pa-cyan animate-pulse' : 'border-pa-border cursor-default',
                        home && 'bg-pa-success/20',
                      )}
                      style={{ color: quadrantColor(p.quadrant) }}
                    >
                      <Plane size={16} strokeWidth={3} fill={home ? 'currentColor' : 'none'} />
                      {inStretch && (
                        <span className="absolute -bottom-1 -right-1 text-[8px] font-display bg-pa-surface px-1 border border-pa-border">
                          {t.steps - 50}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </PixelPanel>
          );
        })}
      </div>

      <PixelPanel title="Match Log">
        <div className="h-28 overflow-y-auto flex flex-col-reverse gap-1 pr-2 text-[12px] tabular">
          {view.log.length === 0 ? (
            <p className="text-pa-ink-dim italic">Waiting for the first roll…</p>
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
