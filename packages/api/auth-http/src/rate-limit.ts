/**
 * Fixed-window rate limiting for the public auth and billing routes.
 *
 * The window is per caller key (the forwarded client address), so one noisy
 * caller cannot exhaust another's budget. Entries are dropped when their
 * window closes, which keeps the map bounded by the callers active in the
 * current window rather than by every caller ever seen.
 * @module @deepseek-ai/dsh-api-auth-http/rate-limit
 */

import type { IncomingMessage } from 'node:http'

/** One route's budget. */
export interface RateLimitRule {
  /** Window length in milliseconds. */
  readonly windowMs: number
  /** Requests allowed per window. */
  readonly max: number
}

/** Decision for one request. */
export interface RateLimitDecision {
  readonly allowed: boolean
  /** Seconds until the window resets, for the `Retry-After` header. */
  readonly retryAfterSeconds: number
}

/** Per-key fixed-window counter. */
export interface RateLimiter {
  /**
   * Charge one request against a key.
   * @param key - caller identity for the budget.
   * @returns whether the request may proceed.
   */
  check(key: string): RateLimitDecision
}

interface Window {
  count: number
  resetAt: number
}

/**
 * Create a fixed-window limiter.
 * @param rule - window length and request budget.
 * @returns the limiter.
 */
export function createRateLimiter(rule: RateLimitRule): RateLimiter {
  const windows = new Map<string, Window>()

  return {
    check(key: string): RateLimitDecision {
      const now = Date.now()
      const current = windows.get(key)

      if (current === undefined || now >= current.resetAt) {
        // Sweep closed windows so an idle deployment does not hold them forever.
        for (const [candidate, window] of windows) {
          if (now >= window.resetAt) windows.delete(candidate)
        }
        windows.set(key, { count: 1, resetAt: now + rule.windowMs })
        return { allowed: true, retryAfterSeconds: 0 }
      }

      if (current.count >= rule.max) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        }
      }

      current.count += 1
      return { allowed: true, retryAfterSeconds: 0 }
    },
  }
}

/**
 * Resolve the address a request is charged against.
 *
 * Behind Cloudflare the socket address is the tunnel, so the forwarded client
 * address is the only useful key.
 * @param req - the incoming request.
 * @returns the caller key, or `unknown` when no address is available.
 */
export function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(',')[0]?.trim() ?? 'unknown'
  }
  return req.socket.remoteAddress ?? 'unknown'
}
