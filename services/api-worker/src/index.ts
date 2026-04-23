import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './env.js';
import { requestLog } from './lib/observability.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { imageRoutes } from './routes/images.js';
import { meRoutes } from './routes/me.js';
import { publicRoutes } from './routes/public.js';
import { saleRoutes } from './routes/sales.js';
import { tokenRoutes } from './routes/tokens.js';

const app = new Hono<AppEnv>();

app.use('*', requestLog);

// Security headers on every response. The API serves JSON; the lockdown
// is mostly defense-in-depth against any future HTML accidentally
// served by this worker.
app.use('*', async (c, next) => {
  await next();
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

app.use('*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const mw = cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });
  return mw(c, next);
});

app.get('/health', (c) =>
  c.json({ ok: true, service: 'api-worker', ts: Math.floor(Date.now() / 1000) }),
);

// Public avatar serving: /avatar/:userId → R2 object.
app.get('/avatar/:userId', async (c) => {
  const row = await c.env.DB.prepare(`SELECT avatar_key FROM users WHERE id = ?`)
    .bind(c.req.param('userId'))
    .first<{ avatar_key: string | null }>();
  if (!row?.avatar_key) return c.notFound();
  const obj = await c.env.R2_AVATARS.get(row.avatar_key);
  if (!obj) return c.notFound();
  c.header('Content-Type', 'image/webp');
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(obj.body);
});

// Public image serving: /image/<r2-key...>. Unauthenticated; URLs are
// unguessable (ULID segments) but the payload itself isn't secret.
app.get('/image/*', async (c) => {
  const key = c.req.path.slice('/image/'.length);
  if (!key) return c.notFound();
  const obj = await c.env.R2_IMAGES.get(key);
  if (!obj) return c.notFound();
  c.header('Content-Type', obj.httpMetadata?.contentType ?? 'image/webp');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(obj.body);
});

app.route('/auth', authRoutes);
app.route('/me', meRoutes);
app.route('/me/tokens', tokenRoutes);
app.route('/admin', adminRoutes);
app.route('/sales', saleRoutes);
app.route('/sales', imageRoutes); // image upload routes nest under /sales/:saleId/items/:itemId/images
app.route('/public', publicRoutes);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  const reqId = c.get('reqId');
  console.error('unhandled', reqId, err);
  // Keep the reqId in the response so users can correlate with
  // Cloudflare Workers Logs, but never leak the exception message.
  return c.json({ error: 'internal_error', reqId }, 500);
});

export default app;
