import * as React from 'react';
import { motion } from 'framer-motion';
import { propertyTycoonRules, type PTState } from '@puzzle-arena/games';
import type { PlayerView } from '@puzzle-arena/shared';
import { cn } from '../ui/cn.js';
import { Countdown, SeatAvatar } from '../ui/game-bits.js';
import { PixelBadge, PixelButton, PixelCard, PixelDialog } from '../ui/primitives.js';
import { inkOn, monogram, seatColor } from '../ui/seat.js';
import { DICE_FRAME_MS, snapIn, useReducedMotion } from '../ui/motion.js';

const {
  BOARD,
  COLOUR_GROUP_COLORS,
  GROUPS,
  TRANSIT_RENT,
  squareAt,
  rentFor,
  ownsFullGroup,
  canBuild,
  canSellHouse,
  canMortgage,
  canUnmortgage,
  unmortgageCost,
  netWorth,
} = propertyTycoonRules;

interface PTView {
  phase: string;
  current: number;
  players: {
    id: string;
    seat: number;
    cash: number;
    position: number;
    inJail: boolean;
    jailCards: string[];
    bankrupt: boolean;
  }[];
  properties: Record<number, { owner: string | null; houses: number; mortgaged: boolean }>;
  dice: [number, number] | null;
  pendingPurchase: number | null;
  auction: {
    propertyId: number;
    participants: string[];
    passed: string[];
    highBid: number;
    highBidder: string | null;
    turn: string;
  } | null;
  debt: { playerId: string; amount: number; creditor: string | null } | null;
  trades: { id: string; from: string; to: string; give: any; receive: any }[];
  lastCard: DrawnCard | null;
  housesRemaining: number;
  hotelsRemaining: number;
  winner: string | null;
}

/**
 * The engine's own rule helpers are pure and read only fields that survive
 * `view()` — Property Tycoon is a game of open information — so the client can
 * answer "may I build here, and why not" with the exact function the server
 * will use, rather than a second, drifting copy of the rules.
 */
const asState = (view: PTView): PTState => view as unknown as PTState;

const RENT_ROW_LABELS = ['Site rent', '1 house', '2 houses', '3 houses', '4 houses', 'Hotel'];

const GROUP_LABELS: Record<string, string> = {
  Brown: 'Brown',
  LightBlue: 'Light Blue',
  Pink: 'Pink',
  Orange: 'Orange',
  Red: 'Red',
  Yellow: 'Yellow',
  Green: 'Green',
  DarkBlue: 'Dark Blue',
  Transit: 'Transit',
  Utility: 'Utility',
};

const money = (n: number): string => `$${n.toLocaleString('en-GB')}`;

/** One square's worth of hop when a token walks the board. */
const HOP_MS = 150;

/**
 * Walk tokens square by square instead of teleporting them.
 *
 * The server only ever reports where a token ended up, so the walk is
 * reconstructed here: a move of N squares is replayed as N single steps. A
 * jump that no roll could explain — Go To Jail, Advance To — snaps instead,
 * because animating a 25-square "walk" would be a lie about what happened.
 */
function useWalkingPositions(
  players: { id: string; position: number }[],
  reduced: boolean,
): Record<string, number> {
  const [display, setDisplay] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(players.map((p) => [p.id, p.position])),
  );
  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  React.useEffect(() => {
    for (const p of players) {
      const from = display[p.id];
      if (from === undefined || from === p.position) {
        if (from === undefined) setDisplay((d) => ({ ...d, [p.id]: p.position }));
        continue;
      }
      const forward = (p.position - from + 40) % 40;
      const backward = (from - p.position + 40) % 40;
      // Two dice cap a roll at 12; "go back 3" is the only backward move.
      const step = reduced ? 0 : forward <= 12 ? 1 : backward <= 3 ? -1 : 0;
      if (step === 0) {
        setDisplay((d) => ({ ...d, [p.id]: p.position }));
        continue;
      }
      if (timers.current[p.id]) continue; // a walk is already under way
      timers.current[p.id] = setTimeout(() => {
        delete timers.current[p.id];
        setDisplay((d) => ({ ...d, [p.id]: (((d[p.id] ?? from) + step + 40) % 40) }));
      }, HOP_MS);
    }
  });

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of Object.values(pending)) clearTimeout(timer);
    };
  }, []);

  return display;
}

/** The card as it reaches the client — the engine's `Card`, minus nothing. */
type DrawnCard = {
  id: string;
  deck: 'fortune' | 'civic';
  text: string;
  effect: propertyTycoonRules.CardEffect;
};

const DECKS = {
  fortune: { label: 'Fortune', colour: '#ff3f8e' },
  civic: { label: 'Civic Fund', colour: '#22e0ff' },
} as const;

/** How long a drawn card sits on screen before it clears itself. */
const CARD_DWELL_MS = 6000;

