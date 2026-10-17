import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IMS Scanner",
    short_name: "IMS Scan",
    description: "Store scanning for the injection moulding inventory system",
    start_url: "/scan",
    scope: "/scan",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f172a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
