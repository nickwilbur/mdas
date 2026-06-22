import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'scripts/**/*.test.ts',
      'scripts/**/*.test.mts',
    ],
  },
  resolve: {
    // Prefer TypeScript over emitted `.js` in `packages/*/src/` so stale
    // `tsc` artifacts (same basename as `.ts`) never shadow source during tests.
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    alias: {
      '@mdas/canonical': resolve(__dirname, 'packages/canonical/src/index.ts'),
      '@mdas/scoring': resolve(__dirname, 'packages/scoring/src/index.ts'),
      '@mdas/forecast-generator': resolve(__dirname, 'packages/forecast-generator/src/index.ts'),
      '@mdas/renewal-metrics': resolve(__dirname, 'packages/renewal-metrics/src/index.ts'),
      '@mdas/account-plan-engine': resolve(__dirname, 'packages/account-plan-engine/src/index.ts'),
      '@mdas/cta-engine': resolve(__dirname, 'packages/cta-engine/src/index.ts'),
      '@mdas/db': resolve(__dirname, 'packages/db/src/index.ts'),
      '@mdas/slack-send': resolve(__dirname, 'packages/slack-send/src/index.ts'),
      '@/': resolve(__dirname, 'apps/web/src') + '/',
    },
  },
});
