import { Hono } from 'hono';
import type { AppEnv, ItemRow, SaleRow } from '../env.js';
import { requireAuth, requireScope } from '../lib/auth.js';
import { newId, now } from '../lib/ids.js';
import { byUser, rateLimit } from '../lib/rate-limit.js';
import { itemRowToItem, withItemUrls } from '../lib/sales.js';

/**
 * Item image uploads + public serving.
 *
 * Upload path (authenticated):
 *   POST /sales/:saleId/items/:itemId/images  + raw WebP bytes
 *   Stores at R2 key `sales/{saleId}/items/{itemId}/{imageId}.webp`,
 *   appends `${IMAGE_BASE_URL}/image/{key}` to the item's `images` array,
 *   returns the updated item.
 *
 * Public serving:
 *   GET /image/{key*}  (catchall, unauthenticated)
 *
 * `/image/*` is mounted on the API worker (api.yrdsl.app). IMAGE_BASE_URL
 * must point there — not APP_URL (the Pages SPA, which has a catch-all
 * redirect to index.html).
 *
 * The image URLs are unguessable (ULID image id) but not tokenized; if a
 * sale is draft today and published tomorrow, older image URLs work
 * either way. That's fine for the billboard model — the viewer gates
 * access; raw image URLs leaking isn't sensitive.
 */

const IMAGE_MIN_BYTES = 200;

// from-url can't rely on the client pre-resizing, so accept more. Big
// enough for typical product-page hero shots (1-5 MB); small enough
// that one greedy caller can't blow R2 costs.
const FROM_URL_MAX_BYTES = 5_000_000;

// Accepted content-types for from-url uploads. JPEG + PNG + WebP cover
// everything the viewer's <img> handles. GIF/SVG/HEIC excluded on
// purpose: GIF bloats, SVG is an XSS vector, HEIC not universal.
const ACCEPTED_MIMES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Detect image type from the first handful of bytes. Defense-in-depth
 * against a lying Content-Type header — we pick the stricter of the two.
 */
function sniffMime(buf: ArrayBuffer): string | null {
  const u8 = new Uint8Array(buf, 0, Math.min(buf.byteLength, 12));
  if (u8.length < 4) return null;
  // JPEG: FF D8 FF
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47 &&
    u8[4] === 0x0d &&
    u8[5] === 0x0a &&
    u8[6] === 0x1a &&
    u8[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * SSRF guard for from-url fetches. Require http/https and reject common
 * loopback / private-network hostnames so a caller can't proxy the
 * worker into reaching things it shouldn't. Cloudflare's fetch() doesn't
 * reach the customer's VPCs, so this is defense-in-depth rather than
 * the only line — but the cost of the check is nil.
 */
function validateFetchableUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host); // link-local
  if (blocked) return { ok: false, reason: 'blocked_host' };
  return { ok: true, url };
}

export const imageRoutes = new Hono<AppEnv>();
imageRoutes.use('*', requireAuth);

// NB: the WebP-only POST /:saleId/items/:itemId/images endpoint was
// removed in favor of /images/bytes, which accepts JPEG/PNG/WebP with
// matching Content-Type. Older Safari's canvas.toBlob silently falls
// back to PNG when asked for WebP, which tripped the WebP magic-bytes
// check on every upload from those browsers. One endpoint with clearer
// errors is simpler than two with format-coupled failure modes.

/**
 * POST /sales/:saleId/items/:itemId/images/bytes
 * Body: raw image bytes (JPEG, PNG, or WebP) with matching Content-Type.
 *
 * Built for MCP clients that have the image in-context but can't provide
 * a public URL (e.g. user pasted a photo into Claude chat). Claude
 * base64-encodes, MCP decodes + POSTs the raw bytes here. Server sniffs
 * magic bytes, validates mime, stores in R2.
 *
 * The older `/images` endpoint requires pre-resized WebP because the
 * SPA client handles that itself. This one accepts any of the three
 * common web formats at a higher size cap; we don't re-encode.
 */
