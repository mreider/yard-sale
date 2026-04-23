export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  R2_IMAGES: R2Bucket;
  R2_AVATARS: R2Bucket;

  // Vars
  APP_URL: string;
  /**
   * Base URL where /image/<key> is actually served. In prod this is the
   * api-worker's own origin (https://api.yrdsl.app), since /image/* is
   * mounted here — NOT on APP_URL (the SPA on Pages). Falls back to
   * APP_URL when unset so local dev / tests keep working.
   */
  IMAGE_BASE_URL?: string;
  /**
   * Base URL where published sales are viewed by the public (viewer-worker
   * on the apex). Used to construct `publicUrl` fields returned in the
   * API so clients (MCP, SPA) can surface a shareable link. Falls back
   * to APP_URL when unset.
   */
  VIEWER_URL?: string;
  EMAIL_FROM: string;
  ALLOWED_ORIGINS: string;
  /** "true" (default) to require an invite code on signup. Flip to "false" when going public. */
  REQUIRE_INVITE: string;
  /** First signup matching this email (case-insensitive) becomes admin and bypasses REQUIRE_INVITE. */
  BOOTSTRAP_ADMIN_EMAIL: string;
  /** "true" disables the HIBP k-anonymity password check. Use only in tests. */
  HIBP_SKIP?: string;
  /** "true" disables the double-submit CSRF check. Use only in tests. */
  CSRF_SKIP?: string;
  /**
   * Cookie Domain for the __ys_csrf cookie. In prod, set to the apex
   * ("yrdsl.app") so the SPA on app.yrdsl.app can read the cookie via
   * document.cookie for the double-submit echo. In dev (localhost), leave
   * unset — browsers don't handle Domain=localhost cleanly and same-host
   * cookies work automatically. The session cookie stays host-only; only
   * the CSRF cookie needs cross-subdomain read access.
   */
  COOKIE_DOMAIN?: string;

  // Secrets
  SESSION_SIGNING_KEY: string;
  RESEND_API_KEY?: string;
  /** Cloudflare Turnstile secret. When set, /auth/signup requires a valid token. */
  TURNSTILE_SECRET_KEY?: string;
}

export interface UserRow {
  id: string;
  email: string;
  email_confirmed_at: number | null;
  password_hash: string;
  username: string;
  avatar_key: string | null;
  default_language: string;
  default_theme: string;
  is_admin: number;
  created_at: number;
  updated_at: number;
}

export interface InviteRow {
  code: string;
  created_by: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by: string | null;
  note: string | null;
  revoked_at: number | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export interface SaleRow {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string | null;
  theme: string;
  language: string;
  currency: string;
  cover_key: string | null;
  contact_email: string | null;
  contact_sms: string | null;
  contact_whatsapp: string | null;
  contact_notes: string | null;
  deleted_at: number | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ItemRow {
  id: string;
  sale_id: string;
  slug: string;
  title: string;
  description: string | null;
  price_cents: number | null;
  tags: string | null;
  images: string | null;
  reserved: string | null;
  sort_order: number;
  added_at: number;
  updated_at: number;
}

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scope: 'read' | 'write' | 'admin';
  expires_at: number | null;
  last_used_at: number | null;
  last_used_ip: string | null;
  created_at: number;
  revoked_at: number | null;
}

export type AppVariables = {
  user: UserRow;
  session?: SessionRow;
  apiToken?: ApiTokenRow;
  authKind: 'session' | 'bearer';
  reqId: string;
};

export type AppEnv = { Bindings: Env; Variables: AppVariables };
