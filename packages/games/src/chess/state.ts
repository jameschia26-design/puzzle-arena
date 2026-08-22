import type { LogEntry } from '@puzzle-arena/shared';
import type { BaseState } from '../engine.js';
import type { CastlingRights, ChessPiece, PieceType, Side } from './movegen.js';

export type { CastlingRights, ChessPiece, PieceType, Side } from './movegen.js';

export interface ChessConfig {
  /** Total per-player time bank, in minutes. Owned/enforced by the server runtime, not the reducer. */
  clockMinutes: number;
  /** Fischer increment, seconds, applied by the runtime after each accepted move. */
  incrementSec: number;
  allowTakeback: boolean;
}

export interface ChessPlayer {
  id: string;
  seat: number;
  /** Opponent pieces this player has captured. */
  capturedCount: number;
  actionsSubmitted: number;
  actionsAccepted: number;
  penalties: number;
}

export interface MoveRecord {
  playerId: string;
  side: Side;
  from: number;
  to: number;
  piece: PieceType;
  promotion?: PieceType | undefined;
  captured?: PieceType | undefined;
  isEnPassant?: boolean | undefined;
  isCastle?: ('K' | 'Q') | undefined;
  isDoublePush?: boolean | undefined;
  san: string;
}

export type ChessPhase = 'playing' | 'game_over';

export type ChessWinReason = 'checkmate' | 'resign' | 'time' | 'idle' | 'stalemate' | 'flag' | null;

export type ChessDrawReason = 'agreement' | 'stalemate' | 'fifty' | 'threefold' | 'material' | null;

export interface ChessState extends BaseState {
  config: ChessConfig;
  players: [ChessPlayer, ChessPlayer];
  /** 64 squares, a1=0 .. h8=63. */
  board: (ChessPiece | null)[];
  current: 0 | 1;
  castling: CastlingRights;
  epSquare: number | null;
  halfmoveClock: number;
  fullmove: number;
  history: MoveRecord[];
  /** positionKey -> occurrence count, for threefold/fivefold repetition. */
  repetition: Record<string, number>;
  drawOffer: string | null;
  takebackOffer: string | null;
  phase: ChessPhase;
  winner: string | null;
  winReason: ChessWinReason;
  drawReason: ChessDrawReason;
  log: LogEntry[];
}

/**
 * The wire action schema (`@puzzle-arena/shared`'s `chessActionSchema`)
 * deliberately excludes `forfeit` — only the server runtime's chess-clock
 * logic may produce one (time-out / 4-minute idle cap), never a client. We
 * widen the engine-local action type here so `reduce` can still accept it
 * via the exact same calling convention as every other action, with
 * `playerId` naming the player being forfeited.
 */
export type ChessAction =
  | { type: 'move'; from: number; to: number; promotion?: ('q' | 'r' | 'b' | 'n') | undefined }
  | { type: 'resign' }
  | { type: 'offer_draw' }
  | { type: 'respond_draw'; accept: boolean }
  | { type: 'offer_takeback' }
  | { type: 'respond_takeback'; accept: boolean }
  | { type: 'claim_draw' }
  | { type: 'forfeit'; reason: 'time' | 'idle' };

export interface ChessPublicPlayer {
  id: string;
  seat: number;
  side: Side;
  capturedCount: number;
}

export interface ChessView {
  board: (ChessPiece | null)[];
  players: ChessPublicPlayer[];
  current: string | null;
  phase: ChessPhase;
  castling: CastlingRights;
  epSquare: number | null;
  halfmoveClock: number;
  history: MoveRecord[];
  winner: string | null;
  winReason: ChessWinReason;
  drawReason: ChessDrawReason;
  drawOffer: string | null;
  takebackOffer: string | null;
  log: LogEntry[];
  you: {
    id: string;
    side: Side;
    /** Full legal move list — only populated when it is this player's turn. */
    legalMoves: import('./movegen.js').ChessMove[];
    inCheck: boolean;
  } | null;
}