const diceTotal = (view: PTView): number => (view.dice ? view.dice[0] + view.dice[1] : 0);

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export function PropertyTycoonBoard({
  view,
  players,
  youId,
  legalActions,
  turnEndsAt,
  onAction,
}: {
  view: PTView;
  players: PlayerView[];
  youId: string | null;
  legalActions: string[];
  turnEndsAt?: number | null;
  onAction: (action: unknown) => void;
}) {
  const reduced = useReducedMotion();
  /** The square whose title deed is open. Reading it never blocks play. */
  const [deed, setDeed] = React.useState<number | null>(null);
  const [bid, setBid] = React.useState(0);

  const seatOf = (playerId: string): number =>
    players.find((p) => p.id === playerId)?.seat ?? 0;
  const nameOf = (playerId: string): string =>
    players.find((p) => p.id === playerId)?.displayName ?? playerId.slice(0, 6);

  const can = (action: string): boolean => legalActions.includes(action);
  const onTurn = view.players[view.current]?.id === youId;
  const me = view.players.find((p) => p.id === youId);
  const state = asState(view);
  const walking = useWalkingPositions(view.players, reduced);

  /* The square the current decision is about, so the board can point at it. */
  const focus =
    view.pendingPurchase !== null
      ? view.pendingPurchase
      : view.auction
        ? view.auction.propertyId
        : null;

  React.useEffect(() => {
    if (focus === null) setDeed(null);
  }, [focus]);

  /*
   * Show the overlay once per draw. `lastCard` is cleared when the turn ends,
   * so every new card arrives as a null -> card transition; keying on the card
   * plus whose turn it is stops the overlay reappearing on the unrelated
   * broadcasts that follow (a purchase, a build) while the card still stands.
   */
  const cardKey = view.lastCard ? `${view.current}:${view.lastCard.id}:${view.lastCard.text}` : null;
  const [shownCardKey, setShownCardKey] = React.useState<string | null>(null);
  const [cardOpen, setCardOpen] = React.useState(false);
  React.useEffect(() => {
    if (cardKey === null) {
      setShownCardKey(null);
      setCardOpen(false);
      return;
    }
    if (cardKey !== shownCardKey) {
      setShownCardKey(cardKey);
      setCardOpen(true);
    }
  }, [cardKey, shownCardKey]);
  const dismissCard = React.useCallback(() => setCardOpen(false), []);

  /* Reset the bid to the minimum legal raise whenever the bar moves. */
  const auctionHigh = view.auction?.highBid ?? 0;
  const auctionProperty = view.auction?.propertyId ?? null;
  React.useEffect(() => {
    setBid(auctionHigh + 10);
  }, [auctionHigh, auctionProperty]);

  /* ---- ring geometry: 11 squares per side on an 11x11 CSS grid ---- */
  const cellFor = (index: number): { col: number; row: number } => {
    if (index <= 10) return { col: 11 - index, row: 11 }; // bottom, right to left
    if (index <= 20) return { col: 1, row: 11 - (index - 10) }; // left, bottom to top
    if (index <= 30) return { col: index - 20 + 1, row: 1 }; // top, left to right
    return { col: 11, row: index - 30 + 1 }; // right, top to bottom
  };

  /** The colour flash belongs on the edge facing the middle of the board. */
  const bandClass = (index: number): string => {
    if (index <= 10) return 'top-0 left-0 right-0 h-[6px]';
    if (index <= 20) return 'top-0 bottom-0 right-0 w-[6px]';
    if (index <= 30) return 'bottom-0 left-0 right-0 h-[6px]';
    return 'top-0 bottom-0 left-0 w-[6px]';
  };

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      {/* ------------------------------ board ------------------------------ */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <TurnBanner
          view={view}
          nameOf={nameOf}
          seatOf={seatOf}
          youId={youId}
          turnEndsAt={turnEndsAt ?? null}
        />

        <div
          className="grid w-full max-w-[min(94vw,760px)] aspect-square border-2 border-pa-ink bg-pa-bg"
          style={{ gridTemplateColumns: 'repeat(11, 1fr)', gridTemplateRows: 'repeat(11, 1fr)' }}
        >
          {BOARD.map((sq) => {
            const { col, row } = cellFor(sq.index);
            const prop = view.properties[sq.index];
            const groupColor = sq.group ? COLOUR_GROUP_COLORS[sq.group] : undefined;
            const here = view.players.filter(
              (p) => (walking[p.id] ?? p.position) === sq.index && !p.bankrupt,
            );
            const isFocus = focus === sq.index;
            const isMine = Boolean(youId && prop?.owner === youId);
            const rent = prop?.owner ? rentFor(state, sq.index, diceTotal(view) || 7) : 0;
            const label = squareTooltip(view, sq.index, nameOf);

            return (
              <button
                key={sq.index}
                type="button"
                onClick={() => setDeed(sq.index)}
                style={{ gridColumn: col, gridRow: row }}
                title={label}
                aria-label={label}
                className={cn(
                  'relative border border-pa-border/60 text-left overflow-hidden cursor-pointer',
                  'flex flex-col justify-between hover:bg-pa-surface-2 focus-visible:z-10',
                  isFocus && 'z-10 outline-2 outline-pa-cyan bg-pa-surface',
                )}
              >
                {groupColor && (
                  <span
                    className={cn('absolute', bandClass(sq.index))}
                    style={{ backgroundColor: groupColor }}
                  />
                )}

                <span
                  className={cn(
                    'px-[3px] pt-[7px] text-[7px] leading-[1.15] line-clamp-3',
                    isMine ? 'text-pa-ink' : 'text-pa-ink-dim',
                    sq.index > 10 && sq.index <= 20 && 'pr-[8px] pt-[3px]',
                    sq.index > 20 && sq.index <= 30 && 'pt-[3px]',
                    sq.index > 30 && 'pl-[8px] pt-[3px]',
                  )}
                >
                  {sq.name}
                </span>

                <span className="flex items-end justify-between gap-[1px] px-[3px] pb-[3px]">
                  {/* Unowned squares advertise the asking price; owned ones the
                      rent you would pay, which is the number that matters. */}
                  <span className="text-[7px] tabular text-pa-ink-dim">
                    {prop?.owner
                      ? prop.mortgaged
                        ? 'MTG'
                        : `r${rent}`
                      : sq.price
                        ? sq.price
                        : ''}
                  </span>
                  {prop?.houses ? (
                    <span className="text-[7px] tabular text-pa-success">
                      {prop.houses === 5 ? 'HTL' : `${prop.houses}H`}
                    </span>
                  ) : null}
                </span>

                {prop?.owner && (
                  <span
                    className="absolute right-[1px] top-[7px] grid h-[11px] w-[11px] place-items-center border border-pa-shadow font-display text-[6px]"
                    style={{
                      backgroundColor: seatColor(seatOf(prop.owner)),
                      color: inkOn(seatColor(seatOf(prop.owner))),
                    }}
                  >
                    {monogram(nameOf(prop.owner)).slice(0, 1)}
                  </span>
                )}
                {prop?.mortgaged && (
                  <span className="absolute inset-0 bg-pa-danger/25 pointer-events-none" />
                )}

                {/* token tray */}
                <span className="absolute bottom-[1px] left-[1px] flex max-w-[calc(100%-2px)] flex-wrap gap-[1px]">
                  {here.map((p) => (
                    <Token
                      // Remounting on every step is what makes the hop replay
                      // once per square rather than only at the end of a move.
                      key={`${p.id}-${walking[p.id] ?? p.position}`}
                      seat={seatOf(p.id)}
                      displayName={nameOf(p.id)}
                      isYou={p.id === youId}
                      reduced={reduced}
                    />
                  ))}
                </span>
              </button>
            );
          })}

          {/* centre: dice and status */}
          <div
            style={{ gridColumn: '2 / 11', gridRow: '2 / 11' }}
            className="flex flex-col items-center justify-center gap-3 p-4 text-center"
          >
            <span className="font-display text-[12px] text-pa-ink-dim">PROPERTY TYCOON</span>
            <Dice dice={view.dice} />
            {/* The card stays on the board for the rest of the turn as a
                reminder, in its deck's colour, and reopens on a tap. */}
            {view.lastCard && (
              <button
                type="button"
                onClick={() => setCardOpen(true)}
                className="max-w-[86%] cursor-pointer border-2 bg-pa-surface p-2 text-center"
                style={{ borderColor: DECKS[view.lastCard.deck].colour }}
              >
                <span
                  className="block font-display text-[9px] uppercase"
                  style={{ color: DECKS[view.lastCard.deck].colour }}
                >
                  {DECKS[view.lastCard.deck].label}
                </span>
                <span className="block text-[12px]">{view.lastCard.text}</span>
              </button>
            )}
            <span className="text-[11px] text-pa-ink-dim">
              Bank: {view.housesRemaining} houses · {view.hotelsRemaining} hotels
            </span>
            <span className="max-w-[70%] text-[10px] text-pa-ink-dim">
              Tap any square to read its title deed — the board stays live while you decide.
            </span>
          </div>
        </div>
      </div>

      {/* ---------------------------- dashboard ---------------------------- */}
      <div className="flex flex-col gap-3 xl:w-[360px] xl:shrink-0">
        {/*
          The decision lives beside the board, not on top of it. Under xl it
          docks to the bottom of the viewport, so the board is still readable
          while you weigh the deed.
        */}
        <DecisionPanel
          view={view}
          state={state}
          youId={youId}
          me={me}
          onTurn={onTurn}
          can={can}
          nameOf={nameOf}
          seatOf={seatOf}
          bid={bid}
          setBid={setBid}
          turnEndsAt={turnEndsAt ?? null}
          onAction={onAction}
          onOpenDeed={setDeed}
        />

        <PixelCard className="p-3">
          <h3 className="mb-2 font-display text-[10px] uppercase text-pa-ink-dim">Players</h3>
          <ul className="flex flex-col gap-2">
            {view.players.map((p, i) => {
              const owned = Object.values(view.properties).filter((x) => x.owner === p.id).length;
              return (
                <li
                  key={p.id}
                  className={cn(
                    'flex items-center gap-2 border-2 p-2',
                    i === view.current ? 'border-pa-magenta' : 'border-pa-border',
                    p.bankrupt && 'opacity-50',
                  )}
                >
                  <SeatAvatar seat={seatOf(p.id)} displayName={nameOf(p.id)} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">
                      {nameOf(p.id)}
                      {p.id === youId && <span className="text-pa-cyan"> (you)</span>}
                    </span>
                    {/* Cash alone hides a player who is land-rich and broke. */}
                    <span className="block text-[11px] tabular text-pa-ink-dim">
                      {owned} deeds · worth {money(netWorth(state, p.id))}
                    </span>
                  </span>
                  <span className="tabular text-[13px]">{money(p.cash)}</span>
                  {p.inJail && <PixelBadge tone="danger">Jail</PixelBadge>}
                </li>
              );
            })}
          </ul>
        </PixelCard>

        {/* Buttons are enabled purely from the server's legalActions. */}
        <PixelCard className="flex flex-wrap gap-2 p-3">
          <PixelButton size="sm" disabled={!can('roll')} onClick={() => onAction({ type: 'roll' })}>
            Roll
          </PixelButton>
          <PixelButton
            size="sm"
            variant="ghost"
            disabled={!can('endTurn')}
            onClick={() => onAction({ type: 'endTurn' })}
          >
            End turn
          </PixelButton>
          <PixelButton
            size="sm"
            variant="secondary"
            disabled={!can('payJailFine')}
            onClick={() => onAction({ type: 'payJailFine' })}
          >
            Pay $50
          </PixelButton>
          <PixelButton
            size="sm"
            variant="secondary"
            disabled={!can('useJailCard')}
            onClick={() => onAction({ type: 'useJailCard' })}
          >
            Use card
          </PixelButton>
          <PixelButton
            size="sm"
            variant="danger"
            disabled={!can('declareBankruptcy')}
            onClick={() => onAction({ type: 'declareBankruptcy' })}
          >
            Bankrupt
          </PixelButton>
        </PixelCard>

        <Portfolio
          view={view}
          state={state}
          youId={youId}
          onAction={onAction}
          onOpenDeed={setDeed}
        />
      </div>

      {/* ---------------------------- drawn card --------------------------- */}
      {cardOpen && view.lastCard && (
        <CardOverlay
          card={view.lastCard}
          drawnBy={view.players[view.current]?.id ?? null}
          view={view}
          youId={youId}
          nameOf={nameOf}
          seatOf={seatOf}
          onDismiss={dismissCard}
        />
      )}

      {/* --------------------------- title deed --------------------------- */}
      <PixelDialog
        open={deed !== null}
        onOpenChange={(v) => !v && setDeed(null)}
        title={deed !== null ? squareAt(deed).name : ''}
      >
        {deed !== null && (
          <DeedCard
            view={view}
            state={state}
            index={deed}
            youId={youId}
            nameOf={nameOf}
            seatOf={seatOf}
          />
        )}
      </PixelDialog>
    </div>
  );
}

