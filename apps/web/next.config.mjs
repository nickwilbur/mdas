// PR-C2 — F-19: optional bundle analyzer.
//
// Enable with `ANALYZE=1 npm --workspace apps/web run build`. Generates
// HTML reports under apps/web/.next/analyze/ that visualize per-page
// chunk composition. Phase 3 should establish a budget (recommended
// initial: 200 kB initial-load JS for /) and wire a CI assertion in
// the lighthouse job.
import bundleAnalyzer from '@next/bundle-analyzer';
import nextEnv from '@next/env';
import path from 'path';
import { fileURLToPath } from 'url';

// Monorepo: shared .env lives at the repo root, not under apps/web.
// Without this, `next dev` started outside restart.sh (or after the
// parent shell loses exported vars) cannot see GLEAN_MCP_* / DATABASE_URL.
nextEnv.loadEnvConfig(path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === '1',
  openAnalyzer: false,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: { typedRoutes: false },
  transpilePackages: [
    '@mdas/account-plan-engine',
    '@mdas/adapter-cerebro-rest',
    '@mdas/adapter-glean-mcp',
    '@mdas/adapter-shared',
    '@mdas/canonical',
    '@mdas/cse-activity',
    '@mdas/cta-engine',
    '@mdas/db',
    '@mdas/forecast-generator',
    '@mdas/renewal-metrics',
    '@mdas/scoring',
    '@mdas/slack-send',
  ],
  // Resolve ESM-style `.js` import suffixes against their `.ts` source.
  //
  // Internal packages (e.g. @mdas/scoring, @mdas/forecast-generator)
  // are authored in TypeScript with the
  // `moduleResolution: bundler` + ESM-on-disk convention, which
  // requires relative imports to carry an explicit extension. They
  // write `from './foo.js'` so the same source compiles cleanly under
  // both Node ESM (after a `tsc` emit to .js) and `tsx` (which reads
  // .ts directly via path stripping).
  //
  // Next.js's default webpack resolver doesn't know about this
  // mapping for files inside `transpilePackages`, so a bare
  // `from './foo.js'` resolves to a literal `foo.js` that doesn't
  // exist on disk and the build fails with "Module not found".
  // The `extensionAlias` field tells webpack: "when you see a
  // request ending in .js, also try .ts (and .tsx) before giving up".
  // This matches the TS recommendation in
  // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#--moduleresolution-bundler
  // and removes the foot-gun without touching package source.
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
};
export default withBundleAnalyzer(nextConfig);
