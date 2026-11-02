import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The Windows installer ships the self-contained server (scripts/build-windows.mjs sets this).
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Build workers. Shared hosting (Hostinger) reports dozens of CPUs but caps threads per account,
    // so its build sets NEXT_BUILD_CPUS low; elsewhere Next.js picks the count.
    cpus: Number(process.env.NEXT_BUILD_CPUS) || undefined,
  },
};

export default nextConfig;
