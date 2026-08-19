import type { CongkakPlayer, CongkakState } from './state.js';

export const playerById = (s: CongkakState, id: string): CongkakPlayer | undefined =>
  s.players.find((p) => p.id === id);

export function pitsPerSide(s: CongkakState): number {
  return s.config.pitsPerSide ?? 7;
}

export function totalPits(s: CongkakState): number {
  return (s.config.pitsPerSide ?? 7) * 2;
}

export function playerSideRange(playerIndex: 0 | 1, nPits: number): [number, number] {
  if (playerIndex === 0) return [0, nPits - 1];
  return [nPits, 2 * nPits - 1];
}

export function isPlayerPit(playerIndex: 0 | 1, pitIndex: number, nPits: number): boolean {
  if (playerIndex === 0) return pitIndex >= 0 && pitIndex < nPits;
  return pitIndex >= nPits && pitIndex < 2 * nPits;
}

export function oppositePit(pitIndex: number, nPits: number): number {
  return 2 * nPits - 1 - pitIndex;
}

export type TrackPosition =
  | { kind: 'pit'; index: number }
  | { kind: 'storehouse'; player: 0 | 1 };

export function nextTrackPosition(
  cur: TrackPosition,
  playerIndex: 0 | 1,
  nPits: number,
): TrackPosition {
  if (cur.kind === 'pit') {
    if (cur.index === nPits - 1) {
      // End of Player 0's row
      if (playerIndex === 0) return { kind: 'storehouse', player: 0 };
      return { kind: 'pit', index: nPits }; // Player 1 skips P0 storehouse
    }
    if (cur.index === 2 * nPits - 1) {
      // End of Player 1's row
      if (playerIndex === 1) return { kind: 'storehouse', player: 1 };
      return { kind: 'pit', index: 0 }; // Player 0 skips P1 storehouse
    }
    return { kind: 'pit', index: cur.index + 1 };
  }

  // From storehouse into the next opponent/own pit
  if (cur.player === 0) {
    return { kind: 'pit', index: nPits };
  }
  return { kind: 'pit', index: 0 };
}

export interface SowResult {
  pits: number[];
  storehouses: [number, number];
  relayHops: number;
  landedInStorehouse: boolean;
  tembakPit?: number | undefined;
  capturedSeeds?: number | undefined;
  nextPlayerIndex: 0 | 1;
  gameOver: boolean;
  winner: string | null;
  winReason: CongkakState['winReason'];
}

/**
 * Pure simulation of the Congkak sowing process including continuous relay runs (jalan berterusan),
 * storehouse extra turns, and tembak captures.
 */
