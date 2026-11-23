import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { Prisma } from "@prisma/client";
import type request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { anonymous, asUser, createSignedInUser, type TestUser } from "./helpers/test-users.js";

/**
 * M04-T04 Increment 5 — bounded, deterministic concurrency and stress
 * verification (decision D3: no latency thresholds; query plans are inspected,
 * not required). Runs on `landmarks_test` only (the integration setup's
 * guard, re-checked below). Verification only: no index, query, or limit is
 * changed.
 *
 * Unlike the other integration files, this one does NOT truncate the
 * database: every row it creates is tracked by ID and deleted explicitly at
 * the end, and the row counts of every other table are compared before and
 * after, so unrelated data is provably untouched.
 *
 * Measurements are printed as `[stress] …` lines for the record.
 */

const app = createApp();
const SEEDED = 1_000;
const SEED_DOMAIN = "stress-m04t04.test";
const seededUserId = (i: number) => `5e000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const seededReviewId = (i: number) => `5e100000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const BASE_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);

const tracked = { userIds: new Set<string>(), landmarkIds: new Set<string>() };
const timings: Record<string, number> = {};
let countsBefore: Record<string, number> = {};
let bigLandmark = "";
let sequence = 0;

function log(line: string) {
  console.log(`[stress] ${line}`);
}

async function time<T>(label: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    timings[label] = Math.round(performance.now() - start);
  }
}

async function tableCounts(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ name: string; n: number }[]>`
    SELECT 'users' AS name, count(*)::int AS n FROM users
    UNION ALL SELECT 'accounts', count(*)::int FROM accounts
    UNION ALL SELECT 'sessions', count(*)::int FROM sessions
    UNION ALL SELECT 'landmarks', count(*)::int FROM landmarks
    UNION ALL SELECT 'reviews', count(*)::int FROM reviews
    UNION ALL SELECT 'favorites', count(*)::int FROM favorites
    UNION ALL SELECT 'verifications', count(*)::int FROM verifications`;
  return Object.fromEntries(rows.map((r) => [r.name, r.n]));
}

async function createLandmark(label: string): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `STR${String(sequence).padStart(3, "0")}`,
      sourceFile: "TNSINKS",
      category: "SINK",
      displayName: `Stress ${label} ${sequence}`,
      latitude: 35.9,
      longitude: -85.3,
      sensitivityStatus: "PUBLIC",
    },
  });
  tracked.landmarkIds.add(landmark.id);
  return landmark.id;
}

async function signedIn(label: string): Promise<TestUser> {
  const user = await createSignedInUser(app, label);
  tracked.userIds.add(user.userId);
  return user;
}

/** Deletes exactly what this file created, children first. */
async function cleanup(): Promise<Record<string, number>> {
  const userIds = [...tracked.userIds];
  const landmarkIds = [...tracked.landmarkIds];
  const deleted: Record<string, number> = {};
  deleted.reviews = (
    await prisma.review.deleteMany({
      where: { OR: [{ landmarkId: { in: landmarkIds } }, { userId: { in: userIds } }] },
    })
  ).count;
  deleted.favorites = (
    await prisma.favorite.deleteMany({ where: { userId: { in: userIds } } })
  ).count;
  deleted.sessions = (
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  ).count;
  deleted.accounts = (
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } })
  ).count;
  deleted.users = (await prisma.user.deleteMany({ where: { id: { in: userIds } } })).count;
  deleted.landmarks = (
    await prisma.landmark.deleteMany({ where: { id: { in: landmarkIds } } })
  ).count;
  return deleted;
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    n: sorted.length,
    min: Math.round(sorted[0]!),
    median: Math.round(at(0.5)),
    p95: Math.round(at(0.95)),
    max: Math.round(sorted[sorted.length - 1]!),
  };
}

