/**
 * Re-exported from @puzzle-arena/shared, which is the actual owner of this
 * pure board-layout data (see the note at the top of that file) — kept
 * behind this same import path so nothing in this engine module needed to
 * change when the data moved.
 */
export {
  BOARD_SIZE,
  CENTER_ROW,
  CENTER_COL,
  indexOf,
  inBounds,
  premiumAt,
  PREMIUM_LAYOUT,
  type PremiumType,
} from '@puzzle-arena/shared';
