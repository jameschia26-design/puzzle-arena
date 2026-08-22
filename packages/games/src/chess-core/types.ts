/**
 * Plain, state-free primitives shared by the chess and xiangqi engines' bots.
 * Nothing here may reference `ChessState`/`XiangqiState` or any other
 * engine-specific state type — see the header comment in `search.ts` for why.
 */

/** 0 = the side that moves first (White / Red), 1 = the other side. */
export type Side = 0 | 1;

export interface Piece {
  type: string;
  side: Side;
}

/**
 * A minimal move shape. Concrete games extend this with whatever extra
 * metadata they need (captured piece, promotion, special-move flags) — the
 * search engine only ever treats a move as an opaque token it can pass back
 * into `makeMove`.
 */
export interface Move {
  from: number;
  to: number;
}
