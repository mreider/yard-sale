import { zValidator } from '@hono/zod-validator';
import {
  CreateItemBody,
  CreateSaleBody,
  ReorderItemsBody,
  UpdateItemBody,
  UpdateSaleBody,
} from '@yrdsl/core';
import { Hono } from 'hono';
import type { AppEnv, ItemRow, SaleRow } from '../env.js';
import { requireAuth, requireScope } from '../lib/auth.js';
import { buildSaleExportZip } from '../lib/export.js';
import { newId, now } from '../lib/ids.js';
import { byUser, rateLimit } from '../lib/rate-limit.js';
import {
  buildSalePublicUrl,
  isoDateToUnix,
  itemRowToItem,
  saleRowToSite,
  slugify,
  uniqueItemSlug,
  uniqueSaleSlug,
  withItemUrls,
  withSaleUrls,
} from '../lib/sales.js';

export const saleRoutes = new Hono<AppEnv>();
saleRoutes.use('*', requireAuth);

// One generous shared per-user budget for any mutating sales/items
// endpoint. 600/hr is well above interactive editing rates (saving
// every keystroke would still be under) but stops a runaway client or
// abuse loop. Reads are unmetered — they're cheap.
const writeLimit = rateLimit({
  name: 'sales-write',
  max: 600,
  windowSeconds: 3600,
  keyFn: byUser,
});

