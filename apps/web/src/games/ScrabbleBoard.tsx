import * as React from 'react';
// Type-only: erased at build time, so this never pulls the engine (and with
// it the 172k-word dictionary and the bot's move generator) into the client
// bundle. The runtime board/tile constants below come from @puzzle-arena/shared
// instead, which is the actual owner of that pure data — see packages/shared/src/scrabble.ts.
import type { ScrabbleView } from '@puzzle-arena/games';
import {
  BOARD_SIZE,
  CENTER_ROW,
  CENTER_COL,
  indexOf,
  premiumAt,
  RACK_SIZE,
  letterValue,
  BLANK,
  type PlayerView,
} from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelCard, PixelDialog, PixelPanel } from '../ui/primitives.js';
import { RotateCcw } from 'lucide-react';

/** Translucent tints, same "fill + label" language as the Sudoku killer cages. */
const PREMIUM_STYLE: Record<string, { bg: string; label: string; text: string }> = {
  TW: { bg: 'rgba(255, 63, 142, 0.28)', label: 'TW', text: 'var(--color-pa-magenta)' },
  DW: { bg: 'rgba(139, 92, 246, 0.28)', label: 'DW', text: 'var(--color-pa-violet)' },
  TL: { bg: 'rgba(34, 224, 255, 0.24)', label: 'TL', text: 'var(--color-pa-cyan)' },
  DL: { bg: 'rgba(157, 255, 60, 0.22)', label: 'DL', text: 'var(--color-pa-success)' },
};

interface StagedTile {
  row: number;
  col: number;
  letter: string;
  isBlank: boolean;
  /** Index into the player's rack this tile was drawn from, so recalling it
   *  restores the exact slot rather than guessing by letter. */
  rackIndex: number;
}

