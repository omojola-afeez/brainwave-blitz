/** Fixed-window counter per key. Cheap, in memory, and good enough for a single node. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {
    this.sweeper = setInterval(() => this.sweep(), Math.max(windowMs, 1000));
    this.sweeper.unref();
  }

  /** Returns true when the action is allowed and records it. */
  allow(key: string): boolean {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || t >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  reconfigure(limit: number, windowMs: number): void {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits.clear();
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.hits) if (t >= v.resetAt) this.hits.delete(k);
  }

  size(): number {
    return this.hits.size;
  }

  stop(): void {
    clearInterval(this.sweeper);
  }
}
