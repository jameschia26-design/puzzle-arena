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

/* ------------------------------------------------------------------ */
/* Board geometry — a real cross-shaped 15x15 Ludo/Aeroplane-Chess     */
/* layout, verified against a working reference implementation so it   */
/* lines up exactly with the engine's ring-index math (entry square    */
/* = quadrant*13, last ring step = 50, 6-cell home stretch, step 57 =  */
/* home). Absolute ring index 0 sits at (6,1); the four quadrants'     */
/* release/safe squares are ring indices 0, 13, 26, 39.                */
/* ------------------------------------------------------------------ */

const GRID = 15;
const RING_SIZE = 52;
const LAST_RING_REL = 50;
const HOME_STEP = 57;
const SAFE_SQUARES = new Set([0, 13, 26, 39]);
const FLY_SOURCES = new Set([4, 17, 30, 43]);

const RING_COORDS: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1],
  [8, 0], [7, 0], [6, 0],
];

/** The 6-cell private home stretch per quadrant (relative steps 51-56), each
 *  arriving at the shared centre cell (7,7). */
const STRETCH_COORDS: [number, number][][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
];

const HOME_CELL: [number, number] = [7, 7];

const RING_LOOKUP = new Map<string, number>(RING_COORDS.map(([r, c], i) => [`${r},${c}`, i]));
const STRETCH_LOOKUP = new Map<string, number>(
  STRETCH_COORDS.flatMap((cells, q) => cells.map(([r, c]): [string, number] => [`${r},${c}`, q])),
);

/** Top-left corner of each quadrant's 6x6 hangar block. */
const HANGAR_ORIGIN: [number, number][] = [
  [0, 0],
  [0, 9],
  [9, 9],
  [9, 0],
];

function hangarSlot(quadrant: number, tokenIndex: number): [number, number] {
  const [r, c] = HANGAR_ORIGIN[quadrant] as [number, number];
  const dr = tokenIndex < 2 ? 2 : 3;
  const dc = tokenIndex % 2 === 0 ? 2 : 3;
  return [r + dr, c + dc];
}

function squareFor(quadrant: number, steps: number): [number, number] {
  if (steps < 0) return [-1, -1]; // hangar — handled separately
  if (steps <= LAST_RING_REL) {
    const abs = (quadrant * 13 + steps) % RING_SIZE;
    return RING_COORDS[abs] as [number, number];
  }
  if (steps < HOME_STEP) return STRETCH_COORDS[quadrant]![steps - 51] as [number, number];
  return HOME_CELL;
}

const quadrantColor = (q: number): string => SEAT_COLORS[q % SEAT_COLORS.length] as string;

/** Six discrete face swaps, then settle — same cosmetic pattern as Property
 *  Tycoon's dice. Driven by `lastRoll`, not the transient `dice` field, so
 *  the value stays on screen (not just in the log) once it's been spent. */
function Die({ value, rolling }: { value: number | null; rolling: boolean }): React.ReactElement {
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
    <span
      className={cn(
        'grid h-14 w-14 place-items-center border-2 border-pa-ink bg-pa-surface font-display text-[24px] tabular shadow-md',
        rolling && 'animate-pulse',
      )}
    >
      {face ?? '–'}
    </span>
  );
}

