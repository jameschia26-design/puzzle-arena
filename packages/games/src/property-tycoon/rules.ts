import type { PTPlayer, PTState } from './state.js';
import {
  BOARD,
  BOARD_SIZE,
  GROUPS,
  HOUSE_COST,
  TRANSIT_RENT,
  squareAt,
  type Square,
} from './board.js';

export const playerById = (s: PTState, id: string): PTPlayer | undefined =>
  s.players.find((p) => p.id === id);

export const ownerOf = (s: PTState, index: number): string | null =>
  s.properties[index]?.owner ?? null;

export const propertiesOf = (s: PTState, playerId: string): number[] =>
  Object.entries(s.properties)
    .filter(([, p]) => p.owner === playerId)
    .map(([i]) => Number(i));

/** Does this player own every square in the colour group? */
export function ownsFullGroup(s: PTState, playerId: string, group: string): boolean {
  const members = GROUPS[group];
  if (!members || members.length === 0) return false;
  return members.every((i) => s.properties[i]?.owner === playerId);
}

/** House/hotel count across a colour group, for even-build checks. */
export function groupBuildings(s: PTState, group: string): number[] {
  return (GROUPS[group] ?? []).map((i) => s.properties[i]?.houses ?? 0);
}

/**
 * Rent owed for landing on `index`. `diceTotal` matters only for utilities.
 * A mortgaged property never charges rent.
 */
export function rentFor(s: PTState, index: number, diceTotal: number): number {
  const sq = squareAt(index);
  const prop = s.properties[index];
  if (!prop || !prop.owner || prop.mortgaged) return 0;

  if (sq.type === 'street') {
    const ladder = sq.rent as [number, number, number, number, number, number];
    if (prop.houses > 0) return ladder[prop.houses] as number;
    // Full colour group with no houses doubles the base site rent.
    return ownsFullGroup(s, prop.owner, sq.group as string)
      ? (ladder[0] as number) * 2
      : (ladder[0] as number);
  }

  if (sq.type === 'transit') {
    const owned = (GROUPS['Transit'] ?? []).filter(
      (i) => s.properties[i]?.owner === prop.owner && !s.properties[i]?.mortgaged,
    ).length;
    return TRANSIT_RENT[owned] ?? 0;
  }

  if (sq.type === 'utility') {
    const owned = (GROUPS['Utility'] ?? []).filter(
      (i) => s.properties[i]?.owner === prop.owner && !s.properties[i]?.mortgaged,
    ).length;
    return diceTotal * (owned >= 2 ? 10 : 4);
  }

  return 0;
}

/**
 * Net worth per the plan: cash + face value of unmortgaged property +
 * mortgage value of mortgaged property + half building cost.
 * Used for the Revenue Levy percentage option and for scoring progress.
 */
export function netWorth(s: PTState, playerId: string): number {
  const player = playerById(s, playerId);
  if (!player) return 0;
  let total = player.cash;

  for (const index of propertiesOf(s, playerId)) {
    const sq = squareAt(index);
    const prop = s.properties[index];
    if (!prop) continue;
    total += prop.mortgaged ? (sq.mortgage ?? 0) : (sq.price ?? 0);
    if (prop.houses > 0 && sq.group) {
      total += Math.floor((prop.houses * (HOUSE_COST[sq.group] ?? 0)) / 2);
    }
  }
  return total;
}

/** Cash a player could raise by selling every building and mortgaging all. */
export function liquidationValue(s: PTState, playerId: string): number {
  const player = playerById(s, playerId);
  if (!player) return 0;
  let total = player.cash;
  for (const index of propertiesOf(s, playerId)) {
    const sq = squareAt(index);
    const prop = s.properties[index];
    if (!prop) continue;
    if (prop.houses > 0 && sq.group) {
      total += Math.floor((prop.houses * (HOUSE_COST[sq.group] ?? 0)) / 2);
    }
    if (!prop.mortgaged) total += sq.mortgage ?? 0;
  }
  return total;
}

