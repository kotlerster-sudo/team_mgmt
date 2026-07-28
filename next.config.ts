import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
  },
  // Native .node bindings / WASM — must not be bundled by Turbopack
  serverExternalPackages: ["@resvg/resvg-js", "mupdf"],
  // mupdf loads its .wasm via new URL("…", import.meta.url), which the file
  // tracer misses — force-include the dist so PDF rasterization works at runtime.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/mupdf/dist/**/*"],
    // Scouting-day HTML docs read from disk at runtime (recruitment pages + API)
    "/api/recruitment/**": ["./content/recruitment/**/*"],
    "/recruitment": ["./content/recruitment/**/*"],
    "/recruitment/**": ["./content/recruitment/**/*"],
  },
};

export default nextConfig;
