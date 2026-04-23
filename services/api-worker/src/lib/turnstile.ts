import type { Env } from '../env.js';

/**
 * Cloudflare Turnstile (CAPTCHA) verifier.
 *
 * If `TURNSTILE_SECRET_KEY` is unset (dev, tests, or before the
 * production secret is configured) verification is skipped — the
 * caller treats every request as passing. This keeps signup working
 * during development without needing a Turnstile project, and makes
 * rolling Turnstile out a single secret push rather than a code change.
 *
 * In prod the secret is always set, the SPA renders the widget, and a
 * missing/invalid token returns `{ ok: false }` so the caller can 400.
 */
export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true };

  if (!token) return { ok: false, reason: 'missing_token' };

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);

  let res: Response;
  try {
    res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
  } catch (err) {
    // Network failure talking to Turnstile. We choose to fail-open here:
    // a flaky third-party shouldn't block legitimate signups, and abuse
    // is already rate-limited at the IP layer. Log so we notice.
    console.error('turnstile siteverify network error', err);
    return { ok: true };
  }
  if (!res.ok) {
    console.error('turnstile siteverify non-200', res.status);
    return { ok: true };
  }
  const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
  if (data.success) return { ok: true };
  const reason = data['error-codes']?.[0] ?? 'failed';
  return { ok: false, reason };
}
