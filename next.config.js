/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    webpackBuildWorker: true,
    parallelServerCompiles: true,
    parallelServerBuildTraces: true,
  },
  typescript: {
    // Skip type checking during build to speed things up
    ignoreBuildErrors: true,
  },
  eslint: {
    // Skip linting during build
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;