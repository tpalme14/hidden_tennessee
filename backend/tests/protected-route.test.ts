import { afterEach, describe, expect, it, vi } from "vitest";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  AuthenticationContextMissingError,
  PROTECTED_CACHE_CONTROL,
  authenticatedUserId,
  createMountProtected,
  noStore,
  protectedRouteErrorHandler,
} from "../src/auth/protected-route.js";

/**
 * M03-T04 Increment 1 — unit tests for the protected-route building blocks.
 * No Better Auth instance, database, or configuration is involved; the
 * behaviour on a real app is covered by protected-mount.integration.test.ts.
 */

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_TOKEN = "SessionTokenThatMustNeverLeak";

function fakeRequest(auth?: unknown): Request {
  return { auth } as unknown as Request;
}

function fakeResponse(headersSent = false) {
  const res = {
    headersSent,
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authenticatedUserId", () => {
  it("returns only the user ID from the validated session", () => {
    const req = fakeRequest({
      user: { id: USER_ID, email: "hiker@example.test" },
      session: { id: "s1", token: SESSION_TOKEN },
    });
    const id = authenticatedUserId(req);
    expect(id).toBe(USER_ID);
    expect(typeof id).toBe("string");
  });

  it.each([
    ["no auth at all", undefined],
    ["auth without a user", { session: { id: "s1" } }],
    ["a user without an ID", { user: {} }],
    ["an empty ID", { user: { id: "" } }],
    ["a non-string ID", { user: { id: 42 } }],
  ])("throws AuthenticationContextMissingError for %s", (_label, auth) => {
    expect(() => authenticatedUserId(fakeRequest(auth))).toThrow(AuthenticationContextMissingError);
  });

  it("never consults query, body, params, or headers", () => {
    const req = {
      query: { userId: "attacker" },
      body: { userId: "attacker", user_id: "attacker" },
      params: { userId: "attacker" },
      headers: { "x-user-id": "attacker" },
    } as unknown as Request;
    expect(() => authenticatedUserId(req)).toThrow(AuthenticationContextMissingError);
  });
});

describe("noStore", () => {
  it("sets exactly `private, no-store` and continues", () => {
    const res = fakeResponse();
    const next = vi.fn();
    noStore(fakeRequest(), res as unknown as Response, next as NextFunction);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(PROTECTED_CACHE_CONTROL).toBe("private, no-store");
    expect(next).toHaveBeenCalledWith();
  });
});

describe("protectedRouteErrorHandler", () => {
  function run(err: unknown, headersSent = false) {
    const res = fakeResponse(headersSent);
    const next = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    protectedRouteErrorHandler(
      err,
      fakeRequest(),
      res as unknown as Response,
      next as NextFunction,
    );
    return { res, next, log };
  }

  it("a missing identity becomes the fixed 500 envelope, logged as an event code only", () => {
    const { res, next, log } = run(new AuthenticationContextMissingError());
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(next).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("AUTHORIZATION_CONTEXT_MISSING");
    expect(line).toContain("code=AuthenticationContextMissingError");
    expect(line).not.toContain("No authenticated identity");
  });

  it.each([
    ["a plain Error", new Error('db down: SELECT * FROM "favorites" WHERE user_id = $1')],
    ["an error with a 5xx status", Object.assign(new Error("upstream failed"), { status: 502 })],
    ["a thrown string", "secret detail"],
    [
      "a Prisma-style error",
      Object.assign(new Error("P2002 unique on token=abc"), {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
      }),
    ],
  ])("%s becomes the fixed 500 envelope without leaking its message", (_label, err) => {
    const { res, next, log } = run(err);
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
    expect(next).not.toHaveBeenCalled();
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("PROTECTED_ROUTE_FAILURE");
    expect(line).not.toMatch(/SELECT|upstream failed|secret detail|token=abc/);
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|upstream|secret|token/);
  });

  it.each([
    [
      "a malformed JSON body (body-parser)",
      Object.assign(new SyntaxError("Unexpected token"), {
        status: 400,
        statusCode: 400,
        type: "entity.parse.failed",
        expose: true,
      }),
    ],
    [
      "a payload that is too large",
      Object.assign(new Error("request entity too large"), {
        status: 413,
        type: "entity.too.large",
      }),
    ],
    ["a deliberate not-found", Object.assign(new Error("Not found"), { statusCode: 404 })],
  ])("%s keeps its status: passed on unchanged, nothing logged", (_label, err) => {
    const { res, next, log } = run(err);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.statusCode).toBe(200); // untouched
    expect(res.body).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("once headers are sent, defers to Express instead of writing a second response", () => {
    const err = new Error("late failure");
    const { res, next } = run(err, true);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.body).toBeUndefined();
  });
});

describe("createMountProtected", () => {
  const passThrough = (_req: Request, _res: Response, next: NextFunction) => next();

  it.each(["", "/", "*", "/*", "favorites", "/favorites/", "/fav*", "/:id", "/a//b"])(
    "refuses a non-specific or malformed mount path %j",
    (path) => {
      const mount = createMountProtected(passThrough);
      expect(() => mount(Router(), path, Router())).toThrow(/specific literal path/);
    },
  );

  it.each(["/favorites", "/me/trips", "/reviews_v2", "/probe"])(
    "accepts the literal path %j",
    (path) => {
      const mount = createMountProtected(passThrough);
      expect(() => mount(Router(), path, Router())).not.toThrow();
    },
  );
});