/** The hover tooltip, so reading a square never requires a click. */
function squareTooltip(view: PTView, index: number, nameOf: (id: string) => string): string {
  const sq = squareAt(index);
  const prop = view.properties[index];
  if (!sq.price) return sq.name;
  if (!prop?.owner) return `${sq.name} — unowned, ${money(sq.price)}`;
  const rent = rentFor(asState(view), index, diceTotal(view) || 7);
  const buildings =
    prop.houses === 5 ? ', hotel' : prop.houses > 0 ? `, ${prop.houses} houses` : '';
  return prop.mortgaged
    ? `${sq.name} — ${nameOf(prop.owner)}, mortgaged (no rent)`
    : `${sq.name} — ${nameOf(prop.owner)}${buildings}, rent ${money(rent)}`;
}

/**
 * A player's counter on the board. Sized off the viewport so it stays a
 * readable disc on a phone and a proper token on a desktop, and it carries the
 * player's monogram — seat identity is never colour alone.
 */
function Token({
  seat,
  displayName,
  isYou,
  reduced,
}: {
  seat: number;
  displayName: string;
  isYou: boolean;
  reduced: boolean;
}): React.ReactElement {
  const background = seatColor(seat);
  return (
    <motion.span
      initial={reduced ? false : { y: -9, scale: 0.85 }}
      animate={{ y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 900, damping: 20, mass: 0.6 }}
      title={displayName}
      className="grid shrink-0 place-items-center border-2 font-display leading-none"
      style={{
        backgroundColor: background,
        color: inkOn(background),
        borderColor: isYou ? 'var(--color-pa-ink)' : '#05060d',
        width: 'clamp(14px, 2.3vw, 26px)',
        height: 'clamp(14px, 2.3vw, 26px)',
        fontSize: 'clamp(6px, 0.95vw, 11px)',
      }}
    >
      {monogram(displayName)}
    </motion.span>
  );
}

/* ------------------------------------------------------------------ */
/* Turn banner                                                         */
/* ------------------------------------------------------------------ */

function TurnBanner({
  view,
  nameOf,
  seatOf,
  youId,
  turnEndsAt,
}: {
  view: PTView;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
  youId: string | null;
  turnEndsAt: number | null;
}): React.ReactElement {
  const actorId = actorOf(view);
  const yours = actorId !== null && actorId === youId;

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-2 bg-pa-surface px-3 py-2',
        yours ? 'border-pa-cyan' : 'border-pa-border',
      )}
    >
      {actorId && <SeatAvatar seat={seatOf(actorId)} displayName={nameOf(actorId)} size={22} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[11px] uppercase">
          {yours ? 'Your move' : actorId ? `${nameOf(actorId)}'s move` : 'Table'}
        </span>
        <span className="block text-[12px] text-pa-ink-dim">{phaseLabel(view, nameOf, youId)}</span>
      </span>
      {/* The server auto-plays the safest legal move at zero. Showing the same
          deadline is the difference between a choice and an ambush. */}
      {yours && turnEndsAt !== null && (
        <span className="flex flex-col items-end">
          <Countdown endsAt={turnEndsAt} className="!text-[16px]" />
          <span className="text-[9px] uppercase text-pa-ink-dim">auto-plays at 0</span>
        </span>
      )}
    </div>
  );
}

