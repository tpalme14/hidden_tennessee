import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response } from "express";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { buildAuthOptions } from "../src/auth/auth-options.js";
import { createClientIpMiddleware } from "../src/auth/client-ip.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { createRequireSession, type SessionAuthority } from "../src/auth/require-session.js";
import { prisma } from "../src/db/prisma.js";
import { MemoryMailTransport } from "./helpers/memory-mail-transport.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 7 — `requireSession` distinguishes a genuine
 * authentication failure (401 UNAUTHENTICATED) from an infrastructure failure
 * (503 SERVICE_UNAVAILABLE), and never turns the latter into a 401.
 * tests/require-session.integration.test.ts keeps covering the 401 paths and
 * renewal on the real instance; this file injects failing authorities.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
const SERVICE_UNAVAILABLE = {
  error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." },
};

/** A Prisma client whose session reads always reject with a Prisma-style error. */
function failingSessionPrisma(): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "session") {
        return new Proxy(Reflect.get(target, prop, receiver) as object, {
          get(model, name, r) {
            if (name === "findFirst" || name === "findMany" || name === "findUnique") {
              return () =>
                Promise.reject(
                  Object.assign(
                    new Error(
                      'simulated database failure: SELECT * FROM "sessions" WHERE token = $1',
                    ),
                    { code: "P1001", name: "PrismaClientKnownRequestError" },
                  ),
                );
            }
            return Reflect.get(model, name, r);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}

function buildAuth(client: PrismaClient = prisma) {
  return betterAuth(
    buildAuthOptions({
      prisma: client,
      baseUrl: ORIGIN,
      secret: process.env.BETTER_AUTH_SECRET!,
      trustedOrigins: [],
      rateLimitEnabled: false,
      mailTransport: new MemoryMailTransport(),
    }),
  );
}

/** A test-only app: real auth mount for sign-in, and a probe guarded by requireSession over `authority`. */
function buildApp(authority: SessionAuthority, authForMount = buildAuth()) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(createClientIpMiddleware({ trustedProxyHops: 1 }));
  mountBetterAuth(app, authForMount);
  const handler = vi.fn((req: Request, res: Response) => {
    res.json({ userId: req.auth!.user.id });
  });
  app.get("/probe", createRequireSession(authority), handler);
  return { app, handler };
}

async function signedInCookie(app: express.Express, email: string) {
  await request(app).post("/api/auth/sign-up/email").send({ name: "", email, password: PASSWORD });
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return (response.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

describe("requireSession error mapping (integration, M03-T02 Increment 7)", () => {
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

  it("a database failure during session validation → 503 SERVICE_UNAVAILABLE, never 401, handler not run, sanitized log only", async () => {
    const healthy = buildAuth();
    const broken = buildAuth(failingSessionPrisma());
    const { app, handler } = buildApp(broken, healthy);
    const cookie = await signedInCookie(app, "outage@example.com");

    const response = await request(app).get("/probe").set("Cookie", cookie);

    expect(response.status).toBe(503);
    expect(response.body).toEqual(SERVICE_UNAVAILABLE);
    expect(response.body).not.toEqual(UNAUTHENTICATED);
    expect(response.text).not.toContain("simulated");
    expect(response.text).not.toContain("SELECT");
    expect(handler).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);

    const infra = logged.filter((l) => l.line.includes("AUTH_INFRASTRUCTURE_FAILURE"));
    expect(infra).toHaveLength(1);
    expect(infra[0]!.level).toBe("error");
    for (const entry of logged) {
      expect(entry.line).not.toContain("simulated");
      expect(entry.line).not.toContain("SELECT");
      expect(entry.line).not.toContain("    at ");
      expect(entry.line).not.toContain(cookie.split("=")[1]!.split(".")[0]!); // the session token
    }
    // The session itself is intact — nothing was revoked or consumed by the failure.
    expect(await prisma.session.count()).toBe(1);
  });

  it("a non-API exception from the authority (adapter or library fault) → 503, not 401", async () => {
    const faulty: SessionAuthority = {
      api: {
        getSession: (async () => {
          throw new TypeError("Cannot read properties of undefined (reading 'adapter')");
        }) as unknown as SessionAuthority["api"]["getSession"],
      },
    };
    const { app, handler } = buildApp(faulty);

    const response = await request(app)
      .get("/probe")
      .set("Cookie", "better-auth.session_token=x.y");

    expect(response.status).toBe(503);
    expect(response.body).toEqual(SERVICE_UNAVAILABLE);
    expect(handler).not.toHaveBeenCalled();
    const line = logged.find((l) => l.line.includes("AUTH_INFRASTRUCTURE_FAILURE"))?.line;
    expect(line).toBeDefined();
    expect(line).toContain("code=TypeError");
    expect(line).not.toContain("adapter");
  });

  it("the library's own 5xx verdict → 503; its own 4xx verdict → 401 (genuine authentication failure)", async () => {
    const serverError: SessionAuthority = {
      api: {
        getSession: (async () => {
          throw APIError.from("INTERNAL_SERVER_ERROR", {
            message: "Failed to get session",
            code: "FAILED_TO_GET_SESSION",
          });
        }) as unknown as SessionAuthority["api"]["getSession"],
      },
    };
    const unauthorized: SessionAuthority = {
      api: {
        getSession: (async () => {
          throw APIError.from("UNAUTHORIZED", {
            message: "Failed to get session",
            code: "FAILED_TO_GET_SESSION",
          });
        }) as unknown as SessionAuthority["api"]["getSession"],
      },
    };

    const five = await request(buildApp(serverError).app)
      .get("/probe")
      .set("Cookie", "better-auth.session_token=x.y");
    expect(five.status).toBe(503);
    expect(five.body).toEqual(SERVICE_UNAVAILABLE);

    const four = await request(buildApp(unauthorized).app)
      .get("/probe")
      .set("Cookie", "better-auth.session_token=x.y");
    expect(four.status).toBe(401);
    expect(four.body).toEqual(UNAUTHENTICATED);
    // Exactly one infrastructure line: the 5xx verdict. The 4xx verdict is a
    // genuine authentication failure and is not logged as infrastructure.
    const infra = logged.filter((l) => l.line.includes("AUTH_INFRASTRUCTURE_FAILURE"));
    expect(infra).toHaveLength(1);
    expect(infra[0]!.line).toContain("code=FAILED_TO_GET_SESSION");
  });

  it("genuine authentication failures on a healthy authority are still 401, and a valid session still passes with its renewal cookie behaviour intact", async () => {
    const healthy = buildAuth();
    const { app, handler } = buildApp(healthy, healthy);
    const cookie = await signedInCookie(app, "healthy@example.com");

    const missing = await request(app).get("/probe");
    const forged = await request(app)
      .get("/probe")
      .set(
        "Cookie",
        "better-auth.session_token=forged.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      );
    for (const response of [missing, forged]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(logged.some((l) => l.line.includes("AUTH_INFRASTRUCTURE_FAILURE"))).toBe(false);

    const valid = await request(app).get("/probe").set("Cookie", cookie);
    expect(valid.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(valid.headers["set-cookie"]).toBeUndefined(); // not due for renewal: no cookie re-issued
  });
});
