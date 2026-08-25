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
  PokerAmountActionSchema,
  PokerRoomActionSchema,
  RoomLeaveSchema,
  RoomSubscribeSchema,
} from '@yoppi/protocol';
import { getPlayerFromCookieHeader } from '../auth/session';
import type { AppEnv } from '../config/env';
import { BlackjackEngineError, type BlackjackEngine } from '../games/blackjack/engine';
import { blackjackGames } from '../games/blackjack/game-manager';
import { PokerEngineError, type PokerEngine } from '../games/poker/engine';
import { pokerGames } from '../games/poker/game-manager';
import { getRoomGameAdapter } from '../rooms/game-adapter';
import { InsufficientPlayerGraceController } from '../rooms/insufficient-player-grace';
import { reconcileRoomAtGameBoundary } from '../rooms/room-lifecycle';
import { roomManager } from '../rooms/room-manager';
import { FixedWindowRateLimiter } from '../security/rate-limiter';
import { isAllowedSocketRequest } from './socket-origin';
import {
  ensureConnectedHost,
  getRoomForMember,
  leaveRoom,
  resetRoomAfterInsufficientPlayers,
  RoomServiceError,
  startBlackjackRoom,
  startPokerRoom,
} from '../rooms/room-service';

interface SocketData {
  playerId: string;
  displayName: string;
  subscribedRooms: Set<string>;
}

type YoppiSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type YoppiSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function channel(roomId: string): string {
  return `room:${roomId}`;
}

