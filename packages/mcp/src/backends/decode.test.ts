import { describe, expect, test } from 'vitest';
import { decodeImageData } from './hosted.js';

/**
 * These tests lock in the behavior that prevents the real-world
 * failure mode we caught in 0.4.1: Claude passing a filesystem path
 * to `data` instead of the file's base64 contents. With weak error
 * reporting the server saw garbage and returned "too_small", leading
 * Claude to give up. The decoder should now reject path-shaped input
 * loudly and before the network trip.
 */

describe('decodeImageData: misuse guards', () => {
  test('rejects absolute POSIX path', () => {
    expect(() =>
      decodeImageData('/mnt/user-data/uploads/SCR-20260423-jrzm.jpeg', 'image/jpeg'),
    ).toThrow(/file path/);
  });

  test('rejects relative path starting with ./', () => {
    expect(() => decodeImageData('./photos/thing.png', 'image/png')).toThrow(/file path/);
  });

  test('rejects tilde-home path', () => {
    expect(() => decodeImageData('~/Downloads/foo.webp', 'image/webp')).toThrow(/file path/);
  });

  test('rejects Windows drive path', () => {
    expect(() => decodeImageData('C:\\Users\\matt\\Pictures\\foo.jpg', 'image/jpeg')).toThrow(
      /file path/,
    );
  });

  test('rejects file:// URL', () => {
    expect(() => decodeImageData('file:///tmp/foo.jpg', 'image/jpeg')).toThrow(/file:\/\//);
  });

  test('rejects http(s) URL and points at attach_image_from_url', () => {
    expect(() => decodeImageData('https://cdn.example.com/hero.jpg', 'image/jpeg')).toThrow(
      /attach_image_from_url/,
    );
    expect(() => decodeImageData('http://cdn.example.com/hero.jpg', 'image/jpeg')).toThrow(
      /attach_image_from_url/,
    );
  });

  test('rejects bare-filename-with-extension even without leading slash', () => {
    // e.g. "uploads/foo.jpg" — still a path, just no leading slash.
    expect(() => decodeImageData('uploads/foo.jpg', 'image/jpeg')).toThrow(/file path/);
  });

  test('accepts a real dataURL', () => {
    // 1x1 transparent PNG as a minimal valid image.
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    // The PNG above is only ~70 bytes decoded — under the 200-byte
    // minimum heuristic. Bump with noise so the happy path checks
    // "doesn't throw on real-ish input" without tripping the small-byte
    // check. We only care that rejectIfNotActualBytes accepts the shape.
    const withPadding = `${tinyPng}${'A'.repeat(1200)}`;
    // Padding still keeps it a valid dataURL structurally (regex only
    // checks the prefix). The resulting decode will include junk bytes
    // but that's fine — the guard short-circuits before that matters.
    expect(() => decodeImageData(withPadding)).not.toThrow();
  });

  test('accepts bare base64 when mime is supplied', () => {
    // ~1KB of arbitrary base64-looking content + mime.
    const b64 = 'A'.repeat(1200);
    expect(() => decodeImageData(b64, 'image/jpeg')).not.toThrow();
  });

  test('rejects bare base64 without mime', () => {
    expect(() => decodeImageData('A'.repeat(1200))).toThrow(/dataURL|mime/);
  });

  // Tiny decoded payloads (e.g. a 3-byte dataURL that's not a real image)
  // are NOT rejected client-side any more — the server-side magic-byte
  // sniff catches them with a clearer error. Client-side we only gate on
  // structural misuse (path/URL as data). See decodeImageData's final
  // comment for the reasoning.
});
