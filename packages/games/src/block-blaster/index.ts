import type { LogEntry, ScoreInput, BlockBlasterConfig } from '@puzzle-arena/shared';
import {
  mulberry32,
  rngFrom,
  canPlacePiece,
  BLOCK_BLASTER_BOARD_SIZE,
} from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  createEmptyBoard,
  createStartingBoard,
  generateBatch,
  applyPlacement,
  checkGameOver,
} from './rules.js';
import type {
  BlockBlasterAction,
  BlockBlasterPlayerState,
  BlockBlasterPublicPlayer,
  BlockBlasterState,
  BlockBlasterView,
} from './state.js';

export * from './state.js';
export * from './rules.js';

const DEFAULT_CONFIG: BlockBlasterConfig = {
  turnTimeLimitSec: 0,
  difficulty: 'normal',
  startingLayout: 'templated',
};
function clone(s: BlockBlasterState): BlockBlasterState {
  return structuredClone(s);
}

function playerById(s: BlockBlasterState, id: string): BlockBlasterPlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

function toPublic(p: BlockBlasterPlayerState): BlockBlasterPublicPlayer {
  return {
    id: p.id,
    seat: p.seat,
    board: p.board,
    tray: p.tray,
    score: p.score,
    highScore: p.highScore,
    comboStreak: p.comboStreak,
    linesCleared: p.linesCleared,
    piecesPlaced: p.piecesPlaced,
    gameOver: p.gameOver,
    lastClear: p.lastClear,
  };
}

function setup(playerIds: string[], seed: number, rawConfig: unknown): BlockBlasterState {
  const config = { ...DEFAULT_CONFIG, ...((rawConfig as object) ?? {}) };
  const rng = mulberry32(seed);
  const players: BlockBlasterPlayerState[] = playerIds.map((id, seat) => {
    const board = createStartingBoard(config.startingLayout, config.difficulty, seed + seat);
    const tray = generateBatch(board, rng, config.difficulty, 0);
    return {
      id,
      seat,
      board,
      tray,
      score: 0,
      highScore: 0,
      comboStreak: 0,
      linesCleared: 0,
      piecesPlaced: 0,
      gameOver: false,
      lastClear: null,
      actionsSubmitted: 0,
      actionsAccepted: 0,
      penalties: 0,
    };
  });

  const state: BlockBlasterState = {
    rng: { seed, calls: rng.calls },
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players,
    phase: 'playing',
    log: [],
    winner: null,
  };

  state.log = stampLogs(state, [makeLog('Block Blaster started')]);
  return state;
}

