import * as React from 'react';
import { cn } from '../ui/cn.js';
import { SEAT_COLORS } from '../ui/seat.js';
import { sfx } from '../ui/sound.js';

interface Cell {
  x: number;
  y: number;
}

/** The straight 8-direction line between two cells, or empty if they don't form one. */
function computeLine(anchor: Cell, hover: Cell, size: number): Set<number> {
  const dx = Math.sign(hover.x - anchor.x);
  const dy = Math.sign(hover.y - anchor.y);
  const straight =
    hover.x === anchor.x ||
    hover.y === anchor.y ||
    Math.abs(hover.x - anchor.x) === Math.abs(hover.y - anchor.y);
  if (!straight) return new Set<number>();
  const len = Math.max(Math.abs(hover.x - anchor.x), Math.abs(hover.y - anchor.y)) + 1;
  const cells = new Set<number>();
  for (let k = 0; k < len; k++) {
    cells.add((anchor.y + dy * k) * size + (anchor.x + dx * k));
  }
  return cells;
}

/**
 * Pointer-drag selects a straight line in one of eight directions. The server
 * decides whether the selection is a word — the client never knows where they
 * are hidden. `onSelect` resolves with the word that selection completed, or
 * null when it didn't match an unfound word; a cell is only ever permanently
 * tinted once the server confirms a find, so a stray tap or a wrong guess
 * always clears itself instead of leaving a "stuck" highlighted cell behind.
 */
export function WordSearchBoard({
  size,
  grid,
  words,
  found,
  onSelect,
  disabled,
}: {
  size: number;
  grid: string[];
  words: string[];
  found: string[];
  onSelect: (y1: number, x1: number, y2: number, x2: number) => Promise<string | null>;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = React.useState<Cell | null>(null);
  const [hover, setHover] = React.useState<Cell | null>(null);
  /** Cells of words already confirmed found, tinted per word. */
  const [highlights, setHighlights] = React.useState<Record<number, string>>({});

  const inLine = React.useMemo(() => {
    if (!anchor || !hover) return new Set<number>();
    return computeLine(anchor, hover, size);
  }, [anchor, hover, size]);

  const finish = React.useCallback((): void => {
    if (!anchor || !hover || disabled) {
      setAnchor(null);
      setHover(null);
      return;
    }
    if (anchor.x === hover.x && anchor.y === hover.y) {
      // A press-and-release with no drag in between: leave the anchor armed
      // instead of submitting a length-1 non-word. This is what makes the
      // "tap start, then tap end" accessible mode work — the next tap picks
      // the end cell (see onPointerDown below) instead of starting over.
      return;
    }
    const submittedAnchor = anchor;
    const submittedHover = hover;
    const cells = computeLine(submittedAnchor, submittedHover, size);
    setAnchor(null);
    setHover(null);

    void onSelect(submittedAnchor.y, submittedAnchor.x, submittedHover.y, submittedHover.x).then(
      (word) => {
        if (!word) {
          sfx.wrong();
          return; // wrong guess or a repeat — nothing to tint, selection just clears
        }
        sfx.correct();
        const colourIndex = words.indexOf(word);
        const colour = SEAT_COLORS[(colourIndex >= 0 ? colourIndex : 0) % SEAT_COLORS.length] as string;
        setHighlights((prev) => {
          const next = { ...prev };
          for (const cell of cells) next[cell] = colour;
          return next;
        });
      },
    );
  }, [anchor, hover, disabled, size, words, onSelect]);

  React.useEffect(() => {
    window.addEventListener('pointerup', finish);
    return () => window.removeEventListener('pointerup', finish);
  }, [finish]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div
        className="inline-grid select-none no-select border-2 border-pa-ink bg-pa-bg touch-none"
        style={{
          // Use the width the grid actually has; a flat vw fraction left a
          // 15x15 board at 20px a cell on a phone with room for 24.
          gridTemplateColumns: `repeat(${size}, clamp(16px, calc(min(92vw, 620px) / ${size}), 34px))`,
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMove={(e) => {
          // Fallback for touch browsers that keep routing pointermove to the
          // element under the finger's initial contact point instead of
          // firing pointerenter on the cells crossed while dragging.
          if (!anchor) return;
          const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
          const cellEl = el?.closest('[data-cell-x]') as HTMLElement | null;
          if (!cellEl) return;
          const cx = Number(cellEl.dataset.cellX);
          const cy = Number(cellEl.dataset.cellY);
          if (Number.isNaN(cx) || Number.isNaN(cy)) return;
          setHover((prev) => (prev && prev.x === cx && prev.y === cy ? prev : { x: cx, y: cy }));
        }}
      >
        {grid.map((letter, index) => {
          const x = index % size;
          const y = Math.floor(index / size);
          const selected = inLine.has(index);
          const tint = highlights[index];
          return (
            <button
              key={index}
              type="button"
              aria-label={`${letter} at row ${y + 1} column ${x + 1}`}
              data-cell-x={x}
              data-cell-y={y}
              className={cn(
                'aspect-square flex items-center justify-center border border-pa-border/50 cursor-pointer no-select',
                'text-[clamp(10px,2.4vw,16px)] font-semibold tabular',
                selected && 'bg-pa-cyan text-pa-bg',
              )}
              style={!selected && tint ? { backgroundColor: tint, color: '#0b0d17' } : undefined}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                if (disabled) return;
                // Without releasing the implicit touch capture, pointerenter
                // never fires on the cells the finger crosses, so a word can
                // never be swiped out on a phone.
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                sfx.blip();
                if (anchor && anchor.x === x && anchor.y === y) {
                  // Tapping an already-armed anchor again cancels it.
                  setAnchor(null);
                  setHover(null);
                  return;
                }
                if (anchor) {
                  // An anchor is already armed from a prior tap (click-to-select
                  // mode): this tap — or the start of a drag — chooses the end
                  // cell. `finish()` submits it on release since anchor !== hover.
                  setHover({ x, y });
                  return;
                }
                setAnchor({ x, y });
                setHover({ x, y });
              }}
              onPointerEnter={() => {
                if (anchor) setHover({ x, y });
              }}
            >
              {letter}
            </button>
          );
        })}
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 lg:block min-w-[10rem]">
        {words.map((word) => {
          const done = found.includes(word);
          return (
            <li
              key={word}
              className={cn(
                'text-[14px] tabular',
                done ? 'line-through text-pa-ink-dim' : 'text-pa-ink',
              )}
            >
              {word}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
