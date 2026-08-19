import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limiter';

describe('FixedWindowRateLimiter', () => {
  it('allows requests up to the configured maximum', () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000, () => 100);

    expect(limiter.consume('alice')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume('alice')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume('alice')).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 1_000 });
  });

  it('isolates callers by key', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, () => 100);

    expect(limiter.consume('alice').allowed).toBe(true);
    expect(limiter.consume('alice').allowed).toBe(false);
    expect(limiter.consume('bob').allowed).toBe(true);
  });

  it('resets a bucket when its window expires', () => {
    let now = 100;
    const limiter = new FixedWindowRateLimiter(1, 1_000, () => now);

    expect(limiter.consume('alice').allowed).toBe(true);
    expect(limiter.consume('alice').allowed).toBe(false);

    now = 1_100;
    expect(limiter.consume('alice')).toMatchObject({ allowed: true, remaining: 0 });
  });
});