/** Mirrors the runtime's `actorToAct`: whoever the table is waiting on. */
function actorOf(view: PTView): string | null {
  if (view.phase === 'game_over') return null;
  if (view.phase === 'auction' && view.auction) return view.auction.turn;
  if (view.phase === 'awaiting_debt_settlement' && view.debt) return view.debt.playerId;
  return view.players[view.current]?.id ?? null;
}

function phaseLabel(view: PTView, nameOf: (id: string) => string, youId: string | null): string {
  const actorId = actorOf(view);
  const yours = actorId !== null && actorId === youId;
  const who = yours ? 'You' : actorId ? nameOf(actorId) : 'Nobody';

  switch (view.phase) {
    case 'awaiting_roll':
      return `${who} to roll the dice.`;
    case 'in_jail_decision':
      return `${who} ${yours ? 'are' : 'is'} in jail — roll a double, pay $50, or use a card.`;
    case 'resolving_square':
      return 'Resolving the square…';
    case 'awaiting_purchase_decision':
      return view.pendingPurchase !== null
        ? `${who} landed on ${squareAt(view.pendingPurchase).name} and can buy it.`
        : `${who} ${yours ? 'have' : 'has'} a decision to make.`;
    case 'auction':
      return view.auction
        ? `Auction for ${squareAt(view.auction.propertyId).name} — ${who} to bid.`
        : 'Auction in progress.';
    case 'awaiting_debt_settlement':
      return view.debt
        ? `${who} owe${yours ? '' : 's'} ${money(view.debt.amount)} — raise it or go bankrupt.`
        : `${who} owe${yours ? '' : 's'} money.`;
    case 'awaiting_end_turn':
      return `${who} can build or mortgage, then end the turn.`;
    case 'game_over':
      return view.winner ? `${nameOf(view.winner)} wins.` : 'Game over.';
    default:
      return view.phase;
  }
}

/* ------------------------------------------------------------------ */
/* Decision panel                                                      */
/* ------------------------------------------------------------------ */

function DecisionPanel({
  view,
  state,
  youId,
  me,
  onTurn,
  can,
  nameOf,
  seatOf,
  bid,
  setBid,
  turnEndsAt,
  onAction,
  onOpenDeed,
}: {
  view: PTView;
  state: PTState;
  youId: string | null;
  me: PTView['players'][number] | undefined;
  onTurn: boolean;
  can: (a: string) => boolean;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
  bid: number;
  setBid: (n: number) => void;
  turnEndsAt: number | null;
  onAction: (a: unknown) => void;
  onOpenDeed: (i: number | null) => void;
}): React.ReactElement | null {
  const buying = view.pendingPurchase !== null && onTurn && (can('buy') || can('decline'));
  const bidding = Boolean(view.auction) && (can('bid') || can('passBid'));
  const owing = Boolean(view.debt && view.debt.playerId === youId);

  if (!buying && !bidding && !owing) return null;

  /* Docked, not modal: the board is never covered by the thing you are
     deciding about. */
  const dock =
    'fixed inset-x-2 bottom-[60px] z-30 max-h-[54vh] overflow-y-auto ' +
    'xl:static xl:inset-auto xl:max-h-none xl:overflow-visible';

  return (
    <PixelCard className={cn(dock, 'border-pa-cyan p-3')}>
      {buying && view.pendingPurchase !== null && (
        <BuyDecision
          view={view}
          state={state}
          index={view.pendingPurchase}
          me={me}
          youId={youId}
          can={can}
          nameOf={nameOf}
          seatOf={seatOf}
          turnEndsAt={turnEndsAt}
          onAction={onAction}
          onOpenDeed={onOpenDeed}
        />
      )}

      {bidding && view.auction && (
        <AuctionDecision
          view={view}
          state={state}
          me={me}
          youId={youId}
          can={can}
          nameOf={nameOf}
          seatOf={seatOf}
          bid={bid}
          setBid={setBid}
          onAction={onAction}
          onOpenDeed={onOpenDeed}
        />
      )}

      {owing && view.debt && !buying && !bidding && (
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-[11px] uppercase text-pa-danger">
            You owe {money(view.debt.amount)}
          </h3>
          <p className="text-[12px] text-pa-ink-dim">
            {view.debt.creditor ? `Owed to ${nameOf(view.debt.creditor)}.` : 'Owed to the bank.'}{' '}
            Sell houses or mortgage deeds below to raise it. You are only bankrupt once there is
            nothing left to sell.
          </p>
          <p className="text-[12px] tabular">
            Cash {money(me?.cash ?? 0)} · short by{' '}
            {money(Math.max(0, view.debt.amount - (me?.cash ?? 0)))}
          </p>
          <PixelButton
            size="sm"
            variant="danger"
            disabled={!can('declareBankruptcy')}
            onClick={() => onAction({ type: 'declareBankruptcy' })}
          >
            Declare bankruptcy
          </PixelButton>
        </div>
      )}
    </PixelCard>
  );
}

