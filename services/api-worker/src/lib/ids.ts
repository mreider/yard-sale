import { customAlphabet } from 'nanoid';
import { ulid } from 'ulid';

export function newId(): string {
  return ulid();
}

const TOKEN_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nanoToken = customAlphabet(TOKEN_ALPHABET, 22);

export function newApiToken(): { raw: string; prefix: string } {
  const raw = `yrs_live_${nanoToken()}`;
  return { raw, prefix: raw.slice(0, 12) };
}

const urlSafeAlphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
export const newUrlToken = customAlphabet(urlSafeAlphabet, 48);

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
