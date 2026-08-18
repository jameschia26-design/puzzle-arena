export * from './engine.js';
export * from './bot.js';

export { propertyTycoon } from './property-tycoon/index.js';
export * as propertyTycoonRules from './property-tycoon/index.js';
export { propertyTycoonBot, type PTBotView } from './property-tycoon/bot.js';
export type { PTState, PTPlayer, PTPhase, PTConfig } from './property-tycoon/state.js';

export { manorMystery, ELIMINABLE } from './manor-mystery/index.js';
export * as manorMysteryRules from './manor-mystery/index.js';
export { manorMysteryBot, deduce, type MMBotView } from './manor-mystery/bot.js';
export type {
  MMState,
  MMPlayer,
  MMPhase,
  MMView,
  SuggestionRecord,
} from './manor-mystery/index.js';

import type { GameId } from '@puzzle-arena/shared';
import { propertyTycoon } from './property-tycoon/index.js';
import { manorMystery } from './manor-mystery/index.js';
import type { GameEngine } from './engine.js';

/** Board-game engines by id. Puzzles are handled by packages/puzzles. */
export const BOARD_ENGINES: Partial<Record<GameId, GameEngine<never, never>>> = {
  'property-tycoon': propertyTycoon as unknown as GameEngine<never, never>,
  'manor-mystery': manorMystery as unknown as GameEngine<never, never>,
};
