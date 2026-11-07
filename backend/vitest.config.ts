import { defineConfig } from "vitest/config";

// Unit tests only — no database required. Scoped explicitly to this
// workspace's own tests directory so this never discovers frontend or e2e
// files, and explicitly excludes integration tests (see
// vitest.integration.config.ts) so a database isn't required just to run
// this fast suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts", "node_modules/**", "dist/**"],
  },
});
