import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { betterAuth } from "better-auth";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { buildAuthOptions } from "../src/auth/auth-options.js";
import { createClientIpMiddleware } from "../src/auth/client-ip.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { prisma } from "../src/db/prisma.js";
import { MemoryMailTransport } from "./helpers/memory-mail-transport.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 6 — error routing with `onAPIError.throw` (replacing the
 * Increment 4 hook): expected responses keep their status codes across every
 * authentication flow, and an unexpected database failure inside an endpoint
 * becomes the sanitized Express 503 instead of the library's raw console line
 * and empty 500.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";

/** A Prisma client whose `<model>.<method>` always rejects with a Prisma-style error. */
function failingPrisma(model: string, method: string): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === model) {
        return new Proxy(Reflect.get(target, prop, receiver) as object, {
          get(m, name, r) {
            if (name === method) {
              return () =>
                Promise.reject(
                  Object.assign(new Error("simulated database failure: SELECT * FROM users"), {
                    code: "P1001",
                    name: "PrismaClientKnownRequestError",
                  }),
                );
            }
            return Reflect.get(m, name, r);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}

describe("authentication error routing (integration, M03-T02 Increment 6)", () => {
  let logged: { level: string; line: string }[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    logged = [];
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push({ level, line: args.map(String).join(" ") });
      });
    }
  });
  afterEach(async () => {
    process.off("unhandledRejection", onUnhandled);
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  it("the real app keeps every expected status: 400, 401, 403, 404, 200, and the reset gate's 503", async () => {
    const app = createApp();
    const email = "matrix@example.com";
    const status = async (name: string, promise: Promise<request.Response>) => ({
      name,
      response: await promise,
    });

    const badEmail = await status(
      "sign-up invalid email",
      request(app)
        .post("/api/auth/sign-up/email")
        .send({ name: "", email: "nope", password: PASSWORD }),
    );
    expect(badEmail.response.status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/auth/sign-up/email")
          .send({ name: "", email, password: PASSWORD })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/auth/sign-up/email")
          .send({ name: "", email, password: PASSWORD })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/auth/sign-in/email")
          .send({ email, password: "wrong-password-xx" })
      ).status,
    ).toBe(401);
    const signedIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email, password: PASSWORD });
    expect(signedIn.status).toBe(200);
    const cookie = (signedIn.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    expect((await request(app).get("/api/auth/get-session").set("Cookie", cookie)).status).toBe(
      200,
    );
    expect((await request(app).get("/api/auth/get-session")).body).toBeNull();
    expect(
      (
        await request(app)
          .post("/api/auth/sign-out")
          .set("Cookie", cookie)
          .set("Origin", "https://attacker.example")
          .send({})
      ).status,
    ).toBe(403);
    // The application's own transport is "disabled" under test → readiness gate.
    const reset = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email, redirectTo: "/reset-password" });
    expect(reset.status).toBe(503);
    expect(reset.body.code).toBe("RESET_UNAVAILABLE");
    expect(
      (
        await request(app)
          .post("/api/auth/request-password-reset")
          .send({ email, redirectTo: "https://attacker.example/x" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/auth/reset-password")
          .send({ token: "nope", newPassword: "another-good-password" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/auth/sign-out")
          .set("Cookie", cookie)
          .set("Origin", ORIGIN)
          .send({})
      ).status,
    ).toBe(200);
    expect((await request(app).get("/api/auth/does-not-exist")).status).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/auth/update-user")
          .set("Cookie", cookie)
          .set("Origin", ORIGIN)
          .send({ name: "x" })
      ).status,
    ).toBe(404);

    expect(unhandled).toEqual([]);
    expect(logged.some((l) => l.line.includes("# SERVER_ERROR"))).toBe(false);
  });

  it("an unexpected database failure inside an endpoint → sanitized 503, no raw console output, no unhandled rejection, nothing executed", async () => {
    const broken = betterAuth(
      buildAuthOptions({
        prisma: failingPrisma("user", "findFirst"),
        baseUrl: ORIGIN,
        secret: process.env.BETTER_AUTH_SECRET!,
        trustedOrigins: [],
        rateLimitEnabled: false,
        mailTransport: new MemoryMailTransport(),
      }),
    );
    const app = express();
    app.set("trust proxy", 1);
    app.use(createClientIpMiddleware({ trustedProxyHops: 1 }));
    mountBetterAuth(app, broken);

    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "x@example.com", password: PASSWORD });
    const signUp = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ name: "", email: "y@example.com", password: PASSWORD });
    await new Promise((resolve) => setTimeout(resolve, 50));

    for (const response of [signIn, signUp]) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." },
      });
      expect(response.text).not.toContain("simulated");
      expect(response.text).not.toContain("SELECT");
    }
    expect(unhandled).toEqual([]);
    expect(await prisma.user.count()).toBe(0);

    const errors = logged.filter((l) => l.level === "error");
    expect(errors).toHaveLength(2);
    for (const entry of errors) {
      expect(entry.line).toContain("AUTH_INFRASTRUCTURE_FAILURE");
      expect(entry.line).toContain("code=P1001");
      expect(entry.line).not.toContain("# SERVER_ERROR");
      expect(entry.line).not.toContain("simulated");
      expect(entry.line).not.toContain("SELECT");
      expect(entry.line).not.toContain("    at ");
    }
  });
});