export function ScrabbleBoard({
  view,
  players,
  youId,
  legalActions,
  turnEndsAt,
  onAction,
}: {
  view: ScrabbleView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}) {
  const [staged, setStaged] = React.useState<StagedTile[]>([]);
  const [selectedRackIndex, setSelectedRackIndex] = React.useState<number | null>(null);
  const [blankPrompt, setBlankPrompt] = React.useState<{ row: number; col: number } | null>(null);
  const [exchangeOpen, setExchangeOpen] = React.useState(false);
  const [exchangeSelection, setExchangeSelection] = React.useState<number[]>([]);

  const can = (action: string): boolean => legalActions.includes(action);
  const isMyTurn = view.current === youId;
  const rack = view.you?.rack ?? [];

  const nameOf = (id: string): string =>
    players.find((p) => p.id === id)?.displayName ?? id.slice(0, 6);
  const seatOf = (id: string): number => players.find((p) => p.id === id)?.seat ?? 0;

  // Reset any pending placement whenever the authoritative board changes
  // underneath it (our own accepted play, or the turn moving on).
  React.useEffect(() => {
    setStaged([]);
    setSelectedRackIndex(null);
  }, [view.board, view.current]);

  const stagedAt = React.useMemo(() => {
    const map = new Map<number, StagedTile>();
    for (const t of staged) map.set(indexOf(t.row, t.col), t);
    return map;
  }, [staged]);

  const usedRackIndexes = new Set(staged.map((t) => t.rackIndex));

  const placeAt = (row: number, col: number, letter: string, isBlank: boolean): void => {
    if (selectedRackIndex === null) return;
    setStaged((prev) => [...prev, { row, col, letter, isBlank, rackIndex: selectedRackIndex }]);
    setSelectedRackIndex(null);
  };

  const onCellClick = (row: number, col: number): void => {
    if (!isMyTurn) return;
    const index = indexOf(row, col);
    const already = stagedAt.get(index);
    if (already) {
      // Recall: pull it back into the rack.
      setStaged((prev) => prev.filter((t) => t !== already));
      return;
    }
    if (view.board[index] !== null) return; // occupied by an earlier turn
    if (selectedRackIndex === null) return;
    if (rack[selectedRackIndex] === BLANK) {
      setBlankPrompt({ row, col });
      return;
    }
    placeAt(row, col, rack[selectedRackIndex] as string, false);
  };

  const submit = (): void => {
    if (staged.length === 0) return;
    onAction({
      type: 'place',
      tiles: staged.map((t) => ({ row: t.row, col: t.col, letter: t.letter, isBlank: t.isBlank })),
    });
  };

  const clearStaged = (): void => {
    setStaged([]);
    setSelectedRackIndex(null);
  };

  const pass = (): void => onAction({ type: 'pass' });

  const submitExchange = (): void => {
    const letters = exchangeSelection.map((i) => rack[i]).filter((l): l is string => l !== undefined);
    if (letters.length === 0) return;
    onAction({ type: 'exchange', letters });
    setExchangeSelection([]);
    setExchangeOpen(false);
  };

  const bagLow = view.bagCount < RACK_SIZE;

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      {/* ------------------------------ board ------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <TurnBanner
          view={view}
          nameOf={nameOf}
          seatOf={seatOf}
          youId={youId}
          turnEndsAt={turnEndsAt ?? null}
        />

        <div
          className="grid w-full max-w-[min(94vw,640px)] border-2 border-pa-ink bg-pa-bg aspect-square"
          style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
            const row = Math.floor(i / BOARD_SIZE);
            const col = i % BOARD_SIZE;
            const placed = view.board[i];
            const pending = stagedAt.get(i);
            const premium = premiumAt(row, col);
            const isCenter = row === CENTER_ROW && col === CENTER_COL;
            const style = premium ? PREMIUM_STYLE[premium] : null;
            const clickable = isMyTurn && !placed;

            return (
              <button
                key={i}
                type="button"
                disabled={!clickable && !pending}
                onClick={() => onCellClick(row, col)}
                className={cn(
                  'relative flex items-center justify-center border border-pa-border/50',
                  clickable || pending ? 'cursor-pointer' : 'cursor-default',
                )}
                style={{ backgroundColor: placed ? undefined : (style?.bg ?? undefined) }}
                aria-label={`Row ${row + 1} column ${col + 1}`}
              >
                {!placed && !pending && style && (
                  <span
                    className="pointer-events-none font-display"
                    style={{ fontSize: 'clamp(6px, 1.4vw, 9px)', color: style.text }}
                  >
                    {style.label}
                  </span>
                )}
                {!placed && !pending && isCenter && !style && (
                  <span className="pointer-events-none text-pa-amber" style={{ fontSize: 'clamp(10px, 2vw, 14px)' }}>
                    ★
                  </span>
                )}
                {(placed || pending) && (
                  <Tile
                    letter={(placed?.letter ?? pending?.letter) as string}
                    isBlank={placed?.isBlank ?? pending?.isBlank ?? false}
                    pending={!placed}
                  />
                )}
              </button>
            );
          })}
        </div>

        <Rack
          rack={rack}
          usedIndexes={usedRackIndexes}
          selected={selectedRackIndex}
          onSelect={setSelectedRackIndex}
          disabled={!isMyTurn}
        />

        <div className="flex flex-wrap gap-2">
          <PixelButton
            variant="primary"
            size="sm"
            disabled={!can('place') || staged.length === 0}
            onClick={submit}
          >
            Play {staged.length > 0 ? `(${staged.length} tile${staged.length === 1 ? '' : 's'})` : ''}
          </PixelButton>
          <PixelButton
            variant="ghost"
            size="sm"
            disabled={staged.length === 0}
            onClick={clearStaged}
          >
            <RotateCcw size={14} strokeWidth={3} className="lucide" />
            Clear
          </PixelButton>
          <PixelButton
            variant="secondary"
            size="sm"
            disabled={!can('exchange')}
            onClick={() => setExchangeOpen(true)}
          >
            Exchange
          </PixelButton>
          <PixelButton variant="ghost" size="sm" disabled={!can('pass')} onClick={pass}>
            Pass
          </PixelButton>
        </div>
      </div>

      {/* ------------------------------ rail ------------------------------ */}
      <div className="flex w-full flex-col gap-3 xl:w-[280px] xl:shrink-0">
        <PixelPanel title="Scrabble">
          <div className="flex flex-col gap-3 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-pa-ink-dim">Tiles left in bag</span>
              <PixelBadge tone={bagLow ? 'amber' : 'default'}>{view.bagCount}</PixelBadge>
            </div>
            {view.lastPlay && (
              <div className="border-t-2 border-pa-border pt-3">
                <p className="text-pa-ink-dim">Last play</p>
                <p className="font-display text-[14px]">
                  {view.lastPlay.word} <span className="text-pa-cyan">+{view.lastPlay.score}</span>
                </p>
                <p className="text-pa-ink-dim">{nameOf(view.lastPlay.playerId)}</p>
              </div>
            )}
            {view.turnPhase === 'game_over' && (
              <div className="border-t-2 border-pa-border pt-3">
                <p className="font-display text-[12px] text-pa-cyan">Game over</p>
                <p className="text-pa-ink-dim">
                  {view.winReason === 'emptied-rack'
                    ? `${view.winner ? nameOf(view.winner) : 'Someone'} played their last tile`
                    : 'Six scoreless turns in a row'}
                </p>
              </div>
            )}
          </div>
        </PixelPanel>

        <PixelPanel title="Players">
          <ul className="flex flex-col gap-2">
            {view.players.map((p) => (
              <li
                key={p.id}
                className={cn(
                  'flex items-center gap-2 border-2 px-2 py-1.5',
                  p.id === view.current ? 'border-pa-magenta' : 'border-pa-border',
                )}
              >
                <SeatAvatar
                  seat={p.seat}
                  displayName={nameOf(p.id)}
                  isBot={players.find((pl) => pl.id === p.id)?.isBot}
                  size={24}
                />
                <span className="min-w-0 flex-1 truncate text-[12px]">{nameOf(p.id)}</span>
                <span className="text-pa-ink-dim text-[11px]">{p.rackSize} tiles</span>
                <span className="font-display text-[13px] tabular">{p.score}</span>
              </li>
            ))}
          </ul>
        </PixelPanel>
      </div>

      {blankPrompt && (
        <BlankLetterPicker
          onPick={(letter) => {
            placeAt(blankPrompt.row, blankPrompt.col, letter, true);
            setBlankPrompt(null);
          }}
          onCancel={() => setBlankPrompt(null)}
        />
      )}

      <PixelDialog
        open={exchangeOpen}
        onOpenChange={setExchangeOpen}
        title="Exchange tiles"
        footer={
          <>
            <PixelButton variant="ghost" size="sm" onClick={() => setExchangeOpen(false)}>
              Cancel
            </PixelButton>
            <PixelButton
              variant="primary"
              size="sm"
              disabled={exchangeSelection.length === 0}
              onClick={submitExchange}
            >
              Exchange {exchangeSelection.length > 0 ? exchangeSelection.length : ''}
            </PixelButton>
          </>
        }
      >
        <p className="mb-3 text-[12px] text-pa-ink-dim">
          Pick the tiles to trade back into the bag for fresh ones.
        </p>
        <div className="flex flex-wrap gap-2">
          {rack.map((letter, i) => {
            const on = exchangeSelection.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() =>
                  setExchangeSelection((prev) =>
                    on ? prev.filter((x) => x !== i) : [...prev, i],
                  )
                }
                className={cn(
                  'border-2 pa-press',
                  on ? 'border-pa-cyan' : 'border-pa-border',
                )}
              >
                <Tile letter={letter} isBlank={letter === BLANK} pending={false} />
              </button>
            );
          })}
        </div>
      </PixelDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Tile({ letter, isBlank, pending }: { letter: string; isBlank: boolean; pending: boolean }) {
  const value = letterValue(letter, isBlank);
  return (
    <span
      className={cn(
        // pa-shadow is the darkest token; using it for glyph colour on the
        // amber tile maximises contrast on a busy board on mobile-sized
        // viewports. bg-pa-surface stays as a fallback for the rare case the
        // --color-pa-amber custom property is missing.
        'relative flex h-full w-full items-center justify-center bg-pa-surface text-pa-shadow',
        // Pending tiles keep full contrast; the dashed cyan outline is the
        // sole cue that the placement is provisional.
        pending && 'outline outline-2 outline-dashed outline-pa-cyan -outline-offset-2',
      )}
      style={{ backgroundColor: 'var(--color-pa-amber)' }}
    >
      <span
        className="font-display"
        // Bumped the mobile floor from 10 → 12px and tightened the cap to
        // 18px so rack tiles stay readable without overflowing board cells.
        style={{ fontSize: 'clamp(12px, 2.8vw, 18px)' }}
      >
        {letter}
      </span>
      {value > 0 && (
        <span
          className="absolute bottom-[1px] right-[2px] tabular text-pa-shadow"
          // Score digit floor raised 6 → 8px so the corner value is legible
          // on a phone screen where the tile is ~25-32px square.
          style={{ fontSize: 'clamp(8px, 1.4vw, 10px)' }}
        >
          {value}
        </span>
      )}
    </span>
  );
}

