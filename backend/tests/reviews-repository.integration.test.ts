import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import * as repository from "../src/reviews/repository.js";
import { parseListQuery } from "../src/reviews/request-schema.js";
import {
  createReview,
  deleteReview,
  getOwnReview,
  listPublicReviews,
  updateReview,
} from "../src/reviews/service.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";
import {
  assertConnectedToTestDatabase,
  getVerifiedTestDatabaseUrl,
} from "./setup/test-db-guard.js";

/**
 * M04-T02 Increment 2 — reviews repository and service against the REAL
 * landmarks_test database (ADR-009), through the application's actual Prisma
 * client and PostgreSQL driver adapter: owner-scoped SQL, the ADR-013
 * visibility matrix, aggregates, `updated_at` semantics, timestamp round trips,
 * and concurrency.
 *
 * The deterministic concurrency tests hold an uncommitted transaction on a
 * separate guard-verified connection, wait (bounded) until the service's
 * reviews INSERT is confirmed blocked on exactly that transaction
 * (`pg_blocking_pids`), then commit or roll back. Every manually opened
 * transaction and connection is closed in `finally`.
 */

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const firstPage = parseListQuery({});

let sequence = 0;

async function createUser(label = "user"): Promise<string> {
  sequence += 1;
  const user = await prisma.user.create({
    data: { name: "", email: `reviews-${label}-${sequence}@example.com` },
  });
  return user.id;
}

