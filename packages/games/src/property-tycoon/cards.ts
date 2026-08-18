/**
 * Fortune and Civic Fund decks, copied verbatim from PLAN.md (16 cards each).
 * Both are shuffled from the seeded PRNG at setup and drawn cyclically; the two
 * Get Out of Jail Free cards leave the deck when held and return to the bottom
 * when used.
 */

export type CardEffect =
  | { kind: 'advanceTo'; index: number; collectIfPass: boolean }
  | { kind: 'advanceToNearest'; target: 'transit' | 'utility' }
  | { kind: 'collect'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'collectFromEach'; amount: number }
  | { kind: 'payEach'; amount: number }
  | { kind: 'jailCard' }
  | { kind: 'goToJail' }
  | { kind: 'back3' }
  | { kind: 'repairs'; perHouse: number; perHotel: number };

export interface Card {
  id: string;
  deck: 'fortune' | 'civic';
  text: string;
  effect: CardEffect;
}

export const FORTUNE_DECK: Card[] = [
  { id: 'f1', deck: 'fortune', text: 'Advance to Vantage Point.', effect: { kind: 'advanceTo', index: 39, collectIfPass: false } },
  { id: 'f2', deck: 'fortune', text: 'Advance to START (collect 200).', effect: { kind: 'advanceTo', index: 0, collectIfPass: false } },
  { id: 'f3', deck: 'fortune', text: 'Advance to Northgate (collect 200 if you pass START).', effect: { kind: 'advanceTo', index: 24, collectIfPass: true } },
  { id: 'f4', deck: 'fortune', text: 'Advance to Foxglove Street (collect 200 if you pass START).', effect: { kind: 'advanceTo', index: 11, collectIfPass: true } },
  { id: 'f5', deck: 'fortune', text: 'Advance to the nearest Transit line; pay double rent if owned.', effect: { kind: 'advanceToNearest', target: 'transit' } },
  { id: 'f6', deck: 'fortune', text: 'Advance to the nearest Transit line; pay double rent if owned.', effect: { kind: 'advanceToNearest', target: 'transit' } },
  { id: 'f7', deck: 'fortune', text: 'Advance to the nearest Utility; pay 10x the dice roll if owned.', effect: { kind: 'advanceToNearest', target: 'utility' } },
  { id: 'f8', deck: 'fortune', text: 'Bank dividend. Collect 50.', effect: { kind: 'collect', amount: 50 } },
  { id: 'f9', deck: 'fortune', text: 'Get Out of Jail Free.', effect: { kind: 'jailCard' } },
  { id: 'f10', deck: 'fortune', text: 'Go back 3 spaces.', effect: { kind: 'back3' } },
  { id: 'f11', deck: 'fortune', text: 'Go to Jail.', effect: { kind: 'goToJail' } },
  { id: 'f12', deck: 'fortune', text: 'General repairs: pay 25 per house and 100 per hotel.', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 'f13', deck: 'fortune', text: 'Speeding fine. Pay 15.', effect: { kind: 'pay', amount: 15 } },
  { id: 'f14', deck: 'fortune', text: 'Trip to North Line (collect 200 if you pass START).', effect: { kind: 'advanceTo', index: 5, collectIfPass: true } },
  { id: 'f15', deck: 'fortune', text: 'Elected chairman. Pay each player 50.', effect: { kind: 'payEach', amount: 50 } },
  { id: 'f16', deck: 'fortune', text: 'Building loan matures. Collect 150.', effect: { kind: 'collect', amount: 150 } },
];

export const CIVIC_DECK: Card[] = [
  { id: 'c1', deck: 'civic', text: 'Advance to START (collect 200).', effect: { kind: 'advanceTo', index: 0, collectIfPass: false } },
  { id: 'c2', deck: 'civic', text: 'Bank error in your favour. Collect 200.', effect: { kind: 'collect', amount: 200 } },
  { id: 'c3', deck: 'civic', text: "Doctor's fee. Pay 50.", effect: { kind: 'pay', amount: 50 } },
  { id: 'c4', deck: 'civic', text: 'Stock sale. Collect 45.', effect: { kind: 'collect', amount: 45 } },
  { id: 'c5', deck: 'civic', text: 'Get Out of Jail Free.', effect: { kind: 'jailCard' } },
  { id: 'c6', deck: 'civic', text: 'Go to Jail.', effect: { kind: 'goToJail' } },
  { id: 'c7', deck: 'civic', text: 'Gala night. Collect 50 from every player.', effect: { kind: 'collectFromEach', amount: 50 } },
  { id: 'c8', deck: 'civic', text: 'Tax refund. Collect 20.', effect: { kind: 'collect', amount: 20 } },
  { id: 'c9', deck: 'civic', text: 'Life insurance matures. Collect 100.', effect: { kind: 'collect', amount: 100 } },
  { id: 'c10', deck: 'civic', text: 'Hospital fees. Pay 100.', effect: { kind: 'pay', amount: 100 } },
  { id: 'c11', deck: 'civic', text: 'School fees. Pay 150.', effect: { kind: 'pay', amount: 150 } },
  { id: 'c12', deck: 'civic', text: 'Consultancy fee. Collect 25.', effect: { kind: 'collect', amount: 25 } },
  { id: 'c13', deck: 'civic', text: 'Holiday fund matures. Collect 100.', effect: { kind: 'collect', amount: 100 } },
  { id: 'c14', deck: 'civic', text: 'Street repairs: pay 40 per house and 115 per hotel.', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 'c15', deck: 'civic', text: 'Inheritance. Collect 100.', effect: { kind: 'collect', amount: 100 } },
  { id: 'c16', deck: 'civic', text: 'Second prize in a contest. Collect 10.', effect: { kind: 'collect', amount: 10 } },
];

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(
  [...FORTUNE_DECK, ...CIVIC_DECK].map((c) => [c.id, c]),
);
