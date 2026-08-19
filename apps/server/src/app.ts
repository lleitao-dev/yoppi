import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { AppEnv } from './config/env';
import { prisma } from './lib/prisma';
import { healthRoute } from './routes/health';
import { roomRoutes } from './routes/rooms';
import { sessionRoutes } from './routes/session';
import { attachSocketServer } from './realtime/socket-server';
import { FixedWindowRateLimiter } from './security/rate-limiter';

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-site',
};

export function buildApp(env: AppEnv): FastifyInstance {
  const app = Fastify({
    bodyLimit: env.BODY_LIMIT_BYTES,
    trustProxy: env.TRUST_PROXY,
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'request.headers.authorization',
          'request.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  const httpLimiter = new FixedWindowRateLimiter(env.HTTP_RATE_LIMIT_MAX, env.HTTP_RATE_LIMIT_WINDOW_MS);

  app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
  });
  app.register(cookie, { secret: env.SESSION_SECRET, hook: 'onRequest' });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/v1/health') || request.url.startsWith('/api/v1/ready')) return;

    const decision = httpLimiter.consume(request.ip);
    reply.header('x-ratelimit-limit', env.HTTP_RATE_LIMIT_MAX);
    reply.header('x-ratelimit-remaining', decision.remaining);

    if (!decision.allowed) {
      reply.header('retry-after', Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)));
      request.log.warn({ event: 'http.rate_limited', ip: request.ip }, 'HTTP rate limit exceeded');
      return reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' });
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    if (env.NODE_ENV === 'production') {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  app.setNotFoundHandler(async (request, reply) => {
    request.log.info({ event: 'http.not_found', method: request.method, path: request.url }, 'Route not found');
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Route not found.' });
  });

  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error, event: 'http.unhandled_error' }, 'Unhandled request error');
    } else {
      request.log.warn({ err: error, event: 'http.request_error' }, 'Request rejected');
    }

    const message = statusCode >= 500 ? 'Internal server error.' : error.message;
    return reply.code(statusCode).send({ code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message });
  });

  app.register(healthRoute, { prefix: '/api/v1' });
  app.register(sessionRoutes, { prefix: '/api/v1', env });
  app.register(roomRoutes, { prefix: '/api/v1' });

  attachSocketServer(app, env);

  app.addHook('onClose', async () => {
    httpLimiter.clear();
    await prisma.$disconnect();
  });

  return app;
}
