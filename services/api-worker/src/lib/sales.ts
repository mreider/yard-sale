import type { SaleItem, SaleSite } from '@yrdsl/core';
import type { Env, ItemRow, SaleRow } from '../env.js';

/**
 * Build the canonical public URL for a published sale. Callers should
 * only attach this to responses for published sales (the URL works
 * unconditionally, but surfacing it for a draft would mislead clients).
 */
export function buildSalePublicUrl(env: Env, username: string, saleSlug: string): string {
  const base = (env.VIEWER_URL ?? env.APP_URL).replace(/\/$/, '');
  return `${base}/${username.toLowerCase()}/${saleSlug}`;
}

/** Editor deep-link (requires an authenticated session to actually load). */
export function buildSaleEditorUrl(env: Env, saleId: string): string {
  const base = env.APP_URL.replace(/\/$/, '');
  return `${base}/sales/${saleId}/edit`;
}

/**
 * Item public URL is the sale URL with `#<itemId>` — the viewer opens a
 * matching modal when the hash is set. Returns undefined when the sale
 * isn't published yet (no URL to point at).
 */
export function buildItemPublicUrl(
  env: Env,
  username: string,
  saleSlug: string,
  itemId: string,
): string {
  return `${buildSalePublicUrl(env, username, saleSlug)}#${itemId}`;
}

/**
 * Apply `publicUrl` + `editorUrl` to a serialized sale. `publicUrl` is
 * only set when the sale is actually published. Call *after* saleRowToSite.
 */
export function withSaleUrls<T extends { slug?: string; publishedAt?: string }>(
  env: Env,
  username: string,
  saleId: string,
  sale: T,
): T & { publicUrl?: string; editorUrl: string } {
  const out = sale as T & { publicUrl?: string; editorUrl: string };
  out.editorUrl = buildSaleEditorUrl(env, saleId);
  if (sale.slug && sale.publishedAt) {
    out.publicUrl = buildSalePublicUrl(env, username, sale.slug);
  }
  return out;
}

/**
 * Apply `publicUrl` + `editorUrl` to a serialized item. `publicUrl` is
 * only set when the sale is published; `editorUrl` always points at the
 * sale's edit page (there's no per-item editor).
 */
export function withItemUrls<T extends { id: string }>(
  env: Env,
  username: string,
  sale: { id: string; slug: string; published_at: number | null },
  item: T,
): T & { publicUrl?: string; editorUrl: string } {
  const out = item as T & { publicUrl?: string; editorUrl: string };
  out.editorUrl = buildSaleEditorUrl(env, sale.id);
  if (sale.published_at) {
    out.publicUrl = buildItemPublicUrl(env, username, sale.slug, item.id);
  }
  return out;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'untitled'
  );
}

/** Unix seconds → "YYYY-MM-DD" (UTC). */
export function unixToISODate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

/** Unix seconds → full ISO-8601 string. */
export function unixToISO(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

/** "YYYY-MM-DD" → unix seconds (UTC midnight). */
export function isoDateToUnix(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);
}

/**
 * Turn a D1 sales row into the canonical SaleSite JSON shape.
 * Includes the internal id alongside (caller decides whether to expose it).
 */
export function saleRowToSite(row: SaleRow): SaleSite & { id: string } {
  const hasContact = !!(
    row.contact_email ||
    row.contact_sms ||
    row.contact_whatsapp ||
    row.contact_notes
  );
  const contact = hasContact
    ? {
        ...(row.contact_email ? { email: row.contact_email } : {}),
        ...(row.contact_sms ? { sms: row.contact_sms } : {}),
        ...(row.contact_whatsapp ? { whatsapp: row.contact_whatsapp } : {}),
        ...(row.contact_notes ? { notes: row.contact_notes } : {}),
      }
    : undefined;

  const out: SaleSite & { id: string } = {
    id: row.id,
    siteName: row.title,
    theme: row.theme as SaleSite['theme'],
    currency: row.currency,
    language: row.language,
    slug: row.slug,
    createdAt: unixToISO(row.created_at),
    updatedAt: unixToISO(row.updated_at),
  };
  if (row.description) out.description = row.description;
  if (contact) out.contact = contact;
  if (row.published_at) out.publishedAt = unixToISO(row.published_at);
  return out;
}

export function itemRowToItem(row: ItemRow): SaleItem {
  const tags = row.tags ? (JSON.parse(row.tags) as string[]) : [];
  const images = row.images ? (JSON.parse(row.images) as string[]) : undefined;
  const reserved = row.reserved ? JSON.parse(row.reserved) : null;
  const out: SaleItem = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    price: row.price_cents != null ? row.price_cents / 100 : 0,
    tags,
    added: unixToISODate(row.added_at),
    sortOrder: row.sort_order,
    updatedAt: unixToISO(row.updated_at),
  };
  if (images?.length) {
    out.image = images[0];
    out.images = images;
  }
  if (row.description) out.description = row.description;
  if (reserved !== null) out.reserved = reserved;
  else out.reserved = null;
  return out;
}

/**
 * Find a slug unique within one user's sales, starting from `base` and
 * appending -2, -3, etc. until it's free. Pass `excludeId` when checking
 * availability for a sale that already exists (edit case).
 */
export async function uniqueSaleSlug(
  env: Env,
  userId: string,
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = base;
  for (let attempt = 1; attempt <= 100; attempt++) {
    const sql = excludeId
      ? `SELECT 1 FROM sales WHERE user_id = ? AND slug = ? AND id != ?`
      : `SELECT 1 FROM sales WHERE user_id = ? AND slug = ?`;
    const binds = excludeId ? [userId, slug, excludeId] : [userId, slug];
    const taken = await env.DB.prepare(sql)
      .bind(...binds)
      .first();
    if (!taken) return slug;
    slug = `${base}-${attempt + 1}`;
  }
  throw new Error('could not allocate a unique slug');
}

export async function uniqueItemSlug(
  env: Env,
  saleId: string,
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = base;
  for (let attempt = 1; attempt <= 100; attempt++) {
    const sql = excludeId
      ? `SELECT 1 FROM items WHERE sale_id = ? AND slug = ? AND id != ?`
      : `SELECT 1 FROM items WHERE sale_id = ? AND slug = ?`;
    const binds = excludeId ? [saleId, slug, excludeId] : [saleId, slug];
    const taken = await env.DB.prepare(sql)
      .bind(...binds)
      .first();
    if (!taken) return slug;
    slug = `${base}-${attempt + 1}`;
  }
  throw new Error('could not allocate a unique item slug');
}
