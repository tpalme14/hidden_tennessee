import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import request, { type Response as HttpResponse } from "supertest";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { authenticatedUserId, createMountProtected } from "../src/auth/protected-route.js";
import { createRequireSession, type SessionAuthority } from "../src/auth/require-session.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T04 Increment 1 — the protected mount on a TEST-ONLY app wired like
 * src/app.ts: the real Better Auth mount, `express.json()`, `/api/v1` behind
 * the real CSRF check, a public route, protected probe routes (GET, POST, and
 * a nested router), and the same `/api` 404 fallback. Real HTTP, real session
 * cookies, real landmarks_test rows. No production route is involved.
 *
 * These are authorization-INFRASTRUCTURE tests: they prove that protected
 * handlers are unreachable without a valid session and receive identity only
 * from it. Ownership of real resources (User A vs User B favorites) is
 * proven in M03-T05.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const DAY = 24 * 60 * 60 * 1000;
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };
const INTERNAL_ERROR = {
  error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
};
const INVALID_ORIGIN = {
  error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." },
};
const SERVICE_UNAVAILABLE = {
  error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." },
};

// ---- test-only app ---------------------------------------------------------

const handlers = {
  getRoot: vi.fn((req: Request, res: Response) => res.json({ userId: authenticatedUserId(req) })),
  postRoot: vi.fn((req: Request, res: Response) => res.json({ userId: authenticatedUserId(req) })),
  nested: vi.fn((req: Request, res: Response) =>
    res.json({ userId: authenticatedUserId(req), id: req.params.id }),
  ),
  publicRoute: vi.fn((_req: Request, res: Response) => res.json({ ok: true })),
};
const allHandlerSpies = [handlers.getRoot, handlers.postRoot, handlers.nested];

function buildProbeRouter() {
  const probe = Router();
  probe.get("/", handlers.getRoot);
  probe.post("/", handlers.postRoot);
  const nested = Router();
  nested.get("/:id", handlers.nested);
  probe.use("/nested", nested);
  // A deliberate client error forwarded with its status (must keep it).
  probe.get("/gone", (_req: Request, _res: Response, next: NextFunction) => {
    next(Object.assign(new Error("Deliberately not here"), { status: 404, expose: true }));
  });
  // Unexpected failures, synchronous and asynchronous (must become a safe 500).
  probe.get("/boom", () => {
    throw new Error('db down: SELECT * FROM "favorites" WHERE user_id = $1');
  });
  probe.get("/async-boom", async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await Promise.reject(
        Object.assign(new Error("P1001 cannot reach host db.internal:5432"), {
          name: "PrismaClientInitializationError",
          code: "P1001",
        }),
      );
    } catch (err) {
      next(err);
    }
  });
  return probe;
}

function buildApp(mount: (parent: Router, path: string, router: Router) => void = mountProtected) {
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  api.get("/public", handlers.publicRoute);
  mount(api, "/probe", buildProbeRouter());
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(NOT_FOUND);
  });
  return app;
}

const app = buildApp();

// ---- helpers ----------------------------------------------------------------

