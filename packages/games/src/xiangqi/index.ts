import type { LogEntry, ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  applyMoveToBoard,
  createInitialBoard,
  isInCheck,
  legalMovesForSide,
  notationFor,
  playerById,
  positionKey,
  sideOf,
} from './rules.js';
import type {
  MoveRecord,
  XiangqiAction,
  XiangqiConfig,
  XiangqiPiece,
  XiangqiPlayer,
  XiangqiSide,
  XiangqiState,
  XiangqiView,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: XiangqiState): XiangqiState => structuredClone(s);

const DEFAULT_CONFIG: XiangqiConfig = { clockMinutes: 10, incrementSec: 0, allowTakeback: true };

/** 60 full moves with no capture by either side = 120 plies. */
const SIXTY_MOVE_PLIES = 120;
/**
 * In Xiangqi (Chinese Chess), perpetual check (长将) occurs when a player causes
 * a threefold repetition while delivering check on every move in the repetition cycle.
 * The perpetual checker forfeits (长将作负). If both sides perpetually check, it is a draw.
 * Repeating non-checking positions is a threefold repetition draw.
 */

function setup(playerIds: string[], seed: number, rawConfig: unknown): XiangqiState {
  const config: XiangqiConfig = { ...DEFAULT_CONFIG, ...(rawConfig as Partial<XiangqiConfig> | null) };

  const players: [XiangqiPlayer, XiangqiPlayer] = [
    { id: playerIds[0] ?? 'p0', seat: 0, actionsSubmitted: 0, actionsAccepted: 0, penalties: 0 },
    { id: playerIds[1] ?? 'p1', seat: 1, actionsSubmitted: 0, actionsAccepted: 0, penalties: 0 },
  ];

  const board = createInitialBoard();
  const current: XiangqiSide = 0;
  const initialKey = positionKey({ board, current } as XiangqiState);

  return {
    rng: { seed, calls: 0 },
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players,
    board,
    current,
    halfmoveClock: 0,
    fullmove: 1,
    history: [],
    repetition: { [initialKey]: 1 },
    checkStreak: { 0: 0, 1: 0 },
    drawOffer: null,
    takebackOffer: null,
    phase: 'playing',
    winner: null,
    winReason: null,
    drawReason: null,
    log: [],
  };
}

/**
 * Pure replay used by takeback: rebuilds board/current/halfmoveClock/
 * fullmove/repetition/checkStreak from scratch by re-applying a prefix of
 * `history`. Deterministic, so `room_events` replay still reproduces the
 * game bit-for-bit after a takeback (AGENTS.md's purity rule).
 */
function replayFrom(records: MoveRecord[]): Pick<
  XiangqiState,
  'board' | 'current' | 'halfmoveClock' | 'fullmove' | 'repetition' | 'checkStreak' | 'history'
> {
  let board = createInitialBoard();
  let current: XiangqiSide = 0;
  let halfmoveClock = 0;
  let fullmove = 1;
  const repetition: Record<string, number> = {};
  const checkStreak = { 0: 0, 1: 0 };

  const keyOf = (b: (XiangqiPiece | null)[], c: XiangqiSide): string => {
    let key = '';
    for (const p of b) key += p ? `${p.side}${p.type[0]}` : '.';
    return `${key}:${c}`;
  };
  repetition[keyOf(board, current)] = 1;

  for (const rec of records) {
    const { board: next, captured } = applyMoveToBoard(board, rec.from, rec.to);
    board = next;
    halfmoveClock = captured ? 0 : halfmoveClock + 1;
    if (rec.side === 1) fullmove += 1;
    checkStreak[rec.side] = rec.check ? checkStreak[rec.side] + 1 : 0;
    current = rec.side === 0 ? 1 : 0;
    const key = keyOf(board, current);
    rec.key = key;
    repetition[key] = (repetition[key] ?? 0) + 1;
  }

  return { board, current, halfmoveClock, fullmove, repetition, checkStreak, history: [...records] };
}

/**
 * Analyzes a repeating position cycle upon 3-fold repetition.
 * Traces backwards to find the moves in the cycle between the 2nd-to-last and last
 * occurrence of targetKey, determining if either side gave check on all their moves.
 */
