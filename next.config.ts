import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The Windows installer ships the self-contained server (scripts/build-windows.mjs sets this).
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
