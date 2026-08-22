import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import {
  EV,
  type ChatMessage,
  type LeaderboardEntry,
  type LogEntry,
  type PlayerView,
  type ResultRow,
  type RoomMeta,
  type RoomSnapshot,
} from '@puzzle-arena/shared';

/** The single socket instance for the whole app. */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], autoConnect: true });
    wire(socket);
  }
  return socket;
}

export async function ensureGuest(): Promise<void> {
  // Mints the signed pa_guest cookie the socket handshake needs.
  await fetch('/api/guest', { method: 'POST' }).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export interface RoomStore {
  connected: boolean;
  room: RoomMeta | null;
  players: PlayerView[];
  you: { playerId: string; seat: number; isHost: boolean } | null;
  state: unknown;
  legalActions: string[];
  endsAt: number | null;
  /** Deadline for the player currently on the clock; board games only. */
  turnEndsAt: number | null;
  startsAt: number | null;
  leaderboard: LeaderboardEntry[];
  log: LogEntry[];
  chat: ChatMessage[];
  results: ResultRow[] | null;
  error: string | null;
  paused: boolean;
  /** Chess-clock games only (Chess, Xiangqi); null for every other game. */
  clocks: { playerId: string; remainingMs: number }[] | null;
  clockActor: string | null;
  clockRunningSince: number | null;
  moveDeadline: number | null;

  applySnapshot(snapshot: RoomSnapshot): void;
  reset(): void;
  setError(message: string | null): void;
}

export const useRoom = create<RoomStore>((set) => ({
  connected: false,
  room: null,
  players: [],
  you: null,
  state: null,
  legalActions: [],
  endsAt: null,
  turnEndsAt: null,
  startsAt: null,
  leaderboard: [],
  log: [],
  chat: [],
  results: null,
  error: null,
  paused: false,
  clocks: null,
  clockActor: null,
  clockRunningSince: null,
  moveDeadline: null,
  applySnapshot(snapshot) {
    set({
      room: snapshot.room,
      players: snapshot.players,
      you: snapshot.you,
      state: snapshot.state,
      legalActions: snapshot.legalActions ?? [],
      endsAt: snapshot.endsAt,
      turnEndsAt: snapshot.turnEndsAt ?? null,
      leaderboard: snapshot.leaderboard,
      log: snapshot.log,
      results: snapshot.results,
      paused: snapshot.room?.paused ?? false,
      clocks: snapshot.clocks ?? null,
      clockActor: snapshot.clockActor ?? null,
      clockRunningSince: snapshot.clockRunningSince ?? null,
      moveDeadline: snapshot.moveDeadline ?? null,
    });
  },
  reset() {
    set({
      room: null,
      players: [],
      you: null,
      state: null,
      legalActions: [],
      endsAt: null,
      turnEndsAt: null,
      startsAt: null,
      leaderboard: [],
      log: [],
      chat: [],
      results: null,
      error: null,
      paused: false,
      clocks: null,
      clockActor: null,
      clockRunningSince: null,
      moveDeadline: null,
    });
  },
  setError(message) {
    set({ error: message });
  },
}));

function wire(s: Socket): void {
  s.on('connect', () => useRoom.setState({ connected: true }));
  s.on('disconnect', () => useRoom.setState({ connected: false }));
  s.on('connect_error', (err) => useRoom.setState({ error: err.message }));

  s.on(EV.roomSnapshot, (snapshot: RoomSnapshot) => {
    useRoom.getState().applySnapshot(snapshot);
  });
  s.on(EV.roomPlayers, (payload: { players: PlayerView[] }) => {
    useRoom.setState({ players: payload.players });
  });
  s.on(EV.roomStarted, (payload: { startsAt: number; endsAt: number }) => {
    useRoom.setState({ startsAt: payload.startsAt, endsAt: payload.endsAt });
  });
  s.on(EV.roomEnded, (payload: { results: ResultRow[] }) => {
    useRoom.setState({ results: payload.results });
  });
  s.on(EV.roomPaused, () => {
    useRoom.setState((prev) => ({
      paused: true,
      room: prev.room ? { ...prev.room, paused: true } : null,
    }));
  });
  s.on(EV.roomResumed, (payload: { endsAt?: number | null; turnEndsAt?: number | null }) => {
    useRoom.setState((prev) => ({
      paused: false,
      room: prev.room ? { ...prev.room, paused: false } : null,
      endsAt: payload.endsAt !== undefined ? payload.endsAt : prev.endsAt,
      turnEndsAt: payload.turnEndsAt !== undefined ? payload.turnEndsAt : prev.turnEndsAt,
    }));
  });
  s.on(EV.leaderboard, (payload: { entries: LeaderboardEntry[] }) => {
    useRoom.setState({ leaderboard: payload.entries });
  });
  s.on(
    EV.gameState,
    (payload: {
      publicState: unknown;
      legalActions: string[];
      turnEndsAt?: number | null;
      clocks?: { playerId: string; remainingMs: number }[] | null;
      clockActor?: string | null;
      clockRunningSince?: number | null;
      moveDeadline?: number | null;
    }) => {
      useRoom.setState({
        state: payload.publicState,
        legalActions: payload.legalActions ?? [],
        turnEndsAt: payload.turnEndsAt ?? null,
        clocks: payload.clocks ?? null,
        clockActor: payload.clockActor ?? null,
        clockRunningSince: payload.clockRunningSince ?? null,
        moveDeadline: payload.moveDeadline ?? null,
      });
    },
  );
  s.on(EV.stillThinking, (payload: { playerId: string; strike: number; deadline: number }) => {
    window.dispatchEvent(new CustomEvent('pa:stillThinking', { detail: payload }));
  });
  s.on(EV.gameLog, (payload: { entries: LogEntry[] }) => {
    useRoom.setState({ log: payload.entries });
  });
  s.on(EV.chatMessage, (message: ChatMessage) => {
    useRoom.setState((prev) => ({ chat: [...prev.chat, message].slice(-200) }));
  });
  s.on(EV.error, (payload: { message: string }) => {
    useRoom.setState({ error: payload.message });
  });
}

/** Promise wrapper around socket.io acks. */
export function emit<T = any>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => {
    const s = getSocket();
    // room:start does puzzle generation and may call an AI provider, so this
    // has to outlast the provider timeout rather than racing it.
    const timer = setTimeout(() => resolve({ error: 'Timed out' } as T), 45_000);
    s.emit(event, payload ?? {}, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

/* ------------------------------------------------------------------ */
/* REST helpers                                                        */
/* ------------------------------------------------------------------ */

export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}
