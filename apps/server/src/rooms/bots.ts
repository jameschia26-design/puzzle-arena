import {
  bigTwoBot,
  checkersBot,
  chessBot,
  connect4Bot,
  congkakBot,
  manorMysteryBot,
  propertyTycoonBot,
  reversiBot,
  scrabbleBot,
  xiangqiBot,
  animalChessBot,
  type BigTwoBotView,
  type CheckersBotView,
  type ChessBotView,
  type Connect4BotView,
  type CongkakBotView,
  type MMBotView,
  type PTBotView,
  type ReversiBotView,
  type SCRBotView,
  type XiangqiBotView,
  type AnimalChessBotView,
} from '@puzzle-arena/games';
import { getAiBotAction } from '../ai/bot-moves.js';
import { mulberry32, type BotDifficulty, type Rng } from '@puzzle-arena/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';
import type { LiveRoom } from './runtime.js';

/**
 * Two mistakes live in this file, and both are easy to make:
 *  1. handing a policy the raw state instead of `engine.view(state, botId)`
 *  2. letting the think-delay influence the chosen action
 *
 * The delay below is presentation only. Only the seeded `Rng` reaches a policy,
 * because anything else would make an event replay diverge.
 */

const timers = new Map<string, NodeJS.Timeout>();
const puzzleTimers = new Map<string, NodeJS.Timeout[]>();
/** One deterministic stream per room, so bot choices replay identically. */
const streams = new Map<string, Rng>();

const MAX_CONSECUTIVE_BOT_ACTIONS = 200;

function rngFor(room: LiveRoom): Rng {
  let rng = streams.get(room.id);
  if (!rng) {
    rng = mulberry32(hash(room.id));
    streams.set(room.id, rng);
  }
  return rng;
}

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function thinkDelay(rng: Rng): number {
  if (env.botThinkMs !== null) return env.botThinkMs;
  return 500 + rng.int(1200);
}

/**
 * After every state transition: if the seat now to act is a bot, arm a timer
 * and then push its action through the same reduce -> append-event path a human
 * action takes.
 */
