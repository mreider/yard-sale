/**
 * yrdsl-viewer: Cloudflare Worker on yrdsl.app/*
 *
 * Decides per-request whether the path matches a published-sale viewer
 * pattern (/:user/:slug) or should be forwarded to the GH Pages origin
 * (/, /privacy, /terms, asset paths, etc.).
 *
 * Why this Worker exists:
 *   1. Canonical URLs. Per PRD §6.14 published sales should live at
 *      yrdsl.app/{user}/{slug}, not under app.yrdsl.app.
 *   2. Open Graph + Twitter Card meta tags pre-rendered for link
 *      previews in chats / DMs / social. The SPA can't do that
 *      client-side because crawlers don't run JS.
 *
 * How it serves the viewer:
 *   - GET https://api.yrdsl.app/public/sales/{user}/{slug} for site +
 *     items data.
 *   - GET https://app.yrdsl.app/{user}/{slug} for the SPA shell HTML.
 *   - Inject <meta og:*> and <meta twitter:*> into <head> using the data.
 *   - Rewrite /assets/<hash>.{js,css} hrefs to the absolute SPA origin
 *     so the browser still loads bundled JS/CSS.
 *   - Edge-cache for 60s (purge happens implicitly when the user edits
 *     and the SPA bundle hash changes — we just match whatever the SPA
 *     currently serves).
 */

interface Env {
  API_URL: string;
  SPA_URL: string;
}

// Top-level path segments served by the GH Pages landing. Anything
// matching one of these passes straight through to origin. (robots.txt
// and sitemap.xml are intercepted before the passthrough path — see
// the fetch handler below — so they don't appear here.)
const RESERVED_TOP_SEGMENTS = new Set([
  '',
  'privacy',
  'terms',
  'assets', // landing's own assets bucket if any
  'images',
  'CNAME',
  '.well-known',
  'favicon.ico',
  'apple-touch-icon.png',
]);

