import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { AppEnv } from './config/env';
import { prisma } from './lib/prisma';
import { healthRoute } from './routes/health';
import { roomRoutes } from './routes/rooms';
import { sessionRoutes } from './routes/session';
import { attachSocketServer } from './realtime/socket-server';

export function buildApp(env: AppEnv): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
  });
  app.register(cookie, { secret: env.SESSION_SECRET, hook: 'onRequest' });

  app.register(healthRoute, { prefix: '/api/v1' });
  app.register(sessionRoutes, { prefix: '/api/v1', env });
  app.register(roomRoutes, { prefix: '/api/v1' });

  attachSocketServer(app, env);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}
