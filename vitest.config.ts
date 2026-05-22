import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts'] },
  resolve: {
    // Prefer TypeScript over emitted `.js` in `packages/*/src/` so stale
    // `tsc` artifacts (same basename as `.ts`) never shadow source during tests.
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    alias: {
      '@mdas/canonical': resolve(__dirname, 'packages/canonical/src/index.ts'),
      '@mdas/scoring': resolve(__dirname, 'packages/scoring/src/index.ts'),
      '@mdas/forecast-generator': resolve(__dirname, 'packages/forecast-generator/src/index.ts'),
      '@mdas/slack-send': resolve(__dirname, 'packages/slack-send/src/index.ts'),
      '@/': resolve(__dirname, 'apps/web/src') + '/',
    },
  },
});
