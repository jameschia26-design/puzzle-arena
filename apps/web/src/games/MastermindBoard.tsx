import * as React from 'react';
import { motion } from 'framer-motion';
import { Lock, Unlock, ArrowRight, CornerDownLeft, X } from 'lucide-react';
import type { MastermindGuessAck } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { PixelButton } from '../ui/primitives.js';
import { useReducedMotion } from '../ui/motion.js';
import { sfx } from '../ui/sound.js';

/* ------------------------------------------------------------------ */
/* Palette Definition & Glyph SVGs                                    */
/* ------------------------------------------------------------------ */

export interface JewelColor {
  index: number;
  name: string;
  hex: string;
  key: string;
  darkGlyph: boolean;
  renderGlyph: (props: { className?: string; color: string }) => React.ReactElement;
}

export const MASTERMIND_PALETTE: JewelColor[] = [
  {
    index: 0,
    name: 'Ruby Red',
    hex: '#ef4444',
    key: '1',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <circle cx="12" cy="12" r="5" />
      </svg>
    ),
  },
  {
    index: 1,
    name: 'Tangerine',
    hex: '#f97316',
    key: '2',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <polygon points="12,6 18,17 6,17" />
      </svg>
    ),
  },
  {
    index: 2,
    name: 'Topaz',
    hex: '#f59e0b',
    key: '3',
    darkGlyph: true,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" />
      </svg>
    ),
  },
  {
    index: 3,
    name: 'Citrine',
    hex: '#eab308',
    key: '4',
    darkGlyph: true,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <polygon points="12,6 18,12 12,18 6,12" />
      </svg>
    ),
  },
  {
    index: 4,
    name: 'Emerald',
    hex: '#10b981',
    key: '5',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <polygon points="12,6 17,9 17,15 12,18 7,15 7,9" />
      </svg>
    ),
  },
  {
    index: 5,
    name: 'Jade',
    hex: '#14b8a6',
    key: '6',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z" />
      </svg>
    ),
  },
  {
    index: 6,
    name: 'Sapphire',
    hex: '#06b6d4',
    key: '7',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <polygon points="12,5 14,9 19,10 15,14 16,19 12,16 8,19 9,14 5,10 10,9" />
      </svg>
    ),
  },
  {
    index: 7,
    name: 'Cobalt',
    hex: '#3b82f6',
    key: '8',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <path d="M7 8.5L8.5 7 12 10.5 15.5 7 17 8.5 13.5 12 17 15.5 15.5 17 12 13.5 8.5 17 7 15.5 10.5 12z" />
      </svg>
    ),
  },
  {
    index: 8,
    name: 'Amethyst',
    hex: '#8b5cf6',
    key: '9',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="6" stroke={color} strokeWidth="1.8" fill="none" />
        <circle cx="12" cy="12" r="2.5" fill={color} />
      </svg>
    ),
  },
  {
    index: 9,
    name: 'Orchid',
    hex: '#d946ef',
    key: '0',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <path d="M12 4C9.5 7 7 9.8 7 12.5a5 5 0 0 0 8 3.8L13.8 19h-3.6l-1.2-2.7A5 5 0 0 0 17 12.5C17 9.8 14.5 7 12 4z" />
      </svg>
    ),
  },
  {
    index: 10,
    name: 'Rose Quartz',
    hex: '#f43f5e',
    key: '-',
    darkGlyph: false,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <path d="M12 18s-5-3.5-5-7a3 3 0 0 1 5-2.2A3 3 0 0 1 17 11c0 3.5-5 7-5 7z" />
      </svg>
    ),
  },
  {
    index: 11,
    name: 'Pearl',
    hex: '#f1f5f9',
    key: '=',
    darkGlyph: true,
    renderGlyph: ({ className, color }) => (
      <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Visual Peg & Socket Components                                     */
/* ------------------------------------------------------------------ */

export function MastermindPeg({
  colorIndex,
  size = 36,
  className,
}: {
  colorIndex: number;
  size?: number;
  className?: string;
}): React.ReactElement {
  const jewel = MASTERMIND_PALETTE[colorIndex] ?? MASTERMIND_PALETTE[0]!;
  const glyphColor = jewel.darkGlyph ? '#0f172a' : '#ffffff';

  return (
    <div
      className={cn('relative flex items-center justify-center select-none shrink-0', className)}
      style={{ width: size, height: size }}
      title={jewel.name}
    >
      <svg viewBox="0 0 36 36" width={size} height={size} className="drop-shadow-sm">
        <defs>
          <radialGradient id={`peg-grad-${jewel.index}`} cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="40%" stopColor={jewel.hex} />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
          </radialGradient>
        </defs>
        {/* Outer socket shadow */}
        <circle cx="18" cy="18" r="16" fill="url(#peg-rim)" />
        {/* Main peg jewel */}
        <circle cx="18" cy="18" r="15" fill={`url(#peg-grad-${jewel.index})`} />
        {/* Crisp rim border */}
        <circle cx="18" cy="18" r="15" fill="none" stroke="#000000" strokeOpacity="0.4" strokeWidth="1.2" />
        {/* Specular highlight */}
        <ellipse cx="14" cy="12" rx="4" ry="2.5" fill="#ffffff" fillOpacity="0.45" />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ width: size, height: size }}
      >
        <div style={{ width: size * 0.55, height: size * 0.55 }}>
          {jewel.renderGlyph({
            className: 'w-full h-full drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]',
            color: glyphColor,
          })}
        </div>
      </div>
    </div>
  );
}

