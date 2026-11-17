import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { betterAuth } from "better-auth";
import request, { type Response, type Test } from "supertest";
import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_RATE_LIMIT_RULE,
  RATE_LIMIT_RULES,
  buildAuthOptions,
} from "../src/auth/auth-options.js";
import { CLIENT_IP_HEADER, createClientIpMiddleware } from "../src/auth/client-ip.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { prisma } from "../src/db/prisma.js";
import { MemoryMailTransport } from "./helpers/memory-mail-transport.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 5 — database-backed rate limiting on the real
 * `rate_limits` table with the APPROVED thresholds, on a test-only app that
 * is mounted exactly like src/app.ts (client-ip middleware → mountBetterAuth
 * with the 503 handler). The limiter is enabled on this dedicated instance;
 * the application's own instance keeps "production only".
 *
 * Time is faked (`Date` only) for window arithmetic; the limiter stamps rows
 * with `Date.now()`.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const TOO_MANY = { message: "Too many requests. Please try again later." };
const SIGN_IN = RATE_LIMIT_RULES["/sign-in/email"];
const SIGN_UP = RATE_LIMIT_RULES["/sign-up/email"];
const RESET_REQUEST = RATE_LIMIT_RULES["/request-password-reset"];
const RESET_COMPLETE = RATE_LIMIT_RULES["/reset-password"];

function buildInstance(client: PrismaClient = prisma) {
  return betterAuth(
    buildAuthOptions({
      prisma: client,
      baseUrl: ORIGIN,
      secret: process.env.BETTER_AUTH_SECRET!,
      trustedOrigins: [],
      rateLimitEnabled: true,
      mailTransport: new MemoryMailTransport(),
    }),
  );
}

/** Test-only app: one trusted hop so tests can present distinct clients via X-Forwarded-For. */
function buildApp(auth = buildInstance()) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(createClientIpMiddleware({ trustedProxyHops: 1 }));
  mountBetterAuth(app, auth);
  return app;
}

const app = buildApp();

/** A request as seen from `client` (an address the trusted proxy appended). */
function from(client: string, req: Test) {
  return req.set("X-Forwarded-For", client);
}

function signIn(client: string, email: string, password = PASSWORD, agent = app) {
  return from(client, request(agent).post("/api/auth/sign-in/email")).send({ email, password });
}

function signUp(client: string, email: string, agent = app) {
  return from(client, request(agent).post("/api/auth/sign-up/email")).send({
    name: "",
    email,
    password: PASSWORD,
  });
}

async function register(email: string) {
  // Registration from a dedicated address so it never consumes a test client's budget.
  const response = await signUp("198.51.100.250", email);
  expect(response.status).toBe(200);
}

async function row(client: string, path: string) {
  return prisma.rateLimit.findUnique({ where: { key: `${client}|${path}` } });
}

function expectTooMany(response: Response, window: number) {
  expect(response.status).toBe(429);
  expect(response.body).toEqual(TOO_MANY);
  const retryAfter = Number(response.headers["x-retry-after"]);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(window);
}

