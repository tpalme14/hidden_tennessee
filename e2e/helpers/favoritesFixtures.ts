import { createHash, randomInt } from "node:crypto";
import { Client } from "pg";
import { test as base, expect, type APIRequestContext, type TestInfo } from "@playwright/test";
import { getVerifiedTestDatabaseUrl } from "../../backend/tests/setup/test-db-guard.js";

/**
 * Synthetic landmark fixtures for real favorites E2E tests (M03-T06
 * Increment 6B; approved design 6A with decisions R1–R4).
 *
 * SAFETY — every database statement runs inside `withGuardedTransaction`:
 *   1. `getVerifiedTestDatabaseUrl()` (the existing guard: DATABASE_URL_TEST
 *      set, host localhost/127.0.0.1, database name exactly `landmarks_test`,
 *      no fallback) — BEFORE any connection is opened;
 *   2. its own connection, `BEGIN` (or `BEGIN READ ONLY` for reports);
 *   3. on THAT connection: `current_database()` must be `landmarks_test` and
 *      the `landmarks` and `favorites` tables must exist — otherwise ROLLBACK;
 *   4. the caller's statements, then COMMIT (ROLLBACK on any failure).
 * No database client, query function, or transaction helper is exported.
 *
 * OWNERSHIP — a run tag (set once in playwright.config.ts, shared by all
 * workers) and a per-test tag appear in every fixture name:
 * `E2E Fixture <run> <test> <Role> Site`. A test owns exactly the landmark rows
 * it recorded (ID + source code + name). Every UPDATE and DELETE first locks
 * and verifies those rows — exact ID, exact source code in the `ZZ` namespace,
 * exact name carrying this run's and this test's tags — and refuses the whole
 * operation if any row does not match. Favorites are deleted only for
 * verified IDs. Nothing is ever deleted by tag, age, or prefix alone, and
 * fixtures from other runs are never deleted (they are only reported).
 *
 * WHAT IS WRITTEN HERE vs. THROUGH THE APP — this module inserts fixture
 * landmarks, changes their status, and tears them down. It never inserts or
 * updates favorites or reviews rows; both are created only through the real
 * API/UI (session cookie, trusted Origin, CSRF, throttling), and only after
 * `expectServerView` has shown the server reads the same database.
 *
 * REVIEWS (M04-T03 Increment 5) — reviews reference landmarks with ON DELETE
 * RESTRICT, so teardown deletes the reviews on this test's VERIFIED fixture
 * IDs (whoever wrote them — always synthetic test accounts) before the
 * landmarks, in the same guarded transaction. Reviews on any other landmark
 * are never touched. The abandoned-fixture report also counts reviews left on
 * other runs' fixtures (reported, never deleted).
 *
 * GEOGRAPHY (R1) — fixtures sit near 0.5°N 160.5°W, far outside the default
 * Tennessee view, so unmocked discovery specs never fetch them. Names avoid
 * words existing specs search for ("Falls").
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The target database failed a guard check; nothing was written. */
export class FixtureGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureGuardError";
  }
}

/** Recorded fixture rows did not match what the database holds; nothing was changed. */
export class FixtureOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureOwnershipError";
  }
}

// ---------------------------------------------------------------------------
// Tags, names, namespace
// ---------------------------------------------------------------------------

export const RUN_TAG_ENV = "E2E_FIXTURE_RUN";
const TAG_SYNTAX = /^[a-z0-9]{6}$/;
const SOURCE_CODE_SYNTAX = /^ZZ[A-Z][0-9]{3}$/;
const NAME_PREFIX = "E2E Fixture";
const MAX_CODE_ATTEMPTS = 10;
const REQUIRED_DATABASE = "landmarks_test";

/** The run tag shared by every worker of this Playwright run (R3). */
export function currentRunTag(): string {
  const tag = process.env[RUN_TAG_ENV];
  if (tag === undefined || !TAG_SYNTAX.test(tag)) {
    throw new FixtureGuardError(
      `${RUN_TAG_ENV} must be a 6-character [a-z0-9] tag (set in playwright.config.ts).`,
    );
  }
  return tag;
}

