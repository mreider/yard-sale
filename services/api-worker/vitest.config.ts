import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Wipes `.wrangler/state` and reapplies D1 migrations before the suite.
    globalSetup: ['./test/global-setup.ts'],
    // unstable_dev spins up a real miniflare runtime, which needs real I/O.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run sequentially: we share a single wrangler dev instance across the suite.
    fileParallelism: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
