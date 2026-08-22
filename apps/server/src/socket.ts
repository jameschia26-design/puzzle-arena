import { Server as IOServer, type Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  EV,
  GAME_REGISTRY,
  chatSendSchema,
  gameActionSchema,
  puzzleCommitSchema,
  roomJoinSchema,
  roomKickSchema,
} from '@puzzle-arena/shared';
import { db } from './db/index.js';
import { roomPlayers, rooms } from './db/schema.js';
import { auth } from './auth.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { loadRoom, type LiveRoom } from './rooms/runtime.js';
import { nextFreeSeat, toHeaders } from './routes/rooms.js';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function attachSocket(app: FastifyInstance): IOServer {
  // Client and API share an origin, so no CORS configuration is needed.
  const io = new IOServer(app.server, { path: '/socket.io' });

  /**
   * Identify every connection: an admin session sets userId, otherwise the
   * signed guest cookie sets guestId. Missing both is rejected outright.
   */
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);

      const session = await auth.api
        .getSession({ headers: toHeaders(socket.handshake.headers as Record<string, unknown>) })
        .catch(() => null);
      if (session?.user?.id) socket.data.userId = session.user.id;

      const signed = cookies['pa_guest'];
      if (signed) {
        const unsigned = app.unsignCookie(signed);
        if (unsigned.valid && unsigned.value) socket.data.guestId = unsigned.value;
      }

      if (!socket.data.userId && !socket.data.guestId) {
        return next(new Error('No identity — call POST /api/guest first'));
      }
      return next();
    } catch (err) {
      logger.error({ err }, 'socket auth failed');
      return next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    socket.on(EV.roomJoin, async (payload, ack) => {
      try {
        const parsed = roomJoinSchema.safeParse(payload);
        if (!parsed.success) return respond(ack, { error: 'Invalid join' });

        const code = parsed.data.code.toUpperCase();
        const row = (await db.select().from(rooms).where(eq(rooms.code, code)).limit(1))[0];
        if (!row) return respond(ack, { error: 'No such room' });
        if (row.status === 'finished' || row.status === 'abandoned') {
          return respond(ack, { error: 'That room has finished' });
        }

        const room = await loadRoom(row.id, io);
        if (!room) return respond(ack, { error: 'No such room' });
        room.attach(io);

        const isHostUser = socket.data.userId === row.hostUserId;
        const guestId = (socket.data.guestId as string | undefined) ?? null;

        // Reconnect to an existing seat where possible (by guestId, hostId, or matching displayName for disconnected human).
        let player =
          (guestId ? room.playerByGuest(guestId) : undefined) ??
          (isHostUser ? room.players.find((p) => p.isHost && !p.left) : undefined);

        if (!player && parsed.data.displayName) {
          const nameNorm = parsed.data.displayName.trim().toLowerCase();
          const candidate = room.players.find(
            (p) => !p.isBot && !p.left && p.displayName.trim().toLowerCase() === nameNorm,
          );
          if (candidate) {
            player = candidate;
            if (guestId) {
              player.guestId = guestId;
              void db.update(roomPlayers).set({ guestId }).where(eq(roomPlayers.id, player.id));
            }
          }
        }
        if (!player) {
          if (room.status !== 'lobby') {
            return respond(ack, { error: 'That game has already started' });
          }
          const meta = GAME_REGISTRY[room.gameId];
          const seated = room.players.filter((p) => !p.left);
          if (seated.length >= meta.maxPlayers) {
            return respond(ack, { error: `${meta.title} is full` });
          }

          const seat = nextFreeSeat(room);
          const inserted = (
            await db
              .insert(roomPlayers)
              .values({
                roomId: room.id,
                guestId,
                displayName: parsed.data.displayName,
                seat,
                isHost: isHostUser && !room.players.some((p) => p.isHost),
                isBot: false,
                avatar: parsed.data.avatar ?? null,
              })
              .returning()
          )[0];
          if (!inserted) return respond(ack, { error: 'Could not seat you' });

          player = {
            id: inserted.id,
            guestId,
            displayName: inserted.displayName,
            seat,
            isHost: inserted.isHost,
            isBot: false,
            botDifficulty: null,
            avatar: inserted.avatar,
            connected: true,
            left: false,
            state: room.puzzle ? structuredClone(room.puzzle.initialState) : null,
            penalties: 0,
            completed: false,
            completedAtMs: null,
          };
          room.players.push(player);
        }

        player.connected = true;
        player.left = false;
        player.displayName = parsed.data.displayName;
        socket.data.playerId = player.id;
        socket.data.roomId = room.id;
        await socket.join(room.id);

        room.broadcastPlayers();
        room.pushLog(`${player.displayName} joined`, player.id);
        respond(ack, { snapshot: room.snapshotFor(player.id) });
        socket.emit(EV.roomSnapshot, room.snapshotFor(player.id));
      } catch (err) {
        logger.error({ err }, 'room:join failed');
        respond(ack, { error: 'Join failed' });
      }
    });

    socket.on(EV.roomStart, async (_payload, ack) => {
      const room = roomOf(socket);
      if (!room) return respond(ack, { error: 'Not in a room' });
      const player = room.player(socket.data.playerId as string);
      if (!player?.isHost) return respond(ack, { error: 'Only the host can start' });
      try {
        await room.start();
        respond(ack, { ok: true });
      } catch (err) {
        respond(ack, { error: String(err instanceof Error ? err.message : err) });
      }
    });

    socket.on(EV.roomEndEarly, async (_payload, ack) => {
      const room = roomOf(socket);
      if (!room) return respond(ack, { error: 'Not in a room' });
      const player = room.player(socket.data.playerId as string);
      if (!player?.isHost) return respond(ack, { error: 'Only the host can end the room' });
      await room.finish('host');
      respond(ack, { ok: true });
    });

    socket.on(EV.roomPause, async (_payload, ack) => {
      const room = roomOf(socket);
      if (!room) return respond(ack, { error: 'Not in a room' });
      const player = room.player(socket.data.playerId as string);
      if (!player?.isHost) return respond(ack, { error: 'Only the host can pause the room' });
      room.pause();
      respond(ack, { ok: true });
    });

    socket.on(EV.roomResume, async (_payload, ack) => {
      const room = roomOf(socket);
      if (!room) return respond(ack, { error: 'Not in a room' });
      const player = room.player(socket.data.playerId as string);
      if (!player?.isHost) return respond(ack, { error: 'Only the host can resume the room' });
      room.resume();
      respond(ack, { ok: true });
    });

    socket.on(EV.roomRestart, async (_payload, ack) => {
      const room = roomOf(socket);
      if (!room) return respond(ack, { error: 'Not in a room' });
      const player = room.player(socket.data.playerId as string);
      if (!player?.isHost) return respond(ack, { error: 'Only the host can restart the game' });
      try {
        await room.restart();
        respond(ack, { ok: true });
      } catch (err) {
        respond(ack, { error: String(err instanceof Error ? err.message : err) });
      }
    });

    socket.on(EV.roomKick, async (payload, ack) => {
      const room = roomOf(socket);
      if (!room) return respond(ack, { error: 'Not in a room' });
      const host = room.player(socket.data.playerId as string);
      if (!host?.isHost) return respond(ack, { error: 'Only the host can kick' });

      const parsed = roomKickSchema.safeParse(payload);
      if (!parsed.success) return respond(ack, { error: 'Invalid kick' });
      const target = room.player(parsed.data.playerId);
      if (!target || target.isHost) return respond(ack, { error: 'Cannot kick that player' });

      target.left = true;
      await db.update(roomPlayers).set({ leftAt: new Date() }).where(eq(roomPlayers.id, target.id));
      room.broadcastPlayers();
      room.pushLog(`${target.displayName} was removed by the host`);
      respond(ack, { ok: true });
    });

    socket.on(EV.puzzleCommit, (payload, ack) => {
      const room = roomOf(socket);
      const playerId = socket.data.playerId as string | undefined;
      if (!room || !playerId) return respond(ack, { accepted: false, progress: 0 });
      const parsed = puzzleCommitSchema.safeParse(payload);
      if (!parsed.success) {
        return respond(ack, { accepted: false, progress: 0, error: 'Invalid move' });
      }
      respond(ack, room.commit(playerId, parsed.data.path, parsed.data.value));
    });

    socket.on(EV.puzzleHint, (_payload, ack) => {
      const room = roomOf(socket);
      const playerId = socket.data.playerId as string | undefined;
      if (!room || !playerId) return respond(ack, { hint: null });
      respond(ack, room.hint(playerId));
    });

    socket.on(EV.gameAction, (payload, ack) => {
      const room = roomOf(socket);
      const playerId = socket.data.playerId as string | undefined;
      if (!room || !playerId) return respond(ack, { accepted: false, error: 'Not in a room' });
      const parsed = gameActionSchema.safeParse(payload);
      if (!parsed.success) return respond(ack, { accepted: false, error: 'Invalid action' });
      respond(ack, room.applyGameAction(playerId, parsed.data));
    });

    socket.on(EV.stillThinkingAck, (_payload, ack) => {
      // Chess-clock games only: purely a client-side dismissal of the "still
      // thinking?" modal. It does NOT extend the 4-minute-per-move cap — the
      // clock keeps running regardless, per the room's chosen semantics.
      respond(ack, { ok: true });
    });

    socket.on(EV.chatSend, (payload, ack) => {
      const room = roomOf(socket);
      const playerId = socket.data.playerId as string | undefined;
      if (!room || !playerId) return respond(ack, { ok: false });
      const parsed = chatSendSchema.safeParse(payload);
      if (!parsed.success) return respond(ack, { ok: false });
      const player = room.player(playerId);
      if (!player) return respond(ack, { ok: false });

      const message = {
        id: nanoid(10),
        playerId,
        displayName: player.displayName,
        seat: player.seat,
        text: parsed.data.text,
        at: Date.now(),
      };
      room.chat.push(message);
      room.chat = room.chat.slice(-200);
      io.to(room.id).emit(EV.chatMessage, message);
      respond(ack, { ok: true });
    });

    socket.on(EV.roomLeave, () => {
      const room = roomOf(socket);
      const playerId = socket.data.playerId as string | undefined;
      if (room && playerId) room.markDisconnected(playerId);
    });

    socket.on('disconnect', () => {
      const room = roomOf(socket);
      const playerId = socket.data.playerId as string | undefined;
      if (room && playerId) room.markDisconnected(playerId);
    });
  });

  return io;
}

function roomOf(socket: Socket): LiveRoom | undefined {
  const roomId = socket.data.roomId as string | undefined;
  if (!roomId) return undefined;
  // Imported lazily to avoid a cycle at module load.
  return roomRegistryLookup(roomId);
}

let roomRegistryLookup: (id: string) => LiveRoom | undefined = () => undefined;
export function setRoomLookup(fn: (id: string) => LiveRoom | undefined): void {
  roomRegistryLookup = fn;
}

function respond(ack: unknown, value: unknown): void {
  if (typeof ack === 'function') (ack as (v: unknown) => void)(value);
}

export { env };
