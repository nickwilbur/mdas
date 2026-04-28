import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'] },
  resolve: {
    alias: {
      '@mdas/canonical': resolve(__dirname, 'packages/canonical/src/index.ts'),
      '@mdas/scoring': resolve(__dirname, 'packages/scoring/src/index.ts'),
      '@mdas/forecast-generator': resolve(__dirname, 'packages/forecast-generator/src/index.ts'),
    },
  },
});
