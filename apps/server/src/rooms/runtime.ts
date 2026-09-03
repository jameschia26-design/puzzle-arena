import { and, asc, eq, gt } from 'drizzle-orm';
import type { Server as IOServer } from 'socket.io';
import {
  EV,
  GAME_REGISTRY,
  RECONNECT_GRACE_SEC,
  START_COUNTDOWN_MS,
  CHESS_MOVE_CAP_MS,
  CHESS_IDLE_PROMPT_MS,
  computeScore,
  mulberry32,
  rankResults,
  speedComponent,
  type BotDifficulty,
  type ChatMessage,
  type GameId,
  type LeaderboardEntry,
  type LogEntry,
  type PlayerView,
  type ResultRow,
  type RoomMeta,
  type RoomSnapshot,
  type ScoreInput,
} from '@puzzle-arena/shared';
import {
  bigTwo,
  bigTwoRules,
  checkers,
  checkersRules,
  chess,
  chessRules,
  congkak,
  congkakRules,
  connect4,
  connect4Rules,
  manorMystery,
  manorMysteryRules,
  reversi,
  reversiRules,
  scrabble,
  scrabbleRules,
  propertyTycoon,
  propertyTycoonRules,
  animalChess,
  animalChessRules,
  tetris,
  pacman,
  spaceInvaders,
  bomberman,
  xiangqi,
} from '@puzzle-arena/games';
import { wordSearch } from '@puzzle-arena/puzzles';
import { db } from '../db/index.js';
import {
  roomEvents,
  roomPlayers,
  roomResults,
  roomSnapshots,
  rooms,
  puzzleInstances,
} from '../db/schema.js';
import { logger } from '../logger.js';
import {
  applyCommit,
  generatePuzzle,
  gradePuzzle,
  initialPuzzleState,
  puzzleHint,
  type GeneratedPuzzle,
} from '../games/puzzle-adapter.js';
import { scheduleBots, schedulePuzzleBots, stopBots } from './bots.js';

const SNAPSHOT_EVERY = 50;

export interface LivePlayer {
  id: string;
  guestId: string | null;
  displayName: string;
  seat: number;
  isHost: boolean;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  avatar: string | null;
  connected: boolean;
  left: boolean;
  /** Puzzle games only: this player's board. */
  state: unknown;
  penalties: number;
  completed: boolean;
  completedAtMs: number | null;
}

export interface RoomConfig {
  difficulty?: string;
  instantFeedback?: boolean;
  [key: string]: unknown;
}

/**
 * Authoritative in-memory room. Every anti-cheat invariant is enforced here:
 * the solution never leaves this object until the room ends, the broadcast
 * leaderboard carries filled fraction rather than correct fraction while
 * instant feedback is off, and every board-game view is computed per player.
 */
export class LiveRoom {
  readonly id: string;
  readonly code: string;
  readonly gameId: GameId;
  readonly kind: 'puzzle' | 'board';
  config: RoomConfig;
  timeLimitSec: number;
  status: 'lobby' | 'running' | 'finished' | 'abandoned';
  startedAt: number | null = null;
  endsAt: number | null = null;
  turnEndsAt: number | null = null;

  players: LivePlayer[] = [];
  seq = 0;

  /** Puzzle rooms. `solution` must never be serialised to a client. */
  puzzle: GeneratedPuzzle | null = null;
  paused = false;
  private remainingEndMs: number | null = null;
  private remainingTurnMs: number | null = null;
  /** Remaining ms on the pre-game "get ready" countdown, captured by `pause()`. */
  private remainingStartMs: number | null = null;

  gameState: unknown | null = null;
  results: ResultRow[] | null = null;
  log: LogEntry[] = [];
  chat: ChatMessage[] = [];
  consecutiveBotActions = 0;
  /**
   * Chess-clock games only (Chess, Xiangqi): each human player's remaining
   * time bank, keyed by playerId. Null for every other game. Bots are never
   * keyed here — their own scheduler already paces them.
   */
  clocks: Map<string, number> | null = null;
  /** Whoever's bank is currently draining, or null when no human is on the clock. */
  clockActor: string | null = null;
  /** Epoch ms `clockActor`'s bank started draining. */
  private clockSince: number | null = null;
  private io: IOServer | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  /** Chess-clock games: fires the "still thinking?" prompts every 60s of idling on one move. */
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private arcadeTickTimer: NodeJS.Timeout | null = null;
  private playerLastActionMs = new Map<string, number>();
  private idleStrikes = 0;
  constructor(row: {
    id: string;
    code: string;
    gameId: string;
    config: unknown;
    timeLimitSec: number;
    status: string;
    startedAt: Date | null;
    endsAt: Date | null;
  }) {
    this.id = row.id;
    this.code = row.code;
    this.gameId = row.gameId as GameId;
    this.kind = GAME_REGISTRY[this.gameId].kind;
    this.config = (row.config ?? {}) as RoomConfig;
    this.timeLimitSec = row.timeLimitSec;
    this.status = row.status as LiveRoom['status'];
    this.startedAt = row.startedAt ? row.startedAt.getTime() : null;
    this.endsAt = row.endsAt ? row.endsAt.getTime() : null;
  }

  attach(io: IOServer): void {
    this.io = io;
  }

  get instantFeedback(): boolean {
    return this.config.instantFeedback === true;
  }

  get timeLimitMs(): number {
    return this.timeLimitSec * 1000;
  }

  player(playerId: string): LivePlayer | undefined {
    return this.players.find((p) => p.id === playerId);
  }

  playerByGuest(guestId: string): LivePlayer | undefined {
    return this.players.find((p) => p.guestId === guestId && !p.left);
  }

  get host(): LivePlayer | undefined {
    return this.players.find((p) => p.isHost);
  }

  /* ---------------- lifecycle ---------------- */