function sessionCookieOf(response: HttpResponse): string {
  const cookies = (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
  const header = cookies.find((c) => c.startsWith("better-auth.session_token="));
  expect(header).toBeDefined();
  return header!.split(";")[0]!;
}

async function signIn(email: string) {
  await request(app).post("/api/auth/sign-up/email").send({ name: "", email, password: PASSWORD });
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  const row = await prisma.session.findUniqueOrThrow({ where: { token: response.body.token } });
  return {
    cookie: sessionCookieOf(response),
    token: response.body.token as string,
    userId: row.userId,
    sessionId: row.id,
  };
}

/** A cookie with a VALID signature (better-call's HMAC scheme) for a token the database does not know. */
function forgedCookie(): string {
  const value = "ForgedTokenNotInTheDatabase0000";
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(value)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`;
}

function expectUnauthenticated(response: HttpResponse) {
  expect(response.status).toBe(401);
  expect(response.body).toEqual(UNAUTHENTICATED);
  expect(response.headers["cache-control"]).toBe("private, no-store");
}

function expectNoHandlerRan() {
  for (const spy of allHandlerSpies) expect(spy).not.toHaveBeenCalled();
}

let errorLog: ReturnType<typeof vi.spyOn>;

describe("protected mount (integration, M03-T04 Increment 1)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    for (const spy of [...allHandlerSpies, handlers.publicRoute]) spy.mockClear();
    errorLog = vi.spyOn(console, "error");
  });
  afterEach(async () => {
    vi.useRealTimers();
    errorLog.mockRestore();
    await resetTestDatabase();
  });

  describe("anonymous requests never reach a protected handler", () => {
    it("GET, POST, and a nested-router GET all get the identical 401 with no-store", async () => {
      const responses = [
        await request(app).get("/api/v1/probe"),
        await request(app).post("/api/v1/probe").send({}),
        await request(app).get("/api/v1/probe/nested/abc"),
        await request(app).get("/api/v1/probe/boom"),
      ];
      for (const response of responses) expectUnauthenticated(response);
      expect(new Set(responses.map((r) => r.text)).size).toBe(1);
      expectNoHandlerRan();
    });
  });

  describe("rejected sessions", () => {
    it("forged, malformed, expired, and revoked sessions all get the same 401; no handler runs", async () => {
      const responses: HttpResponse[] = [];
      responses.push(await request(app).get("/api/v1/probe").set("Cookie", forgedCookie()));
      responses.push(
        await request(app)
          .get("/api/v1/probe/nested/x")
          .set("Cookie", "better-auth.session_token=not-a-signed-value"),
      );

      const revoked = await signIn("revoked@example.com");
      const signOut = await request(app)
        .post("/api/auth/sign-out")
        .set("Origin", ORIGIN)
        .set("Cookie", revoked.cookie)
        .send({});
      expect(signOut.body).toEqual({ success: true });
      responses.push(await request(app).get("/api/v1/probe").set("Cookie", revoked.cookie));

      const expired = await signIn("expired@example.com");
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31 * DAY });
      responses.push(await request(app).get("/api/v1/probe").set("Cookie", expired.cookie));
      vi.useRealTimers();

      for (const response of responses) expectUnauthenticated(response);
      expect(new Set(responses.map((r) => r.text)).size).toBe(1);
      expectNoHandlerRan();
    });
  });

  describe("valid session", () => {
    it("reaches GET, POST, and nested handlers with the session's own user ID, no-store, and no session data in the body", async () => {
      const user = await signIn("valid@example.com");

      const get = await request(app).get("/api/v1/probe").set("Cookie", user.cookie);
      const post = await request(app)
        .post("/api/v1/probe")
        .set("Origin", ORIGIN)
        .set("Cookie", user.cookie)
        .send({});
      const nested = await request(app).get("/api/v1/probe/nested/abc").set("Cookie", user.cookie);

      expect(get.status).toBe(200);
      expect(get.body).toEqual({ userId: user.userId });
      expect(post.body).toEqual({ userId: user.userId });
      expect(nested.body).toEqual({ userId: user.userId, id: "abc" });
      for (const response of [get, post, nested]) {
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(response.text).not.toContain(user.token);
        expect(response.text).not.toContain(user.sessionId);
        expect(response.text).not.toContain("better-auth.session_token");
      }
      expect(handlers.getRoot).toHaveBeenCalledTimes(1);
      expect(handlers.postRoot).toHaveBeenCalledTimes(1);
      expect(handlers.nested).toHaveBeenCalledTimes(1);
    });

    it("ignores another user's ID supplied in the query, body, or headers", async () => {
      const alice = await signIn("alice@example.com");
      const bob = await signIn("bob@example.com");
      expect(alice.userId).not.toBe(bob.userId);

      const viaQuery = await request(app)
        .get(`/api/v1/probe?userId=${bob.userId}&user_id=${bob.userId}`)
        .set("Cookie", alice.cookie);
      const viaBody = await request(app)
        .post("/api/v1/probe")
        .set("Origin", ORIGIN)
        .set("Cookie", alice.cookie)
        .send({ userId: bob.userId, user_id: bob.userId, user: { id: bob.userId } });
      const viaHeaders = await request(app)
        .get("/api/v1/probe")
        .set("Cookie", alice.cookie)
        .set("X-User-Id", bob.userId)
        .set("X-Forwarded-User", bob.userId);

      for (const response of [viaQuery, viaBody, viaHeaders]) {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ userId: alice.userId });
      }
    });
  });

  describe("intentional HTTP errors keep their status", () => {
    it("a cookie-bearing POST from a foreign origin → 403 INVALID_ORIGIN before the session check; handler not run", async () => {
      const user = await signIn("csrf@example.com");
      const response = await request(app)
        .post("/api/v1/probe")
        .set("Origin", "https://attacker.example")
        .set("Cookie", user.cookie)
        .send({});
      expect(response.status).toBe(403);
      expect(response.body).toEqual(INVALID_ORIGIN);
      expectNoHandlerRan();
    });

    it("a malformed JSON body stays a 400 (not converted to 500), nothing logged as a route failure", async () => {
      const user = await signIn("badjson@example.com");
      const response = await request(app)
        .post("/api/v1/probe")
        .set("Origin", ORIGIN)
        .set("Cookie", user.cookie)
        .set("Content-Type", "application/json")
        .send('{"not": json');
      expect(response.status).toBe(400);
      expect(response.text).not.toContain("INTERNAL_ERROR");
      expectNoHandlerRan();
      expect(errorLog.mock.calls.flat().join(" ")).not.toContain("PROTECTED_ROUTE_FAILURE");
    });

    it("a deliberate next(err) with status 404 keeps its 404", async () => {
      const user = await signIn("gone@example.com");
      const response = await request(app).get("/api/v1/probe/gone").set("Cookie", user.cookie);
      expect(response.status).toBe(404);
      expect(response.text).not.toContain("INTERNAL_ERROR");
    });

    it("a session-validation infrastructure failure → 503 SERVICE_UNAVAILABLE with no-store; handler not run", async () => {
      const faulty: SessionAuthority = {
        api: {
          getSession: (async () => {
            throw new TypeError("Cannot read properties of undefined (reading 'adapter')");
          }) as unknown as SessionAuthority["api"]["getSession"],
        },
      };
      const outageApp = buildApp(createMountProtected(createRequireSession(faulty)));
      const response = await request(outageApp)
        .get("/api/v1/probe/nested/x")
        .set("Cookie", forgedCookie());
      expect(response.status).toBe(503);
      expect(response.body).toEqual(SERVICE_UNAVAILABLE);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expectNoHandlerRan();
    });
  });

  describe("unexpected failures become a safe 500", () => {
    it("synchronous and asynchronous handler failures → fixed 500 envelope, no internals, one sanitized log line each", async () => {
      const user = await signIn("boom@example.com");
      const sync = await request(app).get("/api/v1/probe/boom").set("Cookie", user.cookie);
      const asyncFailure = await request(app)
        .get("/api/v1/probe/async-boom")
        .set("Cookie", user.cookie);

      for (const response of [sync, asyncFailure]) {
        expect(response.status).toBe(500);
        expect(response.body).toEqual(INTERNAL_ERROR);
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(response.text).not.toMatch(/SELECT|db\.internal|P1001|stack|Error/);
      }
      const lines = errorLog.mock.calls.map((call) => String(call[0]));
      const failures = lines.filter((l) => l.includes("PROTECTED_ROUTE_FAILURE"));
      expect(failures).toHaveLength(2);
      expect(failures.join("\n")).not.toMatch(/SELECT|db\.internal|5432|user_id/);
    });

    it("a handler that runs without an established identity (mis-wired mount) → 500, never acting anonymously", async () => {
      const passThrough: RequestHandler = (_req, _res, next) => next();
      const miswired = buildApp(createMountProtected(passThrough));

      const responses = [
        await request(miswired).get("/api/v1/probe"),
        await request(miswired).get("/api/v1/probe/nested/abc"),
      ];
      for (const response of responses) {
        expect(response.status).toBe(500);
        expect(response.body).toEqual(INTERNAL_ERROR);
        expect(response.text).not.toContain("authenticated identity");
      }
      const lines = errorLog.mock.calls.map((call) => String(call[0]));
      expect(lines.filter((l) => l.includes("AUTHORIZATION_CONTEXT_MISSING"))).toHaveLength(2);
    });
  });

  describe("public behaviour is unchanged", () => {
    it("a public route still answers anonymously, without the protected Cache-Control", async () => {
      const response = await request(app).get("/api/v1/public");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(response.headers["cache-control"]).not.toBe("private, no-store");
    });

    it.each([
      ["GET", "/api/v1/unknown"],
      ["POST", "/api/v1/unknown"],
      ["GET", "/api/v1/probeX"],
      ["GET", "/api/v1/probe-extra/1"],
      ["GET", "/api/v1/publicity"],
    ])("anonymous %s %s → the existing 404, not 401", async (method, path) => {
      const response =
        method === "GET" ? await request(app).get(path) : await request(app).post(path).send({});
      expect(response.status).toBe(404);
      expect(response.body).toEqual(NOT_FOUND);
      expectNoHandlerRan();
    });
  });
});
