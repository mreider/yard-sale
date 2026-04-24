import { existsSync, readFileSync, statSync } from 'node:fs';
import { normalizeImage } from './image-normalize.js';
import type {
  AddItemInput,
  Backend,
  CreateSaleInput,
  MarkReservedInput,
  SaleItem,
  SaleSite,
  SaleSummary,
  UpdateItemInput,
  UpdateSiteInput,
} from './types.js';

interface HostedConfig {
  /** Base URL of the api-worker, e.g. "https://api.yrdsl.app". */
  apiUrl: string;
  /** Bearer token (yrs_live_…). Created at /connect in the SPA. */
  token: string;
}

interface ApiSale {
  id: string;
  slug: string;
  siteName: string;
  publishedAt?: string;
  publicUrl?: string;
  editorUrl?: string;
}

/**
 * Hosted backend: account-scoped. Every tool call resolves an optional
 * `sale` argument (slug or id) to a concrete sale id. When the caller
 * omits it and the user has exactly one sale, that sale is used
 * implicitly; otherwise the user is asked to disambiguate.
 */
export class HostedApiBackend implements Backend {
  readonly mode = 'hosted';

  // Cache the sale list for a single tool invocation's lifetime. MCP
  // servers are short-lived per client connection, so this mostly just
  // avoids hitting the API twice in one chain of tool calls.
  private salesCache: { at: number; sales: ApiSale[] } | null = null;
  private static readonly CACHE_TTL_MS = 5_000;

  constructor(private readonly cfg: HostedConfig) {}

  async listSales(): Promise<SaleSummary[]> {
    const sales = await this.loadSales();
    return sales.map((s) => ({
      id: s.id,
      slug: s.slug,
      siteName: s.siteName,
      ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
      ...(s.publicUrl ? { publicUrl: s.publicUrl } : {}),
      ...(s.editorUrl ? { editorUrl: s.editorUrl } : {}),
    }));
  }

  async createSale(input: CreateSaleInput): Promise<SaleSummary> {
    const body: Record<string, unknown> = { title: input.title };
    if (input.description !== undefined) body.description = input.description;
    if (input.theme !== undefined) body.theme = input.theme;
    if (input.language !== undefined) body.language = input.language;
    if (input.currency !== undefined) body.currency = input.currency;
    if (input.contact !== undefined) body.contact = input.contact;
    const { sale } = await this.fetch<{
      sale: SaleSite & { id: string; slug: string; editorUrl?: string; publicUrl?: string };
    }>(`/sales`, { method: 'POST', body });
    this.salesCache = null;
    return {
      id: sale.id,
      slug: sale.slug,
      siteName: sale.siteName,
      ...(sale.publishedAt ? { publishedAt: sale.publishedAt } : {}),
      ...(sale.publicUrl ? { publicUrl: sale.publicUrl } : {}),
      ...(sale.editorUrl ? { editorUrl: sale.editorUrl } : {}),
    };
  }

  // ─── Read ──────────────────────────────────────────────────────────────
  async getSite(sale?: string): Promise<SaleSite> {
    const id = await this.resolveSale(sale);
    const { sale: s } = await this.fetch<{ sale: SaleSite & { id: string } }>(`/sales/${id}`);
    return s;
  }
  async listItems(sale?: string): Promise<SaleItem[]> {
    const id = await this.resolveSale(sale);
    const { items } = await this.fetch<{ items: SaleItem[] }>(`/sales/${id}/items`);
    return items;
  }
  async getItem(itemId: string, sale?: string): Promise<SaleItem> {
    const items = await this.listItems(sale);
    const found = items.find((i) => i.id === itemId);
    if (!found) throw new Error(`No item with id "${itemId}".`);
    return found;
  }

