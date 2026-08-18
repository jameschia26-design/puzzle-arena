import * as React from 'react';
import { manorMysteryRules } from '@puzzle-arena/games';
import { ROOMS, SUSPECTS, WEAPONS, type PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelCard, PixelDialog, PixelSelect } from '../ui/primitives.js';

const { GRID, ROOM_RECTS, SUSPECT_COLORS, DOORS_BY_ROOM, roomAt } = manorMysteryRules;

interface MMView {
  phase: string;
  current: string | null;
  players: {
    id: string;
    seat: number;
    suspect: string;
    handSize: number;
    position: { room: string | null; x: number; y: number };
    lockedOut: boolean;
  }[];
  suspectPositions: Record<string, { room: string | null; x: number; y: number }>;
  weaponPositions: Record<string, string>;
  dice: [number, number] | null;
  roll: number | null;
  history: {
    suggester: string;
    suspect: string;
    weapon: string;
    room: string;
    refutedBy: string | null;
  }[];
  winner: string | null;
  you: {
    id: string;
    hand: string[];
    eliminated: string[];
    revelations: { card: string; from: string }[];
    reachableCells: [number, number][];
    reachableRooms: string[];
    mustRefute: { suspect: string; weapon: string; room: string; options: string[] } | null;
  } | null;
}

