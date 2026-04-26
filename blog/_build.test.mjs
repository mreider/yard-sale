/**
 * Snapshot-style smoke test for the blog build. Runs _build.mjs against
 * the real _src/posts/ and asserts the output looks structurally right:
 * index, per-post, tag, and RSS pages all written, and the landing
 * marker got replaced. Doesn't lock down exact HTML; just keys the
 * test to "the build produced sensible files."
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANDING_INDEX = join(HERE, '..', 'index.html');

describe('blog build', () => {
  test('produces a complete output tree', () => {
    execFileSync('node', [join(HERE, '_build.mjs')], { stdio: 'pipe' });

    expect(existsSync(join(HERE, 'index.html'))).toBe(true);
    expect(existsSync(join(HERE, 'feed.xml'))).toBe(true);
    expect(existsSync(join(HERE, 'tags'))).toBe(true);

    // At least one post directory.
    const dirs = readdirSync(HERE).filter((n) => {
      if (n.startsWith('_') || n.startsWith('.')) return false;
      if (n === 'index.html' || n === 'feed.xml' || n === 'tags') return false;
      return statSync(join(HERE, n)).isDirectory();
    });
    expect(dirs.length).toBeGreaterThanOrEqual(1);
    for (const d of dirs) {
      expect(existsSync(join(HERE, d, 'index.html'))).toBe(true);
    }

    // Index HTML mentions the welcome post.
    const index = readFileSync(join(HERE, 'index.html'), 'utf8');
    expect(index).toContain('Welcome to the yrdsl blog');
    expect(index).toContain('class="post-list"');

    // RSS is well-formed enough to find the channel + an item.
    const rss = readFileSync(join(HERE, 'feed.xml'), 'utf8');
    expect(rss).toContain('<rss');
    expect(rss).toContain('<channel>');
    expect(rss).toContain('<item>');

    // Each post page has a `Sell your stuff on yrdsl` CTA.
    const firstPost = readFileSync(join(HERE, dirs[0], 'index.html'), 'utf8');
    expect(firstPost).toContain('post-cta');
    expect(firstPost).toContain('Sell your stuff on yrdsl');
    expect(firstPost).toContain('app.yrdsl.app/signup');
    // highlight.js script tag is loaded only on post pages.
    expect(firstPost).toContain('highlight.min.js');
    // Index doesn't load highlight.js.
    expect(index).not.toContain('highlight.min.js');

    // Landing index.html received the latest-posts strip between markers.
    const landing = readFileSync(LANDING_INDEX, 'utf8');
    expect(landing).toContain('<!-- LATEST_POSTS -->');
    expect(landing).toContain('<!-- /LATEST_POSTS -->');
    expect(landing).toContain('latest-posts-section');
    expect(landing).toContain('Latest from the blog');
  });

  test('build is idempotent (re-running stays clean)', () => {
    execFileSync('node', [join(HERE, '_build.mjs')], { stdio: 'pipe' });
    const a = readFileSync(LANDING_INDEX, 'utf8');
    execFileSync('node', [join(HERE, '_build.mjs')], { stdio: 'pipe' });
    const b = readFileSync(LANDING_INDEX, 'utf8');
    // Build is deterministic: re-running should yield byte-identical
    // output. Catches duplicate-injection bugs on the marker replace.
    expect(a).toBe(b);
  });
});