  async start(): Promise<void> {
    if (this.status !== 'lobby') throw new Error('Room already started');
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    const active = this.players.filter((p) => !p.left);
    const meta = GAME_REGISTRY[this.gameId];
    if (active.length < meta.minPlayers) {
      throw new Error(`${meta.title} needs at least ${meta.minPlayers} players`);
    }
    if (!active.some((p) => !p.isBot)) throw new Error('At least one human must be seated');

    const seed = Math.floor(Math.random() * 2 ** 31);

    if (this.kind === 'puzzle') {
      this.puzzle = await generatePuzzle(this.gameId, seed, this.config);
      for (const p of active) p.state = structuredClone(this.puzzle.initialState);
      await db.insert(puzzleInstances).values({
        roomId: this.id,
        gameId: this.gameId,
        difficulty: String(this.config.difficulty ?? 'medium'),
        seed,
        puzzle: this.puzzle.puzzle as object,
        solution: this.puzzle.solution as object,
        meta: this.puzzle.meta as object,
      });
    } else {
      const engine = this.engine();
      this.gameState = engine.setup(
        active.map((p) => p.id),
        seed,
        this.config,
      );
      if (this.usesChessClock()) {
        const minutes = Number((this.config as { clockMinutes?: number }).clockMinutes ?? 10);
        this.clocks = new Map(active.filter((p) => !p.isBot).map((p) => [p.id, minutes * 60_000]));
      }
    }

    const startsAt = Date.now() + START_COUNTDOWN_MS;
    this.startedAt = startsAt;
    const hasTimeLimit = this.timeLimitMs > 0 && this.gameId !== 'pacman' && this.gameId !== 'tetris' && this.gameId !== 'space-invaders' && this.gameId !== 'bomberman';
    this.endsAt = hasTimeLimit ? startsAt + this.timeLimitMs : null;
    this.status = 'running';

    await db
      .update(rooms)
      .set({
        status: 'running',
        startedAt: new Date(startsAt),
        endsAt: this.endsAt ? new Date(this.endsAt) : null,
      })
      .where(eq(rooms.id, this.id));

    this.armEndTimer();
    this.io?.to(this.id).emit(EV.roomStarted, { startsAt, endsAt: this.endsAt });
    this.broadcastSnapshot();
    // Board games need their per-player legal actions immediately, or the first
    // player sits in front of a board with every button disabled.
    if (this.kind === 'board') this.broadcastGameState();
    // Bots only begin once play actually starts.
    this.scheduleStartCountdown(START_COUNTDOWN_MS);
  }

