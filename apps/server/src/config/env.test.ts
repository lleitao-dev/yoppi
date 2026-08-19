import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parses a valid environment and production hardening settings', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      SERVER_PORT: '4000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/yoppi',
      SESSION_SECRET: '12345678901234567890123456789012',
      WEB_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'warn',
      TRUST_PROXY: 'true',
      HTTP_RATE_LIMIT_MAX: '100',
      HTTP_RATE_LIMIT_WINDOW_MS: '60000',
      SOCKET_RATE_LIMIT_MAX: '80',
      SOCKET_RATE_LIMIT_WINDOW_MS: '10000',
      BODY_LIMIT_BYTES: '16384',
      SHUTDOWN_GRACE_MS: '8000',
      ROOM_MINIMUM_PLAYER_GRACE_MS: '15000',
      POKER_TURN_TIMEOUT_MS: '30000',
      PLAYER_RECONNECT_TIMEOUT_MS: '60000',
    });

    expect(env.SERVER_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('test');
    expect(env.LOG_LEVEL).toBe('warn');
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.HTTP_RATE_LIMIT_MAX).toBe(100);
    expect(env.ROOM_MINIMUM_PLAYER_GRACE_MS).toBe(15_000);
  });

  it('uses conservative hardening defaults', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/yoppi',
      SESSION_SECRET: '12345678901234567890123456789012',
      WEB_ORIGIN: 'http://localhost:3000',
    });

    expect(env.TRUST_PROXY).toBe(false);
    expect(env.HTTP_RATE_LIMIT_MAX).toBe(240);
    expect(env.SOCKET_RATE_LIMIT_MAX).toBe(120);
    expect(env.BODY_LIMIT_BYTES).toBe(32_768);
    expect(env.SHUTDOWN_GRACE_MS).toBe(10_000);
  });

  it('rejects an undersized session secret', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/yoppi',
        SESSION_SECRET: 'short',
        WEB_ORIGIN: 'http://localhost:3000',
      }),
    ).toThrow(/Invalid environment configuration/);
  });
});
