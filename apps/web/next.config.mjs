/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: { typedRoutes: false },
  transpilePackages: ['@mdas/canonical', '@mdas/db', '@mdas/scoring', '@mdas/forecast-generator'],
};
export default nextConfig;