  /**
   * Arms (or re-arms, after a pause mid-countdown) the pre-game "get ready"
   * timer. Only once it clears do turn timers/bots begin — a paused room
   * must not let this elapse underneath the pause.
   */
  private scheduleStartCountdown(delay: number): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      if (this.status !== 'running' || this.paused) return;
      if (this.kind === 'board') {
        this.armTurnTimer();
        this.armArcadeTickWatchdog();
        // The first actor's deadline exists only once the countdown clears.
        this.broadcastGameState();
        scheduleBots(this);
      } else {
        schedulePuzzleBots(this);
      }
    }, delay);
  }

  engine() {
    if (this.gameId === 'property-tycoon') return propertyTycoon as unknown as typeof propertyTycoon;
    if (this.gameId === 'scrabble') return scrabble as unknown as typeof propertyTycoon;
    if (this.gameId === 'congkak') return congkak as unknown as typeof propertyTycoon;
    if (this.gameId === 'checkers') return checkers as unknown as typeof propertyTycoon;
    if (this.gameId === 'big-two') return bigTwo as unknown as typeof propertyTycoon;
    if (this.gameId === 'reversi') return reversi as unknown as typeof propertyTycoon;
    if (this.gameId === 'connect4') return connect4 as unknown as typeof propertyTycoon;
    if (this.gameId === 'chess') return chess as unknown as typeof propertyTycoon;
    if (this.gameId === 'xiangqi') return xiangqi as unknown as typeof propertyTycoon;
    if (this.gameId === 'animal-chess') return animalChess as unknown as typeof propertyTycoon;
    if (this.gameId === 'tetris') return tetris as unknown as typeof propertyTycoon;
    if (this.gameId === 'pacman') return pacman as unknown as typeof propertyTycoon;
    if (this.gameId === 'space-invaders') return spaceInvaders as unknown as typeof propertyTycoon;
    if (this.gameId === 'bomberman') return bomberman as unknown as typeof propertyTycoon;
    return manorMystery as unknown as typeof propertyTycoon;
  }

  /** Whoever the board game is waiting on, or null. */
  actorToAct(): string | null {
    if (this.kind !== 'board' || !this.gameState) return null;
    if (this.gameId === 'property-tycoon') return propertyTycoonRules.actorToAct(this.gameState as never);
    if (this.gameId === 'scrabble') return scrabbleRules.actorToAct(this.gameState as never);
    if (this.gameId === 'congkak') return congkakRules.actorToAct(this.gameState as never);
    if (this.gameId === 'checkers') return checkersRules.actorToAct(this.gameState as never);
    if (this.gameId === 'big-two') return bigTwoRules.actorToAct(this.gameState as never);
    if (this.gameId === 'reversi') return reversiRules.actorToAct(this.gameState as never);
    if (this.gameId === 'connect4') return connect4Rules.actorToAct(this.gameState as never);
    if (this.gameId === 'chess') return chessRules.actorToAct(this.gameState as never);
    if (this.gameId === 'tetris') return null; // concurrent — no turn
    if (this.gameId === 'pacman') return null; // concurrent — no turn
    if (this.gameId === 'space-invaders') return null; // concurrent — no turn
    if (this.gameId === 'bomberman') return null; // concurrent — no turn
    if (this.gameId === 'animal-chess') return animalChessRules.actorToAct(this.gameState as never);
    return manorMysteryRules.actorToAct(this.gameState as never);
  }

  /** Chess and Xiangqi run a per-player time bank instead of `turnTimeLimitSec`. */
  usesChessClock(): boolean {
    return this.gameId === 'chess' || this.gameId === 'xiangqi';
  }
  pause(): void {
    if (this.status !== 'running' || this.paused) return;
    this.paused = true;
    this.remainingEndMs = this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null;
    if (this.endTimer) clearTimeout(this.endTimer);
    this.remainingTurnMs = this.turnEndsAt ? Math.max(0, this.turnEndsAt - Date.now()) : null;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    // The pre-game "get ready" countdown must pause too, or a host pausing
    // mid-countdown gets an unpaused game the instant it elapses underneath them.
    this.remainingStartMs = this.startTimer && this.startedAt ? Math.max(0, this.startedAt - Date.now()) : null;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.arcadeTickTimer) {
      clearInterval(this.arcadeTickTimer);
      this.arcadeTickTimer = null;
    }
    stopBots(this.id);
    this.pushLog('Game paused by host');
    this.io?.to(this.id).emit(EV.roomPaused, { paused: true });
    this.broadcastSnapshot();
  }

  resume(): void {
    if (this.status !== 'running' || !this.paused) return;
    this.paused = false;
    if (this.remainingEndMs !== null) {
      this.endsAt = Date.now() + this.remainingEndMs;
      this.armEndTimer();
    }
    if (this.remainingTurnMs !== null) {
      this.turnEndsAt = Date.now() + this.remainingTurnMs;
      this.armTurnTimer();
    }
    if (this.remainingStartMs !== null) {
      // Still inside the pre-game countdown when paused: resume the
      // countdown itself rather than immediately arming turn timers/bots,
      // which belongs to the countdown's own callback once it elapses.
      const remaining = this.remainingStartMs;
      this.remainingStartMs = null;
      this.startedAt = Date.now() + remaining;
      this.scheduleStartCountdown(remaining);
    } else if (this.kind === 'board') {
      this.armArcadeTickWatchdog();
      scheduleBots(this);
    } else if (this.kind === 'puzzle') {
      schedulePuzzleBots(this);
    }
    this.pushLog('Game resumed');
    this.io?.to(this.id).emit(EV.roomResumed, { paused: false, endsAt: this.endsAt, turnEndsAt: this.turnEndsAt });
    this.broadcastSnapshot();
  }

  async restart(): Promise<void> {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.endTimer) clearTimeout(this.endTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.arcadeTickTimer) {
      clearInterval(this.arcadeTickTimer);
      this.arcadeTickTimer = null;
    }
    stopBots(this.id);

    this.status = 'lobby';
    this.startedAt = null;
    this.endsAt = null;
    this.turnEndsAt = null;
    this.paused = false;
    this.remainingEndMs = null;
    this.remainingTurnMs = null;
    this.remainingStartMs = null;
    this.results = null;
    this.gameState = null;
    this.puzzle = null;
    this.consecutiveBotActions = 0;
    this.clocks = null;
    this.clockActor = null;
    this.clockSince = null;
    this.idleStrikes = 0;

    // Reset all seated players
    for (const p of this.players) {
      p.state = null;
      p.penalties = 0;
      p.completed = false;
      p.completedAtMs = null;
    }

    await db
      .update(rooms)
      .set({
        status: 'lobby',
        startedAt: null,
        endsAt: null,
        finishedAt: null,
      })
      .where(eq(rooms.id, this.id));

    this.pushLog('Host restarted the room for a rematch!');
    this.broadcastPlayers();
    this.broadcastSnapshot();
  }

  private armEndTimer(): void {
    if (this.endTimer) clearTimeout(this.endTimer);
    if (!this.endsAt || this.paused) return;
    const delay = Math.max(0, this.endsAt - Date.now());
    this.endTimer = setTimeout(() => {
      void this.finish('time');
    }, delay);
  }

  /**
   * Board games auto-play the minimal legal action when a turn times out.
   * Chess and Xiangqi instead run a per-player time bank (see `armChessClock`)
   * and forfeit on expiry rather than auto-playing a move for the player.
   */
  armTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.turnEndsAt = null;
    if (this.kind !== 'board' || this.status !== 'running') return;

    const actorId = this.actorToAct();
    if (!actorId) {
      this.clockActor = null;
      this.clockSince = null;
      return;
    }
    const actor = this.player(actorId);
    if (!actor) return;

    if (this.usesChessClock()) {
      this.armChessClock(actorId, actor);
      return;
    }

    if (actor.isBot) return; // bots have their own scheduler

    const limit = Number(this.config['turnTimeLimitSec'] ?? 90) * 1000;
    // A disconnected player still gets a grace window to reconnect before the
    // table auto-plays their turn, instead of an instant timeout — the
    // reconnect grace period would otherwise be meaningless.
    const delay = actor.connected ? limit : Math.min(limit, 15_000);
    this.turnEndsAt = Date.now() + delay;

    this.turnTimer = setTimeout(() => {
      if (this.status !== 'running') return;
      const stillActor = this.actorToAct();
      if (stillActor !== actorId) return;
      const engine = this.engine();
      const action = engine.autoAction(this.gameState as never, actorId);
      const applied = this.applyGameAction(actorId, action, true);
      if (!applied.accepted) {
        logger.error({ roomId: this.id, actorId, err: applied.error }, 'auto-action rejected');
      }
    }, delay);
  }

  /**
   * Watchdog timer for concurrent arcade games (Pac-Man, Tetris): ticks human
   * players who have gone quiet / stalled on the client side.
   */
  armArcadeTickWatchdog(): void {
    if (this.arcadeTickTimer) {
      clearInterval(this.arcadeTickTimer);
      this.arcadeTickTimer = null;
    }
    if (this.kind !== 'board' || (this.gameId !== 'pacman' && this.gameId !== 'tetris' && this.gameId !== 'space-invaders' && this.gameId !== 'bomberman') || this.status !== 'running') {
      return;
    }
    this.arcadeTickTimer = setInterval(() => {
      if (this.status !== 'running' || !this.gameState) return;
      for (const player of this.players) {
        if (player.isBot || player.left) continue;
        const lastAt = this.playerLastActionMs.get(player.id) ?? 0;
        if (Date.now() - lastAt < 1500) continue; // Player is actively ticking on client; do not inject extra ticks!
        const view = this.engine().view(this.gameState as never, player.id) as unknown as { you: { gameOver?: boolean } | null };
        const you = view?.you;
        if (!you || you.gameOver) continue;
        this.applyGameAction(player.id, { type: 'tick' });
      }
    }, 1000);
  }

  /**
   * Chess-clock games: arm the mover's per-move deadline as
   * `min(remaining bank, CHESS_MOVE_CAP_MS)`. Whichever is smaller decides
   * the forfeit reason — a bank running out is 'time', the 4-minute
   * per-move cap firing while the bank still has room left is 'idle'. A
   * disconnected player's bank keeps draining like a real chess clock
   * (unlike the classic per-move timer, which insta-forfeits them) — the
   * reconnect grace period still applies to their SEAT, not their clock.
   */
  private armChessClock(actorId: string, actor: LivePlayer): void {
    if (actor.isBot || !this.clocks) {
      this.clockActor = null;
      this.clockSince = null;
      return;
    }
    // Re-arming while this actor's bank is already draining (e.g. a re-arm
    // triggered mid-move) must not hand them free thinking time on top of
    // what they have already used — deduct the elapsed time first.
    if (this.clockActor === actorId && this.clockSince !== null) {
      const elapsed = Date.now() - this.clockSince;
      this.clocks.set(actorId, Math.max(0, (this.clocks.get(actorId) ?? 0) - elapsed));
    }
    const bank = Math.max(0, this.clocks.get(actorId) ?? 0);
    const cap = Math.min(bank, CHESS_MOVE_CAP_MS);
    const capReason: 'time' | 'idle' = bank <= CHESS_MOVE_CAP_MS ? 'time' : 'idle';

    this.clockActor = actorId;
    this.clockSince = Date.now();
    this.idleStrikes = 0;
    this.turnEndsAt = this.clockSince + cap;

    this.turnTimer = setTimeout(() => {
      if (this.status !== 'running') return;
      if (this.actorToAct() !== actorId) return;
      this.forfeitChessPlayer(actorId, capReason);
    }, cap);

    // "Still thinking?" prompts at 1/2/3 minutes of idling on this move. The
    // 4th minute is not prompted again — the move-cap timer above forfeits
    // the move at that point regardless of how the player answered.
    if (cap > CHESS_IDLE_PROMPT_MS) {
      this.idleTimer = setInterval(() => {
        if (this.status !== 'running' || this.actorToAct() !== actorId) {
          if (this.idleTimer) clearInterval(this.idleTimer);
          this.idleTimer = null;
          return;
        }
        this.idleStrikes += 1;
        if (this.idleStrikes >= 4) {
          if (this.idleTimer) clearInterval(this.idleTimer);
          this.idleTimer = null;
          return; // the move-cap timer above fires the actual forfeit
        }
        this.io?.to(this.id).emit(EV.stillThinking, {
          playerId: actorId,
          strike: this.idleStrikes,
          deadline: this.turnEndsAt,
        });
      }, CHESS_IDLE_PROMPT_MS);
    }
  }

  /**
   * Applies a runtime-only forfeit for the chess clock. This is the ONLY
   * caller of the engine's `forfeit` action — it is deliberately not part of
   * `gameActionSchema`, so a client can never forfeit an opponent by
   * crafting the action themselves; only this method (driven by the
   * `armChessClock` timer above) can produce one.
   */
  private forfeitChessPlayer(actorId: string, reason: 'time' | 'idle'): void {
    if (this.status !== 'running' || !this.gameState) return;
    const engine = this.engine();
    const result = engine.reduce(this.gameState as never, actorId, { type: 'forfeit', reason } as never);
    if (!result.ok) {
      logger.error({ roomId: this.id, actorId, reason, err: result.error }, 'chess-clock forfeit rejected');
      return;
    }
    this.gameState = result.state;
    for (const entry of result.log) this.log.push(this.humanise(entry));
    this.log = this.log.slice(-300);
    void this.appendEvent(actorId, { type: 'forfeit', reason });

    const over = engine.isOver(this.gameState as never);
    if (over.over) {
      const st = this.gameState as { winner?: string | null; winnerAtMs?: number | null };
      if (st.winner && st.winnerAtMs == null) {
        st.winnerAtMs = Math.max(0, Date.now() - (this.startedAt ?? Date.now()));
      }
      void this.finish('completed');
      return;
    }
    this.armTurnTimer();
    this.broadcastGameState();
    this.broadcastLeaderboard();
  }

  /* ---------------- puzzle moves ---------------- */

  commit(
    playerId: string,
    path: string,
    value: number | string | null,
  ): { accepted: boolean; correct?: boolean; progress: number; error?: string; foundWord?: string | null } {
    const player = this.player(playerId);
    if (!player || this.status !== 'running' || !this.puzzle) {
      return { accepted: false, progress: 0, error: 'Room is not running' };
    }
    if (this.paused) {
      return { accepted: false, progress: 0, error: 'Game is currently paused' };
    }
    if (this.endsAt && Date.now() > this.endsAt) {
      return { accepted: false, progress: 0, error: 'Time is up' };
    }
    // Without this, an early mover both gets a head start and records a
    // negative completion time, which would inflate their speed bonus past 1.
    if (this.startedAt && Date.now() < this.startedAt) {
      return { accepted: false, progress: 0, error: 'The game has not started yet' };
    }
    if (player.completed) {
      return { accepted: false, progress: 1, error: 'You have already finished' };
    }

    let nextState: unknown | null;
    /** Word Search only: the newly-found word from this selection, if any. */
    let foundWord: string | null = null;

    if (this.gameId === 'word-search') {
      // path is "y1,x1,y2,x2" — a drag selection, validated against the solution
      // server-side so the client never learns where the words are.
      const [y1, x1, y2, x2] = path.split(',').map(Number);
      if ([y1, x1, y2, x2].some((n) => n === undefined || Number.isNaN(n))) {
        return { accepted: false, progress: 0, error: 'Bad selection' };
      }
      const st = (player.state ?? { found: [], selections: 0 }) as {
        found: string[];
        selections: number;
      };
      const word = wordSearch.checkSelection(
        this.puzzle.puzzle as never,
        this.puzzle.solution as never,
        x1 as number,
        y1 as number,
        x2 as number,
        y2 as number,
      );
      const found = [...st.found];
      if (word && !found.includes(word)) {
        found.push(word);
        foundWord = word;
      }
      nextState = { found, selections: st.selections + 1 };
    } else {
      nextState = applyCommit(this.gameId, player.state, this.puzzle.puzzle, path, value);
    }

    if (nextState === null) {
      // An illegal move costs a penalty, exactly like an illegal board action.
      player.penalties += 1;
      void this.appendEvent(playerId, { type: 'illegal_commit', path, value });
      return { accepted: false, progress: 0, error: 'Illegal move' };
    }
    player.state = nextState;

    const grade = gradePuzzle(this.gameId, player.state, this.puzzle.puzzle, this.puzzle.solution);

    if (grade.complete && !player.completed) {
      player.completed = true;
      player.completedAtMs = Math.max(0, Date.now() - (this.startedAt ?? Date.now()));
      this.pushLog(`${player.displayName} finished!`, player.id);
    }

    void this.appendEvent(player.id, { type: 'commit', path, value });
    this.broadcastLeaderboard();

    const ack: { accepted: boolean; correct?: boolean; progress: number; foundWord?: string | null } = {
      accepted: true,
      progress: grade.progress,
    };
    // ANTI-CHEAT: correctness is only ever disclosed when the host enabled it.
    if (this.instantFeedback) {
      ack.correct = this.isCommitCorrect(path, value);
    }
    // Word Search always reveals which word (if any) a selection completed —
    // that is the game's core feedback loop, not a solution leak, since the
    // client never learns *where* the remaining words are.
    if (this.gameId === 'word-search') ack.foundWord = foundWord;
    if (grade.complete) this.checkAllDone();
    return ack;
  }

  private isCommitCorrect(path: string, value: number | string | null): boolean {
    if (!this.puzzle) return false;
    if (this.gameId === 'sudoku' || this.gameId === 'killer-sudoku') {
      const [r, c] = path.split(',').map(Number);
      const solution = this.puzzle.solution as number[];
      return solution[(r as number) * 9 + (c as number)] === Number(value);
    }
    if (this.gameId === 'nonogram') {
      const size = (this.puzzle.puzzle as { size: number }).size;
      const [r, c] = path.split(',').map(Number);
      const solution = this.puzzle.solution as boolean[];
      const want = solution[(r as number) * size + (c as number)] ? 1 : 2;
      return Number(value) === want;
    }
    if (this.gameId === 'minesweeper') {
      const [r, c] = path.split(',').map(Number);
      const solution = this.puzzle.solution as { cols: number; grid: number[] };
      return solution.grid[(r as number) * solution.cols + (c as number)] !== -1;
    }
    return true;
  }

  hint(playerId: string): { hint: { path: string; value: number | string } | null; error?: string } {
    const player = this.player(playerId);
    if (!player || !this.puzzle || this.status !== 'running') {
      return { hint: null, error: 'Room is not running' };
    }
    const rng = mulberry32(Date.now() & 0xffff);
    const hint = puzzleHint(
      this.gameId,
      this.puzzle.puzzle,
      this.puzzle.solution,
      player.state,
      rng,
    );
    if (!hint) return { hint: null, error: 'Nothing left to reveal' };
    player.penalties += 1;
    void this.appendEvent(playerId, { type: 'hint', path: hint.path });
    this.broadcastLeaderboard();
    return { hint };
  }

  /* ---------------- board moves ---------------- */

  applyGameAction(
    playerId: string,
    action: unknown,
    fromTimeout = false,
  ): { accepted: boolean; error?: string } {
    if (this.kind !== 'board' || !this.gameState || this.status !== 'running') {
      return { accepted: false, error: 'Room is not running' };
    }
    if (this.paused) {
      return { accepted: false, error: 'Game is currently paused' };
    }
    if (this.endsAt && Date.now() > this.endsAt) {
      return { accepted: false, error: 'Time is up' };
    }
    if (this.startedAt && Date.now() < this.startedAt) {
      return { accepted: false, error: 'The game has not started yet' };
    }
    const engine = this.engine();
    const result = engine.reduce(this.gameState as never, playerId, action as never);
    if (!result.ok) {
      const player = this.player(playerId);
      // A rejected illegal action costs a penalty.
      if (player) player.penalties += 1;
      return { accepted: false, error: result.error };
    }

    this.gameState = result.state;
    this.playerLastActionMs.set(playerId, Date.now());
    if (fromTimeout) {
      const player = this.player(playerId);
      if (player) player.penalties += 1;
    }

    // Engines log by player id because they have no idea what anyone is called.
    // Swap in display names before anything reaches a client.
    for (const entry of result.log) this.log.push(this.humanise(entry));
    this.log = this.log.slice(-300);

    void this.appendEvent(playerId, action as object);

    // Chess-clock games: charge the elapsed time against the mover's bank
    // and apply the increment, now that their move has been accepted.
    // `armTurnTimer()` below re-arms the deadline for the *new* actor from
    // whatever remains in their own bank.
    if (this.usesChessClock() && this.clocks && this.clockActor === playerId && this.clockSince !== null) {
      const elapsed = Date.now() - this.clockSince;
      const remaining = Math.max(0, (this.clocks.get(playerId) ?? 0) - elapsed);
      const incrementMs = Number((this.config as { incrementSec?: number }).incrementSec ?? 0) * 1000;
      this.clocks.set(playerId, remaining + incrementMs);
      this.clockActor = null;
      this.clockSince = null;
    }

    const over = engine.isOver(this.gameState as never);
    if (over.over) {
      // Stamp the winner's finish time from the runtime's clock — engines are
      // forbidden from reading the wall clock, so this is where it enters.
      const st = this.gameState as { winner?: string | null; winnerAtMs?: number | null };
      if (st.winner && st.winnerAtMs == null) {
        st.winnerAtMs = Math.max(0, Date.now() - (this.startedAt ?? Date.now()));
      }
      void this.finish('completed');
      return { accepted: true };
    }

    // Arm before broadcasting: the deadline rides on `game:state`, so arming
    // afterwards would ship every client the *previous* actor's deadline and
    // the countdown would hit zero with nothing happening.
    this.armTurnTimer();
    this.broadcastGameState();
    this.broadcastLeaderboard();
    scheduleBots(this);
    return { accepted: true };
  }

  /* ---------------- persistence ---------------- */

  private async appendEvent(actorPlayerId: string | null, action: object): Promise<void> {
    const rawPayload =
      this.kind === 'board'
        ? { kind: 'board', gameState: this.gameState }
        : {
            kind: 'puzzle',
            players: this.players.map((p) => ({
              id: p.id,
              state: p.state,
              penalties: p.penalties,
              completed: p.completed,
              completedAtMs: p.completedAtMs,
            })),
          };
    const payload = structuredClone(rawPayload);

    this.seq += 1;
    const seq = this.seq;
    try {
      await db.insert(roomEvents).values({
        roomId: this.id,
        seq,
        actorPlayerId,
        action,
      });
      if (seq % SNAPSHOT_EVERY === 0) await this.writeSnapshot(seq, payload);
    } catch (err) {
      logger.error({ err, roomId: this.id }, 'failed to append room event');
    }
  }

  private async writeSnapshot(seq: number, state: object): Promise<void> {
    try {
      await db.insert(roomSnapshots).values({ roomId: this.id, seq, state }).onConflictDoNothing();
    } catch (err) {
      logger.error({ err, roomId: this.id }, 'failed to write snapshot');
    }
  }

  /* ---------------- scoring and finish ---------------- */

  scoreInputFor(player: LivePlayer): ScoreInput {
    if (this.kind === 'board' && this.gameState) {
      return this.engine().score(this.gameState as never, player.id);
    }
    if (!this.puzzle) {
      return { progress: 0, accuracy: 0, completed: false, completedAtMs: null, penalties: 0 };
    }
    const grade = gradePuzzle(this.gameId, player.state, this.puzzle.puzzle, this.puzzle.solution);
    return {
      progress: grade.progress,
      accuracy: grade.accuracy,
      completed: player.completed,
      completedAtMs: player.completedAtMs,
      penalties: player.penalties,
    };
  }

  /** Every puzzle player finished -> end early. */
  private checkAllDone(): void {
    if (this.kind !== 'puzzle') return;
    const active = this.players.filter((p) => !p.left);
    if (active.length > 0 && active.every((p) => p.completed)) void this.finish('completed');
  }

  async finish(reason: 'time' | 'completed' | 'host'): Promise<void> {
    if (this.status === 'finished') return;
    this.status = 'finished';
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.endTimer) clearTimeout(this.endTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.arcadeTickTimer) {
      clearInterval(this.arcadeTickTimer);
      this.arcadeTickTimer = null;
    }
    stopBots(this.id);
    const rowsToRank = this.players
      .filter((p) => !p.left || p.isBot)
      .map((p) => {
        const input = this.scoreInputFor(p);
        // Property Tycoon and Scrabble don't go through the progress/accuracy/
        // speed blend at all — their score IS the assetValue escape hatch
        // (total asset value for PT, raw point total for Scrabble). See the
        // comment on `assetValueBreakdown` in property-tycoon/rules.ts.
        const usesAssetValue =
          (this.gameId === 'property-tycoon' || this.gameId === 'scrabble' || this.gameId === 'congkak' || this.gameId === 'tetris' || this.gameId === 'pacman' || this.gameId === 'space-invaders' || this.gameId === 'bomberman') &&
          input.assetValue !== undefined;
        const score = usesAssetValue
          ? Math.round(input.assetValue as number)
          : computeScore(input, this.timeLimitMs);
        const detail =
          this.gameId === 'property-tycoon' && this.gameState
            ? propertyTycoonRules.assetValueBreakdown(this.gameState as never, p.id)
            : {};
        return {
          playerId: p.id,
          displayName: p.displayName,
          avatar: p.avatar,
          seat: p.seat,
          isBot: p.isBot,
          score,
          progress: input.progress,
          accuracy: input.accuracy,
          speed: speedComponent(input, this.timeLimitMs),
          completed: input.completed,
          completedAtMs: input.completedAtMs,
          penalties: input.penalties,
          detail,
        };
      });

    const ranked = rankResults(rowsToRank);
    this.results = ranked as ResultRow[];

    try {
      await db.transaction(async (tx) => {
        if (ranked.length > 0) {
          await tx
            .insert(roomResults)
            .values(
              ranked.map((r) => ({
                roomId: this.id,
                playerId: r.playerId,
                rank: r.rank,
                score: r.score,
                progress: r.progress,
                accuracy: r.accuracy,
                speed: r.speed,
                completed: r.completed,
                completedAtMs: r.completedAtMs,
                penalties: r.penalties,
                detail: r.detail,
              })),
            )
            .onConflictDoNothing();
        }
        await tx
          .update(rooms)
          .set({ status: 'finished', finishedAt: new Date() })
          .where(eq(rooms.id, this.id));
      });
    } catch (err) {
      logger.error({ err, roomId: this.id }, 'failed to persist results');
    }

    logger.info({ roomId: this.id, reason }, 'room finished');
    this.io?.to(this.id).emit(EV.roomEnded, { results: this.results });
    this.broadcastSnapshot();

    // Keep the room in memory for a grace period so late clients still get it.
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      if (this.status === 'finished') {
        rooms_registry.delete(this.id);
      }
    }, 60_000);
  }

  /* ---------------- views and broadcasting ---------------- */

  meta(): RoomMeta {
    return {
      id: this.id,
      code: this.code,
      gameId: this.gameId,
      status: this.status,
      timeLimitSec: this.timeLimitSec,
      config: this.config,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      hostPlayerId: this.host?.id ?? null,
      paused: this.paused,
    };
  }

  playerViews(): PlayerView[] {
    return this.players
      .filter((p) => !p.left)
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        seat: p.seat,
        isHost: p.isHost,
        isBot: p.isBot,
        botDifficulty: p.botDifficulty,
        avatar: p.avatar,
        connected: p.connected || p.isBot,
        left: p.left,
      }));
  }

  leaderboard(): LeaderboardEntry[] {
    const entries = this.players
      .filter((p) => !p.left)
      .map((p) => {
        let progress = 0;
        let score: number | null = null;
        // Board games never touch the puzzle-style `completed` flag on
        // LivePlayer — it stays false for them forever. The engine's own
        // ScoreInput.completed (true only for the winner, by accusation or
        // by last-player-standing) is the real signal for those games.
        let completed = p.completed;
        let wrongAccusations: number | undefined;

        if (this.kind === 'puzzle' && this.puzzle) {
          const grade = gradePuzzle(
            this.gameId,
            p.state,
            this.puzzle.puzzle,
            this.puzzle.solution,
          );
          // ANTI-CHEAT: while instant feedback is off the table shows how much
          // each player has FILLED, never how much they got right — otherwise
          // the leaderboard leaks the solution one cell at a time.
          progress = this.instantFeedback ? grade.progress : grade.filledFraction;
        } else if (this.gameState) {
          const input = this.engine().score(this.gameState as never, p.id);
          progress = input.progress;
          completed = input.completed;
          if (this.gameId === 'manor-mystery') {
            const view = manorMystery.view(this.gameState as never, null) as {
              players: { id: string; wrongAccusations: number }[];
            };
            wrongAccusations = view.players.find((pl) => pl.id === p.id)?.wrongAccusations ?? 0;
          }
        }

        if (this.status === 'finished') {
          score = this.results?.find((r) => r.playerId === p.id)?.score ?? null;
        }

        return {
          playerId: p.id,
          displayName: p.displayName,
          seat: p.seat,
          isBot: p.isBot,
          progress,
          completed,
          completedAtMs: p.completedAtMs,
          penalties: p.penalties,
          score,
          ...(wrongAccusations !== undefined ? { wrongAccusations } : {}),
        };
      });

    if (this.status === 'finished') {
      // Rank by the same score every results table uses — sorting by progress
      // alone would put an unfinished Manor Mystery detective who has
      // eliminated more cards above the actual winner.
      const ranked = rankResults(
        entries.map((e) => ({
          playerId: e.playerId,
          score: e.score ?? 0,
          completedAtMs: e.completedAtMs,
          penalties: e.penalties,
          seat: e.seat,
        })),
      );
      const order = new Map(ranked.map((r, i) => [r.playerId, i]));
      return entries.sort((a, b) => (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0));
    }

    return entries.sort((a, b) => b.progress - a.progress);
  }

  /** What a specific player may see of the game state. */
  stateFor(playerId: string | null): unknown {
    if (this.kind === 'board') {
      if (!this.gameState) return null;
      const view = this.engine().view(this.gameState as never, playerId);
      // Engines log by player id because they have no idea what anyone is
      // called (see `humanise()`), and that raw log is embedded directly in
      // the view they return (e.g. checkers/index.ts's `s.log`). humanise()
      // is otherwise only ever applied to the copy kept on `this.log` (the
      // sidebar Match Log) — without this, every board's in-game move log
      // renders raw player ids instead of display names. Funnel every view
      // through here rather than patching each engine, since `stateFor` is
      // the single point both `snapshotFor()` and `broadcastGameState()` go
      // through.
      if (
        view &&
        typeof view === 'object' &&
        Array.isArray((view as { log?: unknown }).log)
      ) {
        const v = view as { log: LogEntry[] };
        v.log = v.log.map((entry) => this.humanise(entry));
      }
      return view;
    }
    if (!this.puzzle) return null;
    const player = playerId ? this.player(playerId) : null;
    return {
      puzzle: this.puzzle.puzzle,
      meta: this.puzzle.meta,
      board: player?.state ?? this.puzzle.initialState,
      // The solution is revealed at exactly one moment: after the room ends.
      solution: this.status === 'finished' ? this.puzzle.solution : null,
    };
  }

  /** Chess-clock games only: the wire-shaped `clocks` array, or null. */
  private clockPayload(): { playerId: string; remainingMs: number }[] | null {
    if (!this.usesChessClock() || !this.clocks) return null;
    return [...this.clocks.entries()].map(([playerId, remainingMs]) => ({ playerId, remainingMs }));
  }

  snapshotFor(playerId: string | null): RoomSnapshot {
    const player = playerId ? this.player(playerId) : null;
    return {
      room: this.meta(),
      players: this.playerViews(),
      you: player ? { playerId: player.id, seat: player.seat, isHost: player.isHost } : null,
      state: this.stateFor(playerId),
      legalActions:
        this.kind === 'board' && this.gameState && playerId
          ? this.engine().legalActions(this.gameState as never, playerId)
          : [],
      endsAt: this.endsAt,
      turnEndsAt: this.turnEndsAt,
      leaderboard: this.leaderboard(),
      log: this.log.slice(-100),
      results: this.results,
      clocks: this.clockPayload(),
      clockActor: this.usesChessClock() ? this.clockActor : null,
      clockRunningSince: this.usesChessClock() ? this.clockSince : null,
      moveDeadline: this.usesChessClock() ? this.turnEndsAt : null,
    };
  }

  /** Snapshots are per-socket because each carries a different private view. */
  broadcastSnapshot(): void {
    if (!this.io) return;
    for (const [, socket] of this.io.sockets.sockets) {
      const pid = socket.data.playerId as string | undefined;
      if (socket.rooms.has(this.id)) {
        socket.emit(EV.roomSnapshot, this.snapshotFor(pid ?? null));
      }
    }
  }

  broadcastGameState(): void {
    if (!this.io) return;
    for (const [, socket] of this.io.sockets.sockets) {
      if (!socket.rooms.has(this.id)) continue;
      const pid = socket.data.playerId as string | undefined;
      socket.emit(EV.gameState, {
        publicState: this.stateFor(pid ?? null),
        legalActions:
          this.kind === 'board' && this.gameState && pid
            ? this.engine().legalActions(this.gameState as never, pid)
            : [],
        turnEndsAt: this.turnEndsAt,
        clocks: this.clockPayload(),
        clockActor: this.usesChessClock() ? this.clockActor : null,
        clockRunningSince: this.usesChessClock() ? this.clockSince : null,
        moveDeadline: this.usesChessClock() ? this.turnEndsAt : null,
      });
    }
    this.io.to(this.id).emit(EV.gameLog, { entries: this.log.slice(-50) });
  }

  broadcastLeaderboard(): void {
    this.io?.to(this.id).emit(EV.leaderboard, { entries: this.leaderboard() });
  }

  broadcastPlayers(): void {
    this.io?.to(this.id).emit(EV.roomPlayers, { players: this.playerViews() });
  }

  /** Replace player ids in log text with display names. */
  private humanise(entry: LogEntry): LogEntry {
    let text = entry.text;
    for (const p of this.players) {
      if (text.includes(p.id)) text = text.split(p.id).join(p.displayName);
    }
    return { ...entry, text };
  }

  pushLog(text: string, playerId: string | null = null): void {
    this.log.push({ seq: this.log.length, at: Date.now(), text, playerId });
    this.log = this.log.slice(-300);
    this.io?.to(this.id).emit(EV.gameLog, { entries: this.log.slice(-50) });
  }

  /** A player dropped: hold their seat for the grace period. */
  markDisconnected(playerId: string): void {
    const player = this.player(playerId);
    if (!player) return;
    player.connected = false;
    this.broadcastPlayers();
    // A disconnected player must not stall the table, but an already-armed
    // deadline (set while they were still connected) must keep counting down
    // to its original `turnEndsAt` — resetting it here would insta-skip
    // their turn and defeat the reconnect grace period entirely.
    if (this.kind === 'board' && this.actorToAct() === playerId && this.turnEndsAt === null) {
      this.armTurnTimer();
    }

    setTimeout(() => {
      const still = this.player(playerId);
      if (still && !still.connected && this.status === 'lobby') {
        still.left = true;
        void db
          .update(roomPlayers)
          .set({ leftAt: new Date() })
          .where(eq(roomPlayers.id, playerId));
        this.broadcastPlayers();
      }
    }, RECONNECT_GRACE_SEC * 1000);
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const rooms_registry = new Map<string, LiveRoom>();

export function getRoom(id: string): LiveRoom | undefined {
  return rooms_registry.get(id);
}

export function getRoomByCode(code: string): LiveRoom | undefined {
  for (const room of rooms_registry.values()) {
    if (room.code === code.toUpperCase() && (room.status === 'lobby' || room.status === 'running')) {
      return room;
    }
  }
  return undefined;
}

export function registerRoom(room: LiveRoom): void {
  rooms_registry.set(room.id, room);
}

/** Load a room from the database into memory, players included. */
export async function loadRoom(roomId: string, io: IOServer): Promise<LiveRoom | null> {
  const existing = rooms_registry.get(roomId);
  if (existing) return existing;

  const row = (await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1))[0];
  if (!row) return null;

  const room = new LiveRoom({
    id: row.id,
    code: row.code,
    gameId: row.gameId,
    config: row.config,
    timeLimitSec: row.timeLimitSec,
    status: row.status,
    startedAt: row.startedAt,
    endsAt: row.endsAt,
  });
  room.attach(io);

  const playerRows = await db
    .select()
    .from(roomPlayers)
    .where(eq(roomPlayers.roomId, roomId))
    .orderBy(asc(roomPlayers.seat));

  room.players = playerRows.map((p) => ({
    id: p.id,
    guestId: p.guestId,
    displayName: p.displayName,
    seat: p.seat,
    isHost: p.isHost,
    isBot: p.isBot,
    botDifficulty: p.botDifficulty as BotDifficulty | null,
    avatar: p.avatar,
    connected: false,
    left: p.leftAt !== null,
    state: null,
    penalties: 0,
    completed: false,
    completedAtMs: null,
  }));

  registerRoom(room);
  return room;
}