function Rack({
  rack,
  usedIndexes,
  selected,
  onSelect,
  disabled,
}: {
  rack: string[];
  usedIndexes: Set<number>;
  selected: number | null;
  onSelect: (index: number | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 border-2 border-pa-border bg-pa-surface p-2">
      {rack.map((letter, i) => {
        const used = usedIndexes.has(i);
        return (
          <button
            key={i}
            type="button"
            disabled={disabled || used}
            onClick={() => onSelect(selected === i ? null : i)}
            className={cn(
              'h-11 w-11 border-2 pa-press disabled:cursor-not-allowed',
              used ? 'opacity-25 border-pa-border' : selected === i ? 'border-pa-cyan' : 'border-pa-border',
            )}
          >
            {!used && <Tile letter={letter} isBlank={letter === BLANK} pending={false} />}
          </button>
        );
      })}
      {rack.length === 0 && <span className="text-[12px] text-pa-ink-dim py-2">Empty rack</span>}
    </div>
  );
}

const ALPHABET = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

function BlankLetterPicker({
  onPick,
  onCancel,
}: {
  onPick: (letter: string) => void;
  onCancel: () => void;
}) {
  return (
    <PixelDialog open onOpenChange={(v) => !v && onCancel()} title="Choose a letter for the blank">
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-7">
        {ALPHABET.map((letter) => (
          <PixelButton key={letter} variant="ghost" size="sm" onClick={() => onPick(letter)}>
            {letter}
          </PixelButton>
        ))}
      </div>
    </PixelDialog>
  );
}

function TurnBanner({
  view,
  nameOf,
  seatOf,
  youId,
  turnEndsAt,
}: {
  view: ScrabbleView;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
  youId: string | null;
  turnEndsAt: number | null;
}) {
  if (view.turnPhase === 'game_over') {
    return (
      <PixelCard className="flex items-center justify-between">
        <span className="font-display text-[13px] text-pa-cyan">
          {view.winner ? `${nameOf(view.winner)} wins` : 'Game over'}
        </span>
      </PixelCard>
    );
  }

  const current = view.current;
  const isYou = current === youId;

  return (
    <PixelCard className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {current && (
          <SeatAvatar seat={seatOf(current)} displayName={nameOf(current)} size={28} />
        )}
        <span className="truncate text-[13px]">
          {isYou ? 'Your turn' : current ? `${nameOf(current)}'s turn` : 'Waiting'}
        </span>
      </div>
      {isYou && turnEndsAt && <Countdown endsAt={turnEndsAt} />}
    </PixelCard>
  );
}