export function scheduleBots(room: LiveRoom): void {
  if (room.kind !== 'board' || room.status !== 'running') return;
  const existing = timers.get(room.id);
  if (existing) clearTimeout(existing);

  const actorId = room.actorToAct();
  if (!actorId) return;
  const actor = room.player(actorId);
  if (!actor || !actor.isBot) {
    room.consecutiveBotActions = 0;
    return;
  }

  if (room.consecutiveBotActions >= MAX_CONSECUTIVE_BOT_ACTIONS) {
    // An engine bug should be loud, not a hang.
    logger.error(
      { roomId: room.id, actorId },
      'bot action guard tripped — forcing endTurn',
    );
    room.consecutiveBotActions = 0;
    room.applyGameAction(actorId, { type: 'endTurn' });
    return;
  }

  const rng = rngFor(room);
  const delay = thinkDelay(rng);

  const timer = setTimeout(async () => {
    timers.delete(room.id);
    if (room.status !== 'running') return;
    // The seat may have moved on while we waited.
    if (room.actorToAct() !== actorId) {
      scheduleBots(room);
      return;
    }

    const difficulty: BotDifficulty = actor.botDifficulty ?? 'normal';
    // THE invariant: the policy receives only the restricted view.
    const view = room.engine().view(room.gameState as never, actorId);

    let action: unknown;
    const effectiveDifficulty: BotDifficulty = difficulty === 'ai' ? 'hard' : difficulty;

    try {
      if (room.gameId === 'property-tycoon') {
        action = propertyTycoonBot.chooseAction(view as PTBotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'scrabble') {
        action = scrabbleBot.chooseAction(view as SCRBotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'congkak') {
        action = congkakBot.chooseAction(view as CongkakBotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'checkers') {
        action = checkersBot.chooseAction(view as CheckersBotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'big-two') {
        action = bigTwoBot.chooseAction(view as BigTwoBotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'reversi') {
        action = reversiBot.chooseAction(view as ReversiBotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'connect4') {
        action = connect4Bot.chooseAction(view as Connect4BotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'chess') {
        action = chessBot.chooseAction(view as ChessBotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'xiangqi') {
        action = xiangqiBot.chooseAction(view as XiangqiBotView, actorId, rng, effectiveDifficulty);
      } else if (room.gameId === 'animal-chess') {
        action = animalChessBot.chooseAction(view as unknown as AnimalChessBotView, actorId, rng, effectiveDifficulty);
      } else {
        action = manorMysteryBot.chooseAction(view as MMBotView, actorId, rng, effectiveDifficulty);
      }

      // If bot difficulty is 'ai', consult the LLM provider with fallback.
      // The local bot has already produced a strong 'hard' move above; the LLM
      // is only useful when it responds quickly. A reasoning model on a
      // Connect 4 prompt can blow past the provider's own 30s timeout, which
      // leaves the user staring at an empty board — cap the user-perceived
      // wait at 2s and let the LLM finish in the background. The pending
      // promise is harmless: its result is just discarded.
      if (difficulty === 'ai') {
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<unknown>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(action), 2000);
        });
        action = await Promise.race([
          getAiBotAction({ gameId: room.gameId, view, actorId, fallbackAction: action }),
          timeoutPromise,
        ]);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    } catch (err) {
      logger.error({ err, roomId: room.id }, 'bot policy threw; using autoAction');
      action = room.engine().autoAction(room.gameState as never, actorId);
    }

    if (room.status !== 'running') return;
    room.consecutiveBotActions += 1;
    const result = room.applyGameAction(actorId, action);
    if (!result.accepted) {
      // A policy may occasionally propose something illegal; the engine's own
      // minimal legal action always works.
      const fallback = room.engine().autoAction(room.gameState as never, actorId);
      room.applyGameAction(actorId, fallback);
    }
  }, delay);

  timers.set(room.id, timer);
}

/* ------------------------------------------------------------------ */
/* Puzzle bots                                                         */
/* ------------------------------------------------------------------ */

/** How much of the time limit each difficulty takes to finish. */
const PACE: Record<BotDifficulty, number> = { easy: 1.8, normal: 0.95, hard: 0.6, ai: 0.5 };
const ERROR_RATE: Record<BotDifficulty, number> = { easy: 0.08, normal: 0.04, hard: 0.01, ai: 0.0 };

/**
 * A puzzle bot replays the solver's own solve path at a human-plausible pace,
 * committing through the same handler a human uses — so progress, accuracy,
 * penalties and score all come out of the identical code path.
 */
export function schedulePuzzleBots(room: LiveRoom): void {
  if (room.kind !== 'puzzle' || !room.puzzle) return;
  stopPuzzleBots(room.id);

  const handles: NodeJS.Timeout[] = [];
  const order = room.puzzle.solveOrder;
  if (order.length === 0) return;

  for (const bot of room.players.filter((p) => p.isBot && !p.left)) {
    const difficulty: BotDifficulty = bot.botDifficulty ?? 'normal';
    const targetMs = room.timeLimitMs * PACE[difficulty];
    const interval = Math.max(120, Math.floor(targetMs / order.length));
    const rng = mulberry32(hash(room.id + bot.id));
    let idx = 0;
    /** Cells written wrong on purpose, to be corrected three intervals later. */
    const pendingFixes = new Map<number, string>();

    const tick = setInterval(() => {
      if (room.status !== 'running') {
        clearInterval(tick);
        return;
      }

      // Correct any deliberate error whose time has come. This runs even
      // after the solve order itself is exhausted — a mistake made in the
      // final few cells schedules its fix at `idx + 3`, which can land past
      // `order.length`; stopping the interval on order-exhaustion alone (the
      // old bug) left that cell permanently wrong and, in a solo-vs-bots
      // room, silently blocked the "everyone finished" early end.
      for (const [when, path] of [...pendingFixes]) {
        if (idx >= when) {
          pendingFixes.delete(when);
          const correct = correctValueFor(room, path);
          if (correct !== null) room.commit(bot.id, path, correct);
        }
      }

      if (idx >= order.length) {
        idx++; // keep the clock running so a still-pending fix's `when` is reached
        if (pendingFixes.size === 0) clearInterval(tick);
        return;
      }

      const target = order[idx++];
      if (target === undefined) return;

      if (room.gameId === 'word-search') {
        const placement = (
          room.puzzle?.solution as { placements: { word: string; x: number; y: number; dx: number; dy: number }[] }
        ).placements.find((p) => p.word === target);
        if (placement) {
          const endX = placement.x + placement.dx * (placement.word.length - 1);
          const endY = placement.y + placement.dy * (placement.word.length - 1);
          room.commit(bot.id, `${placement.y},${placement.x},${endY},${endX}`, null);
        }
        return;
      }
      if (room.gameId === 'minesweeper') {
        const path = String(target);
        room.commit(bot.id, path, 1);
        return;
      }

      const cell = Number(target);
      const path = pathFor(room, cell);
      const correct = correctValueFor(room, path);
      if (correct === null) return;

      if (rng.next() < ERROR_RATE[difficulty]) {
        // A wrong but locally-legal entry, corrected three intervals later.
        const wrong = wrongValueFor(room, correct, rng);
        room.commit(bot.id, path, wrong);
        pendingFixes.set(idx + 3, path);
      } else {
        room.commit(bot.id, path, correct);
      }
    }, interval);

    handles.push(tick);
  }

  puzzleTimers.set(room.id, handles);
}

function pathFor(room: LiveRoom, cell: number): string {
  if (room.gameId === 'nonogram') {
    const size = (room.puzzle?.puzzle as { size: number }).size;
    return `${Math.floor(cell / size)},${cell % size}`;
  }
  if (room.gameId === 'minesweeper') {
    const cols = (room.puzzle?.puzzle as { cols: number }).cols;
    return `${Math.floor(cell / cols)},${cell % cols}`;
  }
  return `${Math.floor(cell / 9)},${cell % 9}`;
}

function correctValueFor(room: LiveRoom, path: string): number | null {
  if (!room.puzzle) return null;
  const [r, c] = path.split(',').map(Number);
  if (r === undefined || c === undefined) return null;
  if (room.gameId === 'nonogram') {
    const size = (room.puzzle.puzzle as { size: number }).size;
    return (room.puzzle.solution as boolean[])[r * size + c] ? 1 : 2;
  }
  if (room.gameId === 'minesweeper') {
    const sol = room.puzzle.solution as { cols: number; grid: number[] };
    return sol.grid[(r as number) * sol.cols + (c as number)] === -1 ? null : 1;
  }
  return (room.puzzle.solution as number[])[r * 9 + c] ?? null;
}

function wrongValueFor(room: LiveRoom, correct: number, rng: Rng): number {
  if (room.gameId === 'nonogram') return correct === 1 ? 2 : 1;
  let v = 1 + rng.int(9);
  if (v === correct) v = (v % 9) + 1;
  return v;
}

export function stopBots(roomId: string): void {
  const t = timers.get(roomId);
  if (t) clearTimeout(t);
  timers.delete(roomId);
  streams.delete(roomId);
  stopPuzzleBots(roomId);
}

export function stopPuzzleBots(roomId: string): void {
  for (const t of puzzleTimers.get(roomId) ?? []) clearInterval(t);
  puzzleTimers.delete(roomId);
}
