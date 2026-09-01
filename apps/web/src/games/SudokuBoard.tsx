import * as React from 'react';
import { cn } from '../ui/cn.js';
import { sfx } from '../ui/sound.js';
export interface KillerCage {
  id: number;
  cells: number[];
  sum: number;
}

/**
 * Cage fills. Low alpha so the cursor and same-value highlights still read
 * through, and six of them so the greedy colouring never runs out on a planar
 * map (four would do; the margin costs nothing).
 */
const CAGE_TINTS = [
  'rgba(34, 224, 255, 0.13)',
  'rgba(255, 63, 142, 0.13)',
  'rgba(157, 255, 60, 0.13)',
  'rgba(255, 176, 32, 0.13)',
  'rgba(139, 92, 246, 0.18)',
  'rgba(232, 236, 255, 0.10)',
] as const;

/** The cage outline and sum. Amber is used by nothing else on the grid. */
const CAGE_LINE = '#ffb020';

/**
 * 9x9 board for Sudoku and Killer Sudoku. Conflict highlighting is computed
 * from the VISIBLE grid only — never from the solution, which the client does
 * not have until the room ends.
 */
export function SudokuBoard({
  givens,
  board,
  cages,
  onCommit,
  disabled,
  wrongCells,
  solution,
}: {
  givens: number[];
  board: number[];
  cages?: KillerCage[];
  onCommit: (row: number, col: number, value: number) => void;
  disabled?: boolean;
  /** Results view: the player's own wrong cells, outlined in danger. */
  wrongCells?: Set<number>;
  solution?: number[] | null;
}) {
  const [cursor, setCursor] = React.useState(0);
  const [pencil, setPencil] = React.useState(false);
  const [marks, setMarks] = React.useState<Record<number, Set<number>>>({});

  const cageOf = React.useMemo(() => {
    const map = new Map<number, KillerCage>();
    for (const cage of cages ?? []) for (const cell of cage.cells) map.set(cell, cage);
    return map;
  }, [cages]);

  /**
   * Which sides of each cell sit on the edge of its cage. Drawing a full box
   * per cell — the obvious approach — renders a mesh of little squares that
   * says nothing about where one cage ends and the next begins. Only the
   * perimeter carries the shape.
   */
  const cageEdges = React.useMemo(() => {
    const map = new Map<number, { t: boolean; r: boolean; b: boolean; l: boolean }>();
    if (!cages?.length) return map;
    for (let i = 0; i < 81; i++) {
      const cage = cageOf.get(i);
      if (!cage) continue;
      const row = Math.floor(i / 9);
      const col = i % 9;
      const same = (j: number | null): boolean => j !== null && cageOf.get(j)?.id === cage.id;
      map.set(i, {
        t: !same(row > 0 ? i - 9 : null),
        b: !same(row < 8 ? i + 9 : null),
        l: !same(col > 0 ? i - 1 : null),
        r: !same(col < 8 ? i + 1 : null),
      });
    }
    return map;
  }, [cageOf, cages]);

  /**
   * A faint fill per cage, greedily coloured so no two touching cages share a
   * tint. The outline alone leaves ambiguity where cages meet at a corner;
   * with the fill, the shape of every cage is readable at a glance.
   */
  const cageTint = React.useMemo(() => {
    const tint = new Map<number, number>();
    if (!cages?.length) return tint;

    const adjacent = new Map<number, Set<number>>();
    const link = (a: number, b: number): void => {
      if (!adjacent.has(a)) adjacent.set(a, new Set());
      if (!adjacent.has(b)) adjacent.set(b, new Set());
      adjacent.get(a)?.add(b);
      adjacent.get(b)?.add(a);
    };
    for (let i = 0; i < 81; i++) {
      const a = cageOf.get(i);
      if (!a) continue;
      const row = Math.floor(i / 9);
      const col = i % 9;
      for (const j of [row < 8 ? i + 9 : null, col < 8 ? i + 1 : null]) {
        if (j === null) continue;
        const b = cageOf.get(j);
        if (b && b.id !== a.id) link(a.id, b.id);
      }
    }

    for (const cage of [...cages].sort((x, y) => x.id - y.id)) {
      const taken = new Set(
        [...(adjacent.get(cage.id) ?? [])].map((n) => tint.get(n)).filter((v) => v !== undefined),
      );
      let colour = 0;
      while (taken.has(colour)) colour++;
      tint.set(cage.id, colour % CAGE_TINTS.length);
    }
    return tint;
  }, [cages, cageOf]);

  // Conflicts, from the visible board alone.
  const conflicts = React.useMemo(() => {
    const bad = new Set<number>();
    for (let i = 0; i < 81; i++) {
      const v = board[i] ?? 0;
      if (v === 0) continue;
      for (let j = i + 1; j < 81; j++) {
        if ((board[j] ?? 0) !== v) continue;
        const sameRow = Math.floor(i / 9) === Math.floor(j / 9);
        const sameCol = i % 9 === j % 9;
        const sameBox =
          Math.floor(Math.floor(i / 9) / 3) === Math.floor(Math.floor(j / 9) / 3) &&
          Math.floor((i % 9) / 3) === Math.floor((j % 9) / 3);
        if (sameRow || sameCol || sameBox) {
          bad.add(i);
          bad.add(j);
        }
      }
    }
    return bad;
  }, [board]);

  const write = (index: number, value: number): void => {
    if (disabled) return;
    if ((givens[index] ?? 0) !== 0) return;
    if (pencil && value !== 0) {
      sfx.pencil();
      setMarks((prev) => {
        const next = new Set(prev[index] ?? []);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return { ...prev, [index]: next };
      });
      return;
    }
    if (value === 0) {
      sfx.clear();
    } else {
      sfx.pop();
    }
    onCommit(Math.floor(index / 9), index % 9, value);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const row = Math.floor(cursor / 9);
    const col = cursor % 9;
    const key = e.key;
    const keyLower = key.toLowerCase();

    if (key === 'ArrowUp' || keyLower === 'w') setCursor(((row + 8) % 9) * 9 + col);
    else if (key === 'ArrowDown' || keyLower === 's') setCursor(((row + 1) % 9) * 9 + col);
    else if (key === 'ArrowLeft' || keyLower === 'a') setCursor(row * 9 + ((col + 8) % 9));
    else if (key === 'ArrowRight' || keyLower === 'd') setCursor(row * 9 + ((col + 1) % 9));
    else if (/^[1-9]$/.test(key)) write(cursor, Number(key));
    else if (/^Numpad[1-9]$/.test(e.code)) write(cursor, Number(e.code.replace('Numpad', '')));
    else if (key === 'Backspace' || key === 'Delete' || key === '0' || keyLower === 'c' || keyLower === 'x' || e.code === 'Numpad0') {
      write(cursor, 0);
    } else if (keyLower === 'p' || key === ' ') {
      sfx.blip();
      setPencil((p) => !p);
    } else return;
    e.preventDefault();
  };

  const selectedValue = board[cursor] ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => {
            sfx.blip();
            setPencil((p) => !p);
          }}
          className={cn(
            'font-display text-[10px] uppercase border-2 px-3 min-h-[44px] pa-shadow-sm cursor-pointer',
            pencil ? 'border-pa-amber text-pa-amber' : 'border-pa-border text-pa-ink-dim',
          )}
          aria-pressed={pencil}
        >
          Pencil {pencil ? 'on' : 'off'}
        </button>
        <span className="text-[11px] text-pa-ink-dim font-mono bg-pa-surface px-2 py-1 border border-pa-border/70 rounded-none">
          Arrows/WASD · 1-9 (Numpad) · Space/P (Pencil) · Del/C (Clear)
        </span>
      </div>
      {(cages?.length ?? 0) > 0 && (
        <p className="flex items-center gap-2 text-[12px] text-pa-ink-dim">
          <span
            className="inline-block h-4 w-6 shrink-0"
            style={{ border: `2px dashed ${CAGE_LINE}`, backgroundColor: CAGE_TINTS[0] }}
          />
          Each shaded cage adds up to its corner number, with no digit repeated inside it.
        </p>
      )}

      <div
        role="grid"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Sudoku grid"
        className="grid grid-cols-9 border-2 border-pa-ink bg-pa-bg w-full max-w-[min(92vw,560px)] aspect-square outline-none no-select touch-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {Array.from({ length: 81 }, (_, i) => {
          const row = Math.floor(i / 9);
          const col = i % 9;
          const value = board[i] ?? 0;
          const cage = cageOf.get(i);
          const edges = cageEdges.get(i);
          const cageStart = cage && Math.min(...cage.cells) === i;
          const isCursor = cursor === i;
          const conflicted = conflicts.has(i);
          const wrong = wrongCells?.has(i);
          const sameValue = value !== 0 && value === selectedValue && !isCursor;

          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              aria-label={`Row ${row + 1} column ${col + 1}${value ? `, ${value}` : ', empty'}`}
              onClick={() => setCursor(i)}
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                'relative flex items-center justify-center border border-pa-border/60 cursor-pointer no-select',
                // Heavier lines on the 3x3 box seams.
                row % 3 === 0 && row !== 0 && 'border-t-2 border-t-pa-ink',
                isCursor && 'bg-pa-surface-2',
                sameValue && 'bg-pa-surface',
                'text-pa-ink',
                conflicted && 'text-pa-danger',
                wrong && 'outline outline-2 outline-pa-danger -outline-offset-2',
              )}
              style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}
            >
              {/* Killer cages: a tinted fill, a dashed outline on the cage
                  perimeter only, and the sum on a chip in the top-left cell. */}
              {cage && (
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{ backgroundColor: CAGE_TINTS[cageTint.get(cage.id) ?? 0] }}
                />
              )}
              {edges && (
                <span
                  className="pointer-events-none absolute inset-[3px]"
                  style={{
                    borderStyle: 'dashed',
                    borderColor: CAGE_LINE,
                    borderTopWidth: edges.t ? 2 : 0,
                    borderRightWidth: edges.r ? 2 : 0,
                    borderBottomWidth: edges.b ? 2 : 0,
                    borderLeftWidth: edges.l ? 2 : 0,
                  }}
                />
              )}
              {cageStart && (
                <span
                  className="pointer-events-none absolute left-[4px] top-[3px] px-[2px] font-display text-[9px] leading-[1.2] tabular"
                  style={{ color: CAGE_LINE, backgroundColor: 'var(--color-pa-bg)' }}
                >
                  {cage?.sum}
                </span>
              )}

              {value !== 0 ? (
                <span
                  className="tabular"
                  style={{ fontSize: 'clamp(14px, 3.6vw, 20px)', lineHeight: 1 }}
                >
                  {value}
                </span>
              ) : (marks[i]?.size ?? 0) > 0 ? (
                <div className="grid grid-cols-3 grid-rows-3 place-items-center w-full h-full text-pa-ink-dim tabular">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <span key={n} style={{ fontSize: 'clamp(10px, 2.6vw, 12px)', lineHeight: 1 }}>
                      {marks[i]?.has(n) ? n : ''}
                    </span>
                  ))}
                </div>
              ) : null}

              {solution && wrong && (
                <span className="pointer-events-none absolute bottom-[1px] right-[2px] text-[9px] text-pa-success tabular">
                  {solution[i]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/*
        Ten across only once there is room for it. On a phone that gave every
        key 32px of box for a 44px target, and clipped the "Clr" label outright;
        five across puts the keys at ~68px on the same screen.
      */}
      <div
        className="grid w-full max-w-[min(92vw,560px)] grid-cols-5 gap-1 sm:grid-cols-10 no-select touch-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => write(cursor, n)}
            onContextMenu={(e) => e.preventDefault()}
            className="font-display text-[14px] sm:text-[12px] border-2 border-pa-border min-h-[48px] sm:min-h-[44px] pa-shadow-sm pa-press bg-pa-surface cursor-pointer no-select"
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => write(cursor, 0)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Clear cell"
          className="font-display text-[10px] border-2 border-pa-border min-h-[48px] sm:min-h-[44px] pa-shadow-sm pa-press bg-pa-surface cursor-pointer no-select"
        >
          Clr
        </button>
      </div>
    </div>
  );
}