/**
 * Rehydrate rooms left `running` by a crash: load the newest snapshot, then
 * replay every later event through the same reducer. This is exactly why the
 * PRNG lives inside game state.
 */
export async function rehydrateRunningRooms(io: IOServer): Promise<void> {
  const running = await db.select().from(rooms).where(eq(rooms.status, 'running'));
  for (const row of running) {
    try {
      const room = await loadRoom(row.id, io);
      if (!room) continue;

      // Puzzle rooms need their generated instance back.
      const inst = (
        await db.select().from(puzzleInstances).where(eq(puzzleInstances.roomId, row.id)).limit(1)
      )[0];
      if (inst) {
        room.puzzle = {
          puzzle: inst.puzzle,
          solution: inst.solution,
          meta: inst.meta as GeneratedPuzzle['meta'],
          initialState: initialPuzzleState(room.gameId, inst.puzzle),
          solveOrder: [],
        };
      }

      const snap = (
        await db
          .select()
          .from(roomSnapshots)
          .where(eq(roomSnapshots.roomId, row.id))
          .orderBy(asc(roomSnapshots.seq))
      ).at(-1);

      let fromSeq = 0;
      if (snap) {
        fromSeq = snap.seq;
        const state = snap.state as { kind: string; gameState?: unknown; players?: unknown[] };
        if (state.kind === 'board') {
          room.gameState = state.gameState;
        } else if (Array.isArray(state.players)) {
          for (const saved of state.players as {
            id: string;
            state: unknown;
            penalties: number;
            completed: boolean;
            completedAtMs: number | null;
          }[]) {
            const p = room.player(saved.id);
            if (p) {
              p.state = saved.state;
              p.penalties = saved.penalties;
              p.completed = saved.completed;
              p.completedAtMs = saved.completedAtMs;
            }
          }
        }
      } else if (room.kind === 'board') {
        // No snapshot yet: rebuild from setup and replay everything.
        const active = room.players.filter((p) => !p.left);
        room.gameState = room.engine().setup(
          active.map((p) => p.id),
          Number(inst?.seed ?? 1),
          room.config,
        );
      } else if (room.kind === 'puzzle' && room.puzzle) {
        for (const p of room.players) {
          p.state = structuredClone(room.puzzle.initialState);
        }
      }

      const events = await db
        .select()
        .from(roomEvents)
        .where(and(eq(roomEvents.roomId, row.id), gt(roomEvents.seq, fromSeq)))
        .orderBy(asc(roomEvents.seq));

      for (const ev of events) {
        room.seq = ev.seq;
        const action = ev.action as { type?: string; path?: string; value?: unknown };
        if (room.kind === 'board' && room.gameState && ev.actorPlayerId) {
          const r = room.engine().reduce(room.gameState as never, ev.actorPlayerId, action as never);
          if (r.ok) room.gameState = r.state;
        } else if (room.kind === 'puzzle' && ev.actorPlayerId && action.type === 'commit') {
          const p = room.player(ev.actorPlayerId);
          if (p && room.puzzle) {
            const next = applyCommit(
              room.gameId,
              p.state,
              room.puzzle.puzzle,
              String(action.path),
              (action.value ?? null) as number | string | null,
            );
            if (next !== null) p.state = next;
          }
        } else if (room.kind === 'puzzle' && ev.actorPlayerId && action.type === 'hint') {
          const p = room.player(ev.actorPlayerId);
          if (p) p.penalties += 1;
        } else if (room.kind === 'puzzle' && ev.actorPlayerId && action.type === 'illegal_commit') {
          const p = room.player(ev.actorPlayerId);
          if (p) p.penalties += 1;
        }
      }

      if (room.kind === 'puzzle' && room.puzzle) {
        for (const p of room.players.filter((pl) => !pl.isBot)) {
          const grade = gradePuzzle(room.gameId, p.state, room.puzzle.puzzle, room.puzzle.solution);
          if (grade.complete && !p.completed) {
            p.completed = true;
            let lastEventAt: Date | null = null;
            for (let i = events.length - 1; i >= 0; i--) {
              if (events[i]!.actorPlayerId === p.id) {
                lastEventAt = events[i]!.at;
                break;
              }
            }
            if (lastEventAt !== null) {
              p.completedAtMs = Math.max(0, lastEventAt.getTime() - (room.startedAt ?? Date.now()));
            }
          }
        }
      }

      // A room whose clock ran out while the server was down is finished, not
      // resumable — otherwise it sits 'running' forever and the turn timer
      // fires auto-actions the reducer rightly rejects with "Time is up".
      if (room.endsAt !== null && room.endsAt <= Date.now()) {
        await room.finish('time');
        logger.info({ roomId: row.id }, 'expired room finalised on boot');
        continue;
      }

      // Chess-clock games: `clocks` (the live per-player time bank) is
      // runtime-only bookkeeping, not part of engine state, so it doesn't
      // come back from the `reduce` replay above. Reconstruct it from the
      // gaps between consecutive `room_events` timestamps — each gap was
      // spent by whoever was on the clock, i.e. the actor of the event that
      // closed it. This needs the FULL event history from room start, not
      // just the post-snapshot tail already loaded into `events`.
      if (room.kind === 'board' && room.usesChessClock()) {
        const minutes = Number((room.config as { clockMinutes?: number }).clockMinutes ?? 10);
        const bankMs = minutes * 60_000;
        const clocks = new Map<string, number>(
          room.players.filter((p) => !p.isBot).map((p) => [p.id, bankMs]),
        );
        const allEvents = await db
          .select()
          .from(roomEvents)
          .where(eq(roomEvents.roomId, row.id))
          .orderBy(asc(roomEvents.seq));
        let prevAt = room.startedAt !== null ? new Date(room.startedAt) : null;
        for (const ev of allEvents) {
          const actorId = ev.actorPlayerId;
          if (prevAt && actorId && clocks.has(actorId)) {
            const spent = ev.at.getTime() - prevAt.getTime();
            if (spent > 0) clocks.set(actorId, Math.max(0, (clocks.get(actorId) ?? 0) - spent));
          }
          prevAt = ev.at;
        }
        // Whoever's turn it is now has been thinking since the last event.
        const nowActor = room.actorToAct();
        if (nowActor && prevAt && clocks.has(nowActor)) {
          const spent = Date.now() - prevAt.getTime();
          if (spent > 0) clocks.set(nowActor, Math.max(0, (clocks.get(nowActor) ?? 0) - spent));
        }
        room.clocks = clocks;
      }

      room.armTurnTimer();
      room.armArcadeTickWatchdog();
      // Recovery has to restart the bot scheduler too. Without this a room
      // whose next actor is a bot comes back 'running' and then sits there
      // forever, because nothing is left to take the bot's turn.
      if (room.kind === 'board') scheduleBots(room);
      else schedulePuzzleBots(room);
      logger.info(
        { roomId: row.id, replayed: events.length, fromSeq },
        'rehydrated running room',
      );
    } catch (err) {
      logger.error({ err, roomId: row.id }, 'failed to rehydrate room');
    }
  }
}
