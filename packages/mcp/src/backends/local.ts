import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { decodeImageData } from './hosted.js';
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

/** Local self-hosted backend: edits site.json + items.json in a repo dir.
 * The repo IS the sale, so the optional `sale` argument accepted by the
 * shared Backend interface is ignored here. */
export class LocalFileBackend implements Backend {
  readonly mode = 'local';
  private readonly sitePath: string;
  private readonly itemsPath: string;

  constructor(private readonly repoDir: string) {
    this.sitePath = join(repoDir, 'site.json');
    this.itemsPath = join(repoDir, 'items.json');
    if (!existsSync(this.sitePath) || !existsSync(this.itemsPath)) {
      throw new Error(`LocalFileBackend: site.json or items.json not found in ${repoDir}.`);
    }
  }

  async createSale(_input: CreateSaleInput): Promise<SaleSummary> {
    throw new Error(
      'Self-hosted mode: the repo IS the sale — create a new repo from the template ' +
        'at https://github.com/KuvopLLC/yrdsl-self-hosted instead of calling create_sale.',
    );
  }

  async listSales(): Promise<SaleSummary[]> {
    const site = await this.getSite();
    const slug = basename(this.repoDir);
    const publicUrl = this.siteUrl(site);
    return [
      {
        id: slug,
        slug,
        siteName: site.siteName,
        ...(publicUrl ? { publicUrl } : {}),
      },
    ];
  }