export function ManorMysteryBoard({
  view,
  players,
  youId,
  roomId,
  legalActions,
  onAction,
}: {
  view: MMView;
  players: PlayerView[];
  youId: string | null;
  roomId: string;
  legalActions: string[];
  onAction: (action: unknown) => void;
}) {
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [accuseOpen, setAccuseOpen] = React.useState(false);
  const [suspect, setSuspect] = React.useState<string>(SUSPECTS[0]);
  const [weapon, setWeapon] = React.useState<string>(WEAPONS[0]);
  const [accuseRoom, setAccuseRoom] = React.useState<string>(ROOMS[0]);

  const can = (action: string): boolean => legalActions.includes(action);
  const nameOf = (id: string): string =>
    players.find((p) => p.id === id)?.displayName ?? id.slice(0, 6);
  const seatOf = (id: string): number => players.find((p) => p.id === id)?.seat ?? 0;

  const reachableCells = new Set(
    (view.you?.reachableCells ?? []).map(([x, y]) => `${x},${y}`),
  );
  const reachableRooms = new Set(view.you?.reachableRooms ?? []);

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      {/* ------------------------------ board ------------------------------ */}
      <div
        className="relative w-full max-w-[min(94vw,680px)] aspect-square border-2 border-pa-ink bg-pa-bg"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID}, 1fr)`,
          gridTemplateRows: `repeat(${GRID}, 1fr)`,
        }}
      >
        {/* corridor lattice + reachable cells */}
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const x = i % GRID;
          const y = Math.floor(i / GRID);
          if (roomAt(x, y)) return null;
          const key = `${x},${y}`;
          const reachable = reachableCells.has(key);
          return (
            <button
              key={key}
              type="button"
              style={{ gridColumn: x + 1, gridRow: y + 1 }}
              disabled={!reachable}
              onClick={() => onAction({ type: 'move', x, y })}
              aria-label={`Corridor ${x}, ${y}`}
              className={cn(
                'relative border border-pa-border/25',
                // A corridor square is ~14px on a phone, which is not a tap
                // target. Reachable ones grow an invisible pad around
                // themselves so a near-miss still lands on a legal move; the
                // pad is deliberately small, since every reachable neighbour
                // is also a legal destination and should not be stolen.
                reachable
                  ? 'z-10 bg-pa-cyan/50 cursor-pointer hover:bg-pa-cyan after:absolute after:-inset-[5px] after:content-[""]'
                  : 'cursor-default',
              )}
            />
          );
        })}

        {/* rooms */}
        {ROOM_RECTS.map((rect) => {
          const enterable = reachableRooms.has(rect.name);
          const door = DOORS_BY_ROOM[rect.name]?.[0];
          const weaponsHere = WEAPONS.filter((w) => view.weaponPositions[w] === rect.name);
          const suspectsHere = SUSPECTS.filter(
            (s) => view.suspectPositions[s]?.room === rect.name,
          );
          return (
            <button
              key={rect.name}
              type="button"
              disabled={!enterable}
              onClick={() => door && onAction({ type: 'move', x: door.x, y: door.y })}
              style={{
                gridColumn: `${rect.x0 + 1} / ${rect.x1 + 2}`,
                gridRow: `${rect.y0 + 1} / ${rect.y1 + 2}`,
              }}
              className={cn(
                'border-2 flex flex-col items-center justify-center gap-1 p-1 overflow-hidden',
                enterable
                  ? 'border-pa-cyan bg-pa-cyan/20 cursor-pointer'
                  : 'border-pa-border bg-pa-surface cursor-default',
              )}
            >
              <span className="font-display text-[7px] md:text-[8px] text-center leading-tight">
                {rect.name}
              </span>
              <span className="flex flex-wrap justify-center gap-[2px]">
                {suspectsHere.map((s) => (
                  <span
                    key={s}
                    title={s}
                    className="h-3 w-3 border border-pa-shadow"
                    style={{ backgroundColor: SUSPECT_COLORS[s] }}
                  />
                ))}
              </span>
              <span className="text-[7px] text-pa-ink-dim text-center leading-tight">
                {weaponsHere.join(', ')}
              </span>
            </button>
          );
        })}

        {/* suspect tokens standing in corridors */}
        {SUSPECTS.filter((s) => !view.suspectPositions[s]?.room).map((s) => {
          const pos = view.suspectPositions[s];
          if (!pos) return null;
          return (
            <span
              key={s}
              title={s}
              style={{
                gridColumn: pos.x + 1,
                gridRow: pos.y + 1,
                backgroundColor: SUSPECT_COLORS[s],
              }}
              className="border border-pa-shadow z-10"
            />
          );
        })}
      </div>

      {/* ---------------------------- dashboard ---------------------------- */}
      <div className="flex flex-col gap-3 xl:w-[360px]">
        <PixelCard className="p-3 flex flex-wrap gap-2">
          <PixelButton size="sm" disabled={!can('roll')} onClick={() => onAction({ type: 'roll' })}>
            Roll {view.roll ? `(${view.roll})` : ''}
          </PixelButton>
          <PixelButton
            size="sm"
            variant="secondary"
            disabled={!can('useSecretPassage')}
            onClick={() => onAction({ type: 'useSecretPassage' })}
          >
            Passage
          </PixelButton>
          <PixelButton
            size="sm"
            variant="secondary"
            disabled={!can('suggest')}
            onClick={() => setSuggestOpen(true)}
          >
            Suggest
          </PixelButton>
          <PixelButton
            size="sm"
            variant="danger"
            disabled={!can('accuse')}
            onClick={() => setAccuseOpen(true)}
          >
            Accuse
          </PixelButton>
          <PixelButton
            size="sm"
            variant="ghost"
            disabled={!can('endTurn')}
            onClick={() => onAction({ type: 'endTurn' })}
          >
            End turn
          </PixelButton>
        </PixelCard>

        <PixelCard className="p-3">
          <h3 className="font-display text-[10px] uppercase text-pa-ink-dim mb-2">Your hand</h3>
          <ul className="flex flex-wrap gap-1">
            {(view.you?.hand ?? []).map((card) => (
              <li key={card}>
                <PixelBadge tone="cyan">{card}</PixelBadge>
              </li>
            ))}
          </ul>
        </PixelCard>

        <PixelCard className="p-3">
          <h3 className="font-display text-[10px] uppercase text-pa-ink-dim mb-2">Players</h3>
          <ul className="flex flex-col gap-1">
            {view.players.map((p) => (
              <li
                key={p.id}
                className={cn(
                  'flex items-center gap-2 border-2 p-1',
                  view.current === p.id ? 'border-pa-magenta' : 'border-pa-border',
                  p.lockedOut && 'opacity-50',
                )}
              >
                <span
                  className="h-4 w-4 border border-pa-shadow shrink-0"
                  style={{ backgroundColor: SUSPECT_COLORS[p.suspect] }}
                  title={p.suspect}
                />
                <SeatAvatar seat={seatOf(p.id)} displayName={nameOf(p.id)} size={20} />
                <span className="text-[12px] flex-1 truncate">{nameOf(p.id)}</span>
                <span className="text-[11px] text-pa-ink-dim tabular">{p.handSize} cards</span>
                {p.lockedOut && <PixelBadge tone="danger">Out</PixelBadge>}
              </li>
            ))}
          </ul>
        </PixelCard>

        <Notepad view={view} roomId={roomId} youId={youId} nameOf={nameOf} />
      </div>

      {/* -------------------------- suggestion -------------------------- */}
      <PixelDialog
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        title="Make a suggestion"
        footer={
          <PixelButton
            onClick={() => {
              onAction({ type: 'suggest', suspect, weapon });
              setSuggestOpen(false);
            }}
          >
            Suggest
          </PixelButton>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-pa-ink-dim">
            The room is fixed to where you stand. The named suspect and weapon are moved here.
          </p>
          <PixelSelect
            label="Suspect"
            value={suspect}
            onValueChange={setSuspect}
            options={SUSPECTS.map((s) => ({ value: s, label: s }))}
          />
          <PixelSelect
            label="Weapon"
            value={weapon}
            onValueChange={setWeapon}
            options={WEAPONS.map((w) => ({ value: w, label: w }))}
          />
        </div>
      </PixelDialog>

      {/* --------------------------- accusation --------------------------- */}
      <PixelDialog
        open={accuseOpen}
        onOpenChange={setAccuseOpen}
        title="Make an accusation"
        footer={
          <>
            <PixelButton variant="ghost" onClick={() => setAccuseOpen(false)}>
              Cancel
            </PixelButton>
            <PixelButton
              variant="danger"
              onClick={() => {
                onAction({ type: 'accuse', suspect, weapon, room: accuseRoom });
                setAccuseOpen(false);
              }}
            >
              Accuse — this is final
            </PixelButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-pa-danger">
            A wrong accusation locks you out of moving, suggesting and accusing for the rest of the
            game. You will still have to refute others.
          </p>
          <PixelSelect
            label="Suspect"
            value={suspect}
            onValueChange={setSuspect}
            options={SUSPECTS.map((s) => ({ value: s, label: s }))}
          />
          <PixelSelect
            label="Weapon"
            value={weapon}
            onValueChange={setWeapon}
            options={WEAPONS.map((w) => ({ value: w, label: w }))}
          />
          <PixelSelect
            label="Room"
            value={accuseRoom}
            onValueChange={setAccuseRoom}
            options={ROOMS.map((r) => ({ value: r, label: r }))}
          />
        </div>
      </PixelDialog>

      {/* ------------------- private refutation prompt ------------------- */}
      <PixelDialog
        open={Boolean(view.you?.mustRefute)}
        onOpenChange={() => undefined}
        title="You must refute"
        closable={false}
      >
        {view.you?.mustRefute && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px]">
              {view.you.mustRefute.suspect} · {view.you.mustRefute.weapon} ·{' '}
              {view.you.mustRefute.room}
            </p>
            <p className="text-[13px] text-pa-ink-dim">
              Choose which card to show. Only the suggester sees it.
            </p>
            <div className="flex flex-wrap gap-2">
              {view.you.mustRefute.options.map((card) => (
                <PixelButton key={card} size="sm" onClick={() => onAction({ type: 'refute', card })}>
                  {card}
                </PixelButton>
              ))}
            </div>
          </div>
        )}
      </PixelDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detective notepad                                                   */
/* ------------------------------------------------------------------ */

const ALL_CARDS = [...SUSPECTS, ...WEAPONS, ...ROOMS] as string[];

/**
 * Server-known facts are prefilled and locked; the player's own tri-state marks
 * persist in localStorage keyed by roomId:playerId.
 */
function Notepad({
  view,
  roomId,
  youId,
  nameOf,
}: {
  view: MMView;
  roomId: string;
  youId: string | null;
  nameOf: (id: string) => string;
}): React.ReactElement {
  const storageKey = `pa:notepad:${roomId}:${youId ?? 'anon'}`;
  const [marks, setMarks] = React.useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    } catch {
      return {};
    }
  });

  const known = new Set(view.you?.eliminated ?? []);
  const columns = ['me', ...view.players.filter((p) => p.id !== youId).map((p) => p.id)];

  const cycle = (card: string, column: string): void => {
    const key = `${card}|${column}`;
    const next = { ...marks, [key]: ((marks[key] ?? 0) + 1) % 3 };
    setMarks(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const symbol = (n: number): string => (n === 1 ? '✓' : n === 2 ? '✗' : '');

  return (
    <PixelCard className="p-3">
      <h3 className="font-display text-[10px] uppercase text-pa-ink-dim mb-2">Notepad</h3>
      <div className="overflow-x-auto">
        <table className="text-[11px] w-full">
          <thead>
            <tr>
              <th className="text-left font-normal text-pa-ink-dim">Card</th>
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-1 font-normal text-pa-ink-dim"
                  title={c === 'me' ? 'You' : nameOf(c)}
                >
                  {c === 'me' ? 'Me' : nameOf(c).slice(0, 4)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_CARDS.map((card) => {
              const locked = known.has(card);
              return (
                <tr key={card} className={cn(locked && 'text-pa-ink-dim line-through')}>
                  <td className="pr-2 truncate max-w-[9rem]">{card}</td>
                  {columns.map((c) => {
                    const key = `${card}|${c}`;
                    const isMine = c === 'me' && (view.you?.hand ?? []).includes(card);
                    return (
                      <td key={c} className="text-center">
                        <button
                          type="button"
                          disabled={isMine}
                          onClick={() => cycle(card, c)}
                          className="w-6 h-6 border border-pa-border cursor-pointer disabled:cursor-default"
                        >
                          {isMine ? '✓' : symbol(marks[key] ?? 0)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PixelCard>
  );
}
