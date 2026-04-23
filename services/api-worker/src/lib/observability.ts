import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.js';

/**
 * Structured-log middleware. Emits one JSON line per request summarizing
 * method, path, status, duration, user id (if authed), and a short request
 * ID. Cloudflare Workers Logs / Logpush picks these up automatically and
 * they're much easier to grep than the default wrangler access log.
 */
export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();
  const reqId = crypto.randomUUID().slice(0, 8);
  c.set('reqId', reqId);

  try {
    await next();
  } finally {
    const user = c.get('user');
    const line = {
      level: 'info',
      reqId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Date.now() - start,
      userId: user?.id,
      ip: c.req.header('CF-Connecting-IP'),
      ua: c.req.header('User-Agent')?.slice(0, 80),
      ts: new Date().toISOString(),
    };
    console.log(JSON.stringify(line));
  }
};
