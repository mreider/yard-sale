import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normalizeImage } from './image-normalize.js';

describe('normalizeImage', () => {
  it(
    'resizes + re-encodes a large JPEG to WebP capped at 1600px longest edge',
    { timeout: 30_000 },
    async () => {
      const srcJpeg = await sharp({
        create: { width: 4032, height: 3024, channels: 3, background: '#a3a3a3' },
      })
        .composite(
          Array.from({ length: 40 }, (_, i) => ({
            input: Buffer.from(
              `<svg width='4032' height='3024'><rect x='${i * 100}' y='${i * 70}' width='80' height='60' fill='hsl(${i * 9},60%,50%)'/></svg>`,
            ),
            top: 0,
            left: 0,
          })),
        )
        .jpeg({ quality: 92 })
        .toBuffer();

      const { bytes, mime } = await normalizeImage(new Uint8Array(srcJpeg), 'image/jpeg');
      const outMeta = await sharp(Buffer.from(bytes)).metadata();

      expect(mime).toBe('image/webp');
      expect(bytes.byteLength).toBeLessThan(srcJpeg.length);
      expect(outMeta.format).toBe('webp');
      expect(Math.max(outMeta.width ?? 0, outMeta.height ?? 0)).toBeLessThanOrEqual(1600);
    },
  );

  it('preserves aspect ratio for portrait-oriented inputs', async () => {
    const portrait = await sharp({
      create: { width: 2000, height: 3000, channels: 3, background: '#333333' },
    })
      .jpeg()
      .toBuffer();

    const { bytes } = await normalizeImage(new Uint8Array(portrait), 'image/jpeg');
    const meta = await sharp(Buffer.from(bytes)).metadata();

    expect(meta.height).toBe(1600);
    expect(meta.width).toBe(Math.round(2000 * (1600 / 3000)));
  });

  it('leaves a small input untouched in dimensions (no upscaling)', async () => {
    const smallJpeg = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#666666' },
    })
      .jpeg()
      .toBuffer();

    const { bytes } = await normalizeImage(new Uint8Array(smallJpeg), 'image/jpeg');
    const meta = await sharp(Buffer.from(bytes)).metadata();

    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it('short-circuits a reasonably-sized WebP (skips the decode/encode cycle)', async () => {
    const smallWebp = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#bada55' },
    })
      .webp()
      .toBuffer();

    const { bytes, mime } = await normalizeImage(new Uint8Array(smallWebp), 'image/webp');

    expect(mime).toBe('image/webp');
    expect(bytes.byteLength).toBe(smallWebp.byteLength);
  });
});
