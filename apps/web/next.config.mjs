// PR-C2 — F-19: optional bundle analyzer.
//
// Enable with `ANALYZE=1 npm --workspace apps/web run build`. Generates
// HTML reports under apps/web/.next/analyze/ that visualize per-page
// chunk composition. Phase 3 should establish a budget (recommended
// initial: 200 kB initial-load JS for /) and wire a CI assertion in
// the lighthouse job.
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === '1',
  openAnalyzer: false,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: { typedRoutes: false },
  transpilePackages: [
    '@mdas/adapter-shared',
    '@mdas/canonical',
    '@mdas/db',
    '@mdas/scoring',
    '@mdas/forecast-generator',
  ],
};
export default withBundleAnalyzer(nextConfig);
