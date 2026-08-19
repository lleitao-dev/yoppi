export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private operations = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(max) || max <= 0) throw new Error('max must be a positive integer');
    if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error('windowMs must be a positive integer');
  }

  consume(key: string): RateLimitDecision {
    const currentTime = this.now();
    this.operations += 1;
    if (this.operations % 256 === 0) this.prune(currentTime);

    const existing = this.buckets.get(key);
    const bucket = !existing || existing.resetAt <= currentTime
      ? { count: 0, resetAt: currentTime + this.windowMs }
      : existing;

    bucket.count += 1;
    this.buckets.set(key, bucket);

    const allowed = bucket.count <= this.max;
    return {
      allowed,
      remaining: Math.max(0, this.max - bucket.count),
      retryAfterMs: allowed ? 0 : Math.max(1, bucket.resetAt - currentTime),
    };
  }

  clear(key?: string): void {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }

  private prune(currentTime: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= currentTime) this.buckets.delete(key);
    }
  }
}
