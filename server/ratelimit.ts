/** Fixed-window counter per key, in memory (one server process). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  take(key: string): boolean {
    const now = Date.now()
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt < now) this.hits.delete(k)
    }
    const h = this.hits.get(key)
    if (!h || h.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    h.count++
    return h.count <= this.limit
  }
}
