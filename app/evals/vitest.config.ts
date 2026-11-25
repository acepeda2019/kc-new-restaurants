// The question-bar eval (SAN-67) runs only on request: it calls Claude and spends money, so
// it is outside `npm test` and CI. See run.eval.ts.
import { defineConfig } from "vitest/config";
import base from "../vitest.config";

export default defineConfig({ ...base, test: { ...base.test, include: ["evals/**/*.eval.ts"] } });
