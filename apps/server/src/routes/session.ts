import type { FastifyPluginAsync } from 'fastify';
import { CreateSessionRequestSchema } from '@yoppi/protocol';
import {
  clearSessionCookie,
  createGuestPlayer,
  getPlayerFromRequest,
  revokeSession,
  setSessionCookie,
} from '../auth/session';
import type { AppEnv } from '../config/env';

interface SessionRoutesOptions {
  env: AppEnv;
}

export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (app, options) => {
  const secureCookie = options.env.NODE_ENV === 'production';

  app.post('/session', async (request, reply) => {
    const parsed = CreateSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Display name must contain 2 to 24 characters.',
      });
    }

    const { player, token } = await createGuestPlayer(parsed.data.displayName);
    setSessionCookie(reply, token, secureCookie);

    return reply.code(201).send({
      player: { id: player.id, displayName: player.displayName },
    });
  });

  app.get('/session', async (request, reply) => {
    const player = await getPlayerFromRequest(request);
    if (!player) {
      return reply.code(401).send({
        code: 'UNAUTHENTICATED',
        message: 'No active Yoppi session.',
      });
    }

    return {
      player: { id: player.id, displayName: player.displayName },
    };
  });

  app.delete('/session', async (request, reply) => {
    const player = await getPlayerFromRequest(request);
    if (player) await revokeSession(player.id);
    clearSessionCookie(reply, secureCookie);
    return reply.code(204).send();
  });
};