function toCommandError(error: unknown, fallback: string): ServerError {
  if (
    error instanceof BlackjackEngineError ||
    error instanceof PokerEngineError ||
    error instanceof RoomServiceError
  ) {
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

async function emitPokerState(io: YoppiSocketServer, roomId: string): Promise<void> {
  const engine = pokerGames.get(roomId);
  if (!engine) return;
  const sockets = await io.in(channel(roomId)).fetchSockets();
  for (const socket of sockets) {
    socket.emit('poker:state', engine.getView(socket.data.playerId));
  }
}

async function emitGameState(io: YoppiSocketServer, roomId: string): Promise<void> {
  if (blackjackGames.get(roomId)) await emitBlackjackState(io, roomId);
  if (pokerGames.get(roomId)) await emitPokerState(io, roomId);
}

export function attachSocketServer(app: FastifyInstance, env: AppEnv): YoppiSocketServer {
  const io: YoppiSocketServer = new Server(app.server, {
    cors: {
      origin: env.WEB_ORIGIN,
      credentials: true,
    },
    allowRequest: (request, callback) => {
      callback(
        null,
        isAllowedSocketRequest(request.headers.origin, request.headers.host, env.WEB_ORIGIN),
      );
    },
    maxHttpBufferSize: env.BODY_LIMIT_BYTES,
  });

  const pokerTurnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const socketLimiter = new FixedWindowRateLimiter(
    env.SOCKET_RATE_LIMIT_MAX,
    env.SOCKET_RATE_LIMIT_WINDOW_MS,
  );

  const graceController = new InsufficientPlayerGraceController(
    roomManager,
    async (roomId) => {
      const activeRoom = roomManager.get(roomId);
      const adapter = activeRoom ? getRoomGameAdapter(activeRoom.gameType) : null;
      const result = await resetRoomAfterInsufficientPlayers(roomId);
      adapter?.terminate(roomId);
      const pokerTimer = pokerTurnTimers.get(roomId);
      if (pokerTimer) clearTimeout(pokerTimer);
      pokerTurnTimers.delete(roomId);
      if (result.room) io.to(channel(roomId)).emit('room:state', result.room);
      app.log.info(
        { roomId, closed: result.closed },
        'Active game ended after insufficient-player grace period',
      );
    },
    env.ROOM_MINIMUM_PLAYER_GRACE_MS,
    (error, roomId) => {
      app.log.error({ error, roomId }, 'Insufficient-player grace expiration failed');
    },
  );

  function reconcileGrace(roomId: string): boolean {
    const result = graceController.reconcile(roomId);
    if (result.changed && result.room) io.to(channel(roomId)).emit('room:state', result.room);
    return result.changed;
  }

  function schedulePokerTurn(roomId: string): void {
    const existing = pokerTurnTimers.get(roomId);
    if (existing) clearTimeout(existing);
    pokerTurnTimers.delete(roomId);

    const engine = pokerGames.get(roomId);
    const deadline = engine?.getTurnDeadline();
    if (!engine || !deadline) return;

    const delay = Math.max(0, new Date(deadline).getTime() - Date.now()) + 10;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const current = pokerGames.get(roomId);
          if (!current) return;
          const changed = current.timeoutCurrentPlayer();
          if (changed) {
            const boundary = await reconcileRoomAtGameBoundary(roomId);
            if (boundary.changed && boundary.room)
              io.to(channel(roomId)).emit('room:state', boundary.room);
            reconcileGrace(roomId);
            await emitPokerState(io, roomId);
          }
          schedulePokerTurn(roomId);
        } catch (error) {
          app.log.error({ error, roomId }, 'Poker turn timeout failed');
        }
      })();
    }, delay);
    pokerTurnTimers.set(roomId, timer);
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
    socket.use((packet, next) => {
      const decision = socketLimiter.consume(socket.data.playerId);
      if (decision.allowed) {
        next();
        return;
      }

      const error: ServerError = {
        code: 'RATE_LIMITED',
        message: 'Too many realtime actions. Try again shortly.',
      };
      socket.emit('server:error', error);
      const lastArgument: unknown = packet[packet.length - 1];
      if (typeof lastArgument === 'function') {
        (lastArgument as (response: CommandAck) => void)({ ok: false, error });
      }
      app.log.warn(
        {
          event: 'socket.rate_limited',
          playerId: socket.data.playerId,
          retryAfterMs: decision.retryAfterMs,
        },
        'Socket rate limit exceeded',
      );
    });

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
        const error: ServerError = {
          code: 'NOT_ROOM_MEMBER',
          message: 'Subscribe to this room before playing.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      const engine = blackjackGames.get(roomId);
      if (!engine) {
        const error: ServerError = {
          code: 'GAME_NOT_FOUND',
          message: 'The Blackjack game is not active.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      try {
        command(engine);
        await reconcileBoundary(roomId);
        reconcileGrace(roomId);
        await emitBlackjackState(io, roomId);
        callback({ ok: true });
      } catch (caught) {
        if (!(caught instanceof BlackjackEngineError)) {
          app.log.error(
            { error: caught, roomId, playerId: socket.data.playerId },
            'Blackjack command failed',
          );
        }
        const error = toCommandError(caught, 'Unable to process the Blackjack action.');
        socket.emit('server:error', error);
        callback({ ok: false, error });
      }
    }

    async function executePoker(
      roomId: string,
      callback: (response: CommandAck) => void,
      command: (engine: PokerEngine) => void,
    ): Promise<void> {
      if (!socket.data.subscribedRooms.has(roomId)) {
        const error: ServerError = {
          code: 'NOT_ROOM_MEMBER',
          message: 'Subscribe to this room before playing.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      const engine = pokerGames.get(roomId);
      if (!engine) {
        const error: ServerError = {
          code: 'GAME_NOT_FOUND',
          message: 'The Poker game is not active.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      try {
        command(engine);
      } catch (caught) {
        if (!(caught instanceof PokerEngineError)) {
          app.log.error(
            { error: caught, roomId, playerId: socket.data.playerId },
            'Poker command failed',
          );
        }
        const error = toCommandError(caught, 'Unable to process the Poker action.');
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      // The synchronous engine mutation is authoritative. Acknowledge it and
      // publish the new hand state before database-backed room reconciliation
      // so a slow lifecycle update cannot stall gameplay controls.
      schedulePokerTurn(roomId);
      callback({ ok: true });

      try {
        await emitPokerState(io, roomId);
        const boundaryChanged = await reconcileBoundary(roomId);
        const graceChanged = reconcileGrace(roomId);
        if (boundaryChanged || graceChanged) await emitPokerState(io, roomId);
      } catch (caught) {
        app.log.error(
          { error: caught, roomId, playerId: socket.data.playerId },
          'Poker lifecycle reconciliation failed after a successful action',
        );
      }
    }

    socket.on('room:subscribe', async (payload) => {
      const parsed = RoomSubscribeSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('server:error', {
          code: 'VALIDATION_ERROR',
          message: 'Invalid room subscription.',
        });
        return;
      }

      try {
        const room = await getRoomForMember(parsed.data.roomId, socket.data.playerId);
        if (!room) {
          socket.emit('server:error', {
            code: 'NOT_ROOM_MEMBER',
            message: 'You are not a member of this room.',
          });
          return;
        }

        await socket.join(channel(room.id));
        socket.data.subscribedRooms.add(room.id);
        let currentRoom = roomManager.connect(room.id, socket.data.playerId, socket.id) ?? room;
        const adapter =
          currentRoom.status === 'ACTIVE' ? getRoomGameAdapter(currentRoom.gameType) : null;
        const engineConnectionChanged =
          adapter?.playerConnected(room.id, socket.data.playerId) ?? false;

        const hostResult = await ensureConnectedHost(room.id);
        if (hostResult) currentRoom = hostResult.room;
        if (hostResult?.changed) {
          adapter?.setHost(room.id, currentRoom.hostPlayerId);
          io.to(channel(room.id)).emit('room:hostChanged', currentRoom);
        }

        const boundary = await reconcileRoomAtGameBoundary(room.id);
        if (boundary.room) currentRoom = boundary.room;
        const grace = graceController.reconcile(room.id);
        if (grace.room) currentRoom = grace.room;

        socket.emit('room:state', currentRoom);
        socket.to(channel(room.id)).emit('room:playerJoined', currentRoom);
        if (boundary.changed || grace.changed)
          io.to(channel(room.id)).emit('room:state', currentRoom);

        const blackjackState = blackjackGames.view(room.id, socket.data.playerId);
        if (blackjackState) socket.emit('blackjack:state', blackjackState);
        const pokerState = pokerGames.view(room.id, socket.data.playerId);
        if (pokerState) socket.emit('poker:state', pokerState);
        if (boundary.changed || engineConnectionChanged) await emitGameState(io, room.id);
        if (pokerState) schedulePokerTurn(room.id);
      } catch (error) {
        app.log.error({ error, roomId: parsed.data.roomId }, 'Room subscription failed');
        socket.emit('server:error', {
          code: 'INTERNAL_ERROR',
          message: 'Unable to subscribe to the room.',
        });
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
        if (!before)
          throw new RoomServiceError('NOT_ROOM_MEMBER', 'You are not a member of this room.');

        const leaveResult = await leaveRoom(parsed.data.roomId, socket.data.playerId);
        const adapter = before.status === 'ACTIVE' ? getRoomGameAdapter(before.gameType) : null;
        const engineChanged =
          leaveResult.disposition === 'DEFERRED'
            ? (adapter?.requestLeave(before.id, socket.data.playerId) ?? false)
            : false;

        await detachPlayerFromRoom(parsed.data.roomId, socket.data.playerId);

        const hostResult = await ensureConnectedHost(parsed.data.roomId);
        if (hostResult?.changed) {
          adapter?.setHost(parsed.data.roomId, hostResult.room.hostPlayerId);
          io.to(channel(parsed.data.roomId)).emit('room:hostChanged', hostResult.room);
        }

        const boundary = await reconcileRoomAtGameBoundary(parsed.data.roomId);
        let currentRoom =
          boundary.room ??
          hostResult?.room ??
          roomManager.get(parsed.data.roomId) ??
          leaveResult.room;
        const grace = graceController.reconcile(parsed.data.roomId);
        if (grace.room) currentRoom = grace.room;

        if (currentRoom) {
          if (
            leaveResult.disposition === 'LEFT' ||
            boundary.removedPlayerIds.includes(socket.data.playerId)
          ) {
            io.to(channel(parsed.data.roomId)).emit('room:playerLeft', currentRoom);
          } else {
            io.to(channel(parsed.data.roomId)).emit('room:state', currentRoom);
          }
        }
        if (engineChanged || boundary.changed || hostResult?.changed) {
          await emitGameState(io, parsed.data.roomId);
        }
        if (before.gameType === 'POKER') schedulePokerTurn(parsed.data.roomId);
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
        const error: ServerError = {
          code: 'VALIDATION_ERROR',
          message: 'Invalid game start request.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }

      try {
        if (!socket.data.subscribedRooms.has(parsed.data.roomId)) {
          throw new RoomServiceError(
            'NOT_ROOM_MEMBER',
            'Subscribe to this room before starting it.',
          );
        }
        const waitingRoom = await getRoomForMember(parsed.data.roomId, socket.data.playerId);
        if (!waitingRoom)
          throw new RoomServiceError('NOT_ROOM_MEMBER', 'You are not a member of this room.');
        const room =
          waitingRoom.gameType === 'BLACKJACK'
            ? await startBlackjackRoom(parsed.data.roomId, socket.data.playerId)
            : await startPokerRoom(parsed.data.roomId, socket.data.playerId);
        if (room.gameType === 'BLACKJACK') blackjackGames.start(room);
        else pokerGames.start(room, env.POKER_TURN_TIMEOUT_MS);
        const grace = graceController.reconcile(room.id);
        io.to(channel(room.id)).emit('room:state', grace.room ?? room);
        await emitGameState(io, room.id);
        if (room.gameType === 'POKER') schedulePokerTurn(room.id);
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
        const error: ServerError = {
          code: 'VALIDATION_ERROR',
          message: 'Invalid Blackjack action.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) =>
        engine.hit(socket.data.playerId),
      );
    });

    socket.on('blackjack:stand', async (payload, callback) => {
      const parsed = BlackjackRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = {
          code: 'VALIDATION_ERROR',
          message: 'Invalid Blackjack action.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) =>
        engine.stand(socket.data.playerId),
      );
    });

    socket.on('blackjack:double', async (payload, callback) => {
      const parsed = BlackjackRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = {
          code: 'VALIDATION_ERROR',
          message: 'Invalid Blackjack action.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) =>
        engine.doubleDown(socket.data.playerId),
      );
    });

    socket.on('blackjack:nextRound', async (payload, callback) => {
      const parsed = BlackjackRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = {
          code: 'VALIDATION_ERROR',
          message: 'Invalid Blackjack action.',
        };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executeBlackjack(parsed.data.roomId, callback, (engine) =>
        engine.beginNextRound(socket.data.playerId),
      );
    });

    socket.on('poker:check', async (payload, callback) => {
      const parsed = PokerRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Poker action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executePoker(parsed.data.roomId, callback, (engine) =>
        engine.check(socket.data.playerId),
      );
    });

    socket.on('poker:call', async (payload, callback) => {
      const parsed = PokerRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Poker action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executePoker(parsed.data.roomId, callback, (engine) =>
        engine.call(socket.data.playerId),
      );
    });

    socket.on('poker:bet', async (payload, callback) => {
      const parsed = PokerAmountActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Poker bet.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executePoker(parsed.data.roomId, callback, (engine) =>
        engine.bet(socket.data.playerId, parsed.data.amount),
      );
    });

    socket.on('poker:raise', async (payload, callback) => {
      const parsed = PokerAmountActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Poker raise.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executePoker(parsed.data.roomId, callback, (engine) =>
        engine.raise(socket.data.playerId, parsed.data.amount),
      );
    });

    socket.on('poker:fold', async (payload, callback) => {
      const parsed = PokerRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Poker action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executePoker(parsed.data.roomId, callback, (engine) =>
        engine.fold(socket.data.playerId),
      );
    });

    socket.on('poker:allIn', async (payload, callback) => {
      const parsed = PokerRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Poker action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executePoker(parsed.data.roomId, callback, (engine) =>
        engine.allIn(socket.data.playerId),
      );
    });

    socket.on('poker:nextHand', async (payload, callback) => {
      const parsed = PokerRoomActionSchema.safeParse(payload);
      if (!parsed.success) {
        const error: ServerError = { code: 'VALIDATION_ERROR', message: 'Invalid Poker action.' };
        socket.emit('server:error', error);
        callback({ ok: false, error });
        return;
      }
      await executePoker(parsed.data.roomId, callback, (engine) =>
        engine.beginNextHand(socket.data.playerId),
      );
    });

    socket.on('disconnect', () => {
      void (async () => {
        const changedRooms = roomManager.disconnectSocket(socket.id);
        for (const disconnectedRoom of changedRooms) {
          const disconnectedPlayer = disconnectedRoom.players.find(
            (player) => player.playerId === socket.data.playerId,
          );
          const finalSocketDisconnected = Boolean(
            disconnectedPlayer && !disconnectedPlayer.connected,
          );

          let gameChanged = false;
          if (finalSocketDisconnected && disconnectedPlayer?.participation === 'PLAYING') {
            const adapter = getRoomGameAdapter(disconnectedRoom.gameType);
            gameChanged =
              adapter?.playerDisconnected(disconnectedRoom.id, socket.data.playerId) ?? false;
          }

          try {
            const hostResult = await ensureConnectedHost(disconnectedRoom.id);
            const room = hostResult?.room ?? disconnectedRoom;
            if (hostResult?.changed) {
              getRoomGameAdapter(room.gameType).setHost(room.id, room.hostPlayerId);
              io.to(channel(room.id)).emit('room:hostChanged', room);
              gameChanged = true;
            } else {
              io.to(channel(room.id)).emit('room:state', room);
            }

            const boundaryChanged = await reconcileBoundary(room.id);
            const graceChanged = reconcileGrace(room.id);
            if (gameChanged || boundaryChanged || graceChanged) await emitGameState(io, room.id);
            if (room.gameType === 'POKER') schedulePokerTurn(room.id);
          } catch (error) {
            app.log.error(
              { error, roomId: disconnectedRoom.id },
              'Room lifecycle update after disconnect failed',
            );
            io.to(channel(disconnectedRoom.id)).emit('room:state', disconnectedRoom);
            if (gameChanged) await emitGameState(io, disconnectedRoom.id);
          }
        }
      })();
    });
  });

  app.addHook('onClose', async () => {
    graceController.dispose();
    for (const timer of pokerTurnTimers.values()) clearTimeout(timer);
    pokerTurnTimers.clear();
    socketLimiter.clear();
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
  });

  return io;
}
