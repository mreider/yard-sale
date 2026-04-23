#!/usr/bin/env node
/**
 * Bundle-size guard for apps/web. Runs after `pnpm --filter @yrdsl/web build`
 * and exits non-zero if any of the generated assets blow past the budget.
 *
 * Why: catch accidental heavy deps (date-fns, moment, lodash, an entire
 *      icon set) before they ship to users on slow connections.
 *
 * Budget rationale: current build is ~291KB raw / 87KB gzip JS. Headroom
 * of ~1.4x leaves room for normal feature growth without rubber-stamping
 * a 2x regression.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ASSET_DIR = 'apps/web/dist/assets';

// Per-file budgets, in bytes. raw == filesystem size, gz == gzip -9.
const BUDGETS = {
  js: { raw: 400_000, gz: 120_000 },
  css: { raw: 25_000, gz: 8_000 },
};

let failed = false;
const results = [];

let entries;
try {
  entries = readdirSync(ASSET_DIR);
} catch (err) {
  console.error(
    `Could not read ${ASSET_DIR}. Did you run \`pnpm --filter @yrdsl/web build\` first?`,
  );
  console.error(err.message);
  process.exit(1);
}

for (const name of entries) {
  if (!/\.(js|css)$/.test(name)) continue; // skip source maps + others
  const ext = name.endsWith('.js') ? 'js' : 'css';
  const path = join(ASSET_DIR, name);
  const raw = statSync(path).size;
  const gz = gzipSync(readFileSync(path), { level: 9 }).byteLength;
  const budget = BUDGETS[ext];
  const ok = raw <= budget.raw && gz <= budget.gz;
  if (!ok) failed = true;
  results.push({ name, raw, gz, budget, ok });
}

const fmt = (n) => `${(n / 1024).toFixed(1).padStart(6)} KB`;
console.log('bundle-size check:');
for (const r of results) {
  const tag = r.ok ? 'ok ' : 'FAIL';
  console.log(
    `  [${tag}] ${r.name}  raw ${fmt(r.raw)} (≤ ${fmt(r.budget.raw)})  gz ${fmt(r.gz)} (≤ ${fmt(r.budget.gz)})`,
  );
}

if (failed) {
  console.error(
    '\nbundle-size check failed. Either trim the bundle or bump the budget in scripts/check-bundle-size.mjs (and explain why in the PR).',
  );
  process.exit(1);
}
console.log('all under budget.');
