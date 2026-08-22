import type { Rng } from '@puzzle-arena/shared';
import type { BigTwoCard, BigTwoCombo, BigTwoComboCategory, BigTwoPlayer, BigTwoState } from './state.js';

export const RANK_LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as const;
export const SUIT_LABELS = ['♦', '♣', '♥', '♠'] as const;

export const THREE_OF_DIAMONDS: BigTwoCard = { rank: 0, suit: 0 };

export function createDeck(): BigTwoCard[] {
  const deck: BigTwoCard[] = [];
  for (let rank = 0; rank < 13; rank++) {
    for (let suit = 0; suit < 4; suit++) deck.push({ rank, suit });
  }
  return deck;
}

/** All 52 cards dealt round-robin; each player gets floor(52/n), and the
 *  first `52 % n` seats get one extra. Generalises cleanly to 2-4 players
 *  without the traditional "remove a deuce for 3p" house rule. */
export function dealHands(rng: Rng, playerCount: number): BigTwoCard[][] {
  const deck = rng.shuffle(createDeck());
  const base = Math.floor(52 / playerCount);
  const extra = 52 % playerCount;
  const hands: BigTwoCard[][] = [];
  let offset = 0;
  for (let i = 0; i < playerCount; i++) {
    const size = base + (i < extra ? 1 : 0);
    hands.push(deck.slice(offset, offset + size));
    offset += size;
  }
  return hands;
}

export function cardId(card: BigTwoCard): number {
  return card.rank * 4 + card.suit;
}

export function cardLabel(card: BigTwoCard): string {
  return `${RANK_LABELS[card.rank]}${SUIT_LABELS[card.suit]}`;
}

export function sameCard(a: BigTwoCard, b: BigTwoCard): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function playerById(s: BigTwoState, id: string): BigTwoPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

/** Whoever the game is waiting on right now, or null once it is over. */
export function actorToAct(s: BigTwoState): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.current]?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Combo classification                                                */
/* ------------------------------------------------------------------ */

export function classifyCombo(cards: BigTwoCard[]): BigTwoCombo | null {
  const n = cards.length;
  if (n === 1) {
    const c = cards[0] as BigTwoCard;
    return { category: 'single', value: c.rank * 4 + c.suit, cards };
  }
  if (n === 2) {
    if (cards[0]!.rank !== cards[1]!.rank) return null;
    return { category: 'pair', value: cards[0]!.rank * 4 + Math.max(cards[0]!.suit, cards[1]!.suit), cards };
  }
  if (n === 3) {
    if (!(cards[0]!.rank === cards[1]!.rank && cards[1]!.rank === cards[2]!.rank)) return null;
    return { category: 'triple', value: cards[0]!.rank, cards };
  }
  if (n === 5) return classifyFive(cards);
  return null;
}

function classifyFive(cards: BigTwoCard[]): BigTwoCombo | null {
  const sorted = [...cards].sort((a, b) => a.rank - b.rank || a.suit - b.suit);
  const ranks = sorted.map((c) => c.rank);
  const suits = sorted.map((c) => c.suit);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const countValues = [...counts.values()].sort((a, b) => b - a);

  const isFlush = suits.every((s) => s === suits[0]);
  const distinctRanks = new Set(ranks);
  // No wraparound and no straight may include the 2 (rank 12): the highest
  // legal straight is 10-J-Q-K-A.
  const isStraight = distinctRanks.size === 5 && (ranks[4] as number) - (ranks[0] as number) === 4 && (ranks[4] as number) <= 11;

  if (countValues[0] === 4) {
    const fourRank = [...counts.entries()].find(([, c]) => c === 4)![0];
    return { category: 'four-kind', value: fourRank, cards };
  }
  if (isStraight && isFlush) {
    return { category: 'straight-flush', value: (ranks[4] as number) * 4 + (suits[0] as number), cards };
  }
  if (isFlush) {
    return { category: 'flush', value: (ranks[4] as number) * 4 + (suits[4] as number), cards };
  }
  if (isStraight) {
    return { category: 'straight', value: ranks[4] as number, cards };
  }
  if (countValues[0] === 3 && countValues[1] === 2) {
    const tripleRank = [...counts.entries()].find(([, c]) => c === 3)![0];
    return { category: 'full-house', value: tripleRank, cards };
  }
  return null;
}

