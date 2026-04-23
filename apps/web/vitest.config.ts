import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Component tests for apps/web. happy-dom over jsdom because the SPA
 * doesn't need anything esoteric and happy-dom is 4-5x faster to boot.
 * Tests live alongside the source (Tokens.test.tsx next to Tokens.tsx)
 * so they're easy to find and maintain.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