function advanceBy(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

describe("rate limiting (integration, M03-T02 Increment 5)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  describe("thresholds (approved 2026-11-10)", () => {
    it("sign-in: 5 per 60 s per client, then 429 with the fixed body and X-Retry-After; the row holds exactly 5", async () => {
      await register("limit@example.com");
      const client = "203.0.113.10";
      for (let i = 0; i < SIGN_IN.max; i++) {
        expect((await signIn(client, "limit@example.com", "wrong-password-xx")).status).toBe(401);
      }
      expectTooMany(await signIn(client, "limit@example.com", "wrong-password-xx"), SIGN_IN.window);
      // Even the CORRECT password is refused while limited — nothing executes.
      expectTooMany(await signIn(client, "limit@example.com"), SIGN_IN.window);
      expect(await prisma.session.count()).toBe(0);

      const stored = await row(client, "/sign-in/email");
      expect(stored).toMatchObject({ count: SIGN_IN.max });
      expect(Number(stored!.lastRequest)).toBeLessThanOrEqual(Date.now());
      // Another client is unaffected.
      expect((await signIn("203.0.113.11", "limit@example.com")).status).toBe(200);
    });

    it("registration: 5 per 10 min; reset request: 3 per 10 min; reset completion: 5 per 10 min", async () => {
      const client = "203.0.113.20";
      for (let i = 0; i < SIGN_UP.max; i++) {
        expect((await signUp(client, `reg${i}@example.com`)).status).toBe(200);
      }
      expectTooMany(await signUp(client, "reg-extra@example.com"), SIGN_UP.window);
      expect(await prisma.user.count()).toBe(SIGN_UP.max);

      const resetRequest = () =>
        from(client, request(app).post("/api/auth/request-password-reset")).send({
          email: "reg0@example.com",
          redirectTo: "/reset-password",
        });
      for (let i = 0; i < RESET_REQUEST.max; i++)
        expect((await resetRequest()).status).not.toBe(429);
      expectTooMany(await resetRequest(), RESET_REQUEST.window);

      const resetComplete = () =>
        from(client, request(app).post("/api/auth/reset-password")).send({
          token: "not-a-real-token",
          newPassword: "another-good-password",
        });
      for (let i = 0; i < RESET_COMPLETE.max; i++)
        expect((await resetComplete()).status).not.toBe(429);
      expectTooMany(await resetComplete(), RESET_COMPLETE.window);

      expect((await row(client, "/sign-up/email"))?.count).toBe(SIGN_UP.max);
      expect((await row(client, "/request-password-reset"))?.count).toBe(RESET_REQUEST.max);
      expect((await row(client, "/reset-password"))?.count).toBe(RESET_COMPLETE.max);
    });

    it("other endpoints: 100 per 10 s (get-session)", async () => {
      const client = "203.0.113.30";
      for (let i = 0; i < DEFAULT_RATE_LIMIT_RULE.max; i++) {
        expect((await from(client, request(app).get("/api/auth/get-session"))).status).toBe(200);
      }
      expectTooMany(
        await from(client, request(app).get("/api/auth/get-session")),
        DEFAULT_RATE_LIMIT_RULE.window,
      );
      expect((await row(client, "/get-session"))?.count).toBe(DEFAULT_RATE_LIMIT_RULE.max);
    });

    it("disabled paths are refused before the limiter and consume no budget", async () => {
      const client = "203.0.113.40";
      for (let i = 0; i < 10; i++) {
        const response = await from(client, request(app).post("/api/auth/update-user"))
          .set("Origin", ORIGIN)
          .send({ name: "x" });
        expect(response.status).toBe(404);
      }
      expect(await row(client, "/update-user")).toBeNull();
      expect(await prisma.rateLimit.count()).toBe(0);
    });

    it("intentional library responses keep their status: 400 validation, 401 credentials, 403 CSRF — never 503", async () => {
      await register("statuses@example.com");
      const client = "203.0.113.50";
      expect((await signUp(client, "not-an-email")).status).toBe(400);
      expect((await signIn(client, "statuses@example.com", "wrong-password-xx")).status).toBe(401);
      const signedIn = await signIn(client, "statuses@example.com");
      const cookie = (signedIn.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
      const csrf = await from(client, request(app).post("/api/auth/sign-out"))
        .set("Cookie", cookie)
        .set("Origin", "https://attacker.example")
        .send({});
      expect(csrf.status).toBe(403);
    });
  });

  describe("windows", () => {
    it("blocked requests do not extend the window; after 60 s from the last ALLOWED request the count resets to 1", async () => {
      await register("window@example.com");
      const client = "203.0.113.60";
      for (let i = 0; i < SIGN_IN.max; i++)
        await signIn(client, "window@example.com", "wrong-password-xx");
      const lastAllowed = Number((await row(client, "/sign-in/email"))!.lastRequest);

      advanceBy(30_000);
      expectTooMany(
        await signIn(client, "window@example.com", "wrong-password-xx"),
        SIGN_IN.window,
      );
      advanceBy(29_000); // 59 s after the last allowed request
      expectTooMany(
        await signIn(client, "window@example.com", "wrong-password-xx"),
        SIGN_IN.window,
      );
      expect(Number((await row(client, "/sign-in/email"))!.lastRequest)).toBe(lastAllowed);

      advanceBy(2_000); // 61 s
      const allowed = await signIn(client, "window@example.com");
      expect(allowed.status).toBe(200);
      const reset = await row(client, "/sign-in/email");
      expect(reset!.count).toBe(1);
      expect(Number(reset!.lastRequest)).toBe(Date.now());
    });
  });

  describe("concurrency (one conditional database update per request)", () => {
    it("concurrent CREATION of a nonexistent key: exactly 5 admitted, the rest 429, one row at count 5", async () => {
      await register("create-race@example.com");
      const client = "203.0.113.70";
      const responses = await Promise.all(
        Array.from({ length: SIGN_IN.max + 3 }, () =>
          signIn(client, "create-race@example.com", "wrong-password-xx"),
        ),
      );
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 401)).toHaveLength(SIGN_IN.max);
      expect(statuses.filter((s) => s === 429)).toHaveLength(3);
      const rows = await prisma.rateLimit.findMany({
        where: { key: { startsWith: `${client}|` } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.count).toBe(SIGN_IN.max);
    });

    it("concurrent UPDATES of an existing key: the count never exceeds 5 and excess requests get 429", async () => {
      await register("update-race@example.com");
      const client = "203.0.113.71";
      await signIn(client, "update-race@example.com", "wrong-password-xx");
      await signIn(client, "update-race@example.com", "wrong-password-xx");
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          signIn(client, "update-race@example.com", "wrong-password-xx"),
        ),
      );
      expect(responses.filter((r) => r.status === 401)).toHaveLength(SIGN_IN.max - 2);
      expect(responses.filter((r) => r.status === 429)).toHaveLength(8 - (SIGN_IN.max - 2));
      expect((await row(client, "/sign-in/email"))!.count).toBe(SIGN_IN.max);
    });

    it("window-reset race: two requests after the window elapses are both admitted and the count is 2", async () => {
      await register("reset-race@example.com");
      const client = "203.0.113.72";
      for (let i = 0; i < SIGN_IN.max; i++)
        await signIn(client, "reset-race@example.com", "wrong-password-xx");
      advanceBy(SIGN_IN.window * 1000 + 1_000);
      const responses = await Promise.all([
        signIn(client, "reset-race@example.com", "wrong-password-xx"),
        signIn(client, "reset-race@example.com", "wrong-password-xx"),
      ]);
      expect(responses.map((r) => r.status)).toEqual([401, 401]);
      expect((await row(client, "/sign-in/email"))!.count).toBe(2);
    });
  });

  describe("multiple application instances", () => {
    it("two instances on the same database share one budget per client", async () => {
      await register("shared@example.com");
      const client = "203.0.113.80";
      const appB = buildApp(buildInstance());
      for (let i = 0; i < 3; i++)
        await signIn(client, "shared@example.com", "wrong-password-xx", app);
      for (let i = 0; i < 2; i++)
        await signIn(client, "shared@example.com", "wrong-password-xx", appB);
      expectTooMany(
        await signIn(client, "shared@example.com", "wrong-password-xx", app),
        SIGN_IN.window,
      );
      expectTooMany(
        await signIn(client, "shared@example.com", "wrong-password-xx", appB),
        SIGN_IN.window,
      );
      expect((await row(client, "/sign-in/email"))!.count).toBe(SIGN_IN.max);
    });
  });

  describe("account-enumeration parity", () => {
    it("an existing and an unknown address are throttled at the same request with the identical 429", async () => {
      await register("exists@example.com");
      const known = "203.0.113.90";
      const unknown = "203.0.113.91";
      let knownLimited: Response | undefined;
      let unknownLimited: Response | undefined;
      for (let i = 0; i < SIGN_IN.max + 1; i++) {
        const k = await signIn(known, "exists@example.com", "wrong-password-xx");
        const u = await signIn(unknown, "nobody@example.com", "wrong-password-xx");
        expect(k.status).toBe(u.status);
        if (k.status === 429) {
          knownLimited ??= k;
          unknownLimited ??= u;
        }
      }
      expect(knownLimited).toBeDefined();
      expect(knownLimited!.text).toBe(unknownLimited!.text);
      expect(knownLimited!.text).not.toContain("example.com");

      const resetKnown = await from(
        known,
        request(app).post("/api/auth/request-password-reset"),
      ).send({ email: "exists@example.com", redirectTo: "/reset-password" });
      const resetUnknown = await from(
        unknown,
        request(app).post("/api/auth/request-password-reset"),
      ).send({ email: "nobody@example.com", redirectTo: "/reset-password" });
      expect(resetKnown.status).toBe(resetUnknown.status);
    });
  });

  describe("client identity cannot be chosen by the client", () => {
    it("attacker-supplied forwarding entries and private-header copies do not create a fresh budget", async () => {
      await register("identity@example.com");
      const real = "203.0.113.100";
      for (let i = 0; i < SIGN_IN.max; i++)
        await signIn(real, "identity@example.com", "wrong-password-xx");
      // The proxy appends the real address LAST; everything the client adds sits to its left.
      const spoofedChain = await request(app)
        .post("/api/auth/sign-in/email")
        .set("X-Forwarded-For", `9.9.9.9, 8.8.8.8, ${real}`)
        .send({ email: "identity@example.com", password: PASSWORD });
      expectTooMany(spoofedChain, SIGN_IN.window);
      const spoofedPrivate = await request(app)
        .post("/api/auth/sign-in/email")
        .set("X-Forwarded-For", real)
        .set(CLIENT_IP_HEADER, "6.6.6.6")
        .send({ email: "identity@example.com", password: PASSWORD });
      expectTooMany(spoofedPrivate, SIGN_IN.window);
      const keys = (await prisma.rateLimit.findMany()).map((r) => r.key);
      expect(keys.some((k) => k.startsWith("9.9.9.9|") || k.startsWith("6.6.6.6|"))).toBe(false);
      // The library's shared "no-trusted-ip" bucket is never used.
      expect(keys.some((k) => k.startsWith("no-trusted-ip"))).toBe(false);
    });
  });

  describe("stale-row cleanup (library built-in)", () => {
    it("rows older than the longest window are deleted when a window resets; active rows are preserved", async () => {
      await register("cleanup@example.com");
      const a = "203.0.113.110";
      const b = "203.0.113.111";
      const c = "203.0.113.112";
      await signIn(a, "cleanup@example.com", "wrong-password-xx"); // key A at t0
      await signUp(b, "cleanup-b@example.com"); // key B at t0 (10-min window)
      advanceBy(300_000);
      await from(c, request(app).get("/api/auth/get-session")); // key C at t0+300 s (10-s window)
      expect(await prisma.rateLimit.count()).toBe(4); // + the registration row

      advanceBy(301_000); // t0 + 601 s: A's 60-s window elapsed → reset path → prune cutoff = now − 600 s
      expect((await signIn(a, "cleanup@example.com", "wrong-password-xx")).status).toBe(401);

      const keys = (await prisma.rateLimit.findMany()).map((r) => r.key).sort();
      expect(keys).toContain(`${a}|/sign-in/email`); // reset, count 1
      expect(keys).toContain(`${c}|/get-session`); // younger than the longest window: preserved
      expect(keys).not.toContain(`${b}|/sign-up/email`); // older than every window: pruned
      expect((await row(a, "/sign-in/email"))!.count).toBe(1);
    });

    it("a cleanup failure is logged and does not disable enforcement or the request", async () => {
      // A Prisma client whose rate-limit deleteMany always fails.
      const failing = new Proxy(prisma, {
        get(target, prop, receiver) {
          if (prop === "rateLimit") {
            return new Proxy(target.rateLimit, {
              get(model, name, r) {
                if (name === "deleteMany")
                  return () => Promise.reject(new Error("simulated prune failure"));
                return Reflect.get(model, name, r);
              },
            });
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as PrismaClient;
      const fragileApp = buildApp(buildInstance(failing));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await register("prune@example.com");
      const client = "203.0.113.120";

      await signIn(client, "prune@example.com", "wrong-password-xx", fragileApp);
      advanceBy(SIGN_IN.window * 1000 + 1_000);
      // Window reset → prune attempted → fails → logged; the request itself is served.
      expect(
        (await signIn(client, "prune@example.com", "wrong-password-xx", fragileApp)).status,
      ).toBe(401);
      expect(
        errorSpy.mock.calls.some((c) => String(c[0]).includes("Error pruning rate limit rows")),
      ).toBe(true);
      // Enforcement continues.
      for (let i = 0; i < SIGN_IN.max - 1; i++)
        await signIn(client, "prune@example.com", "wrong-password-xx", fragileApp);
      expectTooMany(
        await signIn(client, "prune@example.com", "wrong-password-xx", fragileApp),
        SIGN_IN.window,
      );
    });
  });

  describe("infrastructure failure → 503 (approved Express wrapper)", () => {
    it("a failing rate-limit storage ends the request with the SERVICE_UNAVAILABLE envelope, no unhandled rejection, nothing executed", async () => {
      const base = buildAuthOptions({
        prisma,
        baseUrl: ORIGIN,
        secret: process.env.BETTER_AUTH_SECRET!,
        trustedOrigins: [],
        rateLimitEnabled: true,
        mailTransport: new MemoryMailTransport(),
      });
      const broken = betterAuth({
        ...base,
        rateLimit: {
          ...base.rateLimit,
          customStorage: {
            consume: async () => {
              throw Object.assign(
                new Error("simulated database outage: SELECT * FROM rate_limits"),
                {
                  code: "P1001",
                },
              );
            },
          },
        },
      });
      const brokenApp = buildApp(broken);
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await register("outage@example.com");

      try {
        const signUpResponse = await signUp(
          "203.0.113.130",
          "never-created@example.com",
          brokenApp,
        );
        expect(signUpResponse.status).toBe(503);
        expect(signUpResponse.body).toEqual({
          error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." },
        });
        const signInResponse = await signIn(
          "203.0.113.130",
          "outage@example.com",
          PASSWORD,
          brokenApp,
        );
        expect(signInResponse.status).toBe(503);
        expect(signInResponse.text).not.toContain("simulated");
        await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      expect(unhandled).toEqual([]);
      // Nothing executed: no user created, no session created.
      expect(
        await prisma.user.findUnique({ where: { email: "never-created@example.com" } }),
      ).toBeNull();
      expect(await prisma.session.count()).toBe(0);
      // Logged as an event code with the error class/code only — no message, SQL, or stack.
      const lines = errorSpy.mock.calls.map((c) => String(c[0]));
      expect(
        lines.some((l) => l.includes("AUTH_INFRASTRUCTURE_FAILURE") && l.includes("code=P1001")),
      ).toBe(true);
      for (const line of lines) {
        expect(line).not.toContain("simulated");
        expect(line).not.toContain("SELECT");
        expect(line).not.toContain("    at ");
      }
    });
  });
});
