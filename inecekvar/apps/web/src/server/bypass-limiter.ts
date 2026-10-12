/**
 * Token bucket per client address for renders that cannot use the page cache (requests carrying
 * cookies or credentials, duplicate allowlisted parameters). Cacheable requests never consume it.
 */
export class BypassRenderLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly burst: number,
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly maxClients = 10_000,
  ) {}

  /** Returns 0 when the render may proceed, otherwise the seconds until a token is available. */
  take(client: string): number {
    const now = this.now();
    const refillPerMs = this.perMinute / 60_000;
    const previous = this.buckets.get(client);
    const tokens = previous
      ? Math.min(this.burst, previous.tokens + (now - previous.updatedAt) * refillPerMs)
      : this.burst;
    this.buckets.delete(client);
    if (tokens < 1) {
      this.buckets.set(client, { tokens, updatedAt: now });
      return Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000));
    }
    this.buckets.set(client, { tokens: tokens - 1, updatedAt: now });
    while (this.buckets.size > this.maxClients) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
    return 0;
  }
}
