import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiWorkerDir = resolve(__dirname, '..');

/**
 * Vitest global setup. runs once before the whole suite.
 *
 * CI starts from a blank container with no `.wrangler/state/` dir, so the tests
 * need to create local D1 schema themselves. We wipe any existing D1 state and
 * re-apply migrations with `wrangler d1 migrations apply --local -y`, which
 * uses `migrations_dir = "../../migrations"` from wrangler.toml.
 *
 * Wiping is safe: these tests do not share data with `wrangler dev`. the dev
 * DB has no real user data yet, and anything we seed here is disposable.
 */
export async function setup() {
  // Nuke the whole miniflare state dir — D1 AND KV. KV stores the
  // rate-limit buckets, and accumulated test runs were exhausting the
  // per-IP signup/confirm budgets after the Nth run.
  const stateDir = resolve(apiWorkerDir, '.wrangler/state');
  try {
    rmSync(stateDir, { recursive: true, force: true });
  } catch {
    // No prior state. fine.
  }
  // Wrangler auto-skips the confirm prompt in non-TTY environments (CI & vitest).
  execSync('pnpm exec wrangler d1 migrations apply yard-sale --local', {
    cwd: apiWorkerDir,
    stdio: 'inherit',
  });
}