imageRoutes.post(
  '/:saleId/items/:itemId/images/bytes',
  requireScope('write'),
  rateLimit({ name: 'image-bytes', max: 60, windowSeconds: 3600, keyFn: byUser }),
  async (c) => {
    const user = c.get('user');
    const saleId = c.req.param('saleId');
    const itemId = c.req.param('itemId');

    const sale = await c.env.DB.prepare(
      `SELECT * FROM sales WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
      .bind(saleId, user.id)
      .first<SaleRow>();
    if (!sale) return c.json({ error: 'not_found' }, 404);
    const item = await c.env.DB.prepare(`SELECT * FROM items WHERE id = ? AND sale_id = ?`)
      .bind(itemId, sale.id)
      .first<ItemRow>();
    if (!item) return c.json({ error: 'not_found' }, 404);

    const declaredCt = (c.req.header('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (!declaredCt || !(declaredCt in ACCEPTED_MIMES)) {
      return c.json({ error: 'unsupported_image_type' }, 400);
    }

    const buf = await c.req.arrayBuffer();
    if (buf.byteLength < IMAGE_MIN_BYTES) {
      return c.json(
        {
          error: 'decoded_too_small',
          receivedBytes: buf.byteLength,
          minBytes: IMAGE_MIN_BYTES,
          hint:
            'Expected image bytes. Got < 200 bytes — the caller likely sent a ' +
            'path, placeholder, or the base64 decoded to garbage. Pass the ' +
            "file's actual base64-encoded contents.",
        },
        400,
      );
    }
    if (buf.byteLength > FROM_URL_MAX_BYTES) {
      return c.json({ error: 'too_large', max: FROM_URL_MAX_BYTES }, 413);
    }

    const sniffed = sniffMime(buf);
    if (!sniffed || !ACCEPTED_MIMES[sniffed]) {
      return c.json(
        {
          error: 'invalid_image_bytes',
          hint:
            'First bytes did not match any of JPEG (FF D8 FF), PNG (89 50 4E 47), ' +
            'or WebP (RIFF....WEBP). Caller probably sent text instead of binary, ' +
            "or the base64 decode produced garbage. Pass the file's actual bytes.",
        },
        400,
      );
    }
    // Belt-and-braces: header and magic should agree; normalize to jpg/jpeg.
    const declaredCanonical = declaredCt === 'image/jpg' ? 'image/jpeg' : declaredCt;
    if (declaredCanonical !== sniffed) {
      return c.json(
        {
          error: 'mime_mismatch',
          declared: declaredCanonical,
          detected: sniffed,
          hint: `You claimed ${declaredCanonical} in Content-Type but the bytes say ${sniffed}. Fix the mime argument to match.`,
        },
        400,
      );
    }

    const ext = ACCEPTED_MIMES[sniffed];
    const imageId = newId();
    const key = `sales/${sale.id}/items/${itemId}/${imageId}.${ext}`;
    await c.env.R2_IMAGES.put(key, buf, {
      httpMetadata: { contentType: sniffed, cacheControl: 'public, max-age=31536000' },
    });

    const url = `${c.env.IMAGE_BASE_URL ?? c.env.APP_URL}/image/${key}`;
    const existing = item.images ? (JSON.parse(item.images) as string[]) : [];
    const images = [...existing, url];
    const ts = now();
    await c.env.DB.prepare(`UPDATE items SET images = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(images), ts, itemId)
      .run();
    await c.env.DB.prepare(`UPDATE sales SET updated_at = ? WHERE id = ?`).bind(ts, sale.id).run();

    const fresh = (await c.env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
      .bind(itemId)
      .first<ItemRow>())!;
    return c.json(
      {
        url,
        images,
        item: withItemUrls(c.env, user.username, sale, itemRowToItem(fresh)),
      },
      201,
    );
  },
);

/**
 * POST /sales/:saleId/items/:itemId/images/from-url
 * Body: { url: "https://..." }
 *
 * Server-side fetch: pulls the image bytes, validates mime + magic bytes,
 * stores in R2 with the detected content-type, appends to item.images.
 *
 * Built for MCP clients: Claude can find a product image on the web but
 * can't reliably POST binary bytes back through the tool channel. This
 * route takes the URL, verifies it's safe-ish to fetch, and does the
 * upload on the server's behalf. Tighter rate limit than the regular
 * upload because it makes an outbound HTTP call.
 */
