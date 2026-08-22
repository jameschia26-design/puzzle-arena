import type { LogEntry, ScoreInput } from '@puzzle-arena/shared';
import { makeLog, stampLogs, type GameEngine, type ReduceResult } from '../engine.js';
import {
  applyMoveToBoard,
  canClaimDraw,
  canClaimFiftyMove,
  canClaimThreefold,
  createInitialBoard,
  detectTerminal,
  isInCheck,
  legalMovesForSide,
  moveLabel,
  nextEpSquare,
  playerById,
  positionKey,
  replayFromStart,
  sanForMove,
  sideOf,
  stateKey,
  updateCastlingRights,
} from './rules.js';
import type { ChessMove, Side } from './movegen.js';
import type {
  ChessAction,
  ChessConfig,
  ChessPlayer,
  ChessState,
  ChessView,
  MoveRecord,
} from './state.js';

export * from './state.js';
export * from './rules.js';
export * from './bot.js';

const clone = (s: ChessState): ChessState => structuredClone(s);

const DEFAULT_CONFIG: ChessConfig = { clockMinutes: 10, incrementSec: 0, allowTakeback: true };

function setup(playerIds: string[], seed: number, rawConfig: unknown): ChessState {
  const config: ChessConfig = { ...DEFAULT_CONFIG, ...(rawConfig as Partial<ChessConfig> | null) };

  const players: [ChessPlayer, ChessPlayer] = [
    { id: playerIds[0] ?? 'p0', seat: 0, capturedCount: 0, actionsSubmitted: 0, actionsAccepted: 0, penalties: 0 },
    { id: playerIds[1] ?? 'p1', seat: 1, capturedCount: 0, actionsSubmitted: 0, actionsAccepted: 0, penalties: 0 },
  ];

  const board = createInitialBoard();
  const castling = { wk: true, wq: true, bk: true, bq: true };

  return {
    rng: { seed, calls: 0 },
    seq: 0,
    logSeq: 0,
    winnerAtMs: null,
    config,
    players,
    board,
    current: 0,
    castling,
    epSquare: null,
    halfmoveClock: 0,
    fullmove: 1,
    history: [],
    repetition: { [positionKey(board, 0, castling, null)]: 1 },
    drawOffer: null,
    takebackOffer: null,
    phase: 'playing',
    winner: null,
    winReason: null,
    drawReason: null,
    log: [],
  };
}

function applyAutomaticTerminal(s: ChessState, log: LogEntry[]): void {
  if (s.phase === 'game_over') return;
  const term = detectTerminal(
    s.board,
    s.current,
    s.castling,
    s.epSquare,
    s.halfmoveClock,
    s.repetition[stateKey(s)] ?? 0,
  );
  if (!term) return;

  if (term.kind === 'checkmate') {
    const winner = s.players[term.winnerSide]?.id ?? null;
    s.phase = 'game_over';
    s.winner = winner;
    s.winReason = 'checkmate';
    log.push(makeLog(`Checkmate! ${winner ?? 'unknown'} wins.`, winner));
    return;
  }
  if (term.kind === 'stalemate') {
    s.phase = 'game_over';
    s.winner = null;
    s.winReason = 'stalemate';
    s.drawReason = 'stalemate';
    log.push(makeLog('Draw by stalemate.', null));
    return;
  }
  if (term.kind === 'material') {
    s.phase = 'game_over';
    s.winner = null;
    s.winReason = 'stalemate';
    s.drawReason = 'material';
    log.push(makeLog('Draw by insufficient material.', null));
    return;
  }
  if (term.kind === 'fivefold') {
    s.phase = 'game_over';
    s.winner = null;
    s.winReason = 'stalemate';
    s.drawReason = 'threefold';
    log.push(makeLog('Draw by fivefold repetition.', null));
    return;
  }
  if (term.kind === 'seventyfive') {
    s.phase = 'game_over';
    s.winner = null;
    s.winReason = 'stalemate';
    s.drawReason = 'fifty';
    log.push(makeLog('Draw by the 75-move rule.', null));
  }
}