export function MastermindSocket({
  size = 36,
  active = false,
  className,
  onClick,
  children,
}: {
  size?: number;
  active?: boolean;
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative flex items-center justify-center shrink-0 rounded-full transition-all cursor-pointer',
        active ? 'ring-2 ring-pa-cyan ring-offset-2 ring-offset-pa-bg scale-105' : '',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" width={size} height={size} className="absolute inset-0">
        {/* Inset well shadow */}
        <circle cx="18" cy="18" r="16" fill="#090d16" />
        <circle cx="18" cy="18" r="15" fill="#151b28" stroke="#2a3346" strokeWidth="1.5" />
        <circle cx="18" cy="18" r="12" fill="#0b0f19" opacity="0.85" />
      </svg>
      <div className="relative z-10 flex items-center justify-center">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Clue Pins Grid                                                     */
/* ------------------------------------------------------------------ */

export function CluePins({
  exact,
  color,
  slots,
}: {
  exact: number;
  color: number;
  slots: number;
}): React.ReactElement {
  const pins: ('exact' | 'color' | 'empty')[] = [];
  for (let i = 0; i < exact; i++) pins.push('exact');
  for (let i = 0; i < color; i++) pins.push('color');
  while (pins.length < slots) pins.push('empty');

  return (
    <div
      className="grid grid-flow-col grid-rows-2 gap-1.5 p-1.5 bg-[#090d16] border border-pa-border rounded shrink-0"
      aria-label={`${exact} exact pins, ${color} color pins`}
    >
      {pins.map((type, idx) => (
        <div
          key={idx}
          className="w-3.5 h-3.5 rounded-full flex items-center justify-center border border-black/40 shadow-inner"
          style={{
            backgroundColor:
              type === 'exact'
                ? '#e11d48'
                : type === 'color'
                ? '#f8fafc'
                : '#1e293b',
          }}
          title={
            type === 'exact'
              ? 'Exact: correct color and position'
              : type === 'color'
              ? 'Color: correct color, wrong position'
              : 'Empty'
          }
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Secret Reveal Vault Component (Finished Room)                      */
/* ------------------------------------------------------------------ */

export function MastermindSecretReveal({
  code,
  colors = 8,
}: {
  code: number[];
  colors?: number;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 p-4 bg-pa-surface border-2 border-pa-cyan rounded max-w-md">
      <div className="flex items-center gap-2 text-pa-cyan text-[12px] font-display">
        <Unlock size={16} strokeWidth={2.5} />
        <span>VAULT UNLOCKED — SECRET CODE</span>
      </div>
      <div className="flex items-center gap-3 overflow-x-auto py-2">
        {code.map((col, idx) => (
          <div key={idx} className="flex flex-col items-center gap-1">
            <MastermindPeg colorIndex={col} size={40} />
            <span className="text-[10px] text-pa-ink-dim font-display">
              {MASTERMIND_PALETTE[col]?.name ?? `Col ${col}`}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-pa-ink-dim border-t border-pa-border pt-2">
        Palette: {colors} colors available
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Interactive Mastermind Board                                  */
/* ------------------------------------------------------------------ */

export interface MastermindBoardProps {
  puzzle: { colors: number; slots: number; maxTries: number };
  board: {
    guesses: Array<{ code: number[]; exact: number; color: number }>;
    solved: boolean;
    exhausted: boolean;
  };
  paused?: boolean;
  disabled?: boolean;
  onSubmitGuess: (code: number[]) => Promise<MastermindGuessAck | null>;
}

export function MastermindBoard({
  puzzle,
  board,
  paused = false,
  disabled = false,
  onSubmitGuess,
}: MastermindBoardProps): React.ReactElement {
  const reduced = useReducedMotion();
  const slots = Math.max(4, Math.min(8, puzzle.slots));
  const colorsCount = Math.max(7, Math.min(12, puzzle.colors));
  const maxTries = puzzle.maxTries;
  const isTerminal = board.solved || board.exhausted;
  const isEditable = !disabled && !paused && !isTerminal;

  const [draft, setDraft] = React.useState<(number | null)[]>(() => new Array(slots).fill(null));
  const [cursor, setCursor] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [statusAnnouncement, setStatusAnnouncement] = React.useState('');

  const historyEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to latest guess
  React.useEffect(() => {
    if (historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, [board.guesses.length, reduced]);

  // Handle placing a color at current cursor
  const placeColor = React.useCallback(
    (colorIndex: number) => {
      if (!isEditable || submitting) return;
      sfx.drop(0.85 + colorIndex * 0.035);
      setDraft((prev) => {
        const next = [...prev];
        next[cursor] = colorIndex;
        return next;
      });
      setCursor((c) => Math.min(slots - 1, c + 1));
      setStatusAnnouncement(`Placed ${MASTERMIND_PALETTE[colorIndex]?.name} in slot ${cursor + 1}`);
    },
    [cursor, isEditable, slots, submitting],
  );

  // Handle clearing current slot
  const clearSlot = React.useCallback(() => {
    if (!isEditable || submitting) return;
    sfx.clear();
    setDraft((prev) => {
      const next = [...prev];
      if (next[cursor] !== null) {
        next[cursor] = null;
      } else if (cursor > 0) {
        next[cursor - 1] = null;
        setCursor(cursor - 1);
      }
      return next;
    });
  }, [cursor, isEditable, submitting]);

  // Handle row submission
  const submitCurrentDraft = React.useCallback(async () => {
    if (!isEditable || submitting) return;
    const isComplete = draft.every((v) => v !== null);
    if (!isComplete) {
      sfx.wrong();
      setStatusAnnouncement('Please fill all slots before submitting');
      return;
    }

    setSubmitting(true);
    try {
      const ack = await onSubmitGuess(draft as number[]);
      if (ack) {
        if (ack.solved) {
          sfx.correct();
          setStatusAnnouncement('Code cracked! You solved the puzzle!');
        } else if (ack.exhausted) {
          sfx.gameOver();
          setStatusAnnouncement('Attempts exhausted. Game over.');
        } else {
          sfx.chip();
          setStatusAnnouncement(
            `Attempt accepted. Clues: ${ack.exact} exact position, ${ack.color} correct color.`,
          );
        }
        // Clear draft on acceptance
        setDraft(new Array(slots).fill(null));
        setCursor(0);
      } else {
        sfx.wrong();
      }
    } finally {
      setSubmitting(false);
    }
  }, [draft, isEditable, onSubmitGuess, slots, submitting]);

  // Keyboard controls
  React.useEffect(() => {
    if (!isEditable || submitting) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCursor((c) => Math.min(slots - 1, c + 1));
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        clearSlot();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void submitCurrentDraft();
      } else {
        // Palette number keys
        const palette = MASTERMIND_PALETTE.slice(0, colorsCount);
        const match = palette.find((p) => p.key === e.key);
        if (match) {
          e.preventDefault();
          placeColor(match.index);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSlot, colorsCount, isEditable, placeColor, slots, submitCurrentDraft, submitting]);

  const activePalette = MASTERMIND_PALETTE.slice(0, colorsCount);
  const isDraftComplete = draft.every((v) => v !== null);

  return (
    <div
      className="flex flex-col gap-4 w-full select-none"
      role="grid"
      aria-label="Mastermind Pegboard"
    >
      {/* Screen reader live announcements */}
      <div className="sr-only" aria-live="polite">
        {statusAnnouncement}
      </div>

      {/* Secret Vault Header */}
      <div className="flex items-center justify-between p-3.5 bg-pa-surface border-2 border-pa-border rounded">
        <div className="flex items-center gap-2">
          {isTerminal && board.solved ? (
            <Unlock size={18} className="text-pa-green shrink-0" />
          ) : (
            <Lock size={18} className="text-pa-ink-dim shrink-0" />
          )}
          <span className="font-display text-[12px] tracking-wide">
            {isTerminal && board.solved ? 'VAULT CRACKED' : 'LOCKED VAULT'}
          </span>
        </div>
        <div className="flex items-center gap-2.5 overflow-x-auto">
          {Array.from({ length: slots }, (_, idx) => (
            <div
              key={idx}
              className="w-8 h-8 rounded-full bg-[#090d16] border border-pa-border flex items-center justify-center font-display text-[13px] text-pa-ink-dim"
              aria-hidden="true"
            >
              ?
            </div>
          ))}
        </div>
        <div className="text-[11px] font-display text-pa-ink-dim tabular">
          {board.guesses.length} / {maxTries} TRIES
        </div>
      </div>

      {/* Board History & Active Draft Area */}
      <div className="flex flex-col bg-[#0b0f19] border-2 border-pa-border rounded p-3 overflow-x-auto min-w-[320px]">
        {/* Scrollable Submitted Guesses */}
        <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
          {board.guesses.map((guess, guessIdx) => (
            <motion.div
              key={guessIdx}
              initial={reduced ? {} : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-3 p-2 bg-pa-surface/60 border border-pa-border/60 rounded"
              role="row"
              aria-label={`Row ${guessIdx + 1}: ${guess.exact} exact, ${guess.color} color`}
            >
              <div className="w-6 text-[11px] font-display text-pa-ink-dim tabular shrink-0">
                {String(guessIdx + 1).padStart(2, '0')}
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                {guess.code.map((col, slotIdx) => (
                  <MastermindPeg key={slotIdx} colorIndex={col} size={32} />
                ))}
              </div>
              <CluePins exact={guess.exact} color={guess.color} slots={slots} />
            </motion.div>
          ))}
          <div ref={historyEndRef} />
        </div>

        {/* Active Draft Row (when not finished) */}
        {!isTerminal && (
          <div className="mt-3 pt-3 border-t-2 border-pa-border flex items-center justify-between gap-3">
            <div className="w-6 text-[11px] font-display text-pa-cyan tabular shrink-0">
              {String(board.guesses.length + 1).padStart(2, '0')}
            </div>

            <div className="flex items-center gap-2.5 shrink-0" role="row">
              {draft.map((val, idx) => (
                <MastermindSocket
                  key={idx}
                  size={36}
                  active={cursor === idx}
                  onClick={() => {
                    if (isEditable) setCursor(idx);
                  }}
                  className={cn(isEditable ? 'cursor-pointer hover:border-pa-cyan' : 'cursor-not-allowed')}
                >
                  {val !== null ? (
                    <MastermindPeg colorIndex={val} size={32} />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-pa-border/40" />
                  )}
                </MastermindSocket>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={clearSlot}
                disabled={!isEditable || submitting}
                title="Clear slot (Backspace)"
                className="p-2 text-pa-ink-dim hover:text-pa-ink disabled:opacity-40 rounded"
              >
                <X size={16} />
              </button>
              <PixelButton
                size="sm"
                variant={isDraftComplete ? 'primary' : 'secondary'}
                disabled={!isEditable || !isDraftComplete || submitting}
                onClick={() => void submitCurrentDraft()}
              >
                {submitting ? '…' : 'GUESS'}
                <CornerDownLeft size={14} className="hidden sm:inline-block ml-1" />
              </PixelButton>
            </div>
          </div>
        )}

        {/* Terminal Banner */}
        {isTerminal && (
          <div className="mt-3 p-3 text-center border-t-2 border-pa-border">
            {board.solved ? (
              <span className="text-pa-green font-display text-[13px] tracking-wide">
                CODE CRACKED IN {board.guesses.length} {board.guesses.length === 1 ? 'GUESS' : 'GUESSES'}!
              </span>
            ) : (
              <span className="text-pa-danger font-display text-[13px] tracking-wide">
                ALL {maxTries} ATTEMPTS EXHAUSTED
              </span>
            )}
          </div>
        )}
      </div>

      {/* Color Selection Palette */}
      {!isTerminal && (
        <div className="flex flex-col gap-2 p-3 bg-pa-surface border-2 border-pa-border rounded">
          <div className="flex items-center justify-between text-[11px] font-display text-pa-ink-dim">
            <span>SELECT COLOR (KEYS 1–{colorsCount <= 9 ? colorsCount : '9, 0, -, ='})</span>
            <span>SLOT {cursor + 1} ACTIVE</span>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2">
            {activePalette.map((jewel) => (
              <button
                key={jewel.index}
                type="button"
                onClick={() => placeColor(jewel.index)}
                disabled={!isEditable || submitting}
                className={cn(
                  'relative min-w-[44px] min-h-[44px] p-1.5 flex flex-col items-center justify-center gap-1',
                  'bg-[#090d16] border-2 border-pa-border rounded hover:border-pa-cyan active:scale-95 transition-all',
                  'disabled:opacity-40 disabled:pointer-events-none',
                )}
                aria-label={`${jewel.name} (Key ${jewel.key})`}
              >
                <MastermindPeg colorIndex={jewel.index} size={28} />
                <span className="text-[10px] font-display text-pa-ink-dim leading-none">
                  {jewel.key}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Clue Legend */}
      <div className="flex items-center justify-between text-[11px] text-pa-ink-dim px-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#e11d48] border border-black/40 inline-block" />
            <span>Exact pos & color</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#f8fafc] border border-black/40 inline-block" />
            <span>Color only</span>
          </div>
        </div>
        <span className="hidden sm:inline">Arrows move, Enter submits</span>
      </div>
    </div>
  );
}
