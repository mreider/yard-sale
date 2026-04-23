import type { Env } from '../env.js';

/**
 * HIBP k-anonymity password check.
 * https://haveibeenpwned.com/API/v3#PwnedPasswords
 *
 * SHA-1s the password locally, sends only the first 5 hex chars to HIBP,
 * gets back all hashes with that prefix + their breach counts. We never
 * send the full hash. The response is text:
 *
 *   <SUFFIX>:<COUNT>
 *   <SUFFIX>:<COUNT>
 *   ...
 *
 * We look for our hash's suffix in the list. Any nonzero count = it
 * appeared in a known breach and the user should pick something else.
 *
 * Failure modes:
 *   - HIBP unreachable / 5xx → allow the signup (HIBP being down should
 *     not be a denial-of-service against our signup flow).
 *   - HIBP_SKIP env var set to "true" → skip entirely. Used by tests so
 *     they don't burn HIBP rate budget or fail when a test password is
 *     accidentally in a breach corpus.
 */
export async function isPasswordCompromised(
  env: Env,
  password: string,
): Promise<{ compromised: boolean; count: number }> {
  if (env.HIBP_SKIP === 'true') return { compromised: false, count: 0 };

  let hash: string;
  try {
    hash = await sha1Hex(password);
  } catch {
    return { compromised: false, count: 0 };
  }
  const prefix = hash.slice(0, 5).toUpperCase();
  const suffix = hash.slice(5).toUpperCase();

  let res: Response;
  try {
    res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        // Padding asks HIBP to add random extra entries in the response so
        // an observer can't infer popular vs rare prefixes by response size.
        'Add-Padding': 'true',
        'User-Agent': 'yrdsl.app/1.0 (+https://yrdsl.app)',
      },
    });
  } catch {
    return { compromised: false, count: 0 };
  }
  if (!res.ok) return { compromised: false, count: 0 };

  const text = await res.text();
  for (const line of text.split('\n')) {
    const [s, c] = line.trim().split(':');
    if (s === suffix) {
      return { compromised: true, count: Number(c) || 0 };
    }
  }
  return { compromised: false, count: 0 };
}

async function sha1Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