/** A stable 6-character tag for one test attempt (test ID + retry). */
export function testTagFor(testInfo: Pick<TestInfo, "testId" | "retry">): string {
  return createHash("sha256")
    .update(`${testInfo.testId}#${testInfo.retry}`)
    .digest("hex")
    .slice(0, 6);
}

export type FixtureRole = "public" | "hidden" | "retired" | StopRole;

/**
 * Extra PUBLIC landmarks for trip journeys (M05-T04 Increment 6), created only
 * by `createStopFixtures`. Distinct coordinates inside the fixture region,
 * except stop4, which deliberately shares stop3's point (coincident markers).
 */
export type StopRole = "stop1" | "stop2" | "stop3" | "stop4";
export const STOP_ROLES: readonly StopRole[] = ["stop1", "stop2", "stop3", "stop4"];

const ROLE_SPEC: Record<
  FixtureRole,
  { label: string; sourceFile: string; category: string; latitude: number; longitude: number }
> = {
  public: {
    label: "Public",
    sourceFile: "TNFALLS",
    category: "FALLS",
    latitude: 0.5,
    longitude: -160.5,
  },
  hidden: {
    label: "Hidden",
    sourceFile: "TNARCHES",
    category: "ARCH",
    latitude: 0.52,
    longitude: -160.48,
  },
  retired: {
    label: "Retired",
    sourceFile: "TNBALDS",
    category: "BALD",
    latitude: 0.54,
    longitude: -160.46,
  },
  stop1: {
    label: "Stop1",
    sourceFile: "TNFALLS",
    category: "FALLS",
    latitude: 0.45,
    longitude: -160.55,
  },
  stop2: {
    label: "Stop2",
    sourceFile: "TNARCHES",
    category: "ARCH",
    latitude: 0.47,
    longitude: -160.53,
  },
  stop3: {
    label: "Stop3",
    sourceFile: "TNFALLS",
    category: "FALLS",
    latitude: 0.49,
    longitude: -160.51,
  },
  stop4: {
    label: "Stop4",
    sourceFile: "TNFALLS",
    category: "FALLS",
    latitude: 0.49,
    longitude: -160.51,
  },
};

/** The URL `bbox` (minLng,minLat,maxLng,maxLat) enclosing every fixture location. */
export const FIXTURE_REGION_BBOX = "-160.6,0.4,-160.4,0.6";

function fixtureName(runTag: string, testTag: string, role: FixtureRole): string {
  return `${NAME_PREFIX} ${runTag} ${testTag} ${ROLE_SPEC[role].label} Site`;
}

