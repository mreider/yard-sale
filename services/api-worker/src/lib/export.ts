import type { SaleItem } from '@yrdsl/core';
import { zipSync } from 'fflate';
import type { Env, ItemRow, SaleRow } from '../env.js';
import { itemRowToItem, saleRowToSite } from './sales.js';

/**
 * Build a ZIP that drops cleanly into the `KuvopLLC/yrdsl-self-hosted`
 * template:
 *
 *   site.json                 → repo root (replaces template's site.json)
 *   items.json                → repo root (replaces template's items.json)
 *   public/photos/<id>.webp   → matches template's public/photos/ convention
 *   README.md                 → short note explaining what to do with the ZIP
 *
 * Item image URLs are rewritten from absolute api.yrdsl.app URLs to the
 * relative `photos/<id>.webp` form the template viewer expects, so the
 * extracted repo renders identically without further edits.
 *
 * In-memory zip (fflate.zipSync). Cap callers at sales whose total image
 * payload fits in a few tens of MB; image bytes already are WebP so we
 * skip recompression (level: 0).
 */
export async function buildSaleExportZip(
  env: Env,
  sale: SaleRow,
  items: ItemRow[],
  username: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const apiPrefix = `${env.IMAGE_BASE_URL ?? env.APP_URL}/image/`;

  // Collect every R2 image key referenced by any item, in order, dedup'd.
  // Map original URL → new relative path so we can rewrite items.json.
  const urlToLocal = new Map<string, string>();
  const r2Keys: string[] = [];
  for (const row of items) {
    if (!row.images) continue;
    const urls = JSON.parse(row.images) as string[];
    for (const url of urls) {
      if (urlToLocal.has(url)) continue;
      if (!url.startsWith(apiPrefix)) {
        // External image (user pasted a URL) — leave it alone in items.json
        // and don't try to bundle the bytes.
        continue;
      }
      const key = url.slice(apiPrefix.length);
      const filename = key.split('/').pop() ?? key;
      urlToLocal.set(url, `photos/${filename}`);
      r2Keys.push(key);
    }
  }

  // Fetch image bytes in parallel (cap concurrency loosely — R2 list+get
  // is cheap, and Workers will queue).
  const fileBytes = new Map<string, Uint8Array>();
  await Promise.all(
    r2Keys.map(async (key) => {
      const obj = await env.R2_IMAGES.get(key);
      if (!obj) return; // image missing from R2; skip silently
      const buf = new Uint8Array(await obj.arrayBuffer());
      const filename = key.split('/').pop() ?? key;
      fileBytes.set(`public/photos/${filename}`, buf);
    }),
  );

  const site = saleRowToSite(sale);
  // Drop host-only fields that don't make sense in a self-hosted snapshot.
  const { id: _id, ...siteOut } = site;
  void _id;

  const itemsOut: SaleItem[] = items.map((row) => {
    const item = itemRowToItem(row);
    if (item.images) {
      item.images = item.images.map((u) => urlToLocal.get(u) ?? u);
      item.image = item.images[0];
    } else if (item.image && urlToLocal.has(item.image)) {
      item.image = urlToLocal.get(item.image)!;
    }
    return item;
  });

  const enc = new TextEncoder();
  const tree: Record<string, [Uint8Array, { level: number }]> = {
    'site.json': [enc.encode(`${JSON.stringify(siteOut, null, 2)}\n`), { level: 6 }],
    'items.json': [enc.encode(`${JSON.stringify(itemsOut, null, 2)}\n`), { level: 6 }],
    'README.md': [enc.encode(buildReadme(sale.slug, username)), { level: 6 }],
  };
  for (const [path, bytes] of fileBytes) {
    // WebP is already compressed; STORE (level: 0) saves CPU.
    tree[path] = [bytes, { level: 0 }];
  }

  // fflate accepts a nested object literal; the [bytes, opts] tuple form
  // sets per-file compression. zipSync is synchronous — fine for the
  // size budget the route enforces upstream.
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(tree).map(([k, [data, opts]]) => [k, [data, opts]] as const),
    ) as unknown as Parameters<typeof zipSync>[0],
  );

  const dateStamp = new Date().toISOString().slice(0, 10);
  return { bytes, filename: `${sale.slug}-${dateStamp}.zip` };
}

function buildReadme(slug: string, username: string): string {
  return `# yrdsl.app export: ${slug}

This ZIP is a snapshot of your hosted yard sale at
\`https://yrdsl.app/${username}/${slug}\`.

## How to self-host

1. Clone the template repo:
   \`\`\`sh
   git clone https://github.com/KuvopLLC/yrdsl-self-hosted.git my-sale
   cd my-sale
   \`\`\`
2. Extract this ZIP into the repo root, overwriting the template's
   placeholder \`site.json\`, \`items.json\`, and \`public/photos/\`:
   \`\`\`sh
   unzip -o /path/to/${slug}.zip -d .
   \`\`\`
3. \`pnpm install && pnpm dev\` to preview locally, or push to a GitHub
   repo with Pages enabled to publish.

## What's in here

- \`site.json\` — your sale's metadata (title, theme, contact, etc).
- \`items.json\` — every item with prices, descriptions, and image refs.
- \`public/photos/*.webp\` — the actual image bytes.
- External image URLs you pasted in (not uploaded to yrdsl.app) are
  preserved as-is in \`items.json\`.

The hosted-only fields (\`publishedAt\`, host id) are preserved in case
you want to import back into yrdsl.app later, but the self-hosted
template ignores them.
`;
}
