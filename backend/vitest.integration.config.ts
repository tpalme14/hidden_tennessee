import { defineConfig } from "vitest/config";

// Integration tests only — requires landmarks_test to be running (local
// docker-compose or the CI service container). setupFiles installs the
// database safety guard (see tests/setup/vitest.setup.integration.ts)
// before any test file's own imports execute.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.integration.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: ["./tests/setup/vitest.setup.integration.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Integration tests touch a shared database; run them sequentially to
    // avoid cross-test interference.
    fileParallelism: false,
  },
});
