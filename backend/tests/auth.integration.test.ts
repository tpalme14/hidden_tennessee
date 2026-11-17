import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request, { type Response } from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 2 — Better Auth instance and Express mount, exercised
 * end-to-end through the real Express app and the real landmarks_test
 * database (ADR-009). Covers the developer's Increment 2 requirements:
 * registration contract (forced empty name), account-enumeration parity,
 * session/cookie security, no credentials in responses or logs, database
 * generated UUIDs, and the session-metadata hook.
 *
 * Everything here is the library's own behavior under THIS configuration
 * (src/auth/auth.ts); no endpoint is replaced or wrapped.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_COOKIE =
  /^better-auth\.session_token=([^;]+); Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/;

const app = createApp();

function register(email: string, password = PASSWORD, name = "") {
  return request(app).post("/api/auth/sign-up/email").send({ name, email, password });
}

function signIn(email: string, password = PASSWORD) {
  return request(app).post("/api/auth/sign-in/email").send({ email, password });
}

/** The `name=value` pair of the session cookie set by a sign-in response. */
function sessionCookie(response: Response): string {
  const setCookie = response.headers["set-cookie"] as unknown as string[] | undefined;
  const header = setCookie?.find((c) => c.startsWith("better-auth.session_token="));
  if (!header) throw new Error("no session cookie in response");
  return header.split(";")[0]!;
}

async function signedInCookie(email: string) {
  await register(email);
  return sessionCookie(await signIn(email));
}