imageRoutes.post(
  '/:saleId/items/:itemId/images/from-url',
  requireScope('write'),
  rateLimit({ name: 'image-from-url', max: 30, windowSeconds: 3600, keyFn: byUser }),
  async (c) => {
    const user = c.get('user');
    const saleId = c.req.param('saleId');
    const itemId = c.req.param('itemId');

    const sale = await c.env.DB.prepare(
      `SELECT * FROM sales WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
      .bind(saleId, user.id)
      .first<SaleRow>();
    if (!sale) return c.json({ error: 'not_found' }, 404);
    const item = await c.env.DB.prepare(`SELECT * FROM items WHERE id = ? AND sale_id = ?`)
      .bind(itemId, sale.id)
      .first<ItemRow>();
    if (!item) return c.json({ error: 'not_found' }, 404);

    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    const rawUrl = typeof body?.url === 'string' ? body.url : null;
    if (!rawUrl) return c.json({ error: 'url_required' }, 400);

    const checked = validateFetchableUrl(rawUrl);
    if (!checked.ok) return c.json({ error: checked.reason }, 400);

    // 10s timeout via AbortController — don't let a stalled origin tie up
    // the Worker's CPU budget.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(checked.url.toString(), {
        signal: ac.signal,
        redirect: 'follow',
        headers: {
          // Some origins 403 without a real-looking UA. A generic browser
          // string is fine; we're not cloaking, just not looking like a bot.
          'User-Agent': 'Mozilla/5.0 (compatible; yrdsl.app/1.0; +https://yrdsl.app/about)',
          Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as { name?: string }).name === 'AbortError';
      return c.json({ error: aborted ? 'fetch_timeout' : 'fetch_failed' }, 502);
    }
    clearTimeout(timer);
    if (!res.ok) {
      return c.json({ error: 'fetch_failed', status: res.status }, 502);
    }

    // Content-Length short-circuit: if the origin reports a size and it
    // exceeds the cap, bail before reading the body.
    const declaredSize = Number(res.headers.get('Content-Length') ?? '0');
    if (Number.isFinite(declaredSize) && declaredSize > FROM_URL_MAX_BYTES) {
      return c.json({ error: 'too_large', max: FROM_URL_MAX_BYTES }, 413);
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength < IMAGE_MIN_BYTES) return c.json({ error: 'too_small' }, 400);
    if (buf.byteLength > FROM_URL_MAX_BYTES) {
      return c.json({ error: 'too_large', max: FROM_URL_MAX_BYTES }, 413);
    }

    // Trust the bytes over the header: sniff the magic. Must match one
    // of our accepted formats AND be consistent with the Content-Type.
    const sniffed = sniffMime(buf);
    const declaredCt = (res.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (!sniffed || !ACCEPTED_MIMES[sniffed]) {
      return c.json({ error: 'unsupported_image_type' }, 400);
    }
    if (declaredCt && declaredCt in ACCEPTED_MIMES && declaredCt !== sniffed) {
      // A header that claims one format while the magic says another is
      // a smell. Trust the magic, but log it (Workers Logs picks this up).
      console.warn('from-url mime mismatch', { declaredCt, sniffed, url: checked.url.toString() });
    }

    const ext = ACCEPTED_MIMES[sniffed];
    const imageId = newId();
    const key = `sales/${sale.id}/items/${itemId}/${imageId}.${ext}`;
    await c.env.R2_IMAGES.put(key, buf, {
      httpMetadata: { contentType: sniffed, cacheControl: 'public, max-age=31536000' },
    });

    const url = `${c.env.IMAGE_BASE_URL ?? c.env.APP_URL}/image/${key}`;
    const existing = item.images ? (JSON.parse(item.images) as string[]) : [];
    const images = [...existing, url];
    const ts = now();
    await c.env.DB.prepare(`UPDATE items SET images = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(images), ts, itemId)
      .run();
    await c.env.DB.prepare(`UPDATE sales SET updated_at = ? WHERE id = ?`).bind(ts, sale.id).run();

    const fresh = (await c.env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
      .bind(itemId)
      .first<ItemRow>())!;
    return c.json(
      {
        url,
        images,
        item: withItemUrls(c.env, user.username, sale, itemRowToItem(fresh)),
      },
      201,
    );
  },
);

// DELETE /sales/:saleId/items/:itemId/images removes an image by its URL.
// Takes `?url=...` query param so we don't have to parse the R2 key out of it server-side.
imageRoutes.delete('/:saleId/items/:itemId/images', requireScope('write'), async (c) => {
  const user = c.get('user');
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'url_required' }, 400);

  const sale = await c.env.DB.prepare(
    `SELECT id FROM sales WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('saleId'), user.id)
    .first<Pick<SaleRow, 'id'>>();
  if (!sale) return c.json({ error: 'not_found' }, 404);
  const item = await c.env.DB.prepare(`SELECT * FROM items WHERE id = ? AND sale_id = ?`)
    .bind(c.req.param('itemId'), sale.id)
    .first<ItemRow>();
  if (!item) return c.json({ error: 'not_found' }, 404);

  const existing = item.images ? (JSON.parse(item.images) as string[]) : [];
  const remaining = existing.filter((u) => u !== url);
  if (remaining.length === existing.length) return c.json({ error: 'not_in_item' }, 404);

  // Parse the R2 key from the URL (only if it belongs to us).
  const prefix = `${c.env.IMAGE_BASE_URL ?? c.env.APP_URL}/image/`;
  if (url.startsWith(prefix)) {
    const key = url.slice(prefix.length);
    await c.env.R2_IMAGES.delete(key);
  }

  const ts = now();
  await c.env.DB.prepare(`UPDATE items SET images = ?, updated_at = ? WHERE id = ?`)
    .bind(remaining.length > 0 ? JSON.stringify(remaining) : null, ts, item.id)
    .run();
  await c.env.DB.prepare(`UPDATE sales SET updated_at = ? WHERE id = ?`).bind(ts, sale.id).run();
  return c.json({ images: remaining });
});
