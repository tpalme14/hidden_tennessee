import { randomUUID } from "node:crypto";
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import {
  createFixtureStore,
  currentRunTag,
  expectServerView,
  FixtureGuardError,
  FixtureOwnershipError,
  RUN_TAG_ENV,
  test as fixtureTest,
  type FixtureDbClient,
  type FixtureLandmark,
} from "./helpers/favoritesFixtures";

/**
 * M03-T06 Increment 6B — guards and ownership checks of the synthetic
 * favorites fixtures.
 *
 * Part 1 uses a SPY connection (no database): wrong targets are refused
 * before any connection, or on the live connection before any write;
 * partial failures roll back. Part 2 uses the real `landmarks_test` and the
 * real production-mode server: lifecycle, server identity, ownership
 * refusals, favorites cleanup, and teardown after a failed assertion.
 */

const WRITE = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i;
const ORIGIN = "http://localhost:3000";

// ---------------------------------------------------------------------------
// Spy connection and environment helpers
// ---------------------------------------------------------------------------

interface SpyOptions {
  database?: string;
  tablesExist?: boolean;
  /** Results of successive INSERTs: an ID, or null for a source-code conflict. */
  inserts?: (string | null)[];
  /** Throw on the Nth INSERT (1-based). */
  failOnInsert?: number;
}

