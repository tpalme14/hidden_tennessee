import { createHmac } from "node:crypto";
import express, { Router, type Express, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { createMountProtected } from "../src/auth/protected-route.js";
import { createRequireSession, type SessionAuthority } from "../src/auth/require-session.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { prisma } from "../src/db/prisma.js";
import { createReviewsRateLimiter } from "../src/reviews/rate-limit.js";
import { createReviewsRouter } from "../src/reviews/router.js";
import {
  TEST_ORIGIN,
  anonymous,
  asUser,
  createSignedInUser,
  createTwoUsers,
  signOut,
  type TestUser,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M04-T02 Increment 3 — the reviews HTTP API over real HTTP, real session
 * cookies, and landmarks_test (ADR-009): every status and envelope of
 * specs/RATINGS_REVIEWS_SPEC.md v1.1 §6, authentication, CSRF, ownership,
 * the visibility matrix, middleware order, caching, the public list, the
 * fixed 500/503, and throttling.
 *
 * Limiter isolation: tests on the real `createApp()` use the PRODUCTION
 * limiters (reviews: 20 mutations / 120 lookups; favorites unchanged). Every
 * test creates fresh users, so counters never accumulate across tests.
 * Throttling boundaries are tested on test-only apps, each with a FRESH
 * reviews limiter at the approved limits and an injected clock.
 */

const NO_STORE = "private, no-store";
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
const INVALID_ORIGIN = {
  error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." },
};
const RATE_LIMITED = {
  error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
};
const INTERNAL_ERROR = {
  error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
};
const SERVICE_UNAVAILABLE = {
  error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." },
};
const ALREADY_EXISTS = {
  error: { code: "REVIEW_ALREADY_EXISTS", message: "You have already reviewed this landmark." },
};
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NON_BMP = "\u{1F332}";

const invalidRequest = (message: string) => ({ error: { code: "INVALID_REQUEST", message } });
const invalidQuery = (message: string) => ({ error: { code: "INVALID_QUERY", message } });

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";
let sequence = 0;

async function createLandmark(
  options: { status?: Status; active?: boolean } = {},
): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `PEA${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNPEAKS",
      category: "PEAK",
      displayName: `Restricted Peak ${sequence}`,
      latitude: 35.5628,
      longitude: -83.4985,
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

const reviewCount = (where: { userId?: string; landmarkId?: string } = {}) =>
  prisma.review.count({ where });
const listPath = (landmarkId: string) => `/api/v1/landmarks/${landmarkId}/reviews`;
const lookupPath = (landmarkId: string) => `/api/v1/reviews?landmark_id=${landmarkId}`;
const reviewPath = (reviewId: string) => `/api/v1/reviews/${reviewId}`;

function expectNoStore(response: request.Response, label = "") {
  expect(response.headers["cache-control"], label).toBe(NO_STORE);
}

/** A validly signed session cookie for a token the database does not know. */
function forgedCookie(): string {
  const value = "ForgedTokenNotInTheDatabase0000";
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(value)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`;
}

/** Creates a review as `user` through the real API; returns its ID. */
async function createVia(
  app: Express,
  user: TestUser,
  landmarkId: string,
  rating = 4,
  body?: string,
) {
  const response = await asUser(app, user)
    .post("/api/v1/reviews")
    .send({ landmark_id: landmarkId, rating, ...(body !== undefined ? { body } : {}) });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

/**
 * A test-only app wired like src/app.ts (Better Auth, JSON parser, the real
 * CSRF check), with a reviews router built from `routerDeps` and mounted
 * through `mount` (the REAL `mountProtected` unless a test injects another).
 */
function fixtureApp(
  routerDeps: Parameters<typeof createReviewsRouter>[0],
  mount: typeof mountProtected = mountProtected,
): Express {
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  mount(api, "/reviews", createReviewsRouter(routerDeps));
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(NOT_FOUND);
  });
  return app;
}

