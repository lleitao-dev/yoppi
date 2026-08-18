import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  CommandAck,
  ServerError,
  ServerToClientEvents,
} from '@yoppi/protocol';
import {
  BlackjackBetSchema,
  BlackjackRoomActionSchema,
  GameStartSchema,
  RoomLeaveSchema,
  RoomSubscribeSchema,
} from '@yoppi/protocol';
import { getPlayerFromCookieHeader } from '../auth/session';
import type { AppEnv } from '../config/env';
import { BlackjackEngineError, type BlackjackEngine } from '../games/blackjack/engine';
import { blackjackGames } from '../games/blackjack/game-manager';
import { getRoomGameAdapter } from '../rooms/game-adapter';
import { reconcileRoomAtGameBoundary } from '../rooms/room-lifecycle';
import { MinimumPlayerGraceController } from '../rooms/minimum-player-grace';
import { roomManager } from '../rooms/room-manager';
import {
  ensureConnectedHost,
  getRoomForMember,
  leaveRoom,
  resetActiveRoomForInsufficientPlayers,
  RoomServiceError,
  startBlackjackRoom,
} from '../rooms/room-service';

interface SocketData {
  playerId: string;
  displayName: string;
  subscribedRooms: Set<string>;
}

type YoppiSocketServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type YoppiSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function channel(roomId: string): string {
  return `room:${roomId}`;
}

function toCommandError(error: unknown, fallback: string): ServerError {
  if (error instanceof BlackjackEngineError || error instanceof RoomServiceError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'INTERNAL_ERROR', message: fallback };
}

async function emitBlackjackState(io: YoppiSocketServer, roomId: string): Promise<void> {
  const engine = blackjackGames.get(roomId);
  if (!engine) return;
  const sockets = await io.in(channel(roomId)).fetchSockets();
  for (const socket of sockets) {
    socket.emit('blackjack:state', engine.getView(socket.data.playerId));
  }
}

