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
export { reversi } from './reversi/index.js';
export * as reversiRules from './reversi/index.js';
export { reversiBot, type ReversiBotView } from './reversi/bot.js';
export type {
  ReversiState,
  ReversiPlayer,
  ReversiConfig,
  ReversiAction,
  ReversiSide,
  ReversiLastMove,
  ReversiView,
} from './reversi/state.js';
export { connect4 } from './connect4/index.js';
export * as connect4Rules from './connect4/index.js';
export { connect4Bot, type Connect4BotView } from './connect4/bot.js';
export type {
  Connect4State,
  Connect4Player,
  Connect4Config,
  Connect4Action,
  Connect4Side,
  Connect4LastMove,
  Connect4View,
} from './connect4/state.js';

export { chess } from './chess/index.js';
export * as chessRules from './chess/rules.js';
export { chessBot, type ChessBotView, type ChessBotAction } from './chess/bot.js';
export type {
  ChessState,
  ChessPlayer,
  ChessConfig,
  ChessAction,
  ChessPiece,
  Side as ChessSide,
  PieceType as ChessPieceType,
  CastlingRights as ChessCastlingRights,
  MoveRecord as ChessMoveRecord,
} from './chess/state.js';
export type { ChessView, ChessPublicPlayer } from './chess/state.js';
export type { ChessMove } from './chess/movegen.js';

export { xiangqi } from './xiangqi/index.js';
export * as xiangqiRules from './xiangqi/index.js';
export { xiangqiBot, type XiangqiBotView, type XiangqiBotAction } from './xiangqi/bot.js';
export type {
  XiangqiState,
  XiangqiPlayer,
  XiangqiConfig,
  XiangqiAction,
  XiangqiPiece,
  XiangqiPieceType,
  XiangqiSide,
  MoveRecord as XiangqiMoveRecord,
} from './xiangqi/state.js';
export type { XiangqiView, XiangqiPublicPlayer, XiangqiLegalMove } from './xiangqi/state.js';

export { animalChess } from './animal-chess/index.js';
export * as animalChessRules from './animal-chess/index.js';
export { animalChessBot, type AnimalChessBotView, type AnimalChessBotAction } from './animal-chess/bot.js';
export type {
  AnimalChessState,
  AnimalChessPlayer,
  AnimalChessConfig,
  AnimalChessAction,
  AnimalPiece,
  AnimalSide,
  AnimalType,
  AnimalChessMoveRecord,
} from './animal-chess/state.js';
export type { AnimalChessView, AnimalChessPublicPlayer, AnimalChessLegalMove } from './animal-chess/state.js';

export { tetris } from './tetris/index.js';
export * as tetrisRules from './tetris/rules.js';
export { tetrisBot, type TetrisBotView } from './tetris/bot.js';
export type { TetrisState, TetrisPlayerState, TetrisConfig, TetrisAction, TetrisView, TetrisPublicPlayer, TetrominoKind } from './tetris/state.js';

export { pacman } from './pacman/index.js';
export * as pacmanRules from './pacman/rules.js';
export { pacmanBot, type PacManBotView } from './pacman/bot.js';
export type { PacManState, PacManPlayerState, PacManConfig, PacManAction, PacManView, PacManPublicPlayer, GhostState } from './pacman/state.js';
export { spaceInvaders } from './space-invaders/index.js';
export * as spaceInvadersRules from './space-invaders/rules.js';
export { spaceInvadersBot, type SpaceInvadersBotView } from './space-invaders/bot.js';
export { PLAYFIELD_W, PLAYFIELD_H } from './space-invaders/state.js';
export type {
  SpaceInvadersState,
  SpaceInvadersPlayerState,
  SpaceInvadersConfig,
  SpaceInvadersAction,
  SpaceInvadersView,
  SpaceInvadersPublicPlayer,
  Alien,
  AlienType,
  Bunker,
  Bullet,
  AlienBomb,
  UFO,
} from './space-invaders/state.js';

export { bomberman } from './bomberman/index.js';
export * as bombermanRules from './bomberman/rules.js';
export { bombermanBot, type BombermanBotView } from './bomberman/bot.js';
export {
  ARENA_W,
  ARENA_H,
  ARENA_SIZE,
  TILE_EMPTY,
  TILE_HARD,
  TILE_SOFT,
} from './bomberman/state.js';
export type {
  BombermanState,
  BombermanPlayerState,
  BombermanConfig,
  BombermanAction,
  BombermanView,
  BombermanPublicPlayer,
  BombState,
  BlastCell,
  PowerUpItem,
  PowerUpKind,
  Dir,
  Tile,
} from './bomberman/state.js';

import type { GameId } from '@puzzle-arena/shared';
import { propertyTycoon } from './property-tycoon/index.js';
import { manorMystery } from './manor-mystery/index.js';
import { scrabble } from './scrabble/index.js';
import { congkak } from './congkak/index.js';
import { checkers } from './checkers/index.js';
import { bigTwo } from './big-two/index.js';
import { reversi } from './reversi/index.js';
import { connect4 } from './connect4/index.js';
import { chess } from './chess/index.js';
import { xiangqi } from './xiangqi/index.js';
import { animalChess } from './animal-chess/index.js';
import { tetris } from './tetris/index.js';
import { pacman } from './pacman/index.js';
import { spaceInvaders } from './space-invaders/index.js';
import { bomberman } from './bomberman/index.js';
import type { GameEngine } from './engine.js';

/** Board-game engines by id. Puzzles are handled by packages/puzzles. */
export const BOARD_ENGINES: Partial<Record<GameId, GameEngine<never, never>>> = {
  'property-tycoon': propertyTycoon as unknown as GameEngine<never, never>,
  'manor-mystery': manorMystery as unknown as GameEngine<never, never>,
  scrabble: scrabble as unknown as GameEngine<never, never>,
  congkak: congkak as unknown as GameEngine<never, never>,
  checkers: checkers as unknown as GameEngine<never, never>,
  'big-two': bigTwo as unknown as GameEngine<never, never>,
  reversi: reversi as unknown as GameEngine<never, never>,
  connect4: connect4 as unknown as GameEngine<never, never>,
  chess: chess as unknown as GameEngine<never, never>,
  xiangqi: xiangqi as unknown as GameEngine<never, never>,
  'animal-chess': animalChess as unknown as GameEngine<never, never>,
  tetris: tetris as unknown as GameEngine<never, never>,
  pacman: pacman as unknown as GameEngine<never, never>,
  'space-invaders': spaceInvaders as unknown as GameEngine<never, never>,
  bomberman: bomberman as unknown as GameEngine<never, never>,
};