async function createLandmark(
  options: { status?: Status; active?: boolean } = {},
): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `FAL${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNFALLS",
      category: "FALLS",
      displayName: `Restricted Falls ${sequence}`,
      latitude: 35.6532,
      longitude: -83.5079,
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

async function storedReviews(where: { userId?: string; landmarkId?: string } = {}) {
  return prisma.review.findMany({ where, orderBy: { id: "asc" } });
}

/** Creates a review through the service and returns its ID (fails the test otherwise). */
async function seedReview(
  userId: string,
  landmarkId: string,
  rating: number,
  body: string | null = null,
): Promise<string> {
  const outcome = await createReview(prisma, userId, { landmarkId, rating, body });
  if (outcome.kind !== "created") throw new Error(`seed failed: ${outcome.kind}`);
  return outcome.review.id;
}

/** Inserts a review with explicit timestamps (raw SQL, as a fixture). */
async function insertReviewAt(
  userId: string,
  landmarkId: string,
  rating: number,
  at: string,
  id?: string,
): Promise<string> {
  const rows = id
    ? await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO reviews (id, user_id, landmark_id, rating, created_at, updated_at)
        VALUES (${id}::uuid, ${userId}::uuid, ${landmarkId}::uuid, ${rating}::int, ${at}::timestamp, ${at}::timestamp)
        RETURNING id::text AS id`
    : await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO reviews (user_id, landmark_id, rating, created_at, updated_at)
        VALUES (${userId}::uuid, ${landmarkId}::uuid, ${rating}::int, ${at}::timestamp, ${at}::timestamp)
        RETURNING id::text AS id`;
  return rows[0]!.id;
}

// ---------------------------------------------------------------------------
// Deterministic interleaving helpers (same approach as the favorites suite)
// ---------------------------------------------------------------------------

const WAIT_TIMEOUT_MS = 5_000;
const POLL_MS = 25;

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

async function waitUntilBlockedBy(observer: Client, blockerPid: number): Promise<string> {
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

function expectReviewsCreateStatement(query: string) {
  expect(query).toMatch(/INSERT INTO reviews \(user_id, landmark_id, rating, body\)/);
  expect(query).toMatch(/ON CONFLICT \(user_id, landmark_id\) DO NOTHING/);
}

// ---------------------------------------------------------------------------

/** The landmark states of the ADR-013 visibility matrix that must look missing. */
const NON_VISIBLE: [string, { status?: Status; active?: boolean }][] = [
  ["SENSITIVE (active)", { status: "SENSITIVE" }],
  ["UNREVIEWED (active)", { status: "UNREVIEWED" }],
  ["retired (PUBLIC, inactive)", { status: "PUBLIC", active: false }],
  ["retired (SENSITIVE, inactive)", { status: "SENSITIVE", active: false }],
];

describe("reviews repository and service (integration, M04-T02 Increment 2)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  describe("create", () => {
    it("creates a rating-only review and a review with text on a visible landmark", async () => {
      const [a, b] = [await createUser("a"), await createUser("b")];
      const landmark = await createLandmark();

      const first = await createReview(prisma, a, { landmarkId: landmark, rating: 4, body: null });
      expect(first.kind).toBe("created");
      if (first.kind !== "created") return;
      expect(first.review).toEqual({
        id: expect.any(String),
        rating: 4,
        body: null,
        created_at: expect.stringMatching(ISO_UTC_MS),
        updated_at: first.review.created_at,
        author_label: "Community Member",
      });

      const second = await createReview(prisma, b, {
        landmarkId: landmark,
        rating: 2,
        body: "line one\n\nline two \u{1F332}",
      });
      expect(second.kind === "created" && second.review.body).toBe(
        "line one\n\nline two \u{1F332}",
      );

      const rows = await storedReviews({ landmarkId: landmark });
      expect(rows.map((r) => [r.userId, r.rating, r.body]).sort()).toEqual(
        [
          [a, 4, null],
          [b, 2, "line one\n\nline two \u{1F332}"],
        ].sort(),
      );
    });

    it("a second create by the same user for the same landmark is a duplicate; nothing changes", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      const id = await seedReview(user, landmark, 5, "original");
      expect(
        await createReview(prisma, user, { landmarkId: landmark, rating: 1, body: "again" }),
      ).toEqual({ kind: "duplicate" });
      const rows = await storedReviews({ userId: user });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id, rating: 5, body: "original" });
    });

    it("the same user may review different landmarks", async () => {
      const user = await createUser();
      const [l1, l2] = [await createLandmark(), await createLandmark()];
      await seedReview(user, l1, 3);
      await seedReview(user, l2, 3);
      expect(await storedReviews({ userId: user })).toHaveLength(2);
    });

    it.each(NON_VISIBLE)(
      "refuses a %s landmark as not_found and stores nothing",
      async (_l, state) => {
        const user = await createUser();
        const landmark = await createLandmark(state);
        expect(
          await createReview(prisma, user, { landmarkId: landmark, rating: 4, body: "x" }),
        ).toEqual({
          kind: "not_found",
        });
        expect(await storedReviews()).toHaveLength(0);
      },
    );

    it("refuses an unknown landmark as not_found", async () => {
      const user = await createUser();
      expect(
        await createReview(prisma, user, { landmarkId: UNKNOWN_UUID, rating: 4, body: null }),
      ).toEqual({
        kind: "not_found",
      });
    });

    it("a duplicate on a landmark that is no longer visible is not_found, not duplicate", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      await seedReview(user, landmark, 4);
      await setLandmark(landmark, { status: "SENSITIVE" });
      expect(
        await createReview(prisma, user, { landmarkId: landmark, rating: 4, body: null }),
      ).toEqual({
        kind: "not_found",
      });
    });
  });

  describe("update", () => {
    it("updates only the supplied fields; omitted body is kept, explicit null clears it", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      const id = await seedReview(user, landmark, 3, "keep me");

      const ratingOnly = await updateReview(prisma, user, id, { rating: 5 });
      expect(ratingOnly.kind === "updated" && ratingOnly.review).toMatchObject({
        id,
        rating: 5,
        body: "keep me",
      });

      const bodyOnly = await updateReview(prisma, user, id, { body: "new text" });
      expect(bodyOnly.kind === "updated" && bodyOnly.review).toMatchObject({
        rating: 5,
        body: "new text",
      });

      const cleared = await updateReview(prisma, user, id, { body: null });
      expect(cleared.kind === "updated" && cleared.review).toMatchObject({ rating: 5, body: null });

      const both = await updateReview(prisma, user, id, { rating: 1, body: "both" });
      expect(both.kind === "updated" && both.review).toMatchObject({ rating: 1, body: "both" });

      const [row] = await storedReviews({ userId: user });
      expect(row).toMatchObject({
        id,
        rating: 1,
        body: "both",
        landmarkId: landmark,
        userId: user,
      });
    });

    it("preserves the review ID and created_at, and sets updated_at to the database time", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      const id = await insertReviewAt(user, landmark, 2, "2026-01-01 00:00:00.000");

      const [clock] = await prisma.$queryRaw<{ db_now: Date }[]>`SELECT now() AS db_now`;
      const dbNowMs = clock!.db_now.getTime();
      const outcome = await updateReview(prisma, user, id, { rating: 4 });
      expect(outcome.kind).toBe("updated");
      if (outcome.kind !== "updated") return;
      expect(outcome.review.id).toBe(id);
      expect(outcome.review.created_at).toBe("2026-01-01T00:00:00.000Z");
      expect(outcome.review.updated_at).not.toBe("2026-01-01T00:00:00.000Z");
      const updatedMs = Date.parse(outcome.review.updated_at);
      expect(updatedMs).toBeGreaterThanOrEqual(dbNowMs - 5);
      expect(updatedMs).toBeLessThanOrEqual(Date.now() + 5_000);
    });

    it("assigns updated_at even when the submitted values equal the stored ones", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      const id = await insertReviewAt(user, landmark, 4, "2026-01-01 00:00:00.000");
      const outcome = await updateReview(prisma, user, id, { rating: 4 });
      expect(outcome.kind === "updated" && outcome.review.updated_at).not.toBe(
        "2026-01-01T00:00:00.000Z",
      );
    });

    it("a refused update changes nothing (other user, missing review, non-visible landmark)", async () => {
      const [owner, other] = [await createUser("owner"), await createUser("other")];
      const landmark = await createLandmark();
      const id = await insertReviewAt(owner, landmark, 3, "2026-01-01 00:00:00.000");

      expect(await updateReview(prisma, other, id, { rating: 1 })).toEqual({ kind: "not_found" });
      expect(await updateReview(prisma, owner, UNKNOWN_UUID, { rating: 1 })).toEqual({
        kind: "not_found",
      });
      await setLandmark(landmark, { active: false });
      expect(await updateReview(prisma, owner, id, { rating: 1 })).toEqual({ kind: "not_found" });

      const [row] = await storedReviews();
      expect(row).toMatchObject({ id, rating: 3, userId: owner });
      expect(row!.updatedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });

    it.each(NON_VISIBLE)(
      "refuses an edit of one's own review while the landmark is %s (A2)",
      async (_l, state) => {
        const user = await createUser();
        const landmark = await createLandmark();
        const id = await seedReview(user, landmark, 4, "text");
        await setLandmark(landmark, state);
        expect(await updateReview(prisma, user, id, { body: "edited" })).toEqual({
          kind: "not_found",
        });
        expect((await storedReviews())[0]).toMatchObject({ body: "text" });
      },
    );
  });

  describe("delete", () => {
    it("deletes the user's own review; a repeat is not_found", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      const id = await seedReview(user, landmark, 4);
      expect(await deleteReview(prisma, user, id)).toEqual({ kind: "deleted" });
      expect(await storedReviews()).toHaveLength(0);
      expect(await deleteReview(prisma, user, id)).toEqual({ kind: "not_found" });
    });

    it("refuses another user's review and a missing review identically, deleting nothing", async () => {
      const [owner, other] = [await createUser("owner"), await createUser("other")];
      const id = await seedReview(owner, await createLandmark(), 4);
      expect(await deleteReview(prisma, other, id)).toEqual({ kind: "not_found" });
      expect(await deleteReview(prisma, other, UNKNOWN_UUID)).toEqual({ kind: "not_found" });
      expect(await storedReviews()).toHaveLength(1);
    });

    it.each(NON_VISIBLE)(
      "lets the author delete their review while the landmark is %s",
      async (_l, state) => {
        const user = await createUser();
        const landmark = await createLandmark();
        const id = await seedReview(user, landmark, 4);
        await setLandmark(landmark, state);
        expect(await deleteReview(prisma, user, id)).toEqual({ kind: "deleted" });
        expect(await storedReviews()).toHaveLength(0);
      },
    );
  });

  describe("own-review lookup", () => {
    it("returns the user's own review, or null, for a visible landmark", async () => {
      const [a, b] = [await createUser("a"), await createUser("b")];
      const landmark = await createLandmark();
      const id = await seedReview(a, landmark, 5, "mine");
      const own = await getOwnReview(prisma, a, landmark);
      expect(own).toEqual({
        kind: "found",
        review: expect.objectContaining({
          id,
          rating: 5,
          body: "mine",
          author_label: "Community Member",
        }),
      });
      expect(await getOwnReview(prisma, b, landmark)).toEqual({ kind: "found", review: null });
    });

    it.each(NON_VISIBLE)(
      "is not_found for a %s landmark even when the user has a review (A3)",
      async (_l, state) => {
        const user = await createUser();
        const landmark = await createLandmark();
        await seedReview(user, landmark, 4);
        await setLandmark(landmark, state);
        expect(await getOwnReview(prisma, user, landmark)).toEqual({ kind: "not_found" });
      },
    );

    it("is not_found for an unknown landmark", async () => {
      expect(await getOwnReview(prisma, await createUser(), UNKNOWN_UUID)).toEqual({
        kind: "not_found",
      });
    });
  });

  describe("public list and aggregates", () => {
    it("an empty visible landmark lists no reviews, count 0, average null", async () => {
      expect(await listPublicReviews(prisma, await createLandmark(), firstPage)).toEqual({
        kind: "listed",
        body: {
          reviews: [],
          aggregate: { average_rating: null, rating_count: 0 },
          page: 1,
          limit: 20,
          has_more: false,
        },
      });
    });

    it.each(NON_VISIBLE)(
      "a %s landmark is not_found, with no review or aggregate data",
      async (_l, state) => {
        const user = await createUser();
        const landmark = await createLandmark();
        await seedReview(user, landmark, 5, "hidden");
        await setLandmark(landmark, state);
        expect(await listPublicReviews(prisma, landmark, firstPage)).toEqual({ kind: "not_found" });
        const raw = await repository.listPublicReviews(prisma, landmark, firstPage);
        expect(raw).toEqual({
          visible: false,
          ratingCount: 0,
          averageRating: null,
          rows: [],
          hasMore: false,
        });
      },
    );

    it("an unknown landmark is not_found", async () => {
      expect(await listPublicReviews(prisma, UNKNOWN_UUID, firstPage)).toEqual({
        kind: "not_found",
      });
    });

    it("keeps aggregates correct through create, edit, and delete (including rating-only reviews)", async () => {
      const landmark = await createLandmark();
      const users = [await createUser("a"), await createUser("b"), await createUser("c")];
      const aggregate = async () => {
        const out = await listPublicReviews(prisma, landmark, firstPage);
        if (out.kind !== "listed") throw new Error("expected listed");
        return out.body.aggregate;
      };

      const r1 = await seedReview(users[0]!, landmark, 5); // rating-only
      expect(await aggregate()).toEqual({ average_rating: 5, rating_count: 1 });
      await seedReview(users[1]!, landmark, 4, "text");
      expect(await aggregate()).toEqual({ average_rating: 4.5, rating_count: 2 });
      const r3 = await seedReview(users[2]!, landmark, 4);
      expect(await aggregate()).toEqual({ average_rating: 13 / 3, rating_count: 3 });

      await updateReview(prisma, users[0]!, r1, { rating: 1 });
      expect(await aggregate()).toEqual({ average_rating: 3, rating_count: 3 });

      await deleteReview(prisma, users[2]!, r3);
      expect(await aggregate()).toEqual({ average_rating: 2.5, rating_count: 2 });

      await deleteReview(prisma, users[0]!, r1);
      await deleteReview(prisma, users[1]!, (await storedReviews({ userId: users[1]! }))[0]!.id);
      expect(await aggregate()).toEqual({ average_rating: null, rating_count: 0 });
    });

    it("returns the unrounded mean exactly as sum/count in double precision (R5)", async () => {
      const landmark = await createLandmark();
      const ratings = [5, 4, 4, 1, 2, 5, 3]; // sum 24, count 7
      for (const rating of ratings) await seedReview(await createUser(), landmark, rating);
      const out = await listPublicReviews(prisma, landmark, firstPage);
      expect(out.kind === "listed" && out.body.aggregate).toEqual({
        average_rating: 24 / 7,
        rating_count: 7,
      });
      expect(24 / 7).not.toBe(Math.round((24 / 7) * 10) / 10);
    });

    it("excludes other landmarks' reviews from the list and the aggregate", async () => {
      const [l1, l2] = [await createLandmark(), await createLandmark()];
      const user = await createUser();
      await seedReview(user, l1, 5);
      await seedReview(user, l2, 1);
      const out = await listPublicReviews(prisma, l1, firstPage);
      expect(out.kind === "listed" && out.body.aggregate).toEqual({
        average_rating: 5,
        rating_count: 1,
      });
      expect(out.kind === "listed" && out.body.reviews).toHaveLength(1);
    });

    it("orders by created_at DESC, id DESC, pages correctly, and aggregates over ALL reviews", async () => {
      const landmark = await createLandmark();
      const sameTime = "2026-03-01 12:00:00.000";
      const idLow = "10000000-0000-4000-8000-000000000000";
      const idHigh = "f0000000-0000-4000-8000-000000000000";
      const older = await insertReviewAt(
        await createUser(),
        landmark,
        1,
        "2026-02-01 12:00:00.000",
      );
      await insertReviewAt(await createUser(), landmark, 2, sameTime, idLow);
      await insertReviewAt(await createUser(), landmark, 3, sameTime, idHigh);
      const newest = await insertReviewAt(
        await createUser(),
        landmark,
        4,
        "2026-04-01 12:00:00.000",
      );

      const all = await listPublicReviews(prisma, landmark, firstPage);
      expect(all.kind === "listed" && all.body.reviews.map((r) => r.id)).toEqual([
        newest,
        idHigh,
        idLow,
        older,
      ]);

      const pages = [];
      for (let page = 1; page <= 4; page += 1) {
        const out = await listPublicReviews(
          prisma,
          landmark,
          parseListQuery({ page: String(page), limit: "1" }),
        );
        if (out.kind !== "listed") throw new Error("expected listed");
        pages.push(out.body);
      }
      expect(pages.map((p) => p.reviews.map((r) => r.id))).toEqual([
        [newest],
        [idHigh],
        [idLow],
        [older],
      ]);
      expect(pages.map((p) => p.has_more)).toEqual([true, true, true, false]);
      for (const p of pages) expect(p.aggregate).toEqual({ average_rating: 2.5, rating_count: 4 });

      const beyond = await listPublicReviews(
        prisma,
        landmark,
        parseListQuery({ page: "9", limit: "1" }),
      );
      expect(beyond).toEqual({
        kind: "listed",
        body: {
          reviews: [],
          aggregate: { average_rating: 2.5, rating_count: 4 },
          page: 9,
          limit: 1,
          has_more: false,
        },
      });
    });

    it("has_more is false when the page is exactly full", async () => {
      const landmark = await createLandmark();
      for (let i = 0; i < 2; i += 1) await seedReview(await createUser(), landmark, 3);
      const out = await listPublicReviews(prisma, landmark, parseListQuery({ limit: "2" }));
      expect(out.kind === "listed" && out.body.has_more).toBe(false);
    });

    it("never exposes user IDs, emails, or landmark data in any representation", async () => {
      const user = await createUser("private");
      const landmark = await createLandmark();
      await seedReview(user, landmark, 4, "text");
      const email = (await prisma.user.findUniqueOrThrow({ where: { id: user } })).email;
      const outputs = [
        await listPublicReviews(prisma, landmark, firstPage),
        await getOwnReview(prisma, user, landmark),
      ];
      for (const output of outputs) {
        const json = JSON.stringify(output);
        expect(json).not.toContain(user);
        expect(json).not.toContain(email);
        expect(json).not.toContain(landmark);
        expect(json).not.toMatch(/Restricted Falls|restricted|user_id|landmark_id|email/);
      }
    });
  });

  describe("timestamps through the Prisma PostgreSQL adapter", () => {
    it("round-trips a stored UTC wall-clock time to the same ISO 8601 instant with milliseconds", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      await insertReviewAt(user, landmark, 3, "2026-07-04 23:59:58.789");
      const own = await getOwnReview(prisma, user, landmark);
      expect(own.kind === "found" && own.review).toMatchObject({
        created_at: "2026-07-04T23:59:58.789Z",
        updated_at: "2026-07-04T23:59:58.789Z",
      });
    });

    it("a database-defaulted created_at is the current UTC instant", async () => {
      const before = Date.now();
      const outcome = await createReview(prisma, await createUser(), {
        landmarkId: await createLandmark(),
        rating: 3,
        body: null,
      });
      const after = Date.now();
      expect(outcome.kind).toBe("created");
      if (outcome.kind !== "created") return;
      const created = Date.parse(outcome.review.created_at);
      // Same machine and container clock; allow small skew and ms rounding.
      expect(created).toBeGreaterThanOrEqual(before - 2_000);
      expect(created).toBeLessThanOrEqual(after + 2_000);
    });
  });

  describe("concurrency", () => {
    it("a create blocked behind an uncommitted duplicate is a duplicate after COMMIT", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      await withBlocker(async ({ blocker, blockerPid, observer, track, finish }) => {
        await blocker.query(
          "INSERT INTO reviews (user_id, landmark_id, rating) VALUES ($1::uuid, $2::uuid, 2)",
          [user, landmark],
        );
        const pending = track(
          createReview(prisma, user, { landmarkId: landmark, rating: 5, body: "late" }),
        );
        expectReviewsCreateStatement(await waitUntilBlockedBy(observer, blockerPid));
        await finish("COMMIT");
        expect(await within(pending, WAIT_TIMEOUT_MS, "create")).toEqual({ kind: "duplicate" });
      });
      const rows = await storedReviews({ userId: user });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ rating: 2, body: null });
    });

    it("a create blocked behind an uncommitted duplicate is created after ROLLBACK", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      await withBlocker(async ({ blocker, blockerPid, observer, track, finish }) => {
        await blocker.query(
          "INSERT INTO reviews (user_id, landmark_id, rating) VALUES ($1::uuid, $2::uuid, 2)",
          [user, landmark],
        );
        const pending = track(
          createReview(prisma, user, { landmarkId: landmark, rating: 5, body: "won" }),
        );
        expectReviewsCreateStatement(await waitUntilBlockedBy(observer, blockerPid));
        await finish("ROLLBACK");
        const outcome = await within(pending, WAIT_TIMEOUT_MS, "create");
        expect(outcome.kind).toBe("created");
      });
      const rows = await storedReviews({ userId: user });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ rating: 5, body: "won" });
    });

    it("20 parallel creates by one user produce exactly one review and 19 duplicates", async () => {
      const user = await createUser();
      const landmark = await createLandmark();
      const outcomes = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          createReview(prisma, user, {
            landmarkId: landmark,
            rating: (i % 5) + 1,
            body: `attempt ${i}`,
          }),
        ),
      );
      expect(outcomes.filter((o) => o.kind === "created")).toHaveLength(1);
      expect(outcomes.filter((o) => o.kind === "duplicate")).toHaveLength(19);
      expect(await storedReviews({ userId: user })).toHaveLength(1);
    });

    it("parallel creates by different users on one landmark all succeed and aggregate correctly", async () => {
      const landmark = await createLandmark();
      const users = await Promise.all(Array.from({ length: 10 }, (_, i) => createUser(`p${i}`)));
      const outcomes = await Promise.all(
        users.map((user, i) =>
          createReview(prisma, user, { landmarkId: landmark, rating: (i % 5) + 1, body: null }),
        ),
      );
      expect(outcomes.every((o) => o.kind === "created")).toBe(true);
      const out = await listPublicReviews(prisma, landmark, firstPage);
      expect(out.kind === "listed" && out.body.aggregate).toEqual({
        average_rating: 3,
        rating_count: 10,
      });
    });
  });
});
