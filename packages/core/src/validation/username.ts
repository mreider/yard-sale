export const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;

export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'www',
  'help',
  'about',
  'pricing',
  'login',
  'logout',
  'signup',
  'signin',
  'register',
  'settings',
  'profile',
  'account',
  'dashboard',
  'home',
  'static',
  'assets',
  'cdn',
  'mail',
  'email',
  'ftp',
  'ssh',
  'support',
  'contact',
  'terms',
  'privacy',
  'docs',
  'doc',
  'blog',
  'news',
  'status',
  'health',
  'ping',
  'oauth',
  'auth',
  'me',
  'users',
  'user',
  'sale',
  'sales',
  'item',
  'items',
  'image',
  'images',
  'avatar',
  'avatars',
  'yardsale',
  'yrdsl',
  'mcp',
  'connector',
  'connectors',
  'billing',
  'invoice',
  'stripe',
]);

export type UsernameIssue = 'invalid_format' | 'reserved';

export function checkUsername(value: string): UsernameIssue | null {
  const v = value.toLowerCase();
  if (!USERNAME_RE.test(v)) return 'invalid_format';
  if (RESERVED_USERNAMES.has(v)) return 'reserved';
  return null;
}

export function suggestUsername(email: string): string {
  const local = email.split('@')[0] ?? '';
  return (
    local
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'user'
  );
}
