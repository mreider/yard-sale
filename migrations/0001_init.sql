-- 0001_init.sql. initial schema per PRD §8.
-- Cloudflare D1 (SQLite dialect).

PRAGMA foreign_keys = ON;

-- ─── users ────────────────────────────────────────────────────────────────
-- display_name was dropped in 0002. Kept here historically — new
-- databases get the column and 0002 drops it during migration. To
-- collapse the two when the project has no users to preserve, just
-- delete this column from the CREATE TABLE above and remove 0002.
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  email_confirmed_at INTEGER,
  password_hash      TEXT NOT NULL,
  username           TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  avatar_key         TEXT,
  default_language   TEXT NOT NULL DEFAULT 'en',
  default_theme      TEXT NOT NULL DEFAULT 'conservative',
  is_admin           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE UNIQUE INDEX users_email_unique    ON users (LOWER(email));
CREATE UNIQUE INDEX users_username_unique ON users (LOWER(username));

-- ─── email confirmation tokens ────────────────────────────────────────────
CREATE TABLE email_confirmations (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX email_confirmations_user_idx ON email_confirmations (user_id);

-- ─── password reset tokens ────────────────────────────────────────────────
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);

-- ─── sessions (web cookie) ────────────────────────────────────────────────
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent  TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ─── invite-only beta gating (PRD §6.1 addendum) ─────────────────────────
-- While REQUIRE_INVITE=true, signup requires a valid unused invite code.
-- The first user matching BOOTSTRAP_ADMIN_EMAIL is seeded as admin and
-- generates codes from /admin. Flip REQUIRE_INVITE=false to go public.
CREATE TABLE invites (
  code         TEXT PRIMARY KEY,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  used_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT,
  revoked_at   INTEGER
);
CREATE INDEX invites_created_by_idx ON invites (created_by);
CREATE INDEX invites_status_idx     ON invites (used_at, revoked_at, expires_at);

-- ─── API tokens ───────────────────────────────────────────────────────────
CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('read','write','admin')),
  expires_at   INTEGER,
  last_used_at INTEGER,
  last_used_ip TEXT,
  created_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);

-- ─── yard sales ───────────────────────────────────────────────────────────
CREATE TABLE sales (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  theme             TEXT NOT NULL DEFAULT 'conservative',
  language          TEXT NOT NULL DEFAULT 'en',
  -- ISO 4217. Prices on items stored in cents for this currency.
  currency          TEXT NOT NULL DEFAULT 'USD',
  cover_key         TEXT,
  -- PRD §6.4: buyers contact seller directly. At least one of
  -- contact_{email,sms,whatsapp} must be set before a sale can publish.
  contact_email     TEXT,
  contact_sms       TEXT,
  contact_whatsapp  TEXT,
  contact_notes     TEXT,
  deleted_at        INTEGER,
  published_at      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (user_id, slug)
);
CREATE INDEX sales_user_idx      ON sales (user_id);
CREATE INDEX sales_published_idx ON sales (published_at) WHERE published_at IS NOT NULL;

-- ─── items ────────────────────────────────────────────────────────────────
CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  sale_id      TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  -- Currency is at sale level (sales.currency); prices here are cents in that currency.
  price_cents  INTEGER,
  tags         TEXT,    -- JSON array
  images       TEXT,    -- JSON array of R2 keys
  reserved     TEXT,    -- JSON object or NULL
  sort_order   INTEGER NOT NULL DEFAULT 0,
  added_at     INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (sale_id, slug)
);
CREATE INDEX items_sale_idx ON items (sale_id);

-- ─── rate-limit bookkeeping (used when KV is not sufficient) ──────────────
CREATE TABLE rate_limit_events (
  bucket      TEXT NOT NULL,     -- e.g. 'signup:ip:1.2.3.4' or 'login:email:...'
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, occurred_at)
);
