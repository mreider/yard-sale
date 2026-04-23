#!/usr/bin/env node
/**
 * One-shot: generates the INSERT SQL to seed a long-lived test account
 * used by the prod smoke workflow. You run this once, then apply the
 * printed SQL via `wrangler d1 execute yard-sale --remote --command "..."`.
 *
 * Usage:
 *   SMOKE_EMAIL=smoke@test.yrdsl.app \
 *   SMOKE_USERNAME=smoke \
 *   SMOKE_PASSWORD='<strong random>' \
 *   node scripts/seed-smoke-user.mjs
 *
 * The account is created with email_confirmed_at set so the smoke can
 * skip the confirmation flow entirely. is_admin stays 0.
 */
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';

const email = process.env.SMOKE_EMAIL;
const username = process.env.SMOKE_USERNAME;
const password = process.env.SMOKE_PASSWORD;

if (!email || !username || !password) {
  console.error('Set SMOKE_EMAIL, SMOKE_USERNAME, SMOKE_PASSWORD in env.');
  process.exit(1);
}
if (password.length < 20) {
  console.error('Pick a longer password. At least 20 chars.');
  process.exit(1);
}

// Must match packages/api-worker/src/lib/password.ts PARAMS.
const N = 16384;
const r = 8;
const p = 1;
const dkLen = 32;

const salt = randomBytes(16);
const hash = scryptSync(password, salt, dkLen, { N, r, p, maxmem: 128 * N * r * 2 });
const encoded = `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;

const id = randomUUID();
const now = Math.floor(Date.now() / 1000);

const esc = (s) => String(s).replace(/'/g, "''");
const sql = `INSERT INTO users (
  id, email, email_confirmed_at, password_hash, username,
  default_language, default_theme, is_admin, created_at, updated_at
) VALUES (
  '${id}',
  '${esc(email)}',
  ${now},
  '${esc(encoded)}',
  '${esc(username)}',
  'en',
  'conservative',
  0,
  ${now},
  ${now}
);`;

if (process.env.JUST_SQL === '1') {
  // Machine-consumption mode (used by the seed-smoke-user GH workflow).
  process.stdout.write(sql);
} else {
  console.log('# Copy the following, then run:');
  console.log(
    `# pnpm --filter @yrdsl/api-worker exec wrangler d1 execute yard-sale --remote --command "$(cat <<'SQL'`,
  );
  console.log(sql);
  console.log('SQL');
  console.log(')"');
  console.log();
  console.log(`# User id: ${id}`);
  console.log(`# Email:   ${email}`);
  console.log(`# Username: ${username}`);
}
