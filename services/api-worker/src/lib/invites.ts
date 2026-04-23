import { customAlphabet } from 'nanoid';
import type { Env, InviteRow } from '../env.js';
import { now } from './ids.js';

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ambiguous-stripped
const genInviteCode = customAlphabet(ALPHA, 12);

export function newInviteCode(): string {
  return genInviteCode();
}

/** Validate a code: exists, not used, not revoked, not expired. Returns the row or a reason. */
export async function checkInvite(
  env: Env,
  code: string,
): Promise<
  | { ok: true; row: InviteRow }
  | { ok: false; reason: 'not_found' | 'already_used' | 'revoked' | 'expired' }
> {
  const row = await env.DB.prepare(`SELECT * FROM invites WHERE code = ?`)
    .bind(code)
    .first<InviteRow>();
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at) return { ok: false, reason: 'already_used' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (row.expires_at < now()) return { ok: false, reason: 'expired' };
  return { ok: true, row };
}

export async function consumeInvite(env: Env, code: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE invites SET used_at = ?, used_by = ? WHERE code = ? AND used_at IS NULL`,
  )
    .bind(now(), userId, code)
    .run();
}

export function inviteStatus(row: InviteRow): 'pending' | 'used' | 'expired' | 'revoked' {
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'used';
  if (row.expires_at < now()) return 'expired';
  return 'pending';
}