describe("Better Auth mount (integration, M03-T02 Increment 2)", () => {
  // The library logs through console.*; capture everything so each test can
  // prove that no email address, password, or hash ever reaches the logs.
  let logged: string[] = [];
  // Start from an empty identity schema regardless of what an earlier run or
  // manual probe left behind; every test asserts exact row counts.
  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    logged = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  function expectNothingSensitiveLogged(...values: string[]) {
    for (const line of logged) {
      for (const value of values) expect(line).not.toContain(value);
    }
  }

  describe("registration", () => {
    it("creates a user with an empty name, a hashed credential account, and no session", async () => {
      const email = "hiker@example.com";
      const response = await register(email);

      expect(response.status).toBe(200);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.body).toEqual({
        token: null,
        user: {
          id: expect.stringMatching(UUID_V4),
          name: "",
          email,
          emailVerified: false,
          image: null,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        id: response.body.user.id,
        name: "",
        email,
        emailVerified: false,
      });

      const accounts = await prisma.account.findMany();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        providerId: "credential",
        accountId: users[0]!.id,
        userId: users[0]!.id,
      });
      // Stored as a hash (scrypt "salt:key" hex), never the submitted value.
      expect(accounts[0]!.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
      expect(accounts[0]!.password).not.toContain(PASSWORD);

      expect(await prisma.session.count()).toBe(0);
      // A successful registration emits nothing at warn level or above — in
      // particular no "ignored id" warning: PostgreSQL generated the UUID.
      expect(logged).toEqual([]);
    });

    it("stores an empty name even when the client supplies one (user.create.before hook)", async () => {
      const response = await register("named@example.com", PASSWORD, "Injected Display Name");

      expect(response.status).toBe(200);
      expect(response.body.user.name).toBe("");
      expect(await prisma.user.findFirstOrThrow()).toMatchObject({ name: "" });
    });

    it("the library's /update-user endpoint is disabled (404) and the name stays empty — the update hook remains as defence in depth", async () => {
      const cookie = await signedInCookie("updater@example.com");

      const response = await request(app)
        .post("/api/auth/update-user")
        .set("Cookie", cookie)
        .set("Origin", ORIGIN)
        .send({ name: "Injected Later", image: "https://attacker.example/a.png" });

      // Increment 4: outside the approved specification → disabledPaths 404
      // before validation or hooks run (Increment 2 had asserted 200 + "").
      expect(response.status).toBe(404);
      expect(await prisma.user.findFirstOrThrow()).toMatchObject({ name: "", image: null });
    });

    it("a synthetic duplicate response has the same id and timestamp FORMATS as a real one (format parity)", async () => {
      const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      const real = await register("parity@example.com");
      const synthetic = await register("parity@example.com", "another-password-9", "Probe");

      for (const [label, body] of [
        ["real", real.body],
        ["synthetic", synthetic.body],
      ] as const) {
        expect(body.user.id, label).toMatch(UUID_V4);
        expect(body.user.createdAt, label).toMatch(ISO_MS);
        expect(body.user.updatedAt, label).toMatch(ISO_MS);
        expect(body.user.createdAt, label).toBe(body.user.updatedAt);
        expect(Math.abs(Date.parse(body.user.createdAt) - Date.now()), label).toBeLessThan(5_000);
      }
      expect(await prisma.user.count()).toBe(1);
    });

    it("stores a mixed-case email in lowercase and accepts sign-in in any casing", async () => {
      const response = await register("Mixed.Case@Example.COM");

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe("mixed.case@example.com");
      expect(await prisma.user.findFirstOrThrow()).toMatchObject({
        email: "mixed.case@example.com",
      });

      for (const variant of [
        "mixed.case@example.com",
        "MIXED.CASE@EXAMPLE.COM",
        "Mixed.Case@Example.COM",
      ]) {
        const signInResponse = await signIn(variant);
        expect(signInResponse.status).toBe(200);
        expect(signInResponse.body.user.email).toBe("mixed.case@example.com");
      }
    });

    it("answers a duplicate registration exactly like a first one and creates nothing (no account enumeration)", async () => {
      const first = await register("dupe@example.com", PASSWORD, "");
      // Different casing, different name, different password: still the same answer.
      const second = await register("DUPE@example.com", "a-completely-different-pw", "Probe Name");

      expect(first.status).toBe(200);
      expect(second.status).toBe(first.status);
      expect(second.headers["set-cookie"]).toBeUndefined();
      expect(first.headers["set-cookie"]).toBeUndefined();

      // Same keys, in the same order, with the same values for every field a
      // client could compare — only id and timestamps legitimately differ.
      expect(Object.keys(second.body)).toEqual(Object.keys(first.body));
      expect(Object.keys(second.body.user)).toEqual(Object.keys(first.body.user));
      const comparable = ({
        id: _id,
        createdAt: _c,
        updatedAt: _u,
        ...rest
      }: Record<string, unknown>) => rest;
      expect(comparable(second.body.user)).toEqual(comparable(first.body.user));
      expect(second.body.user.name).toBe("");
      expect(second.body.user.id).toMatch(UUID_V4);
      expect(first.body.user.id).toMatch(UUID_V4);
      expect(second.body.user.createdAt).toBe(second.body.user.updatedAt);
      expect(first.body.user.createdAt).toBe(first.body.user.updatedAt);

      expect(await prisma.user.count()).toBe(1);
      expect(await prisma.account.count()).toBe(1);
      // The library's info-level "existing email" line is below the
      // configured log level; the address never reaches the logs.
      expectNothingSensitiveLogged("dupe@example.com", PASSWORD, "a-completely-different-pw");
    });

    it("rejects passwords outside 8–128 characters and malformed emails with 400, creating nothing", async () => {
      const tooShort = await register("short@example.com", "1234567");
      expect(tooShort.status).toBe(400);
      expect(tooShort.body).toEqual({ code: "PASSWORD_TOO_SHORT", message: expect.any(String) });

      const tooLong = await register("long@example.com", "x".repeat(129));
      expect(tooLong.status).toBe(400);
      expect(tooLong.body).toEqual({ code: "PASSWORD_TOO_LONG", message: expect.any(String) });

      const badEmail = await register("not-an-email");
      expect(badEmail.status).toBe(400);
      expect(badEmail.body).toEqual({ code: "VALIDATION_ERROR", message: expect.any(String) });

      expect(await prisma.user.count()).toBe(0);
      expectNothingSensitiveLogged("1234567", "x".repeat(129));
    });
  });

  describe("sign-in and session", () => {
    it("sets an HttpOnly, SameSite=Lax, 30-day session cookie and stores a session WITHOUT ip/user-agent", async () => {
      const email = "signin@example.com";
      await register(email);

      const response = await request(app)
        .post("/api/auth/sign-in/email")
        .set("User-Agent", "ProbeBrowser/1.0")
        .set("X-Forwarded-For", "203.0.113.9")
        .send({ email, password: PASSWORD });

      expect(response.status).toBe(200);
      const setCookie = response.headers["set-cookie"] as unknown as string[];
      expect(setCookie).toHaveLength(1);
      expect(setCookie[0]).toMatch(SESSION_COOKIE);
      // No Secure attribute over plain http (baseURL http://localhost:3000);
      // the Secure flag under production configuration is Increment 4's check.
      expect(setCookie[0]).not.toMatch(/Secure/);
      expect(response.body).toEqual({
        redirect: false,
        token: expect.any(String),
        user: expect.objectContaining({ email, name: "" }),
      });
      expect(JSON.stringify(response.body)).not.toContain("password");

      const sessions = await prisma.session.findMany();
      expect(sessions).toHaveLength(1);
      const session = sessions[0]!;
      expect(session.id).toMatch(UUID_V4);
      expect(session.userId).toBe(response.body.user.id);
      expect(session.token).toBe(response.body.token);
      // The hook blanked both values even though the request carried them.
      expect(session.ipAddress).toBeNull();
      expect(session.userAgent).toBeNull();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(session.expiresAt.getTime() - (Date.now() + thirtyDays))).toBeLessThan(
        60_000,
      );

      expect(logged).toEqual([]);
    });

    it("gives the identical 401 for a wrong password and for an unknown email", async () => {
      await register("known@example.com");

      const wrongPassword = await signIn("known@example.com", "not-the-right-password");
      const unknownEmail = await signIn("unknown@example.com", "not-the-right-password");

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      });
      expect(unknownEmail.body).toEqual(wrongPassword.body);
      expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
      expect(unknownEmail.headers["set-cookie"]).toBeUndefined();
      expect(await prisma.session.count()).toBe(0);
      expectNothingSensitiveLogged(
        "known@example.com",
        "unknown@example.com",
        "not-the-right-password",
      );
    });

    it("returns the session and user for a valid cookie, and null without one", async () => {
      const email = "session@example.com";
      const cookie = await signedInCookie(email);

      const withCookie = await request(app).get("/api/auth/get-session").set("Cookie", cookie);
      expect(withCookie.status).toBe(200);
      expect(withCookie.body).toEqual({
        session: {
          id: expect.stringMatching(UUID_V4),
          userId: withCookie.body.user.id,
          // The documented session contract includes the caller's own token.
          token: cookie.split("=")[1]!.split(".")[0],
          expiresAt: expect.any(String),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          ipAddress: null,
          userAgent: null,
        },
        user: {
          id: expect.stringMatching(UUID_V4),
          name: "",
          email,
          emailVerified: false,
          image: null,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });
      expect(JSON.stringify(withCookie.body)).not.toContain("password");

      const withoutCookie = await request(app).get("/api/auth/get-session");
      expect(withoutCookie.status).toBe(200);
      expect(withoutCookie.body).toBeNull();
    });

    it("sign-out deletes the session, expires the cookie, and later retrieval returns null", async () => {
      const cookie = await signedInCookie("signout@example.com");
      expect(await prisma.session.count()).toBe(1);

      const response = await request(app)
        .post("/api/auth/sign-out")
        .set("Cookie", cookie)
        .set("Origin", ORIGIN)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      const setCookie = response.headers["set-cookie"] as unknown as string[];
      expect(setCookie).toContain(
        "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
      );
      expect(await prisma.session.count()).toBe(0);

      const afterwards = await request(app).get("/api/auth/get-session").set("Cookie", cookie);
      expect(afterwards.body).toBeNull();
    });

    it("refuses a cookie-bearing state change without a trusted Origin (library origin check stays on in tests)", async () => {
      const cookie = await signedInCookie("csrf@example.com");

      const noOrigin = await request(app).post("/api/auth/sign-out").set("Cookie", cookie).send({});
      expect(noOrigin.status).toBe(403);
      expect(noOrigin.body).toEqual({
        code: "MISSING_OR_NULL_ORIGIN",
        message: expect.any(String),
      });

      const foreignOrigin = await request(app)
        .post("/api/auth/sign-out")
        .set("Cookie", cookie)
        .set("Origin", "https://attacker.example")
        .send({});
      expect(foreignOrigin.status).toBe(403);
      expect(foreignOrigin.body).toEqual({ code: "INVALID_ORIGIN", message: expect.any(String) });

      // Neither attempt touched the session.
      expect(await prisma.session.count()).toBe(1);
    });
  });

  describe("mount", () => {
    it("serves Better Auth's own 404 for an unknown /api/auth/* path, not the application envelope", async () => {
      const response = await request(app).get("/api/auth/does-not-exist");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({});
    });

    it("still serves the application's JSON 404 envelope for unknown /api/v1/* paths", async () => {
      const response = await request(app).post("/api/v1/does-not-exist").send({});

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: { code: "NOT_FOUND", message: "Resource not found." },
      });
    });
  });
});
