import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets a phone on the same Wi-Fi load the dev server by its LAN address (dev only; ignored in production builds).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  cacheComponents: true,
  // Screens that were merged into others keep working from old bookmarks, notifications and printed links.
  async redirects() {
    return [
      { source: "/sync", destination: "/account", permanent: false },
      { source: "/users", destination: "/settings?tab=people", permanent: false },
      { source: "/purchase", destination: "/orders?kind=po", permanent: false },
      { source: "/dispatch", destination: "/orders?kind=dispatch", permanent: false },
      { source: "/qc", destination: "/quality?tab=inward", permanent: false },
      { source: "/qc/scrap", destination: "/quality?tab=scrap", permanent: false },
      { source: "/pdi", destination: "/quality?tab=pdi", permanent: false },
      { source: "/firstoff", destination: "/quality?tab=firstoff", permanent: false },
      { source: "/rtv", destination: "/quality?tab=rtv", permanent: false },
      { source: "/issue", destination: "/requests", permanent: false },
      { source: "/returns", destination: "/requests", permanent: false },
      { source: "/count", destination: "/stock?view=bins", permanent: false },
      { source: "/approvals", destination: "/stock?view=bins", permanent: false },
      { source: "/returnables", destination: "/fg?tab=crates", permanent: false },
      { source: "/equivalents", destination: "/bom/groups", permanent: false },
      { source: "/reports/variance", destination: "/bom", permanent: false },
    ];
  },
  experimental: {
    agentUpgrade: "security",
  },
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
