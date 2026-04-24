import { z } from 'zod';

/**
 * Canonical public JSON shape for a digital yard sale.
 *
 * **The same two shapes (SaleSite + SaleItem) are used by both distribution
 * modes.** Self-hosted users author them by hand in `site.json` + `items.json`.
 * The hosted api-worker serializes D1 rows into the exact same shapes at
 * `GET /sales/{user}/{slug}` so the viewer renders identically in either
 * mode.
 *
 * Some fields are marked "host-only" in their JSDoc. They're optional and
 * the self-hosted template leaves them out. The hosted API populates them
 * from D1 for lifecycle bookkeeping (slug, publishedAt, etc.). The viewer
 * ignores them during render; they survive a round-trip so export-and-import
 * is lossless.
 *
 * Unit conventions:
 *  - Money: `price` is a plain number in `site.currency`'s smallest display
 *    unit (dollars, euros, etc.). The hosted api-worker divides D1's
 *    `items.price_cents / 100` on serialize.
 *  - Dates: ISO-8601 strings (`"2026-04-17"` for dates, full ISO for
 *    timestamps). The hosted api-worker converts D1's unix integers on
 *    serialize.
 *  - Currency: ISO 4217 code at the site level, not per-item. Mixing
 *    currencies in one sale is not supported.
 */

export const ReservationInfo = z.object({
  /** ISO date (YYYY-MM-DD) the item was reserved. */
  on: z.string(),
  /** Final agreed price (may differ from the listed price). */
  price: z.number(),
  note: z.string().optional(),
});
export type ReservationInfo = z.infer<typeof ReservationInfo>;

export const SaleItem = z.object({
  id: z.string(),
  /** Host-only: URL slug. Self-hosted uses `id` in deep links instead. */
  slug: z.string().optional(),
  title: z.string(),
  price: z.number(),
  tags: z.array(z.string()).default([]),
  /** ISO date (YYYY-MM-DD) added. Used for sort order. */
  added: z.string(),
  /** Optional single image. Either absolute URL or repo-relative path. */
  image: z.string().optional(),
  /** Multiple images. First is the card thumbnail. */
  images: z.array(z.string()).optional(),
  description: z.string().optional(),
  reserved: ReservationInfo.nullable().optional(),
  /** Host-only: manual sort override. */
  sortOrder: z.number().int().optional(),
  /** Host-only: last-edit timestamp (ISO-8601). */
  updatedAt: z.string().optional(),
  /**
   * Host-only: absolute URL where this item is visible to the public.
   * Populated by the hosted API; the self-hosted template leaves it out.
   * Clients (SPA, MCP) should surface it after create/update so users /
   * assistants can share or link to the item without guessing URL shape.
   */
  publicUrl: z.string().optional(),
  /** Host-only: absolute URL where the owner can edit this item. */
  editorUrl: z.string().optional(),
});
export type SaleItem = z.infer<typeof SaleItem>;

export const SaleContact = z.object({
  email: z.string().email().optional(),
  /** Digits only, E.164 without the "+" (e.g. "15125551234"). Drives tel: links. */
  sms: z.string().optional(),
  /** Same format as sms; drives wa.me/<number> links. */
  whatsapp: z.string().optional(),
  /** Host-only: free-form seller note shown near the contact buttons. */
  notes: z.string().optional(),
});
export type SaleContact = z.infer<typeof SaleContact>;

// ─── API request body schemas ────────────────────────────────────────────
// What the client sends over HTTP for CRUD. Distinct from SaleSite/SaleItem
// which are the rendering shape.

export const CreateSaleBody = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  theme: z.enum(['conservative', 'retro', 'hip', 'artsy']).optional(),
  language: z.string().min(2).max(10).optional(),
  currency: z.string().length(3).optional(),
  contact: z
    .object({
      email: z.string().email().optional(),
      sms: z.string().optional(),
      whatsapp: z.string().optional(),
      notes: z.string().max(500).optional(),
    })
    .optional(),
});
export type CreateSaleBody = z.infer<typeof CreateSaleBody>;

export const UpdateSaleBody = CreateSaleBody.partial().extend({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional(),
});
export type UpdateSaleBody = z.infer<typeof UpdateSaleBody>;

export const CreateItemBody = z.object({
  title: z.string().min(1).max(200),
  price: z.number().nonnegative(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  description: z.string().max(4000).optional(),
  image: z.string().max(500).optional(),
  images: z.array(z.string().max(500)).max(10).optional(),
  added: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type CreateItemBody = z.infer<typeof CreateItemBody>;

// POST /sales/:saleId/items/reorder — atomic batch reassignment of
// sort_order. Caller sends the full ordered list; positions in the array
// become the new sort_order (0, 1, 2, …).
export const ReorderItemsBody = z.object({
  ids: z.array(z.string()).min(1).max(500),
});
export type ReorderItemsBody = z.infer<typeof ReorderItemsBody>;

export const UpdateItemBody = CreateItemBody.partial().extend({
  reserved: z
    .union([
      z.null(),
      z.object({
        on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        price: z.number().nonnegative(),
        note: z.string().max(500).optional(),
      }),
    ])
    .optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateItemBody = z.infer<typeof UpdateItemBody>;

// ─── Canonical rendering shapes (what /public/sales/... returns) ─────────

export const SaleSite = z
  .object({
    siteName: z.string(),
    subtitle: z.string().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    contact: SaleContact.optional(),
    /** Theme id from packages/themes. */
    theme: z.enum(['conservative', 'retro', 'hip', 'artsy']).default('conservative'),
    /** ISO 4217. Prices are formatted with this. */
    currency: z.string().length(3).default('USD'),
    /** BCP-47 default locale. Sibling `_xx` keys (e.g. `siteName_de`) override per-locale. */
    language: z.string().default('en'),
    /** Host-only: URL slug (`yrdsl.app/{user}/{slug}`). Self-hosted lives at a repo root. */
    slug: z.string().optional(),
    /** Host-only lifecycle timestamps (ISO-8601). */
    publishedAt: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    /**
     * Host-only: absolute URL where this sale is viewable by the public.
     * Populated by the hosted API when the sale is published. Clients
     * (SPA, MCP) should surface this so users / assistants can share the
     * sale without reconstructing the URL.
     */
    publicUrl: z.string().optional(),
    /** Host-only: absolute URL where the owner can edit this sale. */
    editorUrl: z.string().optional(),
  })
  .passthrough(); // sibling locale keys like `siteName_de` pass through.
export type SaleSite = z.infer<typeof SaleSite>;
