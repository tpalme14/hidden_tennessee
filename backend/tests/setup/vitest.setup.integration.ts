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
