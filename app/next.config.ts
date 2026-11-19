import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/data.ts opts its fs reads out of tracing; /api/ask reads the JSON at request time,
  // so ship it with that function (the real export, else the labelled sample).
  outputFileTracingIncludes: {
    "/api/ask": ["./data/*.json", "./data/sample/*.json"],
  },
};

export default nextConfig;
