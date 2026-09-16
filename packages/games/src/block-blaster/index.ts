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
  selectBonusBombCell,
  applyDetonation,
  getClusterBombCells,
  getCrossBombCells,
  BOMB_COLORS,
  type BombType,
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
    lastDetonation: p.lastDetonation,
    bombs: p.bombs,
    bonusBomb: p.bonusBomb,
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
      lastDetonation: null,
      bombs: [],
      bonusBomb: null,
      roundsCompleted: 0,
      nextBonusBombRound: 4 + Math.floor(rng.next() * 3),
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

  state.log = stampLogs(state, [makeLog('Brick Blaster started')]);
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
    p.lastDetonation = null;
    p.bombs = [];
    p.bonusBomb = null;
    p.roundsCompleted = 0;
    p.nextBonusBombRound = 4 + Math.floor(rng.next() * 3);
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

    const result = applyPlacement(p.board, piece, action.row, action.col, p.comboStreak, p.bonusBomb);
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

    if (result.clearEvent?.claimedBomb) {
      const bombType = result.clearEvent.claimedBomb;
      p.bombs.push(bombType);
      const bombLabel = bombType === 'cluster' ? 'Cluster Bomb (3×3)' : 'Cross Bomb (+)';
      logs.push(makeLog(`Player ${p.seat + 1} cleared the bonus block and claimed a ${bombLabel}!`, playerId));
      p.bonusBomb = null;
    }

    // Clear placed piece from tray
    p.tray[action.pieceIndex] = null;

    // Refill tray when all 3 slots are empty.
    if (p.tray.every((slot) => slot === null)) {
      p.roundsCompleted++;

      // If bonus bomb was not cleared within the same turn of 3 blocks, it expires
      if (p.bonusBomb !== null) {
        logs.push(makeLog(`Player ${p.seat + 1}'s bonus bomb expired!`, playerId));
        p.bonusBomb = null;
      }

      p.tray = generateBatch(p.board, rng, s.config.difficulty, p.score);

      // Spawn bonus bomb after 4 to 6 rounds
      if (p.roundsCompleted >= p.nextBonusBombRound && p.bonusBomb === null) {
        const bombType: BombType = rng.next() < 0.5 ? 'cluster' : 'cross';
        const cell = selectBonusBombCell(p.board, rng);
        if (cell) {
          p.board[cell.row]![cell.col] = BOMB_COLORS[bombType];
          p.bonusBomb = { row: cell.row, col: cell.col, type: bombType };
          const bombLabel = bombType === 'cluster' ? 'Cluster Bomb (3×3)' : 'Cross Bomb (+)';
          logs.push(
            makeLog(
              `A bonus block containing a ${bombLabel} appeared on Player ${p.seat + 1}'s board!`,
              playerId,
            ),
          );
          p.nextBonusBombRound = p.roundsCompleted + 4 + Math.floor(rng.next() * 3);
        }
      }
    }

    // Check if player has no more moves (considering available bombs)
    if (checkGameOver(p.board, p.tray, p.bombs)) {
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

  if (action.type === 'useBomb') {
    p.actionsSubmitted++;

    if (p.gameOver) {
      p.penalties++;
      return { ok: false, error: 'Game over for this player' };
    }

    if (action.bombIndex < 0 || action.bombIndex >= p.bombs.length) {
      p.penalties++;
      return { ok: false, error: 'No bomb in that inventory slot' };
    }

    if (
      action.row < 0 ||
      action.row >= BLOCK_BLASTER_BOARD_SIZE ||
      action.col < 0 ||
      action.col >= BLOCK_BLASTER_BOARD_SIZE
    ) {
      p.penalties++;
      return { ok: false, error: 'Target coordinates out of bounds' };
    }

    const bombType = p.bombs[action.bombIndex]!;
    p.bombs.splice(action.bombIndex, 1);

    const detonation = applyDetonation(p.board, bombType, action.row, action.col);
    p.board = detonation.newBoard;
    p.score += detonation.points;
    if (p.score > p.highScore) {
      p.highScore = p.score;
    }
    p.lastDetonation = detonation;
    p.actionsAccepted++;

    const bombLabel = bombType === 'cluster' ? 'Cluster Bomb (3×3)' : 'Cross Bomb (+)';
    logs.push(
      makeLog(
        `Player ${p.seat + 1} detonated a ${bombLabel} at (${action.row + 1}, ${action.col + 1}) blasting ${detonation.clearedCount} blocks! (+${detonation.points} pts)`,
        playerId,
      ),
    );

    // If the bonus bomb block was caught in the blast, claim it!
    if (p.bonusBomb) {
      const hitBonus = detonation.clearedCells.some(
        (c) => c.row === p.bonusBomb!.row && c.col === p.bonusBomb!.col,
      );
      if (hitBonus) {
        const bonusType = p.bonusBomb.type;
        p.bombs.push(bonusType);
        const claimedLabel = bonusType === 'cluster' ? 'Cluster Bomb (3×3)' : 'Cross Bomb (+)';
        logs.push(
          makeLog(
            `Player ${p.seat + 1} blasted the bonus block and claimed a ${claimedLabel}!`,
            playerId,
          ),
        );
        p.bonusBomb = null;
      }
    }

    // Re-check game over status now that space has been cleared
    if (checkGameOver(p.board, p.tray, p.bombs)) {
      p.gameOver = true;
      logs.push(makeLog(`Player ${p.seat + 1} ran out of moves! Final score: ${p.score}`, playerId));
    }

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

  // 1. Try to place a piece
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

  // 2. If no piece can be placed, check if player has bombs to clear space
  if (p.bombs.length > 0) {
    let bestRow = 3;
    let bestCol = 3;
    let maxCleared = -1;
    const bombType = p.bombs[0]!;

    for (let r = 0; r < BLOCK_BLASTER_BOARD_SIZE; r++) {
      for (let c = 0; c < BLOCK_BLASTER_BOARD_SIZE; c++) {
        const cells = bombType === 'cluster' ? getClusterBombCells(r, c) : getCrossBombCells(r, c);
        const count = cells.filter(({ row: cr, col: cc }) => p.board[cr]![cc] !== 0).length;
        if (count > maxCleared) {
          maxCleared = count;
          bestRow = r;
          bestCol = c;
        }
      }
    }

    return { type: 'useBomb', bombIndex: 0, row: bestRow, col: bestCol };
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
  const actions = ['place', 'restart'];
  if (p.bombs.length > 0) actions.push('useBomb');
  return actions;
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
