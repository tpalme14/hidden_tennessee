import { assertConnectedToTestDatabase, getVerifiedTestDatabaseUrl } from "./test-db-guard.js";

// Runs in Vitest's setupFiles, which execute in the same worker/process as
// the test file, before that file's own top-level imports are evaluated
// (verified against current Vitest docs — globalSetup does NOT reliably
// propagate process.env changes to test workers, so it is deliberately not
// used for this). This guarantees src/config/env.ts — which reads
// DATABASE_URL at module-load time — never sees anything but the verified
// test database by the time src/db/prisma.ts is first imported.
const testDatabaseUrl = getVerifiedTestDatabaseUrl();
await assertConnectedToTestDatabase(testDatabaseUrl);
process.env.DATABASE_URL = testDatabaseUrl;

// Better Auth (M03-T02): test-only values, set unconditionally so a run never
// depends on — or leaks — a developer's real secret from .env. Not a secret.
process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-not-for-production-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_TELEMETRY = "0";
// The application's own instance never sends mail under test; reset tests
// build dedicated instances with an in-memory transport.
process.env.MAIL_TRANSPORT = "disabled";