/** Can `playerId` build a house on `index` right now? Returns the reason if not. */
export function canBuild(s: PTState, playerId: string, index: number): string | null {
  const sq = squareAt(index);
  const prop = s.properties[index];
  if (!prop) return 'No such property';
  if (sq.type !== 'street') return 'Only streets can be built on';
  if (prop.owner !== playerId) return 'You do not own that property';
  if (!ownsFullGroup(s, playerId, sq.group as string)) return 'You need the whole colour group';
  if (prop.houses >= 5) return 'Already has a hotel';

  const members = GROUPS[sq.group as string] ?? [];
  if (members.some((i) => s.properties[i]?.mortgaged)) {
    return 'A property in this group is mortgaged';
  }

  // Even build: never more than one ahead of the least-built square in the group.
  const min = Math.min(...members.map((i) => s.properties[i]?.houses ?? 0));
  if (prop.houses > min) return 'Build evenly across the colour group';

  const cost = HOUSE_COST[sq.group as string] ?? 0;
  const player = playerById(s, playerId);
  if (!player || player.cash < cost) return 'Not enough cash';

  // Bank supply. Going from 4 houses to a hotel returns 4 houses to the bank.
  if (prop.houses === 4) {
    if (s.hotelsRemaining <= 0) return 'The bank has no hotels left';
  } else if (s.housesRemaining <= 0) {
    return 'The bank has no houses left';
  }
  return null;
}

/** Can `playerId` sell a house from `index`? Returns the reason if not. */
export function canSellHouse(s: PTState, playerId: string, index: number): string | null {
  const sq = squareAt(index);
  const prop = s.properties[index];
  if (!prop) return 'No such property';
  if (prop.owner !== playerId) return 'You do not own that property';
  if (prop.houses <= 0) return 'Nothing to sell';

  const members = GROUPS[sq.group as string] ?? [];
  const max = Math.max(...members.map((i) => s.properties[i]?.houses ?? 0));
  if (prop.houses < max) return 'Sell evenly across the colour group';
  if (prop.houses === 5 && s.housesRemaining < 4) {
    return 'The bank cannot make change for that hotel';
  }
  return null;
}

export function canMortgage(s: PTState, playerId: string, index: number): string | null {
  const sq = squareAt(index);
  const prop = s.properties[index];
  if (!prop) return 'No such property';
  if (prop.owner !== playerId) return 'You do not own that property';
  if (prop.mortgaged) return 'Already mortgaged';
  // Buildings in the group must be sold back before any of it can be mortgaged.
  const members = GROUPS[sq.group as string] ?? [];
  if (members.some((i) => (s.properties[i]?.houses ?? 0) > 0)) {
    return 'Sell the buildings in this colour group first';
  }
  return null;
}

export function canUnmortgage(s: PTState, playerId: string, index: number): string | null {
  const sq = squareAt(index);
  const prop = s.properties[index];
  if (!prop) return 'No such property';
  if (prop.owner !== playerId) return 'You do not own that property';
  if (!prop.mortgaged) return 'Not mortgaged';
  const cost = Math.ceil((sq.mortgage ?? 0) * 1.1);
  const player = playerById(s, playerId);
  if (!player || player.cash < cost) return 'Not enough cash';
  return null;
}

export const unmortgageCost = (sq: Square): number => Math.ceil((sq.mortgage ?? 0) * 1.1);

export const livePlayers = (s: PTState): PTPlayer[] => s.players.filter((p) => !p.bankrupt);

export function nextLiveIndex(s: PTState, from: number): number {
  for (let step = 1; step <= s.players.length; step++) {
    const idx = (from + step) % s.players.length;
    if (!(s.players[idx] as PTPlayer).bankrupt) return idx;
  }
  return from;
}

/** Total houses and hotels a player owns, for the repairs cards. */
export function buildingCounts(s: PTState, playerId: string): { houses: number; hotels: number } {
  let houses = 0;
  let hotels = 0;
  for (const index of propertiesOf(s, playerId)) {
    const h = s.properties[index]?.houses ?? 0;
    if (h === 5) hotels++;
    else houses += h;
  }
  return { houses, hotels };
}

/** Nearest square of a type at or ahead of `from`, wrapping the board. */
export function nearestAhead(from: number, type: 'transit' | 'utility'): number {
  for (let step = 1; step <= BOARD_SIZE; step++) {
    const idx = (from + step) % BOARD_SIZE;
    if ((BOARD[idx] as Square).type === type) return idx;
  }
  return from;
}