export function analyzeRepetition(
  records: MoveRecord[],
  targetKey: string,
): { redPerpetualCheck: boolean; blackPerpetualCheck: boolean } {
  const matchIndices: number[] = [];

  for (let i = 0; i < records.length; i++) {
    if (records[i]?.key === targetKey) {
      matchIndices.push(i);
    }
  }

  // If targetKey occurred 3 times across history (e.g. initial position + 2 moves,
  // or 3 moves in records):
  // When initial position is part of the repetition (so records has 2 occurrences):
  if (matchIndices.length === 2 && matchIndices[0] !== undefined) {
    // Cycle is from start (-1) to the 2nd occurrence:
    const firstIdx = matchIndices[0];
    const secondIdx = matchIndices[1]!;
    const cycleMoves = records.slice(firstIdx + 1, secondIdx + 1);
    const redMoves = cycleMoves.filter((m) => m.side === 0);
    const blackMoves = cycleMoves.filter((m) => m.side === 1);
    const redPerpetualCheck = redMoves.length > 0 && redMoves.every((m) => m.check);
    const blackPerpetualCheck = blackMoves.length > 0 && blackMoves.every((m) => m.check);
    return { redPerpetualCheck, blackPerpetualCheck };
  }

  if (matchIndices.length < 2) {
    return { redPerpetualCheck: false, blackPerpetualCheck: false };
  }

  const prevIdx = matchIndices[matchIndices.length - 2]!;
  const lastIdx = matchIndices[matchIndices.length - 1]!;
  const cycleMoves = records.slice(prevIdx + 1, lastIdx + 1);

  const redMoves = cycleMoves.filter((m) => m.side === 0);
  const blackMoves = cycleMoves.filter((m) => m.side === 1);

  const redPerpetualCheck = redMoves.length > 0 && redMoves.every((m) => m.check);
  const blackPerpetualCheck = blackMoves.length > 0 && blackMoves.every((m) => m.check);

  return { redPerpetualCheck, blackPerpetualCheck };
}

