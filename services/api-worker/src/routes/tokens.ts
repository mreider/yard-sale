import { zValidator } from '@hono/zod-validator';
import { CreateTokenBody } from '@yrdsl/core';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { requireAuth, requireConfirmed } from '../lib/auth.js';
import { byUser, rateLimit } from '../lib/rate-limit.js';
import {
  createApiToken,
  expiryToEpoch,
  listUserTokens,
  revokeToken,
  tokenToPublic,
} from '../lib/tokens.js';

export const tokenRoutes = new Hono<AppEnv>();

tokenRoutes.use('*', requireAuth);

// ─── GET /me/tokens ───────────────────────────────────────────────────────
tokenRoutes.get('/', async (c) => {
  const user = c.get('user');
  const rows = await listUserTokens(c.env, user.id);
  return c.json({ tokens: rows.map(tokenToPublic) });
});

// ─── POST /me/tokens (confirmed users only) ───────────────────────────────
tokenRoutes.post(
  '/',
  requireConfirmed,
  rateLimit({ name: 'token-create', max: 20, windowSeconds: 3600, keyFn: byUser }),
  zValidator('json', CreateTokenBody),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const { row, raw } = await createApiToken(c.env, user.id, {
      name: body.name,
      scope: body.scope,
      expiresAt: expiryToEpoch(body.expiry),
    });
    // The raw token is returned exactly once, on create.
    return c.json({ token: tokenToPublic(row), secret: raw }, 201);
  },
);

// ─── DELETE /me/tokens/:id ────────────────────────────────────────────────
tokenRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const ok = await revokeToken(c.env, user.id, c.req.param('id'));
  return ok ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
});
