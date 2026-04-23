/**
 * Client-side helper for the `draft_item_from_url` MCP tool.
 *
 * Fetches a product page and extracts title / description / hero image /
 * price hints using lightweight regex over the HTML. No full parser —
 * it's a best-effort draft, and Claude can accept or refine whatever
 * comes back before calling `add_item` + `attach_image_from_url`.
 *
 * Runs on the user's machine (inside the MCP npm package), so there's
 * no SSRF concern from our infra's perspective. Still applies basic
 * guards (http/https only, size cap, timeout) so a sloppy URL doesn't
 * spin the process forever.
 */

export interface DraftItemFields {
  title?: string;
  description?: string;
  image?: string;
  price?: number;
  currency?: string;
  sourceUrl: string;
}

const MAX_HTML_BYTES = 2_000_000; // 2 MB is plenty for any product page
const FETCH_TIMEOUT_MS = 10_000;

export async function draftItemFromUrl(rawUrl: string): Promise<DraftItemFields> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; yrdsl-mcp; +https://yrdsl.app) link-preview/1.0',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);

  const ct = (res.headers.get('Content-Type') ?? '').toLowerCase();
  if (!ct.includes('html') && !ct.includes('xml')) {
    throw new Error(`Not an HTML page (Content-Type: ${ct || 'unset'}).`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_HTML_BYTES) {
    throw new Error(`Page too large: ${buf.byteLength} bytes.`);
  }
  // Decode assuming UTF-8; most real-world pages are. If they're not, the
  // regex still matches ASCII well enough for meta tags.
  const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return parseDraftFromHtml(html, res.url || rawUrl);
}

/**
 * Pure HTML → draft fields. Exported for testability; `draftItemFromUrl`
 * above is the real entrypoint and wraps this with fetch + validation.
 */
export function parseDraftFromHtml(html: string, sourceUrl: string): DraftItemFields {
  const out: DraftItemFields = { sourceUrl };

  const ogTitle =
    metaContent(html, 'property', 'og:title') ?? metaContent(html, 'name', 'twitter:title');
  const docTitle = extractTitle(html);
  out.title = ogTitle ?? docTitle;

  const ogDesc =
    metaContent(html, 'property', 'og:description') ??
    metaContent(html, 'name', 'twitter:description') ??
    metaContent(html, 'name', 'description');
  out.description = ogDesc;

  const ogImage =
    metaContent(html, 'property', 'og:image:secure_url') ??
    metaContent(html, 'property', 'og:image') ??
    metaContent(html, 'name', 'twitter:image');
  if (ogImage) out.image = absolutize(ogImage, sourceUrl);

  const priceMeta =
    metaContent(html, 'property', 'product:price:amount') ??
    metaContent(html, 'property', 'og:price:amount');
  const currencyMeta =
    metaContent(html, 'property', 'product:price:currency') ??
    metaContent(html, 'property', 'og:price:currency');
  const fromMeta = priceMeta ? Number(priceMeta) : Number.NaN;
  if (Number.isFinite(fromMeta) && fromMeta >= 0) {
    out.price = fromMeta;
    if (currencyMeta) out.currency = currencyMeta.toUpperCase().slice(0, 3);
  }

  // JSON-LD Product offers as a fallback / richer source. Only peek at
  // the first Product block we can find; real pages sometimes stack
  // several (Breadcrumb, Organization, etc.).
  if (out.price === undefined || !out.currency) {
    const offer = extractProductOffer(html);
    if (offer) {
      if (out.price === undefined && Number.isFinite(offer.price)) out.price = offer.price;
      if (!out.currency && offer.currency) out.currency = offer.currency.toUpperCase().slice(0, 3);
    }
  }

  // Clean up whitespace in strings — some sites include line breaks.
  if (out.title) out.title = collapse(out.title);
  if (out.description) out.description = collapse(out.description);

  return out;
}

/** Extract the `content` attribute of the first <meta> tag with the given attribute=value. */
function metaContent(html: string, attr: 'property' | 'name', key: string): string | undefined {
  // Tolerate attribute order, quote style, and extra whitespace.
  const escKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    // <meta attr="key" content="…">
    new RegExp(
      `<meta\\s+[^>]*\\b${attr}\\s*=\\s*["']${escKey}["'][^>]*\\bcontent\\s*=\\s*"([^"]*)"`,
      'i',
    ),
    new RegExp(
      `<meta\\s+[^>]*\\b${attr}\\s*=\\s*["']${escKey}["'][^>]*\\bcontent\\s*=\\s*'([^']*)'`,
      'i',
    ),
    // <meta content="…" attr="key">
    new RegExp(
      `<meta\\s+[^>]*\\bcontent\\s*=\\s*"([^"]*)"[^>]*\\b${attr}\\s*=\\s*["']${escKey}["']`,
      'i',
    ),
    new RegExp(
      `<meta\\s+[^>]*\\bcontent\\s*=\\s*'([^']*)'[^>]*\\b${attr}\\s*=\\s*["']${escKey}["']`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1]) : undefined;
}

/**
 * Peek at application/ld+json blocks and pull the first offer's price +
 * currency. Schema.org lets offers be a single object, an array, or
 * nested under @graph; we walk cautiously and bail on anything weird.
 */
function extractProductOffer(html: string): { price: number; currency?: string } | null {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex.exec loop
  while ((match = re.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw.trim());
      const found = findOffer(parsed);
      if (found) return found;
    } catch {
      // Not valid JSON — skip this block; probably HTML embedded.
    }
  }
  return null;
}

function findOffer(node: unknown): { price: number; currency?: string } | null {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const r = findOffer(entry);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;

  if (o.offers) {
    const offers = o.offers;
    const candidates = Array.isArray(offers) ? offers : [offers];
    for (const c of candidates) {
      if (typeof c !== 'object' || c === null) continue;
      const oc = c as Record<string, unknown>;
      const price = Number(oc.price ?? oc.lowPrice);
      const currency = typeof oc.priceCurrency === 'string' ? oc.priceCurrency : undefined;
      if (Number.isFinite(price) && price >= 0) return { price, currency };
    }
  }
  // Walk into @graph / other nested shapes.
  for (const val of Object.values(o)) {
    if (val && typeof val === 'object') {
      const r = findOffer(val);
      if (r) return r;
    }
  }
  return null;
}

/** Resolve a maybe-relative URL against the page it came from. */
function absolutize(candidate: string, base: string): string {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return candidate;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
