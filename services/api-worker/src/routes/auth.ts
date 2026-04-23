import { zValidator } from '@hono/zod-validator';
import {
  ConfirmQuery,
  ForgotBody,
  LoginBody,
  ResetBody,
  SignupBody,
  checkPassword,
  checkUsername,
  normalizeEmail,
  suggestUsername,
} from '@yrdsl/core';
import { Hono } from 'hono';
import type { AppEnv, UserRow } from '../env.js';
import { requireAuth, userToPublic } from '../lib/auth.js';
import { sendMail } from '../lib/email.js';
import { sha256Hex } from '../lib/hash.js';
import { isPasswordCompromised } from '../lib/hibp.js';
import { newId, newUrlToken, now } from '../lib/ids.js';
import { checkInvite, consumeInvite } from '../lib/invites.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { byIp, rateLimit } from '../lib/rate-limit.js';
import {
  clearSessionCookie,
  createSession,
  issueSessionCookie,
  readSessionId,
  revokeAllUserSessions,
  revokeSession,
} from '../lib/session.js';
import { verifyTurnstile } from '../lib/turnstile.js';

export const authRoutes = new Hono<AppEnv>();

const CONFIRM_TTL = 60 * 60 * 24; // 24h
const RESET_TTL = 60 * 60; // 1h

const HOUR = 3600;

