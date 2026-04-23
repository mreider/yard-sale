export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordIssue = 'too_short' | 'too_long' | 'contains_email' | 'breached';

export interface PasswordCheckInput {
  password: string;
  email?: string;
  /** Optional HIBP checker. Given SHA-1 prefix (5 uppercase hex chars), returns a Set of suffixes that were breached. */
  hibpPrefixLookup?: (prefix: string) => Promise<Set<string>>;
}

export interface PasswordCheckResult {
  ok: boolean;
  issues: PasswordIssue[];
}

/**
 * Password check aligned with NIST SP 800-63B: length + HIBP is what
 * matters. Complexity rules ("must contain 3 of 4 character classes")
 * are deliberately absent — they push users toward predictable patterns
 * like "Summer2024!" without adding real entropy. HIBP catches the
 * common weak passwords that short length alone would miss.
 *
 * No zxcvbn dependency: it's ~200KB, and the HIBP round-trip on every
 * signup already vets the password against observed breaches, which is
 * a stronger signal than a heuristic entropy score.
 */
export async function checkPassword(input: PasswordCheckInput): Promise<PasswordCheckResult> {
  const { password, email } = input;
  const issues: PasswordIssue[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) issues.push('too_short');
  if (password.length > PASSWORD_MAX_LENGTH) issues.push('too_long');

  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) {
    issues.push('contains_email');
  }

  if (input.hibpPrefixLookup && issues.length === 0) {
    const sha1 = await sha1Hex(password);
    const prefix = sha1.slice(0, 5).toUpperCase();
    const suffix = sha1.slice(5).toUpperCase();
    const breachedSuffixes = await input.hibpPrefixLookup(prefix);
    if (breachedSuffixes.has(suffix)) issues.push('breached');
  }

  return { ok: issues.length === 0, issues };
}

async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
