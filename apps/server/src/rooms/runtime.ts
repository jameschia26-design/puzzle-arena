import { and, asc, eq, gt } from 'drizzle-orm';
import type { Server as IOServer } from 'socket.io';
import {
  EV,
  GAME_REGISTRY,
  RECONNECT_GRACE_SEC,
  START_COUNTDOWN_MS,
  computeScore,
  mulberry32,
  rankResults,
  speedComponent,
  type BotDifficulty,
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
  manorMystery,
  manorMysteryRules,
  propertyTycoon,
  propertyTycoonRules,
  scrabble,
  scrabbleRules,
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

  players: LivePlayer[] = [];
  seq = 0;

  /** Puzzle rooms. `solution` must never be serialised to a client. */
  puzzle: GeneratedPuzzle | null = null;
  /** Board rooms. */
  gameState: unknown = null;

  results: ResultRow[] | null = null;
  log: LogEntry[] = [];
  chat: { id: string; playerId: string; displayName: string; seat: number; text: string; at: number }[] = [];

  private endTimer: NodeJS.Timeout | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  /**
   * Absolute deadline for the current actor, or null when nobody human is on
   * the clock. Broadcast so the client can show the same countdown the server
   * will act on, rather than being auto-declined out of nowhere.
   */
  private turnEndsAt: number | null = null;
  private io: IOServer | null = null;
  /** Guards against an engine bug spinning the bot scheduler forever. */
  consecutiveBotActions = 0;

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
    }

    const startsAt = Date.now() + START_COUNTDOWN_MS;
    this.startedAt = startsAt;
    this.endsAt = startsAt + this.timeLimitMs;
    this.status = 'running';

    await db
      .update(rooms)
      .set({
        status: 'running',
        startedAt: new Date(startsAt),
        endsAt: new Date(this.endsAt),
      })
      .where(eq(rooms.id, this.id));

    this.armEndTimer();
    this.io?.to(this.id).emit(EV.roomStarted, { startsAt, endsAt: this.endsAt });
    this.broadcastSnapshot();
    // Board games need their per-player legal actions immediately, or the first
    // player sits in front of a board with every button disabled.
    if (this.kind === 'board') this.broadcastGameState();

    // Bots only begin once play actually starts.
    setTimeout(() => {
      if (this.status !== 'running') return;
      if (this.kind === 'board') {
        this.armTurnTimer();
        // The first actor's deadline exists only once the countdown clears.
        this.broadcastGameState();
        scheduleBots(this);
      } else {
        schedulePuzzleBots(this);
      }
    }, START_COUNTDOWN_MS);
  }

  engine() {
    if (this.gameId === 'property-tycoon') return propertyTycoon as unknown as typeof propertyTycoon;
    if (this.gameId === 'scrabble') return scrabble as unknown as typeof propertyTycoon;
    return manorMystery as unknown as typeof propertyTycoon;
  }

  /** Whoever the board game is waiting on, or null. */
  actorToAct(): string | null {
    if (this.kind !== 'board' || !this.gameState) return null;
    if (this.gameId === 'property-tycoon') return propertyTycoonRules.actorToAct(this.gameState as never);
    if (this.gameId === 'scrabble') return scrabbleRules.actorToAct(this.gameState as never);
    return manorMysteryRules.actorToAct(this.gameState as never);
  }

  private armEndTimer(): void {
    if (this.endTimer) clearTimeout(this.endTimer);
    if (!this.endsAt) return;
    const delay = Math.max(0, this.endsAt - Date.now());
    this.endTimer = setTimeout(() => {
      void this.finish('time');
    }, delay);
  }

  /** Board games auto-play the minimal legal action when a turn times out. */
  armTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnEndsAt = null;
    if (this.kind !== 'board' || this.status !== 'running') return;

    const actorId = this.actorToAct();
    if (!actorId) return;
    const actor = this.player(actorId);
    if (!actor || actor.isBot) return; // bots have their own scheduler

    const limit = Number(this.config['turnTimeLimitSec'] ?? 90) * 1000;
    // A disconnected player does not get to stall the table.
    const delay = actor.connected ? limit : 0;
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

  /* ---------------- puzzle moves ---------------- */

  commit(
    playerId: string,
    path: string,
    value: number | string | null,
  ): { accepted: boolean; correct?: boolean; progress: number; error?: string } {
    const player = this.player(playerId);
    if (!player || this.status !== 'running' || !this.puzzle) {
      return { accepted: false, progress: 0, error: 'Room is not running' };
    }
    if (this.endsAt && Date.now() > this.endsAt) {
      return { accepted: false, progress: 0, error: 'Time is up' };
    }
    // Play begins simultaneously for everyone when the 3-2-1-GO overlay clears.
    // Without this, an early mover both gets a head start and records a
    // negative completion time, which would inflate their speed bonus past 1.
    if (this.startedAt && Date.now() < this.startedAt) {
      return { accepted: false, progress: 0, error: 'The game has not started yet' };
    }
    if (player.completed) {
      return { accepted: false, progress: 1, error: 'You have already finished' };
    }

    let nextState: unknown | null;

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
      if (word && !found.includes(word)) found.push(word);
      nextState = { found, selections: st.selections + 1 };
    } else {
      nextState = applyCommit(this.gameId, player.state, this.puzzle.puzzle, path, value);
    }

    if (nextState === null) {
      // An illegal move costs a penalty, exactly like an illegal board action.
      player.penalties += 1;
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

    const ack: { accepted: boolean; correct?: boolean; progress: number } = {
      accepted: true,
      progress: grade.progress,
    };
    // ANTI-CHEAT: correctness is only ever disclosed when the host enabled it.
    if (this.instantFeedback) {
      ack.correct = this.isCommitCorrect(path, value);
    }
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
    if (this.endsAt && Date.now() > this.endsAt) {
      return { accepted: false, error: 'Time is up' };
    }
    // Board actions wait for the countdown too, so play starts level.
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
    if (fromTimeout) {
      const player = this.player(playerId);
      if (player) player.penalties += 1;
    }

    // Engines log by player id because they have no idea what anyone is called.
    // Swap in display names before anything reaches a client.
    for (const entry of result.log) this.log.push(this.humanise(entry));
    this.log = this.log.slice(-300);

    void this.appendEvent(playerId, action as object);

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
    this.seq += 1;
    const seq = this.seq;
    try {
      await db.insert(roomEvents).values({
        roomId: this.id,
        seq,
        actorPlayerId,
        action,
      });
      if (seq % SNAPSHOT_EVERY === 0) await this.writeSnapshot(seq);
    } catch (err) {
      logger.error({ err, roomId: this.id }, 'failed to append room event');
    }
  }

  private async writeSnapshot(seq: number): Promise<void> {
    const state =
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
    if (this.endTimer) clearTimeout(this.endTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
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
          (this.gameId === 'property-tycoon' || this.gameId === 'scrabble') &&
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
      await db
        .update(rooms)
        .set({ status: 'finished', finishedAt: new Date() })
        .where(eq(rooms.id, this.id));
      if (ranked.length > 0) {
        await db
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
    } catch (err) {
      logger.error({ err, roomId: this.id }, 'failed to persist results');
    }

    logger.info({ roomId: this.id, reason }, 'room finished');
    this.io?.to(this.id).emit(EV.roomEnded, { results: this.results });
    this.broadcastSnapshot();

    // Keep the room in memory for a grace period so late clients still get it.
    setTimeout(() => rooms_registry.delete(this.id), 60_000);
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
      return this.engine().view(this.gameState as never, playerId);
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
    // In a board game the table should not stall on an absent player.
    if (this.kind === 'board' && this.actorToAct() === playerId) this.armTurnTimer();

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
          initialState: null,
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

      room.armTurnTimer();
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
