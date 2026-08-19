/**
 * Re-exported from @puzzle-arena/shared, which is the actual owner of this
 * pure tile data (see the note at the top of that file) — kept behind this
 * same import path so nothing in this engine module needed to change when
 * the data moved.
 */
export {
  BLANK,
  TILE_VALUES,
  TILE_COUNTS,
  RACK_SIZE,
  BAG_SIZE,
  letterValue,
  rackTileValue,
  freshBag,
} from '@puzzle-arena/shared';
