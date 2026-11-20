import { createHmac } from "node:crypto";
import express, { Router, type Express, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { prisma } from "../src/db/prisma.js";
import { createFavoritesRateLimiter } from "../src/favorites/rate-limit.js";
import { createFavoritesRouter } from "../src/favorites/router.js";
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
 * M03-T05 Increment 3 — the favorites HTTP API over real HTTP, real session
 * cookies, and landmarks_test (ADR-009): contract, validation, sessions,
 * CSRF, caching, pagination, the fixed 500, concurrency, and throttling.
 *
 * Limiter isolation: tests on the real `createApp()` use the PRODUCTION
 * limiter (120 reads / 60 mutations per user per minute, unchanged). Every
 * test creates fresh users and no test sends more than a few dozen requests
 * per user, so counters never accumulate across tests. Throttling itself is
 * tested on test-only apps, each with a FRESH limiter and an injected clock.
 *
 * Two-user ownership (spec #6–#8) and re-import/lifecycle (#9, #10, #15) are
 * Increment 4.
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
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";
let sequence = 0;

async function createLandmark(
  options: { status?: Status; active?: boolean; name?: string } = {},
): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `FAL${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNFALLS",
      category: "FALLS",
      displayName: options.name ?? `Falls ${sequence}`,
      latitude: 35.6,
      longitude: -83.5,
      sourceDescription: "restricted description",
      sourceUrl: "https://example.com/restricted",
      sensitivityStatus: options.status ?? "PUBLIC",
      isActive: options.active ?? true,
    },
  });
  return landmark.id;
}

const favoritesCount = (userId?: string) =>
  prisma.favorite.count({ where: userId ? { userId } : {} });
const path = (landmarkId: string) => `/api/v1/favorites/${landmarkId}`;

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

/**
 * A test-only app wired like src/app.ts (Better Auth, JSON parser, the real
 * CSRF check), with a favorites router built from `routerDeps` and mounted
 * through the REAL `mountProtected` (decision F9).
 */
function fixtureApp(routerDeps: Parameters<typeof createFavoritesRouter>[0]): Express {
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  mountProtected(api, "/favorites", createFavoritesRouter(routerDeps));
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(NOT_FOUND);
  });
  return app;
}

describe("favorites HTTP API (integration, M03-T05 Increment 3)", () => {
  const app = createApp();

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  describe("contract", () => {
    it("PUT: 201 when created, 200 when already present; exact body; one row; no-store", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();

      const first = await asUser(app, user).put(path(landmark));
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ success: true, landmark_id: landmark });
      expectNoStore(first);

      const second = await asUser(app, user).put(path(landmark));
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ success: true, landmark_id: landmark });
      expectNoStore(second);
      expect(await favoritesCount(user.userId)).toBe(1);
    });

    it("an upper-case landmark ID is accepted and echoed in canonical lower case", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const response = await asUser(app, user).put(path(landmark.toUpperCase()));
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ success: true, landmark_id: landmark });
    });

    it("PUT with an explicit empty JSON body is accepted", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const response = await asUser(app, user).put(path(landmark)).send({});
      expect(response.status).toBe(201);
    });

    it("DELETE: 200 with the same body whether or not the favorite existed; row removed", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      await asUser(app, user).put(path(landmark));

      for (let i = 0; i < 2; i += 1) {
        const response = await asUser(app, user).delete(path(landmark));
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true, landmark_id: landmark });
        expectNoStore(response);
      }
      expect(await favoritesCount(user.userId)).toBe(0);
      // A well-formed ID that is no landmark at all is also 200 (D2).
      const unknown = await asUser(app, user).delete(path(UNKNOWN_ID));
      expect(unknown.status).toBe(200);
      expect(unknown.body).toEqual({ success: true, landmark_id: UNKNOWN_ID });
    });

    it.each([
      ["unknown", null],
      ["retired", { active: false }],
      ["UNREVIEWED", { status: "UNREVIEWED" }],
      ["SENSITIVE", { status: "SENSITIVE" }],
    ] as const)(
      "PUT on a %s landmark: 404 byte-identical to every other 404; no row",
      async (_label, options) => {
        const user = await createSignedInUser(app);
        const landmark = options ? await createLandmark(options) : UNKNOWN_ID;
        const response = await asUser(app, user).put(path(landmark));
        const unknownRoute = await request(app).get("/api/v1/no-such-route");
        expect(response.status).toBe(404);
        expect(response.text).toBe(unknownRoute.text);
        expect(response.body).toEqual(NOT_FOUND);
        expectNoStore(response);
        expect(await favoritesCount()).toBe(0);
      },
    );

    it("PUT on a saved landmark that became SENSITIVE: 404 (not 200); the row is kept and still removable", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      expect((await asUser(app, user).put(path(landmark))).status).toBe(201);
      await prisma.landmark.update({
        where: { id: landmark },
        data: { sensitivityStatus: "SENSITIVE" },
      });
      const response = await asUser(app, user).put(path(landmark));
      expect(response.status).toBe(404);
      expect(response.body).toEqual(NOT_FOUND);
      expect(await favoritesCount(user.userId)).toBe(1);
      expect((await asUser(app, user).delete(path(landmark))).status).toBe(200);
      expect(await favoritesCount(user.userId)).toBe(0);
    });

    it("GET returns the exact envelope and entry shapes: available, redacted, unavailable", async () => {
      const user = await createSignedInUser(app);
      const pub = await createLandmark({ name: "Public Falls" });
      const sens = await createLandmark({ name: "Sensitive Falls" });
      const retired = await createLandmark({ name: "Retired Falls" });
      for (const id of [pub, sens, retired]) await asUser(app, user).put(path(id));
      await prisma.landmark.update({
        where: { id: sens },
        data: { sensitivityStatus: "SENSITIVE" },
      });
      await prisma.landmark.update({ where: { id: retired }, data: { isActive: false } });

      const response = await asUser(app, user).get("/api/v1/favorites");
      expect(response.status).toBe(200);
      expectNoStore(response);
      expect(Object.keys(response.body).sort()).toEqual(["favorites", "has_more", "limit", "page"]);
      expect(response.body).toMatchObject({ page: 1, limit: 50, has_more: false });
      const byId = new Map(
        (response.body.favorites as { landmark_id: string }[]).map((e) => [e.landmark_id, e]),
      );
      expect(byId.get(pub)).toEqual({
        landmark_id: pub,
        availability: "available",
        landmark: {
          id: pub,
          display_name: "Public Falls",
          category: "falls",
          latitude: 35.6,
          longitude: -83.5,
        },
      });
      expect(byId.get(sens)).toEqual({
        landmark_id: sens,
        availability: "redacted",
        landmark: { id: sens, display_name: "Sensitive Falls", category: "falls", redacted: true },
      });
      expect(byId.get(retired)).toEqual({ landmark_id: retired, availability: "unavailable" });
      expect(response.text).not.toMatch(/restricted|Retired Falls|source_|created_at/);
      expect(response.text).not.toContain(user.userId);
    });

    it("a retired favorite can be removed over HTTP", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      await asUser(app, user).put(path(landmark));
      await prisma.landmark.update({ where: { id: landmark }, data: { isActive: false } });
      const response = await asUser(app, user).delete(path(landmark));
      expect(response.status).toBe(200);
      expect(await favoritesCount(user.userId)).toBe(0);
    });
  });

  describe("validation", () => {
    it.each(["not-a-uuid", "ARC001", `${UNKNOWN_ID}0`, "%3Cscript%3E"])(
      "a bad landmark ID (%s) → 400 INVALID_REQUEST on PUT and DELETE, no echo, no change",
      async (bad) => {
        const user = await createSignedInUser(app);
        for (const method of ["put", "delete"] as const) {
          const response = await asUser(app, user)[method](`/api/v1/favorites/${bad}`);
          expect(response.status, method).toBe(400);
          expect(response.body).toEqual({
            error: { code: "INVALID_REQUEST", message: "Invalid landmark ID." },
          });
          expect(response.text).not.toContain("script");
          expectNoStore(response);
        }
        expect(await favoritesCount()).toBe(0);
      },
    );

    it.each([
      ["user_id", { user_id: "x" }],
      ["userId", { userId: "x" }],
      ["landmarkId", { landmarkId: "x" }],
      ["an array", []],
    ])("a body with %s → 400 INVALID_REQUEST; nothing changes", async (_label, body) => {
      const [user, other] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const payload = Array.isArray(body)
        ? body
        : Object.fromEntries(Object.entries(body).map(([k]) => [k, other.userId]));
      for (const method of ["put", "delete"] as const) {
        const response = await asUser(app, user)[method](path(landmark)).send(payload);
        expect(response.status, method).toBe(400);
        expect(response.body.error.code).toBe("INVALID_REQUEST");
        expect(response.text).not.toContain(other.userId);
      }
      expect(await favoritesCount()).toBe(0);
    });

    it("any query parameter on PUT/DELETE → 400 INVALID_QUERY", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      for (const method of ["put", "delete"] as const) {
        const response = await asUser(app, user)
          [method](path(landmark))
          .query({ user_id: user.userId });
        expect(response.status, method).toBe(400);
        expect(response.body.error.code).toBe("INVALID_QUERY");
      }
      expect(await favoritesCount()).toBe(0);
    });

    it.each([
      ["page=0", "page=0"],
      ["limit=101", "limit=101"],
      ["limit=1.5", "limit=1.5"],
      ["page=1e2", "page=1e2"],
      ["repeated page", "page=1&page=2"],
      ["unknown key", "sort=name"],
      ["identity key", "user_id=x"],
    ])("GET with %s → 400 INVALID_QUERY", async (_label, query) => {
      const user = await createSignedInUser(app);
      const response = await asUser(app, user).get(`/api/v1/favorites?${query}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_QUERY");
      expectNoStore(response);
    });

    it("malformed JSON → 400 (existing app-level parser response, F7); nothing changes", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const response = await asUser(app, user)
        .put(path(landmark))
        .set("Content-Type", "application/json")
        .send('{"broken"');
      expect(response.status).toBe(400);
      expect(await favoritesCount()).toBe(0);
    });
  });

  describe("sessions (spec #3)", () => {
    async function sessionVariants() {
      const revoked = await createSignedInUser(app, "revoked");
      await signOut(app, revoked);
      const expired = await createSignedInUser(app, "expired");
      await prisma.session.updateMany({
        where: { userId: expired.userId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      return [
        ["missing", undefined],
        ["forged", forgedCookie()],
        ["malformed", "better-auth.session_token=%%%not-a-token"],
        ["expired", expired.cookie],
        ["revoked", revoked.cookie],
      ] as const;
    }

    it("missing, forged, malformed, expired, and revoked sessions get the identical 401 on all three endpoints; nothing changes", async () => {
      const landmark = await createLandmark();
      const variants = await sessionVariants();
      const bodies = new Set<string>();
      for (const [label, cookie] of variants) {
        for (const [method, url] of [
          ["get", "/api/v1/favorites"],
          ["put", path(landmark)],
          ["delete", path(landmark)],
        ] as const) {
          let pending = request(app)[method](url).set("Origin", TEST_ORIGIN);
          if (cookie) pending = pending.set("Cookie", cookie);
          const response = await pending;
          expect(response.status, `${label} ${method}`).toBe(401);
          expect(response.body).toEqual(UNAUTHENTICATED);
          expectNoStore(response, `${label} ${method}`);
          bodies.add(response.text);
        }
      }
      expect(bodies.size).toBe(1);
      expect(await favoritesCount()).toBe(0);
    });
  });

  describe("CSRF (spec #5, #19)", () => {
    it.each([
      ["a foreign Origin", { Origin: "https://attacker.example" }],
      ["Origin: null", { Origin: "null" }],
      ["a foreign Referer and no Origin", { Referer: "https://attacker.example/x" }],
      ["neither Origin nor Referer", {}],
    ])(
      "cookie-bearing PUT/DELETE with %s → 403 INVALID_ORIGIN with no-store; nothing changes",
      async (_label, headers) => {
        const user = await createSignedInUser(app);
        const landmark = await createLandmark();
        await asUser(app, user).put(path(landmark)); // one existing row to protect
        for (const method of ["put", "delete"] as const) {
          let pending = request(app)[method](path(landmark)).set("Cookie", user.cookie);
          for (const [name, value] of Object.entries(headers)) pending = pending.set(name, value);
          const response = await pending;
          expect(response.status, method).toBe(403);
          expect(response.body).toEqual(INVALID_ORIGIN);
          expectNoStore(response, method);
        }
        expect(await favoritesCount(user.userId)).toBe(1);
      },
    );

    it("a trusted Referer with no Origin is accepted", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const response = await request(app)
        .put(path(landmark))
        .set("Cookie", user.cookie)
        .set("Referer", `${TEST_ORIGIN}/landmarks/${landmark}`);
      expect(response.status).toBe(201);
    });

    it("GET with a foreign Origin is still allowed (safe method)", async () => {
      const user = await createSignedInUser(app);
      const response = await request(app)
        .get("/api/v1/favorites")
        .set("Cookie", user.cookie)
        .set("Origin", "https://attacker.example");
      expect(response.status).toBe(200);
      expectNoStore(response);
    });

    it("with no cookie at all, a foreign-Origin PUT reaches the session check: 401", async () => {
      const landmark = await createLandmark();
      const response = await request(app)
        .put(path(landmark))
        .set("Origin", "https://attacker.example");
      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
    });
  });

  describe("pagination over HTTP", () => {
    async function seed(user: TestUser, count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        sequence += 1;
        const landmark = await prisma.landmark.create({
          data: {
            sourceCode: `PEA${String(i).padStart(3, "0")}`,
            sourceFile: "TNPEAKS",
            category: "PEAK",
            displayName: `Peak ${i}`,
            latitude: 36,
            longitude: -84,
            sensitivityStatus: "PUBLIC",
          },
        });
        ids.push(landmark.id);
      }
      // Seeded directly (not via 101 PUTs, which would exceed the unchanged
      // production mutation limit): created_at increases with i.
      await prisma.favorite.createMany({
        data: ids.map((landmarkId, i) => ({
          userId: user.userId,
          landmarkId,
          createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, i)),
        })),
      });
      return ids;
    }

    it("defaults to page 1 / limit 50, newest first, with has_more; respects limit 100; past the end is empty", async () => {
      const user = await createSignedInUser(app);
      const ids = await seed(user, 101);
      const newestFirst = [...ids].reverse();

      const first = await asUser(app, user).get("/api/v1/favorites");
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ page: 1, limit: 50, has_more: true });
      expect(first.body.favorites.map((e: { landmark_id: string }) => e.landmark_id)).toEqual(
        newestFirst.slice(0, 50),
      );

      const max = await asUser(app, user).get("/api/v1/favorites?limit=100");
      expect(max.body.favorites).toHaveLength(100);
      expect(max.body.has_more).toBe(true);

      const last = await asUser(app, user).get("/api/v1/favorites?page=3&limit=50");
      expect(last.body).toMatchObject({ page: 3, limit: 50, has_more: false });
      expect(last.body.favorites.map((e: { landmark_id: string }) => e.landmark_id)).toEqual([
        newestFirst[100],
      ]);

      const past = await asUser(app, user).get("/api/v1/favorites?page=9");
      expect(past.body).toEqual({ favorites: [], page: 9, limit: 50, has_more: false });
    });

    it("a user with no favorites gets an empty first page", async () => {
      const user = await createSignedInUser(app);
      const response = await asUser(app, user).get("/api/v1/favorites");
      expect(response.body).toEqual({ favorites: [], page: 1, limit: 50, has_more: false });
    });
  });

  describe("the fixed 500 (protected-route error handler)", () => {
    it("an unexpected service failure → 500 INTERNAL_ERROR, no-store, no internals, one sanitized log line", async () => {
      const lines: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
      const secret = "SELECT secret FROM internals -- stack detail";
      const failing = {
        addFavorite: vi.fn(async () => {
          throw new Error(secret);
        }),
        removeFavorite: vi.fn(async () => {
          throw new Error(secret);
        }),
        listFavorites: vi.fn(async () => {
          throw new Error(secret);
        }),
      };
      const testApp = fixtureApp({ service: failing });
      const user = await createSignedInUser(testApp);

      for (const [method, url] of [
        ["get", "/api/v1/favorites"],
        ["put", path(UNKNOWN_ID)],
        ["delete", path(UNKNOWN_ID)],
      ] as const) {
        const response = await asUser(testApp, user)[method](url);
        expect(response.status, method).toBe(500);
        expect(response.body).toEqual(INTERNAL_ERROR);
        expectNoStore(response, method);
        expect(response.text).not.toContain("SELECT");
      }
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        expect(line).toContain("PROTECTED_ROUTE_FAILURE");
        expect(line).not.toContain("SELECT");
        expect(line).not.toContain(user.userId);
      }
    });
  });

  describe("concurrent requests", () => {
    it("10 parallel PUTs: status codes are exactly {201 ×1, 200 ×9} in any order; one row", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => asUser(app, user).put(path(landmark))),
      );
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
      for (const r of responses) expect(r.body).toEqual({ success: true, landmark_id: landmark });
      expect(await favoritesCount(user.userId)).toBe(1);
    });

    it("parallel PUTs and DELETEs: no 5xx; 0 or 1 rows", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          i % 2 === 0
            ? asUser(app, user).put(path(landmark))
            : asUser(app, user).delete(path(landmark)),
        ),
      );
      for (const r of responses) expect([200, 201]).toContain(r.status);
      expect([0, 1]).toContain(await favoritesCount(user.userId));
    });
  });

  describe("throttling (test-only apps, fresh limiter and injected clock per test)", () => {
    function throttledApp(options: { maxKeys?: number } = {}) {
      let t = 5_000_000;
      const limiter = createFavoritesRateLimiter({
        limits: { read: 3, mutation: 2 },
        windowMs: 60_000,
        maxKeys: options.maxKeys ?? 100,
        now: () => t,
        log: () => undefined,
      });
      return {
        app: fixtureApp({ limiter }),
        limiter,
        advance: (ms: number) => {
          t += ms;
        },
      };
    }

    function expectRateLimited(response: request.Response, retryAfter: string) {
      expect(response.status).toBe(429);
      expect(response.body).toEqual(RATE_LIMITED);
      expect(response.headers["retry-after"]).toBe(retryAfter);
      expectNoStore(response);
    }

    it("the 3rd mutation in a window → 429 with envelope, Retry-After, no-store; the blocked request changes nothing", async () => {
      const { app: testApp } = throttledApp();
      const user = await createSignedInUser(testApp);
      const [l1, l2, l3] = [await createLandmark(), await createLandmark(), await createLandmark()];
      expect((await asUser(testApp, user).put(path(l1))).status).toBe(201);
      expect((await asUser(testApp, user).put(path(l2))).status).toBe(201);
      expectRateLimited(await asUser(testApp, user).put(path(l3)), "60");
      expectRateLimited(await asUser(testApp, user).delete(path(l1)), "60");
      expect(await favoritesCount(user.userId)).toBe(2);
    });

    it("per user and per bucket: B is unaffected when A is blocked, and A's reads still work", async () => {
      const { app: testApp } = throttledApp();
      const [a, b] = await createTwoUsers(testApp);
      const landmark = await createLandmark();
      await asUser(testApp, a).put(path(landmark));
      await asUser(testApp, a).delete(path(landmark));
      expectRateLimited(await asUser(testApp, a).put(path(landmark)), "60");

      expect((await asUser(testApp, b).put(path(landmark))).status).toBe(201);
      expect((await asUser(testApp, a).get("/api/v1/favorites")).status).toBe(200);
    });

    it("window expiry: allowed again after exactly one window; Retry-After counts down", async () => {
      const { app: testApp, advance } = throttledApp();
      const user = await createSignedInUser(testApp);
      const landmark = await createLandmark();
      await asUser(testApp, user).put(path(landmark));
      await asUser(testApp, user).put(path(landmark));
      advance(45_000);
      expectRateLimited(await asUser(testApp, user).put(path(landmark)), "15");
      advance(15_000);
      expect((await asUser(testApp, user).put(path(landmark))).status).toBe(200);
    });

    it("reads have their own limit (3 per window)", async () => {
      const { app: testApp } = throttledApp();
      const user = await createSignedInUser(testApp);
      for (let i = 0; i < 3; i += 1) {
        expect((await asUser(testApp, user).get("/api/v1/favorites")).status).toBe(200);
      }
      expectRateLimited(await asUser(testApp, user).get("/api/v1/favorites"), "60");
    });

    it("invalid requests count toward the limit (F1)", async () => {
      const { app: testApp } = throttledApp();
      const user = await createSignedInUser(testApp);
      expect((await asUser(testApp, user).put("/api/v1/favorites/bad")).status).toBe(400);
      expect((await asUser(testApp, user).put("/api/v1/favorites/bad")).status).toBe(400);
      expectRateLimited(await asUser(testApp, user).put(path(await createLandmark())), "60");
    });

    it("hard cap: with every counter live, a new user is refused (429); after the window the user is allowed", async () => {
      const { app: testApp, advance } = throttledApp({ maxKeys: 2 });
      const [a, b] = await createTwoUsers(testApp);
      const c = await createSignedInUser(testApp, "user-c");
      expect((await asUser(testApp, a).get("/api/v1/favorites")).status).toBe(200);
      expect((await asUser(testApp, b).get("/api/v1/favorites")).status).toBe(200);
      expectRateLimited(await asUser(testApp, c).get("/api/v1/favorites"), "60");
      advance(60_000);
      expect((await asUser(testApp, c).get("/api/v1/favorites")).status).toBe(200);
    });

    it("anonymous requests never reach the limiter (401 before it; no counters created)", async () => {
      const { app: testApp, limiter } = throttledApp();
      const landmark = await createLandmark();
      for (let i = 0; i < 5; i += 1) {
        expect((await anonymous(testApp).put(path(landmark))).status).toBe(401);
      }
      expect(limiter.size()).toBe(0);
    });
  });
});
