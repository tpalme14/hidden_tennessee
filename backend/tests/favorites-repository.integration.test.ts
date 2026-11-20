import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import * as repository from "../src/favorites/repository.js";
import { addFavorite, listFavorites, removeFavorite } from "../src/favorites/service.js";
import { parseListQuery } from "../src/favorites/request-schema.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";
import {
  assertConnectedToTestDatabase,
  getVerifiedTestDatabaseUrl,
} from "./setup/test-db-guard.js";

/**
 * M03-T05 Increment 2 — favorites repository and service against the REAL
 * landmarks_test database (ADR-009): owner-scoped queries, visibility
 * handling, pagination, idempotency, and concurrency.
 *
 * The deterministic concurrency tests hold an uncommitted transaction on a
 * separate guard-verified connection, wait (bounded) until the service's
 * favorites INSERT is confirmed blocked on exactly that transaction, then
 * commit or roll back. Every manually opened transaction and connection is
 * closed in `finally`, so a failing test cannot leave locks behind.
 */

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";

let sequence = 0;

async function createUser(label = "user") {
  sequence += 1;
  const user = await prisma.user.create({
    data: { name: "", email: `${label}-${sequence}@example.com` },
  });
  return user.id;
}

async function createLandmark(
  options: { status?: Status; active?: boolean; name?: string } = {},
): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `ARC${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNARCHES",
      category: "ARCH",
      displayName: options.name ?? `Arch ${sequence}`,
      latitude: 35.1869,
      longitude: -85.6103,
      sourceDescription: "restricted description",
      sourceAccessLabel: "restricted access",
      sourceUrl: "https://example.com/restricted",
      sensitivityStatus: options.status ?? "PUBLIC",
      isActive: options.active ?? true,
    },
  });
  return landmark.id;
}

async function setLandmark(id: string, data: { status?: Status; active?: boolean }) {
  await prisma.landmark.update({
    where: { id },
    data: {
      ...(data.status ? { sensitivityStatus: data.status } : {}),
      ...(data.active !== undefined ? { isActive: data.active } : {}),
    },
  });
}

async function favoriteRows(userId?: string) {
  return prisma.favorite.findMany({ where: userId ? { userId } : {}, orderBy: { id: "asc" } });
}

const firstPage = parseListQuery({});

// ---------------------------------------------------------------------------
// Deterministic interleaving helpers
// ---------------------------------------------------------------------------

const WAIT_TIMEOUT_MS = 5_000;
const POLL_MS = 25;

/** A separate connection to landmarks_test, verified by the project's own guard. */
async function openTestConnection(): Promise<Client> {
  const url = getVerifiedTestDatabaseUrl();
  await assertConnectedToTestDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function backendPid(client: Client): Promise<number> {
  const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return rows[0]!.pid;
}

/**
 * Polls (bounded) until exactly one active backend is running the favorites
 * add statement, waiting on a lock held by `blockerPid`. Returns its query
 * text so the caller can assert it is the expected statement.
 */
async function waitUntilAddIsBlockedBy(observer: Client, blockerPid: number): Promise<string> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ query: string }>(
      `SELECT query FROM pg_stat_activity
       WHERE datname = current_database()
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND $1 = ANY (pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (rows.length === 1) return rows[0]!.query;
    if (rows.length > 1) throw new Error(`expected one blocked backend, found ${rows.length}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`no backend was blocked by pid ${blockerPid} within ${WAIT_TIMEOUT_MS} ms`);
}

/** Resolves with the promise's value, or rejects if it is still pending after `ms`. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `scenario` with a blocker connection inside an open transaction and an
 * observer connection. Whatever happens, the blocker's transaction is rolled
 * back if still open, the operation under test is allowed to settle, and both
 * connections are closed.
 */
async function withBlocker(
  scenario: (ctx: {
    blocker: Client;
    blockerPid: number;
    observer: Client;
    track: <T>(p: Promise<T>) => Promise<T>;
    finish: (action: "COMMIT" | "ROLLBACK") => Promise<void>;
  }) => Promise<void>,
): Promise<void> {
  const blocker = await openTestConnection();
  let observer: Client | undefined;
  let open = false;
  const pending: Promise<unknown>[] = [];
  try {
    observer = await openTestConnection();
    const blockerPid = await backendPid(blocker);
    await blocker.query("BEGIN");
    open = true;
    await scenario({
      blocker,
      blockerPid,
      observer,
      track: (p) => {
        pending.push(p.catch(() => undefined));
        return p;
      },
      finish: async (action) => {
        open = false;
        await blocker.query(action);
      },
    });
  } finally {
    if (open) await blocker.query("ROLLBACK").catch(() => undefined);
    await within(Promise.all(pending), WAIT_TIMEOUT_MS, "operation under test").catch(
      () => undefined,
    );
    await blocker.end().catch(() => undefined);
    await observer?.end().catch(() => undefined);
  }
}

/** The service's add statement, as PostgreSQL reports it while blocked. */
function expectFavoritesAddStatement(query: string) {
  expect(query).toMatch(/INSERT INTO favorites \(user_id, landmark_id\)/);
  expect(query).toMatch(/ON CONFLICT \(user_id, landmark_id\) DO NOTHING/);
}

// ---------------------------------------------------------------------------

describe("favorites repository and service (integration, M03-T05 Increment 2)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  describe("add and remove", () => {
    it("first add creates, a repeated add is existing, and only one row exists", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      expect(await addFavorite(prisma, user, landmark)).toEqual({
        kind: "created",
        landmarkId: landmark,
      });
      const [row] = await favoriteRows();
      expect(await addFavorite(prisma, user, landmark)).toEqual({
        kind: "existing",
        landmarkId: landmark,
      });
      expect(await favoriteRows()).toEqual([row]);
    });

    it("remove is idempotent and the service result never differs", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      await addFavorite(prisma, user, landmark);
      expect(await repository.removeFavorite(prisma, user, landmark)).toEqual({ removed: true });
      expect(await repository.removeFavorite(prisma, user, landmark)).toEqual({ removed: false });
      expect(await removeFavorite(prisma, user, landmark)).toEqual({
        kind: "removed",
        landmarkId: landmark,
      });
      expect(await favoriteRows()).toEqual([]);
    });

    it("removing an unknown landmark ID succeeds without error (D2)", async () => {
      const user = await createUser();
      expect(await removeFavorite(prisma, user, "00000000-0000-4000-8000-000000000000")).toEqual({
        kind: "removed",
        landmarkId: "00000000-0000-4000-8000-000000000000",
      });
    });

    it.each([
      ["an unknown landmark", null],
      ["a retired landmark", { active: false }],
      ["an UNREVIEWED landmark", { status: "UNREVIEWED" }],
      ["a SENSITIVE landmark", { status: "SENSITIVE" }],
      ["a retired SENSITIVE landmark", { status: "SENSITIVE", active: false }],
    ] as const)("adding %s is not_found and creates nothing (D1)", async (_label, options) => {
      const user = await createUser();
      const landmark = options
        ? await createLandmark(options)
        : "00000000-0000-4000-8000-000000000000";
      expect((await addFavorite(prisma, user, landmark)).kind).toBe("not_found");
      expect(await favoriteRows()).toEqual([]);
    });

    it("rejects an unvalidated (non-UUID) ID as a programming error, before any SQL", async () => {
      const user = await createUser();
      await expect(repository.addFavorite(prisma, user, "ARC001")).rejects.toThrow(/not a UUID/);
      await expect(repository.addFavorite(prisma, "nope", user)).rejects.toThrow(/not a UUID/);
      await expect(repository.removeFavorite(prisma, user, "x")).rejects.toThrow(/not a UUID/);
      await expect(repository.listFavorites(prisma, "x", firstPage)).rejects.toThrow(/not a UUID/);
    });
  });

  describe("a saved landmark whose visibility changes", () => {
    it.each([
      ["SENSITIVE", { status: "SENSITIVE" }, "redacted"],
      ["UNREVIEWED", { status: "UNREVIEWED" }, "redacted"],
      ["retired", { active: false }, "unavailable"],
    ] as const)(
      "becoming %s: a later add is not_found (not existing), the row is kept, listed as %s, and removable",
      async (_label, change, availability) => {
        const user = await createUser();
        const landmark = await createLandmark();
        expect((await addFavorite(prisma, user, landmark)).kind).toBe("created");
        const [original] = await favoriteRows();

        await setLandmark(landmark, change);
        expect((await addFavorite(prisma, user, landmark)).kind).toBe("not_found");
        expect(await favoriteRows()).toEqual([original]);

        const listed = await listFavorites(prisma, user, firstPage);
        expect(listed.favorites).toHaveLength(1);
        expect(listed.favorites[0]!.availability).toBe(availability);
        const serialized = JSON.stringify(listed);
        expect(serialized).not.toMatch(/latitude|longitude|35\.1869|85\.6103|restricted/);

        await removeFavorite(prisma, user, landmark);
        expect(await favoriteRows()).toEqual([]);
      },
    );

    it("restored to active PUBLIC: add is existing (same row), and it lists as available again", async () => {
      const user = await createUser();
      const landmark = await createLandmark({ name: "Comeback Arch" });
      await addFavorite(prisma, user, landmark);
      const [original] = await favoriteRows();

      await setLandmark(landmark, { status: "SENSITIVE" });
      expect((await listFavorites(prisma, user, firstPage)).favorites[0]!.availability).toBe(
        "redacted",
      );
      await setLandmark(landmark, { active: false });
      expect((await listFavorites(prisma, user, firstPage)).favorites[0]!.availability).toBe(
        "unavailable",
      );
      await setLandmark(landmark, { status: "PUBLIC", active: true });

      expect((await addFavorite(prisma, user, landmark)).kind).toBe("existing");
      expect(await favoriteRows()).toEqual([original]);
      expect((await listFavorites(prisma, user, firstPage)).favorites).toEqual([
        {
          landmark_id: landmark,
          availability: "available",
          landmark: {
            id: landmark,
            display_name: "Comeback Arch",
            category: "arch",
            latitude: 35.1869,
            longitude: -85.6103,
          },
        },
      ]);
    });
  });

  describe("list shaping (exact allowlists against real rows)", () => {
    it("never includes source metadata, favorite IDs, user IDs, or timestamps", async () => {
      const user = await createUser();
      const [pub, sens, retired] = [
        await createLandmark({ name: "Public Arch" }),
        await createLandmark({ name: "Sensitive Arch" }),
        await createLandmark({ name: "Retired Arch" }),
      ];
      for (const id of [pub, sens, retired]) await addFavorite(prisma, user, id);
      await setLandmark(sens, { status: "SENSITIVE" });
      await setLandmark(retired, { active: false });

      const result = await listFavorites(prisma, user, firstPage);
      const byId = new Map(result.favorites.map((e) => [e.landmark_id, e]));
      expect(byId.get(pub)).toEqual({
        landmark_id: pub,
        availability: "available",
        landmark: {
          id: pub,
          display_name: "Public Arch",
          category: "arch",
          latitude: 35.1869,
          longitude: -85.6103,
        },
      });
      expect(byId.get(sens)).toEqual({
        landmark_id: sens,
        availability: "redacted",
        landmark: { id: sens, display_name: "Sensitive Arch", category: "arch", redacted: true },
      });
      expect(byId.get(retired)).toEqual({ landmark_id: retired, availability: "unavailable" });

      const serialized = JSON.stringify(result);
      const [favorite] = await favoriteRows();
      expect(serialized).not.toContain(user);
      expect(serialized).not.toContain(favorite!.id);
      expect(serialized).not.toMatch(/restricted|source_|created_at|favorited_at|Retired Arch/);
      expect(Object.keys(result).sort()).toEqual(["favorites", "has_more", "limit", "page"]);
    });
  });

  describe("ownership (owner-scoped SQL)", () => {
    it("each user lists only their own favorites", async () => {
      const [a, b] = [await createUser("a"), await createUser("b")];
      const [one, two, three] = [
        await createLandmark(),
        await createLandmark(),
        await createLandmark(),
      ];
      await addFavorite(prisma, a, one);
      await addFavorite(prisma, b, two);
      await addFavorite(prisma, b, three);

      const listA = await listFavorites(prisma, a, firstPage);
      const listB = await listFavorites(prisma, b, firstPage);
      expect(listA.favorites.map((e) => e.landmark_id)).toEqual([one]);
      expect(listB.favorites.map((e) => e.landmark_id).sort()).toEqual([two, three].sort());
    });

    it("removing a landmark another user saved leaves their row untouched", async () => {
      const [a, b] = [await createUser("a"), await createUser("b")];
      const landmark = await createLandmark();
      await addFavorite(prisma, b, landmark);
      const before = await favoriteRows(b);

      expect(await repository.removeFavorite(prisma, a, landmark)).toEqual({ removed: false });
      expect(await favoriteRows(b)).toEqual(before);
    });

    it("two users may each save the same landmark: two separate rows", async () => {
      const [a, b] = [await createUser("a"), await createUser("b")];
      const landmark = await createLandmark();
      expect((await addFavorite(prisma, a, landmark)).kind).toBe("created");
      expect((await addFavorite(prisma, b, landmark)).kind).toBe("created");
      const rows = await favoriteRows();
      expect(rows.map((r) => r.userId).sort()).toEqual([a, b].sort());
    });

    it("a user with no favorites gets an empty first page", async () => {
      const [a, b] = [await createUser("a"), await createUser("b")];
      await addFavorite(prisma, b, await createLandmark());
      expect(await listFavorites(prisma, a, firstPage)).toEqual({
        favorites: [],
        page: 1,
        limit: 50,
        has_more: false,
      });
    });

    it("an unknown user ID sees nothing and can remove nothing", async () => {
      const b = await createUser("b");
      const landmark = await createLandmark();
      await addFavorite(prisma, b, landmark);
      const stranger = "00000000-0000-4000-8000-000000000000";
      expect((await listFavorites(prisma, stranger, firstPage)).favorites).toEqual([]);
      expect(await repository.removeFavorite(prisma, stranger, landmark)).toEqual({
        removed: false,
      });
      expect(await favoriteRows(b)).toHaveLength(1);
    });
  });

  describe("pagination and ordering", () => {
    /** Inserts favorites with explicit timestamps (direct SQL, test-only). */
    async function insertAt(userId: string, landmarkId: string, at: string) {
      await prisma.$executeRaw`
        INSERT INTO favorites (user_id, landmark_id, created_at)
        VALUES (${userId}::uuid, ${landmarkId}::uuid, ${at}::timestamp)
      `;
    }

    it("orders newest first", async () => {
      const user = await createUser();
      const ids: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const landmark = await createLandmark();
        ids.push(landmark);
        await insertAt(user, landmark, `2026-11-0${i + 1} 12:00:00`);
      }
      const result = await listFavorites(prisma, user, firstPage);
      expect(result.favorites.map((e) => e.landmark_id)).toEqual([...ids].reverse());
    });

    it("breaks created_at ties by favorite ID ascending, stably across calls and pages", async () => {
      const user = await createUser();
      for (let i = 0; i < 6; i += 1) {
        await insertAt(user, await createLandmark(), "2026-11-20 08:00:00.000");
      }
      const expected = (
        await prisma.favorite.findMany({ where: { userId: user }, orderBy: { id: "asc" } })
      ).map((f) => f.landmarkId);

      const all = await listFavorites(prisma, user, firstPage);
      expect(all.favorites.map((e) => e.landmark_id)).toEqual(expected);
      expect((await listFavorites(prisma, user, firstPage)).favorites).toEqual(all.favorites);

      const pages: string[] = [];
      for (let page = 1; page <= 3; page += 1) {
        const result = await listFavorites(
          prisma,
          user,
          parseListQuery({ page: `${page}`, limit: "2" }),
        );
        pages.push(...result.favorites.map((e) => e.landmark_id));
        expect(result.has_more).toBe(page < 3);
      }
      expect(pages).toEqual(expected);
    });

    it("computes has_more at an exact multiple, one more, and past the end", async () => {
      const user = await createUser();
      for (let i = 0; i < 4; i += 1) await addFavorite(prisma, user, await createLandmark());

      const exact = await listFavorites(prisma, user, parseListQuery({ limit: "4" }));
      expect(exact.favorites).toHaveLength(4);
      expect(exact.has_more).toBe(false);

      await addFavorite(prisma, user, await createLandmark());
      const oneMore = await listFavorites(prisma, user, parseListQuery({ limit: "4" }));
      expect(oneMore.favorites).toHaveLength(4);
      expect(oneMore.has_more).toBe(true);
      const second = await listFavorites(prisma, user, parseListQuery({ page: "2", limit: "4" }));
      expect(second.favorites).toHaveLength(1);
      expect(second.has_more).toBe(false);

      const past = await listFavorites(prisma, user, parseListQuery({ page: "9", limit: "4" }));
      expect(past).toEqual({ favorites: [], page: 9, limit: 4, has_more: false });
    });

    it("returns at most limit rows (limit 100 of 101)", async () => {
      const user = await createUser();
      const landmarkIds: string[] = [];
      for (let i = 0; i < 101; i += 1) {
        sequence += 1;
        landmarkIds.push(
          (
            await prisma.landmark.create({
              data: {
                sourceCode: `BAL${String(i).padStart(3, "0")}`,
                sourceFile: "TNBALDS",
                category: "BALD",
                displayName: `Bald ${i}`,
                latitude: 36,
                longitude: -84,
                sensitivityStatus: "PUBLIC",
              },
            })
          ).id,
        );
      }
      await prisma.favorite.createMany({
        data: landmarkIds.map((landmarkId) => ({ userId: user, landmarkId })),
      });
      const page = await listFavorites(prisma, user, parseListQuery({ limit: "100" }));
      expect(page.favorites).toHaveLength(100);
      expect(page.has_more).toBe(true);
    });
  });

  describe("concurrency", () => {
    it("10 parallel duplicate adds, over 20 rounds: exactly one created, nine existing, one row", async () => {
      const user = await createUser();
      for (let round = 0; round < 20; round += 1) {
        const landmark = await createLandmark();
        const settled = await Promise.allSettled(
          Array.from({ length: 10 }, () => addFavorite(prisma, user, landmark)),
        );
        expect(settled.filter((s) => s.status === "rejected")).toEqual([]);
        const kinds = settled.map(
          (s) => (s as PromiseFulfilledResult<{ kind: string }>).value.kind,
        );
        // Multiset assertions only — never positions or completion order.
        expect(kinds.filter((k) => k === "created")).toHaveLength(1);
        expect(kinds.filter((k) => k === "existing")).toHaveLength(9);
        expect(await prisma.favorite.count({ where: { userId: user, landmarkId: landmark } })).toBe(
          1,
        );
      }
    });

    it("two users adding the same landmark concurrently each get created once: two rows", async () => {
      const [a, b] = [await createUser("a"), await createUser("b")];
      const landmark = await createLandmark();
      const results = await Promise.all([
        ...Array.from({ length: 5 }, () => addFavorite(prisma, a, landmark)),
        ...Array.from({ length: 5 }, () => addFavorite(prisma, b, landmark)),
      ]);
      const created = results.filter((r) => r.kind === "created");
      expect(created).toHaveLength(2);
      expect(await prisma.favorite.count({ where: { landmarkId: landmark } })).toBe(2);
      expect(await prisma.favorite.count({ where: { userId: a } })).toBe(1);
      expect(await prisma.favorite.count({ where: { userId: b } })).toBe(1);
    });

    it("parallel adds and removes for one pair, over 20 rounds: no errors, 0 or 1 rows", async () => {
      const user = await createUser();
      for (let round = 0; round < 20; round += 1) {
        const landmark = await createLandmark();
        const settled = await Promise.allSettled(
          Array.from({ length: 10 }, (_, i) =>
            i % 2 === 0
              ? addFavorite(prisma, user, landmark)
              : removeFavorite(prisma, user, landmark),
          ),
        );
        expect(settled.filter((s) => s.status === "rejected")).toEqual([]);
        const count = await prisma.favorite.count({
          where: { userId: user, landmarkId: landmark },
        });
        expect([0, 1]).toContain(count);
      }
    });

    it("forced interleaving, COMMIT: an add blocked behind an uncommitted duplicate returns existing; one row", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      await withBlocker(async ({ blocker, blockerPid, observer, track, finish }) => {
        await blocker.query("INSERT INTO favorites (user_id, landmark_id) VALUES ($1, $2)", [
          user,
          landmark,
        ]);
        const add = track(addFavorite(prisma, user, landmark));
        expectFavoritesAddStatement(await waitUntilAddIsBlockedBy(observer, blockerPid));
        await finish("COMMIT");
        expect(await within(add, WAIT_TIMEOUT_MS, "blocked add")).toEqual({
          kind: "existing",
          landmarkId: landmark,
        });
      });
      expect(await prisma.favorite.count({ where: { userId: user, landmarkId: landmark } })).toBe(
        1,
      );
    });

    it("forced interleaving, ROLLBACK: an add blocked behind an uncommitted duplicate returns created; one row", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      await withBlocker(async ({ blocker, blockerPid, observer, track, finish }) => {
        await blocker.query("INSERT INTO favorites (user_id, landmark_id) VALUES ($1, $2)", [
          user,
          landmark,
        ]);
        const add = track(addFavorite(prisma, user, landmark));
        expectFavoritesAddStatement(await waitUntilAddIsBlockedBy(observer, blockerPid));
        await finish("ROLLBACK");
        expect(await within(add, WAIT_TIMEOUT_MS, "blocked add")).toEqual({
          kind: "created",
          landmarkId: landmark,
        });
      });
      expect(await prisma.favorite.count({ where: { userId: user, landmarkId: landmark } })).toBe(
        1,
      );
    });

    it("E5 reclassification race (observed behaviour): duplicate insert + reclassify to SENSITIVE in one uncommitted transaction", async () => {
      const user = await createUser();
      const landmark = await createLandmark({ name: "Race Arch" });
      let observed: unknown;
      await withBlocker(async ({ blocker, blockerPid, observer, track, finish }) => {
        await blocker.query("INSERT INTO favorites (user_id, landmark_id) VALUES ($1, $2)", [
          user,
          landmark,
        ]);
        await blocker.query("UPDATE landmarks SET sensitivity_status = 'SENSITIVE' WHERE id = $1", [
          landmark,
        ]);
        const add = track(addFavorite(prisma, user, landmark));
        expectFavoritesAddStatement(await waitUntilAddIsBlockedBy(observer, blockerPid));
        await finish("COMMIT");
        observed = await within(add, WAIT_TIMEOUT_MS, "blocked add");
      });
      // READ COMMITTED: the eligibility check used the statement's snapshot,
      // taken while the landmark was still PUBLIC; the insert then waited on
      // the duplicate key and, after the commit, inserted nothing.
      expect(observed).toEqual({ kind: "existing", landmarkId: landmark });
      expect(await prisma.favorite.count({ where: { userId: user, landmarkId: landmark } })).toBe(
        1,
      );
      // No disclosure afterwards: the saved landmark lists only as redacted.
      const listed = await listFavorites(prisma, user, firstPage);
      expect(listed.favorites).toEqual([
        {
          landmark_id: landmark,
          availability: "redacted",
          landmark: { id: landmark, display_name: "Race Arch", category: "arch", redacted: true },
        },
      ]);
      // And any later add now sees the committed reclassification.
      expect((await addFavorite(prisma, user, landmark)).kind).toBe("not_found");
    });

    it("E5 reclassification race (observed behaviour): an uncommitted reclassification alone does not block the add", async () => {
      const user = await createUser();
      const landmark = await createLandmark({ name: "Unblocked Arch" });
      let observed: unknown;
      await withBlocker(async ({ blocker, track, finish }) => {
        await blocker.query("UPDATE landmarks SET sensitivity_status = 'SENSITIVE' WHERE id = $1", [
          landmark,
        ]);
        // Not blocked: the FK check's KEY SHARE lock is compatible with the
        // non-key UPDATE's row lock, and the snapshot still shows PUBLIC.
        observed = await within(
          track(addFavorite(prisma, user, landmark)),
          WAIT_TIMEOUT_MS,
          "add during an uncommitted reclassification",
        );
        await finish("COMMIT");
      });
      expect(observed).toEqual({ kind: "created", landmarkId: landmark });
      expect(await prisma.favorite.count({ where: { userId: user, landmarkId: landmark } })).toBe(
        1,
      );
      expect((await listFavorites(prisma, user, firstPage)).favorites[0]!.availability).toBe(
        "redacted",
      );
    });

    it("leaves no open transactions or lock waits behind", async () => {
      const observer = await openTestConnection();
      try {
        const { rows } = await observer.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()
             AND (state = 'idle in transaction' OR wait_event_type = 'Lock')`,
        );
        expect(rows[0]!.n).toBe(0);
      } finally {
        await observer.end();
      }
    });
  });
});
