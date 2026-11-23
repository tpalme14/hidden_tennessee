import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
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
import { createReviewsRouter } from "../src/reviews/router.js";
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  anonymous,
  asUser,
  createSignedInUser,
  createTwoUsers,
  type TestUser,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M04-T02 Increment 4 — reviews security over real HTTP with real accounts
 * (ADR-009; ADR-012 decisions 2–5, 10; spec v1.1 §9 tests #4, #6, #9, #15):
 * identity spoofing, ID confusion, session expiry/revocation, duplicate
 * cookies, hostile and malformed input, a real database outage, and
 * concurrent mutations across users. Fills the gaps left by the Increment 3
 * contract suite (tests/reviews.integration.test.ts); nothing here changes
 * application behaviour.
 */

const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
const INTERNAL_ERROR = {
  error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
};
const UNSUPPORTED = {
  error: { code: "INVALID_REQUEST", message: "The request body contains unsupported fields." },
};
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let sequence = 0;
async function createLandmark(status: "PUBLIC" | "SENSITIVE" = "PUBLIC"): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `SIN${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNSINKS",
      category: "SINK",
      displayName: `Restricted Sink ${sequence}`,
      latitude: 35.9,
      longitude: -85.3,
      sourceDescription: "restricted description",
      sensitivityStatus: status,
    },
  });
  return landmark.id;
}

const reviewPath = (id: string) => `/api/v1/reviews/${id}`;
const lookupPath = (landmarkId: string) => `/api/v1/reviews?landmark_id=${landmarkId}`;
const listPath = (landmarkId: string) => `/api/v1/landmarks/${landmarkId}/reviews`;

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

const rowsOf = (userId: string) =>
  prisma.review.findMany({ where: { userId }, orderBy: { id: "asc" } });

/** The raw `name=value` of the session cookie from a fresh sign-in. */
async function signInAgain(app: Express, user: TestUser): Promise<string> {
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .set("Origin", TEST_ORIGIN)
    .send({ email: user.email, password: TEST_PASSWORD });
  expect(response.status).toBe(200);
  return (response.headers["set-cookie"] as unknown as string[])
    .find((c) => c.startsWith("better-auth.session_token="))!
    .split(";")[0]!;
}

describe("reviews security (integration, M04-T02 Increment 4)", () => {
  const app = createApp();

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  describe("identity spoofing (ADR-012 decisions 2 and 5)", () => {
    it("identity in query parameters → 400 INVALID_QUERY on every authenticated route; B untouched", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const bReview = await createVia(app, b, landmark, 5, "B's text");
      const spoof = `user_id=${b.userId}`;
      const responses = [
        await asUser(app, a)
          .post(`/api/v1/reviews?${spoof}`)
          .send({ landmark_id: landmark, rating: 1 }),
        await asUser(app, a).get(`${lookupPath(landmark)}&${spoof}`),
        await asUser(app, a)
          .patch(`${reviewPath(bReview)}?${spoof}`)
          .send({ rating: 1 }),
        await asUser(app, a).delete(`${reviewPath(bReview)}?${spoof}`),
      ];
      for (const response of responses) {
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("INVALID_QUERY");
      }
      expect(await rowsOf(a.userId)).toHaveLength(0);
      expect(await rowsOf(b.userId)).toEqual([
        expect.objectContaining({ id: bReview, rating: 5, body: "B's text" }),
      ]);
    });

    it.each(["user_id", "userId", "author_id", "owner", "id"])(
      "identity in the body (%s) → 400 INVALID_REQUEST on create, edit, and delete; B untouched",
      async (field) => {
        const [a, b] = await createTwoUsers(app);
        const landmark = await createLandmark();
        const bReview = await createVia(app, b, landmark);
        const create = await asUser(app, a)
          .post("/api/v1/reviews")
          .send({ landmark_id: landmark, rating: 1, [field]: b.userId });
        const edit = await asUser(app, a)
          .patch(reviewPath(bReview))
          .send({ rating: 1, [field]: b.userId });
        const remove = await asUser(app, a)
          .delete(reviewPath(bReview))
          .send({ [field]: b.userId });
        expect(create.body).toEqual(UNSUPPORTED);
        expect(edit.body).toEqual(UNSUPPORTED);
        expect(remove.status).toBe(400);
        expect(await rowsOf(a.userId)).toHaveLength(0);
        expect(await rowsOf(b.userId)).toEqual([
          expect.objectContaining({ id: bReview, rating: 4 }),
        ]);
      },
    );

    it("identity headers are ignored: the request acts as A only", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const bReview = await createVia(app, b, landmark);
      const headers = {
        "X-User-Id": b.userId,
        "X-Forwarded-User": b.email,
        "X-Auth-User": b.userId,
      };
      const created = await asUser(app, a)
        .post("/api/v1/reviews")
        .set(headers)
        .send({ landmark_id: landmark, rating: 2 });
      expect(created.status).toBe(201);
      const edit = await asUser(app, a).patch(reviewPath(bReview)).set(headers).send({ rating: 1 });
      expect(edit.status).toBe(404);
      expect((await rowsOf(a.userId)).map((r) => r.rating)).toEqual([2]);
      expect((await rowsOf(b.userId)).map((r) => r.rating)).toEqual([4]);
    });

    it("Authorization: Bearer with B's session value does not authenticate (no cookie → 401; with A's cookie → acts as A)", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const bToken = decodeURIComponent(b.cookie.slice(b.cookie.indexOf("=") + 1));
      const bearerOnly = await request(app)
        .post("/api/v1/reviews")
        .set("Origin", TEST_ORIGIN)
        .set("Authorization", `Bearer ${bToken}`)
        .send({ landmark_id: landmark, rating: 3 });
      expect(bearerOnly.status).toBe(401);
      expect(bearerOnly.body).toEqual(UNAUTHENTICATED);
      const withA = await asUser(app, a)
        .post("/api/v1/reviews")
        .set("Authorization", `Bearer ${bToken}`)
        .send({ landmark_id: landmark, rating: 3 });
      expect(withA.status).toBe(201);
      expect(await rowsOf(a.userId)).toHaveLength(1);
      expect(await rowsOf(b.userId)).toHaveLength(0);
    });

    it("two session cookies (A's and B's) in one request act as exactly ONE identity — the first — never combined", async () => {
      const [a, b] = await createTwoUsers(app);
      const [l1, l2] = [await createLandmark(), await createLandmark()];
      for (const [first, second, landmark] of [
        [a, b, l1],
        [b, a, l2],
      ] as const) {
        const response = await request(app)
          .post("/api/v1/reviews")
          .set("Origin", TEST_ORIGIN)
          .set("Cookie", `${first.cookie}; ${second.cookie}`)
          .send({ landmark_id: landmark, rating: 3 });
        expect(response.status).toBe(201);
        const owners = await prisma.review.findMany({ where: { landmarkId: landmark } });
        expect(owners.map((r) => r.userId)).toEqual([first.userId]);
      }
    });
  });

  describe("ID confusion (spec #6)", () => {
    it("a review ID, user ID, or landmark ID in the wrong place never reaches another user's data", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const bReview = await createVia(app, b, landmark, 5);
      // B's review ID used as a landmark: not a visible landmark.
      expect(
        (await asUser(app, a).post("/api/v1/reviews").send({ landmark_id: bReview, rating: 1 }))
          .status,
      ).toBe(404);
      expect((await asUser(app, a).get(lookupPath(bReview))).status).toBe(404);
      expect((await anonymous(app).get(listPath(bReview))).body).toEqual(NOT_FOUND);
      // B's user ID and the landmark ID used as review IDs.
      for (const id of [b.userId, a.userId, landmark]) {
        expect((await asUser(app, a).patch(reviewPath(id)).send({ rating: 1 })).status).toBe(404);
        expect((await asUser(app, a).delete(reviewPath(id))).status).toBe(404);
      }
      // A guessing B's review ID.
      expect((await asUser(app, a).patch(reviewPath(bReview)).send({ body: "x" })).body).toEqual(
        NOT_FOUND,
      );
      expect((await asUser(app, a).delete(reviewPath(bReview))).body).toEqual(NOT_FOUND);
      expect(await rowsOf(b.userId)).toEqual([
        expect.objectContaining({ id: bReview, rating: 5, body: null }),
      ]);
    });

    it("upper-case IDs address the same resources (canonical lower case)", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const created = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark.toUpperCase(), rating: 4 });
      expect(created.status).toBe(201);
      expect((await asUser(app, user).get(lookupPath(landmark.toUpperCase()))).body.review.id).toBe(
        created.body.id,
      );
      expect(
        (
          await asUser(app, user)
            .patch(reviewPath(created.body.id.toUpperCase()))
            .send({ rating: 2 })
        ).status,
      ).toBe(200);
      expect((await anonymous(app).get(listPath(landmark.toUpperCase()))).body.aggregate).toEqual({
        average_rating: 2,
        rating_count: 1,
      });
    });
  });

  describe("sessions (spec #1, #15)", () => {
    it("a session expiring mid-sequence: 401 from then on and nothing changes; a new sign-in sees the review", async () => {
      const user = await createSignedInUser(app, "expiring");
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark, 4, "before expiry");
      await prisma.session.updateMany({
        where: { userId: user.userId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      for (const response of [
        await asUser(app, user)
          .post("/api/v1/reviews")
          .send({ landmark_id: await createLandmark(), rating: 1 }),
        await asUser(app, user).get(lookupPath(landmark)),
        await asUser(app, user).patch(reviewPath(id)).send({ rating: 1 }),
        await asUser(app, user).delete(reviewPath(id)),
      ]) {
        expect(response.status).toBe(401);
        expect(response.body).toEqual(UNAUTHENTICATED);
      }
      expect(await rowsOf(user.userId)).toEqual([
        expect.objectContaining({ id, rating: 4, body: "before expiry" }),
      ]);
      const cookie = await signInAgain(app, user);
      const lookup = await asUser(app, { ...user, cookie }).get(lookupPath(landmark));
      expect(lookup.body.review).toMatchObject({ id, rating: 4, body: "before expiry" });
    });

    it("a session revoked by deleting its row: 401; the user's reviews are not cascaded", async () => {
      const user = await createSignedInUser(app, "revoked");
      const landmark = await createLandmark();
      await createVia(app, user, landmark);
      await prisma.session.deleteMany({ where: { userId: user.userId } });
      expect((await asUser(app, user).get(lookupPath(landmark))).status).toBe(401);
      expect(await rowsOf(user.userId)).toHaveLength(1);
      expect((await anonymous(app).get(listPath(landmark))).body.aggregate.rating_count).toBe(1);
    });

    it("two sessions of one user act on the same review; signing one out leaves the other working", async () => {
      const user = await createSignedInUser(app, "two-sessions");
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark, 3);
      const second = { ...user, cookie: await signInAgain(app, user) };
      expect((await asUser(app, second).patch(reviewPath(id)).send({ rating: 5 })).status).toBe(
        200,
      );
      expect((await asUser(app, user).get(lookupPath(landmark))).body.review.rating).toBe(5);
      expect((await asUser(app, user).post("/api/auth/sign-out").send({})).status).toBe(200);
      expect((await asUser(app, user).get(lookupPath(landmark))).status).toBe(401);
      expect((await asUser(app, second).get(lookupPath(landmark))).status).toBe(200);
    });
  });

  describe("hostile and malformed input (spec #3, #10)", () => {
    it.each([
      ["__proto__", '{"landmark_id":"%L","rating":3,"__proto__":{"rating":5,"isAdmin":true}}'],
      [
        "constructor",
        '{"landmark_id":"%L","rating":3,"constructor":{"prototype":{"isAdmin":true}}}',
      ],
      ["prototype", '{"landmark_id":"%L","rating":3,"prototype":{"isAdmin":true}}'],
    ])(
      "a %s key is rejected as an unsupported field, and no prototype is polluted",
      async (_l, raw) => {
        const user = await createSignedInUser(app);
        const landmark = await createLandmark();
        const response = await asUser(app, user)
          .post("/api/v1/reviews")
          .set("Content-Type", "application/json")
          .send(raw.replace("%L", landmark));
        expect(response.status).toBe(400);
        expect(response.body).toEqual(UNSUPPORTED);
        expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
        expect(({} as Record<string, unknown>).rating).toBeUndefined();
        expect(await rowsOf(user.userId)).toHaveLength(0);
      },
    );

    it("non-object bodies and mismatched content types are 400 INVALID_REQUEST; nothing stored", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const array = await asUser(app, user)
        .post("/api/v1/reviews")
        .send([{ landmark_id: landmark, rating: 3 }]);
      expect(array.status).toBe(400);
      expect(array.body.error.code).toBe("INVALID_REQUEST");
      const text = await asUser(app, user)
        .post("/api/v1/reviews")
        .set("Content-Type", "text/plain")
        .send(`landmark_id=${landmark}&rating=3`);
      expect(text.status).toBe(400);
      expect(text.body.error.code).toBe("INVALID_REQUEST");
      const form = await asUser(app, user)
        .post("/api/v1/reviews")
        .type("form")
        .send({ landmark_id: landmark, rating: "3" });
      expect(form.status).toBe(400);
      expect(await rowsOf(user.userId)).toHaveLength(0);
    });

    it.each([
      ["Infinity via 1e400", "1e400", 400],
      ["exponent form 1e0 (parses to the integer 1)", "1e0", 201],
      ["5.0 (parses to the integer 5)", "5.0", 201],
      ["negative zero", "-0", 400],
      ["a huge integer", "99999999999999999999", 400],
    ])("rating %s → %s", async (_l, literal, status) => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const response = await asUser(app, user)
        .post("/api/v1/reviews")
        .set("Content-Type", "application/json")
        .send(`{"landmark_id":"${landmark}","rating":${literal}}`);
      expect(response.status).toBe(status);
      expect(await rowsOf(user.userId)).toHaveLength(status === 201 ? 1 : 0);
    });

    it("SQL- and script-like text is stored and returned verbatim as JSON data; the table is intact", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const payloads = [
        "'); DROP TABLE reviews; --",
        '<img src=x onerror="alert(1)"><script>alert(document.cookie)</script>',
      ];
      for (const [i, user] of [a, b].entries()) {
        await createVia(app, user, landmark, 3, payloads[i]);
      }
      const list = await anonymous(app).get(listPath(landmark));
      expect(list.headers["content-type"]).toMatch(/^application\/json/);
      expect(list.body.reviews.map((r: { body: string }) => r.body).sort()).toEqual(
        [...payloads].sort(),
      );
      expect(await prisma.review.count()).toBe(2);
    });

    it("injection attempts in IDs and query parameters are 400 before any SQL runs", async () => {
      const user = await createSignedInUser(app);
      for (const [response, code] of [
        [
          await asUser(app, user)
            .post("/api/v1/reviews")
            .send({ landmark_id: "x' OR '1'='1", rating: 3 }),
          "INVALID_REQUEST",
        ],
        [
          await asUser(app, user).get("/api/v1/reviews?landmark_id=1%27%20OR%201%3D1"),
          "INVALID_QUERY",
        ],
        [
          await asUser(app, user).patch("/api/v1/reviews/1%27%20OR%201%3D1").send({ rating: 3 }),
          "INVALID_REQUEST",
        ],
        [await asUser(app, user).delete("/api/v1/reviews/%2e%2e%2f%2e%2e"), "INVALID_REQUEST"],
        [
          await anonymous(app).get("/api/v1/landmarks/1%27%20OR%201%3D1/reviews"),
          "INVALID_REQUEST",
        ],
        [await anonymous(app).get(`${listPath(UNKNOWN_ID)}?limit=1;DROP`), "INVALID_QUERY"],
      ] as const) {
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe(code);
      }
    });

    it("valid but unusual Unicode (bidi controls, zero-width, combining marks) is kept exactly — no normalization", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const unusual = "safe‮evil‬ ​ é́ ️";
      const created = await asUser(app, a)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 3, body: unusual });
      expect(created.status).toBe(201);
      expect(created.body.body).toBe(unusual);
      // A zero-width space is not ECMAScript whitespace, so it is stored as text (documented behaviour).
      const zeroWidth = await asUser(app, b)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 3, body: "​" });
      expect(zeroWidth.status).toBe(201);
      expect(zeroWidth.body.body).toBe("​");
    });

    it("a body over the JSON parser's 100 kB limit is refused (413) before the handler; nothing stored", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const response = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmark, rating: 3, body: "a".repeat(110_000) });
      expect(response.status).toBe(413);
      expect(await rowsOf(user.userId)).toHaveLength(0);
    });
  });

  describe("database outage", () => {
    /** A Prisma client whose adapter points at a port nothing listens on. */
    function unreachablePrisma(): PrismaClient {
      return new PrismaClient({
        adapter: new PrismaPg({
          connectionString: "postgresql://nobody:secret-password@127.0.0.1:1/unreachable_db",
          connectionTimeoutMillis: 2_000,
        }),
      });
    }

    function outageApp(db: PrismaClient): Express {
      const app = express();
      mountBetterAuth(app, auth);
      app.use(express.json());
      const api = Router();
      api.use(createPublicReviewsRouter({ prisma: db }));
      mountProtected(api, "/reviews", createReviewsRouter({ prisma: db }));
      app.use("/api/v1", requireTrustedOrigin, api);
      app.use("/api", (_req: Request, res: Response) => {
        res.status(404).json(NOT_FOUND);
      });
      return app;
    }

    it("every authenticated route answers the fixed 500 with no-store and discloses nothing about the database", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const db = unreachablePrisma();
      try {
        const broken = outageApp(db);
        const user = await createSignedInUser(broken);
        for (const response of [
          await asUser(broken, user)
            .post("/api/v1/reviews")
            .send({ landmark_id: UNKNOWN_ID, rating: 3 }),
          await asUser(broken, user).get(lookupPath(UNKNOWN_ID)),
          await asUser(broken, user).patch(reviewPath(UNKNOWN_ID)).send({ rating: 3 }),
          await asUser(broken, user).delete(reviewPath(UNKNOWN_ID)),
        ]) {
          expect(response.status).toBe(500);
          expect(response.body).toEqual(INTERNAL_ERROR);
          expect(response.headers["cache-control"]).toBe("private, no-store");
          expect(response.text).not.toMatch(
            /secret-password|unreachable_db|127\.0\.0\.1|Prisma|ECONNREFUSED/,
          );
        }
      } finally {
        await db.$disconnect().catch(() => undefined);
      }
    });

    it("the public list answers 500 (Express's default handler — the documented public-route follow-up)", async () => {
      const db = unreachablePrisma();
      try {
        const response = await anonymous(outageApp(db)).get(listPath(UNKNOWN_ID));
        expect(response.status).toBe(500);
        // Pinned observation, not a contract: outside production, Express's
        // default page includes the error stack; it never includes the
        // connection password.
        expect(response.text).not.toContain("secret-password");
      } finally {
        await db.$disconnect().catch(() => undefined);
      }
    });
  });

  describe("concurrency over HTTP (spec #4)", () => {
    it("10 parallel creates by A and 10 by B for one landmark: each gets exactly one 201 and nine 409s", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const fire = (user: TestUser) =>
        Array.from({ length: 10 }, (_, i) =>
          asUser(app, user)
            .post("/api/v1/reviews")
            .send({ landmark_id: landmark, rating: (i % 5) + 1 }),
        );
      const responses = await Promise.all([...fire(a), ...fire(b)]);
      for (const user of [a, b]) {
        expect(await rowsOf(user.userId)).toHaveLength(1);
      }
      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(2);
      expect(statuses.filter((s) => s === 409)).toHaveLength(18);
      expect((await anonymous(app).get(listPath(landmark))).body.aggregate.rating_count).toBe(2);
    });

    it("an owner's PATCHes racing their DELETE end consistently: no 5xx, and the aggregate matches the rows", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const aReview = await createVia(app, a, landmark, 1);
      await createVia(app, b, landmark, 5);
      const responses = await Promise.all([
        ...Array.from({ length: 5 }, (_, i) =>
          asUser(app, a)
            .patch(reviewPath(aReview))
            .send({ rating: (i % 5) + 1 }),
        ),
        asUser(app, a).delete(reviewPath(aReview)),
        ...Array.from({ length: 5 }, () => asUser(app, b).get(lookupPath(landmark))),
      ]);
      expect(responses.every((r) => r.status < 500)).toBe(true);
      expect(responses[5]!.status).toBe(200);
      expect(await rowsOf(a.userId)).toHaveLength(0);
      const list = await anonymous(app).get(listPath(landmark));
      expect(list.body.aggregate).toEqual({ average_rating: 5, rating_count: 1 });
    });
  });
});