// ─── POST /auth/signup ────────────────────────────────────────────────────
authRoutes.post(
  '/signup',
  rateLimit({ name: 'signup', max: 5, windowSeconds: HOUR, keyFn: byIp }),
  zValidator('json', SignupBody),
  async (c) => {
    const body = c.req.valid('json');
    const email = normalizeEmail(body.email);

    // Turnstile happens before any DB work so bots can't probe for
    // taken usernames/emails by spamming signup.
    const turnstile = await verifyTurnstile(
      c.env,
      body.turnstileToken,
      c.req.header('CF-Connecting-IP') ?? null,
    );
    if (!turnstile.ok) return c.json({ error: 'turnstile_failed', reason: turnstile.reason }, 400);

    const pwCheck = await checkPassword({ password: body.password, email });
    if (!pwCheck.ok) return c.json({ error: 'weak_password', issues: pwCheck.issues }, 400);
    const hibp = await isPasswordCompromised(c.env, body.password);
    if (hibp.compromised) {
      return c.json({ error: 'password_compromised', breachCount: hibp.count }, 400);
    }

    let username = body.username ? body.username.toLowerCase() : suggestUsername(email);
    const unameIssue = checkUsername(username);
    if (unameIssue) return c.json({ error: 'invalid_username', issue: unameIssue }, 400);

    const emailTaken = await c.env.DB.prepare(`SELECT 1 FROM users WHERE LOWER(email) = ?`)
      .bind(email)
      .first();
    if (emailTaken) return c.json({ error: 'email_taken' }, 409);

    // ─ Invite-only gating (PRD §6.1 addendum) ───────────────────────────────
    const bootstrapEmail = (c.env.BOOTSTRAP_ADMIN_EMAIL ?? '').toLowerCase();
    const isBootstrap = bootstrapEmail.length > 0 && email === bootstrapEmail;
    const inviteRequired = c.env.REQUIRE_INVITE === 'true' && !isBootstrap;
    if (inviteRequired) {
      if (!body.inviteCode) return c.json({ error: 'invite_required' }, 400);
      const check = await checkInvite(c.env, body.inviteCode);
      if (!check.ok) return c.json({ error: `invite_${check.reason}` }, 400);
    }

    // Make username unique. if it's taken, append a short suffix until it isn't (max 10 tries).
    for (let i = 0; i < 10; i++) {
      const taken = await c.env.DB.prepare(`SELECT 1 FROM users WHERE LOWER(username) = ?`)
        .bind(username)
        .first();
      if (!taken) break;
      username = `${username.slice(0, 24)}-${Math.floor(Math.random() * 9999)
        .toString()
        .padStart(4, '0')}`;
    }

    const passwordHash = await hashPassword(body.password);
    const id = newId();
    const createdAt = now();
    const isAdmin = isBootstrap ? 1 : 0;
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, username, is_admin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, email, passwordHash, username, isAdmin, createdAt, createdAt)
      .run();

    if (inviteRequired && body.inviteCode) {
      await consumeInvite(c.env, body.inviteCode, id);
    }

    const confirmToken = newUrlToken();
    const confirmHash = await sha256Hex(confirmToken);
    await c.env.DB.prepare(
      `INSERT INTO email_confirmations (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
    )
      .bind(confirmHash, id, now() + CONFIRM_TTL)
      .run();

    const confirmUrl = `${c.env.APP_URL}/confirm?token=${confirmToken}`;
    const sendResult = await sendMail(c.env, {
      to: email,
      subject: 'Confirm your yrdsl.app account',
      text: `Welcome to yrdsl.app!\n\nConfirm your email by clicking:\n${confirmUrl}\n\nThis link expires in 24 hours.`,
    });

    // Create a session immediately so the user can proceed to set a profile/avatar.
    const session = await createSession(c.env, id, {
      userAgent: c.req.header('User-Agent') ?? null,
      ip: c.req.header('CF-Connecting-IP') ?? null,
    });
    await issueSessionCookie(c, session.id);

    const user = (await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
      .bind(id)
      .first<UserRow>())!;

    return c.json(
      {
        user: userToPublic(user, c.env),
        // In dev (stub mailer), expose the confirmation link for test clients.
        devConfirmUrl: sendResult.stubbed ? confirmUrl : undefined,
      },
      201,
    );
  },
);

// ─── POST /auth/login ─────────────────────────────────────────────────────
authRoutes.post(
  '/login',
  rateLimit({ name: 'login', max: 10, windowSeconds: HOUR, keyFn: byIp }),
  zValidator('json', LoginBody),
  async (c) => {
    const body = c.req.valid('json');
    const email = normalizeEmail(body.email);
    const row = await c.env.DB.prepare(`SELECT * FROM users WHERE LOWER(email) = ?`)
      .bind(email)
      .first<UserRow>();
    const bad = () => c.json({ error: 'invalid_credentials' }, 401);
    if (!row) return bad();
    const ok = await verifyPassword(body.password, row.password_hash);
    if (!ok) return bad();
    const session = await createSession(c.env, row.id, {
      userAgent: c.req.header('User-Agent') ?? null,
      ip: c.req.header('CF-Connecting-IP') ?? null,
    });
    await issueSessionCookie(c, session.id);
    return c.json({ user: userToPublic(row, c.env) });
  },
);

// ─── POST /auth/logout ────────────────────────────────────────────────────
// requireAuth so the CSRF double-submit fires — otherwise an attacker page
// could force-log-out a signed-in victim with a top-level POST. Accepts both
// session and bearer auth; bearer callers can log out their API token's
// owning session (rare but harmless).
authRoutes.post('/logout', requireAuth, async (c) => {
  const sessionId = await readSessionId(c);
  if (sessionId) await revokeSession(c.env, sessionId);
  clearSessionCookie(c);
  return c.body(null, 204);
});

// ─── POST /auth/confirm ───────────────────────────────────────────────────
authRoutes.post(
  '/confirm',
  rateLimit({ name: 'confirm', max: 30, windowSeconds: HOUR, keyFn: byIp }),
  zValidator('json', ConfirmQuery),
  async (c) => {
    const body = c.req.valid('json');
    const hash = await sha256Hex(body.token);
    const row = await c.env.DB.prepare(
      `SELECT user_id, expires_at, used_at FROM email_confirmations WHERE token_hash = ?`,
    )
      .bind(hash)
      .first<{ user_id: string; expires_at: number; used_at: number | null }>();
    if (!row) return c.json({ error: 'invalid_token' }, 400);
    if (row.used_at) return c.json({ error: 'token_used' }, 400);
    if (row.expires_at < now()) return c.json({ error: 'token_expired' }, 400);

    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE email_confirmations SET used_at = ? WHERE token_hash = ?`).bind(
        now(),
        hash,
      ),
      c.env.DB.prepare(`UPDATE users SET email_confirmed_at = ?, updated_at = ? WHERE id = ?`).bind(
        now(),
        now(),
        row.user_id,
      ),
    ]);
    return c.body(null, 204);
  },
);