/** Everything a buy decision actually needs, without covering the board. */
function BuyDecision({
  view,
  state,
  index,
  me,
  youId,
  can,
  nameOf,
  seatOf,
  turnEndsAt,
  onAction,
  onOpenDeed,
}: {
  view: PTView;
  state: PTState;
  index: number;
  me: PTView['players'][number] | undefined;
  youId: string | null;
  can: (a: string) => boolean;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
  turnEndsAt: number | null;
  onAction: (a: unknown) => void;
  onOpenDeed: (i: number | null) => void;
}): React.ReactElement {
  const sq = squareAt(index);
  const price = sq.price ?? 0;
  const cash = me?.cash ?? 0;
  const after = cash - price;
  const [detail, setDetail] = React.useState(false);

  const rivals = view.players.filter((p) => !p.bankrupt && p.id !== youId && p.cash > 0);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-start gap-2">
        {sq.group && (
          <span
            className="mt-[2px] h-6 w-3 shrink-0 border border-pa-shadow"
            style={{ backgroundColor: COLOUR_GROUP_COLORS[sq.group] ?? '#8b93bf' }}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[12px]">{sq.name}</span>
          <span className="block text-[11px] text-pa-ink-dim">
            {GROUP_LABELS[sq.group ?? ''] ?? sq.type} · asking {money(price)}
          </span>
        </span>
        {turnEndsAt !== null && <Countdown endsAt={turnEndsAt} className="!text-[16px]" />}
      </header>

      {/* The three numbers that decide it, above the fold. */}
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Cash now" value={money(cash)} />
        <Stat label="After buying" value={money(after)} tone={after < 100 ? 'danger' : undefined} />
        <Stat label="Rent it earns" value={money(baseRentIfBought(view, index, youId))} />
      </dl>

      <GroupStrip
        view={view}
        index={index}
        youId={youId}
        nameOf={nameOf}
        seatOf={seatOf}
        onOpenDeed={onOpenDeed}
      />

      <p className="text-[11px] text-pa-ink-dim">{buyAdvice(view, state, index, youId)}</p>

      <div className="flex flex-wrap gap-2">
        <PixelButton size="sm" disabled={!can('buy')} onClick={() => onAction({ type: 'buy' })}>
          Buy for {money(price)}
        </PixelButton>
        <PixelButton
          size="sm"
          variant="ghost"
          disabled={!can('decline')}
          onClick={() => onAction({ type: 'decline' })}
        >
          Pass to auction
        </PixelButton>
        <PixelButton size="sm" variant="secondary" onClick={() => setDetail((d) => !d)}>
          {detail ? 'Hide deed' : 'Full deed'}
        </PixelButton>
      </div>

      {!can('buy') && (
        <p className="text-[11px] text-pa-danger">
          You cannot cover {money(price)}, so this one has to go to auction.
        </p>
      )}
      <p className="text-[11px] text-pa-ink-dim">
        Passing opens the bidding to every solvent player
        {rivals.length > 0 && <> ({rivals.map((p) => nameOf(p.id)).join(', ')})</>} — and to you.
        It often ends up cheaper than the asking price.
      </p>

      {detail && (
        <div className="border-t-2 border-pa-border pt-3">
          <DeedCard
            view={view}
            state={state}
            index={index}
            youId={youId}
            nameOf={nameOf}
            seatOf={seatOf}
          />
        </div>
      )}
    </div>
  );
}

function AuctionDecision({
  view,
  state,
  me,
  youId,
  can,
  nameOf,
  seatOf,
  bid,
  setBid,
  onAction,
  onOpenDeed,
}: {
  view: PTView;
  state: PTState;
  me: PTView['players'][number] | undefined;
  youId: string | null;
  can: (a: string) => boolean;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
  bid: number;
  setBid: (n: number) => void;
  onAction: (a: unknown) => void;
  onOpenDeed: (i: number | null) => void;
}): React.ReactElement | null {
  const auction = view.auction;
  const [detail, setDetail] = React.useState(false);
  if (!auction) return null;

  const sq = squareAt(auction.propertyId);
  const cash = me?.cash ?? 0;
  const min = auction.highBid + 1;
  const max = Math.max(min, cash);
  const clamped = Math.min(max, Math.max(min, bid));
  const yours = auction.turn === youId;

  const quick = [min, auction.highBid + 10, auction.highBid + 50, Math.floor((sq.price ?? 0) / 2)]
    .filter((n, i, all) => n >= min && n <= max && all.indexOf(n) === i)
    .sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-start gap-2">
        {sq.group && (
          <span
            className="mt-[2px] h-6 w-3 shrink-0 border border-pa-shadow"
            style={{ backgroundColor: COLOUR_GROUP_COLORS[sq.group] ?? '#8b93bf' }}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[12px]">Auction · {sq.name}</span>
          <span className="block text-[11px] text-pa-ink-dim">
            Face value {money(sq.price ?? 0)} ·{' '}
            {yours ? 'you are on the clock' : `${nameOf(auction.turn)} to bid`}
          </span>
        </span>
      </header>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="High bid" value={money(auction.highBid)} />
        <Stat label="Held by" value={auction.highBidder ? nameOf(auction.highBidder) : 'nobody'} />
        <Stat label="Your cash" value={money(cash)} />
      </dl>

      <GroupStrip
        view={view}
        index={auction.propertyId}
        youId={youId}
        nameOf={nameOf}
        seatOf={seatOf}
        onOpenDeed={onOpenDeed}
      />

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={clamped}
          disabled={!yours}
          onChange={(e) => setBid(Number(e.target.value))}
          className="flex-1 accent-[var(--color-pa-cyan)]"
          aria-label="Bid amount"
        />
        <span className="w-20 text-right font-display text-[12px] tabular">{money(clamped)}</span>
      </div>

      <div className="flex flex-wrap gap-1">
        {quick.map((n) => (
          <button
            key={n}
            type="button"
            disabled={!yours}
            onClick={() => setBid(n)}
            className="min-h-[32px] cursor-pointer border-2 border-pa-border px-2 font-display text-[10px] tabular hover:border-pa-cyan disabled:opacity-40"
          >
            {money(n)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <PixelButton
          size="sm"
          disabled={!can('bid')}
          onClick={() => onAction({ type: 'bid', amount: clamped })}
        >
          Bid {money(clamped)}
        </PixelButton>
        <PixelButton
          size="sm"
          variant="ghost"
          disabled={!can('passBid')}
          onClick={() => onAction({ type: 'passBid' })}
        >
          Pass
        </PixelButton>
        <PixelButton size="sm" variant="secondary" onClick={() => setDetail((d) => !d)}>
          {detail ? 'Hide deed' : 'Full deed'}
        </PixelButton>
      </div>

      <ul className="text-[11px] text-pa-ink-dim">
        {auction.participants.map((id) => (
          <li key={id} className={cn(auction.turn === id && 'text-pa-cyan')}>
            {nameOf(id)}
            {auction.passed.includes(id) ? ' — passed' : auction.turn === id ? ' — to bid' : ''}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-pa-ink-dim">
        Passing is final for this auction. The last bidder standing pays their bid.
      </p>

      {detail && (
        <div className="border-t-2 border-pa-border pt-3">
          <DeedCard
            view={view}
            state={state}
            index={auction.propertyId}
            youId={youId}
            nameOf={nameOf}
            seatOf={seatOf}
          />
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}): React.ReactElement {
  return (
    <div className="border-2 border-pa-border p-2">
      <dt className="text-[9px] uppercase text-pa-ink-dim">{label}</dt>
      <dd
        className={cn(
          'truncate font-display text-[11px] tabular',
          tone === 'danger' && 'text-pa-danger',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The colour group as a row of tiles showing who holds what. This is the fact
 * that decides most purchases, and it used to be invisible.
 */
function GroupStrip({
  view,
  index,
  youId,
  nameOf,
  seatOf,
  onOpenDeed,
}: {
  view: PTView;
  index: number;
  youId: string | null;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
  onOpenDeed: (i: number | null) => void;
}): React.ReactElement | null {
  const sq = squareAt(index);
  if (!sq.group) return null;
  const members = GROUPS[sq.group] ?? [];
  const mine = members.filter((i) => view.properties[i]?.owner === youId).length;
  const completes = members.every((i) => i === index || view.properties[i]?.owner === youId);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase text-pa-ink-dim">
        {GROUP_LABELS[sq.group] ?? sq.group} set — you hold {mine} of {members.length}
      </span>
      <ul className="flex flex-wrap gap-1">
        {members.map((i) => {
          const owner = view.properties[i]?.owner ?? null;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onOpenDeed(i)}
                title={squareTooltip(view, i, nameOf)}
                className={cn(
                  'flex min-h-[30px] cursor-pointer items-center gap-1 border-2 px-1 text-[10px]',
                  i === index ? 'border-pa-cyan' : 'border-pa-border',
                )}
              >
                <span
                  className="h-3 w-3 border border-pa-shadow"
                  style={{ backgroundColor: owner ? seatColor(seatOf(owner)) : 'transparent' }}
                />
                <span className="max-w-[92px] truncate">{squareAt(i).name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {completes && view.properties[index]?.owner !== youId && (
        <span className="text-[11px] text-pa-success">
          Taking this completes the set — site rent doubles and you can start building.
        </span>
      )}
    </div>
  );
}

/** Rent this square would charge, for you as owner, with no buildings. */
function baseRentIfBought(view: PTView, index: number, youId: string | null): number {
  const sq = squareAt(index);
  if (sq.type === 'street') {
    const ladder = (sq.rent ?? []) as number[];
    const members = GROUPS[sq.group as string] ?? [];
    const completes = members.every((i) => i === index || view.properties[i]?.owner === youId);
    return (ladder[0] ?? 0) * (completes ? 2 : 1);
  }
  if (sq.type === 'transit') {
    const owned =
      (GROUPS['Transit'] ?? []).filter((i) => view.properties[i]?.owner === youId).length + 1;
    return TRANSIT_RENT[Math.min(owned, 4)] ?? 0;
  }
  if (sq.type === 'utility') {
    const owned =
      (GROUPS['Utility'] ?? []).filter((i) => view.properties[i]?.owner === youId).length + 1;
    // Utilities charge a multiple of the roll, so quote it at the average of 7.
    return (owned >= 2 ? 10 : 4) * 7;
  }
  return 0;
}

/** One plain-English line on why this purchase is or is not a good idea. */
function buyAdvice(view: PTView, state: PTState, index: number, youId: string | null): string {
  const sq = squareAt(index);
  const price = sq.price ?? 0;
  const cash = view.players.find((p) => p.id === youId)?.cash ?? 0;

  if (sq.type === 'transit') {
    const owned = (GROUPS['Transit'] ?? []).filter((i) => view.properties[i]?.owner === youId)
      .length;
    return `Transit rent scales with how many lines you hold — ${TRANSIT_RENT.slice(1)
      .map((r) => `$${r}`)
      .join(' / ')} for one to four. You would hold ${owned + 1}.`;
  }
  if (sq.type === 'utility') {
    const owned = (GROUPS['Utility'] ?? []).filter((i) => view.properties[i]?.owner === youId)
      .length;
    return owned === 0
      ? 'A single utility charges 4× the roll; holding both charges 10×.'
      : 'This completes both utilities — rent jumps from 4× to 10× the roll.';
  }

  const group = sq.group as string;
  const members = GROUPS[group] ?? [];
  const heldByOthers = members.some((i) => {
    const owner = view.properties[i]?.owner;
    return Boolean(owner) && owner !== youId;
  });
  const houseCost = sq.houseCost ?? 0;
  const ladder = (sq.rent ?? []) as number[];

  if (ownsFullGroup(state, youId ?? '', group)) return 'You already hold this whole set.';
  if (heldByOthers) {
    return `Someone else already holds part of this set, so neither of you can build on it. Its worth here is denying them the set, plus ${money(sq.mortgage ?? 0)} if you mortgage it.`;
  }
  if (cash - price < houseCost) {
    return `Buying leaves ${money(cash - price)} — less than the ${money(houseCost)} a house costs here, so you would be land-rich and cash-poor for a while.`;
  }
  return `Nobody else has a piece of this set yet. Houses cost ${money(houseCost)} each and take the rent from ${money(ladder[0] ?? 0)} to ${money(ladder[5] ?? 0)}.`;
}

/* ------------------------------------------------------------------ */
/* Portfolio                                                           */
/* ------------------------------------------------------------------ */

function Portfolio({
  view,
  state,
  youId,
  onAction,
  onOpenDeed,
}: {
  view: PTView;
  state: PTState;
  youId: string | null;
  onAction: (a: unknown) => void;
  onOpenDeed: (i: number | null) => void;
}): React.ReactElement {
  const owned = Object.entries(view.properties)
    .filter(([, p]) => p.owner === youId)
    .map(([i]) => Number(i))
    .sort((a, b) => a - b);

  /* Grouped by colour set, because that is the unit the rules care about. */
  const byGroup = new Map<string, number[]>();
  for (const i of owned) {
    const group = squareAt(i).group ?? 'Other';
    byGroup.set(group, [...(byGroup.get(group) ?? []), i]);
  }

  return (
    <PixelCard className="p-3">
      <h3 className="mb-2 font-display text-[10px] uppercase text-pa-ink-dim">Your deeds</h3>
      {owned.length === 0 && (
        <p className="text-[12px] text-pa-ink-dim">
          Nothing yet. Land on an unowned square to buy it, or win one at auction.
        </p>
      )}
      <div className="flex max-h-[320px] flex-col gap-3 overflow-y-auto">
        {[...byGroup.entries()].map(([group, indices]) => {
          const total = (GROUPS[group] ?? []).length;
          return (
            <div key={group} className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-[10px] uppercase text-pa-ink-dim">
                <span
                  className="h-3 w-3 border border-pa-shadow"
                  style={{ backgroundColor: COLOUR_GROUP_COLORS[group] ?? '#8b93bf' }}
                />
                {GROUP_LABELS[group] ?? group} {indices.length}/{total}
                {indices.length === total && <PixelBadge tone="success">Set</PixelBadge>}
              </span>
              <ul className="flex flex-col gap-1">
                {indices.map((index) => (
                  <DeedRow
                    key={index}
                    view={view}
                    state={state}
                    index={index}
                    youId={youId}
                    onAction={onAction}
                    onOpenDeed={onOpenDeed}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </PixelCard>
  );
}

function DeedRow({
  view,
  state,
  index,
  youId,
  onAction,
  onOpenDeed,
}: {
  view: PTView;
  state: PTState;
  index: number;
  youId: string | null;
  onAction: (a: unknown) => void;
  onOpenDeed: (i: number | null) => void;
}): React.ReactElement {
  const sq = squareAt(index);
  const prop = view.properties[index];
  const player = youId ?? '';

  /*
   * `legalActions` is a flat list — it says "some property of yours can be
   * built on", not which one. Asking the engine's own predicate per square
   * gets both the right enabled state and the reason it is disabled.
   */
  const buildWhy = canBuild(state, player, index);
  const sellWhy = canSellHouse(state, player, index);
  const mortgageWhy = canMortgage(state, player, index);
  const unmortgageWhy = canUnmortgage(state, player, index);
  const rent = rentFor(state, index, diceTotal(view) || 7);

  return (
    <li className="flex items-center gap-1 border border-pa-border p-1">
      <button
        type="button"
        onClick={() => onOpenDeed(index)}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <span className="block truncate text-[12px]">{sq.name}</span>
        <span className="block text-[10px] tabular text-pa-ink-dim">
          {prop?.mortgaged
            ? `mortgaged · lift for ${money(unmortgageCost(sq))}`
            : `rent ${money(rent)}`}
          {prop && prop.houses > 0 && (prop.houses === 5 ? ' · hotel' : ` · ${prop.houses}H`)}
        </span>
      </button>

      <MiniButton
        label={`Build a house for ${money(sq.houseCost ?? 0)}`}
        glyph="+"
        why={buildWhy}
        onClick={() => onAction({ type: 'buildHouse', propertyId: index })}
      />
      <MiniButton
        label="Sell a house back to the bank"
        glyph="−"
        why={sellWhy}
        onClick={() => onAction({ type: 'sellHouse', propertyId: index })}
      />
      {prop?.mortgaged ? (
        <MiniButton
          label={`Lift the mortgage for ${money(unmortgageCost(sq))}`}
          glyph="U"
          why={unmortgageWhy}
          onClick={() => onAction({ type: 'unmortgage', propertyId: index })}
        />
      ) : (
        <MiniButton
          label={`Mortgage for ${money(sq.mortgage ?? 0)}`}
          glyph="M"
          why={mortgageWhy}
          onClick={() => onAction({ type: 'mortgage', propertyId: index })}
        />
      )}
    </li>
  );
}

/** Disabled controls carry the engine's own reason in their tooltip. */
function MiniButton({
  label,
  glyph,
  why,
  onClick,
}: {
  label: string;
  glyph: string;
  why: string | null;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      title={why ?? label}
      aria-label={why ? `${label} — ${why}` : label}
      disabled={why !== null}
      onClick={onClick}
      className="min-h-[30px] w-[26px] shrink-0 cursor-pointer border border-pa-border font-display text-[10px] hover:border-pa-cyan disabled:cursor-not-allowed disabled:opacity-30"
    >
      {glyph}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Title deed                                                          */
/* ------------------------------------------------------------------ */

function DeedCard({
  view,
  state,
  index,
  youId,
  nameOf,
  seatOf,
}: {
  view: PTView;
  state: PTState;
  index: number;
  youId: string | null;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
}): React.ReactElement {
  const sq = squareAt(index);
  const prop = view.properties[index];
  const owner = prop?.owner ?? null;

  const ownership = (
    <p className="text-[12px]">
      {owner ? (
        <>
          Owned by{' '}
          <span style={{ color: seatColor(seatOf(owner)) }}>
            {owner === youId ? 'you' : nameOf(owner)}
          </span>
          {prop?.mortgaged && <span className="text-pa-danger"> · mortgaged, charges no rent</span>}
        </>
      ) : sq.price ? (
        'Unowned — buy it by landing on it, or win it at auction.'
      ) : (
        'Not a property.'
      )}
    </p>
  );

  if (sq.type === 'transit') {
    const held = (GROUPS['Transit'] ?? []).filter(
      (i) => view.properties[i]?.owner === owner && !view.properties[i]?.mortgaged,
    ).length;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-pa-ink-dim">
          Transit · Price {money(sq.price ?? 0)} · Mortgage {money(sq.mortgage ?? 0)}
        </p>
        {ownership}
        <RentTable
          rows={TRANSIT_RENT.slice(1).map((rent, i) => ({
            label: `${i + 1} line${i ? 's' : ''} held`,
            value: money(rent),
            active: owner !== null && held === i + 1,
          }))}
        />
      </div>
    );
  }

  if (sq.type === 'utility') {
    const held = (GROUPS['Utility'] ?? []).filter(
      (i) => view.properties[i]?.owner === owner && !view.properties[i]?.mortgaged,
    ).length;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-pa-ink-dim">
          Utility · Price {money(sq.price ?? 0)} · Mortgage {money(sq.mortgage ?? 0)}
        </p>
        {ownership}
        <RentTable
          rows={[
            { label: 'One utility held', value: '4 × the roll', active: held === 1 },
            { label: 'Both utilities held', value: '10 × the roll', active: held === 2 },
          ]}
        />
      </div>
    );
  }

  if (!sq.rent) {
    return (
      <p className="text-[13px]">
        {sq.name} — {sq.type}
        {sq.price ? ` · ${money(sq.price)}` : ''}
      </p>
    );
  }

  const doubled = owner !== null && ownsFullGroup(state, owner, sq.group as string);

  return (
    <div className="flex flex-col gap-3">
      {sq.group && (
        <span
          className="h-5 w-full border border-pa-shadow"
          style={{ backgroundColor: COLOUR_GROUP_COLORS[sq.group] }}
          aria-label={GROUP_LABELS[sq.group] ?? sq.group}
        />
      )}
      <p className="text-[12px] text-pa-ink-dim">
        {GROUP_LABELS[sq.group ?? ''] ?? sq.group} · Price {money(sq.price ?? 0)} · Mortgage{' '}
        {money(sq.mortgage ?? 0)} · House {money(sq.houseCost ?? 0)}
      </p>
      {ownership}
      <RentTable
        rows={sq.rent.map((amount, i) => ({
          label: RENT_ROW_LABELS[i] ?? String(i),
          value: money(i === 0 && doubled ? amount * 2 : amount),
          active: owner !== null && !prop?.mortgaged && (prop?.houses ?? 0) === i,
        }))}
      />
      {doubled && (
        <p className="text-[11px] text-pa-success">
          The whole set is held, so the site rent is doubled.
        </p>
      )}
      <p className="text-[11px] text-pa-ink-dim">
        Houses can only be built once one player holds every square in the set, and must go up
        evenly across it.
      </p>
    </div>
  );
}

function RentTable({
  rows,
}: {
  rows: { label: string; value: string; active: boolean }[];
}): React.ReactElement {
  return (
    <table className="w-full text-[13px] tabular">
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.label}
            className={cn(
              'border-b border-pa-border',
              /* The rate actually in force right now, so the ladder is not a
                 wall of numbers you have to index by hand. */
              row.active && 'bg-pa-surface-2 text-pa-cyan',
            )}
          >
            <td className="px-1 py-1">{row.label}</td>
            <td className="px-1 py-1 text-right">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */
/* Drawn card                                                          */
/* ------------------------------------------------------------------ */

/**
 * A drawn card is the one moment in a turn where something happens *to* you
 * rather than because of you, so it gets the middle of the screen. It clears
 * itself after a few seconds and any click dismisses it — a card must never
 * stand between a player and the decision it just created.
 */
function CardOverlay({
  card,
  drawnBy,
  view,
  youId,
  nameOf,
  seatOf,
  onDismiss,
}: {
  card: DrawnCard;
  drawnBy: string | null;
  view: PTView;
  youId: string | null;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
  onDismiss: () => void;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const deck = DECKS[card.deck];
  const yours = drawnBy !== null && drawnBy === youId;

  React.useEffect(() => {
    const timer = setTimeout(onDismiss, CARD_DWELL_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-pa-shadow/75 p-4"
      onClick={onDismiss}
      role="alertdialog"
      aria-label={`${deck.label} card: ${card.text}`}
    >
      <motion.div
        {...snapIn(reduced)}
        onClick={(e) => e.stopPropagation()}
        className="w-[min(94vw,440px)] border-4 bg-pa-surface pa-shadow"
        style={{ borderColor: deck.colour }}
      >
        <header
          className="flex items-center justify-between gap-3 px-4 py-2"
          style={{ backgroundColor: deck.colour, color: '#05060d' }}
        >
          <span className="font-display text-[12px] uppercase tracking-wider">{deck.label}</span>
          <span className="font-display text-[10px] uppercase">
            {yours ? 'You drew' : drawnBy ? `${nameOf(drawnBy)} drew` : 'Drawn'}
          </span>
        </header>

        <div className="flex flex-col gap-4 p-5">
          <p className="text-[16px] leading-snug">{card.text}</p>

          <ul className="flex flex-col gap-2 border-t-2 border-pa-border pt-3">
            {cardEffectLines(card, view, drawnBy).map((line) => (
              <li key={line} className="flex gap-2 text-[13px] text-pa-ink-dim">
                <span style={{ color: deck.colour }}>▸</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {drawnBy && (
            <div className="flex items-center gap-2 border-t-2 border-pa-border pt-3">
              <SeatAvatar seat={seatOf(drawnBy)} displayName={nameOf(drawnBy)} size={22} />
              <span className="flex-1 text-[12px] text-pa-ink-dim">
                {/* The engine has already applied the card, so this is where the
                    token actually ended up — not where it was. */}
                Now on {squareAt(positionOf(view, drawnBy)).name}
              </span>
              <PixelButton size="sm" variant="ghost" onClick={onDismiss} autoFocus>
                Got it
              </PixelButton>
            </div>
          )}
        </div>

        {/* Wipes away over the dwell time so the dismissal is never a surprise. */}
        <motion.div
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: reduced ? 0 : CARD_DWELL_MS / 1000, ease: 'linear' }}
          className="h-[4px] origin-left"
          style={{ backgroundColor: deck.colour }}
        />
      </motion.div>
    </div>
  );
}

const positionOf = (view: PTView, playerId: string): number =>
  view.players.find((p) => p.id === playerId)?.position ?? 0;

/** Spells out what the card actually did, in money and squares. */
function cardEffectLines(card: DrawnCard, view: PTView, drawnBy: string | null): string[] {
  const e = card.effect;
  const others = view.players.filter((p) => !p.bankrupt && p.id !== drawnBy).length;

  switch (e.kind) {
    case 'advanceTo':
      return [
        `Move to ${squareAt(e.index).name}.`,
        e.index === 0
          ? 'Collect $200 for landing on START.'
          : e.collectIfPass
            ? 'Collect $200 if the move passes START.'
            : 'No $200 — this move does not pass START.',
      ];
    case 'advanceToNearest':
      return e.target === 'transit'
        ? [
            'Move forward to the nearest Transit line.',
            'If it is owned, the rent is double the usual rate.',
          ]
        : [
            'Move forward to the nearest Utility.',
            'If it is owned, pay 10× the dice roll rather than the usual 4×.',
          ];
    case 'collect':
      return [`Collect ${money(e.amount)} from the bank.`];
    case 'pay':
      return [`Pay ${money(e.amount)} to the bank.`];
    case 'collectFromEach':
      return [
        `Collect ${money(e.amount)} from every other player.`,
        `${others} player${others === 1 ? '' : 's'} paying — ${money(e.amount * others)} in total.`,
      ];
    case 'payEach':
      return [
        `Pay ${money(e.amount)} to every other player.`,
        `${others} player${others === 1 ? '' : 's'} to pay — ${money(e.amount * others)} in total.`,
      ];
    case 'jailCard':
      return [
        'Keep this card. It releases you from Jail once, then returns to the bottom of the deck.',
      ];
    case 'goToJail':
      return [
        'Go straight to Jail.',
        'No $200 for passing START, and your turn ends there.',
      ];
    case 'back3': {
      const to = drawnBy !== null ? squareAt(positionOf(view, drawnBy)).name : null;
      return to ? [`Move back three squares, to ${to}.`] : ['Move back three squares.'];
    }
    case 'repairs': {
      let houses = 0;
      let hotels = 0;
      for (const [index, prop] of Object.entries(view.properties)) {
        if (prop.owner !== drawnBy) continue;
        void index;
        if (prop.houses === 5) hotels++;
        else houses += prop.houses;
      }
      const bill = houses * e.perHouse + hotels * e.perHotel;
      return [
        `Pay ${money(e.perHouse)} per house and ${money(e.perHotel)} per hotel.`,
        `${houses} house${houses === 1 ? '' : 's'} and ${hotels} hotel${
          hotels === 1 ? '' : 's'
        } — ${money(bill)} in total.`,
      ];
    }
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/* Dice                                                                */
/* ------------------------------------------------------------------ */

/** Six discrete face swaps, then settle on the server's value. */
function Dice({ dice }: { dice: [number, number] | null }): React.ReactElement {
  const reduced = useReducedMotion();
  const [face, setFace] = React.useState<[number, number] | null>(dice);

  React.useEffect(() => {
    if (!dice) return;
    if (reduced) {
      setFace(dice);
      return;
    }
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      if (frame >= 6) {
        clearInterval(timer);
        // The face sequence is cosmetic and must never be read as the result.
        setFace(dice);
        return;
      }
      setFace([1 + ((frame * 3) % 6), 1 + ((frame * 5) % 6)]);
    }, DICE_FRAME_MS);
    return () => clearInterval(timer);
  }, [dice, reduced]);

  if (!face) return <span className="text-[12px] text-pa-ink-dim">No roll yet</span>;
  return (
    <div className="flex items-center gap-2" aria-label={`Dice showing ${face[0]} and ${face[1]}`}>
      {face.map((n, i) => (
        <span
          key={i}
          className="grid h-10 w-10 place-items-center border-2 border-pa-ink bg-pa-surface font-display text-[16px] tabular"
        >
          {n}
        </span>
      ))}
      <span className="font-display text-[12px] tabular text-pa-ink-dim">
        = {face[0] + face[1]}
      </span>
    </div>
  );
}
