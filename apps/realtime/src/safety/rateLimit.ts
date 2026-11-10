/** Token bucket: `capacity` actions at once, refilled at `perSecond`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private capacity: number,
    private perSecond: number,
    private now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** One bucket per key (IP, user id...). Idle buckets are dropped by sweep(). */
export class KeyedLimiter {
  private buckets = new Map<string, { b: TokenBucket; seen: number }>();

  constructor(
    private capacity: number,
    private perSecond: number,
    private now: () => number = Date.now,
    private maxKeys = 50_000,
  ) {}

  allow(key: string, cost = 1): boolean {
    let e = this.buckets.get(key);
    if (!e) {
      if (this.buckets.size >= this.maxKeys) this.sweep(0);
      e = { b: new TokenBucket(this.capacity, this.perSecond, this.now), seen: 0 };
      this.buckets.set(key, e);
    }
    e.seen = this.now();
    return e.b.take(cost);
  }

  sweep(maxIdleMs = 10 * 60_000): void {
    const cutoff = this.now() - maxIdleMs;
    for (const [k, e] of this.buckets) if (e.seen <= cutoff) this.buckets.delete(k);
  }

  get size(): number {
    return this.buckets.size;
  }
}
