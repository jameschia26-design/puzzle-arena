import * as React from 'react';
import { Trophy } from 'lucide-react';
import type { BigTwoView, BigTwoCard } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelPanel } from '../ui/primitives.js';
import { resolvePlayer } from '../ui/seat.js';
import { sfx, unlockAudioSession } from '../ui/sound.js';

interface BigTwoBoardProps {
  view: BigTwoView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}

const RANK_LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUIT_LABELS = ['♦', '♣', '♥', '♠'];
const SUIT_RED = new Set([0, 2]); // ♦ ♥

const cardId = (c: BigTwoCard): number => c.rank * 4 + c.suit;
const cardKey = (c: BigTwoCard): string => `${c.rank}-${c.suit}`;
const sortHand = (cards: BigTwoCard[]): BigTwoCard[] =>
  [...cards].sort((a, b) => a.rank - b.rank || a.suit - b.suit);

function Card({
  card,
  selected,
  onClick,
  size = 'md',
}: {
  card: BigTwoCard;
  selected?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
}) {
  const red = SUIT_RED.has(card.suit);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={`${RANK_LABELS[card.rank]} of ${SUIT_LABELS[card.suit]}`}
      className={cn(
        'flex flex-col items-center justify-center border-2 bg-pa-surface font-display tabular select-none transition-transform',
        size === 'md' ? 'w-11 h-16 text-[13px] gap-0.5' : 'w-9 h-13 text-[11px] gap-0.5',
        onClick && 'cursor-pointer hover:-translate-y-1',
        selected ? 'border-pa-cyan -translate-y-2 shadow-[0_0_10px_rgba(34,224,255,0.6)]' : 'border-pa-border',
        red ? 'text-pa-danger' : 'text-pa-ink',
      )}
    >
      <span>{RANK_LABELS[card.rank]}</span>
      <span className="text-[14px]">{SUIT_LABELS[card.suit]}</span>
    </button>
  );
}