// Small helper: load a sale by id, scoped to the current user, skipping
// soft-deleted. Returns null if not found or not owned.
async function loadOwnSale(
  c: {
    get: (k: 'user') => { id: string };
    env: AppEnv['Bindings'];
    req: { param: (p: string) => string };
  },
  saleId: string,
): Promise<SaleRow | null> {
  const user = c.get('user');
  return (
    (await c.env.DB.prepare(
      `SELECT * FROM sales WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
      .bind(saleId, user.id)
      .first<SaleRow>()) ?? null
  );
}

// ─── GET /sales ───────────────────────────────────────────────────────────
// List my sales (non-deleted). Returns shallow SaleSite objects; items omitted.
saleRoutes.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM sales WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(user.id)
    .all<SaleRow>();
  return c.json({
    sales: (rows.results ?? []).map((row) =>
      withSaleUrls(c.env, user.username, row.id, saleRowToSite(row)),
    ),
  });
});

// ─── POST /sales ──────────────────────────────────────────────────────────
saleRoutes.post(
  '/',
  writeLimit,
  requireScope('write'),
  zValidator('json', CreateSaleBody),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const id = newId();
    const ts = now();
    const slug = await uniqueSaleSlug(c.env, user.id, slugify(body.title));

    await c.env.DB.prepare(
      `INSERT INTO sales (
        id, user_id, slug, title, description, theme, language, currency,
        contact_email, contact_sms, contact_whatsapp, contact_notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        user.id,
        slug,
        body.title,
        body.description ?? null,
        body.theme ?? user.default_theme,
        body.language ?? user.default_language,
        body.currency ?? 'USD',
        body.contact?.email ?? null,
        body.contact?.sms ?? null,
        body.contact?.whatsapp ?? null,
        body.contact?.notes ?? null,
        ts,
        ts,
      )
      .run();

    const row = (await c.env.DB.prepare(`SELECT * FROM sales WHERE id = ?`)
      .bind(id)
      .first<SaleRow>())!;
    return c.json({ sale: withSaleUrls(c.env, user.username, row.id, saleRowToSite(row)) }, 201);
  },
);

// ─── GET /sales/:id ───────────────────────────────────────────────────────
// Includes the items array, unlike the list endpoint.
saleRoutes.get('/:id', async (c) => {
  const row = await loadOwnSale(c, c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  const user = c.get('user');
  const itemsRes = await c.env.DB.prepare(
    `SELECT * FROM items WHERE sale_id = ? ORDER BY sort_order ASC, added_at DESC`,
  )
    .bind(row.id)
    .all<ItemRow>();
  return c.json({
    sale: withSaleUrls(c.env, user.username, row.id, saleRowToSite(row)),
    items: (itemsRes.results ?? []).map((ir) =>
      withItemUrls(c.env, user.username, row, itemRowToItem(ir)),
    ),
  });
});

// ─── PATCH /sales/:id ─────────────────────────────────────────────────────
saleRoutes.patch(
  '/:id',
  writeLimit,
  requireScope('write'),
  zValidator('json', UpdateSaleBody),
  async (c) => {
    const user = c.get('user');
    const existing = await loadOwnSale(c, c.req.param('id'));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    const body = c.req.valid('json');
    const ts = now();

    const updates: Record<string, string | number | null> = { updated_at: ts };
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description ?? null;
    if (body.theme !== undefined) updates.theme = body.theme;
    if (body.language !== undefined) updates.language = body.language;
    if (body.currency !== undefined) updates.currency = body.currency;
    if (body.contact !== undefined) {
      updates.contact_email = body.contact?.email ?? null;
      updates.contact_sms = body.contact?.sms ?? null;
      updates.contact_whatsapp = body.contact?.whatsapp ?? null;
      updates.contact_notes = body.contact?.notes ?? null;
    }

    // Slug change: verify availability. The old slug goes 404 immediately
    // — no redirect table. Buyers with an old link get a clean "not found"
    // and the seller can share the new URL directly.
    if (body.slug !== undefined && body.slug !== existing.slug) {
      updates.slug = await uniqueSaleSlug(c.env, user.id, slugify(body.slug), existing.id);
    }

    const cols = Object.keys(updates);
    const vals = Object.values(updates);
    await c.env.DB.prepare(
      `UPDATE sales SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    )
      .bind(...vals, existing.id)
      .run();

    const fresh = (await c.env.DB.prepare(`SELECT * FROM sales WHERE id = ?`)
      .bind(existing.id)
      .first<SaleRow>())!;
    return c.json({
      sale: withSaleUrls(c.env, user.username, fresh.id, saleRowToSite(fresh)),
    });
  },
);

// ─── DELETE /sales/:id ────────────────────────────────────────────────────
// Soft delete (sets deleted_at). Data stays in D1 for recovery.
saleRoutes.delete('/:id', writeLimit, requireScope('write'), async (c) => {
  const user = c.get('user');
  const ts = now();
  const res = await c.env.DB.prepare(
    `UPDATE sales SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  )
    .bind(ts, ts, c.req.param('id'), user.id)
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

// ─── POST /sales/:id/publish ──────────────────────────────────────────────
// Preconditions per PRD §6.2 + §6.4: email confirmed, at least one contact method set.
saleRoutes.post('/:id/publish', writeLimit, requireScope('write'), async (c) => {
  const user = c.get('user');
  if (!user.email_confirmed_at) return c.json({ error: 'email_not_confirmed' }, 403);

  const sale = await loadOwnSale(c, c.req.param('id'));
  if (!sale) return c.json({ error: 'not_found' }, 404);
  if (!sale.contact_email && !sale.contact_sms && !sale.contact_whatsapp) {
    return c.json({ error: 'contact_required' }, 400);
  }

  const ts = now();
  await c.env.DB.prepare(`UPDATE sales SET published_at = ?, updated_at = ? WHERE id = ?`)
    .bind(ts, ts, sale.id)
    .run();
  return c.json({
    publishedAt: new Date(ts * 1000).toISOString(),
    publicUrl: buildSalePublicUrl(c.env, user.username, sale.slug),
  });
});

// ─── POST /sales/:id/unpublish ────────────────────────────────────────────
saleRoutes.post('/:id/unpublish', writeLimit, requireScope('write'), async (c) => {
  const user = c.get('user');
  const ts = now();
  const res = await c.env.DB.prepare(
    `UPDATE sales SET published_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  )
    .bind(ts, c.req.param('id'), user.id)
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

// ─── GET /sales/:id/export ────────────────────────────────────────────────
// PRD §6.10: download a ZIP of site.json + items.json + photos that
// drops cleanly into the yrdsl-self-hosted template. Foundational to
// the "no lock-in" promise — pair with DELETE /sales/:id (or
// DELETE /me) for the export-and-delete flow.
//
// Session-only: bearer-token excluded for the same reason as
// DELETE /me — bulk data egress should be a deliberate interactive
// action, not something an MCP integration can accidentally trigger.
saleRoutes.get(
  '/:id/export',
  rateLimit({ name: 'sale-export', max: 30, windowSeconds: 3600, keyFn: byUser }),
  requireScope('write'),
  async (c) => {
    if (c.get('authKind') !== 'session') {
      return c.json({ error: 'session_required' }, 403);
    }
    const sale = await loadOwnSale(c, c.req.param('id'));
    if (!sale) return c.json({ error: 'not_found' }, 404);

    const items = await c.env.DB.prepare(
      `SELECT * FROM items WHERE sale_id = ? ORDER BY sort_order ASC, added_at DESC`,
    )
      .bind(sale.id)
      .all<ItemRow>();
    const user = c.get('user');

    const { bytes, filename } = await buildSaleExportZip(
      c.env,
      sale,
      items.results ?? [],
      user.username,
    );

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  },
);

// ─── Items nested under /sales/:saleId/items ──────────────────────────────

// GET /sales/:saleId/items
saleRoutes.get('/:saleId/items', async (c) => {
  const sale = await loadOwnSale(c, c.req.param('saleId'));
  if (!sale) return c.json({ error: 'not_found' }, 404);
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM items WHERE sale_id = ? ORDER BY sort_order ASC, added_at DESC`,
  )
    .bind(sale.id)
    .all<ItemRow>();
  return c.json({
    items: (rows.results ?? []).map((r) =>
      withItemUrls(c.env, user.username, sale, itemRowToItem(r)),
    ),
  });
});

// POST /sales/:saleId/items
saleRoutes.post(
  '/:saleId/items',
  writeLimit,
  requireScope('write'),
  zValidator('json', CreateItemBody),
  async (c) => {
    const sale = await loadOwnSale(c, c.req.param('saleId'));
    if (!sale) return c.json({ error: 'not_found' }, 404);
    const body = c.req.valid('json');
    const ts = now();
    const itemId = newId();
    const slug = await uniqueItemSlug(c.env, sale.id, slugify(body.title));
    const addedAt = body.added ? isoDateToUnix(body.added) : ts;
    const priceCents = Math.round(body.price * 100);
    const images =
      body.images && body.images.length > 0 ? body.images : body.image ? [body.image] : null;

    await c.env.DB.prepare(
      `INSERT INTO items (
        id, sale_id, slug, title, description, price_cents, tags, images, reserved,
        sort_order, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        itemId,
        sale.id,
        slug,
        body.title,
        body.description ?? null,
        priceCents,
        JSON.stringify(body.tags ?? []),
        images ? JSON.stringify(images) : null,
        null,
        0,
        addedAt,
        ts,
      )
      .run();

    // Bump the sale's updated_at so dashboards pick up the change.
    await c.env.DB.prepare(`UPDATE sales SET updated_at = ? WHERE id = ?`).bind(ts, sale.id).run();

    const row = (await c.env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
      .bind(itemId)
      .first<ItemRow>())!;
    const user = c.get('user');
    return c.json({ item: withItemUrls(c.env, user.username, sale, itemRowToItem(row)) }, 201);
  },
);

// POST /sales/:saleId/items/reorder
// Atomic batch reassignment of sort_order: positions in the `ids` array
// become the new sort_order (0, 1, 2, …). Body must contain *all* of the
// sale's item IDs — partial reorders rejected so the result is fully
// deterministic. Reuses writeLimit (counts the same as a normal edit).
saleRoutes.post(
  '/:saleId/items/reorder',
  writeLimit,
  requireScope('write'),
  zValidator('json', ReorderItemsBody),
  async (c) => {
    const sale = await loadOwnSale(c, c.req.param('saleId'));
    if (!sale) return c.json({ error: 'not_found' }, 404);
    const body = c.req.valid('json');

    // Load every item in this sale and verify the request lists the same
    // set. This catches stale clients (item added/deleted in another tab)
    // and stops a malicious caller from sneaking in another sale's IDs.
    const existing = await c.env.DB.prepare(`SELECT id FROM items WHERE sale_id = ?`)
      .bind(sale.id)
      .all<{ id: string }>();
    const existingIds = new Set((existing.results ?? []).map((r) => r.id));
    if (existingIds.size !== body.ids.length) {
      return c.json({ error: 'item_set_mismatch', expected: existingIds.size }, 409);
    }
    for (const id of body.ids) {
      if (!existingIds.has(id)) return c.json({ error: 'unknown_item', id }, 409);
    }

    const ts = now();
    // D1 batch is atomic — either all sort_order updates land or none do.
    const stmts = body.ids.map((id, idx) =>
      c.env.DB.prepare(`UPDATE items SET sort_order = ?, updated_at = ? WHERE id = ?`).bind(
        idx,
        ts,
        id,
      ),
    );
    stmts.push(c.env.DB.prepare(`UPDATE sales SET updated_at = ? WHERE id = ?`).bind(ts, sale.id));
    await c.env.DB.batch(stmts);

    return c.body(null, 204);
  },
);

// PATCH /sales/:saleId/items/:itemId
saleRoutes.patch(
  '/:saleId/items/:itemId',
  writeLimit,
  requireScope('write'),
  zValidator('json', UpdateItemBody),
  async (c) => {
    const sale = await loadOwnSale(c, c.req.param('saleId'));
    if (!sale) return c.json({ error: 'not_found' }, 404);
    const itemId = c.req.param('itemId');
    const existing = await c.env.DB.prepare(`SELECT * FROM items WHERE id = ? AND sale_id = ?`)
      .bind(itemId, sale.id)
      .first<ItemRow>();
    if (!existing) return c.json({ error: 'not_found' }, 404);

    const body = c.req.valid('json');
    const ts = now();
    const updates: Record<string, string | number | null> = { updated_at: ts };
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description ?? null;
    if (body.price !== undefined) updates.price_cents = Math.round(body.price * 100);
    if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);
    if (body.images !== undefined) {
      updates.images = body.images.length > 0 ? JSON.stringify(body.images) : null;
    } else if (body.image !== undefined) {
      updates.images = JSON.stringify([body.image]);
    }
    if (body.added !== undefined) updates.added_at = isoDateToUnix(body.added);
    if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;
    if (body.reserved !== undefined) {
      updates.reserved = body.reserved === null ? null : JSON.stringify(body.reserved);
    }

    const cols = Object.keys(updates);
    const vals = Object.values(updates);
    await c.env.DB.prepare(
      `UPDATE items SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    )
      .bind(...vals, itemId)
      .run();
    await c.env.DB.prepare(`UPDATE sales SET updated_at = ? WHERE id = ?`).bind(ts, sale.id).run();

    const fresh = (await c.env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
      .bind(itemId)
      .first<ItemRow>())!;
    const user = c.get('user');
    return c.json({
      item: withItemUrls(c.env, user.username, sale, itemRowToItem(fresh)),
    });
  },
);

// DELETE /sales/:saleId/items/:itemId (hard delete)
saleRoutes.delete('/:saleId/items/:itemId', writeLimit, requireScope('write'), async (c) => {
  const sale = await loadOwnSale(c, c.req.param('saleId'));
  if (!sale) return c.json({ error: 'not_found' }, 404);
  const res = await c.env.DB.prepare(`DELETE FROM items WHERE id = ? AND sale_id = ?`)
    .bind(c.req.param('itemId'), sale.id)
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE sales SET updated_at = ? WHERE id = ?`).bind(now(), sale.id).run();
  return c.body(null, 204);
});
