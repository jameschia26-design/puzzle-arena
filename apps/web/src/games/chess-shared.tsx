import * as React from 'react';
import { Flag, Handshake, Undo2 } from 'lucide-react';
import { EV } from '@puzzle-arena/shared';
import type { ChessMoveRecord, XiangqiMoveRecord as XiangqiMoveRecordType } from '@puzzle-arena/games';
import { cn } from '../ui/cn.js';
import { PixelBadge, PixelButton, PixelDialog, PixelPanel } from '../ui/primitives.js';
import { emit, useRoom } from '../net/socket.js';

/* ------------------------------------------------------------------ */
/* ClockChip                                                           */
/* ------------------------------------------------------------------ */

/**
 * Ticks down locally from `remainingMs`, resyncing from props (same
 * "no per-second broadcast" pattern as `Countdown` in `ui/game-bits.tsx`).
 * Renders `--:--` gracefully when `remainingMs` is null/undefined (e.g. a
 * bot seat, which never gets a clock entry).
 */
export function ClockChip({
  remainingMs,
  isRunning,
  runningSince,
  label,
  className,
}: {
  remainingMs: number | null | undefined;
  isRunning: boolean;
  runningSince: number | null;
  label: string;
  className?: string;
}) {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [isRunning]);

  if (remainingMs === null || remainingMs === undefined) {
    return (
      <div className={cn('flex flex-col items-center gap-1', className)}>
        <span className="text-[10px] uppercase text-pa-ink-dim">{label}</span>
        <span className="font-display text-[18px] tabular text-pa-ink-dim">--:--</span>
      </div>
    );
  }

  const display = Math.max(0, remainingMs - (isRunning && runningSince ? now - runningSince : 0));
  const totalSeconds = Math.ceil(display / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const urgent = totalSeconds <= 30;
  const beat = urgent && Math.floor(now / 1000) % 2 === 0;

  const text =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <span className={cn('text-[10px] uppercase', isRunning ? 'text-pa-cyan' : 'text-pa-ink-dim')}>{label}</span>
      <span
        className="font-display text-[18px] tabular"
        style={{ color: beat ? 'var(--color-pa-danger)' : isRunning ? 'var(--color-pa-cyan)' : 'var(--color-pa-ink)' }}
        aria-label={`${label}: ${text} remaining`}
      >
        {text}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Move list panel                                                     */
/* ------------------------------------------------------------------ */

export type SharedMoveRecord =
  | (ChessMoveRecord & { notation?: undefined })
  | (XiangqiMoveRecordType & { san?: undefined });

export function MoveListPanel({
  history,
  whiteLabel,
  blackLabel,
}: {
  history: SharedMoveRecord[];
  whiteLabel: string;
  blackLabel: string;
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  const pairs: { num: number; white?: SharedMoveRecord; black?: SharedMoveRecord }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    pairs.push({ num: i / 2 + 1, white: history[i], black: history[i + 1] });
  }

  const notationOf = (rec: SharedMoveRecord | undefined): string =>
    rec ? (rec.san ?? rec.notation ?? '') : '';

  return (
    <PixelPanel title="Move List">
      <div ref={scrollRef} className="h-40 overflow-y-auto flex flex-col gap-1 pr-2 text-[12px] tabular">
        {pairs.length === 0 ? (
          <p className="text-pa-ink-dim italic">No moves yet.</p>
        ) : (
          pairs.map((p) => (
            <div key={p.num} className="grid grid-cols-[2rem_1fr_1fr] gap-2">
              <span className="text-pa-ink-dim">{p.num}.</span>
              <span className="truncate" title={whiteLabel}>
                {notationOf(p.white)}
              </span>
              <span className="truncate" title={blackLabel}>
                {notationOf(p.black)}
              </span>
            </div>
          ))
        )}
      </div>
    </PixelPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Captured-piece tray                                                 */
/* ------------------------------------------------------------------ */

export function CapturedTray({
  history,
  pieceGlyph,
  className,
}: {
  history: SharedMoveRecord[];
  /** Maps a captured piece "type string" (already side-agnostic) to a glyph. */
  pieceGlyph: (captured: string) => string;
  className?: string;
}) {
  const captured: string[] = [];
  for (const rec of history) {
    const c = (rec as ChessMoveRecord).captured ?? (rec as XiangqiMoveRecordType).captured;
    if (c) captured.push(c);
  }

  if (captured.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {captured.map((c, i) => (
        <span key={i} className="text-[16px] leading-none" title={c}>
          {pieceGlyph(c)}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Action row                                                          */
/* ------------------------------------------------------------------ */

export function ActionRow({
  legalActions,
  drawOfferBy,
  takebackOfferBy,
  youId,
  opponentName,
  onAction,
}: {
  legalActions: string[];
  drawOfferBy: string | null;
  takebackOfferBy: string | null;
  youId: string | null;
  opponentName: string;
  onAction: (action: unknown) => void;
}) {
  const [confirmResign, setConfirmResign] = React.useState(false);
  const [confirmDraw, setConfirmDraw] = React.useState(false);
  const [confirmTakeback, setConfirmTakeback] = React.useState(false);

  const has = (a: string) => legalActions.includes(a);

  // An offer pending against us takes over the action row entirely.
  if (has('respond_draw') && drawOfferBy && drawOfferBy !== youId) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-pa-ink-dim">{opponentName} offered a draw.</p>
        <div className="flex gap-2">
          <PixelButton size="sm" variant="primary" onClick={() => onAction({ type: 'respond_draw', accept: true })}>
            Accept
          </PixelButton>
          <PixelButton size="sm" variant="ghost" onClick={() => onAction({ type: 'respond_draw', accept: false })}>
            Decline
          </PixelButton>
        </div>
      </div>
    );
  }

  if (has('respond_takeback') && takebackOfferBy && takebackOfferBy !== youId) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-pa-ink-dim">{opponentName} requested a takeback.</p>
        <p className="text-[11px] text-pa-ink-dim italic">Time already spent is not refunded.</p>
        <div className="flex gap-2">
          <PixelButton
            size="sm"
            variant="primary"
            onClick={() => onAction({ type: 'respond_takeback', accept: true })}
          >
            Accept
          </PixelButton>
          <PixelButton size="sm" variant="ghost" onClick={() => onAction({ type: 'respond_takeback', accept: false })}>
            Decline
          </PixelButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {has('resign') && (
        <PixelButton size="sm" variant="danger" onClick={() => setConfirmResign(true)}>
          <Flag size={14} strokeWidth={3} className="lucide" /> Resign
        </PixelButton>
      )}
      {has('offer_draw') && (
        <PixelButton size="sm" variant="ghost" onClick={() => setConfirmDraw(true)}>
          <Handshake size={14} strokeWidth={3} className="lucide" /> Offer Draw
        </PixelButton>
      )}
      {has('claim_draw') && (
        <PixelButton size="sm" variant="secondary" onClick={() => onAction({ type: 'claim_draw' })}>
          Claim Draw
        </PixelButton>
      )}
      {has('offer_takeback') && (
        <PixelButton size="sm" variant="ghost" onClick={() => setConfirmTakeback(true)}>
          <Undo2 size={14} strokeWidth={3} className="lucide" /> Request Takeback
        </PixelButton>
      )}

      <PixelDialog
        open={confirmResign}
        onOpenChange={setConfirmResign}
        title="Resign the game?"
        footer={
          <>
            <PixelButton size="sm" variant="ghost" onClick={() => setConfirmResign(false)}>
              Cancel
            </PixelButton>
            <PixelButton
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmResign(false);
                onAction({ type: 'resign' });
              }}
            >
              Resign
            </PixelButton>
          </>
        }
      >
        <p className="text-[13px]">This immediately ends the game as a loss for you. Are you sure?</p>
      </PixelDialog>

      <PixelDialog
        open={confirmDraw}
        onOpenChange={setConfirmDraw}
        title="Offer a draw?"
        footer={
          <>
            <PixelButton size="sm" variant="ghost" onClick={() => setConfirmDraw(false)}>
              Cancel
            </PixelButton>
            <PixelButton
              size="sm"
              variant="primary"
              onClick={() => {
                setConfirmDraw(false);
                onAction({ type: 'offer_draw' });
              }}
            >
              Offer Draw
            </PixelButton>
          </>
        }
      >
        <p className="text-[13px]">{opponentName} will be asked to accept or decline.</p>
      </PixelDialog>

      <PixelDialog
        open={confirmTakeback}
        onOpenChange={setConfirmTakeback}
        title="Request a takeback?"
        footer={
          <>
            <PixelButton size="sm" variant="ghost" onClick={() => setConfirmTakeback(false)}>
              Cancel
            </PixelButton>
            <PixelButton
              size="sm"
              variant="primary"
              onClick={() => {
                setConfirmTakeback(false);
                onAction({ type: 'offer_takeback' });
              }}
            >
              Request Takeback
            </PixelButton>
          </>
        }
      >
        <p className="text-[13px]">{opponentName} will be asked to accept or decline.</p>
        <p className="text-[12px] text-pa-ink-dim italic mt-2">Time already spent is not refunded.</p>
      </PixelDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Still thinking?" modal                                             */
/* ------------------------------------------------------------------ */

interface StillThinkingDetail {
  playerId: string;
  strike: number;
  deadline: number;
}

export function StillThinkingModal({ youId, historyLength }: { youId: string | null; historyLength: number }) {
  const [detail, setDetail] = React.useState<StillThinkingDetail | null>(null);
  const moveDeadline = useRoom((s) => s.moveDeadline);
  const lastHistoryLength = React.useRef(historyLength);
  const lastDeadline = React.useRef(moveDeadline);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<StillThinkingDetail>;
      if (ce.detail?.playerId === youId) {
        setDetail(ce.detail);
        lastHistoryLength.current = historyLength;
        lastDeadline.current = moveDeadline;
      }
    };
    window.addEventListener('pa:stillThinking', handler);
    return () => window.removeEventListener('pa:stillThinking', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youId]);

  // Auto-close if a new move arrives or the deadline moves on.
  React.useEffect(() => {
    if (!detail) return;
    if (historyLength !== lastHistoryLength.current) {
      setDetail(null);
      return;
    }
    if (moveDeadline !== detail.deadline) {
      setDetail(null);
    }
  }, [historyLength, moveDeadline, detail]);

  if (!detail) return null;

  const minutesLeft = Math.max(0, Math.round((detail.deadline - Date.now()) / 60000));

  return (
    <PixelDialog open={Boolean(detail)} onOpenChange={(v) => !v && setDetail(null)} title="Still thinking?" closable={false}>
      <p className="text-[13px]">
        You have about {minutesLeft} minute{minutesLeft === 1 ? '' : 's'} left on this move before it is forfeited.
      </p>
      <div className="mt-4 flex justify-end">
        <PixelButton
          size="sm"
          variant="primary"
          onClick={() => {
            void emit(EV.stillThinkingAck, {});
            setDetail(null);
          }}
        >
          I'm still here
        </PixelButton>
      </div>
    </PixelDialog>
  );
}

export function PlayerNameBadge({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[12px] truncate max-w-[140px]">{label}</span>
      {sub && <PixelBadge>{sub}</PixelBadge>}
    </div>
  );
}
