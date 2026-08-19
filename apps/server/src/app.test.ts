import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { parseEnv, type AppEnv } from './config/env';

function testEnv(overrides: Partial<Record<keyof AppEnv, string>> = {}): AppEnv {
  return parseEnv({
    NODE_ENV: 'test',
    SERVER_PORT: '4000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/yoppi',
    SESSION_SECRET: '12345678901234567890123456789012',
    WEB_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('server hardening', () => {
  it('returns an ok health status with security headers', async () => {
    app = buildApp(testEnv());
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('does not emit HSTS outside production', async () => {
    app = buildApp(testEnv());
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('emits HSTS in production', async () => {
    app = buildApp(testEnv({ NODE_ENV: 'production' }));
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
  });

  it('returns a stable JSON 404 response', async () => {
    app = buildApp(testEnv());
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Route not found.' });
  });

  it('rate limits non-health HTTP traffic', async () => {
    app = buildApp(testEnv({ HTTP_RATE_LIMIT_MAX: '1', HTTP_RATE_LIMIT_WINDOW_MS: '60000' }));

    const first = await app.inject({ method: 'GET', url: '/does-not-exist' });
    const second = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(first.statusCode).toBe(404);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' });
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('keeps the liveness endpoint outside the request rate limit', async () => {
    app = buildApp(testEnv({ HTTP_RATE_LIMIT_MAX: '1' }));

    const first = await app.inject({ method: 'GET', url: '/api/v1/health' });
    const second = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });
});
