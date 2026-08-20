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

export { scrabble } from './scrabble/index.js';
export * as scrabbleRules from './scrabble/index.js';
export { scrabbleBot, type SCRBotView } from './scrabble/bot.js';
export type { ScrabbleState, ScrabblePlayer, ScrabbleConfig } from './scrabble/state.js';
export type { ScrabbleView, ScrabblePublicPlayer } from './scrabble/index.js';

export { congkak } from './congkak/index.js';
export * as congkakRules from './congkak/index.js';
export { congkakBot, type CongkakBotView } from './congkak/bot.js';
export type { CongkakState, CongkakPlayer, CongkakConfig, CongkakAction } from './congkak/state.js';
export type { CongkakView, CongkakPublicPlayer, CongkakLastMove } from './congkak/state.js';

export { checkers } from './checkers/index.js';
export * as checkersRules from './checkers/index.js';
export { checkersBot, type CheckersBotView } from './checkers/bot.js';
export type {
  CheckersState,
  CheckersPlayer,
  CheckersConfig,
  CheckersAction,
  CheckersPiece,
  CheckersPos,
  CheckersSide,
} from './checkers/state.js';
export type { CheckersView, CheckersPublicPlayer, CheckersLastMove, CheckersLegalMove } from './checkers/state.js';

export { bigTwo } from './big-two/index.js';
export * as bigTwoRules from './big-two/index.js';
export { bigTwoBot, type BigTwoBotView } from './big-two/bot.js';
export type {
  BigTwoState,
  BigTwoPlayer,
  BigTwoConfig,
  BigTwoAction,
  BigTwoCard,
  BigTwoCombo,
  BigTwoComboCategory,
} from './big-two/state.js';
export type { BigTwoView, BigTwoPublicPlayer, BigTwoLastPlay } from './big-two/state.js';

import type { GameId } from '@puzzle-arena/shared';
import { propertyTycoon } from './property-tycoon/index.js';
import { manorMystery } from './manor-mystery/index.js';
import { scrabble } from './scrabble/index.js';
import { congkak } from './congkak/index.js';
import { checkers } from './checkers/index.js';
import { bigTwo } from './big-two/index.js';
import type { GameEngine } from './engine.js';

/** Board-game engines by id. Puzzles are handled by packages/puzzles. */
export const BOARD_ENGINES: Partial<Record<GameId, GameEngine<never, never>>> = {
  'property-tycoon': propertyTycoon as unknown as GameEngine<never, never>,
  'manor-mystery': manorMystery as unknown as GameEngine<never, never>,
  scrabble: scrabble as unknown as GameEngine<never, never>,
  congkak: congkak as unknown as GameEngine<never, never>,
  checkers: checkers as unknown as GameEngine<never, never>,
  'big-two': bigTwo as unknown as GameEngine<never, never>,
};