function reduceMove(
  s: ChessState,
  playerId: string,
  player: ChessPlayer,
  side: Side,
  action: Extract<ChessAction, { type: 'move' }>,
  log: LogEntry[],
): ReduceResult<ChessState> | null {
  const legal = legalMovesForSide(s.board, side, s.castling, s.epSquare);
  const candidates = legal.filter((m) => m.from === action.from && m.to === action.to);
  if (candidates.length === 0) return { ok: false, error: 'Illegal move' };

  let match: ChessMove | undefined;
  if (candidates.length === 1) {
    const only = candidates[0] as ChessMove;
    if (only.promotion !== undefined && action.promotion !== undefined && only.promotion !== action.promotion) {
      return { ok: false, error: 'Illegal move' };
    }
    match = only;
  } else {
    match = candidates.find((m) => m.promotion === action.promotion);
    if (!match) return { ok: false, error: 'Promotion required' };
  }

  const san = sanForMove(match, legal);
  const nextBoard = applyMoveToBoard(s.board, match);
  const nextCastling = updateCastlingRights(s.castling, match);
  const nextEp = nextEpSquare(match);
  const captured = match.captured !== undefined || match.isEnPassant === true;

  s.board = nextBoard;
  s.castling = nextCastling;
  s.epSquare = nextEp;
  s.halfmoveClock = match.piece === 'p' || captured ? 0 : s.halfmoveClock + 1;
  if (side === 1) s.fullmove += 1;
  s.current = (1 - side) as Side;
  s.drawOffer = null;
  s.takebackOffer = null;

  if (captured) player.capturedCount += 1;

  const rec: MoveRecord = {
    playerId,
    side,
    from: match.from,
    to: match.to,
    piece: match.piece,
    promotion: match.promotion,
    captured: match.captured,
    isEnPassant: match.isEnPassant,
    isCastle: match.isCastle,
    isDoublePush: match.isDoublePush,
    san,
  };
  s.history = [...s.history, rec];

  const key = stateKey(s);
  s.repetition = { ...s.repetition, [key]: (s.repetition[key] ?? 0) + 1 };

  const inCheckNow = isInCheck(s.board, s.current);
  const opponentLegal = legalMovesForSide(s.board, s.current, s.castling, s.epSquare);
  let suffix = '';
  if (opponentLegal.length === 0) suffix = inCheckNow ? '#' : '';
  else if (inCheckNow) suffix = '+';
  const fullSan = `${san}${suffix}`;
  s.history[s.history.length - 1] = { ...rec, san: fullSan };

  log.push(makeLog(`${playerId} played ${fullSan}`, playerId));

  applyAutomaticTerminal(s, log);
  return null;
}

