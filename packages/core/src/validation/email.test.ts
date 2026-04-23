import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from './email.js';

describe('isValidEmail', () => {
  it.each(['a@b.co', 'user+tag@example.com', 'matt.reider@example.co.uk', "o'brien@example.com"])(
    'accepts %s',
    (e) => {
      expect(isValidEmail(e)).toBe(true);
    },
  );

  it.each([
    '',
    'nope',
    '@example.com',
    'user@',
    'user@.com',
    'user@example',
    `${'a'.repeat(250)}@example.com`,
  ])('rejects %s', (e) => {
    expect(isValidEmail(e)).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Matt@Example.COM ')).toBe('matt@example.com');
  });
});