describe("reviews bounded concurrency and stress (integration, M04-T04 Increment 5)", () => {
  beforeAll(async () => {
    const [identity] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(identity?.db).toBe("landmarks_test");
    countsBefore = await tableCounts();

    // ~1,000 synthetic users and reviews on ONE landmark, with deterministic IDs.
    // Every third review shares a timestamp, so the id tiebreak is exercised.
    await time("seed", async () => {
      bigLandmark = await createLandmark("large");
      await prisma.user.createMany({
        data: Array.from({ length: SEEDED }, (_, i) => ({
          id: seededUserId(i),
          name: "",
          email: `seed-${String(i).padStart(4, "0")}@${SEED_DOMAIN}`,
        })),
      });
      for (let i = 0; i < SEEDED; i += 1) tracked.userIds.add(seededUserId(i));
      await prisma.review.createMany({
        data: Array.from({ length: SEEDED }, (_, i) => ({
          id: seededReviewId(i),
          userId: seededUserId(i),
          landmarkId: bigLandmark,
          rating: ((i * 7) % 5) + 1,
          body: i % 4 === 0 ? null : `Seeded review ${i}`,
          createdAt: new Date(BASE_TIME + Math.floor(i / 3) * 1000),
          updatedAt: new Date(BASE_TIME + Math.floor(i / 3) * 1000),
        })),
      });
    });
    log(`seed: ${SEEDED} users + ${SEEDED} reviews in ${timings.seed} ms`);
  }, 120_000);

  afterAll(async () => {
    const deleted = await time("cleanup", cleanup);
    const after = await tableCounts();
    log(`cleanup: ${JSON.stringify(deleted)} in ${timings.cleanup} ms`);
    log(`table counts before=${JSON.stringify(countsBefore)} after=${JSON.stringify(after)}`);
    log(`timings (ms): ${JSON.stringify(timings)}`);
    // Every other row is untouched: the counts are back exactly where they started.
    expect(after).toEqual(countsBefore);
  }, 120_000);

  it("pages through ~1,000 reviews at limit=100: exact order (created_at DESC, id DESC), no gaps, no duplicates, consistent aggregate", async () => {
    const expected = await prisma.review.findMany({
      where: { landmarkId: bigLandmark },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, rating: true },
    });
    expect(expected).toHaveLength(SEEDED);
    const sum = expected.reduce((s, r) => s + r.rating, 0);

    const seen: string[] = [];
    await time("pagination", async () => {
      for (let page = 1; page <= 11; page += 1) {
        const response = await anonymous(app).get(
          `/api/v1/landmarks/${bigLandmark}/reviews?page=${page}&limit=100`,
        );
        expect(response.status).toBe(200);
        const body = response.body as {
          reviews: { id: string; created_at: string }[];
          aggregate: { average_rating: number; rating_count: number };
          page: number;
          limit: number;
          has_more: boolean;
        };
        expect(body.page).toBe(page);
        expect(body.limit).toBe(100);
        expect(body.reviews).toHaveLength(page <= 10 ? 100 : 0);
        expect(body.has_more).toBe(page < 10);
        // The aggregate covers every review on every page: sum / count, unrounded.
        expect(body.aggregate).toEqual({ rating_count: SEEDED, average_rating: sum / SEEDED });
        seen.push(...body.reviews.map((r) => r.id));
      }
    });
    expect(seen).toHaveLength(SEEDED);
    expect(new Set(seen).size).toBe(SEEDED);
    expect(seen).toEqual(expected.map((r) => r.id));

    // The database's own aggregate agrees.
    const [db] = await prisma.$queryRaw<{ n: number; avg: number }[]>`
      SELECT count(*)::int AS n, sum(rating)::float8 / count(*) AS avg
      FROM reviews WHERE landmark_id = ${bigLandmark}::uuid`;
    expect(db).toEqual({ n: SEEDED, avg: sum / SEEDED });
    log(
      `pagination: 11 pages, ${seen.length} unique ids, average ${sum / SEEDED}, ${timings.pagination} ms`,
    );
  });

  it("EXPLAIN (ANALYZE, BUFFERS) of the public-list query: the composite index exists; the chosen plans are recorded", async () => {
    // The SQL below is the repository's list query with its parameters numbered; fail if it changes.
    const repository = readFileSync(
      new URL("../src/reviews/repository.ts", import.meta.url),
      "utf8",
    );
    for (const fragment of [
      "WHERE landmark_id IN (SELECT id FROM visible)",
      "ORDER BY created_at DESC, id DESC",
      "sum(rating)::float8 / count(*)",
      "LEFT JOIN page AS p ON true",
    ]) {
      expect(repository).toContain(fragment);
    }
    const listSql = `
      WITH visible AS (
        SELECT id FROM landmarks
        WHERE id = $1::uuid AND is_active AND sensitivity_status = 'PUBLIC'
      ), agg AS (
        SELECT count(*)::int AS rating_count,
               CASE WHEN count(*) = 0 THEN NULL ELSE sum(rating)::float8 / count(*) END AS average_rating
        FROM reviews
        WHERE landmark_id IN (SELECT id FROM visible)
      ), page AS (
        SELECT id, rating, body, created_at, updated_at
        FROM reviews
        WHERE landmark_id IN (SELECT id FROM visible)
        ORDER BY created_at DESC, id DESC
        LIMIT $2
        OFFSET $3
      )
      SELECT (SELECT count(*) FROM visible)::int AS visible,
             agg.rating_count, agg.average_rating,
             p.id::text AS id, p.rating, p.body, p.created_at, p.updated_at
      FROM agg
      LEFT JOIN page AS p ON true
      ORDER BY p.created_at DESC, p.id DESC`;

    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'reviews' ORDER BY indexname`;
    const composite = indexes.find((i) =>
      /\(landmark_id, created_at DESC, id DESC\)/.test(i.indexdef),
    );
    expect(composite, JSON.stringify(indexes)).toBeDefined();
    log(`indexes on reviews: ${indexes.map((i) => i.indexdef).join(" | ")}`);

    // Statistics as a fresh deployment would have them after autovacuum's analyze.
    await prisma.$executeRawUnsafe("ANALYZE reviews");
    const [stats] = await prisma.$queryRaw<{ reltuples: number; relpages: number }[]>`
      SELECT reltuples::float8 AS reltuples, relpages::int AS relpages FROM pg_class WHERE relname = 'reviews'`;
    log(`reviews statistics: reltuples=${stats!.reltuples} relpages=${stats!.relpages}`);

    type PlanNode = {
      "Node Type": string;
      "Index Name"?: string;
      "Relation Name"?: string;
      "Actual Rows"?: number;
      "Shared Hit Blocks"?: number;
      "Shared Read Blocks"?: number;
      Plans?: PlanNode[];
    };
    const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
    const explain = async (limit: number, offset: number, forceIndex = false, sql = listSql) =>
      prisma.$transaction((tx) => explainIn(tx, limit, offset, forceIndex, sql));
    const explainIn = async (
      tx: Prisma.TransactionClient,
      limit: number,
      offset: number,
      forceIndex: boolean,
      sql: string,
    ) => {
      {
        if (forceIndex) await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": unknown }[]>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
          bigLandmark,
          limit,
          offset,
        );
        const plan = (rows[0]!["QUERY PLAN"] as { Plan: PlanNode; "Execution Time": number }[])[0]!;
        const nodes = flatten(plan.Plan).filter(
          (n) => n["Relation Name"] === "reviews" || n["Index Name"],
        );
        return {
          executionMs: plan["Execution Time"],
          reviewsAccess: nodes.map((n) =>
            [
              n["Node Type"],
              n["Index Name"] ?? n["Relation Name"],
              `rows=${n["Actual Rows"]}`,
            ].join(" "),
          ),
          topNodes: flatten(plan.Plan).map((n) => n["Node Type"]),
          sharedHit: flatten(plan.Plan).reduce((s, n) => s + (n["Shared Hit Blocks"] ?? 0), 0),
          sharedRead: flatten(plan.Plan).reduce((s, n) => s + (n["Shared Read Blocks"] ?? 0), 0),
        };
      }
    };
    // RECORD ONLY (decision D3): index selection is the planner's choice and is
    // not asserted. The last two lines compare a page query that names the
    // landmark directly (`landmark_id = $1`, as the composite index is keyed) —
    // an experiment, not the production query.
    const directPageSql = `
      SELECT id, rating, body, created_at, updated_at
      FROM reviews
      WHERE landmark_id = $1::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      OFFSET $3`;
    for (const [label, limit, offset, force, sql] of [
      ["page 1 (limit 101, offset 0)", 101, 0, false, listSql],
      ["page 10 (limit 101, offset 900)", 101, 900, false, listSql],
      ["page 1, seq scan disabled", 101, 0, true, listSql],
      ["experiment: direct landmark_id = $1 page 1", 101, 0, false, directPageSql],
      [
        "experiment: direct landmark_id = $1 page 1, seq scan disabled",
        101,
        0,
        true,
        directPageSql,
      ],
    ] as const) {
      const result = await explain(limit, offset, force, sql);
      log(`EXPLAIN ${label}: ${JSON.stringify(result)}`);
      expect(result.executionMs).toBeGreaterThan(0);
      expect(result.reviewsAccess.length).toBeGreaterThan(0);
    }

    // Supplementary, record-only: a SELECTIVE distribution — 9,000 more reviews
    // on nine other landmarks, so the large landmark holds 10% of the table —
    // inserted and analyzed inside a transaction that is always rolled back.
    const ROLLBACK = new Error("rollback: supplementary plan experiment");
    const selective = await prisma
      .$transaction(
        async (tx) => {
          const others: string[] = [];
          for (let k = 0; k < 9; k += 1) {
            const landmark = await tx.landmark.create({
              data: {
                sourceCode: `STX${String(k).padStart(3, "0")}`,
                sourceFile: "TNSINKS",
                category: "SINK",
                displayName: `Stress selective ${k}`,
                latitude: 35.9,
                longitude: -85.3,
                sensitivityStatus: "PUBLIC",
              },
            });
            others.push(landmark.id);
          }
          await tx.review.createMany({
            data: others.flatMap((landmarkId, k) =>
              Array.from({ length: SEEDED }, (_, i) => ({
                userId: seededUserId(i),
                landmarkId,
                rating: ((i + k) % 5) + 1,
                createdAt: new Date(BASE_TIME + i * 1000),
                updatedAt: new Date(BASE_TIME + i * 1000),
              })),
            ),
          });
          await tx.$executeRawUnsafe("ANALYZE reviews");
          const results: Record<string, unknown> = {};
          results.listPage1 = await explainIn(tx, 101, 0, false, listSql);
          results.listPage10 = await explainIn(tx, 101, 900, false, listSql);
          results.directPage1 = await explainIn(tx, 101, 0, false, directPageSql);
          // The 10,000-row table must not outlive this experiment.
          (ROLLBACK as Error & { results?: unknown }).results = results;
          throw ROLLBACK;
        },
        { timeout: 60_000, maxWait: 10_000 },
      )
      .catch((error: unknown) => {
        if (error !== ROLLBACK) throw error;
        return (ROLLBACK as Error & { results?: Record<string, unknown> }).results!;
      });
    log(
      `EXPLAIN selective (10,000 reviews, 10% on the landmark; rolled back): ${JSON.stringify(selective)}`,
    );
    expect(await prisma.review.count()).toBe(SEEDED); // the rollback left nothing behind
    await prisma.$executeRawUnsafe("ANALYZE reviews"); // restore statistics for the seeded table
  });

  it("~300 concurrent creates, edits, and deletes by 30 users, with concurrent public-list readers: no 5xx, invariants hold, aggregates match the database", async () => {
    const users = await time("mixed-setup", async () => {
      const list: TestUser[] = [];
      for (let i = 0; i < 30; i += 1) list.push(await signedIn(`mixed-${i}`));
      return list;
    });
    const landmarks = [
      await createLandmark("mixed-1"),
      await createLandmark("mixed-2"),
      await createLandmark("mixed-3"),
      await createLandmark("mixed-4"),
    ];
    const [L1, L2, L3, L4] = landmarks as [string, string, string, string];
    const readerStatuses: number[] = [];
    const readerProblems: string[] = [];

    /** Public-list readers: each response must be internally consistent (one snapshot). */
    const readers = (n: number) =>
      Array.from({ length: n }, async (_, i) => {
        const landmarkId = landmarks[i % landmarks.length]!;
        const response = await anonymous(app).get(
          `/api/v1/landmarks/${landmarkId}/reviews?limit=100`,
        );
        readerStatuses.push(response.status);
        if (response.status !== 200) return;
        const { reviews, aggregate } = response.body as {
          reviews: { rating: number }[];
          aggregate: { average_rating: number | null; rating_count: number };
        };
        const mean =
          reviews.length === 0 ? null : reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
        if (aggregate.rating_count !== reviews.length || aggregate.average_rating !== mean) {
          readerProblems.push(
            JSON.stringify({ count: aggregate.rating_count, listed: reviews.length }),
          );
        }
      });

    // Phase A (150 mutations + 50 readers): each user creates on L1–L4, plus a racing duplicate on L1.
    type Outcome = { user: number; kind: string; landmark?: string; response: request.Response };
    const phaseA: Promise<Outcome>[] = [];
    users.forEach((user, u) => {
      for (const landmarkId of [L1, L1, L2, L3, L4]) {
        phaseA.push(
          asUser(app, user)
            .post("/api/v1/reviews")
            .send({ landmark_id: landmarkId, rating: (u % 5) + 1, body: `user ${u}` })
            .then((response) => ({ user: u, kind: "create", landmark: landmarkId, response })),
        );
      }
    });
    const resultsA = await time("mixed-phase-A", async () => {
      const [outcomes] = await Promise.all([Promise.all(phaseA), Promise.all(readers(50))]);
      return outcomes;
    });

    // Every create succeeded once per (user, landmark); the racing duplicate got exactly one 409.
    const reviewOf = new Map<string, string>(); // `${user}:${landmark}` -> review id
    for (const r of resultsA) {
      expect([201, 409], `create ${r.user}`).toContain(r.response.status);
      if (r.response.status === 201) {
        const key = `${r.user}:${r.landmark}`;
        expect(reviewOf.has(key), `one 201 for ${key}`).toBe(false);
        reviewOf.set(key, r.response.body.id as string);
      }
    }
    expect(reviewOf.size).toBe(120);
    expect(resultsA.filter((r) => r.response.status === 409)).toHaveLength(30);

    // Phase B (150 mutations + 50 readers): edit L1–L3, delete L1 and L4 — the L1 edit races its delete.
    const editRating = (u: number) => ((u + 2) % 5) + 1;
    const phaseB: Promise<Outcome>[] = [];
    users.forEach((user, u) => {
      for (const landmarkId of [L1, L2, L3]) {
        phaseB.push(
          asUser(app, user)
            .patch(`/api/v1/reviews/${reviewOf.get(`${u}:${landmarkId}`)}`)
            .send({ rating: editRating(u), body: `edited by ${u}` })
            .then((response) => ({ user: u, kind: "edit", landmark: landmarkId, response })),
        );
      }
      for (const landmarkId of [L1, L4]) {
        phaseB.push(
          asUser(app, user)
            .delete(`/api/v1/reviews/${reviewOf.get(`${u}:${landmarkId}`)}`)
            .then((response) => ({ user: u, kind: "delete", landmark: landmarkId, response })),
        );
      }
    });
    const resultsB = await time("mixed-phase-B", async () => {
      const [outcomes] = await Promise.all([Promise.all(phaseB), Promise.all(readers(50))]);
      return outcomes;
    });

    const all = [...resultsA, ...resultsB];
    expect(all).toHaveLength(300);
    const statuses = all.map((r) => r.response.status);
    expect(
      statuses.every((s) => s < 500),
      JSON.stringify(statuses),
    ).toBe(true);
    expect(statuses).not.toContain(429); // 10 mutations per user, within the limit of 20
    for (const r of resultsB) {
      if (r.kind === "delete") expect(r.response.status, `delete ${r.user}`).toBe(200);
      else if (r.landmark === L1)
        expect([200, 404], `racing edit ${r.user}`).toContain(r.response.status);
      else expect(r.response.status, `edit ${r.user}`).toBe(200);
    }
    expect(readerStatuses).toHaveLength(100);
    expect(readerStatuses.every((s) => s === 200)).toBe(true);
    expect(readerProblems).toEqual([]);

    // Invariants, straight from the database.
    const rows = await prisma.review.findMany({ where: { landmarkId: { in: landmarks } } });
    expect(rows).toHaveLength(60); // each user keeps L2 and L3
    const duplicates = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT user_id, landmark_id FROM reviews GROUP BY user_id, landmark_id HAVING count(*) > 1
      ) d`;
    expect(duplicates[0]!.n).toBe(0);
    const userIndex = new Map(users.map((user, u) => [user.userId, u]));
    for (const row of rows) {
      const u = userIndex.get(row.userId);
      expect(u, "owned by a workload user").toBeDefined();
      expect([L2, L3]).toContain(row.landmarkId);
      // Ownership: the row is exactly the review that user's own create returned, edited by that user.
      expect(row.id).toBe(reviewOf.get(`${u}:${row.landmarkId}`));
      expect(row.rating).toBe(editRating(u!));
      expect(row.body).toBe(`edited by ${u}`);
      expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
    }
    for (const landmarkId of landmarks) {
      const [db] = await prisma.$queryRaw<{ n: number; avg: number | null }[]>`
        SELECT count(*)::int AS n,
               CASE WHEN count(*) = 0 THEN NULL ELSE sum(rating)::float8 / count(*) END AS avg
        FROM reviews WHERE landmark_id = ${landmarkId}::uuid`;
      const api = await anonymous(app).get(`/api/v1/landmarks/${landmarkId}/reviews?limit=100`);
      expect(api.body.aggregate).toEqual({ rating_count: db!.n, average_rating: db!.avg });
      expect(api.body.reviews).toHaveLength(db!.n);
    }
    const tally = (list: Outcome[]) =>
      list.reduce<Record<string, number>>((acc, r) => {
        const key = `${r.kind} ${r.response.status}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
    log(
      `mixed: phase A ${JSON.stringify(tally(resultsA))} in ${timings["mixed-phase-A"]} ms; ` +
        `phase B ${JSON.stringify(tally(resultsB))} in ${timings["mixed-phase-B"]} ms; ` +
        `readers 100 × 200; setup ${timings["mixed-setup"]} ms`,
    );
  }, 120_000);

  it("~100 concurrent public-list requests (the 1,000-review landmark, limit=100): all succeed with identical, well-formed results", async () => {
    const latencies: number[] = [];
    const responses = await time("pool-pressure", () =>
      Promise.all(
        Array.from({ length: 100 }, async (_, i) => {
          const start = performance.now();
          const response = await anonymous(app).get(
            `/api/v1/landmarks/${bigLandmark}/reviews?page=${(i % 10) + 1}&limit=100`,
          );
          latencies.push(performance.now() - start);
          return { page: (i % 10) + 1, response };
        }),
      ),
    );
    expect(responses.every((r) => r.response.status === 200)).toBe(true);
    const byPage = new Map<number, string>();
    for (const { page, response } of responses) {
      expect(response.body.reviews).toHaveLength(100);
      expect(response.body.aggregate.rating_count).toBe(SEEDED);
      expect(response.body.page).toBe(page);
      const previous = byPage.get(page);
      if (previous === undefined) byPage.set(page, response.text);
      else expect(response.text, `page ${page} identical across requests`).toBe(previous);
    }
    log(
      `pool pressure: 100 concurrent list requests in ${timings["pool-pressure"]} ms; ` +
        `latency ms ${JSON.stringify(summarize(latencies))}`,
    );
  });
});
