import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from '../env.js';

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the current window resets. */
  retryAfter: number;
  /** Remaining requests in the current window (after this one). */
  remaining: number;
}

/**
 * Sliding-window-ish rate limit backed by KV. We bucket by
 * `floor(now / windowSeconds)` so the counter resets cleanly at window
 * boundaries. This is not perfectly atomic (KV has no compare-and-set). a
 * well-timed attacker could slip 2-3 extra requests per window, but not
 * thousands. For stronger isolation we'd move to a Durable Object, which we
 * can swap in later without changing the call sites.
 */
export async function checkRateLimit(
  env: Env,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSeconds);
  const cacheKey = `rl:${key}:${bucket}`;
  const windowEnd = (bucket + 1) * windowSeconds;
  const current = Number((await env.CACHE.get(cacheKey)) ?? '0');

  if (current >= max) {
    return { ok: false, retryAfter: windowEnd - now, remaining: 0 };
  }

  await env.CACHE.put(cacheKey, String(current + 1), {
    expirationTtl: windowSeconds + 10,
  });
  return { ok: true, retryAfter: windowEnd - now, remaining: max - (current + 1) };
}

/**
 * Hono middleware factory. Identifies the caller via `keyFn` (typically
 * IP-based for public endpoints, user-id-based for authed ones) and enforces
 * the given budget.
 */
export function rateLimit(opts: {
  name: string;
  max: number;
  windowSeconds: number;
  keyFn: (c: Context<AppEnv>) => string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const who = opts.keyFn(c);
    const result = await checkRateLimit(c.env, `${opts.name}:${who}`, opts.max, opts.windowSeconds);
    c.header('X-RateLimit-Limit', String(opts.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
    c.header('X-RateLimit-Reset', String(result.retryAfter));
    if (!result.ok) {
      c.header('Retry-After', String(result.retryAfter));
      return c.json({ error: 'rate_limited', retryAfter: result.retryAfter }, 429);
    }
    return next();
  };
}

/** Common key functions. */
export const byIp = (c: Context<AppEnv>): string => c.req.header('CF-Connecting-IP') ?? 'unknown';

export const byIpAndBody = (field: string) => async (c: Context<AppEnv>) => {
  const ip = byIp(c);
  // Hono's zod-validator stashes parsed body under c.req.valid('json').
  // Safe to read here because rate-limit runs after zValidator.
  const body = c.req.valid('json' as never) as Record<string, unknown> | undefined;
  const val = body?.[field];
  return `${ip}:${typeof val === 'string' ? val.toLowerCase() : ''}`;
};

export const byUser = (c: Context<AppEnv>): string => {
  const u = c.get('user');
  return u?.id ?? 'anonymous';
};