function spy(options: SpyOptions = {}) {
  const statements: string[] = [];
  let connections = 0;
  let insertCount = 0;
  const inserts = [...(options.inserts ?? [])];
  const connect = (): FixtureDbClient => {
    connections += 1;
    return {
      connect: async () => undefined,
      end: async () => undefined,
      async query(text: string) {
        statements.push(text);
        if (text.startsWith("SELECT current_database()")) {
          const tables = options.tablesExist ?? true;
          return {
            rows: [
              {
                database: options.database ?? "landmarks_test",
                has_landmarks: tables,
                has_favorites: tables,
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith("INSERT")) {
          insertCount += 1;
          if (insertCount === options.failOnInsert) throw new Error("injected insert failure");
          const next = inserts.length > 0 ? inserts.shift() : randomUUID();
          return next ? { rows: [{ id: next }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  };
  return {
    connect,
    statements,
    connections: () => connections,
    writes: () => statements.filter((s) => WRITE.test(s)),
  };
}

async function withTestUrl<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.DATABASE_URL_TEST;
  if (value === undefined) delete process.env.DATABASE_URL_TEST;
  else process.env.DATABASE_URL_TEST = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = previous;
  }
}

const fabricated = (role: FixtureLandmark["role"] = "public"): FixtureLandmark => ({
  role,
  id: randomUUID(),
  sourceCode: "ZZA001",
  displayName: `E2E Fixture ${currentRunTag()} abcdef Public Site`,
});
const OWNER = () => ({ runTag: currentRunTag(), testTag: "abcdef" });

// ---------------------------------------------------------------------------
// Part 1 — spy connection: refusals and partial failures (no database)
// ---------------------------------------------------------------------------

base.describe("guard: wrong targets are refused before any connection", () => {
  const targets: [string, string | undefined][] = [
    ["missing DATABASE_URL_TEST", undefined],
    ["a remote host", "postgresql://u:p@db.example.render.com:5432/landmarks_test"],
    ["landmarks_dev", "postgresql://u:p@localhost:5432/landmarks_dev"],
    ["the postgres database", "postgresql://u:p@127.0.0.1:5432/postgres"],
    ["an unparseable URL", "not a url"],
  ];

  for (const [label, url] of targets) {
    base(`${label}: every operation refuses with no connection and no write`, async () => {
      const db = spy();
      const store = createFixtureStore({ connect: db.connect });
      await withTestUrl(url, async () => {
        await expect(store.createTestFixtures("abcdef")).rejects.toBeInstanceOf(FixtureGuardError);
        await expect(store.teardownOwned(OWNER(), [fabricated()])).rejects.toBeInstanceOf(
          FixtureGuardError,
        );
        await expect(store.findLandmarks([randomUUID()])).rejects.toBeInstanceOf(FixtureGuardError);
        await expect(store.reportAbandoned()).rejects.toBeInstanceOf(FixtureGuardError);
      });
      expect(db.connections()).toBe(0);
      expect(db.statements).toEqual([]);
    });
  }
});

base.describe("guard: the live connection must be landmarks_test", () => {
  base("a connection that reports landmarks_dev: rolled back, nothing written", async () => {
    const db = spy({ database: "landmarks_dev" });
    const store = createFixtureStore({ connect: db.connect });
    await expect(store.createTestFixtures("abcdef")).rejects.toThrow(
      /Connected database is "landmarks_dev"/,
    );
    await expect(store.teardownOwned(OWNER(), [fabricated()])).rejects.toBeInstanceOf(
      FixtureGuardError,
    );
    expect(db.writes()).toEqual([]);
    expect(db.statements.filter((s) => s === "COMMIT")).toEqual([]);
    expect(db.statements.filter((s) => s === "ROLLBACK")).toHaveLength(2);
  });

  base("missing landmarks/favorites tables: rolled back, nothing written", async () => {
    const db = spy({ tablesExist: false });
    const store = createFixtureStore({ connect: db.connect });
    await expect(store.createTestFixtures("abcdef")).rejects.toThrow(/tables must exist/);
    expect(db.writes()).toEqual([]);
    expect(db.statements).toContain("ROLLBACK");
  });

  base("the identity check runs on the writing connection, before any write", async () => {
    const db = spy();
    const store = createFixtureStore({ connect: db.connect });
    await store.createTestFixtures("abcdef");
    const identity = db.statements.findIndex((s) => s.startsWith("SELECT current_database()"));
    const firstWrite = db.statements.findIndex((s) => WRITE.test(s));
    expect(db.connections()).toBe(1);
    expect(db.statements[0]).toBe("BEGIN");
    expect(identity).toBe(1);
    expect(firstWrite).toBeGreaterThan(identity);
    expect(db.statements.at(-1)).toBe("COMMIT");
  });

  base("the abandoned-fixture report is READ ONLY and writes nothing", async () => {
    const db = spy();
    const store = createFixtureStore({ connect: db.connect });
    await store.reportAbandoned();
    expect(db.statements[0]).toBe("BEGIN READ ONLY");
    expect(db.writes()).toEqual([]);
  });
});

base.describe("partial failures and ownership checks (spy)", () => {
  base("a failing insert rolls back the whole fixture set; nothing is recorded", async () => {
    const db = spy({ failOnInsert: 2 });
    const store = createFixtureStore({ connect: db.connect });
    await expect(store.createTestFixtures("abcdef")).rejects.toThrow("injected insert failure");
    expect(db.statements).toContain("ROLLBACK");
    expect(db.statements).not.toContain("COMMIT");
  });

  base("source-code collisions are retried; ten collisions roll back", async () => {
    const retried = spy({ inserts: [null, null, randomUUID(), randomUUID(), randomUUID()] });
    await createFixtureStore({ connect: retried.connect }).createTestFixtures("abcdef");
    expect(retried.statements.filter((s) => s.startsWith("INSERT"))).toHaveLength(5);
    expect(retried.statements.at(-1)).toBe("COMMIT");

    const exhausted = spy({ inserts: Array.from({ length: 10 }, () => null) });
    await expect(
      createFixtureStore({ connect: exhausted.connect }).createTestFixtures("abcdef"),
    ).rejects.toThrow(/No free ZZ source code/);
    expect(exhausted.statements).toContain("ROLLBACK");
  });

  base("teardown with nothing recorded sends nothing", async () => {
    const db = spy();
    const result = await createFixtureStore({ connect: db.connect }).teardownOwned(OWNER(), []);
    expect(result).toEqual({ landmarksDeleted: 0, favoritesDeleted: 0 });
    expect(db.connections()).toBe(0);
  });

  base(
    "records outside the namespace or another test's names are refused before any DELETE",
    async () => {
      const records: FixtureLandmark[] = [
        { ...fabricated(), sourceCode: "FAL001" },
        { ...fabricated(), displayName: `E2E Fixture ${currentRunTag()} zzzzzz Public Site` },
        { ...fabricated(), displayName: "E2E Fixture 000000 abcdef Public Site" },
      ];
      for (const record of records) {
        const db = spy();
        await expect(
          createFixtureStore({ connect: db.connect }).teardownOwned(OWNER(), [record]),
        ).rejects.toBeInstanceOf(FixtureOwnershipError);
        expect(db.writes()).toEqual([]);
        expect(db.statements).toContain("ROLLBACK");
      }
    },
  );

  base("an invalid test tag is refused before any connection", async () => {
    const db = spy();
    await expect(
      createFixtureStore({ connect: db.connect }).createTestFixtures("Bad Tag"),
    ).rejects.toBeInstanceOf(FixtureGuardError);
    expect(db.connections()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the real landmarks_test and the real server
// ---------------------------------------------------------------------------

async function signedInUser(request: APIRequestContext): Promise<void> {
  const email = `e2e-fav-guard-${currentRunTag()}-${randomUUID().slice(0, 8)}@example.com`;
  const password = "e2e fixture guard password";
  const headers = { Origin: ORIGIN };
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers,
    data: { name: "", email, password },
  });
  expect(signUp.status()).toBe(200);
  const signIn = await request.post("/api/auth/sign-in/email", {
    headers,
    data: { email, password },
  });
  expect(signIn.status()).toBe(200);
}

async function savedIds(request: APIRequestContext): Promise<string[]> {
  const response = await request.get("/api/v1/favorites?page=1&limit=100");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { favorites: { landmark_id: string }[] };
  return body.favorites.map((f) => f.landmark_id);
}

base.describe("real landmarks_test", () => {
  base("run tag: one 6-character tag from the config, shared by the run", async () => {
    const tag = currentRunTag();
    expect(tag).toMatch(/^[a-z0-9]{6}$/);
    expect(process.env[RUN_TAG_ENV]).toBe(tag);
    // Logged so the shared value can be compared across workers in the run output.
    console.log(`[fixture-run] ${tag} worker=${base.info().workerIndex}`);
  });

  base(
    "lifecycle: three PUBLIC fixtures, server identity, status changes, complete teardown",
    async ({ request }) => {
      const store = createFixtureStore();
      const fixtures = await store.createTestFixtures("aaaa01");
      const ids = [fixtures.public.id, fixtures.hidden.id, fixtures.retired.id];
      try {
        const rows = await store.findLandmarks(ids);
        expect(rows).toHaveLength(3);
        for (const row of rows) {
          expect(row.sourceCode).toMatch(/^ZZ[A-Z][0-9]{3}$/);
          expect(row.displayName).toMatch(
            new RegExp(`^E2E Fixture ${currentRunTag()} aaaa01 (Public|Hidden|Retired) Site$`),
          );
          expect(row).toMatchObject({ isActive: true, status: "PUBLIC" });
        }

        await expectServerView(request, fixtures.public, "full");
        await fixtures.makeHiddenSensitive();
        await expectServerView(request, fixtures.hidden, "minimal");
        await fixtures.retire();
        await expectServerView(request, fixtures.retired, "not_found");
      } finally {
        expect(await fixtures.teardown()).toEqual({ landmarksDeleted: 3, favoritesDeleted: 0 });
      }
      expect(await store.findLandmarks(ids)).toEqual([]);
      // Idempotent: nothing left to send.
      expect(await fixtures.teardown()).toEqual({ landmarksDeleted: 0, favoritesDeleted: 0 });
    },
  );

  base(
    "teardown removes favorites created through the real API, then the fixtures",
    async ({ request }) => {
      const store = createFixtureStore();
      const fixtures = await store.createTestFixtures("aaaa02");
      try {
        await expectServerView(request, fixtures.public, "full"); // before any API mutation
        await signedInUser(request);
        const put = await request.put(`/api/v1/favorites/${fixtures.public.id}`, {
          headers: { Origin: ORIGIN },
        });
        expect(put.status()).toBe(201);
        expect(await savedIds(request)).toEqual([fixtures.public.id]);
      } finally {
        expect(await fixtures.teardown()).toEqual({ landmarksDeleted: 3, favoritesDeleted: 1 });
      }
      expect(await savedIds(request)).toEqual([]);
    },
  );

  base("teardown refuses unowned or mismatched IDs and changes nothing", async ({ request }) => {
    const store = createFixtureStore();
    const a = await store.createTestFixtures("aaaa03");
    const b = await store.createTestFixtures("bbbb03");
    const all = [a.public, a.hidden, a.retired, b.public, b.hidden, b.retired].map((l) => l.id);
    try {
      await expectServerView(request, b.public, "full");
      await signedInUser(request);
      expect(
        (
          await request.put(`/api/v1/favorites/${b.public.id}`, { headers: { Origin: ORIGIN } })
        ).status(),
      ).toBe(201);

      const attempts: FixtureLandmark[][] = [
        [b.public], // another test's fixture
        [{ ...a.public, id: randomUUID() }], // an ID that does not exist
        [{ ...a.public, id: b.public.id }], // another fixture's ID under this test's name
        [{ ...a.public, sourceCode: a.public.sourceCode === "ZZZ999" ? "ZZZ998" : "ZZZ999" }],
        [{ ...a.public, sourceCode: "FAL001" }], // outside the namespace
        [a.public, { ...a.hidden, id: b.hidden.id }], // one bad row refuses the whole set
      ];
      for (const owned of attempts) {
        await expect(store.teardownOwned(a.owner, owned)).rejects.toBeInstanceOf(
          FixtureOwnershipError,
        );
      }
      // Nothing was deleted: every fixture remains, and b's favorite is still saved.
      expect(await store.findLandmarks(all)).toHaveLength(6);
      expect(await savedIds(request)).toEqual([b.public.id]);
    } finally {
      await a.teardown();
      await b.teardown();
    }
    expect(await store.findLandmarks(all)).toEqual([]);
  });

  base("the abandoned-fixture report excludes this run and deletes nothing", async () => {
    const store = createFixtureStore();
    const before = await store.reportAbandoned();
    const fixtures = await store.createTestFixtures("aaaa04");
    try {
      const during = await store.reportAbandoned();
      expect(during.count).toBe(before.count);
      expect(during.runTags).not.toContain(currentRunTag());
    } finally {
      await fixtures.teardown();
    }
    const after = await store.reportAbandoned();
    expect(after.count).toBe(before.count);
    console.log(
      `[fixture-report] earlier runs: ${after.count} row(s)` +
        (after.count > 0
          ? ` (runs ${after.runTags.join(", ")}, oldest ${after.oldestCreatedAt})`
          : ""),
    );
  });
});

// The Playwright fixture path used by favorites specs from Increment 6C.
fixtureTest.describe("Playwright fixture: teardown after passing and failing tests", () => {
  fixtureTest.describe.configure({ mode: "serial" });
  const recorded: string[][] = [];

  fixtureTest(
    "a passing test: fixtures exist and the server sees them",
    async ({ favoriteFixtures, fixtureStore }) => {
      const ids = [
        favoriteFixtures.public.id,
        favoriteFixtures.hidden.id,
        favoriteFixtures.retired.id,
      ];
      recorded.push(ids);
      expect(await fixtureStore.findLandmarks(ids)).toHaveLength(3);
    },
  );

  fixtureTest(
    "a failing assertion still tears down (expected failure)",
    async ({ favoriteFixtures }) => {
      fixtureTest.fail();
      recorded.push([
        favoriteFixtures.public.id,
        favoriteFixtures.hidden.id,
        favoriteFixtures.retired.id,
      ]);
      expect(favoriteFixtures.public.displayName).toBe("this assertion fails on purpose");
    },
  );

  fixtureTest("both earlier tests' fixtures are gone", async ({ fixtureStore }) => {
    // The last two entries are this group's (a repeated run appends more).
    const lastTwo = recorded.slice(-2);
    expect(lastTwo).toHaveLength(2);
    expect(lastTwo.flat()).toHaveLength(6);
    expect(await fixtureStore.findLandmarks(lastTwo.flat())).toEqual([]);
  });
});
