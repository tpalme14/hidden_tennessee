import { afterEach, beforeAll, describe, expect, it } from "vitest";
import express, { Router, type Request, type Response } from "express";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { authenticatedUserId } from "../src/auth/protected-route.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { prisma } from "../src/db/prisma.js";
import {
  TEST_PASSWORD,
  TestUserSetupError,
  anonymous,
  asUser,
  createSignedInUser,
  createTwoUsers,
  signOut,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T04 Increment 3 — the two-user helpers against the REAL authentication
 * endpoints and landmarks_test: two independent identities and sessions,
 * sign-out of one leaving the other intact, and identity that comes only from
 * the session. These are helper and identity tests; ownership of real
 * resources is proven with them in M03-T05.
 */

const app = createApp();

/** Test-only app wired like src/app.ts with one protected probe that echoes the server-derived identity. */
function probeApp() {
  const probe = express();
  mountBetterAuth(probe, auth);
  probe.use(express.json());
  const api = Router();
  const account = Router();
  const echo = (req: Request, res: Response) => res.json({ userId: authenticatedUserId(req) });
  account.get("/", echo);
  account.post("/", echo);
  account.get("/items/:ownerId", echo);
  mountProtected(api, "/account", account);
  probe.use("/api/v1", requireTrustedOrigin, api);
  return probe;
}

describe("two-user helpers (integration, M03-T04 Increment 3)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });
  afterEach(async () => {
    await resetTestDatabase();
  });

  it("creates two independent accounts with distinct identities, cookies, and session rows", async () => {
    const [a, b] = await createTwoUsers(app);

    expect(a.userId).not.toBe(b.userId);
    expect(a.cookie).not.toBe(b.cookie);
    expect(a.email).not.toBe(b.email);
    for (const user of [a, b]) {
      expect(user.email).toBe(user.email.toLowerCase());
      expect(user.userId).toMatch(/^[0-9a-f-]{36}$/);
      expect(user.cookie).toMatch(/^better-auth\.session_token=/);
      expect(Object.keys(user).sort()).toEqual(["cookie", "email", "userId"]);
    }

    // The database holds exactly what the real endpoints created.
    const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
    expect(users.map((u) => u.id).sort()).toEqual([a.userId, b.userId].sort());
    const accounts = await prisma.account.findMany();
    expect(accounts.filter((x) => x.providerId === "credential")).toHaveLength(2);
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.userId).sort()).toEqual([a.userId, b.userId].sort());
  });

  it("each cookie resolves, through the real session endpoint, to its own user", async () => {
    const [a, b] = await createTwoUsers(app);
    const asA = await asUser(app, a).get("/api/auth/get-session");
    const asB = await asUser(app, b).get("/api/auth/get-session");
    expect(asA.body.user.id).toBe(a.userId);
    expect(asA.body.user.email).toBe(a.email);
    expect(asB.body.user.id).toBe(b.userId);
    expect(asA.body.session.id).not.toBe(asB.body.session.id);
  });

  it("registration alone does not sign in: the helper's first step sets no cookie and creates no session", async () => {
    const email = "registration-only@example.com";
    const response = await anonymous(app)
      .post("/api/auth/sign-up/email")
      .send({ name: "", email, password: TEST_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it("signing one user out leaves the other signed in", async () => {
    const probe = probeApp();
    const [a, b] = await createTwoUsers(probe);

    await signOut(probe, a, "user-a");

    expect((await asUser(probe, a).get("/api/auth/get-session")).body).toBeNull();
    const rejected = await asUser(probe, a).get("/api/v1/account");
    expect(rejected.status).toBe(401);

    const stillB = await asUser(probe, b).get("/api/auth/get-session");
    expect(stillB.body.user.id).toBe(b.userId);
    const bProbe = await asUser(probe, b).get("/api/v1/account");
    expect(bProbe.status).toBe(200);
    expect(bProbe.body).toEqual({ userId: b.userId });

    const remaining = await prisma.session.findMany();
    expect(remaining.map((s) => s.userId)).toEqual([b.userId]);
  });

  it("a protected route sees only the session's identity; swapping cookies swaps identity", async () => {
    const probe = probeApp();
    const [a, b] = await createTwoUsers(probe);
    expect((await asUser(probe, a).get("/api/v1/account")).body).toEqual({ userId: a.userId });
    expect((await asUser(probe, b).get("/api/v1/account")).body).toEqual({ userId: b.userId });
    expect((await anonymous(probe).get("/api/v1/account")).status).toBe(401);
  });

  it("client-supplied identity values cannot override the session", async () => {
    const probe = probeApp();
    const [a, b] = await createTwoUsers(probe);

    const attempts = [
      asUser(probe, a).get(`/api/v1/account?userId=${b.userId}&user_id=${b.userId}`),
      asUser(probe, a).post("/api/v1/account").send({ userId: b.userId, user_id: b.userId }),
      asUser(probe, a).get("/api/v1/account").set("X-User-Id", b.userId),
      asUser(probe, a).get(`/api/v1/account/items/${b.userId}`),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ userId: a.userId });
    }
  });

  it("users created in quick succession never collide", async () => {
    const users = [
      await createSignedInUser(app, "burst"),
      await createSignedInUser(app, "burst"),
      await createSignedInUser(app, "burst"),
    ];
    expect(new Set(users.map((u) => u.userId)).size).toBe(3);
    expect(new Set(users.map((u) => u.email)).size).toBe(3);
    expect(new Set(users.map((u) => u.cookie)).size).toBe(3);
  });

  it("a failed step throws an error naming only the step and status", async () => {
    const noAuth = express(); // Better Auth not mounted
    const failure = await createSignedInUser(noAuth, "user-a").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TestUserSetupError);
    expect((failure as Error).message).toBe("registration for user-a failed with HTTP 404");
    expect((failure as Error).message).not.toMatch(/@example\.com|password|session_token/);
    expect((failure as Error).cause).toBeUndefined();

    // A sign-out that does not succeed is reported the same way, without the cookie.
    const [a] = await createTwoUsers(app);
    const signOutFailure = await signOut(noAuth, a, "user-a").catch((error: unknown) => error);
    expect(signOutFailure).toBeInstanceOf(TestUserSetupError);
    expect((signOutFailure as Error).message).toBe("sign-out for user-a failed with HTTP 404");
    expect((signOutFailure as Error).message).not.toContain(a.cookie);
  });
});
