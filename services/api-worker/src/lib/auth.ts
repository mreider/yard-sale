import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, Env, UserRow } from '../env.js';
import { loadSession, readCsrfCookie, readSessionId } from './session.js';
import { verifyApiToken } from './tokens.js';

async function loadUser(env: Env, userId: string): Promise<UserRow | null> {
  return (
    (await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<UserRow>()) ?? null
  );
}

/** Requires either a session cookie OR a bearer token. Populates c.var.user.
 *
 * For session-auth on mutating methods we additionally enforce CSRF via
 * double-submit cookie. The SPA reads the `__ys_csrf` cookie (not
 * httpOnly) and echoes it as the `X-CSRF-Token` header. An attacker on
 * another origin can't read the cookie value (browser policy), so they
 * can't fabricate the matching header. Bearer-token auth is exempt
 * because there are no cookies in play.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const clientIp = c.req.header('CF-Connecting-IP') ?? null;

  // 1. Bearer token
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const raw = authHeader.slice(7).trim();
    const token = await verifyApiToken(c.env, raw, clientIp);
    if (!token) return c.json({ error: 'invalid_token' }, 401);
    const user = await loadUser(c.env, token.user_id);
    if (!user) return c.json({ error: 'invalid_token' }, 401);
    c.set('user', user);
    c.set('apiToken', token);
    c.set('authKind', 'bearer');
    return next();
  }

  // 2. Session cookie
  const sessionId = await readSessionId(c);
  if (sessionId) {
    const session = await loadSession(c.env, sessionId);
    if (session) {
      const user = await loadUser(c.env, session.user_id);
      if (user) {
        // CSRF double-submit on mutating verbs (skip in test env).
        const method = c.req.method.toUpperCase();
        if (
          c.env.CSRF_SKIP !== 'true' &&
          method !== 'GET' &&
          method !== 'HEAD' &&
          method !== 'OPTIONS'
        ) {
          const cookie = readCsrfCookie(c);
          const header = c.req.header('X-CSRF-Token');
          if (!cookie || !header || cookie !== header) {
            return c.json({ error: 'csrf_mismatch' }, 403);
          }
        }
        c.set('user', user);
        c.set('session', session);
        c.set('authKind', 'session');
        return next();
      }
    }
  }

  return c.json({ error: 'unauthenticated' }, 401);
};

/** Like requireAuth, but additionally requires email confirmation. */
export const requireConfirmed: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireAuth(c, async () => {});
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  if (!user.email_confirmed_at) return c.json({ error: 'email_not_confirmed' }, 403);
  return next();
};

/**
 * Gate for /admin/* routes. Only users with `is_admin = 1` pass; everyone else
 *. signed-in or not. gets 403. The is_admin bit is never settable via any
 * user-facing endpoint; it's flipped via SQL or by signing up with an email
 * matching BOOTSTRAP_ADMIN_EMAIL (see routes/auth.ts).
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireAuth(c, async () => {});
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  if (!user.is_admin) return c.json({ error: 'forbidden' }, 403);
  return next();
};

/** Returns a public-safe view of a user row. */
export function userToPublic(u: UserRow, env: Env) {
  return {
    id: u.id,
    email: u.email,
    emailConfirmed: !!u.email_confirmed_at,
    username: u.username,
    avatarUrl: u.avatar_key ? `${env.APP_URL}/avatar/${u.id}` : null,
    defaultLanguage: u.default_language,
    defaultTheme: u.default_theme,
    isAdmin: !!u.is_admin,
    createdAt: u.created_at,
  };
}

/** Enforces bearer-token scope (for MCP / write operations). */
export function requireScope(minScope: 'read' | 'write' | 'admin'): MiddlewareHandler<AppEnv> {
  const rank = { read: 0, write: 1, admin: 2 } as const;
  return async (c, next) => {
    const kind = c.get('authKind');
    if (kind !== 'bearer') return next(); // session auth = full access by definition
    const t = c.get('apiToken');
    if (!t || rank[t.scope] < rank[minScope]) {
      return c.json({ error: 'insufficient_scope', required: minScope }, 403);
    }
    return next();
  };
}
