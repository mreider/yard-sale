import { zValidator } from '@hono/zod-validator';
import { ChangePasswordBody, DeleteMeBody, UpdateMeBody, checkPassword } from '@yrdsl/core';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { requireAuth, userToPublic } from '../lib/auth.js';
import { isPasswordCompromised } from '../lib/hibp.js';
import { now } from '../lib/ids.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { byUser, rateLimit } from '../lib/rate-limit.js';
import { clearSessionCookie, promoteCsrfCookie, revokeAllUserSessions } from '../lib/session.js';

const AVATAR_MAX_BYTES = 300_000; // 300 KB. client resizes to 512×512 WebP first.
const AVATAR_MIN_BYTES = 200;

export const meRoutes = new Hono<AppEnv>();

meRoutes.use('*', requireAuth);

// ─── GET /me ──────────────────────────────────────────────────────────────
meRoutes.get('/', (c) => {
  const user = c.get('user');
  // Opportunistic: if the session was created before the Domain=apex
  // CSRF fix, promote the legacy host-only __ys_csrf cookie to the
  // apex on the SPA's next page load. Idempotent for already-migrated
  // sessions.
  promoteCsrfCookie(c);
  return c.json({ user: userToPublic(user, c.env) });
});

// ─── PATCH /me ────────────────────────────────────────────────────────────
meRoutes.patch('/', zValidator('json', UpdateMeBody), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const updates: Record<string, string | number> = { updated_at: now() };
  if (body.defaultLanguage !== undefined) updates.default_language = body.defaultLanguage;
  if (body.defaultTheme !== undefined) updates.default_theme = body.defaultTheme;

  const cols = Object.keys(updates);
  const vals = Object.values(updates);
  await c.env.DB.prepare(`UPDATE users SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...vals, user.id)
    .run();

  const fresh = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(user.id)
    .first<typeof user>();
  return c.json({ user: userToPublic(fresh!, c.env) });
});

// ─── PUT /me/password ─────────────────────────────────────────────────────
meRoutes.put(
  '/password',
  rateLimit({ name: 'me-password', max: 5, windowSeconds: 3600, keyFn: byUser }),
  zValidator('json', ChangePasswordBody),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const ok = await verifyPassword(body.currentPassword, user.password_hash);
    if (!ok) return c.json({ error: 'invalid_current_password' }, 400);
    const pwCheck = await checkPassword({ password: body.newPassword, email: user.email });
    if (!pwCheck.ok) return c.json({ error: 'weak_password', issues: pwCheck.issues }, 400);
    const hibp = await isPasswordCompromised(c.env, body.newPassword);
    if (hibp.compromised) {
      return c.json({ error: 'password_compromised', breachCount: hibp.count }, 400);
    }
    const hash = await hashPassword(body.newPassword);
    await c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .bind(hash, now(), user.id)
      .run();
    // Invalidate all other sessions. Current session will need a fresh cookie;
    // for simplicity we revoke them all. the client can re-login.
    await revokeAllUserSessions(c.env, user.id);
    return c.body(null, 204);
  },
);

// ─── PUT /me/avatar ───────────────────────────────────────────────────────
// Client must pre-resize to 512×512 WebP and send the raw bytes with
// Content-Type: image/webp. Server validates size + WebP magic bytes only;
// no server-side re-encoding (Workers don't support dynamic wasm compile, so
// image libs are a liability). EXIF is stripped by the canvas re-encode on
// the client.
meRoutes.put(
  '/avatar',
  rateLimit({ name: 'avatar', max: 20, windowSeconds: 3600, keyFn: byUser }),
  async (c) => {
    const user = c.get('user');
    const contentType = c.req.header('Content-Type') ?? '';
    if (contentType !== 'image/webp') {
      return c.json(
        {
          error: 'invalid_format',
          message: 'Upload WebP bytes. The client should canvas-resize and encode first.',
        },
        400,
      );
    }
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength < AVATAR_MIN_BYTES) return c.json({ error: 'too_small' }, 400);
    if (buf.byteLength > AVATAR_MAX_BYTES) return c.json({ error: 'too_large' }, 413);

    const u8 = new Uint8Array(buf, 0, 12);
    const isRiff = u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46;
    const isWebp = u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50;
    if (!isRiff || !isWebp) return c.json({ error: 'invalid_webp_bytes' }, 400);

    const key = `users/${user.id}/avatar.webp`;
    await c.env.R2_AVATARS.put(key, buf, {
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=86400' },
    });
    await c.env.DB.prepare(`UPDATE users SET avatar_key = ?, updated_at = ? WHERE id = ?`)
      .bind(key, now(), user.id)
      .run();

    return c.json({ avatarUrl: `${c.env.APP_URL}/avatar/${user.id}` });
  },
);

// ─── DELETE /me ───────────────────────────────────────────────────────────
// Hard-deletes the user. Cascade FKs in 0001_init.sql clean out sessions,
// sales, items, api tokens, invites, email confirmations, and password
// resets. R2 buckets aren't FK-linked so we sweep them ourselves before
// the DELETE.
//
// Bearer-token callers are blocked: this is a destructive, account-level
// action that should require an interactive password reconfirmation.
meRoutes.delete(
  '/',
  rateLimit({ name: 'me-delete', max: 3, windowSeconds: 3600, keyFn: byUser }),
  zValidator('json', DeleteMeBody),
  async (c) => {
    const user = c.get('user');
    if (c.get('authKind') !== 'session') {
      return c.json({ error: 'session_required' }, 403);
    }
    const body = c.req.valid('json');
    const ok = await verifyPassword(body.currentPassword, user.password_hash);
    if (!ok) return c.json({ error: 'invalid_current_password' }, 400);

    // 1. Sweep R2 image objects under each of this user's sales. R2
    //    list() pages 1000 keys at a time; tiny accounts will fit in
    //    one page, but loop in case someone has many.
    const sales = await c.env.DB.prepare(`SELECT id FROM sales WHERE user_id = ?`)
      .bind(user.id)
      .all<{ id: string }>();
    for (const row of sales.results ?? []) {
      let cursor: string | undefined;
      do {
        const page = await c.env.R2_IMAGES.list({ prefix: `sales/${row.id}/`, cursor });
        if (page.objects.length > 0) {
          await c.env.R2_IMAGES.delete(page.objects.map((o) => o.key));
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }

    // 2. Avatar (single key).
    if (user.avatar_key) {
      await c.env.R2_AVATARS.delete(user.avatar_key).catch(() => {
        // Already gone? Don't block account deletion on storage cleanup.
      });
    }

    // 3. Hard-delete the user row. ON DELETE CASCADE handles the rest.
    await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user.id).run();

    // 4. Drop cookies. The session row is already gone via cascade.
    clearSessionCookie(c);
    return c.body(null, 204);
  },
);
