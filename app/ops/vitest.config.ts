// Owner tools that read production data (SAN-68): run on request only, never in `npm test` or CI.
import { defineConfig } from "vitest/config";
import base from "../vitest.config";

export default defineConfig({ ...base, test: { ...base.test, include: ["ops/**/*.run.ts"] } });
