/**
 * Backend interface for the unified yrdsl MCP.
 *
 * Hosted mode is account-scoped: one token connects to all your sales.
 * Sale-scoped tools take an optional `sale` argument (slug or id) to
 * pick which sale to operate on; when omitted and the user has exactly
 * one sale, that sale is used implicitly.
 *
 * Local mode is inherently single-sale — the repo directory IS the
 * sale. The `sale` argument is accepted for schema parity with hosted
 * but ignored.
 *
 * Mode-specific operations (publish/unpublish for hosted, commit/push
 * for local) surface as MCP tools that error nicely when called on the
 * wrong backend.
 */

export interface SaleContact {
  email?: string;
  sms?: string;
  whatsapp?: string;
  notes?: string;
}

export interface ReservationInfo {
  on: string;
  price: number;
  note?: string;
}

export interface SaleItem {
  id: string;
  slug?: string;
  title: string;
  price: number;
  tags: string[];
  added: string;
  image?: string;
  images?: string[];
  description?: string;
  reserved?: ReservationInfo | null;
  sortOrder?: number;
  updatedAt?: string;
  /**
   * Populated by the hosted API when the parent sale is published.
   * Assistants should surface this back to the user after any write
   * (add_item / update_item / mark_reserved) so they get a shareable
   * link without guessing URL shape.
   */
  publicUrl?: string;
  /** Absolute URL of the sale's edit page (there's no per-item editor). */
  editorUrl?: string;
}

export interface SaleSite {
  siteName: string;
  subtitle?: string;
  location?: string;
  description?: string;
  theme: 'conservative' | 'retro' | 'hip' | 'artsy';
  currency: string;
  language: string;
  contact?: SaleContact;
  publishedAt?: string;
  /** Populated when the sale is published. Shareable public URL. */
  publicUrl?: string;
  /** Absolute URL of the edit page (requires auth to actually load). */
  editorUrl?: string;
  // Allow arbitrary locale sibling keys.
  [k: string]: unknown;
}

export interface AddItemInput {
  title: string;
  price: number;
  tags?: string[];
  description?: string;
  image?: string;
}

export interface UpdateItemInput {
  title?: string;
  price?: number;
  tags?: string[];
  description?: string;
  image?: string;
  added?: string;
}

export interface MarkReservedInput {
  on?: string;
  price?: number;
  note?: string;
}

export interface UpdateSiteInput {
  siteName?: string;
  subtitle?: string;
  location?: string;
  description?: string;
  theme?: 'conservative' | 'retro' | 'hip' | 'artsy';
  currency?: string;
  language?: string;
  contact?: SaleContact;
}

export interface CreateSaleInput {
  title: string;
  description?: string;
  theme?: 'conservative' | 'retro' | 'hip' | 'artsy';
  language?: string;
  /** ISO 4217 currency code. Defaults to USD server-side if omitted. */
  currency?: string;
  contact?: SaleContact;
}

export interface SaleSummary {
  id: string;
  slug: string;
  siteName: string;
  publishedAt?: string;
  /** Set when the sale is published. Use this to surface a shareable link. */
  publicUrl?: string;
  /** Absolute URL of the sale's edit page. */
  editorUrl?: string;
}

export interface Backend {
  readonly mode: 'local' | 'hosted';

  /** List sales the caller can see. Local mode returns a single
   * synthesized entry (the repo is the sale). */
  listSales(): Promise<SaleSummary[]>;

  /** Create a new sale. Hosted-only; local throws (the repo IS the sale). */
  createSale(input: CreateSaleInput): Promise<SaleSummary>;

  // Read. `sale` is an optional slug or id; see module doc.
  getSite(sale?: string): Promise<SaleSite>;
  listItems(sale?: string): Promise<SaleItem[]>;
  getItem(id: string, sale?: string): Promise<SaleItem>;

  // Write (always supported)
  updateSite(patch: UpdateSiteInput, sale?: string): Promise<SaleSite>;
  addItem(input: AddItemInput, sale?: string): Promise<SaleItem>;
  updateItem(id: string, patch: UpdateItemInput, sale?: string): Promise<SaleItem>;
  deleteItem(id: string, sale?: string): Promise<void>;
  markReserved(id: string, info: MarkReservedInput, sale?: string): Promise<SaleItem>;
  unreserve(id: string, sale?: string): Promise<SaleItem>;
  /**
   * Attach an image by URL. Server-side fetches the bytes, validates
   * mime + size, stores, and appends to the item's `images` array.
   * Returns the updated item with the new `images` list (latest URL
   * is last in the array).
   */
  attachImageFromUrl(id: string, url: string, sale?: string): Promise<SaleItem>;

  /**
   * Attach an image by raw bytes. `data` accepts either a `data:image/...;base64,...`
   * dataURL or a bare base64-encoded string; `mime` is required when
   * bare base64 is passed (we need a Content-Type for the upload). For
   * assistants who have an image in-context but no URL to point at.
   */
  attachImageBytes(
    id: string,
    data: string,
    opts: { mime?: string },
    sale?: string,
  ): Promise<SaleItem>;

  /**
   * Attach an image by local filesystem path. Reads the file from the
   * machine running this MCP process — Claude Code on the user's
   * machine, or anywhere else the MCP child has direct filesystem
   * access. Does NOT work with Claude.ai sandbox paths like
   * /mnt/user-data/uploads/… (those live in the client's sandbox,
   * not on the MCP host).
   *
   * This is the recommended path-heavy flow: Claude Code can read the
   * user's local file, hand us the path, and we re-read it server-side
   * — avoiding the multi-MB tool-arg base64 cost.
   */
  attachImageFromPath(id: string, path: string, sale?: string): Promise<SaleItem>;

  /**
   * Remove an image from an item's `images` array and delete the backing
   * R2 object (hosted) / file (local). Takes the full image URL — find
   * it via `get_item` or `list_items`.
   */
  deleteImage(id: string, imageUrl: string, sale?: string): Promise<SaleItem>;

  /**
   * Promote an existing image to cover (position 0). Non-destructive:
   * the full `images` array is preserved, just reordered. The target
   * URL must already be on the item.
   */
  setCover(id: string, imageUrl: string, sale?: string): Promise<SaleItem>;

  // Mode-specific. Throw with a clear message if not applicable.
  publish(sale?: string): Promise<{ publishedAt: string; publicUrl?: string }>;
  unpublish(sale?: string): Promise<void>;
  commitAndPush(message?: string): Promise<{ pushed: boolean; note?: string }>;
}
