import { defineConfig } from "@playwright/test";
import { getVerifiedTestDatabaseUrl } from "./backend/tests/setup/test-db-guard.js";

// Reuses the same guard used by the integration test suite — one single
// source of truth for what counts as a safe test database connection.
// Explicitly rejects any DATABASE_URL_TEST that isn't the approved local/CI
// landmarks_test, with no fallback to a development value.
const testDatabaseUrl = getVerifiedTestDatabaseUrl();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:3000",
  },
  // Chromium only for now (approved scope) — Firefox/WebKit and real
  // mobile/Safari checks are deferred until there's an actual product
  // journey worth cross-browser testing, per the testing-and-verification
  // skill's instruction to record limitations rather than imply coverage
  // that doesn't exist. This is a recorded limitation, not an oversight.
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // Assumes `npm run build` has already run (both local and CI pipelines
    // run build before e2e as a separate, explicit step). Invokes node
    // directly on the built entry point rather than `npm run start` — npm's
    // own process wrapper does not reliably forward termination signals to
    // its child on Windows, which otherwise leaves an orphaned server
    // process listening after the test run ends (confirmed during local
    // verification).
    command: "node backend/dist/server.js",
    url: "http://localhost:3000/health",
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    // Explicit env for the spawned process — never inherits whatever
    // DATABASE_URL happens to be set in the parent shell (e.g. a
    // development value from a sourced .env). Playwright tears this
    // process down automatically when the run completes.
    env: {
      DATABASE_URL: testDatabaseUrl,
      PORT: "3000",
      NODE_ENV: "production",
    },
  },
});