function reduce(prev: XiangqiState, playerId: string, action: XiangqiAction): ReduceResult<XiangqiState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const fail = (error: string): ReduceResult<XiangqiState> => ({ ok: false, error });

  // `forfeit` is runtime-only (see state.ts) and is never routed from a
  // client. It bypasses the normal turn/player checks below since the
  // server may need to forfeit whoever is on the clock.
  if (action.type === 'forfeit') {
    if (s.phase === 'game_over') return fail('The game is over');
    const opponent = s.players.find((p) => p.id !== playerId);
    if (!opponent) return fail('Not in this game');
    s.phase = 'game_over';
    s.winner = opponent.id;
    s.winReason = action.reason;
    log.push(
      makeLog(
        action.reason === 'time' ? `${playerId} forfeited on time` : `${playerId} forfeited (idle)`,
        playerId,
      ),
    );
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  const player = playerById(s, playerId);
  if (!player) return fail('Not in this game');
  if (s.phase === 'game_over') return fail('The game is over');

  if (action.type === 'resign') {
    const opponent = s.players.find((p) => p.id !== playerId);
    if (!opponent) return fail('Not in this game');
    s.phase = 'game_over';
    s.winner = opponent.id;
    s.winReason = 'resign';
    log.push(makeLog(`${playerId} resigned`, playerId));
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'offer_draw') {
    s.drawOffer = playerId;
    log.push(makeLog(`${playerId} offered a draw`, playerId));
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'respond_draw') {
    if (!s.drawOffer || s.drawOffer === playerId) return fail('No draw offer to respond to');
    if (action.accept) {
      s.phase = 'game_over';
      s.winner = null;
      s.drawReason = 'agreement';
      log.push(makeLog('Draw agreed', playerId));
    } else {
      log.push(makeLog(`${playerId} declined the draw offer`, playerId));
    }
    s.drawOffer = null;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'offer_takeback') {
    if (!s.config.allowTakeback) return fail('Takebacks are disabled');
    if (s.history.length === 0) return fail('No move to take back');
    s.takebackOffer = playerId;
    log.push(makeLog(`${playerId} requested a takeback`, playerId));
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'respond_takeback') {
    if (!s.takebackOffer || s.takebackOffer === playerId) return fail('No takeback request to respond to');
    if (action.accept) {
      const rebuilt = replayFrom(s.history.slice(0, -1));
      s.board = rebuilt.board;
      s.current = rebuilt.current;
      s.halfmoveClock = rebuilt.halfmoveClock;
      s.fullmove = rebuilt.fullmove;
      s.repetition = rebuilt.repetition;
      s.checkStreak = rebuilt.checkStreak;
      s.history = rebuilt.history;
      log.push(makeLog(`${playerId} accepted the takeback`, playerId));
    } else {
      log.push(makeLog(`${playerId} declined the takeback`, playerId));
    }
    s.takebackOffer = null;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'claim_draw') {
    const key = positionKey(s);
    const repeated = (s.repetition[key] ?? 0) >= 3;
    const sixty = s.halfmoveClock >= SIXTY_MOVE_PLIES;
    if (!repeated && !sixty) return fail('No draw available to claim');
    s.phase = 'game_over';
    if (repeated) {
      const analysis = analyzeRepetition(s.history, key);
      if (analysis.redPerpetualCheck && !analysis.blackPerpetualCheck) {
        s.winner = s.players[1].id;
        s.winReason = 'perpetual_check';
        log.push(makeLog(`${s.players[0].id} loses by perpetual check`, playerId));
      } else if (analysis.blackPerpetualCheck && !analysis.redPerpetualCheck) {
        s.winner = s.players[0].id;
        s.winReason = 'perpetual_check';
        log.push(makeLog(`${s.players[1].id} loses by perpetual check`, playerId));
      } else if (analysis.redPerpetualCheck && analysis.blackPerpetualCheck) {
        s.winner = null;
        s.drawReason = 'perpetual_mutual_check';
        log.push(makeLog('Draw — mutual perpetual check', playerId));
      } else {
        s.winner = null;
        s.drawReason = 'threefold';
        log.push(makeLog('Draw by threefold repetition', playerId));
      }
    } else {
      s.winner = null;
      s.drawReason = 'sixty_move';
      log.push(makeLog(`${playerId} claimed a draw (60 moves with no capture)`, playerId));
    }
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type !== 'move') return fail('Unknown action');

  const side = sideOf(s, playerId);
  if (side === null || side !== s.current) return fail('Not your turn');

  player.actionsSubmitted += 1;

  const legal = legalMovesForSide(s.board, side);
  const match = legal.find((m) => m.from === action.from && m.to === action.to);
  if (!match) return fail('Illegal move');

  const piece = s.board[match.from] as XiangqiPiece;
  const notation = notationFor(piece, match.from, match.to);
  const { board: nextBoard, captured } = applyMoveToBoard(s.board, match.from, match.to);
  s.board = nextBoard;
  s.halfmoveClock = captured ? 0 : s.halfmoveClock + 1;
  if (side === 1) s.fullmove += 1;

  const opponentSide: XiangqiSide = side === 0 ? 1 : 0;
  s.current = opponentSide;
  const givesCheck = isInCheck(s.board, opponentSide);
  s.checkStreak[side] = givesCheck ? s.checkStreak[side] + 1 : 0;

  const key = positionKey(s);
  s.repetition[key] = (s.repetition[key] ?? 0) + 1;
  const record: MoveRecord = {
    playerId,
    from: match.from,
    to: match.to,
    piece: piece.type,
    side,
    captured: captured ? captured.type : null,
    notation,
    check: givesCheck,
    key,
  };
  s.history = [...s.history, record];

  log.push(
    makeLog(
      captured
        ? `${playerId} played ${notation}, capturing the ${captured.type}`
        : `${playerId} played ${notation}`,
      playerId,
    ),
  );

  s.drawOffer = null;
  s.takebackOffer = null;
  player.actionsAccepted += 1;

  const opponentLegal = legalMovesForSide(s.board, opponentSide);
  if (opponentLegal.length === 0) {
    s.phase = 'game_over';
    if (givesCheck) {
      s.winner = playerId;
      s.winReason = 'checkmate';
      log.push(makeLog(`Checkmate! ${playerId} wins`, playerId));
    } else {
      // Stalemate is a LOSS for the side with no legal moves in Xiangqi —
      // the opposite of international chess. The mover wins.
      s.winner = playerId;
      s.winReason = 'stalemate';
      log.push(makeLog(`Stalemate — ${playerId} wins (no legal moves for the opponent)`, playerId));
    }
  } else if ((s.repetition[key] ?? 0) >= 3) {
    // Threefold repetition rule in Xiangqi:
    // If one side gave check on all their turns in the repeating cycle, that side forfeits (perpetual check).
    // If both sides gave check on all turns, it is a mutual perpetual check draw.
    // Otherwise, it is a normal threefold repetition draw.
    const analysis = analyzeRepetition(s.history, key);
    s.phase = 'game_over';
    if (analysis.redPerpetualCheck && !analysis.blackPerpetualCheck) {
      s.winner = s.players[1].id;
      s.winReason = 'perpetual_check';
      log.push(makeLog(`${s.players[0].id} loses by perpetual check`, playerId));
    } else if (analysis.blackPerpetualCheck && !analysis.redPerpetualCheck) {
      s.winner = s.players[0].id;
      s.winReason = 'perpetual_check';
      log.push(makeLog(`${s.players[1].id} loses by perpetual check`, playerId));
    } else if (analysis.redPerpetualCheck && analysis.blackPerpetualCheck) {
      s.winner = null;
      s.drawReason = 'perpetual_mutual_check';
      log.push(makeLog('Draw — mutual perpetual check', playerId));
    } else {
      s.winner = null;
      s.drawReason = 'threefold';
      log.push(makeLog('Draw by threefold repetition', playerId));
    }
  } else if (s.halfmoveClock >= SIXTY_MOVE_PLIES) {
    s.phase = 'game_over';
    s.winner = null;
    s.drawReason = 'sixty_move';
    log.push(makeLog('Draw — 60 moves with no capture', playerId));
  }

  s.seq += 1;
  const stamped = stampLogs(s, log);
  s.log = [...s.log, ...stamped].slice(-200);

  return { ok: true, state: s, log: stamped };
}