export function AeroplaneChessBoard({ view, players, youId, turnEndsAt, onAction }: AeroplaneChessBoardProps) {
  const isMyTurn = view.current === youId;
  const isGameOver = view.phase === 'game_over';
  const legalTokens = new Set(view.you?.legalTokens ?? []);
  const rollerName = view.lastRoll ? players.find((p) => p.id === view.lastRoll!.playerId)?.displayName : null;

  React.useEffect(() => {
    if (!view.lastMove) return;
    if (view.lastMove.captured.length > 0) sfx.tembak();
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

  // Every token, grouped by its rendered (row,col) cell.
  const tokensByCell = new Map<string, { playerId: string; quadrant: number; tokenIndex: number; king?: boolean }[]>();
  for (const p of view.players) {
    p.tokens.forEach((t, i) => {
      const [r, c] = t.steps < 0 ? hangarSlot(p.quadrant, i) : squareFor(p.quadrant, t.steps);
      const key = `${r},${c}`;
      const list = tokensByCell.get(key) ?? [];
      list.push({ playerId: p.id, quadrant: p.quadrant, tokenIndex: i });
      tokensByCell.set(key, list);
    });
  }

  const activeQuadrants = new Set(view.players.map((p) => p.quadrant));

  const winnerPlayer = view.winner ? players.find((p) => p.id === view.winner) : null;

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto w-full">
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
              <div className="flex flex-col items-center gap-1">
                <Die value={view.lastRoll?.value ?? null} rolling={view.dice !== null && view.phase === 'awaiting_move'} />
                {view.lastRoll && (
                  <span className="font-display text-[9px] text-pa-ink-dim uppercase">
                    {rollerName ?? view.lastRoll.playerId} rolled
                  </span>
                )}
              </div>
              {isMyTurn && view.phase === 'awaiting_roll' && <PixelButton onClick={roll}>Roll</PixelButton>}
              {isMyTurn && view.phase === 'awaiting_move' && (
                <span className="font-display text-[11px] text-pa-cyan">PICK A PLANE TO MOVE {view.dice}</span>
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

      {/* ---------------- Cross-shaped board ---------------- */}
      <div className="mx-auto w-full max-w-[640px] aspect-square">
        <div
          className="grid w-full h-full border-2 border-pa-border bg-pa-bg"
          style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)`, gridTemplateRows: `repeat(${GRID}, 1fr)` }}
        >
          {Array.from({ length: GRID }, (_, row) =>
            Array.from({ length: GRID }, (_, col) => {
              const key = `${row},${col}`;
              const inCross = row >= 6 && row <= 8 ? true : col >= 6 && col <= 8;
              const hangarQ = row < 6 && col < 6 ? 0 : row < 6 && col > 8 ? 1 : row > 8 && col > 8 ? 2 : row > 8 && col < 6 ? 3 : null;
              const isCenter = row === 7 && col === 7;
              const ringIdx = RING_LOOKUP.get(key);
              const stretchQ = STRETCH_LOOKUP.get(key);
              const occupants = tokensByCell.get(key) ?? [];
              const safe = ringIdx !== undefined && SAFE_SQUARES.has(ringIdx);
              const fly = ringIdx !== undefined && FLY_SOURCES.has(ringIdx);
              const safeQuadrant = safe ? Math.floor((ringIdx as number) / 13) : null;

              if (hangarQ !== null) {
                const isSlot = [0, 1, 2, 3].some(
                  (i) => hangarSlot(hangarQ, i)[0] === row && hangarSlot(hangarQ, i)[1] === col,
                );
                const dim = !activeQuadrants.has(hangarQ);
                return (
                  <div
                    key={key}
                    style={{ gridRow: row + 1, gridColumn: col + 1 }}
                    className={cn('relative flex items-center justify-center border border-pa-border/30', dim && 'opacity-30')}
                  >
                    {isSlot && (
                      <span
                        className="absolute inset-[8%] border border-dashed opacity-40"
                        style={{ borderColor: quadrantColor(hangarQ) }}
                      />
                    )}
                    {isSlot && occupants.length > 0 && (
                      <TokenDots occupants={occupants} />
                    )}
                  </div>
                );
              }

              if (!inCross) {
                return <div key={key} style={{ gridRow: row + 1, gridColumn: col + 1 }} />;
              }

              return (
                <div
                  key={key}
                  style={{ gridRow: row + 1, gridColumn: col + 1 }}
                  className={cn(
                    'relative flex items-center justify-center border border-pa-border/40',
                    isCenter ? 'bg-pa-surface-2' : stretchQ !== undefined ? '' : ringIdx !== undefined ? 'bg-pa-surface' : 'bg-pa-bg',
                  )}
                  title={safe ? 'Safe square' : fly ? 'Tailwind square' : undefined}
                >
                  {stretchQ !== undefined && (
                    <span className="absolute inset-0 opacity-25" style={{ backgroundColor: quadrantColor(stretchQ) }} />
                  )}
                  {safeQuadrant !== null && (
                    <span className="absolute inset-[10%] opacity-35" style={{ backgroundColor: quadrantColor(safeQuadrant) }} />
                  )}
                  {isCenter && <Trophy size={14} className="absolute text-pa-amber opacity-60" />}
                  {fly && <span className="absolute text-[10px] text-pa-amber">✈</span>}
                  {occupants.length > 0 && <TokenDots occupants={occupants} />}
                </div>
              );
            }),
          )}
        </div>
      </div>

      {/* ---------------- Players / hangars ---------------- */}
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

function TokenDots({
  occupants,
}: {
  occupants: { playerId: string; quadrant: number; tokenIndex: number }[];
}): React.ReactElement {
  return (
    <div className="relative flex flex-wrap items-center justify-center gap-[1px] z-10 max-w-full max-h-full">
      {occupants.slice(0, 4).map((o) => (
        <span
          key={`${o.playerId}-${o.tokenIndex}`}
          className="w-[22%] aspect-square min-w-[6px] min-h-[6px] rounded-full border border-pa-ink"
          style={{ backgroundColor: quadrantColor(o.quadrant) }}
        />
      ))}
    </div>
  );
}
