import type { FastifyPluginAsync } from 'fastify';
import { CreateRoomRequestSchema, JoinRoomRequestSchema } from '@yoppi/protocol';
import { getPlayerFromRequest } from '../auth/session';
import { createRoom, getRoomForMember, joinRoom, RoomServiceError } from '../rooms/room-service';

function roomErrorStatus(code: RoomServiceError['code']): number {
  if (code === 'ROOM_NOT_FOUND') return 404;
  if (code === 'ROOM_FULL' || code === 'ROOM_ALREADY_STARTED' || code === 'INSUFFICIENT_PLAYERS')
    return 409;
  return 400;
}

export const roomRoutes: FastifyPluginAsync = async (app) => {
  app.post('/rooms', async (request, reply) => {
    const player = await getPlayerFromRequest(request);
    if (!player) {
      return reply
        .code(401)
        .send({ code: 'UNAUTHENTICATED', message: 'Create a guest session first.' });
    }

    const parsed = CreateRoomRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: 'VALIDATION_ERROR', message: 'Select a supported game.' });
    }

    const room = await createRoom(player.id, parsed.data.gameType);
    return reply.code(201).send({ room });
  });

  app.post('/rooms/join', async (request, reply) => {
    const player = await getPlayerFromRequest(request);
    if (!player) {
      return reply
        .code(401)
        .send({ code: 'UNAUTHENTICATED', message: 'Create a guest session first.' });
    }

    const parsed = JoinRoomRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: 'VALIDATION_ERROR', message: 'Enter a valid six-character room code.' });
    }

    try {
      const room = await joinRoom(player.id, parsed.data.code);
      return { room };
    } catch (error) {
      if (error instanceof RoomServiceError) {
        return reply
          .code(roomErrorStatus(error.code))
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get<{ Params: { roomId: string } }>('/rooms/:roomId', async (request, reply) => {
    const player = await getPlayerFromRequest(request);
    if (!player) {
      return reply
        .code(401)
        .send({ code: 'UNAUTHENTICATED', message: 'Create a guest session first.' });
    }

    const room = await getRoomForMember(request.params.roomId, player.id);
    if (!room) {
      return reply
        .code(404)
        .send({ code: 'ROOM_NOT_FOUND', message: 'Room not found or you are not a member.' });
    }
    return { room };
  });
};
