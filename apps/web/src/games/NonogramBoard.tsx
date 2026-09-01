import * as React from 'react';
import { cn } from '../ui/cn.js';
import { sfx } from '../ui/sound.js';
const FILLED = 1;
const CROSSED = 2;

/**
 * Left-click fills, right-click crosses, click-drag paints a line. Clue groups
 * grey out when the line already satisfies them. On touch there is no right
 * button, so the same choice is offered as a mode toggle.
 */
export function NonogramBoard({
  size,
  rowClues,
  colClues,
  marks,
  onCommit,
  disabled,
  solution,
}: {
  size: number;
  rowClues: number[][];
  colClues: number[][];
  marks: number[];
  onCommit: (row: number, col: number, value: number) => void;
  disabled?: boolean;
  solution?: boolean[] | null;
}) {
  const painting = React.useRef<{ value: number; axis: 'row' | 'col' | null; from: number } | null>(
    null,
  );
  /** Touch has no right button; this is how a phone places crosses. */
  const [crossMode, setCrossMode] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);

  const paint = (index: number, value: number): void => {
    if (disabled) return;
    if (value === FILLED) sfx.pop();
    else if (value === CROSSED) sfx.cross();
    else sfx.clear();
    onCommit(Math.floor(index / size), index % size, value);
  };
  const runsOf = (line: boolean[]): number[] => {
    const runs: number[] = [];
    let run = 0;
    for (const on of line) {
      if (on) run++;
      else if (run > 0) {
        runs.push(run);
        run = 0;
      }
    }
    if (run > 0) runs.push(run);
    return runs.length ? runs : [0];
  };

  /** A clue line is satisfied when the painted runs already match it exactly. */
  const rowSatisfied = (r: number): boolean => {
    const line: boolean[] = [];
    for (let c = 0; c < size; c++) line.push((marks[r * size + c] ?? 0) === FILLED);
    return JSON.stringify(runsOf(line)) === JSON.stringify(rowClues[r] ?? [0]);
  };
  const colSatisfied = (c: number): boolean => {
    const line: boolean[] = [];
    for (let r = 0; r < size; r++) line.push((marks[r * size + c] ?? 0) === FILLED);
    return JSON.stringify(runsOf(line)) === JSON.stringify(colClues[c] ?? [0]);
  };

  React.useEffect(() => {
    const stop = (): void => {
      painting.current = null;
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const maxRowClue = Math.max(...rowClues.map((c) => c.length), 1);
  const maxColClue = Math.max(...colClues.map((c) => c.length), 1);
  // Size the cells from the width actually left over after the clue gutter,
  // rather than a flat fraction of the viewport that leaves a phone with a
  // grid noticeably narrower than the space it has.
  const gutterPx = maxRowClue * 12 + 8;
  const cellPx = `clamp(12px, calc((min(92vw, 560px) - ${gutterPx}px) / ${size}), 30px)`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              sfx.blip();
              setCrossMode((v) => !v);
            }}
            aria-pressed={crossMode}
            className={cn(
              'font-display text-[10px] uppercase border-2 px-3 min-h-[44px] pa-shadow-sm cursor-pointer',
              crossMode ? 'border-pa-amber text-pa-amber' : 'border-pa-border text-pa-ink-dim',
            )}
          >
            {crossMode ? 'Marking ×' : 'Filling'}
          </button>
        </div>
        <span className="text-[11px] text-pa-ink-dim font-mono bg-pa-surface px-2 py-1 border border-pa-border/70">
          Arrows/WASD · Space/Z (Fill) · X/C (Cross) · Del (Clear)
        </span>
      </div>

    <div
      role="grid"
      tabIndex={0}
      aria-label="Nonogram grid"
      onKeyDown={(e) => {
        const row = Math.floor(cursor / size);
        const col = cursor % size;
        const key = e.key;
        const keyLower = key.toLowerCase();

        if (key === 'ArrowUp' || keyLower === 'w') setCursor(((row + size - 1) % size) * size + col);
        else if (key === 'ArrowDown' || keyLower === 's') setCursor(((row + 1) % size) * size + col);
        else if (key === 'ArrowLeft' || keyLower === 'a') setCursor(row * size + ((col + size - 1) % size));
        else if (key === 'ArrowRight' || keyLower === 'd') setCursor(row * size + ((col + 1) % size));
        else if (key === ' ' || key === 'Enter' || keyLower === 'z') {
          const current = marks[cursor] ?? 0;
          paint(cursor, current === FILLED ? 0 : FILLED);
        } else if (keyLower === 'x' || keyLower === 'c') {
          const current = marks[cursor] ?? 0;
          paint(cursor, current === CROSSED ? 0 : CROSSED);
        } else if (key === 'Backspace' || key === 'Delete' || key === '0') {
          paint(cursor, 0);
        } else if (keyLower === 'p' || keyLower === 'm') {
          sfx.blip();
          setCrossMode((v) => !v);
        } else return;
        e.preventDefault();
      }}
      className="inline-grid select-none no-select touch-none outline-none"
      style={{
        gridTemplateColumns: `auto repeat(${size}, ${cellPx})`,
        gridTemplateRows: `auto repeat(${size}, ${cellPx})`,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* corner */}
      <div />

      {/* column clues */}
      {Array.from({ length: size }, (_, c) => (
        <div
          key={`cc${c}`}
          className={cn(
            'flex flex-col items-center justify-end gap-[1px] pb-1 text-[10px] tabular',
            colSatisfied(c) ? 'text-pa-ink-dim/40' : 'text-pa-ink',
          )}
          style={{ minHeight: `${maxColClue * 12 + 6}px` }}
        >
          {(colClues[c] ?? []).map((n, i) => (
            <span key={i}>{n}</span>
          ))}
        </div>
      ))}

      {Array.from({ length: size }, (_, r) => (
        <React.Fragment key={`r${r}`}>
          {/* row clues */}
          <div
            className={cn(
              'flex items-center justify-end gap-1 pr-2 text-[10px] tabular',
              rowSatisfied(r) ? 'text-pa-ink-dim/40' : 'text-pa-ink',
            )}
            style={{ minWidth: `${maxRowClue * 12 + 8}px` }}
          >
            {(rowClues[r] ?? []).map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>

          {Array.from({ length: size }, (_, c) => {
            const index = r * size + c;
            const mark = marks[index] ?? 0;
            const isCursor = cursor === index;
            const wrong =
              solution && ((mark === FILLED) !== Boolean(solution[index]));
            return (
              <button
                key={c}
                type="button"
                role="gridcell"
                aria-label={`Row ${r + 1} column ${c + 1}`}
                onClick={() => setCursor(index)}
                className={cn(
                  'relative border cursor-pointer no-select',
                  c % 5 === 0 && c !== 0 && 'border-l-2 border-l-pa-ink',
                  r % 5 === 0 && r !== 0 && 'border-t-2 border-t-pa-ink',
                  isCursor && 'ring-2 ring-pa-amber ring-inset z-10',
                  mark === FILLED
                    ? 'bg-pa-cyan border-pa-cyan'
                    : 'bg-pa-bg border-pa-border/60',
                  solution && wrong && 'outline outline-2 outline-pa-danger -outline-offset-2',
                )}
                onPointerDown={(e) => {
                  if (disabled) return;
                  // landed on, which stops pointerenter firing anywhere else —
                  // and drag-painting with it. Releasing it restores the drag.
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  const cross = e.button === 2 || e.ctrlKey || crossMode;
                  const value = cross
                    ? mark === CROSSED
                      ? 0
                      : CROSSED
                    : mark === FILLED
                      ? 0
                      : FILLED;
                  painting.current = { value, axis: null, from: index };
                  paint(index, value);
                }}
                onPointerEnter={() => {
                  // Drag paints along a single straight line.
                  const state = painting.current;
                  if (!state) return;
                  const fromRow = Math.floor(state.from / size);
                  const fromCol = state.from % size;
                  if (!state.axis) {
                    if (r === fromRow && c !== fromCol) state.axis = 'row';
                    else if (c === fromCol && r !== fromRow) state.axis = 'col';
                  }
                  if (state.axis === 'row' && r !== fromRow) return;
                  if (state.axis === 'col' && c !== fromCol) return;
                  paint(index, state.value);
                }}
              >
                {mark === CROSSED && (
                  <span className="block text-pa-ink-dim text-[10px] leading-none">×</span>
                )}
              </button>
            );
          })}
        </React.Fragment>
      ))}
    </div>
    </div>
  );
}