  // ─── Read ──────────────────────────────────────────────────────────────
  async getSite(_sale?: string): Promise<SaleSite> {
    const site = this.readJson<SaleSite>(this.sitePath);
    const publicUrl = this.siteUrl(site);
    return publicUrl ? { ...site, publicUrl } : site;
  }
  async listItems(_sale?: string): Promise<SaleItem[]> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const site = this.readJson<SaleSite>(this.sitePath);
    const publicUrl = this.siteUrl(site);
    if (!publicUrl) return items;
    return items.map((i) => ({ ...i, publicUrl: `${publicUrl}#${i.id}` }));
  }
  async getItem(id: string, _sale?: string): Promise<SaleItem> {
    const items = await this.listItems();
    const found = items.find((i) => i.id === id);
    if (!found) throw new Error(`No item with id "${id}".`);
    return found;
  }

  /**
   * Self-hosted public URL. Read from `site.url` in site.json (set by
   * the user once, e.g. `https://username.github.io/yrdsl-example`). Env
   * var `YRDSL_SITE_URL` overrides for cases where the deploy URL isn't
   * stored in the repo. Returns undefined when neither is set — callers
   * should omit the `publicUrl` field rather than emit a bogus link.
   */
  private siteUrl(site: SaleSite): string | undefined {
    const fromEnv = process.env.YRDSL_SITE_URL?.trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    const fromFile = (site as { url?: unknown }).url;
    return typeof fromFile === 'string' && fromFile.trim()
      ? fromFile.trim().replace(/\/$/, '')
      : undefined;
  }

  // ─── Write ─────────────────────────────────────────────────────────────
  async updateSite(patch: UpdateSiteInput, _sale?: string): Promise<SaleSite> {
    const site = await this.getSite();
    const { contact, ...rest } = patch;
    const next: SaleSite = { ...site, ...rest } as SaleSite;
    if (contact) next.contact = { ...(site.contact ?? {}), ...contact };
    this.writeJson(this.sitePath, next);
    return next;
  }

  async addItem(input: AddItemInput, _sale?: string): Promise<SaleItem> {
    // Read items directly (bypass listItems URL enrichment so written
    // items.json stays clean).
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const id = slugFromTitle(input.title);
    if (items.some((i) => i.id === id)) {
      throw new Error(`Item id "${id}" already exists. Rename to disambiguate.`);
    }
    const item: SaleItem = {
      id,
      title: input.title,
      price: input.price,
      tags: input.tags ?? [],
      added: todayISO(),
      ...(input.image ? { image: input.image } : {}),
      ...(input.description ? { description: input.description } : {}),
      reserved: null,
    };
    items.push(item);
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(item);
  }

  async updateItem(id: string, patch: UpdateItemInput, _sale?: string): Promise<SaleItem> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    const next: SaleItem = { ...(items[idx] as SaleItem), ...patch };
    items[idx] = next;
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(next);
  }

  async deleteItem(id: string, _sale?: string): Promise<void> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    items.splice(idx, 1);
    this.writeJson(this.itemsPath, items);
  }

  async markReserved(id: string, info: MarkReservedInput, _sale?: string): Promise<SaleItem> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    const item = items[idx] as SaleItem;
    item.reserved = {
      on: info.on ?? todayISO(),
      price: info.price ?? item.price,
      ...(info.note ? { note: info.note } : {}),
    };
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(item);
  }

  async unreserve(id: string, _sale?: string): Promise<SaleItem> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    const item = items[idx] as SaleItem;
    item.reserved = null;
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(item);
  }

  /**
   * Download an image into `public/photos/<itemId>-<nanoid>.<ext>` and
   * append the relative path to the item's images array. The self-hosted
   * viewer resolves `photos/...` relative to the site root, matching the
   * export format hosted sales produce.
   */
  async attachImageFromUrl(id: string, url: string, _sale?: string): Promise<SaleItem> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    const item = items[idx] as SaleItem;

    const { bytes: rawBytes, mime: rawMime } = await fetchImageBytes(url);
    const { bytes, mime } = await normalizeImage(rawBytes, rawMime);
    const ext = LOCAL_MIME_EXTS[mime] ?? 'bin';
    const relPath = this.writePhoto(id, Buffer.from(bytes), ext);

    const next: SaleItem = {
      ...item,
      images: [...(item.images ?? (item.image ? [item.image] : [])), relPath],
    };
    items[idx] = next;
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(next);
  }

  async attachImageBytes(
    id: string,
    data: string,
    opts: { mime?: string },
    _sale?: string,
  ): Promise<SaleItem> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    const item = items[idx] as SaleItem;

    const { bytes: rawBytes, mime: rawMime } = decodeImageData(data, opts.mime);
    const { bytes, mime } = await normalizeImage(rawBytes, rawMime);
    const ext = LOCAL_MIME_EXTS[mime] ?? 'bin';
    const relPath = this.writePhoto(id, Buffer.from(bytes), ext);

    const next: SaleItem = {
      ...item,
      images: [...(item.images ?? (item.image ? [item.image] : [])), relPath],
    };
    items[idx] = next;
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(next);
  }

  async attachImageFromPath(id: string, path: string, _sale?: string): Promise<SaleItem> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    const item = items[idx] as SaleItem;

    // Same sandbox-path + existence checks as the hosted backend.
    if (path.startsWith('/mnt/user-data/') || path.startsWith('/mnt/skills/')) {
      throw new Error(
        `attach_image_from_path: "${path}" is a Claude sandbox path. ` +
          "Switch to Claude Code (which shares the user's filesystem with the MCP) " +
          "or have the user copy the file into the self-hosted repo's public/photos/ " +
          'directory first.',
      );
    }
    if (!existsSync(path)) {
      throw new Error(
        `attach_image_from_path: "${path}" doesn't exist from the working ` +
          'directory of the MCP process.',
      );
    }
    const buf = readFileSync(path);
    const rawMime = detectLocalImageMime(buf);
    if (!rawMime) {
      throw new Error(
        `attach_image_from_path: "${path}" isn't a JPEG, PNG, or WebP (magic bytes).`,
      );
    }
    const { bytes, mime } = await normalizeImage(buf, rawMime);
    const ext = LOCAL_MIME_EXTS[mime] ?? 'bin';
    const relPath = this.writePhoto(id, Buffer.from(bytes), ext);
    const next: SaleItem = {
      ...item,
      images: [...(item.images ?? (item.image ? [item.image] : [])), relPath],
    };
    items[idx] = next;
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(next);
  }

  async deleteImage(id: string, imageUrl: string, _sale?: string): Promise<SaleItem> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    const item = items[idx] as SaleItem;

    const existing = item.images ?? (item.image ? [item.image] : []);
    const remaining = existing.filter((u) => u !== imageUrl);
    if (remaining.length === existing.length) {
      throw new Error(`Image "${imageUrl}" not found on item "${id}".`);
    }

    // If the image is a repo-relative path, delete the backing file. We
    // don't touch external URLs (the user may have pasted them) — the
    // reference is gone from items.json, which is what matters for
    // rendering.
    if (imageUrl.startsWith('photos/')) {
      const abs = join(this.repoDir, 'public', imageUrl);
      if (existsSync(abs)) {
        try {
          unlinkSync(abs);
        } catch {
          // Silent on unlink errors: the user can git-clean stale blobs
          // if one ever sticks. items.json is the source of truth.
        }
      }
    }

    const next: SaleItem = { ...item, images: remaining };
    if (remaining.length === 0) next.images = undefined;
    // Drop the legacy `image` single-field too so the card falls back cleanly.
    if (next.image === imageUrl) next.image = undefined;
    items[idx] = next;
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(next);
  }

  async setCover(id: string, imageUrl: string, _sale?: string): Promise<SaleItem> {
    const items = this.readJson<SaleItem[]>(this.itemsPath);
    const idx = this.findIdx(items, id);
    const item = items[idx] as SaleItem;
    const existing = item.images ?? (item.image ? [item.image] : []);
    if (!existing.includes(imageUrl)) {
      throw new Error(
        `Image "${imageUrl}" is not on item "${id}". Attach it first, or pass a URL that's already in item.images.`,
      );
    }
    if (existing[0] === imageUrl) return this.withItemUrl(item);
    const reordered = [imageUrl, ...existing.filter((u) => u !== imageUrl)];
    const next: SaleItem = { ...item, images: reordered, image: undefined };
    items[idx] = next;
    this.writeJson(this.itemsPath, items);
    return this.withItemUrl(next);
  }

  /** Write bytes into `public/photos/` and return the repo-relative path. */
  private writePhoto(itemId: string, bytes: Uint8Array | Buffer, ext: string): string {
    const photosDir = join(this.repoDir, 'public', 'photos');
    if (!existsSync(photosDir)) mkdirSync(photosDir, { recursive: true });
    const filename = `${itemId}-${randomSuffix()}.${ext}`;
    writeFileSync(join(photosDir, filename), bytes);
    return `photos/${filename}`;
  }

  /** Decorate with `publicUrl` for the return value without touching the on-disk shape. */
  private withItemUrl(item: SaleItem): SaleItem {
    const site = this.readJson<SaleSite>(this.sitePath);
    const url = this.siteUrl(site);
    return url ? { ...item, publicUrl: `${url}#${item.id}` } : item;
  }

  // ─── Mode-specific ─────────────────────────────────────────────────────
  async publish(_sale?: string): Promise<{ publishedAt: string }> {
    throw new Error(
      'Self-hosted sites are always "published" — `git push` deploys via GitHub Actions. Use commit_and_push instead.',
    );
  }
  async unpublish(_sale?: string): Promise<void> {
    throw new Error(
      'Self-hosted sites cannot be unpublished from the MCP. Delete the GH Pages site or remove the deploy workflow.',
    );
  }
  async commitAndPush(message?: string): Promise<{ pushed: boolean; note?: string }> {
    const msg = message ?? 'update digital yard sale';
    this.runGit(['add', '-A']);
    const status = this.runGit(['status', '--porcelain']).stdout;
    if (!status.trim()) return { pushed: false, note: 'Nothing to commit.' };
    this.runGit(['commit', '-m', msg]);
    // Push uses your local git's existing auth (SSH key, gh CLI's
    // credential helper, baked-in HTTPS token, etc.). If push fails the
    // most common cause is no GitHub credentials. Try `git push` from
    // the same directory in a terminal to see the actual error, then
    // fix it (e.g. `gh auth login`).
    this.runGit(['push']);
    return { pushed: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────
  /**
   * Wrapper around `git` that surfaces stderr on failure. Default
   * execFileSync swallows the error message, which is unhelpful when
   * push fails for auth / network reasons.
   */
  private runGit(args: string[]): { stdout: string } {
    try {
      const out = execFileSync('git', args, {
        cwd: this.repoDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { stdout: out };
    } catch (e) {
      const err = e as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string };
      const stderr = err.stderr?.toString?.().trim() ?? '';
      const stdout = err.stdout?.toString?.().trim() ?? '';
      const detail = stderr || stdout || err.message || 'unknown';
      throw new Error(`git ${args.join(' ')} failed: ${detail}`);
    }
  }

  private readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }
  private writeJson(path: string, obj: unknown): void {
    writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
  }
  private findIdx(items: SaleItem[], id: string): number {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`No item with id "${id}".`);
    return idx;
  }
}

function slugFromTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'untitled'
  );
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

const LOCAL_IMAGE_MAX_BYTES = 8_000_000; // 8 MB
const LOCAL_MIME_EXTS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Sniff JPEG/PNG/WebP magic bytes. Duplicated from hosted.ts's
 * detectImageMime because pulling it across the module boundary is
 * more ceremony than a 20-line function deserves.
 */
function detectLocalImageMime(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
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

/**
 * Fetch an image URL and return its bytes + chosen file extension.
 * Minimal validation — this is self-hosted, running in the user's own
 * shell against their own machine, so the SSRF + rate-limit framing
 * that the hosted endpoint has doesn't apply. Still reject non-http(s)
 * schemes (no file://) and enforce a sane size cap.
 */
async function fetchImageBytes(
  rawUrl: string,
): Promise<{ bytes: Buffer; mime: string; ext: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'yrdsl-mcp/0.x (+https://yrdsl.app)',
      Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const mime = (res.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = LOCAL_MIME_EXTS[mime];
  if (!ext) {
    throw new Error(
      `Unsupported image content-type: "${mime || '(unset)'}". Accepted: jpeg, png, webp.`,
    );
  }
  const arr = await res.arrayBuffer();
  if (arr.byteLength > LOCAL_IMAGE_MAX_BYTES) {
    throw new Error(`Image too large: ${arr.byteLength} bytes (max ${LOCAL_IMAGE_MAX_BYTES}).`);
  }
  return { bytes: Buffer.from(arr), mime, ext };
}
