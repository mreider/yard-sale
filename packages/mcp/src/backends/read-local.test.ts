import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readLocalImage } from './hosted.js';

/**
 * Regression for the 0.4.5 "require is not defined" crash: readLocalImage
 * called require('node:fs') inside an ESM build, which type-checks fine
 * but blows up at runtime. Just invoking it against a real file proves
 * the runtime path still works.
 */
describe('readLocalImage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yrdsl-read-local-'));
  // minimal valid JPEG: SOI + APP0 + dummy data + EOI
  const jpegBytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);

  test('reads a real file and returns bytes + mime', () => {
    const p = join(dir, 'tiny.jpg');
    writeFileSync(p, jpegBytes);
    const { bytes, mime } = readLocalImage(p);
    expect(mime).toBe('image/jpeg');
    expect(bytes.byteLength).toBe(jpegBytes.byteLength);
  });

  test('rejects a missing path with an actionable error', () => {
    expect(() => readLocalImage(join(dir, 'does-not-exist.jpg'))).toThrow(/doesn't exist on disk/i);
  });

  test('rejects a claude.ai sandbox path with a sandbox-specific error', () => {
    expect(() => readLocalImage('/mnt/user-data/uploads/foo.jpg')).toThrow(/sandbox|claude\.ai/i);
  });
});