const NON_VISIBLE: [string, { status?: Status; active?: boolean }][] = [
  ["SENSITIVE", { status: "SENSITIVE" }],
  ["UNREVIEWED", { status: "UNREVIEWED" }],
  ["retired", { active: false }],
];

describe("reviews HTTP API (integration, M04-T02 Increment 3)", () => {
  const app = createApp();

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  describe("create — POST /api/v1/reviews", () => {
    it("201 with exactly the safe representation; no-store; text stored and returned verbatim", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const response = await asUser(app, user).post("/api/v1/reviews").send({
        landmark_id: landmark,
        rating: 5,
        body: "  First line\n\nSecond <b>line</b> \u{1F332}  ",
      });
      expect(response.status).toBe(201);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expectNoStore(response);
      expect(response.body).toEqual({
        id: expect.any(String),
        rating: 5,
        body: "First line\n\nSecond <b>line</b> \u{1F332}",
        created_at: expect.stringMatching(ISO_UTC_MS),
        updated_at: response.body.created_at,
        author_label: "Community Member",
      });
      const json = JSON.stringify(response.body);
      expect(json).not.toContain(user.userId);
      expect(json).not.toContain(user.email);
      expect(json).not.toContain(landmark);
      expect(await reviewCount({ userId: user.userId })).toBe(1);
    });

    it("accepts a rating-only review (body null) and exactly 2,000 non-BMP code points", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const ratingOnly = await asUser(app, a)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 3 });
      expect(ratingOnly.status).toBe(201);
      expect(ratingOnly.body.body).toBeNull();
      const long = await asUser(app, b)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 3, body: NON_BMP.repeat(2000) });
      expect(long.status).toBe(201);
      expect(long.body.body).toBe(NON_BMP.repeat(2000));
    });

    it("409 REVIEW_ALREADY_EXISTS for a second create, without the existing review's ID; nothing changes", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark, 5, "original");
      const response = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 1, body: "again" });
      expect(response.status).toBe(409);
      expect(response.body).toEqual(ALREADY_EXISTS);
      expect(JSON.stringify(response.body)).not.toContain(id);
      expectNoStore(response);
      const rows = await prisma.review.findMany({ where: { userId: user.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id, rating: 5, body: "original" });
    });

    it.each(NON_VISIBLE)(
      "404 for a %s landmark, identical to an unknown landmark; nothing stored",
      async (_l, state) => {
        const user = await createSignedInUser(app);
        const landmark = await createLandmark(state);
        const hidden = await asUser(app, user)
          .post("/api/v1/reviews")
          .send({ landmark_id: landmark, rating: 4 });
        const unknown = await asUser(app, user)
          .post("/api/v1/reviews")
          .send({ landmark_id: UNKNOWN_ID, rating: 4 });
        for (const response of [hidden, unknown]) {
          expect(response.status).toBe(404);
          expect(response.body).toEqual(NOT_FOUND);
          expectNoStore(response);
        }
        expect(await reviewCount()).toBe(0);
      },
    );

    it.each([
      ["rating 0", { rating: 0 }, "rating must be a whole number from 1 through 5."],
      ["rating 6", { rating: 6 }, "rating must be a whole number from 1 through 5."],
      ["fractional rating", { rating: 4.5 }, "rating must be a whole number from 1 through 5."],
      ["string rating", { rating: "5" }, "rating must be a whole number from 1 through 5."],
      ["missing rating", {}, "rating must be a whole number from 1 through 5."],
      [
        "2,001 code points",
        { rating: 3, body: NON_BMP.repeat(2001) },
        "body must be at most 2,000 characters.",
      ],
      [
        "a NUL character",
        { rating: 3, body: "a\u0000b" },
        "body contains characters that are not allowed.",
      ],
      [
        "a lone surrogate",
        { rating: 3, body: "a\uD83Cb" },
        "body contains characters that are not allowed.",
      ],
      ["a non-string body", { rating: 3, body: 7 }, "body must be text or null."],
      [
        "a client user_id",
        { rating: 3, user_id: UNKNOWN_ID },
        "The request body contains unsupported fields.",
      ],
    ])(
      "400 INVALID_REQUEST for %s, with a fixed message; nothing stored",
      async (_l, fields, message) => {
        const user = await createSignedInUser(app);
        const landmark = await createLandmark();
        const response = await asUser(app, user)
          .post("/api/v1/reviews")
          .send({ landmark_id: landmark, ...fields });
        expect(response.status).toBe(400);
        expect(response.body).toEqual(invalidRequest(message));
        expectNoStore(response);
        expect(await reviewCount()).toBe(0);
      },
    );

    it("400 INVALID_REQUEST for a malformed landmark_id, and 400 INVALID_QUERY for any query parameter", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const malformed = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: "nope", rating: 3 });
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(invalidRequest("Invalid landmark ID."));
      const withQuery = await asUser(app, user)
        .post(`/api/v1/reviews?user_id=${UNKNOWN_ID}`)
        .send({ landmark_id: landmark, rating: 3 });
      expect(withQuery.status).toBe(400);
      expect(withQuery.body).toEqual(invalidQuery("This request accepts no query parameters."));
      expect(await reviewCount()).toBe(0);
    });

    it("validation runs before the service: an invalid body on a non-visible landmark is 400, not 404", async () => {
      const user = await createSignedInUser(app);
      const hidden = await createLandmark({ status: "SENSITIVE" });
      const response = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: hidden, rating: 9 });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_REQUEST");
    });

    it("the old v1.0 create path is not a route: POST /api/v1/landmarks/:id/reviews is 404 and stores nothing", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const response = await asUser(app, user).post(listPath(landmark)).send({ rating: 4 });
      expect(response.status).toBe(404);
      expect(response.body).toEqual(NOT_FOUND);
      expect(await reviewCount()).toBe(0);
    });
  });

  describe("own-review lookup — GET /api/v1/reviews?landmark_id=", () => {
    it("200 { review } for the caller's own review, { review: null } when none; never another user's", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const id = await createVia(app, a, landmark, 5, "mine");
      const own = await asUser(app, a).get(lookupPath(landmark));
      expect(own.status).toBe(200);
      expectNoStore(own);
      expect(own.body).toEqual({
        review: {
          id,
          rating: 5,
          body: "mine",
          created_at: expect.stringMatching(ISO_UTC_MS),
          updated_at: expect.stringMatching(ISO_UTC_MS),
          author_label: "Community Member",
        },
      });
      const other = await asUser(app, b).get(lookupPath(landmark));
      expect(other.status).toBe(200);
      expect(other.body).toEqual({ review: null });
    });

    it.each(NON_VISIBLE)(
      "404 for a %s landmark even when the caller has a review (A3)",
      async (_l, state) => {
        const user = await createSignedInUser(app);
        const landmark = await createLandmark();
        await createVia(app, user, landmark);
        await setLandmark(landmark, state);
        const response = await asUser(app, user).get(lookupPath(landmark));
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
      },
    );

    it.each([
      ["missing landmark_id", "/api/v1/reviews"],
      ["malformed landmark_id", "/api/v1/reviews?landmark_id=nope"],
      [
        "repeated landmark_id",
        `/api/v1/reviews?landmark_id=${UNKNOWN_ID}&landmark_id=${UNKNOWN_ID}`,
      ],
      ["an extra parameter", `/api/v1/reviews?landmark_id=${UNKNOWN_ID}&user_id=${UNKNOWN_ID}`],
    ])("400 INVALID_QUERY for %s", async (_l, path) => {
      const user = await createSignedInUser(app);
      const response = await asUser(app, user).get(path);
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        invalidQuery(
          "landmark_id is required and must be a valid ID; no other query parameters are accepted.",
        ),
      );
      expectNoStore(response);
    });
  });

  describe("edit — PATCH /api/v1/reviews/:reviewId", () => {
    it("200 with the updated representation; omitted body kept, null clears; ID and created_at stable", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const created = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 3, body: "keep" });
      const id = created.body.id as string;

      const rating = await asUser(app, user).patch(reviewPath(id)).send({ rating: 5 });
      expect(rating.status).toBe(200);
      expectNoStore(rating);
      expect(rating.body).toEqual({
        id,
        rating: 5,
        body: "keep",
        created_at: created.body.created_at,
        updated_at: expect.stringMatching(ISO_UTC_MS),
        author_label: "Community Member",
      });
      const cleared = await asUser(app, user).patch(reviewPath(id)).send({ body: null });
      expect(cleared.body).toMatchObject({
        id,
        rating: 5,
        body: null,
        created_at: created.body.created_at,
      });
    });

    it("404 for another user's review and for a missing review — identical, nothing changed", async () => {
      const [owner, other] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const id = await createVia(app, owner, landmark, 3, "owner text");
      const foreign = await asUser(app, other)
        .patch(reviewPath(id))
        .send({ rating: 1, body: "hijack" });
      const missing = await asUser(app, other).patch(reviewPath(UNKNOWN_ID)).send({ rating: 1 });
      for (const response of [foreign, missing]) {
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
      }
      expect(await prisma.review.findUnique({ where: { id } })).toMatchObject({
        rating: 3,
        body: "owner text",
      });
    });

    it.each(NON_VISIBLE)(
      "404 for the owner's own review while the landmark is %s (A2)",
      async (_l, state) => {
        const user = await createSignedInUser(app);
        const landmark = await createLandmark();
        const id = await createVia(app, user, landmark, 3, "text");
        await setLandmark(landmark, state);
        const response = await asUser(app, user).patch(reviewPath(id)).send({ body: "edited" });
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
      },
    );

    it("400s: malformed ID (INVALID_REQUEST), empty PATCH (INVALID_REQUEST), query parameter (INVALID_QUERY)", async () => {
      const user = await createSignedInUser(app);
      const id = await createVia(app, user, await createLandmark());
      const malformed = await asUser(app, user).patch(reviewPath("nope")).send({ rating: 2 });
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(invalidRequest("Invalid review ID."));
      const empty = await asUser(app, user).patch(reviewPath(id)).send({});
      expect(empty.status).toBe(400);
      expect(empty.body).toEqual(invalidRequest("Provide rating, body, or both."));
      const query = await asUser(app, user)
        .patch(`${reviewPath(id)}?x=1`)
        .send({ rating: 2 });
      expect(query.status).toBe(400);
      expect(query.body).toEqual(invalidQuery("This request accepts no query parameters."));
      const landmarkField = await asUser(app, user)
        .patch(reviewPath(id))
        .send({ landmark_id: UNKNOWN_ID });
      expect(landmarkField.status).toBe(400);
      expect(landmarkField.body).toEqual(
        invalidRequest("The request body contains unsupported fields."),
      );
    });
  });

  describe("delete — DELETE /api/v1/reviews/:reviewId", () => {
    it("200 { success: true } for the owner; a repeat is 404", async () => {
      const user = await createSignedInUser(app);
      const id = await createVia(app, user, await createLandmark());
      const first = await asUser(app, user).delete(reviewPath(id));
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ success: true });
      expectNoStore(first);
      expect(await reviewCount()).toBe(0);
      const again = await asUser(app, user).delete(reviewPath(id));
      expect(again.status).toBe(404);
      expect(again.body).toEqual(NOT_FOUND);
    });

    it("404 for another user's review and a missing review; nothing deleted", async () => {
      const [owner, other] = await createTwoUsers(app);
      const id = await createVia(app, owner, await createLandmark());
      for (const target of [id, UNKNOWN_ID]) {
        const response = await asUser(app, other).delete(reviewPath(target));
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
      }
      expect(await reviewCount()).toBe(1);
    });

    it.each(NON_VISIBLE)(
      "lets the owner delete while the landmark is %s, revealing no landmark data",
      async (_l, state) => {
        const user = await createSignedInUser(app);
        const landmark = await createLandmark();
        const id = await createVia(app, user, landmark);
        await setLandmark(landmark, state);
        const response = await asUser(app, user).delete(reviewPath(id));
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(await reviewCount()).toBe(0);
      },
    );

    it("400 INVALID_REQUEST for body fields; 400 INVALID_QUERY for query parameters; nothing deleted", async () => {
      const user = await createSignedInUser(app);
      const id = await createVia(app, user, await createLandmark());
      const body = await asUser(app, user).delete(reviewPath(id)).send({ user_id: user.userId });
      expect(body.status).toBe(400);
      expect(body.body).toEqual(invalidRequest("This request accepts no body fields."));
      const query = await asUser(app, user).delete(`${reviewPath(id)}?force=1`);
      expect(query.status).toBe(400);
      expect(query.body.error.code).toBe("INVALID_QUERY");
      expect(await reviewCount()).toBe(1);
    });
  });

  describe("public list — GET /api/v1/landmarks/:landmarkId/reviews", () => {
    it("is readable anonymously, with the spec §6 shape, newest first, and no Cache-Control", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const first = await createVia(app, a, landmark, 5, "older");
      const second = await createVia(app, b, landmark, 2);
      await prisma.review.update({
        where: { id: first },
        data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      });

      const response = await anonymous(app).get(listPath(landmark));
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBeUndefined();
      expect(response.body).toEqual({
        reviews: [
          expect.objectContaining({
            id: second,
            rating: 2,
            body: null,
            author_label: "Community Member",
          }),
          expect.objectContaining({
            id: first,
            rating: 5,
            body: "older",
            created_at: "2026-01-01T00:00:00.000Z",
          }),
        ],
        aggregate: { average_rating: 3.5, rating_count: 2 },
        page: 1,
        limit: 20,
        has_more: false,
      });
      for (const review of response.body.reviews) {
        expect(Object.keys(review).sort()).toEqual(
          ["author_label", "body", "created_at", "id", "rating", "updated_at"].sort(),
        );
      }
    });

    it("is IDENTICAL for an anonymous caller, the author, and another user (no per-user field, no session read)", async () => {
      const [author, other] = await createTwoUsers(app);
      const landmark = await createLandmark();
      await createVia(app, author, landmark, 4, "text");
      const bodies = [];
      for (const caller of [anonymous(app), asUser(app, author), asUser(app, other)]) {
        const response = await caller.get(listPath(landmark));
        expect(response.status).toBe(200);
        expect(response.headers["cache-control"]).toBeUndefined();
        bodies.push(response.body);
      }
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
      const json = JSON.stringify(bodies[0]);
      expect(json).not.toMatch(/is_own_review|user_id|email/);
      expect(json).not.toContain(author.userId);
      expect(json).not.toContain(author.email);
    });

    it.each(NON_VISIBLE)(
      "404 for a %s landmark, identical to an unknown one, with no review or landmark data",
      async (_l, state) => {
        const user = await createSignedInUser(app);
        const landmark = await createLandmark();
        await createVia(app, user, landmark, 5, "hidden text");
        await setLandmark(landmark, state);
        const hidden = await anonymous(app).get(listPath(landmark));
        const unknown = await anonymous(app).get(listPath(UNKNOWN_ID));
        expect(hidden.status).toBe(404);
        expect(hidden.body).toEqual(NOT_FOUND);
        expect(unknown.status).toBe(404);
        expect(hidden.body).toEqual(unknown.body);
        expect(hidden.text).not.toMatch(/hidden text|Restricted Peak|restricted|rating/);
      },
    );

    it("400 INVALID_REQUEST for a malformed landmark ID (A1); 400 INVALID_QUERY for invalid pagination", async () => {
      const landmark = await createLandmark();
      const malformed = await anonymous(app).get("/api/v1/landmarks/not-a-uuid/reviews");
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(invalidRequest("Invalid landmark ID."));
      for (const query of ["limit=101", "limit=0", "page=0", "page=1.5", "sort=rating"]) {
        const response = await anonymous(app).get(`${listPath(landmark)}?${query}`);
        expect(response.status, query).toBe(400);
        expect(response.body.error.code, query).toBe("INVALID_QUERY");
      }
    });

    it("pages with page/limit, has_more, and an aggregate over ALL reviews", async () => {
      const users = [
        await createSignedInUser(app, "p1"),
        await createSignedInUser(app, "p2"),
        await createSignedInUser(app, "p3"),
      ];
      const landmark = await createLandmark();
      for (const [i, user] of users.entries()) await createVia(app, user, landmark, i + 1);
      const page1 = await anonymous(app).get(`${listPath(landmark)}?page=1&limit=2`);
      const page2 = await anonymous(app).get(`${listPath(landmark)}?page=2&limit=2`);
      expect(page1.body).toMatchObject({
        page: 1,
        limit: 2,
        has_more: true,
        aggregate: { average_rating: 2, rating_count: 3 },
      });
      expect(page1.body.reviews).toHaveLength(2);
      expect(page2.body).toMatchObject({
        page: 2,
        limit: 2,
        has_more: false,
        aggregate: { average_rating: 2, rating_count: 3 },
      });
      expect(page2.body.reviews).toHaveLength(1);
    });

    it("is not throttled: 125 consecutive requests by a signed-in user all succeed", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      for (let i = 0; i < 125; i += 1) {
        const response = await asUser(app, user).get(listPath(landmark));
        expect(response.status).toBe(200);
      }
    });
  });

  describe("authentication, CSRF, and middleware order", () => {
    it("401 UNAUTHENTICATED (no-store) for every authenticated route without a session; nothing changes", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark);
      const attempts = [
        () => anonymous(app).post("/api/v1/reviews").send({ landmark_id: landmark, rating: 1 }),
        () => anonymous(app).get(lookupPath(landmark)),
        () => anonymous(app).patch(reviewPath(id)).send({ rating: 1 }),
        () => anonymous(app).delete(reviewPath(id)),
        // An invalid request without a session is still 401: the session check precedes validation.
        () => anonymous(app).post("/api/v1/reviews").send({ rating: "bad" }),
        () => anonymous(app).put("/api/v1/reviews"),
      ];
      for (const attempt of attempts) {
        const response = await attempt();
        expect(response.status).toBe(401);
        expect(response.body).toEqual(UNAUTHENTICATED);
        expectNoStore(response);
      }
      expect(await prisma.review.findUnique({ where: { id } })).toMatchObject({ rating: 4 });
    });

    it("401 for a forged session cookie and after sign-out", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const forged = await request(app)
        .post("/api/v1/reviews")
        .set("Origin", TEST_ORIGIN)
        .set("Cookie", forgedCookie())
        .send({ landmark_id: landmark, rating: 4 });
      expect(forged.status).toBe(401);
      expect(forged.body).toEqual(UNAUTHENTICATED);
      await signOut(app, user);
      const signedOut = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 4 });
      expect(signedOut.status).toBe(401);
      expect(await reviewCount()).toBe(0);
    });

    it("403 INVALID_ORIGIN (no-store) for cookie-bearing writes without trusted origin — before the session check", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark);
      const writes = [
        (r: request.Test) => r,
        (r: request.Test) => r.set("Origin", "https://evil.example"),
      ];
      for (const decorate of writes) {
        const post = decorate(request(app).post("/api/v1/reviews").set("Cookie", user.cookie)).send(
          {
            landmark_id: landmark,
            rating: 1,
          },
        );
        const patch = decorate(request(app).patch(reviewPath(id)).set("Cookie", user.cookie)).send({
          rating: 1,
        });
        const del = decorate(request(app).delete(reviewPath(id)).set("Cookie", user.cookie));
        for (const response of [await post, await patch, await del]) {
          expect(response.status).toBe(403);
          expect(response.body).toEqual(INVALID_ORIGIN);
          expectNoStore(response);
        }
      }
      // Origin precedes the session check: an anonymous cross-origin write is also 403, not 401.
      const anonymousCrossOrigin = await request(app)
        .post("/api/v1/reviews")
        .set("Origin", "https://evil.example")
        .set("Cookie", "better-auth.session_token=x")
        .send({});
      expect(anonymousCrossOrigin.status).toBe(403);
      expect(await prisma.review.findUnique({ where: { id } })).toMatchObject({ rating: 4 });
      expect(await reviewCount()).toBe(1);
    });

    it("unsupported methods under /api/v1/reviews are denied: 401 anonymously, 404 when signed in", async () => {
      const user = await createSignedInUser(app);
      for (const [method, path] of [
        ["put", "/api/v1/reviews"],
        ["delete", "/api/v1/reviews"],
        ["get", `/api/v1/reviews/${UNKNOWN_ID}`],
        ["post", `/api/v1/reviews/${UNKNOWN_ID}`],
      ] as const) {
        const signedIn = await asUser(app, user)[method](path);
        expect(signedIn.status, `${method} ${path}`).toBe(404);
        expect(signedIn.body).toEqual(NOT_FOUND);
        const anon = await anonymous(app)[method](path);
        expect(anon.status, `${method} ${path}`).toBe(401);
      }
    });
  });

  describe("fixed server errors", () => {
    it("an unexpected service failure is the fixed 500 INTERNAL_ERROR with no-store and no detail", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const failing = {
        createReview: async () => {
          throw new Error("secret internal detail: connection string");
        },
        getOwnReview: async () => {
          throw new Error("secret internal detail");
        },
        updateReview: async () => {
          throw new Error("secret internal detail");
        },
        deleteReview: async () => {
          throw new Error("secret internal detail");
        },
      };
      const broken = fixtureApp({ service: failing as never });
      const user = await createSignedInUser(broken);
      const response = await asUser(broken, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: UNKNOWN_ID, rating: 3 });
      expect(response.status).toBe(500);
      expect(response.body).toEqual(INTERNAL_ERROR);
      expectNoStore(response);
      expect(response.text).not.toContain("secret");
    });

    it("a session-validation infrastructure failure is 503 SERVICE_UNAVAILABLE with no-store; no handler runs", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const faulty: SessionAuthority = {
        api: {
          getSession: (async () => {
            throw new Error("session store down");
          }) as unknown as SessionAuthority["api"]["getSession"],
        },
      };
      const handler = vi.fn();
      const outage = fixtureApp(
        { service: { createReview: handler } as never },
        createMountProtected(createRequireSession(faulty)),
      );
      const response = await request(outage)
        .post("/api/v1/reviews")
        .set("Origin", TEST_ORIGIN)
        .set("Cookie", forgedCookie())
        .send({ landmark_id: UNKNOWN_ID, rating: 3 });
      expect(response.status).toBe(503);
      expect(response.body).toEqual(SERVICE_UNAVAILABLE);
      expectNoStore(response);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("throttling (fresh limiter at the approved limits, injected clock)", () => {
    function throttledApp() {
      let t = 1_000_000;
      const log = vi.fn();
      const limiter = createReviewsRateLimiter({ now: () => t, log });
      return {
        app: fixtureApp({ limiter }),
        advance: (ms: number) => {
          t += ms;
        },
      };
    }

    it("20 mutations (POST, PATCH, DELETE combined) are allowed; the 21st is 429 with Retry-After, before validation", async () => {
      const { app: limited, advance } = throttledApp();
      const user = await createSignedInUser(limited);
      const landmark = await createLandmark();
      const created = await asUser(limited, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 3 });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      // 19 more mutations of all three kinds, including invalid ones (each allowed request counts — F1).
      for (let i = 0; i < 9; i += 1) {
        expect(
          (
            await asUser(limited, user)
              .patch(reviewPath(id))
              .send({ rating: (i % 5) + 1 })
          ).status,
        ).toBe(200);
      }
      for (let i = 0; i < 5; i += 1) {
        expect(
          (await asUser(limited, user).post("/api/v1/reviews").send({ rating: 0 })).status,
        ).toBe(400);
      }
      for (let i = 0; i < 5; i += 1) {
        expect((await asUser(limited, user).delete(reviewPath(UNKNOWN_ID))).status).toBe(404);
      }

      advance(15_000);
      for (const attempt of [
        () => asUser(limited, user).post("/api/v1/reviews").send({ rating: "invalid" }),
        () => asUser(limited, user).patch(reviewPath(id)).send({ rating: 1 }),
        () => asUser(limited, user).delete(reviewPath(id)),
      ]) {
        const response = await attempt();
        expect(response.status).toBe(429);
        expect(response.body).toEqual(RATE_LIMITED);
        expect(response.headers["retry-after"]).toBe("45");
        expectNoStore(response);
      }
      expect(await reviewCount()).toBe(1);

      // Lookups use the independent read bucket.
      expect((await asUser(limited, user).get(lookupPath(landmark))).status).toBe(200);

      // After the window, mutations are allowed again.
      advance(45_000);
      expect((await asUser(limited, user).patch(reviewPath(id)).send({ rating: 2 })).status).toBe(
        200,
      );
    });

    it("120 lookups are allowed; the 121st is 429 with Retry-After; mutations are unaffected", async () => {
      const { app: limited } = throttledApp();
      const user = await createSignedInUser(limited);
      const landmark = await createLandmark();
      for (let i = 0; i < 120; i += 1) {
        expect((await asUser(limited, user).get(lookupPath(landmark))).status).toBe(200);
      }
      const blocked = await asUser(limited, user).get("/api/v1/reviews"); // invalid, but throttled first
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual(RATE_LIMITED);
      expect(blocked.headers["retry-after"]).toBe("60");
      expect(
        (
          await asUser(limited, user)
            .post("/api/v1/reviews")
            .send({ landmark_id: landmark, rating: 4 })
        ).status,
      ).toBe(201);
    });

    it("counters are per user: another user is unaffected when one is throttled", async () => {
      const { app: limited } = throttledApp();
      const [a, b] = await createTwoUsers(limited);
      for (let i = 0; i < 20; i += 1) await asUser(limited, a).delete(reviewPath(UNKNOWN_ID));
      expect((await asUser(limited, a).delete(reviewPath(UNKNOWN_ID))).status).toBe(429);
      expect((await asUser(limited, b).delete(reviewPath(UNKNOWN_ID))).status).toBe(404);
    });
  });

  describe("limiter independence on the real application", () => {
    it("exhausting the reviews mutation limit leaves favorites and the public list unaffected", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      for (let i = 0; i < 20; i += 1) {
        expect((await asUser(app, user).delete(reviewPath(UNKNOWN_ID))).status).toBe(404);
      }
      const throttled = await asUser(app, user).delete(reviewPath(UNKNOWN_ID));
      expect(throttled.status).toBe(429);
      expect(throttled.body).toEqual(RATE_LIMITED);
      expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);

      const favorite = await asUser(app, user).put(`/api/v1/favorites/${landmark}`).send({});
      expect(favorite.status).toBe(201);
      expect((await asUser(app, user).get("/api/v1/favorites")).status).toBe(200);
      expect((await asUser(app, user).get(lookupPath(landmark))).status).toBe(200);
      expect((await anonymous(app).get(listPath(landmark))).status).toBe(200);
    });
  });
});
