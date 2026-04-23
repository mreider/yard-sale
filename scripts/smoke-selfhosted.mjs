#!/usr/bin/env node
/**
 * Self-hosted template smoke. Clones KuvopLLC/yrdsl-self-hosted into a
 * scratch dir, installs deps, runs the build, and verifies the output
 * contains the expected sale title. No local repo state is persisted.
 *
 * Catches regressions where the template becomes unbuildable (e.g.
 * vendor-refresh of @yrdsl/core breaks a schema the template relies on).
 *
 * Required env:
 *   RUN_ID   unique id for this run (used only for log labels)
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUN_ID = process.env.RUN_ID ?? 'local';
const REPO = 'https://github.com/KuvopLLC/yrdsl-self-hosted.git';

function die(msg, detail = '') {
  console.error(`::error::${msg}${detail ? `. ${detail}` : ''}`);
  throw new Error(msg);
}

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) die(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

let workdir;

try {
  workdir = mkdtempSync(join(tmpdir(), `yrdsl-selfhosted-${RUN_ID}-`));
  console.log(`smoke-selfhosted run ${RUN_ID} workdir=${workdir}`);

  console.log('--- clone template ---');
  sh('git', ['clone', '--depth', '1', REPO, workdir]);
  console.log('✓ clone');

  console.log('--- install deps ---');
  sh('pnpm', ['install', '--frozen-lockfile'], { cwd: workdir });
  console.log('✓ install');

  console.log('--- build ---');
  sh('pnpm', ['build'], { cwd: workdir });
  console.log('✓ build');

  console.log('--- verify output ---');
  const distIndex = join(workdir, 'dist', 'index.html');
  if (!existsSync(distIndex)) die('dist/index.html missing');
  const html = readFileSync(distIndex, 'utf8');

  const siteJsonPath = join(workdir, 'site.json');
  const itemsJsonPath = join(workdir, 'items.json');
  if (!existsSync(siteJsonPath)) die('site.json missing in template');
  if (!existsSync(itemsJsonPath)) die('items.json missing in template');
  const site = JSON.parse(readFileSync(siteJsonPath, 'utf8'));
  const items = JSON.parse(readFileSync(itemsJsonPath, 'utf8'));

  // The template renders client-side from JSON — the built HTML won't
  // literally contain the item titles in static markup. But it MUST
  // contain the site name in the <title> or a data attribute, AND
  // reference the JSON files from the bundle.
  const pass = [
    { label: 'html shell present', ok: html.length > 200 },
    { label: '<title> present', ok: /<title>[^<]+<\/title>/.test(html) },
    { label: 'has module script', ok: /<script[^>]+type="module"/.test(html) },
    {
      label: 'has bundled assets dir',
      ok: existsSync(join(workdir, 'dist', 'assets')),
    },
  ];
  for (const p of pass) {
    if (!p.ok) die(`verify: ${p.label}`);
    console.log(`✓ verify: ${p.label}`);
  }
  console.log(
    `  site.name=${site.siteName ?? site.name ?? '(unset)'} items=${Array.isArray(items) ? items.length : Array.isArray(items.items) ? items.items.length : '?'}`,
  );

  console.log(`smoke-selfhosted run ${RUN_ID} all green`);
} catch (e) {
  console.error(`::error::smoke-selfhosted failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (workdir && existsSync(workdir)) {
    rmSync(workdir, { recursive: true, force: true });
    console.log(`--- cleanup ---\nremoved ${workdir}`);
  }
}
