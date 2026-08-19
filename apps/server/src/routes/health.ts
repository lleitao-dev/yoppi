import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' as const }));

  app.get('/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' as const };
    } catch (error) {
      app.log.error({ err: error }, 'Readiness check failed');
      return reply.code(503).send({ status: 'not_ready' as const });
    }
  });
};
