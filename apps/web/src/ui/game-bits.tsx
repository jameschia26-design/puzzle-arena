import * as React from 'react';
import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { cn } from './cn.js';
import { inkOn, monogram, seatColor } from './seat.js';
import { SNAP_MS, snapIn, stepTransition, useReducedMotion } from './motion.js';
import { sfx } from './sound.js';

/* ------------------------------------------------------------------ */
/* SeatAvatar / PlayerChip                                             */
/* ------------------------------------------------------------------ */

/**
 * A solid seat-colour square with a 2-character monogram, or the player's
 * chosen emoji. Seat identity is never colour-only.
 */
export function SeatAvatar({
  seat,
  displayName,
  avatar,
  size = 40,
  isBot = false,
  className,
}: {
  seat: number;
  displayName: string;
  avatar?: string | null;
  size?: number;
  isBot?: boolean;
  className?: string;
}) {
  const color = seatColor(seat);
  return (
    <span
      className={cn('inline-flex items-center justify-center border-2 shrink-0', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        borderColor: color,
        color: inkOn(color),
      }}
      title={displayName}
    >
      {avatar ? (
        <span style={{ fontSize: size * 0.5 }}>{avatar}</span>
      ) : isBot ? (
        <Bot size={Math.round(size * 0.5)} strokeWidth={3} className="lucide" />
      ) : (
        <span className="font-display" style={{ fontSize: Math.max(8, size * 0.28) }}>
          {monogram(displayName)}
        </span>
      )}
    </span>
  );
}

export function PlayerChip({
  seat,
  displayName,
  avatar,
  isBot,
  isTurn,
  connected = true,
  className,
}: {
  seat: number;
  displayName: string;
  avatar?: string | null;
  isBot?: boolean;
  isTurn?: boolean;
  connected?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 border-2 px-2 py-1 bg-pa-surface',
        // Magenta is reserved for the active-turn indicator so it never competes.
        isTurn ? 'border-pa-magenta' : 'border-pa-border',
        !connected && 'opacity-60',
        className,
      )}
    >
      <SeatAvatar seat={seat} displayName={displayName} avatar={avatar} isBot={isBot} size={24} />
      <span className="text-[13px] truncate max-w-[10rem]">{displayName}</span>
      {isBot && <Bot size={14} strokeWidth={3} className="lucide text-pa-ink-dim" />}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Countdown                                                           */
/* ------------------------------------------------------------------ */

/**
 * The client renders its own countdown from the server's absolute `endsAt`,
 * and resyncs from every snapshot — there is no per-second broadcast.
 */
export function Countdown({
  endsAt,
  className,
  onExpire,
}: {
  endsAt: number | null;
  className?: string;
  onExpire?: () => void;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const fired = React.useRef(false);

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const remaining = endsAt ? Math.max(0, endsAt - now) : 0;

  React.useEffect(() => {
    if (endsAt && remaining === 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [remaining, endsAt, onExpire]);

  if (!endsAt) return <span className={cn('font-display text-[24px] tabular', className)}>--:--</span>;

  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const urgent = totalSeconds <= 30;
  // Under 30 seconds it alternates ink / danger on a 1s beat.
  const beat = urgent && Math.floor(now / 1000) % 2 === 0;

  return (
    <span
      className={cn('font-display text-[24px] tabular', className)}
      style={{ color: beat ? 'var(--color-pa-danger)' : 'var(--color-pa-ink)' }}
      aria-label={`${minutes} minutes ${seconds} seconds remaining`}
    >
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* CodeInput                                                           */
/* ------------------------------------------------------------------ */

/** Six single-character boxes: auto-advance, backspace-to-previous, paste. */
export function CodeInput({
  value,
  onChange,
  onComplete,
  invalid,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const chars = value.padEnd(6, ' ').slice(0, 6).split('');

  const setAt = (index: number, char: string): void => {
    const next = value.padEnd(6, ' ').split('');
    next[index] = char;
    const joined = next.join('').trimEnd().toUpperCase();
    onChange(joined);
    if (joined.replace(/\s/g, '').length === 6) onComplete?.(joined);
  };

  return (
    <div className={cn('flex gap-2', invalid && 'pa-shake')}>
      {chars.map((char, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={char.trim()}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={1}
          aria-label={`Room code character ${i + 1}`}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => {
            const char = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!char) return setAt(i, ' ');
            setAt(i, char);
            if (i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (chars[i]?.trim()) setAt(i, ' ');
              else if (i > 0) {
                setAt(i - 1, ' ');
                refs.current[i - 1]?.focus();
              }
            }
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            // Full-string paste fills every box at once.
            e.preventDefault();
            const pasted = e.clipboardData
              .getData('text')
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '')
              .slice(0, 6);
            if (!pasted) return;
            onChange(pasted);
            if (pasted.length === 6) onComplete?.(pasted);
            refs.current[Math.min(pasted.length, 5)]?.focus();
          }}
          className={cn(
            'w-12 h-14 md:w-14 md:h-16 text-center font-display text-[18px] uppercase',
            'bg-pa-bg border-2 text-pa-ink',
            invalid ? 'border-pa-danger' : 'border-pa-border',
          )}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Start overlay: 3 - 2 - 1 - GO                                       */
/* ------------------------------------------------------------------ */

/**
 * Driven by the server's `startsAt`, so every client sees it simultaneously.
 */
export function StartOverlay({ startsAt }: { startsAt: number | null }) {
  const [now, setNow] = React.useState(() => Date.now());
  const reduced = useReducedMotion();
  const lastLabelRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!startsAt) return;
    const t = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(t);
  }, [startsAt]);

  const remaining = startsAt ? startsAt - now : 0;
  const active = Boolean(startsAt && remaining > 0 && remaining <= 4000);
  const step = Math.ceil(remaining / 600);
  const label = step >= 4 ? '3' : step === 3 ? '3' : step === 2 ? '2' : step === 1 ? '1' : 'GO';

  React.useEffect(() => {
    if (!active) {
      lastLabelRef.current = null;
      return;
    }
    if (lastLabelRef.current !== label) {
      lastLabelRef.current = label;
      sfx.countdown(label === 'GO');
    }
  }, [active, label]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[9998] grid place-items-center bg-pa-bg/90">
      <motion.span
        key={label}
        initial={reduced ? {} : { scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={stepTransition(reduced ? 0 : SNAP_MS)}
        className="font-display text-pa-cyan"
        style={{ fontSize: 'clamp(48px, 18vw, 96px)' }}
      >
        {label}
      </motion.span>
    </div>
  );
}

export { snapIn };