/** A unified strength for cross-category bomb comparison: any straight flush
 *  outranks any four-of-a-kind, and both outrank every non-bomb combo. */
function bombPower(c: BigTwoCombo): number | null {
  if (c.category === 'straight-flush') return 10_000 + c.value;
  if (c.category === 'four-kind') return 1_000 + c.value;
  return null;
}

/** Standard Big Two 5-card ladder: straight < flush < full-house, so any of
 *  these three categories may beat any other so long as its rung is higher. */
const FIVE_CARD_RUNG: Record<'straight' | 'flush' | 'full-house', number> = {
  straight: 0,
  flush: 1,
  'full-house': 2,
};

function fivePower(c: BigTwoCombo): number | null {
  if (c.category !== 'straight' && c.category !== 'flush' && c.category !== 'full-house') return null;
  return FIVE_CARD_RUNG[c.category] * 100 + c.value;
}

/** True when `a` may legally be played over `b` (the current lead, or null
 *  for a free lead). Bombs beat any weaker combo of any category or size;
 *  5-card straight/flush/full-house rank on one shared ladder; singles/pairs/
 *  triples must match category and size exactly and exceed value. */
export function beats(a: BigTwoCombo, b: BigTwoCombo | null): boolean {
  if (!b) return true;
  const aBomb = bombPower(a);
  const bBomb = bombPower(b);
  if (aBomb !== null) {
    if (bBomb !== null) return aBomb > bBomb;
    return true;
  }
  if (bBomb !== null) return false;
  if (a.cards.length !== b.cards.length) return false;
  const aFive = fivePower(a);
  const bFive = fivePower(b);
  if (aFive !== null && bFive !== null) return aFive > bFive;
  if (a.category !== b.category) return false;
  return a.value > b.value;
}

export function comboLabel(combo: BigTwoCombo): string {
  const cardsText = combo.cards.map(cardLabel).join(' ');
  const names: Record<BigTwoComboCategory, string> = {
    single: 'a single',
    pair: 'a pair',
    triple: 'a triple',
    straight: 'a straight',
    flush: 'a flush',
    'full-house': 'a full house',
    'four-kind': 'a bomb (four of a kind)',
    'straight-flush': 'a bomb (straight flush)',
  };
  return `${names[combo.category]}: ${cardsText}`;
}

/* ------------------------------------------------------------------ */
/* Combo enumeration                                                   */
/* ------------------------------------------------------------------ */

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [head, ...tail] = arr as [T, ...T[]];
  const withHead = combinations(tail, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

/** Every legal combo `hand` could play right now, given the current lead
 *  (null = free lead) and whether the 3 of Diamonds must be included. */
export function enumerateLegalCombos(
  hand: BigTwoCard[],
  lead: BigTwoCombo | null,
  mustInclude3D: boolean,
): BigTwoCombo[] {
  const sizes = new Set<number>();
  if (lead) {
    sizes.add(lead.cards.length);
    sizes.add(5); // bombs are always 5 cards and can beat any lead size
  } else {
    sizes.add(1);
    sizes.add(2);
    sizes.add(3);
    sizes.add(5);
  }

  const results: BigTwoCombo[] = [];
  for (const size of sizes) {
    if (size > hand.length) continue;
    for (const combo of combinations(hand, size)) {
      const classified = classifyCombo(combo);
      if (!classified) continue;
      if (mustInclude3D && !combo.some((c) => c.rank === THREE_OF_DIAMONDS.rank && c.suit === THREE_OF_DIAMONDS.suit)) {
        continue;
      }
      if (!beats(classified, lead)) continue;
      results.push(classified);
    }
  }
  return results;
}