// ─── POST /auth/resend-confirmation (session required) ────────────────────
// requireAuth so CSRF check fires; otherwise an attacker page could spam a
// victim's mailbox with confirmation emails via a forced POST.
authRoutes.post(
  '/resend-confirmation',
  rateLimit({ name: 'resend', max: 3, windowSeconds: HOUR, keyFn: byIp }),
  requireAuth,
  async (c) => {
    const user = c.get('user');
    if (user.email_confirmed_at) return c.body(null, 204);

    const confirmToken = newUrlToken();
    const confirmHash = await sha256Hex(confirmToken);
    await c.env.DB.prepare(
      `INSERT INTO email_confirmations (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
    )
      .bind(confirmHash, user.id, now() + CONFIRM_TTL)
      .run();
    const confirmUrl = `${c.env.APP_URL}/confirm?token=${confirmToken}`;
    const result = await sendMail(c.env, {
      to: user.email,
      subject: 'Confirm your yrdsl.app account',
      text: `Confirm your email by clicking:\n${confirmUrl}\n\nThis link expires in 24 hours.`,
    });
    return c.json({ devConfirmUrl: result.stubbed ? confirmUrl : undefined });
  },
);

// ─── POST /auth/forgot-password ───────────────────────────────────────────
authRoutes.post(
  '/forgot-password',
  rateLimit({ name: 'forgot', max: 3, windowSeconds: HOUR, keyFn: byIp }),
  zValidator('json', ForgotBody),
  async (c) => {
    const body = c.req.valid('json');
    const email = normalizeEmail(body.email);
    const user = await c.env.DB.prepare(`SELECT id, email FROM users WHERE LOWER(email) = ?`)
      .bind(email)
      .first<{ id: string; email: string }>();
    // Always return 204 to avoid email-enumeration oracles.
    if (!user) return c.body(null, 204);
    const resetToken = newUrlToken();
    const resetHash = await sha256Hex(resetToken);
    await c.env.DB.prepare(
      `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
    )
      .bind(resetHash, user.id, now() + RESET_TTL)
      .run();
    const resetUrl = `${c.env.APP_URL}/reset?token=${resetToken}`;
    await sendMail(c.env, {
      to: user.email,
      subject: 'Reset your yrdsl.app password',
      text: `A password reset was requested. If this was you, click:\n${resetUrl}\n\nThis link expires in 1 hour. If not you, ignore this email.`,
    });
    return c.body(null, 204);
  },
);

// ─── POST /auth/reset-password ────────────────────────────────────────────
authRoutes.post(
  '/reset-password',
  rateLimit({ name: 'reset', max: 5, windowSeconds: HOUR, keyFn: byIp }),
  zValidator('json', ResetBody),
  async (c) => {
    const body = c.req.valid('json');
    const hash = await sha256Hex(body.token);
    const row = await c.env.DB.prepare(
      `SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?`,
    )
      .bind(hash)
      .first<{ user_id: string; expires_at: number; used_at: number | null }>();
    if (!row) return c.json({ error: 'invalid_token' }, 400);
    if (row.used_at) return c.json({ error: 'token_used' }, 400);
    if (row.expires_at < now()) return c.json({ error: 'token_expired' }, 400);

    const pwCheck = await checkPassword({ password: body.password });
    if (!pwCheck.ok) return c.json({ error: 'weak_password', issues: pwCheck.issues }, 400);
    const hibp = await isPasswordCompromised(c.env, body.password);
    if (hibp.compromised) {
      return c.json({ error: 'password_compromised', breachCount: hibp.count }, 400);
    }
    const passwordHash = await hashPassword(body.password);

    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE password_resets SET used_at = ? WHERE token_hash = ?`).bind(
        now(),
        hash,
      ),
      c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(
        passwordHash,
        now(),
        row.user_id,
      ),
    ]);
    await revokeAllUserSessions(c.env, row.user_id);
    return c.body(null, 204);
  },
);
