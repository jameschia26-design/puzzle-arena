import type { BotDifficulty, Rng } from '@puzzle-arena/shared';
import type { BotPolicy } from '../bot.js';
import type { CongkakAction } from './state.js';

export interface CongkakBotPublicPlayer {
  id: string;
  seat: number;
  storehouse: number;
}

export interface CongkakBotView {
  pits: number[];
  storehouses: [number, number];
  players: CongkakBotPublicPlayer[];
  current: string | null;
  phase: 'pick' | 'game_over';
  pitsPerSide: number;
  you: {
    id: string;
    playerIndex: 0 | 1;
    sidePits: [number, number];
  } | null;
}

function oppositePit(pitIndex: number, nPits: number): number {
  return 2 * nPits - 1 - pitIndex;
}

function isPlayerPit(playerIndex: 0 | 1, pitIndex: number, nPits: number): boolean {
  if (playerIndex === 0) return pitIndex >= 0 && pitIndex < nPits;
  return pitIndex >= nPits && pitIndex < 2 * nPits;
}

type SimPos = { kind: 'pit'; index: number } | { kind: 'storehouse'; player: 0 | 1 };

function nextTrack(cur: SimPos, playerIndex: 0 | 1, nPits: number): SimPos {
  if (cur.kind === 'pit') {
    if (cur.index === nPits - 1) {
      if (playerIndex === 0) return { kind: 'storehouse', player: 0 };
      return { kind: 'pit', index: nPits };
    }
    if (cur.index === 2 * nPits - 1) {
      if (playerIndex === 1) return { kind: 'storehouse', player: 1 };
      return { kind: 'pit', index: 0 };
    }
    return { kind: 'pit', index: cur.index + 1 };
  }
  if (cur.player === 0) return { kind: 'pit', index: nPits };
  return { kind: 'pit', index: 0 };
}

interface SimState {
  pits: number[];
  storehouses: [number, number];
  nextPlayer: 0 | 1;
  isOver: boolean;
  extraTurn: boolean;
  tembakCapture: number;
}

function simulateMove(
  pits: number[],
  storehouses: [number, number],
  playerIndex: 0 | 1,
  startPit: number,
  nPits: number,
): SimState {
  const currentPits = [...pits];
  const currentStorehouses: [number, number] = [storehouses[0], storehouses[1]];

  let hand = currentPits[startPit] ?? 0;
  currentPits[startPit] = 0;

  let curPos: SimPos = { kind: 'pit', index: startPit };
  let extraTurn = false;
  let tembakCapture = 0;
  let safety = 500;

  while (hand > 0 && safety-- > 0) {
    while (hand > 0) {
      curPos = nextTrack(curPos, playerIndex, nPits);
      hand--;
      if (curPos.kind === 'storehouse') {
        currentStorehouses[curPos.player]++;
      } else {
        currentPits[curPos.index] = (currentPits[curPos.index] ?? 0) + 1;
      }
    }

    if (curPos.kind === 'storehouse') {
      extraTurn = true;
      break;
    }

    const land = curPos.index;
    const count = currentPits[land] ?? 0;

    if (count > 1) {
      hand = count;
      currentPits[land] = 0;
      continue;
    }

    if (isPlayerPit(playerIndex, land, nPits)) {
      const opp = oppositePit(land, nPits);
      const oppCount = currentPits[opp] ?? 0;
      if (oppCount > 0) {
        const total = oppCount + 1;
        currentPits[land] = 0;
        currentPits[opp] = 0;
        currentStorehouses[playerIndex] += total;
        tembakCapture = total;
      }
    }
    break;
  }

  const hasMoves = (pIdx: 0 | 1) => {
    const start = pIdx === 0 ? 0 : nPits;
    const end = pIdx === 0 ? nPits - 1 : 2 * nPits - 1;
    for (let i = start; i <= end; i++) {
      if ((currentPits[i] ?? 0) > 0) return true;
    }
    return false;
  };

  let nextPlayer: 0 | 1 = extraTurn ? playerIndex : ((1 - playerIndex) as 0 | 1);
  if (!hasMoves(nextPlayer)) {
    const alt = (1 - nextPlayer) as 0 | 1;
    if (hasMoves(alt)) {
      nextPlayer = alt;
    }
  }

  const isOver = !hasMoves(0) && !hasMoves(1);

  return {
    pits: currentPits,
    storehouses: currentStorehouses,
    nextPlayer,
    isOver,
    extraTurn,
    tembakCapture,
  };
}

function getLegalPits(pits: number[], playerIndex: 0 | 1, nPits: number): number[] {
  const start = playerIndex === 0 ? 0 : nPits;
  const end = playerIndex === 0 ? nPits - 1 : 2 * nPits - 1;
  const moves: number[] = [];
  for (let i = start; i <= end; i++) {
    if ((pits[i] ?? 0) > 0) moves.push(i);
  }
  return moves;
}

