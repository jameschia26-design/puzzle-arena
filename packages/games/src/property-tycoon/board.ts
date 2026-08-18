/**
 * Board reference data, copied verbatim from PLAN.md.
 *
 * Names are original so no trademark is used; the rent numbers, board order and
 * rules are game mechanics and are reproduced exactly.
 */

export type SquareType = 'corner' | 'street' | 'transit' | 'utility' | 'tax' | 'card';

export type ColourGroup =
  | 'Brown'
  | 'LightBlue'
  | 'Pink'
  | 'Orange'
  | 'Red'
  | 'Yellow'
  | 'Green'
  | 'DarkBlue'
  | 'Transit'
  | 'Utility';

export interface Square {
  index: number;
  name: string;
  type: SquareType;
  price?: number;
  mortgage?: number;
  group?: ColourGroup;
  /** [base, 1 house, 2, 3, 4, hotel] — streets only. */
  rent?: [number, number, number, number, number, number];
  houseCost?: number;
}

export const HOUSE_COST: Record<string, number> = {
  Brown: 50,
  LightBlue: 50,
  Pink: 100,
  Orange: 100,
  Red: 150,
  Yellow: 150,
  Green: 200,
  DarkBlue: 200,
};

const RENT: Record<string, [number, number, number, number, number, number]> = {
  'Ash Lane': [2, 10, 30, 90, 160, 250],
  'Birch Row': [4, 20, 60, 180, 320, 450],
  'Cedar Walk': [6, 30, 90, 270, 400, 550],
  'Dover Way': [6, 30, 90, 270, 400, 550],
  Elmfield: [8, 40, 100, 300, 450, 600],
  'Foxglove Street': [10, 50, 150, 450, 625, 750],
  'Granary Row': [10, 50, 150, 450, 625, 750],
  'Harbour View': [12, 60, 180, 500, 700, 900],
  'Ironmonger Lane': [14, 70, 200, 550, 750, 950],
  'Jubilee Road': [14, 70, 200, 550, 750, 950],
  Kingsgate: [16, 80, 220, 600, 800, 1000],
  'Lantern Square': [18, 90, 250, 700, 875, 1050],
  'Marlow Street': [18, 90, 250, 700, 875, 1050],
  Northgate: [20, 100, 300, 750, 925, 1100],
  'Orchard Rise': [22, 110, 330, 800, 975, 1150],
  'Pilgrim Way': [22, 110, 330, 800, 975, 1150],
  'Quarry Bank': [24, 120, 360, 850, 1025, 1200],
  'Regent Parade': [26, 130, 390, 900, 1100, 1275],
  'Sable Court': [26, 130, 390, 900, 1100, 1275],
  'Templar Row': [28, 150, 450, 1000, 1200, 1400],
  'Union Heights': [35, 175, 500, 1100, 1300, 1500],
  'Vantage Point': [50, 200, 600, 1400, 1700, 2000],
};

const street = (
  index: number,
  name: string,
  price: number,
  mortgage: number,
  group: ColourGroup,
): Square => ({
  index,
  name,
  type: 'street',
  price,
  mortgage,
  group,
  rent: RENT[name] as [number, number, number, number, number, number],
  houseCost: HOUSE_COST[group] as number,
});