export function executeSow(
  pits: number[],
  storehouses: [number, number],
  playerIndex: 0 | 1,
  startPit: number,
  nPits: number,
  players: [CongkakPlayer, CongkakPlayer],
): SowResult {
  const currentPits = [...pits];
  const currentStorehouses: [number, number] = [storehouses[0], storehouses[1]];

  let hand = currentPits[startPit] ?? 0;
  currentPits[startPit] = 0;

  let curPos: TrackPosition = { kind: 'pit', index: startPit };
  let relayHops = 0;
  let landedInStorehouse = false;
  let tembakPit: number | undefined;
  let capturedSeeds: number | undefined;

  let safety = 1000;

  while (hand > 0 && safety-- > 0) {
    while (hand > 0) {
      curPos = nextTrackPosition(curPos, playerIndex, nPits);
      hand--;
      if (curPos.kind === 'storehouse') {
        currentStorehouses[curPos.player] = (currentStorehouses[curPos.player] ?? 0) + 1;
      } else {
        currentPits[curPos.index] = (currentPits[curPos.index] ?? 0) + 1;
      }
    }

    // Check where the final seed landed
    if (curPos.kind === 'storehouse') {
      // Landed directly in the player's own storehouse -> Extra turn!
      landedInStorehouse = true;
      break;
    }

    const landIndex = curPos.index;
    const pitCount = currentPits[landIndex] ?? 0;

    if (pitCount > 1) {
      // Case 1: Relay Sowing (Jalan Berterusan) - Scoop all seeds and continue
      hand = pitCount;
      currentPits[landIndex] = 0;
      relayHops++;
      continue;
    }

    // Final seed landed in a pit that was previously empty (pitCount === 1)
    if (isPlayerPit(playerIndex, landIndex, nPits)) {
      // Case 2: Landed in empty pit on player's own side -> Check for Tembak (Capture)
      const opp = oppositePit(landIndex, nPits);
      const oppSeeds = currentPits[opp] ?? 0;
      if (oppSeeds > 0) {
        // Tembak! Capture the 1 seed + all opponent seeds into own storehouse
        const totalCaptured = oppSeeds + 1;
        currentPits[landIndex] = 0;
        currentPits[opp] = 0;
        currentStorehouses[playerIndex] += totalCaptured;
        tembakPit = landIndex;
        capturedSeeds = totalCaptured;
      }
    }
    // Case 3: Landed in empty pit on opponent side or empty with 0 opposite -> Mati (Turn ends)
    break;
  }

  // Determine next turn
  const p0Range = playerSideRange(0, nPits);
  const p1Range = playerSideRange(1, nPits);

  const hasMoves = (pIdx: 0 | 1) => {
    const [from, to] = playerSideRange(pIdx, nPits);
    for (let i = from; i <= to; i++) {
      if ((currentPits[i] ?? 0) > 0) return true;
    }
    return false;
  };

  let nextPlayerIndex: 0 | 1 = playerIndex;

  if (landedInStorehouse) {
    if (!hasMoves(playerIndex)) {
      // Player earned an extra turn but has no seeds in their houses
      nextPlayerIndex = (1 - playerIndex) as 0 | 1;
    }
  } else {
    // Normal turn pass
    nextPlayerIndex = (1 - playerIndex) as 0 | 1;
  }

  // If next player has no moves, check if the other player does
  if (!hasMoves(nextPlayerIndex)) {
    const alt = (1 - nextPlayerIndex) as 0 | 1;
    if (hasMoves(alt)) {
      nextPlayerIndex = alt;
    }
  }

  // Check Game Over: neither player can move
  let gameOver = false;
  let winner: string | null = null;
  let winReason: CongkakState['winReason'] = null;

  if (!hasMoves(0) && !hasMoves(1)) {
    gameOver = true;
    winReason = 'all-captured';
    // Sweep any remaining seeds (if any) to their side
    for (let i = p0Range[0]; i <= p0Range[1]; i++) {
      currentStorehouses[0] += currentPits[i] ?? 0;
      currentPits[i] = 0;
    }
    for (let i = p1Range[0]; i <= p1Range[1]; i++) {
      currentStorehouses[1] += currentPits[i] ?? 0;
      currentPits[i] = 0;
    }

    if (currentStorehouses[0] > currentStorehouses[1]) {
      winner = players[0].id;
    } else if (currentStorehouses[1] > currentStorehouses[0]) {
      winner = players[1].id;
    } else {
      winner = null; // Draw
    }
  }

  return {
    pits: currentPits,
    storehouses: currentStorehouses,
    relayHops,
    landedInStorehouse,
    tembakPit,
    capturedSeeds,
    nextPlayerIndex,
    gameOver,
    winner,
    winReason,
  };
}

/** Whoever the game is waiting on right now, or null once it is over. */
export function actorToAct(s: CongkakState): string | null {
  if (s.phase === 'game_over') return null;
  return s.players[s.current]?.id ?? null;
}

export function legalPits(s: CongkakState, playerId: string): number[] {
  if (s.phase === 'game_over') return [];
  const player = playerById(s, playerId);
  if (!player) return [];
  const pIndex = s.players.findIndex((p) => p.id === playerId) as 0 | 1;
  if (pIndex !== s.current) return [];

  const nPits = pitsPerSide(s);
  const [start, end] = playerSideRange(pIndex, nPits);
  const legal: number[] = [];
  for (let i = start; i <= end; i++) {
    if ((s.pits[i] ?? 0) > 0) legal.push(i);
  }
  return legal;
}
