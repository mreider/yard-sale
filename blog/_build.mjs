#!/usr/bin/env node
/**
 * Build the yrdsl.app blog: markdown + frontmatter → static HTML.
 *
 *   apps/landing/blog/
 *     _src/
 *       layout.html      ← shared chrome (head, nav, footer)
 *       posts/*.md       ← source posts
 *     _build.mjs         ← this file
 *     index.html         ← generated: post list + tag cloud
 *     <slug>/index.html  ← generated: single post
 *     tags/<tag>/index.html
 *     feed.xml           ← generated: RSS
 *
 * Also injects a "Latest from the blog" strip into apps/landing/index.html
 * by replacing a `<!-- LATEST_POSTS -->` comment marker with built HTML.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { marked } from 'marked';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '_src');
const POSTS_SRC = join(SRC, 'posts');
const OUT = HERE;
const LANDING_INDEX = join(HERE, '..', 'index.html');
const SITE_URL = 'https://yrdsl.app';

const LAYOUT = readFileSync(join(SRC, 'layout.html'), 'utf8');

const HIGHLIGHT_HEAD = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.10.0/build/styles/github.min.css" />
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.10.0/build/highlight.min.js" defer></script>
<script>
  document.addEventListener('DOMContentLoaded', function () {
    if (window.hljs) window.hljs.highlightAll();
  });
</script>`;

// ─── 1. Read + parse posts ────────────────────────────────────────────────
const posts = readdirSync(POSTS_SRC)
  .filter((f) => f.endsWith('.md'))
  .map((f) => parsePost(join(POSTS_SRC, f)))
  .sort((a, b) => b.date.localeCompare(a.date));

if (posts.length === 0) {
  console.error('no posts found in', POSTS_SRC);
  process.exit(1);
}

// ─── 2. Compute tag → posts map ───────────────────────────────────────────
const tagMap = new Map();
for (const p of posts) {
  for (const t of p.tags) {
    if (!tagMap.has(t)) tagMap.set(t, []);
    tagMap.get(t).push(p);
  }
}

// ─── 3. Wipe stale generated output ───────────────────────────────────────
const staleNames = new Set([
  'index.html',
  'feed.xml',
  'tags',
  ...readdirSync(OUT).filter((n) => {
    if (n === '_src' || n === '_build.mjs' || n === '_build.test.mjs') return false;
    if (n.startsWith('.')) return false;
    const stat = statSync(join(OUT, n));
    // only directories survive — old per-post dirs we'll recreate
    return stat.isDirectory();
  }),
]);
for (const name of staleNames) {
  const p = join(OUT, name);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

// ─── 4. Per-post pages ────────────────────────────────────────────────────
for (const p of posts) {
  const dir = join(OUT, p.slug);
  mkdirSync(dir, { recursive: true });
  const html = render({
    title: `${p.title} · yrdsl.app blog`,
    description: p.description,
    canonical: `${SITE_URL}/blog/${p.slug}/`,
    ogTitle: p.title,
    ogType: 'article',
    headExtra: HIGHLIGHT_HEAD,
    body: postBody(p),
  });
  writeFileSync(join(dir, 'index.html'), html);
}

// ─── 5. Index page ────────────────────────────────────────────────────────
writeFileSync(
  join(OUT, 'index.html'),
  render({
    title: 'Blog · yrdsl.app',
    description:
      'Updates on yrdsl.app — build progress, sample sales, and how-tos for self-hosters and developers.',
    canonical: `${SITE_URL}/blog/`,
    ogTitle: 'yrdsl.app blog',
    ogType: 'website',
    headExtra: '',
    body: indexBody(posts, [...tagMap.keys()].sort()),
  }),
);

// ─── 6. Tag pages ─────────────────────────────────────────────────────────
for (const [tag, tagged] of tagMap) {
  const dir = join(OUT, 'tags', tag);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    render({
      title: `Tag: ${tag} · yrdsl.app blog`,
      description: `Posts tagged "${tag}" on the yrdsl.app blog.`,
      canonical: `${SITE_URL}/blog/tags/${tag}/`,
      ogTitle: `Tag: ${tag}`,
      ogType: 'website',
      headExtra: '',
      body: tagBody(tag, tagged, [...tagMap.keys()].sort()),
    }),
  );
}

// ─── 7. RSS feed ──────────────────────────────────────────────────────────
writeFileSync(join(OUT, 'feed.xml'), buildRss(posts));

// ─── 8. Inject "Latest from the blog" into the landing ────────────────────
injectLatestPostsIntoLanding(posts.slice(0, 3));

console.log(
  `built ${posts.length} post${posts.length === 1 ? '' : 's'}, ${tagMap.size} tag${
    tagMap.size === 1 ? '' : 's'
  }`,
);

// ─── helpers ──────────────────────────────────────────────────────────────

function parsePost(path) {
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${path}: missing frontmatter`);
  const fm = yaml.load(m[1]) ?? {};
  if (!fm.title) throw new Error(`${path}: missing title`);
  if (!fm.date) throw new Error(`${path}: missing date`);
  if (!fm.description) throw new Error(`${path}: missing description`);

  // slug: filename minus the leading YYYY-MM-DD- prefix and .md
  const fileSlug = basename(path, extname(path)).replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const html = marked.parse(m[2], { gfm: true, breaks: false });
  return {
    slug: fm.slug ?? fileSlug,
    title: String(fm.title),
    date: typeof fm.date === 'string' ? fm.date : new Date(fm.date).toISOString().slice(0, 10),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    description: String(fm.description),
    bodyHtml: html,
  };
}

function escape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render({ title, description, canonical, ogTitle, ogType, headExtra, body }) {
  return LAYOUT.replace(/{{TITLE}}/g, escape(title))
    .replace(/{{DESCRIPTION}}/g, escape(description))
    .replace(/{{CANONICAL}}/g, escape(canonical))
    .replace(/{{OG_TITLE}}/g, escape(ogTitle))
    .replace(/{{OG_TYPE}}/g, escape(ogType))
    .replace(/{{HEAD_EXTRA}}/g, headExtra)
    .replace(/{{BODY}}/g, body);
}

function fmtDate(iso) {
  // 2026-04-26 → "April 26, 2026"
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

function tagListHtml(tags) {
  return tags
    .map((t) => `<a class="tag-chip" href="/blog/tags/${escape(t)}/">${escape(t)}</a>`)
    .join('');
}

function postCardHtml(p) {
  const tags = p.tags.length
    ? `<span class="post-tags">${p.tags
        .map((t) => `<a href="/blog/tags/${escape(t)}/">#${escape(t)}</a>`)
        .join('')}</span>`
    : '';
  return `
    <a class="post-card" href="/blog/${escape(p.slug)}/">
      <h2 class="post-card-title">${escape(p.title)}</h2>
      <div class="post-card-meta">
        <time datetime="${escape(p.date)}">${escape(fmtDate(p.date))}</time>
        ${tags}
      </div>
      <p class="post-card-snippet">${escape(p.description)}</p>
    </a>`;
}

function indexBody(posts, allTags) {
  return `
    <h1 class="blog-page-title">Blog</h1>
    <p class="blog-page-sub">
      Updates on yrdsl.app — build progress, sample sales, and how-tos for
      self-hosters and developers.
    </p>
    ${
      allTags.length
        ? `<div class="tag-cloud">${tagListHtml(allTags)}</div>`
        : ''
    }
    <div class="post-list">
      ${posts.map(postCardHtml).join('')}
    </div>
    `;
}

function tagBody(tag, tagged, allTags) {
  const cloud = allTags
    .map(
      (t) =>
        `<a class="tag-chip${t === tag ? ' active' : ''}" href="/blog/tags/${escape(t)}/">${escape(
          t,
        )}</a>`,
    )
    .join('');
  return `
    <h1 class="blog-page-title">Tag: ${escape(tag)}</h1>
    <p class="blog-page-sub">
      ${tagged.length} post${tagged.length === 1 ? '' : 's'} tagged
      <code>${escape(tag)}</code>. <a href="/blog/">All posts</a>.
    </p>
    <div class="tag-cloud">${cloud}</div>
    <div class="post-list">
      ${tagged.map(postCardHtml).join('')}
    </div>
    `;
}

function postBody(p) {
  const tags = p.tags.length
    ? `<span class="post-tags">${p.tags
        .map((t) => `<a href="/blog/tags/${escape(t)}/">#${escape(t)}</a>`)
        .join('')}</span>`
    : '';
  return `
    <article>
      <header class="post-header">
        <h1 class="post-title">${escape(p.title)}</h1>
        <div class="post-meta">
          <time datetime="${escape(p.date)}">${escape(fmtDate(p.date))}</time>
          ${tags}
        </div>
      </header>
      <div class="post-body">${p.bodyHtml}</div>
      <aside class="post-cta">
        <h3>Sell your stuff on yrdsl.</h3>
        <p>A digital yard sale, free during pre-release. Self-host or hosted at yrdsl.app.</p>
        <a class="cta-btn" href="https://app.yrdsl.app/signup">Sign up &rarr;</a>
      </aside>
    </article>
    `;
}

function buildRss(posts) {
  const lastBuildDate = new Date().toUTCString();
  const items = posts
    .map((p) => {
      const url = `${SITE_URL}/blog/${p.slug}/`;
      // Use noon UTC so feed readers don't display "tomorrow" or "yesterday"
      // depending on timezone.
      const pubDate = new Date(`${p.date}T12:00:00Z`).toUTCString();
      return `
    <item>
      <title>${escape(p.title)}</title>
      <link>${escape(url)}</link>
      <guid isPermaLink="true">${escape(url)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escape(p.description)}</description>
      ${p.tags.map((t) => `<category>${escape(t)}</category>`).join('')}
    </item>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>yrdsl.app blog</title>
    <link>${SITE_URL}/blog/</link>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>Updates on yrdsl.app — build progress, sample sales, and how-tos.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>${items}
  </channel>
</rss>
`;
}

function injectLatestPostsIntoLanding(latest) {
  if (!existsSync(LANDING_INDEX)) {
    console.warn('landing index.html not found; skipping latest-posts injection');
    return;
  }
  const html = readFileSync(LANDING_INDEX, 'utf8');
  // Idempotent replace: marker stays as a marker so re-runs work. Look for
  // either the bare marker or a previously-injected block (between marker
  // and an end-marker).
  const startRe = /<!-- LATEST_POSTS -->[\s\S]*?<!-- \/LATEST_POSTS -->/;
  const bare = '<!-- LATEST_POSTS -->';
  const strip = `<!-- LATEST_POSTS -->\n${latestPostsStripHtml(latest)}\n<!-- /LATEST_POSTS -->`;
  let updated;
  if (startRe.test(html)) {
    updated = html.replace(startRe, strip);
  } else if (html.includes(bare)) {
    updated = html.replace(bare, strip);
  } else {
    // No marker → don't try to guess where to put it. Skip.
    console.warn('landing index.html has no <!-- LATEST_POSTS --> marker; skipping injection');
    return;
  }
  if (updated !== html) {
    writeFileSync(LANDING_INDEX, updated);
  }
}

function latestPostsStripHtml(latest) {
  if (latest.length === 0) return '';
  const cards = latest
    .map(
      (p) => `
        <a class="latest-post" href="/blog/${escape(p.slug)}/">
          <span class="latest-post-date">${escape(fmtDate(p.date))}</span>
          <span class="latest-post-title">${escape(p.title)}</span>
          <p class="latest-post-snippet">${escape(p.description)}</p>
        </a>`,
    )
    .join('');
  return `<section class="latest-posts-section">
  <div class="wrap">
    <h2>Latest from the blog.</h2>
    <div class="latest-posts-list">${cards}</div>
    <p class="latest-posts-more"><a href="/blog/">All posts &rarr;</a></p>
  </div>
</section>`;
}
