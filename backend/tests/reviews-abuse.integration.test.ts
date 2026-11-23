import { randomUUID } from "node:crypto";
import express, { Router, type Express, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { prisma } from "../src/db/prisma.js";
import { createPublicReviewsRouter } from "../src/reviews/public-router.js";
import {
  DEFAULT_REVIEWS_RATE_LIMITS,
  REVIEWS_RATE_LIMIT_CAPACITY_EVENT,
  createReviewsRateLimiter,
} from "../src/reviews/rate-limit.js";
import { createReviewsRouter } from "../src/reviews/router.js";
import { anonymous, asUser, createSignedInUser, type TestUser } from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M04-T04 Increment 4 — rate-limit and abuse verification over the real route
 * stack (R1: per user, per process, fixed 60-second windows; 20 combined
 * mutations and 120 own-review lookups per window; fail-closed key capacity;
 * ADR-013 decision 10). Verification only: the limiter is unchanged.
 *
 * Window and capacity tests inject a limiter AT THE APPROVED LIMITS with a
 * controlled clock into the real reviews routers and protected mount. The
 * parallel tests use the REAL application and its real limiter. Reviews used as
 * targets are seeded directly in `landmarks_test`, so seeding never spends a
 * user's quota.
 */

const WINDOW_MS = 60_000;
const RATE_LIMITED =
  '{"error":{"code":"RATE_LIMITED","message":"Too many requests. Please try again later."}}';

let sequence = 0;
async function createLandmark(): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `ABU${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNSINKS",
      category: "SINK",
      displayName: `Abuse Test Sink ${sequence}`,
      latitude: 35.9,
      longitude: -85.3,
      sensitivityStatus: "PUBLIC",
    },
  });
  return landmark.id;
}

/** A review created directly in the database (does not consume any quota). */
async function seedReview(user: TestUser, landmarkId: string, rating = 3, body = "seeded") {
  const review = await prisma.review.create({
    data: { userId: user.userId, landmarkId, rating, body },
  });
  return review.id;
}

/** The real routers and protected mount, with an injected limiter. */
function limitedApp(limiter: ReturnType<typeof createReviewsRateLimiter>): Express {
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  api.use(createPublicReviewsRouter());
  mountProtected(api, "/reviews", createReviewsRouter({ limiter }));
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found." } });
  });
  return app;
}

function controlledLimiter(options: { maxKeys?: number } = {}) {
  let t = 1_000_000;
  const log = vi.fn();
  const limiter = createReviewsRateLimiter({ now: () => t, log, ...options });
  return {
    limiter,
    log,
    now: () => t,
    set: (value: number) => {
      t = value;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function expect429(response: request.Response, retryAfter: number | null, label: string) {
  expect(response.status, label).toBe(429);
  expect(response.text, label).toBe(RATE_LIMITED);
  expect(response.headers["cache-control"], label).toBe("private, no-store");
  const header = Number(response.headers["retry-after"]);
  if (retryAfter === null) {
    expect(header, label).toBeGreaterThanOrEqual(1);
    expect(header, label).toBeLessThanOrEqual(60);
  } else {
    expect(header, label).toBe(retryAfter);
  }
}

/** Every review row of `userId`, in a stable form for before/after comparison. */
const rowsOf = (userId: string) =>
  prisma.review.findMany({ where: { userId }, orderBy: { id: "asc" } });

describe("reviews rate limiting and abuse (integration, M04-T04 Increment 4)", () => {
  const realApp = createApp();

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  it("fixed windows: opened by the first allowed request; Retry-After counts down to the exact reset; blocked requests neither count nor extend", async () => {
    const c = controlledLimiter();
    const app = limitedApp(c.limiter);
    const user = await createSignedInUser(realApp);
    const reviewId = await seedReview(user, await createLandmark());
    const patch = (rating: number) =>
      asUser(app, user).patch(`/api/v1/reviews/${reviewId}`).send({ rating });

    const W = c.now() + 5_000; // the first request opens the window here, not on a clock boundary
    c.set(W);
    for (let i = 0; i < 10; i += 1) expect((await patch(1 + (i % 5))).status).toBe(200);
    c.set(W + 30_000);
    for (let i = 0; i < 10; i += 1) expect((await patch(1 + (i % 5))).status).toBe(200);

    // Retry-After = max(1, ceil((W + 60 s - now) / 1 s)), checked at the transitions.
    const points: [number, number][] = [
      [30_000, 30],
      [30_001, 30],
      [30_999, 30],
      [31_000, 29],
      [58_999, 2],
      [59_000, 1],
      [59_001, 1],
      [59_999, 1],
    ];
    for (const [offset, retryAfter] of points) {
      c.set(W + offset);
      // Several blocked attempts at each point: none counts or moves the reset.
      for (let k = 0; k < 3; k += 1) expect429(await patch(5), retryAfter, `t+${offset}ms`);
    }

    // Exactly at W + 60 s a new window opens at that instant, with a full quota.
    c.set(W + WINDOW_MS);
    for (let i = 0; i < DEFAULT_REVIEWS_RATE_LIMITS.mutation; i += 1) {
      expect((await patch(4)).status, `new window request ${i + 1}`).toBe(200);
    }
    expect429(await patch(4), 60, "21st in the new window");
    c.set(W + WINDOW_MS + 45_500);
    expect429(await patch(4), 15, "15 s before the second reset (ceil of 14.5 s)");
  });

  it("invalid and refused-but-admitted requests consume capacity; 401 and 403 never reach the limiter", async () => {
    const c = controlledLimiter();
    const app = limitedApp(c.limiter);
    const user = await createSignedInUser(realApp);
    const landmark = await createLandmark();
    const reviewId = await seedReview(user, landmark);

    // Not counted: no session (401) and an untrusted origin (403) are refused before the limiter.
    for (let i = 0; i < 30; i += 1) {
      expect(
        (await anonymous(app).patch(`/api/v1/reviews/${reviewId}`).send({ rating: 1 })).status,
      ).toBe(401);
      const forged = await request(app)
        .patch(`/api/v1/reviews/${reviewId}`)
        .set("Cookie", user.cookie)
        .set("Origin", "https://evil.example")
        .send({ rating: 1 });
      expect(forged.status).toBe(403);
    }

    // Counted: 20 admitted requests, most of which fail validation or ownership.
    const admitted: [string, () => request.Test, number][] = [];
    for (let i = 0; i < 8; i += 1) {
      admitted.push([
        "invalid body",
        () => asUser(app, user).post("/api/v1/reviews").send({ landmark_id: landmark, rating: 9 }),
        400,
      ]);
    }
    for (let i = 0; i < 4; i += 1) {
      admitted.push([
        "query on a mutation",
        () =>
          asUser(app, user).post("/api/v1/reviews?x=1").send({ landmark_id: landmark, rating: 3 }),
        400,
      ]);
    }
    for (let i = 0; i < 4; i += 1) {
      admitted.push([
        "unknown review",
        () => asUser(app, user).delete(`/api/v1/reviews/${randomUUID()}`),
        404,
      ]);
    }
    for (let i = 0; i < 3; i += 1) {
      admitted.push([
        "duplicate create",
        () => asUser(app, user).post("/api/v1/reviews").send({ landmark_id: landmark, rating: 3 }),
        409,
      ]);
    }
    admitted.push([
      "valid edit",
      () => asUser(app, user).patch(`/api/v1/reviews/${reviewId}`).send({ rating: 5 }),
      200,
    ]);
    expect(admitted).toHaveLength(20);
    for (const [label, run, status] of admitted) expect((await run()).status, label).toBe(status);

    // The 21st, though perfectly valid, is throttled.
    expect429(
      await asUser(app, user).patch(`/api/v1/reviews/${reviewId}`).send({ rating: 2 }),
      60,
      "21st",
    );
    expect(await rowsOf(user.userId)).toEqual([
      expect.objectContaining({ id: reviewId, rating: 5 }),
    ]);
  });

  it("429 responses change nothing: no create, edit, or delete; rows and aggregates are identical", async () => {
    const c = controlledLimiter();
    const app = limitedApp(c.limiter);
    const user = await createSignedInUser(realApp);
    const landmark = await createLandmark();
    const other = await createLandmark();
    const reviewId = await seedReview(user, landmark, 3, "before the limit");
    for (let i = 0; i < 20; i += 1) {
      expect((await asUser(app, user).delete(`/api/v1/reviews/${randomUUID()}`)).status).toBe(404);
    }
    const before = await rowsOf(user.userId);
    const listBefore = (await anonymous(app).get(`/api/v1/landmarks/${landmark}/reviews`)).text;

    const attempts = [
      await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: other, rating: 5, body: "new" }),
      await asUser(app, user)
        .patch(`/api/v1/reviews/${reviewId}`)
        .send({ rating: 1, body: "changed" }),
      await asUser(app, user).patch(`/api/v1/reviews/${reviewId}`).send({ body: null }),
      await asUser(app, user).delete(`/api/v1/reviews/${reviewId}`),
    ];
    for (const [i, response] of attempts.entries()) expect429(response, 60, `attempt ${i}`);

    expect(await rowsOf(user.userId)).toEqual(before); // including updatedAt
    expect(await prisma.review.count({ where: { landmarkId: other } })).toBe(0);
    expect((await anonymous(app).get(`/api/v1/landmarks/${landmark}/reviews`)).text).toBe(
      listBefore,
    );
  });

  it("the mutation and lookup buckets are independent; the public list is never throttled; both buckets reset with their windows", async () => {
    const c = controlledLimiter();
    const app = limitedApp(c.limiter);
    const user = await createSignedInUser(realApp);
    const landmark = await createLandmark();
    await seedReview(user, landmark);
    const lookup = () => asUser(app, user).get(`/api/v1/reviews?landmark_id=${landmark}`);

    for (let i = 0; i < 20; i += 1) {
      await asUser(app, user).delete(`/api/v1/reviews/${randomUUID()}`);
    }
    expect429(
      await asUser(app, user).delete(`/api/v1/reviews/${randomUUID()}`),
      60,
      "mutations exhausted",
    );

    for (let i = 0; i < DEFAULT_REVIEWS_RATE_LIMITS.read; i += 1) {
      expect((await lookup()).status, `lookup ${i + 1}`).toBe(200);
    }
    expect429(await lookup(), 60, "121st lookup");

    // The public list (even with the throttled user's cookie) is not counted or refused.
    for (let i = 0; i < 150; i += 1) {
      const list = await asUser(app, user).get(`/api/v1/landmarks/${landmark}/reviews`);
      expect(list.status).toBe(200);
      expect(list.headers["retry-after"]).toBeUndefined();
    }

    c.advance(WINDOW_MS);
    expect((await lookup()).status).toBe(200);
    expect((await asUser(app, user).delete(`/api/v1/reviews/${randomUUID()}`)).status).toBe(404);
  });

  it("separate users get independent quotas", async () => {
    const c = controlledLimiter();
    const app = limitedApp(c.limiter);
    const a = await createSignedInUser(realApp, "a");
    const b = await createSignedInUser(realApp, "b");
    const landmark = await createLandmark();
    for (let i = 0; i < 20; i += 1) await asUser(app, a).delete(`/api/v1/reviews/${randomUUID()}`);
    expect429(await asUser(app, a).delete(`/api/v1/reviews/${randomUUID()}`), 60, "A throttled");

    expect(
      (await asUser(app, b).post("/api/v1/reviews").send({ landmark_id: landmark, rating: 4 }))
        .status,
    ).toBe(201);
    for (let i = 0; i < 19; i += 1) {
      expect((await asUser(app, b).delete(`/api/v1/reviews/${randomUUID()}`)).status).toBe(404);
    }
    expect429(
      await asUser(app, b).delete(`/api/v1/reviews/${randomUUID()}`),
      60,
      "B after its own 20",
    );
    expect429(
      await asUser(app, a).delete(`/api/v1/reviews/${randomUUID()}`),
      60,
      "A still throttled",
    );
  });

  it("key capacity through the real route stack: a NEW key at the cap is refused (fail closed) and recovers when windows expire", async () => {
    // The real 10,000-key default is exercised in tests/reviews-rate-limit-capacity.test.ts;
    // here a cap of 3 shows the HTTP behaviour without 10,000 accounts.
    const c = controlledLimiter({ maxKeys: 3 });
    const app = limitedApp(c.limiter);
    const [u1, u2, u3] = [
      await createSignedInUser(realApp, "u1"),
      await createSignedInUser(realApp, "u2"),
      await createSignedInUser(realApp, "u3"),
    ];
    const landmark = await createLandmark();
    expect((await asUser(app, u1).get(`/api/v1/reviews?landmark_id=${landmark}`)).status).toBe(200);
    expect((await asUser(app, u1).delete(`/api/v1/reviews/${randomUUID()}`)).status).toBe(404);
    c.advance(10_000);
    expect((await asUser(app, u2).delete(`/api/v1/reviews/${randomUUID()}`)).status).toBe(404);
    expect(c.limiter.size()).toBe(3);

    // u3 has made no request at all, yet is refused: the map is full and nothing is evicted.
    expect429(
      await asUser(app, u3).post("/api/v1/reviews").send({ landmark_id: landmark, rating: 2 }),
      60,
      "u3 create",
    );
    expect429(
      await asUser(app, u3).get(`/api/v1/reviews?landmark_id=${landmark}`),
      60,
      "u3 lookup",
    );
    expect429(
      await asUser(app, u2).get(`/api/v1/reviews?landmark_id=${landmark}`),
      60,
      "u2's new lookup key",
    );
    expect(await prisma.review.count({ where: { landmarkId: landmark } })).toBe(0);
    // Existing keys keep working.
    expect((await asUser(app, u1).get(`/api/v1/reviews?landmark_id=${landmark}`)).status).toBe(200);
    expect((await asUser(app, u2).delete(`/api/v1/reviews/${randomUUID()}`)).status).toBe(404);
    // One log line, the event code only.
    expect(c.log.mock.calls).toEqual([["warn", REVIEWS_RATE_LIMIT_CAPACITY_EVENT]]);

    // u1's two keys expire 60 s after they opened: u3 is admitted and creates its review.
    c.advance(WINDOW_MS - 10_000);
    const created = await asUser(app, u3)
      .post("/api/v1/reviews")
      .send({ landmark_id: landmark, rating: 2 });
    expect(created.status).toBe(201);
    expect(c.limiter.size()).toBe(2); // u2's live key and u3's new one
  });

  it("50 concurrent mutations by one user on the REAL application: exactly 20 pass the limiter, 30 are 429; admitted ones may still be refused; state stays consistent", async () => {
    const user = await createSignedInUser(realApp, "parallel");
    const own = await createLandmark();
    const duplicateTarget = await createLandmark();
    const reviewId = await seedReview(user, own, 3, "seeded");
    const fresh = await Promise.all(Array.from({ length: 10 }, () => createLandmark()));

    const kinds: [string, () => request.Test][] = [
      ...Array.from({ length: 10 }, (): [string, () => request.Test] => [
        "invalid create",
        () => asUser(realApp, user).post("/api/v1/reviews").send({ landmark_id: own, rating: 0 }),
      ]),
      ...Array.from({ length: 10 }, (): [string, () => request.Test] => [
        "same-landmark create",
        () =>
          asUser(realApp, user)
            .post("/api/v1/reviews")
            .send({ landmark_id: duplicateTarget, rating: 4 }),
      ]),
      ...Array.from({ length: 10 }, (): [string, () => request.Test] => [
        "unknown delete",
        () => asUser(realApp, user).delete(`/api/v1/reviews/${randomUUID()}`),
      ]),
      ...Array.from({ length: 10 }, (_, i): [string, () => request.Test] => [
        "own edit",
        () =>
          asUser(realApp, user)
            .patch(`/api/v1/reviews/${reviewId}`)
            .send({ rating: 1 + (i % 5) }),
      ]),
      ...fresh.map((landmarkId): [string, () => request.Test] => [
        "fresh create",
        () =>
          asUser(realApp, user)
            .post("/api/v1/reviews")
            .send({ landmark_id: landmarkId, rating: 5 }),
      ]),
    ];
    expect(kinds).toHaveLength(50);
    const responses = await Promise.all(
      kinds.map(async ([kind, run]) => ({ kind, response: await run() })),
    );

    const statuses = responses.map((r) => r.response.status);
    const admitted = responses.filter((r) => r.response.status !== 429);
    expect(admitted, JSON.stringify(statuses)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(30);
    for (const r of responses.filter((x) => x.response.status === 429))
      expect429(r.response, null, r.kind);
    // Admission is not success: every admitted request got its normal, valid outcome.
    const allowedOutcomes: Record<string, number[]> = {
      "invalid create": [400],
      "same-landmark create": [201, 409],
      "unknown delete": [404],
      "own edit": [200],
      "fresh create": [201],
    };
    for (const r of admitted) expect(allowedOutcomes[r.kind], r.kind).toContain(r.response.status);
    expect(statuses.every((s) => s < 500)).toBe(true);

    // Database state matches exactly what was admitted.
    const sameLandmarkCreated = admitted.filter(
      (r) => r.kind === "same-landmark create" && r.response.status === 201,
    );
    expect(sameLandmarkCreated.length).toBeLessThanOrEqual(1);
    expect(await prisma.review.count({ where: { landmarkId: duplicateTarget } })).toBe(
      sameLandmarkCreated.length,
    );
    const freshCreated = admitted.filter((r) => r.kind === "fresh create").length;
    expect(await prisma.review.count({ where: { landmarkId: { in: fresh } } })).toBe(freshCreated);
    expect(await prisma.review.count({ where: { userId: user.userId } })).toBe(
      1 + freshCreated + sameLandmarkCreated.length,
    );
    const edits = admitted.filter((r) => r.kind === "own edit");
    const row = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    if (edits.length > 0) {
      expect(edits.map((e) => e.response.body.rating)).toContain(row.rating);
    } else {
      expect(row.rating).toBe(3);
    }
    // The quota is spent: the next mutation is refused; lookups are a separate bucket.
    expect429(await asUser(realApp, user).delete(`/api/v1/reviews/${randomUUID()}`), null, "51st");
    expect((await asUser(realApp, user).get(`/api/v1/reviews?landmark_id=${own}`)).status).toBe(
      200,
    );
  });

  it("150 concurrent own-review lookups by one user on the REAL application: exactly 120 admitted, 30 are 429", async () => {
    const user = await createSignedInUser(realApp, "parallel-reads");
    const landmark = await createLandmark();
    await seedReview(user, landmark, 4, "mine");
    const responses = await Promise.all(
      Array.from({ length: 150 }, () =>
        asUser(realApp, user).get(`/api/v1/reviews?landmark_id=${landmark}`),
      ),
    );
    const ok = responses.filter((r) => r.status === 200);
    expect(ok).toHaveLength(120);
    for (const r of ok) expect(r.body.review).toMatchObject({ rating: 4, body: "mine" });
    const throttled = responses.filter((r) => r.status === 429);
    expect(throttled).toHaveLength(30);
    for (const r of throttled) expect429(r, null, "lookup 429");
    // Mutations were untouched by the read storm.
    expect((await asUser(realApp, user).delete(`/api/v1/reviews/${randomUUID()}`)).status).toBe(
      404,
    );
  });
});
