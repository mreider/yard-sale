import { zValidator } from '@hono/zod-validator';
import { CreateInviteBody, type PublicInvite } from '@yrdsl/core';
import { Hono } from 'hono';
import type { AppEnv, InviteRow } from '../env.js';
import { requireAdmin } from '../lib/auth.js';
import { now } from '../lib/ids.js';
import { inviteStatus, newInviteCode } from '../lib/invites.js';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireAdmin);

function toPublic(
  row: InviteRow,
  usedByUser: { email: string; username: string } | null,
  appUrl: string,
): PublicInvite {
  return {
    code: row.code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedBy:
      row.used_by && usedByUser
        ? { id: row.used_by, email: usedByUser.email, username: usedByUser.username }
        : null,
    note: row.note,
    revokedAt: row.revoked_at,
    status: inviteStatus(row),
    url: `${appUrl}/signup?invite=${row.code}`,
  };
}

// ─── GET /admin/invites ───────────────────────────────────────────────────
adminRoutes.get('/invites', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.*, u.email AS used_email, u.username AS used_username
       FROM invites i
       LEFT JOIN users u ON u.id = i.used_by
       ORDER BY i.created_at DESC`,
  ).all<InviteRow & { used_email: string | null; used_username: string | null }>();

  const invites = (rows.results ?? []).map((r) =>
    toPublic(
      r,
      r.used_email && r.used_username ? { email: r.used_email, username: r.used_username } : null,
      c.env.APP_URL,
    ),
  );
  return c.json({ invites });
});

// ─── POST /admin/invites ──────────────────────────────────────────────────
adminRoutes.post('/invites', zValidator('json', CreateInviteBody), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const code = newInviteCode();
  const createdAt = now();
  const expiresAt = createdAt + body.expiresInDays * 86400;
  await c.env.DB.prepare(
    `INSERT INTO invites (code, created_by, created_at, expires_at, note)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(code, user.id, createdAt, expiresAt, body.note ?? null)
    .run();

  const row = (await c.env.DB.prepare(`SELECT * FROM invites WHERE code = ?`)
    .bind(code)
    .first<InviteRow>())!;
  return c.json({ invite: toPublic(row, null, c.env.APP_URL) }, 201);
});

// ─── DELETE /admin/invites/:code ──────────────────────────────────────────
adminRoutes.delete('/invites/:code', async (c) => {
  const res = await c.env.DB.prepare(
    `UPDATE invites SET revoked_at = ? WHERE code = ? AND revoked_at IS NULL AND used_at IS NULL`,
  )
    .bind(now(), c.req.param('code'))
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'not_found_or_already_used' }, 404);
  return c.body(null, 204);
});
