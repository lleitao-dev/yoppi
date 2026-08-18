import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import type { AppEnv } from './config/env';

const testEnv: AppEnv = {
  NODE_ENV: 'test',
  SERVER_PORT: 4000,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/yoppi',
  SESSION_SECRET: '12345678901234567890123456789012',
  WEB_ORIGIN: 'http://localhost:3000',
  POKER_TURN_TIMEOUT_MS: 30_000,
  PLAYER_RECONNECT_TIMEOUT_MS: 60_000,
  ROOM_MINIMUM_PLAYER_GRACE_MS: 15_000,
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('GET /api/v1/health', () => {
  it('returns an ok status', async () => {
    app = buildApp(testEnv);
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
