export interface RelationshipRateLimiterOptions {
  maxRequests: number
  windowMs: number
  maxKeys?: number
}

export interface RelationshipRateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

interface RateLimitWindow {
  startedAtMs: number
  count: number
}

export class RelationshipRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>()
  private readonly maxKeys: number

  constructor(private readonly options: RelationshipRateLimiterOptions) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests <= 0) {
      throw new Error('maxRequests must be a positive integer.')
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error('windowMs must be positive.')
    }
    this.maxKeys = options.maxKeys ?? 10_000
  }

  consume(key: string, nowMs = Date.now()): RelationshipRateLimitResult {
    this.prune(nowMs)
    const existing = this.windows.get(key)
    if (!existing || nowMs - existing.startedAtMs >= this.options.windowMs) {
      if (!existing && this.windows.size >= this.maxKeys) {
        const oldestWindow = this.windows.values().next().value as RateLimitWindow | undefined
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: oldestWindow
            ? Math.max(1, Math.ceil(
              (oldestWindow.startedAtMs + this.options.windowMs - nowMs) / 1000
            ))
            : Math.max(1, Math.ceil(this.options.windowMs / 1000)),
        }
      }
      this.windows.set(key, { startedAtMs: nowMs, count: 1 })
      return {
        allowed: true,
        remaining: this.options.maxRequests - 1,
        retryAfterSeconds: 0,
      }
    }

    if (existing.count >= this.options.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.startedAtMs + this.options.windowMs - nowMs) / 1000)
        ),
      }
    }

    existing.count += 1
    return {
      allowed: true,
      remaining: this.options.maxRequests - existing.count,
      retryAfterSeconds: 0,
    }
  }

  private prune(nowMs: number): void {
    for (const [key, window] of this.windows) {
      if (nowMs - window.startedAtMs >= this.options.windowMs) this.windows.delete(key)
    }
  }
}
