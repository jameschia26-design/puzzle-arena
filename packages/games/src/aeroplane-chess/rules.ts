import type {
  AeroplaneChessCapture,
  AeroplaneChessPlayer,
  AeroplaneChessState,
} from './state.js';

export const RING_SIZE = 52;
export const HOME_STRETCH_LEN = 6;
/** Highest relative step still on the shared ring (steps 0..50 = 51 ring
 *  squares; a token's own off-ramp square is never visited in its own
 *  relative coordinates — it peels into the home stretch there instead). */
export const LAST_RING_REL = 50;
/** Relative step at which a token reaches home, finished. */
export const HOME_STEP = LAST_RING_REL + HOME_STRETCH_LEN; // 57

/** Which of the 4 fixed quadrants are in play for a given room size. Chosen
 *  so 2 players sit opposite each other and 3 players use three of the four
 *  quadrants, matching how Ludo boards are conventionally shared. */
export const QUADRANTS_BY_COUNT: Record<number, number[]> = {
  2: [0, 2],
  3: [0, 1, 2],
  4: [0, 1, 2, 3],
};

/** Absolute ring square (0..51) where quadrant q's tokens are released. */
export function entrySquare(quadrant: number): number {
  return quadrant * 13;
}

/** Every quadrant's entry square is safe ground for every player. */
export const SAFE_SQUARES = new Set([0, 13, 26, 39]);

/** A small set of one-way shortcut squares — the "flying" in Aeroplane Chess.
 *  Landing exactly on a key teleports the token to its paired square. Chosen
 *  to avoid every quadrant's entry/off-ramp squares, and to never chain (no
 *  destination is itself a source). */
export const FLY_MAP: Record<number, number> = { 4: 16, 17: 29, 30: 42, 43: 3 };

export function absoluteSquare(quadrant: number, relSteps: number): number {
  return (entrySquare(quadrant) + relSteps) % RING_SIZE;
}

function relativeFromAbsolute(quadrant: number, abs: number): number {
  return ((abs - entrySquare(quadrant)) % RING_SIZE + RING_SIZE) % RING_SIZE;
}

export function playerById(s: AeroplaneChessState, id: string): AeroplaneChessPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

export function playerIndexById(s: AeroplaneChessState, id: string): number {
  return s.players.findIndex((p) => p.id === id);
}

/** Token indices a player may legally move with a given roll. */
export function legalTokenIndices(player: AeroplaneChessPlayer, diceValue: number): number[] {
  const legal: number[] = [];
  for (let i = 0; i < player.tokens.length; i++) {
    const t = player.tokens[i] as { steps: number };
    if (t.steps === -1) {
      if (diceValue === 6) legal.push(i);
      continue;
    }
    if (t.steps === HOME_STEP) continue;
    if (t.steps + diceValue > HOME_STEP) continue; // overshoot
    legal.push(i);
  }
  return legal;
}

export interface ApplyMoveResult {
  from: number;
  to: number;
  released: boolean;
  flew: boolean;
  reachedHome: boolean;
  captured: AeroplaneChessCapture[];
}

/** Mutates `state.players` in place: moves one token, resolves flying and
 *  captures. Caller is responsible for validating the move is legal first. */
export function applyMovePlane(
  state: AeroplaneChessState,
  playerIndex: number,
  tokenIndex: number,
  diceValue: number,
): ApplyMoveResult {
  const player = state.players[playerIndex] as AeroplaneChessPlayer;
  const token = player.tokens[tokenIndex] as { steps: number };
  const from = token.steps;
  let released = false;

  if (from === -1) {
    token.steps = 0;
    released = true;
  } else {
    token.steps = from + diceValue;
  }

  let flew = false;
  if (token.steps >= 0 && token.steps <= LAST_RING_REL) {
    const abs = absoluteSquare(player.quadrant, token.steps);
    const dest = FLY_MAP[abs];
    if (dest !== undefined) {
      token.steps = relativeFromAbsolute(player.quadrant, dest);
      flew = true;
    }
  }

  const captured: AeroplaneChessCapture[] = [];
  if (token.steps >= 0 && token.steps <= LAST_RING_REL) {
    const abs = absoluteSquare(player.quadrant, token.steps);
    if (!SAFE_SQUARES.has(abs)) {
      for (const other of state.players) {
        if (other.id === player.id) continue;
        for (let j = 0; j < other.tokens.length; j++) {
          const ot = other.tokens[j] as { steps: number };
          if (ot.steps >= 0 && ot.steps <= LAST_RING_REL && absoluteSquare(other.quadrant, ot.steps) === abs) {
            ot.steps = -1;
            captured.push({ playerId: other.id, tokenIndex: j });
          }
        }
      }
    }
  }

  return { from, to: token.steps, released, flew, reachedHome: token.steps === HOME_STEP, captured };
}

export function hasWon(player: AeroplaneChessPlayer): boolean {
  return player.tokens.every((t) => t.steps === HOME_STEP);
}

/** Whoever the game is waiting on right now, or null once it is over. */
export function actorToAct(s: AeroplaneChessState): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.current]?.id ?? null;
}
