import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets a phone on the same Wi-Fi load the dev server by its LAN address (dev only; ignored in production builds).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  cacheComponents: true,
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }), // slim self-contained build for the Docker image; Vercel builds its own output
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