  // ─── Write ─────────────────────────────────────────────────────────────
  async updateSite(patch: UpdateSiteInput, sale?: string): Promise<SaleSite> {
    const id = await this.resolveSale(sale);
    const body: Record<string, unknown> = {};
    if (patch.siteName !== undefined) body.siteName = patch.siteName;
    if (patch.subtitle !== undefined) body.subtitle = patch.subtitle;
    if (patch.location !== undefined) body.location = patch.location;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.theme !== undefined) body.theme = patch.theme;
    if (patch.currency !== undefined) body.currency = patch.currency;
    if (patch.language !== undefined) body.language = patch.language;
    if (patch.contact !== undefined) body.contact = patch.contact;
    const { sale: s } = await this.fetch<{ sale: SaleSite }>(`/sales/${id}`, {
      method: 'PATCH',
      body,
    });
    this.salesCache = null;
    return s;
  }

  async addItem(input: AddItemInput, sale?: string): Promise<SaleItem> {
    const id = await this.resolveSale(sale);
    const { item } = await this.fetch<{ item: SaleItem }>(`/sales/${id}/items`, {
      method: 'POST',
      body: input,
    });
    return item;
  }

  async updateItem(itemId: string, patch: UpdateItemInput, sale?: string): Promise<SaleItem> {
    const id = await this.resolveSale(sale);
    const { item } = await this.fetch<{ item: SaleItem }>(`/sales/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: patch,
    });
    return item;
  }

  async deleteItem(itemId: string, sale?: string): Promise<void> {
    const id = await this.resolveSale(sale);
    await this.fetch(`/sales/${id}/items/${itemId}`, { method: 'DELETE' });
  }

  async markReserved(itemId: string, info: MarkReservedInput, sale?: string): Promise<SaleItem> {
    const id = await this.resolveSale(sale);
    const reserved = {
      on: info.on ?? new Date().toISOString().slice(0, 10),
      price: info.price ?? (await this.getItem(itemId, sale)).price,
      ...(info.note ? { note: info.note } : {}),
    };
    const { item } = await this.fetch<{ item: SaleItem }>(`/sales/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: { reserved },
    });
    return item;
  }

  async unreserve(itemId: string, sale?: string): Promise<SaleItem> {
    const id = await this.resolveSale(sale);
    const { item } = await this.fetch<{ item: SaleItem }>(`/sales/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: { reserved: null },
    });
    return item;
  }

  async attachImageFromUrl(itemId: string, url: string, sale?: string): Promise<SaleItem> {
    const id = await this.resolveSale(sale);
    const { item } = await this.fetch<{ item: SaleItem }>(
      `/sales/${id}/items/${itemId}/images/from-url`,
      { method: 'POST', body: { url } },
    );
    return item;
  }

  async attachImageBytes(
    itemId: string,
    data: string,
    opts: { mime?: string },
    sale?: string,
  ): Promise<SaleItem> {
    log(
      `attach_image_bytes start: item=${itemId} sale=${sale ?? '(implicit)'} payload=${data.length} chars`,
    );
    const t0 = Date.now();
    const id = await this.resolveSale(sale);
    const { bytes: rawBytes, mime: rawMime } = decodeImageData(data, opts.mime);
    const { bytes, mime } = await normalizeImage(rawBytes, rawMime);
    log(`POST /images/bytes (${bytes.byteLength} bytes, ${mime})`);
    const { item } = await this.fetchRaw<{ item: SaleItem }>(
      `/sales/${id}/items/${itemId}/images/bytes`,
      { method: 'POST', body: bytes, contentType: mime },
    );
    log(`attach_image_bytes ok in ${Date.now() - t0}ms`);
    return item;
  }

  async attachImageFromPath(itemId: string, path: string, sale?: string): Promise<SaleItem> {
    log(`attach_image_from_path start: item=${itemId} path=${path}`);
    const t0 = Date.now();
    const id = await this.resolveSale(sale);
    const { bytes: rawBytes, mime: rawMime } = readLocalImage(path);
    log(`read ${rawBytes.byteLength} bytes from ${path} (${rawMime})`);
    const { bytes, mime } = await normalizeImage(rawBytes, rawMime);
    const { item } = await this.fetchRaw<{ item: SaleItem }>(
      `/sales/${id}/items/${itemId}/images/bytes`,
      { method: 'POST', body: bytes, contentType: mime },
    );
    log(`attach_image_from_path ok in ${Date.now() - t0}ms`);
    return item;
  }

  async deleteImage(itemId: string, imageUrl: string, sale?: string): Promise<SaleItem> {
    const id = await this.resolveSale(sale);
    const path = `/sales/${id}/items/${itemId}/images?url=${encodeURIComponent(imageUrl)}`;
    await this.fetch(path, { method: 'DELETE' });
    return this.getItem(itemId, sale);
  }

  async setCover(itemId: string, imageUrl: string, sale?: string): Promise<SaleItem> {
    const id = await this.resolveSale(sale);
    const current = await this.getItem(itemId, sale);
    const existing = current.images ?? (current.image ? [current.image] : []);
    if (!existing.includes(imageUrl)) {
      throw new Error(
        `Image "${imageUrl}" is not on item "${itemId}". Attach it first, or pass a URL that's already in item.images.`,
      );
    }
    if (existing[0] === imageUrl) return current;
    const reordered = [imageUrl, ...existing.filter((u) => u !== imageUrl)];
    const { item } = await this.fetch<{ item: SaleItem }>(`/sales/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: { images: reordered },
    });
    return item;
  }

  // ─── Mode-specific ─────────────────────────────────────────────────────
  async publish(sale?: string): Promise<{ publishedAt: string; publicUrl?: string }> {
    const id = await this.resolveSale(sale);
    const r = await this.fetch<{ publishedAt: string; publicUrl?: string }>(
      `/sales/${id}/publish`,
      { method: 'POST' },
    );
    this.salesCache = null;
    return r;
  }
  async unpublish(sale?: string): Promise<void> {
    const id = await this.resolveSale(sale);
    await this.fetch(`/sales/${id}/unpublish`, { method: 'POST' });
    this.salesCache = null;
  }
  async commitAndPush(): Promise<{ pushed: boolean; note?: string }> {
    return {
      pushed: false,
      note: 'Hosted sales save automatically; no commit/push step. Use publish to make changes go live.',
    };
  }

  // ─── Sale resolution ───────────────────────────────────────────────────
  /**
   * Resolve an optional slug-or-id reference into a concrete sale id.
   * - ref matches a sale by id or slug → return that id.
   * - ref not given, exactly 1 sale → use it implicitly.
   * - ref not given, 0 sales → error pointing to the SPA.
   * - ref not given, 2+ sales → error listing slugs.
   * - ref given but no match → error listing slugs.
   */
  private async resolveSale(ref?: string): Promise<string> {
    const sales = await this.loadSales();
    if (ref) {
      const match = sales.find((s) => s.id === ref || s.slug === ref);
      if (match) return match.id;
      const available = sales.map((s) => s.slug).join(', ') || '(none)';
      throw new Error(`No sale matching "${ref}". Available slugs: ${available}`);
    }
    if (sales.length === 0) {
      throw new Error(
        'You have no sales. Create one at https://app.yrdsl.app/sales, then try again.',
      );
    }
    if (sales.length === 1) return (sales[0] as ApiSale).id;
    const slugs = sales.map((s) => s.slug).join(', ');
    throw new Error(
      `You have ${sales.length} sales; pass \`sale\` with one of: ${slugs}. Call list_sales for full details.`,
    );
  }

  private async loadSales(): Promise<ApiSale[]> {
    const now = Date.now();
    if (this.salesCache && now - this.salesCache.at < HostedApiBackend.CACHE_TTL_MS) {
      return this.salesCache.sales;
    }
    const { sales } = await this.fetch<{ sales: ApiSale[] }>(`/sales`);
    this.salesCache = { at: now, sales };
    return sales;
  }

  // ─── Plumbing ──────────────────────────────────────────────────────────
  private async fetch<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.token}`,
    };
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${this.cfg.apiUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 120)}`);
    }
    if (!res.ok) {
      const code = (data as { error?: string }).error ?? `http_${res.status}`;
      throw new Error(`${path}: ${code}`);
    }
    return data as T;
  }

  /**
   * Sibling of `fetch` for endpoints that take raw bytes (image uploads).
   * Skips the JSON stringify/parse dance on the request side; response is
   * still parsed as JSON. 30s timeout via AbortController so a silent
   * network stall surfaces as a clear error rather than an infinite spin.
   */
  private async fetchRaw<T = unknown>(
    path: string,
    init: { method: string; body: Uint8Array; contentType: string },
  ): Promise<T> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    let res: Response;
    try {
      const t0 = Date.now();
      res = await fetch(`${this.cfg.apiUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          'Content-Type': init.contentType,
        },
        body: init.body,
        signal: ac.signal,
      });
      log(`fetchRaw ${path} → ${res.status} (${Date.now() - t0}ms)`);
    } catch (e) {
      const aborted = (e as { name?: string }).name === 'AbortError';
      throw new Error(
        aborted
          ? `${path}: timed out after 30s. Image probably too large or network stalled.`
          : `${path}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 120)}`);
    }
    if (!res.ok) {
      const code = (data as { error?: string }).error ?? `http_${res.status}`;
      throw new Error(`${path}: ${code}`);
    }
    return data as T;
  }
}

/**
 * Accept a `data:image/...;base64,...` dataURL, a bare base64 string
 * (mime must be provided alongside), or a raw-ish string that might be
 * padded/unpadded. Normalizes to `{ bytes, mime }` for upload.
 *
 * Kept outside the class so local.ts can reuse it without inheritance.
 *
 * Returns a `Buffer` typed as `Uint8Array`. Buffer extends Uint8Array
 * in Node, and fetch() accepts either — no extra copy needed.
 */
export function decodeImageData(
  data: string,
  explicitMime?: string,
): { bytes: Uint8Array; mime: string } {
  // Fail fast on common misuses. These errors tell the assistant
  // *exactly* what to do differently — a generic "too_small / bad
  // base64" leads to give-up behavior in practice (observed in real
  // MCP logs with 0.4.1).
  rejectIfNotActualBytes(data);

  let mime = explicitMime;
  let b64 = data;

  const dataUrlMatch = data.match(/^data:([^;,]+)(?:;base64)?,(.+)$/);
  if (dataUrlMatch) {
    mime = (mime ?? dataUrlMatch[1])?.toLowerCase();
    b64 = dataUrlMatch[2] ?? '';
  }
  if (!mime) {
    throw new Error(
      'attach_image_bytes: pass a dataURL (data:image/png;base64,...) or set `mime` ' +
        'alongside a bare base64 string.',
    );
  }
  const canonicalMime = mime === 'image/jpg' ? 'image/jpeg' : mime;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(canonicalMime)) {
    throw new Error(
      `attach_image_bytes: unsupported mime "${canonicalMime}". Accepted: jpeg, png, webp.`,
    );
  }

  const decodeStart = Date.now();
  // Buffer IS a Uint8Array subclass in Node. Avoid `Uint8Array.from(buf)` —
  // that'd copy the whole buffer byte-by-byte for no reason.
  const bytes = Buffer.from(b64.trim(), 'base64');
  log(
    `decoded ${b64.length} base64 chars → ${bytes.byteLength} bytes (${Date.now() - decodeStart}ms)`,
  );
  if (bytes.byteLength === 0) {
    throw new Error(
      'attach_image_bytes: decoded payload is empty. `data` must be the ' +
        'base64-encoded image bytes, not a path or placeholder.',
    );
  }
  // Further byte-size sanity checks happen server-side (magic-byte sniff
  // + 200-byte floor). Those return a clear `decoded_too_small` or
  // `invalid_image_bytes` error with actionable hints. Client-side we
  // stick to structural checks (path/URL detection above) so legitimate
  // tiny test images aren't false-rejected.
  return { bytes, mime: canonicalMime };
}

/**
 * Claude frequently tries to pass an environment-visible filesystem
 * path (e.g. "/mnt/user-data/uploads/foo.jpeg") directly to this tool.
 * Those paths live in Claude's sandbox, not on the user's machine where
 * the MCP child process runs — even if we accepted them, we couldn't
 * read them. And the decoder treats them as (garbage) bare base64,
 * producing a few bytes of nonsense that the server rejects as
 * "too_small" — cryptic enough to make Claude give up rather than
 * retry correctly. Catch this here with an actionable message.
 */
function rejectIfNotActualBytes(data: string): void {
  const first = data.trim().slice(0, 120);
  if (first.startsWith('data:')) return; // legitimate dataURL

  if (first.startsWith('http://') || first.startsWith('https://')) {
    throw new Error(
      `attach_image_bytes: got a URL ("${first}"). Use \`attach_image_from_url\` for ` +
        'public image URLs — that tool fetches and stores the bytes server-side. ' +
        '`attach_image_bytes` expects the actual base64-encoded file contents.',
    );
  }
  if (first.startsWith('file://')) {
    throw new Error(
      `attach_image_bytes: got a file:// URL ("${first}"). ` +
        "This tool needs the file's actual base64-encoded contents, not a path. " +
        'Read the file first, base64-encode the bytes, then pass them as `data`.',
    );
  }

  const pathLike =
    first.startsWith('/') ||
    first.startsWith('./') ||
    first.startsWith('../') ||
    first.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(first); // Windows drive letter

  const imageExtTail = /\.(jpe?g|png|webp|heic|gif|tiff?|bmp|svg)(\?.*)?$/i.test(first);

  if (pathLike || (imageExtTail && first.includes('/'))) {
    throw new Error(
      `attach_image_bytes: got what looks like a file path ("${first}"). ` +
        "This tool needs the file's actual base64-encoded contents, not a path. " +
        'Read the file (it lives in your environment, not on the user machine), ' +
        'then pass its bytes base64-encoded as `data` — ideally as a dataURL ' +
        "(e.g. 'data:image/jpeg;base64,<long base64 string>').",
    );
  }
}