export function BigTwoBoard({ view, players, youId, legalActions, turnEndsAt, onAction }: BigTwoBoardProps) {
  const isMyTurn = view.current === youId;
  const isGameOver = view.phase === 'game_over';
  const hand = sortHand(view.you?.hand ?? []);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    setSelected(new Set());
  }, [view.lastPlay, isMyTurn]);

  React.useEffect(() => {
    if (view.lastPlay) {
      if (view.lastPlay.category === 'four-kind' || view.lastPlay.category === 'straight-flush') sfx.bomb();
      else sfx.cardPlay();
    }
  }, [view.lastPlay]);

  const toggleCard = (card: BigTwoCard): void => {
    if (!isMyTurn || isGameOver) return;
    unlockAudioSession();
    sfx.blip();
    setSelected((prev) => {
      const next = new Set(prev);
      const key = cardKey(card);
      if (next.has(key)) next.delete(key);
      else if (next.size < 5) next.add(key);
      return next;
    });
  };

  const selectedCards = hand.filter((c) => selected.has(cardKey(c)));
  const selectedActionKey =
    selectedCards.length > 0 ? `play:${selectedCards.map(cardId).sort((a, b) => a - b).join(',')}` : null;
  const canPlaySelection = selectedActionKey !== null && legalActions.includes(selectedActionKey);
  const canPass = legalActions.includes('pass');

  const play = (): void => {
    if (!canPlaySelection) return;
    unlockAudioSession();
    onAction({ type: 'play', cards: selectedCards });
    setSelected(new Set());
  };

  const pass = (): void => {
    if (!canPass) return;
    unlockAudioSession();
    sfx.wrong();
    onAction({ type: 'pass' });
  };

  const winnerPlayer = view.winner ? resolvePlayer(players, view.winner) : null;
  const leadOwner = view.lastPlay ? resolvePlayer(players, view.lastPlay.playerId) : null;
  const currentActor = resolvePlayer(players, view.current, 'Opponent');

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full">
      <PixelPanel
        title={isGameOver ? 'Game over' : isMyTurn ? 'Your turn' : 'Waiting'}
        action={!isGameOver && turnEndsAt ? <Countdown endsAt={turnEndsAt} className="text-[16px]" /> : undefined}
      >
        {isGameOver ? (
          <div className="flex items-center gap-2 text-pa-amber">
            <Trophy size={18} />
            <span className="font-display text-[12px]">
              {winnerPlayer ? `${winnerPlayer.displayName} WINS!` : 'GAME OVER'}
            </span>
          </div>
        ) : (
          <span className="text-[13px] text-pa-ink-dim">
            {view.currentLead === null
              ? `${isMyTurn ? 'You lead' : currentActor.displayName + ' leads'} — the lead is open.`
              : `${isMyTurn ? 'You must beat' : currentActor.displayName + ' must beat'} ${leadOwner?.displayName ?? 'the last play'}'s ${view.currentLead.category.replace('-', ' ')}.`}
          </span>
        )}
      </PixelPanel>

      {/* ---------------- opponents ---------------- */}
      <div className="flex flex-wrap justify-center gap-4">
        {view.players
          .filter((p) => p.id !== youId)
          .map((p) => {
            const info = resolvePlayer(players, p.id, `Player ${p.seat + 1}`);
            return (
              <div key={p.id} className="flex flex-col items-center gap-1">
                <SeatAvatar seat={info.seat} displayName={info.displayName} avatar={info.avatar} isBot={info.isBot} size={28} />
                <span className="text-[11px] truncate max-w-[100px]">{info.displayName}</span>
                <div className="flex -space-x-3">
                  {Array.from({ length: Math.min(p.handSize, 8) }, (_, i) => (
                    <span key={i} className="w-6 h-9 border-2 border-pa-border bg-pa-surface-2" />
                  ))}
                </div>
                <span className="font-display text-[10px] text-pa-ink-dim tabular">{p.handSize} cards</span>
                {view.current === p.id && !isGameOver && <PixelBadge tone="success">Turn</PixelBadge>}
              </div>
            );
          })}
      </div>

      {/* ---------------- current lead ---------------- */}
      <div className="flex flex-col items-center gap-2 min-h-[100px] justify-center border-2 border-pa-border bg-pa-surface/40 py-4">
        {view.lastPlay ? (
          <>
            <span className="text-[11px] text-pa-ink-dim">{leadOwner?.displayName ?? 'Opponent'} played</span>
            <div className="flex gap-1">
              {view.lastPlay.cards.map((c, i) => (
                <Card key={i} card={c} />
              ))}
            </div>
          </>
        ) : (
          <span className="text-[12px] text-pa-ink-dim italic">No cards in play — the lead is open.</span>
        )}
      </div>

      {/* ---------------- my hand ---------------- */}
      <PixelPanel
        title={`Your hand (${hand.length})`}
        action={
          isMyTurn && !isGameOver ? (
            <div className="flex gap-2">
              <PixelButton variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                Clear
              </PixelButton>
              <PixelButton variant="secondary" size="sm" onClick={pass} disabled={!canPass}>
                Pass
              </PixelButton>
              <PixelButton size="sm" onClick={play} disabled={!canPlaySelection}>
                Play
              </PixelButton>
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-wrap gap-1 justify-center">
          {hand.map((c, i) => (
            <Card key={i} card={c} selected={selected.has(cardKey(c))} onClick={isMyTurn && !isGameOver ? () => toggleCard(c) : undefined} />
          ))}
        </div>
      </PixelPanel>

      <PixelPanel title="Match Log">
        <div className="h-28 overflow-y-auto flex flex-col-reverse gap-1 pr-2 text-[12px] tabular">
          {view.log.length === 0 ? (
            <p className="text-pa-ink-dim italic">Waiting for the first play…</p>
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
