import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { DISABLED_AUTH_PATHS } from "../src/auth/auth-options.js";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 4 — the approved endpoint boundary on /api/auth/*:
 * everything outside the specification is disabled (404 before any
 * processing), the approved flows stay available, and the parameterised
 * social callback — which `disabledPaths` cannot name — can perform no
 * operation under the installed configuration (no provider).
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";

const app = createApp();

async function signedInCookie(email: string) {
  await request(app).post("/api/auth/sign-up/email").send({ name: "", email, password: PASSWORD });
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return (response.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

async function snapshot() {
  return {
    users: await prisma.user.findMany({ orderBy: { email: "asc" } }),
    accounts: await prisma.account.findMany({ orderBy: { id: "asc" } }),
    sessions: await prisma.session.findMany({ orderBy: { id: "asc" } }),
    verifications: await prisma.verification.count(),
  };
}

describe("disabled Better Auth endpoints (integration, M03-T02 Increment 4)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    // Keep the library's error lines for these deliberately failing calls out
    // of the test output; nothing here asserts on logs.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  it("every disabled path is an exact string the installed router registers (no typos, nothing stale)", () => {
    const registered = new Set(
      Object.values(auth.api as Record<string, { path?: string }>)
        .map((endpoint) => endpoint?.path)
        .filter((p): p is string => typeof p === "string"),
    );
    for (const path of DISABLED_AUTH_PATHS) {
      expect(registered.has(path), `${path} is not a registered endpoint`).toBe(true);
    }
    // The approved flows are NOT in the list.
    for (const permitted of [
      "/sign-up/email",
      "/sign-in/email",
      "/sign-out",
      "/get-session",
      "/request-password-reset",
      "/reset-password",
      "/reset-password/:token",
    ]) {
      expect(DISABLED_AUTH_PATHS).not.toContain(permitted);
    }
  });

  it("answers 404 for every disabled path — signed in, trusted Origin — and changes no row", async () => {
    const cookie = await signedInCookie("disabled@example.com");
    const before = await snapshot();
    const methodByPath = Object.fromEntries(
      Object.values(
        auth.api as Record<string, { path?: string; options?: { method?: string | string[] } }>,
      )
        .filter((e) => typeof e?.path === "string")
        .map((e) => [
          e.path!,
          Array.isArray(e.options?.method) ? e.options!.method[0]! : (e.options?.method ?? "GET"),
        ]),
    );

    for (const path of DISABLED_AUTH_PATHS) {
      const method = methodByPath[path]!.toLowerCase() as "get" | "post";
      const req = request(app)
        [method](`/api/auth${path}`)
        .set("Cookie", cookie)
        .set("Origin", ORIGIN);
      const response =
        method === "post"
          ? await req.send({
              name: "x",
              newPassword: "another-good-pw-1",
              currentPassword: PASSWORD,
              email: "a@b.co",
              provider: "google",
              token: "t",
            })
          : await req;
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(404);
      expect(response.text, `${method.toUpperCase()} ${path}`).toBe("Not Found");
    }

    // Trailing slash and case variants do not slip past.
    expect(
      (
        await request(app)
          .post("/api/auth/update-user/")
          .set("Cookie", cookie)
          .set("Origin", ORIGIN)
          .send({ name: "x" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/auth/Update-User")
          .set("Cookie", cookie)
          .set("Origin", ORIGIN)
          .send({ name: "x" })
      ).status,
    ).toBe(404);

    expect(await snapshot()).toEqual(before);
    expect(before.users[0]!.name).toBe("");
  });

  it("keeps the approved flows available: sign-up, sign-in, get-session, sign-out, and the password-reset routes are not disabled", async () => {
    const cookie = await signedInCookie("allowed@example.com");
    expect(
      (await request(app).get("/api/auth/get-session").set("Cookie", cookie)).body.user.email,
    ).toBe("allowed@example.com");
    // Reset routes: configured in Increment 6; today they must simply not be
    // the disabled-path 404.
    const resetRequest = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: "allowed@example.com", redirectTo: "/reset-password" });
    expect(resetRequest.status).not.toBe(404);
    const resetCallback = await request(app).get(
      "/api/auth/reset-password/some-token?callbackURL=/reset-password",
    );
    expect(resetCallback.status).toBe(302);
    expect(resetCallback.headers["location"]).toBe(`${ORIGIN}/reset-password?error=INVALID_TOKEN`);
    const signOut = await request(app)
      .post("/api/auth/sign-out")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .send({});
    expect(signOut.status).toBe(200);
  });

  it("the parameterised social callback cannot perform any operation with no provider configured", async () => {
    const cookie = await signedInCookie("callback@example.com");
    const before = await snapshot();

    const get = await request(app).get("/api/auth/callback/google?code=x&state=y");
    expect(get.status).toBe(302);
    expect(get.headers["location"]).toBe(`${ORIGIN}/api/auth/error?error=state_mismatch`);

    const post = await request(app)
      .post("/api/auth/callback/github")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .send({ code: "x", state: "y" });
    expect(post.status).toBe(302);
    expect(post.headers["location"]).toBe(`${ORIGIN}/api/auth/callback/github?code=x&state=y`);

    // Social sign-in / linking are disabled outright.
    expect(
      (await request(app).post("/api/auth/sign-in/social").send({ provider: "google" })).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/auth/link-social")
          .set("Cookie", cookie)
          .set("Origin", ORIGIN)
          .send({ provider: "google" })
      ).status,
    ).toBe(404);

    expect(await snapshot()).toEqual(before);
  });
});