/** Structured stderr log. Visible in Claude Desktop's MCP logs
 * (~/Library/Logs/Claude/mcp-server-yrdsl.log on macOS). */
function log(msg: string): void {
  process.stderr.write(`yrdsl-mcp: ${msg}\n`);
}

const LOCAL_PATH_MAX_BYTES = 10 * 1024 * 1024; // 10 MB ceiling for local reads

/**
 * Read an image from the local filesystem, sniff its mime. Used by
 * attach_image_from_path so the MCP does the read instead of routing
 * millions of base64 chars through tool args.
 *
 * Hard-fails with a directive error when:
 * - The path looks like a Claude.ai sandbox path (`/mnt/user-data/...`)
 *   — those don't exist on the MCP host.
 * - The path doesn't exist.
 * - The bytes don't match JPEG/PNG/WebP magic.
 *
 * The error text names the two working alternatives so the assistant
 * (and the user) know where to go next.
 */
export function readLocalImage(path: string): { bytes: Uint8Array; mime: string } {
  // Reject claude.ai sandbox paths up front — these are common when
  // users try to use attach_image_from_path from Claude.ai web. They
  // won't exist on the MCP host, so fs.readFileSync would throw a
  // cryptic ENOENT.
  if (path.startsWith('/mnt/user-data/') || path.startsWith('/mnt/skills/')) {
    throw new Error(buildSandboxPathError(path));
  }

  if (!existsSync(path)) {
    throw new Error(buildPathNotFoundError(path));
  }
  const stats = statSync(path);
  if (!stats.isFile()) {
    throw new Error(`attach_image_from_path: "${path}" is not a file (is it a directory?).`);
  }
  if (stats.size > LOCAL_PATH_MAX_BYTES) {
    throw new Error(
      `attach_image_from_path: "${path}" is ${stats.size} bytes, ` +
        `over the ${LOCAL_PATH_MAX_BYTES}-byte cap. Resize or compress first.`,
    );
  }

  const buf = readFileSync(path);
  // sniffMime-equivalent: check magic bytes. We're duplicating the server
  // logic here (the server does it too) so we can error clearly BEFORE
  // the upload round-trip.
  const mime = detectImageMime(buf);
  if (!mime) {
    throw new Error(
      `attach_image_from_path: "${path}" isn't a JPEG, PNG, or WebP ` +
        '(based on magic bytes). Pass an actual image file.',
    );
  }
  return { bytes: buf, mime };
}

function detectImageMime(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function buildSandboxPathError(path: string): string {
  return (
    `attach_image_from_path: "${path}" is a Claude sandbox path — ` +
    'it only exists inside your client environment, not on the machine ' +
    'running this MCP. Two things that DO work:\n\n' +
    '1. If the user is on **Claude Code**, ask them to switch to it — ' +
    "Claude Code shares the user's filesystem with the MCP, so path-based " +
    'attaches work end-to-end.\n\n' +
    '2. Tell the user to open the web editor and drop the photo in directly: ' +
    'the `editorUrl` returned by `list_sales`/`add_item` has a photo grid ' +
    "that accepts any image format. This is the fastest path from the user's " +
    'perspective.'
  );
}

function buildPathNotFoundError(path: string): string {
  return (
    `attach_image_from_path: "${path}" doesn't exist on disk from where this ` +
    'MCP is running. This tool needs a real filesystem path accessible to the ' +
    "MCP process — typically Claude Code usage against a path in the user's " +
    'working directory. If the path is from a Claude.ai chat attachment, use ' +
    'the web editor instead (see the `editorUrl` on the item).'
  );
}