function legalActions(s: XiangqiState, playerId: string): string[] {
  if (s.phase === 'game_over') return [];
  const side = sideOf(s, playerId);
  if (side === null) return [];

  const actions: string[] = ['resign'];
  if (!s.drawOffer) actions.push('offer_draw');
  if (s.config.allowTakeback && !s.takebackOffer && s.history.length > 0) actions.push('offer_takeback');

  const key = positionKey(s);
  if ((s.repetition[key] ?? 0) >= 3 || s.halfmoveClock >= 120) actions.push('claim_draw');

  if (side === s.current) {
    for (const m of legalMovesForSide(s.board, side)) actions.push(`move:${m.from}-${m.to}`);
  }

  return actions;
}

function autoAction(s: XiangqiState, playerId: string): XiangqiAction {
  const side = sideOf(s, playerId);
  if (side === null) return { type: 'resign' };
  const legal = legalMovesForSide(s.board, side);
  const first = legal[0];
  if (!first) return { type: 'resign' };
  return { type: 'move', from: first.from, to: first.to };
}

function view(s: XiangqiState, playerId: string | null): XiangqiView {
  const side = playerId ? sideOf(s, playerId) : null;
  const isMyTurn = side !== null && side === s.current && s.phase !== 'game_over';

  return {
    board: s.board,
    players: s.players.map((p, i) => ({ id: p.id, seat: p.seat, side: i as XiangqiSide })),
    current: s.phase === 'game_over' ? null : (s.players[s.current]?.id ?? null),
    phase: s.phase,
    history: s.history,
    halfmoveClock: s.halfmoveClock,
    fullmove: s.fullmove,
    winner: s.winner,
    winReason: s.winReason,
    drawReason: s.drawReason,
    drawOffer: s.drawOffer,
    takebackOffer: s.takebackOffer,
    log: s.log,
    you:
      side !== null
        ? {
            id: playerId as string,
            side,
            inCheck: isInCheck(s.board, side),
            legalMoves: isMyTurn ? legalMovesForSide(s.board, side) : [],
          }
        : null,
  };
}

function score(s: XiangqiState, playerId: string): ScoreInput {
  const player = playerById(s, playerId);
  if (!player) return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };

  const over = s.phase === 'game_over';
  const won = s.winner === playerId;
  const drew = over && s.winner === null;
  const progress = won ? 1 : drew ? 0.5 : 0;

  return {
    progress,
    accuracy: player.actionsSubmitted > 0 ? player.actionsAccepted / player.actionsSubmitted : 1,
    completed: over,
    completedAtMs: over ? s.winnerAtMs : null,
    penalties: player.penalties,
  };
}

function isOver(s: XiangqiState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const xiangqi: GameEngine<XiangqiState, XiangqiAction> = {
  id: 'xiangqi',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
