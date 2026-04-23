/**
 * Client-side image processing for item uploads.
 *
 * Resizes the source image so the longest edge is `maxDim`, then encodes.
 * Tries WebP first (~25% smaller than JPEG at similar quality) and falls
 * back to JPEG if the browser doesn't support WebP encoding via
 * canvas.toBlob. EXIF metadata is stripped — canvas re-encoding doesn't
 * preserve it.
 *
 * Returns `{ blob, mime }` so the caller can set the correct
 * Content-Type on upload. The server validates that the body's magic
 * bytes match the declared mime, so the two must agree.
 */
export async function resizeForUpload(
  file: File,
  maxDim = 1200,
): Promise<{ blob: Blob; mime: 'image/webp' | 'image/jpeg' }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image.'));
      el.src = url;
    });
    const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Couldn't get a 2D canvas context.");
    ctx.drawImage(img, 0, 0, w, h);

    // Try WebP. The browser is allowed to ignore the type hint and fall
    // back to PNG when WebP encoding isn't supported (older Safari), so
    // we check blob.type afterward instead of trusting the request.
    const webp = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    );
    if (webp && webp.type === 'image/webp') {
      return { blob: webp, mime: 'image/webp' };
    }
    // WebP not honored — try JPEG. Universally supported by canvas.toBlob.
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (jpeg && jpeg.type === 'image/jpeg') {
      return { blob: jpeg, mime: 'image/jpeg' };
    }
    throw new Error(
      "Your browser couldn't encode the image. Try a different file or a modern Chrome/Safari/Firefox.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
