import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next resolves "server-only" in its compiler; tests run server-side, so use its no-op.
      "server-only": "next/dist/compiled/server-only/empty.js",
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
