import { scrypt } from '@noble/hashes/scrypt';

// OWASP 2023 scrypt recommendation: N=2^17 memory-cost for interactive auth.
// 2^14 keeps CPU budget comfortable on Workers while still adding meaningful
// cache-hardness over PBKDF2.
const PARAMS = { N: 16384, r: 8, p: 1, dkLen: 32 } as const;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = scrypt(new TextEncoder().encode(password), salt, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6) return false;
  const [algo, Ns, rs, ps, saltB64, hashB64] = parts;
  if (algo !== 'scrypt') return false;
  const N = Number(Ns);
  const r = Number(rs);
  const p = Number(ps);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = fromB64(saltB64!);
  const expected = fromB64(hashB64!);
  const actual = scrypt(new TextEncoder().encode(password), salt, {
    N,
    r,
    p,
    dkLen: expected.length,
  });
  return constantTimeEqualBytes(actual, expected);
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