function reduce(prev: ChessState, playerId: string, action: ChessAction): ReduceResult<ChessState> {
  const s = clone(prev);
  const log: LogEntry[] = [];
  const player = playerById(s, playerId);
  const fail = (error: string): ReduceResult<ChessState> => ({ ok: false, error });

  if (!player) return fail('Not in this game');

  // `forfeit` is the one action the server runtime — never a client — may
  // submit for a player whose clock or idle timer expired.
  if (action.type === 'forfeit') {
    if (s.phase === 'game_over') return fail('The game is over');
    const side = sideOf(s, playerId);
    if (side === null) return fail('Not in this game');
    const winnerId = s.players[(1 - side) as Side]?.id ?? null;
    s.phase = 'game_over';
    s.winner = winnerId;
    s.winReason = action.reason;
    log.push(
      makeLog(
        action.reason === 'time' ? `${playerId} forfeited on time` : `${playerId} forfeited (idle)`,
        playerId,
      ),
    );
    s.seq += 1;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (s.phase === 'game_over') return fail('The game is over');
  const side = sideOf(s, playerId);
  if (side === null) return fail('Not in this game');
  const opponentId = s.players[(1 - side) as Side]?.id ?? null;

  if (action.type === 'resign') {
    player.actionsSubmitted += 1;
    s.phase = 'game_over';
    s.winner = opponentId;
    s.winReason = 'resign';
    log.push(makeLog(`${playerId} resigned.`, playerId));
    player.actionsAccepted += 1;
    s.seq += 1;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'move') {
    if (side !== s.current) return fail('Not your turn');
    player.actionsSubmitted += 1;
    const result = reduceMove(s, playerId, player, side, action, log);
    if (result) return result;
    player.actionsAccepted += 1;
    s.seq += 1;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'offer_draw') {
    if (s.drawOffer) return fail('A draw offer is already pending');
    s.drawOffer = playerId;
    log.push(makeLog(`${playerId} offered a draw.`, playerId));
    s.seq += 1;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'respond_draw') {
    if (s.drawOffer !== opponentId) return fail('No draw offer to respond to');
    if (action.accept) {
      s.phase = 'game_over';
      s.winner = null;
      s.winReason = 'stalemate';
      s.drawReason = 'agreement';
      log.push(makeLog(`${playerId} accepted the draw offer.`, playerId));
    } else {
      log.push(makeLog(`${playerId} declined the draw offer.`, playerId));
    }
    s.drawOffer = null;
    s.seq += 1;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'offer_takeback') {
    if (!s.config.allowTakeback) return fail('Takeback is disabled for this game');
    if (s.takebackOffer) return fail('A takeback offer is already pending');
    if (s.history.length === 0) return fail('No moves to take back');
    s.takebackOffer = playerId;
    log.push(makeLog(`${playerId} requested a takeback.`, playerId));
    s.seq += 1;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'respond_takeback') {
    if (s.takebackOffer !== opponentId) return fail('No takeback offer to respond to');
    if (action.accept) {
      const requesterSide = sideOf(s, opponentId as string);
      if (requesterSide === null) return fail('Not in this game');
      const n = s.current === requesterSide ? 2 : 1;
      if (s.history.length < n) return fail('Not enough history to take back');
      const trimmed = s.history.slice(0, s.history.length - n);
      const replay = replayFromStart(trimmed);
      s.board = replay.board;
      s.castling = replay.castling;
      s.epSquare = replay.epSquare;
      s.halfmoveClock = replay.halfmoveClock;
      s.fullmove = replay.fullmove;
      s.current = replay.current;
      s.repetition = replay.repetition;
      s.history = trimmed;
      log.push(makeLog(`${playerId} accepted the takeback.`, playerId));
    } else {
      log.push(makeLog(`${playerId} declined the takeback.`, playerId));
    }
    s.takebackOffer = null;
    s.seq += 1;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  if (action.type === 'claim_draw') {
    if (!canClaimDraw(s)) return fail('No draw to claim');
    s.phase = 'game_over';
    s.winner = null;
    s.winReason = 'stalemate';
    s.drawReason = canClaimFiftyMove(s) ? 'fifty' : 'threefold';
    log.push(makeLog(`${playerId} claimed a draw.`, playerId));
    s.seq += 1;
    const stamped = stampLogs(s, log);
    s.log = [...s.log, ...stamped].slice(-200);
    return { ok: true, state: s, log: stamped };
  }

  return fail('Unknown action');
}

function legalActions(s: ChessState, playerId: string): string[] {
  const side = sideOf(s, playerId);
  if (side === null || s.phase === 'game_over') return [];
  const opponentId = s.players[(1 - side) as Side]?.id ?? null;
  const actions: string[] = [];

  if (s.drawOffer === opponentId) actions.push('respond_draw');
  if (s.takebackOffer === opponentId) actions.push('respond_takeback');
  actions.push('resign');
  if (!s.drawOffer) actions.push('offer_draw');
  if (canClaimDraw(s)) actions.push('claim_draw');
  if (s.config.allowTakeback && !s.takebackOffer && s.history.length > 0) actions.push('offer_takeback');

  if (side === s.current) {
    const legal = legalMovesForSide(s.board, side, s.castling, s.epSquare);
    for (const m of legal) actions.push(moveLabel(m));
  }

  return actions;
}

function autoAction(s: ChessState, playerId: string): ChessAction {
  const side = sideOf(s, playerId);
  if (side === null || side !== s.current) return { type: 'resign' };
  const legal = legalMovesForSide(s.board, side, s.castling, s.epSquare);
  const first = legal[0];
  if (!first) return { type: 'resign' };
  return {
    type: 'move',
    from: first.from,
    to: first.to,
    promotion: first.promotion as ('q' | 'r' | 'b' | 'n') | undefined,
  };
}

function view(s: ChessState, playerId: string | null): ChessView {
  const side = playerId ? sideOf(s, playerId) : null;
  const isMyTurn = side !== null && side === s.current && s.phase !== 'game_over';

  return {
    board: s.board,
    players: s.players.map((p, i) => ({
      id: p.id,
      seat: p.seat,
      side: i as Side,
      capturedCount: p.capturedCount,
    })),
    current: s.phase === 'game_over' ? null : (s.players[s.current]?.id ?? null),
    phase: s.phase,
    castling: s.castling,
    epSquare: s.epSquare,
    halfmoveClock: s.halfmoveClock,
    history: s.history,
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
            legalMoves: isMyTurn ? legalMovesForSide(s.board, side, s.castling, s.epSquare) : [],
            inCheck: isInCheck(s.board, side),
          }
        : null,
  };
}

function score(s: ChessState, playerId: string): ScoreInput {
  const player = playerById(s, playerId);
  if (!player) return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };

  const completed = s.winner === playerId;
  const drewOrPlaying = s.phase === 'game_over' && s.winner === null;
  const progress = completed ? 1 : drewOrPlaying ? 0.5 : Math.min(1, s.fullmove / 40);

  return {
    progress,
    accuracy: player.actionsSubmitted > 0 ? player.actionsAccepted / player.actionsSubmitted : 1,
    completed,
    completedAtMs: completed ? s.winnerAtMs : null,
    penalties: player.penalties,
  };
}

function isOver(s: ChessState): { over: boolean; winner?: string } {
  if (s.phase !== 'game_over') return { over: false };
  return s.winner ? { over: true, winner: s.winner } : { over: true };
}

export const chess: GameEngine<ChessState, ChessAction> = {
  id: 'chess',
  setup,
  reduce,
  autoAction,
  view,
  score,
  isOver,
  legalActions,
};