export const BOARD: Square[] = [
  { index: 0, name: 'START', type: 'corner' },
  street(1, 'Ash Lane', 60, 30, 'Brown'),
  { index: 2, name: 'Civic Fund', type: 'card' },
  street(3, 'Birch Row', 60, 30, 'Brown'),
  { index: 4, name: 'Revenue Levy', type: 'tax' },
  { index: 5, name: 'North Line', type: 'transit', price: 200, mortgage: 100, group: 'Transit' },
  street(6, 'Cedar Walk', 100, 50, 'LightBlue'),
  { index: 7, name: 'Fortune', type: 'card' },
  street(8, 'Dover Way', 100, 50, 'LightBlue'),
  street(9, 'Elmfield', 120, 60, 'LightBlue'),
  { index: 10, name: 'Jail (visiting)', type: 'corner' },
  street(11, 'Foxglove Street', 140, 70, 'Pink'),
  { index: 12, name: 'Power Grid', type: 'utility', price: 150, mortgage: 75, group: 'Utility' },
  street(13, 'Granary Row', 140, 70, 'Pink'),
  street(14, 'Harbour View', 160, 80, 'Pink'),
  { index: 15, name: 'East Line', type: 'transit', price: 200, mortgage: 100, group: 'Transit' },
  street(16, 'Ironmonger Lane', 180, 90, 'Orange'),
  { index: 17, name: 'Civic Fund', type: 'card' },
  street(18, 'Jubilee Road', 180, 90, 'Orange'),
  street(19, 'Kingsgate', 200, 100, 'Orange'),
  { index: 20, name: 'Rest Stop', type: 'corner' },
  street(21, 'Lantern Square', 220, 110, 'Red'),
  { index: 22, name: 'Fortune', type: 'card' },
  street(23, 'Marlow Street', 220, 110, 'Red'),
  street(24, 'Northgate', 240, 120, 'Red'),
  { index: 25, name: 'South Line', type: 'transit', price: 200, mortgage: 100, group: 'Transit' },
  street(26, 'Orchard Rise', 260, 130, 'Yellow'),
  street(27, 'Pilgrim Way', 260, 130, 'Yellow'),
  { index: 28, name: 'Water Board', type: 'utility', price: 150, mortgage: 75, group: 'Utility' },
  street(29, 'Quarry Bank', 280, 140, 'Yellow'),
  { index: 30, name: 'Go To Jail', type: 'corner' },
  street(31, 'Regent Parade', 300, 150, 'Green'),
  street(32, 'Sable Court', 300, 150, 'Green'),
  { index: 33, name: 'Civic Fund', type: 'card' },
  street(34, 'Templar Row', 320, 160, 'Green'),
  { index: 35, name: 'West Line', type: 'transit', price: 200, mortgage: 100, group: 'Transit' },
  { index: 36, name: 'Fortune', type: 'card' },
  street(37, 'Union Heights', 350, 175, 'DarkBlue'),
  { index: 38, name: 'Luxury Levy', type: 'tax' },
  street(39, 'Vantage Point', 400, 200, 'DarkBlue'),
];

export const BOARD_SIZE = BOARD.length; // 40
export const JAIL_INDEX = 10;
export const GO_TO_JAIL_INDEX = 30;
export const START_INDEX = 0;
export const PASS_START_PAY = 200;
export const JAIL_FINE = 50;
export const LUXURY_LEVY = 75;
export const REVENUE_LEVY_FLAT = 200;
export const REVENUE_LEVY_RATE = 0.1;

/** Bank supply caps — a build is rejected when the bank is empty. */
export const BANK_HOUSES = 32;
export const BANK_HOTELS = 12;

export const TRANSIT_RENT = [0, 25, 50, 100, 200] as const;

export const GROUPS: Record<string, number[]> = (() => {
  const groups: Record<string, number[]> = {};
  for (const sq of BOARD) {
    if (!sq.group) continue;
    (groups[sq.group] ??= []).push(sq.index);
  }
  return groups;
})();

export const PROPERTY_INDICES = BOARD.filter(
  (s) => s.type === 'street' || s.type === 'transit' || s.type === 'utility',
).map((s) => s.index);

export const COLOUR_GROUP_COLORS: Record<string, string> = {
  Brown: '#8b5a2b',
  LightBlue: '#7fd8ff',
  Pink: '#ff5ec4',
  Orange: '#ff8c1a',
  Red: '#ff2e3c',
  Yellow: '#ffd426',
  Green: '#2ee66b',
  DarkBlue: '#3b6bff',
};

export const squareAt = (index: number): Square =>
  BOARD[((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE] as Square;