function reduce(
  prev: BlockBlasterState,
  playerId: string,
  action: BlockBlasterAction,
): ReduceResult<BlockBlasterState> {
  const s = clone(prev);
  const p = playerById(s, playerId);
  if (!p) return { ok: false, error: 'Unknown player' };

  const rng = rngFrom(s.rng);
  const logs: LogEntry[] = [];
  if (action.type === 'restart') {
    if (action.difficulty) {
      s.config.difficulty = action.difficulty;
    }
    if (action.startingLayout) {
      s.config.startingLayout = action.startingLayout;
    }
    p.board = createStartingBoard(s.config.startingLayout, s.config.difficulty, s.rng.calls + p.seat);
    p.tray = generateBatch(p.board, rng, s.config.difficulty, 0);
    p.score = 0;
    p.comboStreak = 0;
    p.linesCleared = 0;
    p.piecesPlaced = 0;
    p.gameOver = false;
    p.lastClear = null;
    p.actionsSubmitted++;
    p.actionsAccepted++;

    // If game was over, return to playing if any player is not game over
    if (s.phase === 'game_over') {
      s.phase = 'playing';
      s.winner = null;
    }

    logs.push(makeLog(`Player ${p.seat + 1} restarted their board`, playerId));
    s.rng = { seed: s.rng.seed, calls: rng.calls };
    s.seq++;
    const stamped = stampLogs(s, logs);
    s.log = [...s.log, ...stamped];
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'place') {
    p.actionsSubmitted++;

    if (p.gameOver) {
      p.penalties++;
      return { ok: false, error: 'Game over for this player' };
    }

    const piece = p.tray[action.pieceIndex];
    if (!piece) {
      p.penalties++;
      return { ok: false, error: 'No piece in that tray slot' };
    }

    const result = applyPlacement(p.board, piece, action.row, action.col, p.comboStreak);
    if (!result.ok) {
      p.penalties++;
      return { ok: false, error: result.error ?? 'Invalid placement' };
    }

    p.actionsAccepted++;
    p.board = result.newBoard;
    p.score += result.turnScore;
    if (p.score > p.highScore) {
      p.highScore = p.score;
    }
    p.comboStreak = result.newComboStreak;
    p.piecesPlaced++;
    p.lastClear = result.clearEvent;

    if (result.clearEvent) {
      const lines = result.clearEvent.rows.length + result.clearEvent.cols.length;
      p.linesCleared += lines;
      logs.push(
        makeLog(
          `Player ${p.seat + 1} blasted ${lines} line${lines > 1 ? 's' : ''}! (+${result.turnScore} pts, combo x${result.newComboStreak})`,
          playerId,
        ),
      );
    }

    // Clear placed piece from tray
    p.tray[action.pieceIndex] = null;

    // Refill tray when all 3 slots are empty. Pass the player's current score
    // so the piece mix escalates as the run progresses (see generateBatch).
    if (p.tray.every((slot) => slot === null)) {
      p.tray = generateBatch(p.board, rng, s.config.difficulty, p.score);
    }

    // Check if player has no more moves
    if (checkGameOver(p.board, p.tray)) {
      p.gameOver = true;
      logs.push(makeLog(`Player ${p.seat + 1} ran out of moves! Final score: ${p.score}`, playerId));
    }

    // If all players are game over, end the game
    if (s.players.every((pl) => pl.gameOver)) {
      s.phase = 'game_over';
      const sorted = [...s.players].sort((a, b) => b.score - a.score);
      s.winner = sorted[0]?.id ?? null;
      if (s.winner) {
        const winPlayer = playerById(s, s.winner);
        logs.push(makeLog(`Game over! Player ${(winPlayer?.seat ?? 0) + 1} wins with ${winPlayer?.score ?? 0} points!`));
      }
    }

    s.rng = { seed: s.rng.seed, calls: rng.calls };
    s.seq++;
    const stamped = stampLogs(s, logs);
    s.log = [...s.log, ...stamped];
    return { ok: true, state: s, log: stamped };
  }

  return { ok: false, error: 'Unknown action' };
}

function autoAction(s: BlockBlasterState, playerId: string): BlockBlasterAction {
  const p = playerById(s, playerId);
  if (!p || p.gameOver) return { type: 'restart' };

  for (let i = 0; i < p.tray.length; i++) {
    const piece = p.tray[i];
    if (!piece) continue;

    for (let r = 0; r <= BLOCK_BLASTER_BOARD_SIZE - piece.height; r++) {
      for (let c = 0; c <= BLOCK_BLASTER_BOARD_SIZE - piece.width; c++) {
        if (canPlacePiece(p.board, piece, r, c)) {
          return { type: 'place', pieceIndex: i, row: r, col: c };
        }
      }
    }
  }

  return { type: 'restart' };
}

function view(s: BlockBlasterState, playerId: string | null): BlockBlasterView {
  const you = playerId ? playerById(s, playerId) : undefined;
  return {
    phase: s.phase,
    winner: s.winner,
    you: you ? toPublic(you) : null,
    players: s.players.map(toPublic),
    log: s.log,
    config: s.config,
  };
}

function score(s: BlockBlasterState, playerId: string): ScoreInput {
  const p = playerById(s, playerId);
  if (!p) return { progress: 0, accuracy: 1, completed: false, completedAtMs: null, penalties: 0 };

  const progress = Math.min(1, p.score / 5000);
  const accuracy = p.actionsSubmitted === 0 ? 1 : p.actionsAccepted / p.actionsSubmitted;
  const completed = s.phase === 'game_over' && s.winner === playerId;

  return {
    progress,
    accuracy,
    completed,
    completedAtMs: completed ? (s.winnerAtMs ?? null) : null,
    penalties: p.penalties,
    assetValue: p.score,
  };
}

function isOver(s: BlockBlasterState): { over: boolean; winner?: string } {
  if (s.phase === 'game_over') return s.winner ? { over: true, winner: s.winner } : { over: true };
  return { over: false };
}

function legalActions(s: BlockBlasterState, playerId: string): string[] {
  const p = playerById(s, playerId);
  if (!p || p.gameOver || s.phase === 'game_over') return ['restart'];
  return ['place', 'restart'];
}

export const blockBlaster: GameEngine<BlockBlasterState, BlockBlasterAction> = {
  id: 'block-blaster',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
