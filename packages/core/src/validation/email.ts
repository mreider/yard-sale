// Pragmatic RFC 5322 email regex. Accepts the vast majority of real addresses
// while rejecting obvious garbage. Server also runs an MX check on signup.
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.length > 254) return false;
  return EMAIL_RE.test(value);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