// Username pattern: matches what users actually have (lowercase
// alphanumeric + dashes, 2-30 chars). Stricter than the path
// constraint so we don't try to render /yard-sale/anything as a
// "yard-sale" user's "anything" sale. False negatives just fall
// through to GH Pages, which 404s.
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);

    // Generated SEO files. Both intercepted here so we don't need to
    // commit a stale sitemap to GH Pages or have the SPA serve them.
    if (url.pathname === '/robots.txt') return renderRobots();
    if (url.pathname === '/sitemap.xml') return renderSitemap(env);

    // Single-segment or root → pass through.
    if (segments.length === 0) return fetch(request);
    if (segments.length === 1) {
      // /privacy, /terms, etc. always to origin. Single-segment user-only
      // URLs are not used (we always have a slug).
      return fetch(request);
    }

    // Reserved first segment never overlaps with user pages.
    if (RESERVED_TOP_SEGMENTS.has(segments[0]!.toLowerCase())) {
      return fetch(request);
    }

    // Two-segment viewer pattern: /:user/:slug
    if (segments.length === 2) {
      const user = segments[0]!.toLowerCase();
      const slug = segments[1]!.toLowerCase();
      if (USERNAME_RE.test(user) && SLUG_RE.test(slug)) {
        const overlay = await tryRenderOverlay(request, user, slug, env);
        if (overlay) return overlay;
      }
    }

    // Anything else → origin.
    return fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function tryRenderOverlay(
  request: Request,
  user: string,
  slug: string,
  env: Env,
): Promise<Response | null> {
  // Fetch published sale data (single source of truth for OG tags + the
  // existence check). 404 here means there is no such published sale —
  // fall through so GH Pages serves its 404.
  const dataRes = await fetch(`${env.API_URL}/public/sales/${user}/${slug}`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!dataRes.ok) return null;

  const data = (await dataRes.json()) as {
    site: { siteName: string; description?: string; theme?: string; subtitle?: string };
    items: { title: string; image?: string; images?: string[] }[];
  };

  // Pull the SPA shell (so users get the actual app — same JS bundle
  // that handles routing, viewer rendering, etc.) and inject meta tags.
  const spaRes = await fetch(`${env.SPA_URL}/${user}/${slug}`, {
    headers: { 'User-Agent': 'yrdsl-viewer-worker/1.0' },
  });
  if (!spaRes.ok || !spaRes.headers.get('content-type')?.includes('text/html')) {
    return null;
  }
  let html = await spaRes.text();

  // Inject OG / Twitter tags. Title gets overwritten too.
  const heroImage =
    data.items.find((i) => i.image || i.images?.length)?.image ??
    data.items.find((i) => i.images?.length)?.images?.[0] ??
    '';
  const description =
    data.site.description ?? data.site.subtitle ?? `${data.site.siteName} on yrdsl.app`;
  const canonicalUrl = `https://yrdsl.app/${user}/${slug}`;

  const meta = [
    `<title>${escapeHtml(data.site.siteName)}</title>`,
    `<link rel="canonical" href="${canonicalUrl}">`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:title" content="${escapeHtml(data.site.siteName)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${canonicalUrl}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="yrdsl.app">`,
    heroImage ? `<meta property="og:image" content="${escapeAttr(heroImage)}">` : '',
    `<meta name="twitter:card" content="${heroImage ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(data.site.siteName)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    heroImage ? `<meta name="twitter:image" content="${escapeAttr(heroImage)}">` : '',
  ]
    .filter(Boolean)
    .join('\n  ');

  // Strip existing <title> / <link rel=canonical> from the SPA shell so
  // ours win unambiguously.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '');
  html = html.replace(/<link[^>]+rel=["']canonical["'][^>]*>/gi, '');

  // Inject right before </head>.
  html = html.replace('</head>', `  ${meta}\n</head>`);

  // The SPA's bundled assets have absolute paths like /assets/index-xxx.js.
  // Browser would resolve them against yrdsl.app, hitting THIS Worker
  // which would proxy to GH Pages — wrong place. Rewrite to absolute
  // app.yrdsl.app URLs.
  html = html.replaceAll('href="/assets/', `href="${env.SPA_URL}/assets/`);
  html = html.replaceAll('src="/assets/', `src="${env.SPA_URL}/assets/`);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      // Mirror the security headers the api-worker uses, with a CSP
      // tuned to allow the SPA bundle on app.yrdsl.app.
      'Content-Security-Policy': [
        "default-src 'self'",
        `script-src 'self' ${env.SPA_URL}`,
        `style-src 'self' 'unsafe-inline' ${env.SPA_URL} https://fonts.googleapis.com`,
        `font-src 'self' ${env.SPA_URL} https://fonts.gstatic.com`,
        `img-src 'self' data: blob: https:`,
        `connect-src 'self' ${env.API_URL}`,
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}

function renderRobots(): Response {
  // Allow everything under yrdsl.app. The SPA shell on app.yrdsl.app
  // is intentionally not crawlable; robots.txt for that origin lives
  // there separately.
  const body = 'User-agent: *\nAllow: /\n\nSitemap: https://yrdsl.app/sitemap.xml\n';
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function renderSitemap(env: Env): Promise<Response> {
  // Pull the URL list from the api-worker. Edge-cache for 5 minutes —
  // search engines do not need second-fresh sitemaps.
  const res = await fetch(`${env.API_URL}/public/sitemap`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) {
    return new Response('sitemap upstream error', { status: 502 });
  }
  const data = (await res.json()) as { urls: { loc: string; lastmod: string }[] };
  const urls = data.urls
    .map(
      (u) =>
        `  <url><loc>https://yrdsl.app${escapeAttr(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`,
    )
    .join('\n');
  // Always include the homepage as a baseline entry.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://yrdsl.app/</loc></url>
${urls}
</urlset>
`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
