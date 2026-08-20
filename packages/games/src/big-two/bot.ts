import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';

/**
 * Self-contained, like every other game's bot.ts — see checkers/bot.ts for
 * why this reimplements combo logic rather than importing it from
 * ./state.js or ./rules.js.
 */

interface BotCard {
  rank: number;
  suit: number;
}

type BotCategory = 'single' | 'pair' | 'triple' | 'straight' | 'flush' | 'full-house' | 'four-kind' | 'straight-flush';

interface BotCombo {
  category: BotCategory;
  value: number;
  cards: BotCard[];
}

export interface BigTwoBotPublicPlayer {
  id: string;
  seat: number;
  handSize: number;
}

export interface BigTwoBotView {
  players: BigTwoBotPublicPlayer[];
  current: string | null;
  phase: 'awaiting_play' | 'game_over';
  currentLead: BotCombo | null;
  currentLeaderId: string | null;
  firstPlayDone: boolean;
  you: { id: string; hand: BotCard[] } | null;
}

const THREE_D: BotCard = { rank: 0, suit: 0 };

function sameCard(a: BotCard, b: BotCard): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

function classifyCombo(cards: BotCard[]): BotCombo | null {
  const n = cards.length;
  if (n === 1) {
    const c = cards[0] as BotCard;
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

function classifyFive(cards: BotCard[]): BotCombo | null {
  const sorted = [...cards].sort((a, b) => a.rank - b.rank || a.suit - b.suit);
  const ranks = sorted.map((c) => c.rank);
  const suits = sorted.map((c) => c.suit);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const countValues = [...counts.values()].sort((a, b) => b - a);
  const isFlush = suits.every((s) => s === suits[0]);
  const distinctRanks = new Set(ranks);
  const isStraight = distinctRanks.size === 5 && (ranks[4] as number) - (ranks[0] as number) === 4 && (ranks[4] as number) <= 11;

  if (countValues[0] === 4) {
    const fourRank = [...counts.entries()].find(([, c]) => c === 4)![0];
    return { category: 'four-kind', value: fourRank, cards };
  }
  if (isStraight && isFlush) return { category: 'straight-flush', value: (ranks[4] as number) * 4 + (suits[0] as number), cards };
  if (isFlush) return { category: 'flush', value: (ranks[4] as number) * 4 + (suits[4] as number), cards };
  if (isStraight) return { category: 'straight', value: ranks[4] as number, cards };
  if (countValues[0] === 3 && countValues[1] === 2) {
    const tripleRank = [...counts.entries()].find(([, c]) => c === 3)![0];
    return { category: 'full-house', value: tripleRank, cards };
  }
  return null;
}

function bombPower(c: BotCombo): number | null {
  if (c.category === 'straight-flush') return 10_000 + c.value;
  if (c.category === 'four-kind') return 1_000 + c.value;
  return null;
}

function beats(a: BotCombo, b: BotCombo | null): boolean {
  if (!b) return true;
  const aBomb = bombPower(a);
  const bBomb = bombPower(b);
  if (aBomb !== null) return bBomb !== null ? aBomb > bBomb : true;
  if (bBomb !== null) return false;
  if (a.cards.length !== b.cards.length) return false;
  if (a.category !== b.category) return false;
  return a.value > b.value;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [head, ...tail] = arr as [T, ...T[]];
  const withHead = combinations(tail, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

function enumerateLegalCombos(hand: BotCard[], lead: BotCombo | null, mustInclude3D: boolean): BotCombo[] {
  const sizes = new Set<number>();
  if (lead) {
    sizes.add(lead.cards.length);
    sizes.add(5);
  } else {
    sizes.add(1);
    sizes.add(2);
    sizes.add(3);
    sizes.add(5);
  }
  const results: BotCombo[] = [];
  for (const size of sizes) {
    if (size > hand.length) continue;
    for (const combo of combinations(hand, size)) {
      const classified = classifyCombo(combo);
      if (!classified) continue;
      if (mustInclude3D && !combo.some((c) => sameCard(c, THREE_D))) continue;
      if (!beats(classified, lead)) continue;
      results.push(classified);
    }
  }
  return results;
}

const isBomb = (c: BotCombo): boolean => c.category === 'four-kind' || c.category === 'straight-flush';

function lowestValue(combos: BotCombo[]): BotCombo {
  return combos.reduce((best, c) => (c.value < best.value ? c : best));
}

/** Lone high cards (K/A/2, rank >= 10) left with no same-rank partner after
 *  playing `combo` — a rough measure of how "stranded" the remaining hand is. */
function strandPenalty(hand: BotCard[], combo: BotCombo): number {
  const used = new Set(combo.cards.map((c) => `${c.rank}-${c.suit}`));
  const remaining = hand.filter((c) => !used.has(`${c.rank}-${c.suit}`));
  const counts = new Map<number, number>();
  for (const c of remaining) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  let penalty = 0;
  for (const [rank, count] of counts) {
    if (rank >= 10 && count === 1) penalty += 5;
  }
  return penalty;
}

export const bigTwoBot: BotPolicy<BigTwoBotView, { type: 'play'; cards: BotCard[] } | { type: 'pass' }> = {
  chooseAction(view, selfId, rng: Rng, difficulty: BotDifficulty) {
    const hand = view.you?.hand ?? [];
    const lead = view.currentLead;
    const mustInclude3D = !view.firstPlayDone;
    const legal = enumerateLegalCombos(hand, lead, mustInclude3D);
    const canPass = lead !== null;

    if (legal.length === 0) {
      return canPass ? { type: 'pass' } : { type: 'play', cards: hand.slice(0, 1) };
    }

    if (lead !== null) {
      // Responding to an active lead.
      const nonBomb = legal.filter((c) => !isBomb(c));
      if (nonBomb.length > 0) {
        return { type: 'play', cards: lowestValue(nonBomb).cards };
      }
      const bombs = legal.filter(isBomb);
      if (bombs.length === 0) return canPass ? { type: 'pass' } : { type: 'play', cards: legal[0]!.cards };
      if (difficulty === 'easy') return canPass ? { type: 'pass' } : { type: 'play', cards: bombs[0]!.cards };
      if (difficulty === 'normal') {
        return rng.next() < 0.5
          ? { type: 'play', cards: lowestValue(bombs).cards }
          : canPass
            ? { type: 'pass' }
            : { type: 'play', cards: bombs[0]!.cards };
      }
      // hard: spend it readily once the hand is getting short, otherwise still favours it more than normal.
      const wouldFinish = hand.length - 5 <= 3;
      return wouldFinish || rng.next() < 0.65
        ? { type: 'play', cards: lowestValue(bombs).cards }
        : canPass
          ? { type: 'pass' }
          : { type: 'play', cards: bombs[0]!.cards };
    }

    // Free lead — choose what to open with.
    const nonBomb = legal.filter((c) => !isBomb(c));
    const pool = nonBomb.length > 0 ? nonBomb : legal;

    if (difficulty === 'easy') {
      const singles = pool.filter((c) => c.cards.length === 1);
      const candidates = singles.length > 0 ? singles : pool;
      return { type: 'play', cards: lowestValue(candidates).cards };
    }

    const maxSize = Math.max(...pool.map((c) => c.cards.length));
    const atMaxSize = pool.filter((c) => c.cards.length === maxSize);

    if (difficulty === 'normal') {
      return { type: 'play', cards: lowestValue(atMaxSize).cards };
    }

    // hard: among the largest combos, avoid stranding lone high cards.
    let best = atMaxSize[0] as BotCombo;
    let bestScore = -Infinity;
    for (const c of atMaxSize) {
      const s = -c.value * 0.1 - strandPenalty(hand, c) + rng.next() * 0.01;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return { type: 'play', cards: best.cards };
  },
};
