import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parses a valid environment', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      SERVER_PORT: '4000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/yoppi',
      SESSION_SECRET: '12345678901234567890123456789012',
      WEB_ORIGIN: 'http://localhost:3000',
      POKER_TURN_TIMEOUT_MS: '30000',
      PLAYER_RECONNECT_TIMEOUT_MS: '60000',
    });

    expect(env.SERVER_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('test');
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
