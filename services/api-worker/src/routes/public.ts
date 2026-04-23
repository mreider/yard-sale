import { Hono } from 'hono';
import type { AppEnv, ItemRow, SaleRow } from '../env.js';
import { byIp, rateLimit } from '../lib/rate-limit.js';
import {
  buildItemPublicUrl,
  buildSalePublicUrl,
  itemRowToItem,
  saleRowToSite,
} from '../lib/sales.js';

/**
 * Unauthenticated routes. These return published sale data for the viewer
 * at yrdsl.app/{user}/{slug}. Deliberately terse — no editing, no auth,
 * no session lookups.
 *
 * The 600/hr/IP limit prevents enumeration scrapes while leaving plenty
 * of room for viral link sharing (a sale that gets a lot of legit
 * traffic from one office building, etc.).
 */
export const publicRoutes = new Hono<AppEnv>();
publicRoutes.use(
  '*',
  rateLimit({ name: 'public-read', max: 600, windowSeconds: 3600, keyFn: byIp }),
);

// ─── GET /public/sales/:user/:slug ────────────────────────────────────────
publicRoutes.get('/sales/:user/:slug', async (c) => {
  const username = c.req.param('user').toLowerCase();
  const slug = c.req.param('slug').toLowerCase();

  const userRow = await c.env.DB.prepare(`SELECT id FROM users WHERE LOWER(username) = ?`)
    .bind(username)
    .first<{ id: string }>();
  if (!userRow) return c.json({ error: 'not_found' }, 404);

  const sale = await c.env.DB.prepare(
    `SELECT * FROM sales WHERE user_id = ? AND slug = ? AND deleted_at IS NULL AND published_at IS NOT NULL`,
  )
    .bind(userRow.id, slug)
    .first<SaleRow>();
  if (!sale) return c.json({ error: 'not_found' }, 404);

  const itemsRes = await c.env.DB.prepare(
    `SELECT * FROM items WHERE sale_id = ? ORDER BY sort_order ASC, added_at DESC`,
  )
    .bind(sale.id)
    .all<ItemRow>();

  // s-maxage=60 lets Cloudflare's edge + the viewer-worker cache the
  // payload; max-age=0 keeps the browser from serving a stale version
  // after the user edits (viewer-worker has its own 60s edge cache so
  // this is belt-and-braces). stale-while-revalidate smooths over the
  // moment after a publish while the cache refills.
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=60');
  const publicUrl = buildSalePublicUrl(c.env, username, sale.slug);
  return c.json({
    site: { ...saleRowToSite(sale), publicUrl },
    items: (itemsRes.results ?? []).map((r) => {
      const item = itemRowToItem(r);
      return { ...item, publicUrl: buildItemPublicUrl(c.env, username, sale.slug, item.id) };
    }),
  });
});

// ─── GET /public/sitemap ──────────────────────────────────────────────────
// Returns every currently-published sale's canonical URL + lastmod.
// Consumed by the viewer-worker's /sitemap.xml renderer.
publicRoutes.get('/sitemap', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.username AS username, s.slug AS slug, s.updated_at AS updated_at
     FROM sales s JOIN users u ON u.id = s.user_id
     WHERE s.published_at IS NOT NULL
       AND s.deleted_at IS NULL
     ORDER BY s.updated_at DESC
     LIMIT 50000`,
  ).all<{ username: string; slug: string; updated_at: number }>();
  c.header('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=300');
  return c.json({
    urls: (rows.results ?? []).map((r) => ({
      loc: `/${r.username.toLowerCase()}/${r.slug}`,
      lastmod: new Date(r.updated_at * 1000).toISOString(),
    })),
  });
});