function randomSourceCode(): string {
  const letter = String.fromCharCode(65 + randomInt(26));
  return `ZZ${letter}${String(randomInt(1000)).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Guarded transactions (module-private)
// ---------------------------------------------------------------------------

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

/** The minimal client surface used here (satisfied by `pg.Client`). */
export interface FixtureDbClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  end(): Promise<unknown>;
}

type Query = (text: string, values?: unknown[]) => Promise<QueryResult>;

const defaultConnect = (connectionString: string): FixtureDbClient =>
  new Client({ connectionString }) as unknown as FixtureDbClient;

async function withGuardedTransaction<T>(
  connect: (url: string) => FixtureDbClient,
  mode: "read" | "write",
  work: (query: Query) => Promise<T>,
): Promise<T> {
  // 1. URL guard — throws before any connection exists.
  let url: string;
  try {
    url = getVerifiedTestDatabaseUrl();
  } catch (error) {
    throw new FixtureGuardError((error as Error).message);
  }

  const client = connect(url);
  await client.connect();
  try {
    await client.query(mode === "read" ? "BEGIN READ ONLY" : "BEGIN");
    try {
      // 2. Live identity on the SAME connection that will run the statements.
      const identity = await client.query(
        "SELECT current_database() AS database, " +
          "to_regclass('public.landmarks') IS NOT NULL AS has_landmarks, " +
          "to_regclass('public.favorites') IS NOT NULL AS has_favorites",
      );
      const row = identity.rows[0] ?? {};
      if (row.database !== REQUIRED_DATABASE) {
        throw new FixtureGuardError(
          `Connected database is "${String(row.database)}", not "${REQUIRED_DATABASE}". Nothing was written.`,
        );
      }
      if (row.has_landmarks !== true || row.has_favorites !== true) {
        throw new FixtureGuardError(
          "The landmarks and favorites tables must exist (migrations applied). Nothing was written.",
        );
      }
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");

      const result = await work((text, values) => client.query(text, values));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface FixtureLandmark {
  role: FixtureRole;
  id: string;
  sourceCode: string;
  displayName: string;
}

export interface FixtureOwner {
  runTag: string;
  testTag: string;
}

export interface AbandonedFixtureReport {
  /** Fixture landmarks in `landmarks_test` that belong to OTHER runs. Never deleted here. */
  count: number;
  runTags: string[];
  oldestCreatedAt: string | null;
  /** Reviews on those other runs' fixture landmarks (M04-T03). Never deleted here. */
  reviewCount: number;
}

export interface TeardownResult {
  landmarksDeleted: number;
  favoritesDeleted: number;
  /** Reviews on this test's verified fixtures (M04-T03), deleted before the landmarks. */
  reviewsDeleted: number;
}

export interface TestFixtures {
  owner: FixtureOwner;
  public: FixtureLandmark;
  hidden: FixtureLandmark;
  retired: FixtureLandmark;
  /** Guarded: makes the `hidden` fixture SENSITIVE (its favorite then lists as redacted). */
  makeHiddenSensitive(): Promise<void>;
  /** Guarded: retires the `retired` fixture (its favorite then lists as unavailable). */
  retire(): Promise<void>;
  /** Guarded, idempotent: deletes this test's favorites rows on its fixtures, then the fixtures. */
  teardown(): Promise<TeardownResult>;
}

export interface FixtureStore {
  readonly runTag: string;
  /** Inserts three active PUBLIC fixtures in ONE guarded transaction (all or nothing). */
  createTestFixtures(testTag: string): Promise<TestFixtures>;
  /**
   * Guarded teardown of `owned` rows for `owner`. Verifies every row first;
   * refuses everything if any row is missing or does not match. An empty list
   * sends nothing.
   */
  teardownOwned(owner: FixtureOwner, owned: readonly FixtureLandmark[]): Promise<TeardownResult>;
  /** Guarded READ ONLY: the current state of the given IDs (for assertions). */
  findLandmarks(
    ids: readonly string[],
  ): Promise<
    { id: string; sourceCode: string; displayName: string; isActive: boolean; status: string }[]
  >;
  /** Guarded READ ONLY: fixture rows left by OTHER runs (reported, never deleted). */
  reportAbandoned(): Promise<AbandonedFixtureReport>;
  /** Inserts four extra active PUBLIC fixtures (`stop1`…`stop4`) in ONE guarded transaction. */
  createStopFixtures(testTag: string): Promise<FixtureLandmark[]>;
  /** Guarded: deletes this test's trip data (see the implementation) before any landmark teardown. */
  deleteTripData(
    owner: FixtureOwner,
    owned: readonly FixtureLandmark[],
    accountEmails: readonly string[],
  ): Promise<{ tripsDeleted: number; stopsDeleted: number }>;
}

/**
 * Locks and verifies owned rows; returns their IDs only if EVERY row matches
 * exactly. Must run inside a guarded write transaction.
 */
async function verifyOwned(
  query: Query,
  owner: FixtureOwner,
  owned: readonly FixtureLandmark[],
): Promise<string[]> {
  const expectedPrefix = `${NAME_PREFIX} ${owner.runTag} ${owner.testTag} `;
  for (const landmark of owned) {
    if (!SOURCE_CODE_SYNTAX.test(landmark.sourceCode)) {
      throw new FixtureOwnershipError(
        "A recorded source code is outside the ZZ fixture namespace.",
      );
    }
    if (landmark.displayName !== fixtureName(owner.runTag, owner.testTag, landmark.role)) {
      throw new FixtureOwnershipError("A recorded name does not carry this run's and test's tags.");
    }
  }
  const ids = owned.map((l) => l.id);
  if (new Set(ids).size !== ids.length) {
    throw new FixtureOwnershipError("Recorded landmark IDs are not unique.");
  }

  const { rows } = await query(
    "SELECT id::text AS id, source_code, display_name FROM landmarks WHERE id = ANY($1::uuid[]) FOR UPDATE",
    [ids],
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  for (const landmark of owned) {
    const row = byId.get(landmark.id);
    if (
      row === undefined ||
      row.source_code !== landmark.sourceCode ||
      row.display_name !== landmark.displayName ||
      !String(row.display_name).startsWith(expectedPrefix)
    ) {
      throw new FixtureOwnershipError(
        "A recorded landmark is missing or does not match its fixture record. Nothing was changed.",
      );
    }
  }
  return ids;
}

export function createFixtureStore(
  options: {
    /** Test seam for the guard spec only: a spy connection. The guards still run on it. */
    connect?: (url: string) => FixtureDbClient;
  } = {},
): FixtureStore {
  const connect = options.connect ?? defaultConnect;
  const runTag = currentRunTag();

  async function teardownOwned(
    owner: FixtureOwner,
    owned: readonly FixtureLandmark[],
  ): Promise<TeardownResult> {
    if (owned.length === 0) return { landmarksDeleted: 0, favoritesDeleted: 0, reviewsDeleted: 0 };
    return withGuardedTransaction(connect, "write", async (query) => {
      const ids = await verifyOwned(query, owner, owned);
      // Only the verified fixture IDs: reviews on any other landmark are never touched.
      const reviews = await query("DELETE FROM reviews WHERE landmark_id = ANY($1::uuid[])", [ids]);
      const favorites = await query("DELETE FROM favorites WHERE landmark_id = ANY($1::uuid[])", [
        ids,
      ]);
      const landmarks = await query(
        "DELETE FROM landmarks WHERE id = ANY($1::uuid[]) AND source_code LIKE 'ZZ%' " +
          "AND display_name LIKE $2",
        [ids, `${NAME_PREFIX} ${owner.runTag} ${owner.testTag} %`],
      );
      if (landmarks.rowCount !== ids.length) {
        throw new FixtureOwnershipError(
          `Expected to delete ${ids.length} fixture landmarks, matched ${String(landmarks.rowCount)}. Rolled back.`,
        );
      }
      return {
        landmarksDeleted: ids.length,
        favoritesDeleted: favorites.rowCount ?? 0,
        reviewsDeleted: reviews.rowCount ?? 0,
      };
    });
  }

  async function updateOwned(
    owner: FixtureOwner,
    landmark: FixtureLandmark,
    assignment: "sensitive" | "retired",
  ): Promise<void> {
    await withGuardedTransaction(connect, "write", async (query) => {
      const [id] = await verifyOwned(query, owner, [landmark]);
      const set =
        assignment === "sensitive"
          ? `sensitivity_status = 'SENSITIVE'::"SensitivityReviewStatus"`
          : "is_active = false";
      const result = await query(
        `UPDATE landmarks SET ${set}, updated_at = now() ` +
          "WHERE id = $1::uuid AND source_code = $2 AND display_name = $3 AND source_code LIKE 'ZZ%'",
        [id, landmark.sourceCode, landmark.displayName],
      );
      if (result.rowCount !== 1) {
        throw new FixtureOwnershipError("Fixture update matched no row. Rolled back.");
      }
    });
  }

  /** Inserts one active PUBLIC fixture for `role` (inside a guarded write transaction). */
  async function insertFixture(
    query: Query,
    testTag: string,
    role: FixtureRole,
  ): Promise<FixtureLandmark> {
    const spec = ROLE_SPEC[role];
    const displayName = fixtureName(runTag, testTag, role);
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const sourceCode = randomSourceCode();
      const result = await query(
        "INSERT INTO landmarks (source_code, source_file, category, display_name, latitude, " +
          "longitude, is_active, sensitivity_status, updated_at) VALUES ($1, " +
          `$2::"LandmarkSourceFile", $3::"LandmarkCategory", $4, $5, $6, true, ` +
          `'PUBLIC'::"SensitivityReviewStatus", now()) ` +
          "ON CONFLICT (source_code) DO NOTHING RETURNING id::text AS id",
        [sourceCode, spec.sourceFile, spec.category, displayName, spec.latitude, spec.longitude],
      );
      const id = result.rows[0]?.id;
      if (typeof id === "string") return { role, id, sourceCode, displayName };
    }
    throw new FixtureGuardError(
      `No free ZZ source code after ${MAX_CODE_ATTEMPTS} attempts. Rolled back.`,
    );
  }

  async function createStopFixtures(testTag: string): Promise<FixtureLandmark[]> {
    if (!TAG_SYNTAX.test(testTag)) {
      throw new FixtureGuardError("A test tag must be 6 characters [a-z0-9].");
    }
    return withGuardedTransaction(connect, "write", async (query) => {
      const rows: FixtureLandmark[] = [];
      for (const role of STOP_ROLES) rows.push(await insertFixture(query, testTag, role));
      return rows;
    });
  }

  /**
   * Trip data created by this test (M05-T04 Increment 6), removed BEFORE its
   * landmarks (trip stops reference landmarks with RESTRICT): every trip of the
   * given test accounts — which must be this run's `e2e-trip-<run>-…` addresses —
   * and then any remaining stop on this test's verified fixtures that belongs to
   * such an account. Nothing else is touched; a stop on these fixtures owned by
   * any other account is left in place (the landmark teardown then fails loudly).
   */
  async function deleteTripData(
    owner: FixtureOwner,
    owned: readonly FixtureLandmark[],
    accountEmails: readonly string[],
  ): Promise<{ tripsDeleted: number; stopsDeleted: number }> {
    const accountPattern = `e2e-trip-${runTag}-%@example.com`;
    const accountSyntax = new RegExp(`^e2e-trip-${runTag}-[a-z0-9-]+@example[.]com$`);
    for (const email of accountEmails) {
      if (!accountSyntax.test(email)) {
        throw new FixtureOwnershipError(
          "A recorded account is outside this run's e2e-trip namespace.",
        );
      }
    }
    if (owned.length === 0 && accountEmails.length === 0)
      return { tripsDeleted: 0, stopsDeleted: 0 };
    return withGuardedTransaction(connect, "write", async (query) => {
      const ids = owned.length === 0 ? [] : await verifyOwned(query, owner, owned);
      const trips =
        accountEmails.length === 0
          ? { rowCount: 0 }
          : await query(
              "DELETE FROM trips t USING users u WHERE u.id = t.user_id AND u.email = ANY($1::text[]) " +
                "AND u.email LIKE $2",
              [[...accountEmails], accountPattern],
            );
      const stops =
        ids.length === 0
          ? { rowCount: 0 }
          : await query(
              "DELETE FROM trip_stops s USING trips t, users u WHERE s.landmark_id = ANY($1::uuid[]) " +
                "AND t.id = s.trip_id AND u.id = t.user_id AND u.email LIKE $2",
              [ids, accountPattern],
            );
      return { tripsDeleted: trips.rowCount ?? 0, stopsDeleted: stops.rowCount ?? 0 };
    });
  }

  async function createTestFixtures(testTag: string): Promise<TestFixtures> {
    if (!TAG_SYNTAX.test(testTag)) {
      throw new FixtureGuardError("A test tag must be 6 characters [a-z0-9].");
    }
    const owner: FixtureOwner = { runTag, testTag };

    const created = await withGuardedTransaction(connect, "write", async (query) => {
      const rows: FixtureLandmark[] = [];
      for (const role of ["public", "hidden", "retired"] as const) {
        rows.push(await insertFixture(query, testTag, role));
      }
      return rows;
    });

    // Recorded only once committed; a failed transaction leaves nothing to clean up.
    const [pub, hidden, retired] = created as [FixtureLandmark, FixtureLandmark, FixtureLandmark];
    let remaining: FixtureLandmark[] = [...created];
    return {
      owner,
      public: pub,
      hidden,
      retired,
      makeHiddenSensitive: () => updateOwned(owner, hidden, "sensitive"),
      retire: () => updateOwned(owner, retired, "retired"),
      async teardown() {
        const result = await teardownOwned(owner, remaining);
        remaining = [];
        return result;
      },
    };
  }

  async function findLandmarks(ids: readonly string[]) {
    if (ids.length === 0) return [];
    return withGuardedTransaction(connect, "read", async (query) => {
      const { rows } = await query(
        "SELECT id::text AS id, source_code, display_name, is_active, sensitivity_status::text AS status " +
          "FROM landmarks WHERE id = ANY($1::uuid[])",
        [[...ids]],
      );
      return rows.map((r) => ({
        id: String(r.id),
        sourceCode: String(r.source_code),
        displayName: String(r.display_name),
        isActive: r.is_active === true,
        status: String(r.status),
      }));
    });
  }

  async function reportAbandoned(): Promise<AbandonedFixtureReport> {
    return withGuardedTransaction(connect, "read", async (query) => {
      const { rows } = await query(
        "SELECT display_name, created_at FROM landmarks " +
          "WHERE source_code LIKE 'ZZ%' AND display_name LIKE $1 AND display_name NOT LIKE $2 " +
          "ORDER BY created_at ASC",
        [`${NAME_PREFIX} %`, `${NAME_PREFIX} ${runTag} %`],
      );
      const runTags = [
        ...new Set(rows.map((r) => String(r.display_name).split(" ")[2] ?? "?")),
      ].sort();
      const oldest = rows[0]?.created_at;
      const reviews = await query(
        "SELECT count(*)::int AS n FROM reviews r JOIN landmarks l ON l.id = r.landmark_id " +
          "WHERE l.source_code LIKE 'ZZ%' AND l.display_name LIKE $1 AND l.display_name NOT LIKE $2",
        [`${NAME_PREFIX} %`, `${NAME_PREFIX} ${runTag} %`],
      );
      return {
        count: rows.length,
        runTags,
        oldestCreatedAt:
          oldest instanceof Date ? oldest.toISOString() : oldest ? String(oldest) : null,
        reviewCount: Number(reviews.rows[0]?.n ?? 0),
      };
    });
  }

  return {
    runTag,
    createTestFixtures,
    createStopFixtures,
    deleteTripData,
    teardownOwned,
    findLandmarks,
    reportAbandoned,
  };
}

// ---------------------------------------------------------------------------
// Server identity: the running server must read the same database
// ---------------------------------------------------------------------------

/**
 * Asserts what the REAL server's public landmark endpoint returns for a
 * fixture: `full` (PUBLIC), `minimal` (redacted), or `not_found` (retired).
 * Called with `full` before any API- or UI-driven mutation; a server reading
 * another database answers 404 and the test stops there.
 */
export async function expectServerView(
  request: APIRequestContext,
  landmark: FixtureLandmark,
  view: "full" | "minimal" | "not_found",
): Promise<void> {
  const response = await request.get(`/api/v1/landmarks/${landmark.id}`);
  if (view === "not_found") {
    expect(response.status(), "retired fixture is not served").toBe(404);
    return;
  }
  expect(
    response.status(),
    "the server must see this fixture (is it reading landmarks_test?)",
  ).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.id).toBe(landmark.id);
  expect(body.display_name).toBe(landmark.displayName);
  if (view === "minimal") expect(body.redacted).toBe(true);
  else expect(body).not.toHaveProperty("redacted");
}

// ---------------------------------------------------------------------------
// Playwright fixtures for favorites specs (used from Increment 6C)
// ---------------------------------------------------------------------------

export const test = base.extend<{ favoriteFixtures: TestFixtures }, { fixtureStore: FixtureStore }>(
  {
    fixtureStore: [
      // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern
      async ({}, use, workerInfo) => {
        const store = createFixtureStore();
        const report = await store.reportAbandoned();
        console.log(`[fixtures] run=${store.runTag} worker=${workerInfo.workerIndex}`);
        if (report.count > 0) {
          console.warn(
            `[fixtures] ${report.count} fixture landmark(s) from earlier runs remain ` +
              `(runs: ${report.runTags.join(", ")}; oldest ${report.oldestCreatedAt}; ` +
              `${report.reviewCount} review(s) on them). Not deleted.`,
          );
        }
        await use(store);
      },
      { scope: "worker" },
    ],

    favoriteFixtures: async ({ fixtureStore, request }, use, testInfo) => {
      // All-or-nothing: if this throws, no row exists and there is nothing to tear down.
      const fixtures = await fixtureStore.createTestFixtures(testTagFor(testInfo));
      try {
        // Before any API- or UI-driven mutation: the server reads this database.
        await expectServerView(request, fixtures.public, "full");
        await use(fixtures);
      } finally {
        // Runs after assertion failures and timeouts too.
        await fixtures.teardown();
      }
    },
  },
);

export { expect };