export function attachSocketServer(app: FastifyInstance, env: AppEnv): YoppiSocketServer {
  const io: YoppiSocketServer = new Server(app.server, {
    cors: {
      origin: env.WEB_ORIGIN,
      credentials: true,
    },
  });

  const minimumPlayerGrace = new MinimumPlayerGraceController(roomManager, {
    graceMs: env.ROOM_MINIMUM_PLAYER_GRACE_MS,
    onExpired: async (roomId) => {
      const before = roomManager.get(roomId);
      if (!before || before.status !== 'ACTIVE') return;
      if (before.playerRequirement.current >= before.playerRequirement.minimum) return;

      const adapter = getRoomGameAdapter(before.gameType);
      const resetRoom = await resetActiveRoomForInsufficientPlayers(roomId);
      adapter?.stop(roomId);

      if (!resetRoom) return;
      const hostResult = await ensureConnectedHost(roomId);
      const currentRoom = hostResult?.room ?? resetRoom;
      if (hostResult?.changed) {
        io.to(channel(roomId)).emit('room:hostChanged', currentRoom);
      }
      io.to(channel(roomId)).emit('room:state', currentRoom);
    },
    onError: (error, roomId) => {
      app.log.error({ error, roomId }, 'Minimum-player grace expiration failed');
    },
  });

  function reconcileMinimumPlayers(roomId: string): boolean {
    const result = minimumPlayerGrace.reconcile(roomId);
    if (result.state !== 'UNCHANGED' && result.room) {
      io.to(channel(roomId)).emit('room:state', result.room);
      return true;
    }
    return false;
  }

  io.use(async (socket, next) => {
    try {
      const player = await getPlayerFromCookieHeader(app, socket.request.headers.cookie);
      if (!player) return next(new Error('UNAUTHENTICATED'));
      socket.data.playerId = player.id;
      socket.data.displayName = player.displayName;
      socket.data.subscribedRooms = new Set();
      return next();
    } catch (error) {
      app.log.error({ error }, 'Socket authentication failed');
      return next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: YoppiSocket) => {
    async function detachPlayerFromRoom(roomId: string, playerId: string): Promise<void> {
      const sockets = await io.in(channel(roomId)).fetchSockets();
      for (const candidate of sockets) {
        if (candidate.data.playerId !== playerId) continue;
        candidate.data.subscribedRooms.delete(roomId);
        await candidate.leave(channel(roomId));
      }
      roomManager.disconnectPlayer(roomId, playerId);
    }

    async function reconcileBoundary(roomId: string): Promise<boolean> {
      const result = await reconcileRoomAtGameBoundary(roomId);
      if (result.changed && result.room) {
        io.to(channel(roomId)).emit('room:state', result.room);
      }
      return result.changed;
    }

    async function executeBlackjack(
      roomId: string,
      callback: (response: CommandAck) => void,
      command: (engine: BlackjackEngine) => void,
    ): Promise<void> {
      if (!socket.data.subscribedRooms.has(roomId)) {
        const error: ServerError = { code: 'NOT_ROOM_MEMBER', message: 'Subscribe to this room before playing.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      const engine = blackjackGames.get(roomId);
      if (!engine) {
        const error: ServerError = { code: 'GAME_NOT_FOUND', message: 'The Blackjack game is not active.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      try {
        command(engine);
        await reconcileBoundary(roomId);
        reconcileMinimumPlayers(roomId);
        await emitBlackjackState(io, roomId);
        callback({ ok: true });
      } catch (caught) {
        if (!(caught instanceof BlackjackEngineError)) {
          app.log.error({ error: caught, roomId, playerId: socket.data.playerId }, 'Blackjack command failed');
        }
        const error = toCommandError(caught, 'Unable to process the Blackjack action.');
        socket.emit('server:error', error);
        callback({ ok: false, error });
      }
    }

    socket.on('room:subscribe', async (payload) => {
      const parsed = RoomSubscribeSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('server:error', { code: 'VALIDATION_ERROR', message: 'Invalid room subscription.' });
        return;
      }

      try {
        const room = await getRoomForMember(parsed.data.roomId, socket.data.playerId);
        if (!room) {
          socket.emit('server:error', { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room.' });
          return;
        }

        await socket.join(channel(room.id));
        socket.data.subscribedRooms.add(room.id);
        let currentRoom = roomManager.connect(room.id, socket.data.playerId, socket.id) ?? room;

        const hostResult = await ensureConnectedHost(room.id);
        if (hostResult) currentRoom = hostResult.room;
        if (hostResult?.changed) {
          blackjackGames.setHost(room.id, currentRoom.hostPlayerId);
          io.to(channel(room.id)).emit('room:hostChanged', currentRoom);
        }

        const boundary = await reconcileRoomAtGameBoundary(room.id);
        if (boundary.room) currentRoom = boundary.room;
        const grace = minimumPlayerGrace.reconcile(room.id);
        if (grace.room) currentRoom = grace.room;

        socket.emit('room:state', currentRoom);
        socket.to(channel(room.id)).emit('room:playerJoined', currentRoom);
        if (boundary.changed || grace.state !== 'UNCHANGED') io.to(channel(room.id)).emit('room:state', currentRoom);

        const blackjackState = blackjackGames.view(room.id, socket.data.playerId);
        if (blackjackState) socket.emit('blackjack:state', blackjackState);
        if (boundary.changed) await emitBlackjackState(io, room.id);
      } catch (error) {
        app.log.error({ error, roomId: parsed.data.roomId }, 'Room subscription failed');
        socket.emit('server:error', { code: 'INTERNAL_ERROR', message: 'Unable to subscribe to the room.' });
      }
    });

    socket.on('room:leave', async (payload, callback) => {
      const parsed = RoomLeaveSchema.safeParse(payload);
      if (!parsed.success) {
        const error = { code: 'VALIDATION_ERROR' as const, message: 'Invalid room leave request.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      try {
        const before = await getRoomForMember(parsed.data.roomId, socket.data.playerId);
        if (!before) throw new RoomServiceError('NOT_ROOM_MEMBER', 'You are not a member of this room.');

        const leaveResult = await leaveRoom(parsed.data.roomId, socket.data.playerId);
        const adapter = before.status === 'ACTIVE' ? getRoomGameAdapter(before.gameType) : null;
        const engineChanged = leaveResult.disposition === 'DEFERRED'
          ? (adapter?.requestLeave(before.id, socket.data.playerId) ?? false)
          : false;

        await detachPlayerFromRoom(parsed.data.roomId, socket.data.playerId);

        const hostResult = await ensureConnectedHost(parsed.data.roomId);
        if (hostResult?.changed) {
          blackjackGames.setHost(parsed.data.roomId, hostResult.room.hostPlayerId);
          io.to(channel(parsed.data.roomId)).emit('room:hostChanged', hostResult.room);
        }

        const boundary = await reconcileRoomAtGameBoundary(parsed.data.roomId);
        const grace = minimumPlayerGrace.reconcile(parsed.data.roomId);
        const currentRoom = grace.room ?? boundary.room ?? hostResult?.room ?? roomManager.get(parsed.data.roomId) ?? leaveResult.room;

        if (currentRoom) {
          if (leaveResult.disposition === 'LEFT' || boundary.removedPlayerIds.includes(socket.data.playerId)) {
            io.to(channel(parsed.data.roomId)).emit('room:playerLeft', currentRoom);
          } else {
            io.to(channel(parsed.data.roomId)).emit('room:state', currentRoom);
          }
        }
        if (engineChanged || boundary.changed || hostResult?.changed) {
          await emitBlackjackState(io, parsed.data.roomId);
        }
        callback({ ok: true });
      } catch (error) {
        if (!(error instanceof RoomServiceError)) {
          app.log.error({ error, roomId: parsed.data.roomId }, 'Room leave failed');
        }
        const errorPayload = toCommandError(error, 'Unable to leave the room.');
        socket.emit('server:error', errorPayload);
        callback({ ok: false, error: errorPayload });
      }
    });

    socket.on('game:start', async (payload, callback) => {
      const parsed = GameStartSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid game start request.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      try {
        if (!socket.data.subscribedRooms.has(parsed.data.roomId)) {
          throw new RoomServiceError('NOT_ROOM_MEMBER', 'Subscribe to this room before starting it.');
        }
        const waitingRoom = await getRoomForMember(parsed.data.roomId, socket.data.playerId);
        if (!waitingRoom) throw new RoomServiceError('NOT_ROOM_MEMBER', 'You are not a member of this room.');
        const room = await startBlackjackRoom(parsed.data.roomId, socket.data.playerId);
        blackjackGames.start(room);
        const grace = minimumPlayerGrace.reconcile(room.id);
        io.to(channel(room.id)).emit('room:state', grace.room ?? room);
        await emitBlackjackState(io, room.id);
        callback({ ok: true });
      } catch (caught) {
        if (!(caught instanceof RoomServiceError)) {
          app.log.error({ error: caught, roomId: parsed.data.roomId }, 'Game start failed');
        }
        const error = toCommandError(caught, 'Unable to start the game.');
        socket.emit('server:error', error);
        callback({ ok: false, error });
      }
    });

    socket.on('blackjack:bet', async (payload, callback) => {
      const parsed = BlackjackBetSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Blackjack bet.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) => {
        engine.placeBet(socket.data.playerId, parsed.data.amount);
      });
    });

    socket.on('blackjack:hit', async (payload, callback) => {
      const parsed = BlackjackRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Blackjack action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) => engine.hit(socket.data.playerId));
    });

    socket.on('blackjack:stand', async (payload, callback) => {
      const parsed = BlackjackRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Blackjack action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) => engine.stand(socket.data.playerId));
    });

    socket.on('blackjack:double', async (payload, callback) => {
      const parsed = BlackjackRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Blackjack action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) => engine.doubleDown(socket.data.playerId));
    });

    socket.on('blackjack:nextRound', async (payload, callback) => {
      const parsed = BlackjackRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Blackjack action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) => engine.beginNextRound(socket.data.playerId));
    });

    socket.on('disconnect', () => {
      void (async () => {
        const changedRooms = roomManager.disconnectSocket(socket.id);
        for (const disconnectedRoom of changedRooms) {
          const disconnectedPlayer = disconnectedRoom.players.find(
            (player) => player.playerId === socket.data.playerId,
          );
          const finalSocketDisconnected = Boolean(disconnectedPlayer && !disconnectedPlayer.connected);

          let blackjackChanged = false;
          if (finalSocketDisconnected && disconnectedPlayer?.participation === 'PLAYING') {
            blackjackChanged = blackjackGames.get(disconnectedRoom.id)?.autoStand(socket.data.playerId) ?? false;
          }

          let boundaryChanged = false;
          try {
            const hostResult = await ensureConnectedHost(disconnectedRoom.id);
            const room = hostResult?.room ?? disconnectedRoom;
            if (hostResult?.changed) {
              blackjackGames.setHost(room.id, room.hostPlayerId);
              io.to(channel(room.id)).emit('room:hostChanged', room);
              blackjackChanged = true;
            } else {
              io.to(channel(room.id)).emit('room:state', room);
            }

            boundaryChanged = await reconcileBoundary(room.id);
          } catch (error) {
            app.log.error({ error, roomId: disconnectedRoom.id }, 'Host transfer after disconnect failed');
            io.to(channel(disconnectedRoom.id)).emit('room:state', disconnectedRoom);
          }

          const graceChanged = reconcileMinimumPlayers(disconnectedRoom.id);
          if (blackjackChanged || boundaryChanged || graceChanged) {
            await emitBlackjackState(io, disconnectedRoom.id);
          }
        }
      })();
    });
  });

  app.addHook('onClose', async () => {
    minimumPlayerGrace.close();
    await io.close();
  });

  return io;
}
