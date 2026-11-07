import { Client } from "pg";

// Only these hosts are ever treated as a legitimate integration-test target.
// Local docker-compose and GitHub Actions service containers are both
// reachable on localhost; anything else (including any Render hostname) is
// refused outright, with no fallback.
const ALLOWED_TEST_HOSTS = ["localhost", "127.0.0.1"];
const REQUIRED_TEST_DATABASE_NAME = "landmarks_test";

/**
 * Validates DATABASE_URL_TEST without connecting. Throws on anything that
 * isn't explicitly the approved local/CI test database. Never falls back to
 * DATABASE_URL (development) or any other variable.
 */
export function getVerifiedTestDatabaseUrl(): string {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      "DATABASE_URL_TEST is not set. Refusing to run integration tests without an explicit, dedicated test database connection.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error("DATABASE_URL_TEST is not a valid connection URL.");
  }

  if (!ALLOWED_TEST_HOSTS.includes(parsed.hostname)) {
    throw new Error(
      `DATABASE_URL_TEST points to host "${parsed.hostname}", which is not in the approved ` +
        `local/CI test host allow-list (${ALLOWED_TEST_HOSTS.join(", ")}). Refusing to run ` +
        "integration tests against it.",
    );
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (databaseName !== REQUIRED_TEST_DATABASE_NAME) {
    throw new Error(
      `DATABASE_URL_TEST names database "${databaseName}", not the required ` +
        `"${REQUIRED_TEST_DATABASE_NAME}". Refusing to run integration tests against a ` +
        "non-test database.",
    );
  }

  return testUrl;
}

/**
 * Connects using the given (already-validated) URL and independently
 * confirms, via the live connection itself, that the database actually
 * reached is landmarks_test — not just that the URL string claimed so.
 * Required before any destructive operation (e.g. table resets).
 */
export async function assertConnectedToTestDatabase(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ current_database: string }>("SELECT current_database()");
    const actual = rows[0]?.current_database;
    if (actual !== REQUIRED_TEST_DATABASE_NAME) {
      throw new Error(
        `Connected database is "${actual}", not the required ` +
          `"${REQUIRED_TEST_DATABASE_NAME}". Refusing to proceed.`,
      );
    }
  } finally {
    await client.end();
  }
}
