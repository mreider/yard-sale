import type { ApiTokenRow, Env } from '../env.js';
import { sha256Hex } from './hash.js';
import { newApiToken, newId, now } from './ids.js';

export async function createApiToken(
  env: Env,
  userId: string,
  args: { name: string; scope: 'read' | 'write' | 'admin'; expiresAt: number | null },
): Promise<{ row: ApiTokenRow; raw: string }> {
  const { raw, prefix } = newApiToken();
  const tokenHash = await sha256Hex(raw);
  const id = newId();
  const createdAt = now();
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scope, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, args.name, tokenHash, prefix, args.scope, args.expiresAt, createdAt)
    .run();
  const row: ApiTokenRow = {
    id,
    user_id: userId,
    name: args.name,
    token_hash: tokenHash,
    token_prefix: prefix,
    scope: args.scope,
    expires_at: args.expiresAt,
    last_used_at: null,
    last_used_ip: null,
    created_at: createdAt,
    revoked_at: null,
  };
  return { row, raw };
}

export async function verifyApiToken(
  env: Env,
  raw: string,
  ip: string | null,
): Promise<ApiTokenRow | null> {
  if (!raw.startsWith('yrs_live_')) return null;
  const tokenHash = await sha256Hex(raw);
  const row = await env.DB.prepare(
    `SELECT * FROM api_tokens
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
  )
    .bind(tokenHash, now())
    .first<ApiTokenRow>();
  if (!row) return null;
  // Best-effort last_used update (don't block on it).
  await env.DB.prepare(`UPDATE api_tokens SET last_used_at = ?, last_used_ip = ? WHERE id = ?`)
    .bind(now(), ip, row.id)
    .run();
  return row;
}

export async function listUserTokens(env: Env, userId: string): Promise<ApiTokenRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM api_tokens
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<ApiTokenRow>();
  return results ?? [];
}

export async function revokeToken(env: Env, userId: string, tokenId: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  )
    .bind(now(), tokenId, userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export function expiryToEpoch(choice: 'none' | '30d' | '90d' | '1y'): number | null {
  if (choice === 'none') return null;
  const day = 86400;
  const map = { '30d': 30 * day, '90d': 90 * day, '1y': 365 * day } as const;
  return now() + map[choice];
}

export function tokenToPublic(row: ApiTokenRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scope: row.scope,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
    createdAt: row.created_at,
  };
}
