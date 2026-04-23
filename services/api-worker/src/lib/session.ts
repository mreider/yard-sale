import type { Context } from 'hono';
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie';
import type { AppEnv, Env, SessionRow } from '../env.js';
import { newId, now } from './ids.js';

const COOKIE_NAME = '__ys_sess';
const CSRF_COOKIE_NAME = '__ys_csrf';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Random 32-byte hex token for CSRF double-submit. */
function newCsrfToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(
  env: Env,
  userId: string,
  opts: { userAgent: string | null; ip: string | null },
): Promise<SessionRow> {
  const id = newId();
  const createdAt = now();
  const expiresAt = createdAt + SESSION_TTL_SECONDS;
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, user_agent, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, opts.userAgent, opts.ip, createdAt, expiresAt)
    .run();
  return {
    id,
    user_id: userId,
    user_agent: opts.userAgent,
    ip: opts.ip,
    created_at: createdAt,
    expires_at: expiresAt,
    revoked_at: null,
  };
}

export async function issueSessionCookie(c: Context<AppEnv>, sessionId: string): Promise<void> {
  await setSignedCookie(c, COOKIE_NAME, sessionId, c.env.SESSION_SIGNING_KEY, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
  });
  // CSRF token: NOT httpOnly so the SPA can read it and echo it on
  // mutating requests. The double-submit pattern: an attacker on
  // another origin cannot read the cookie value (cross-origin script
  // can't read cookies), so they cannot fabricate the matching header.
  //
  // In prod the SPA lives on app.yrdsl.app and the API on api.yrdsl.app.
  // Without a Domain attribute this cookie would be scoped to api.*
  // only, and document.cookie on app.* would never see it → the SPA
  // would send the PATCH without X-CSRF-Token and the server would
  // 403 on every mutating request. COOKIE_DOMAIN=yrdsl.app in prod
  // widens the cookie so both subdomains can read it.
  //
  // Pre-fix sessions had a host-only __ys_csrf on api.yrdsl.app. The
  // browser would keep sending both alongside the new apex cookie and
  // the server's getCookie could pick either, creating an intermittent
  // 403. Expiring the host-only variant here cleans up in one round-
  // trip for any user who signed up before this fix deployed.
  if (c.env.COOKIE_DOMAIN) {
    deleteCookie(c, CSRF_COOKIE_NAME, { path: '/' });
  }
  setCookie(c, CSRF_COOKIE_NAME, newCsrfToken(), {
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
    ...(c.env.COOKIE_DOMAIN ? { domain: c.env.COOKIE_DOMAIN } : {}),
  });
}

export function readCsrfCookie(c: Context<AppEnv>): string | null {
  return getCookie(c, CSRF_COOKIE_NAME) ?? null;
}

/**
 * Self-heals a legacy host-only __ys_csrf cookie (set before we widened
 * to Domain=apex). If the incoming request has the cookie and
 * COOKIE_DOMAIN is configured, re-emit the same value with Domain=apex
 * so both subdomains can see it, and emit a Max-Age=0 for the host-only
 * legacy variant so the browser cleans it up. The token value is
 * preserved — rotating it here would break in-flight mutations from
 * other tabs.
 *
 * Idempotent: on a session that already has the apex cookie, this is a
 * no-op write (browser just refreshes the cookie with the same value).
 */
export function promoteCsrfCookie(c: Context<AppEnv>): void {
  if (!c.env.COOKIE_DOMAIN) return;
  const existing = getCookie(c, CSRF_COOKIE_NAME);
  if (!existing) return;
  deleteCookie(c, CSRF_COOKIE_NAME, { path: '/' });
  setCookie(c, CSRF_COOKIE_NAME, existing, {
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
    domain: c.env.COOKIE_DOMAIN,
  });
}

export async function readSessionId(c: Context<AppEnv>): Promise<string | null> {
  const raw = await getSignedCookie(c, c.env.SESSION_SIGNING_KEY, COOKIE_NAME);
  return typeof raw === 'string' ? raw : null;
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  // Must match the Domain we set in issueSessionCookie, or the browser
  // won't consider the two cookies the same and the stale one sticks.
  deleteCookie(c, CSRF_COOKIE_NAME, {
    path: '/',
    ...(c.env.COOKIE_DOMAIN ? { domain: c.env.COOKIE_DOMAIN } : {}),
  });
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`)
    .bind(now(), sessionId)
    .run();
}

export async function revokeAllUserSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(now(), userId)
    .run();
}

export async function loadSession(env: Env, sessionId: string): Promise<SessionRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
  )
    .bind(sessionId, now())
    .first<SessionRow>();
  return row ?? null;
}
