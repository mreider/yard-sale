import sharp from 'sharp';

function log(msg: string): void {
  process.stderr.write(`yrdsl-mcp: ${msg}\n`);
}

/**
 * Resize + re-encode a user-supplied image before it gets uploaded or
 * written to disk. Phone photos from iPhones land in the 3-10MB range;
 * after this they're ~200-500KB with no perceptible quality loss.
 *
 * - Auto-orients from EXIF (phones record camera orientation separately).
 * - Strips metadata (GPS, camera model, EXIF) as a privacy measure.
 * - Caps the longest edge at MAX_DIM; smaller images are not upscaled.
 * - Re-encodes as WebP (~25% smaller than JPEG at similar visual quality).
 *
 * Fast path: if the input is already a reasonably-sized WebP (e.g. the
 * web editor already ran its own resize/encode), leave it alone. Running
 * through sharp would cost a decode/encode round-trip for no visible
 * benefit and would strip another generation of quality from the image.
 */

const MAX_DIM = 1600;
const QUALITY = 82;
const WEBP_MIME = 'image/webp';
const SKIP_IF_WEBP_UNDER = 600_000;

export async function normalizeImage(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (mime === WEBP_MIME && bytes.byteLength < SKIP_IF_WEBP_UNDER) {
    log(`normalizeImage: skip (already-small webp, ${bytes.byteLength} bytes)`);
    return { bytes, mime };
  }
  const t0 = Date.now();
  const inputSize = bytes.byteLength;
  let pipe = sharp(Buffer.from(bytes)).rotate();
  const meta = await pipe.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w > MAX_DIM || h > MAX_DIM) {
    // sharp's resize keeps aspect when only one dim is specified.
    pipe = pipe.resize({
      width: w >= h ? MAX_DIM : undefined,
      height: h > w ? MAX_DIM : undefined,
      withoutEnlargement: true,
    });
  }
  const out = await pipe.webp({ quality: QUALITY, effort: 4 }).toBuffer();
  log(
    `normalizeImage: ${inputSize} ${mime} (${w}x${h}) → ${out.byteLength} ${WEBP_MIME} in ${Date.now() - t0}ms`,
  );
  return { bytes: new Uint8Array(out), mime: WEBP_MIME };
}