function evaluateBoard(
  pits: number[],
  storehouses: [number, number],
  playerIndex: 0 | 1,
  nPits: number,
): number {
  const oppIndex = (1 - playerIndex) as 0 | 1;
  const scoreDiff = (storehouses[playerIndex] - storehouses[oppIndex]) * 10;

  let mySideSeeds = 0;
  let oppSideSeeds = 0;
  let tembakThreats = 0;

  for (let i = 0; i < nPits; i++) {
    const myPit = playerIndex === 0 ? i : nPits + i;
    const oppPit = playerIndex === 0 ? nPits + (nPits - 1 - i) : nPits - 1 - i;

    const myCount = pits[myPit] ?? 0;
    const oppCount = pits[oppPit] ?? 0;

    mySideSeeds += myCount;
    oppSideSeeds += oppCount;

    // Vulnerability penalty: if opponent has an empty pit opposite our loaded pit
    if (oppCount === 0 && myCount > 4) {
      tembakThreats += myCount;
    }
  }

  return scoreDiff + (mySideSeeds - oppSideSeeds) * 2 - tembakThreats * 3;
}

function minimax(
  pits: number[],
  storehouses: [number, number],
  playerIndex: 0 | 1,
  perspective: 0 | 1,
  depth: number,
  alpha: number,
  beta: number,
  nPits: number,
): number {
  if (depth <= 0) {
    return evaluateBoard(pits, storehouses, perspective, nPits);
  }

  const legal = getLegalPits(pits, playerIndex, nPits);
  if (legal.length === 0) {
    return evaluateBoard(pits, storehouses, perspective, nPits);
  }

  const isMaximizing = playerIndex === perspective;

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of legal) {
      const sim = simulateMove(pits, storehouses, playerIndex, move, nPits);
      let ev = 0;
      if (sim.isOver) {
        ev = ((sim.storehouses[perspective] ?? 0) - (sim.storehouses[(1 - perspective) as 0 | 1] ?? 0)) * 1000;
      } else {
        const nextDepth = depth - 1;
        ev = minimax(
          sim.pits,
          sim.storehouses,
          sim.nextPlayer,
          perspective,
          nextDepth,
          alpha,
          beta,
          nPits,
        );
        if (sim.extraTurn) ev += 15;
        if (sim.tembakCapture > 0) ev += sim.tembakCapture * 4;
      }
      maxEval = Math.max(maxEval, ev);
      alpha = Math.max(alpha, ev);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of legal) {
      const sim = simulateMove(pits, storehouses, playerIndex, move, nPits);
      let ev = 0;
      if (sim.isOver) {
        ev = ((sim.storehouses[perspective] ?? 0) - (sim.storehouses[(1 - perspective) as 0 | 1] ?? 0)) * 1000;
      } else {
        const nextDepth = depth - 1;
        ev = minimax(
          sim.pits,
          sim.storehouses,
          sim.nextPlayer,
          perspective,
          nextDepth,
          alpha,
          beta,
          nPits,
        );
        if (sim.extraTurn) ev -= 15;
        if (sim.tembakCapture > 0) ev -= sim.tembakCapture * 4;
      }
      minEval = Math.min(minEval, ev);
      beta = Math.min(beta, ev);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

export const congkakBot: BotPolicy<CongkakBotView, CongkakAction> = {
  chooseAction(view: CongkakBotView, selfId: string, rng: Rng, difficulty: BotDifficulty): CongkakAction {
    const playerIndex = view.players.findIndex((p) => p.id === selfId);
    const pIdx: 0 | 1 = playerIndex === 1 ? 1 : 0;
    const nPits = view.pitsPerSide ?? 7;

    const legal = getLegalPits(view.pits, pIdx, nPits);
    if (legal.length === 0) {
      const start = pIdx === 1 ? nPits : 0;
      return { type: 'sow', pitIndex: start };
    }

    if (difficulty === 'easy') {
      // Easy: mostly picks moves that give extra turns or simple captures, with 40% noise
      if (rng.next() < 0.4) {
        const choice = legal[rng.int(legal.length)] ?? legal[0] ?? 0;
        return { type: 'sow', pitIndex: choice };
      }
    }

    const depth = difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1;
    let bestMove = legal[0] ?? 0;
    let bestScore = -Infinity;

    for (const move of legal) {
      const sim = simulateMove(view.pits, view.storehouses, pIdx, move, nPits);
      let score = 0;
      if (sim.isOver) {
        score = ((sim.storehouses[pIdx] ?? 0) - (sim.storehouses[(1 - pIdx) as 0 | 1] ?? 0)) * 1000;
      } else {
        const nextDepth = depth - 1;
        score = minimax(
          sim.pits,
          sim.storehouses,
          sim.nextPlayer,
          pIdx,
          nextDepth,
          -Infinity,
          Infinity,
          nPits,
        );
        if (sim.extraTurn) score += 20;
        if (sim.tembakCapture > 0) score += sim.tembakCapture * 6;
      }

      // Add a tiny deterministic jitter to break ties nicely
      const jitter = rng.next() * 0.1;
      const totalScore = score + jitter;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestMove = move;
      }
    }

    return { type: 'sow', pitIndex: bestMove };
  },
};
