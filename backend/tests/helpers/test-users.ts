import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";

/**
 * Two-user test helpers (M03-T04 Increment 3; ADR-012 decision 10).
 *
 * Every user is created through the application's REAL authentication
 * endpoints — registration, sign-in, and the session endpoint — so tests
 * exercise exactly the rows, cookies, and session validation the app itself
 * produces. Intended for ownership tests of account-scoped resources
 * (favorites in M03-T05, then reviews and trips): create two users, then act
 * as each with `asUser`.
 *
 * Isolation: these helpers never touch the database directly and never clean
 * up; each test file keeps its own `resetTestDatabase()` calls, as every
 * integration file already does (files run sequentially). Emails are unique
 * per call, so users never collide within a file even between resets.
 *
 * Requires an app with Better Auth mounted and its rate limiter off (the
 * default outside production). Failures throw `TestUserSetupError`, naming
 * only the failed step and the HTTP status — never a credential, cookie,
 * token, address, or request/response object.
 */

export const TEST_ORIGIN = "http://localhost:3000";
/** Test-only password used for every helper-created account. Not a secret. */
export const TEST_PASSWORD = "test-only-password-not-a-secret";

const SESSION_COOKIE_NAMES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export interface TestUser {
  /** Unique, lower-case address of the account. */
  email: string;
  /** The user ID as reported by the server's own session endpoint. */
  userId: string;
  /** `name=value` of the session cookie, ready for a `Cookie` header. */
  cookie: string;
}

type Step = "registration" | "sign-in" | "session check" | "sign-out";

/** A helper step failed. The message names the step and status only. */
export class TestUserSetupError extends Error {
  constructor(step: Step, label: string, status: number | "no response") {
    super(
      `${step} for ${label} failed with ${status === "no response" ? "no response" : `HTTP ${status}`}`,
    );
    this.name = "TestUserSetupError";
  }
}

let counter = 0;

/** A unique, lower-case test address carrying a readable label, e.g. `user-a-3-1a2b3c4d@example.com`. */
export function uniqueTestEmail(label: string): string {
  counter += 1;
  const safe = label.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "user";
  return `${safe}-${counter}-${randomUUID().slice(0, 8)}@example.com`;
}

/**
 * The session cookie (`name=value`, attributes dropped) from `Set-Cookie`
 * headers, accepting the plain and `__Secure-` names. Null when none is set;
 * throws when more than one is set, since that would be ambiguous.
 */
export function sessionCookieFrom(setCookie: readonly string[] | undefined): string | null {
  const found = (setCookie ?? [])
    .map((header) => header.split(";")[0]!.trim())
    .filter((pair) => SESSION_COOKIE_NAMES.includes(pair.slice(0, pair.indexOf("="))));
  if (found.length > 1) throw new Error("more than one session cookie was set");
  return found[0] ?? null;
}

type Method = "get" | "post" | "put" | "patch" | "delete";
type Pending = ReturnType<ReturnType<typeof request>["get"]>;

export interface RequestBuilder {
  get(path: string): Pending;
  post(path: string): Pending;
  put(path: string): Pending;
  patch(path: string): Pending;
  delete(path: string): Pending;
}

function builder(app: Express, cookie?: string): RequestBuilder {
  const make = (method: Method) => (path: string) => {
    const pending = request(app)[method](path).set("Origin", TEST_ORIGIN);
    return cookie ? pending.set("Cookie", cookie) : pending;
  };
  return {
    get: make("get"),
    post: make("post"),
    put: make("put"),
    patch: make("patch"),
    delete: make("delete"),
  };
}

/** Requests as `user`: its session cookie and the trusted Origin are preset, so writes pass the CSRF check. */
export function asUser(app: Express, user: TestUser): RequestBuilder {
  return builder(app, user.cookie);
}

/** Requests with no session; the trusted Origin is preset. */
export function anonymous(app: Express): RequestBuilder {
  return builder(app);
}

/** Runs one request; a transport failure becomes a step error with no detail attached. */
async function attempt(step: Step, label: string, run: () => Pending) {
  try {
    return await run();
  } catch {
    throw new TestUserSetupError(step, label, "no response");
  }
}

/** Registers and signs in one new user through the real endpoints of `app`. */
export async function createSignedInUser(app: Express, label = "user"): Promise<TestUser> {
  const email = uniqueTestEmail(label);

  const registration = await attempt("registration", label, () =>
    anonymous(app)
      .post("/api/auth/sign-up/email")
      .send({ name: "", email, password: TEST_PASSWORD }),
  );
  if (registration.status !== 200) {
    throw new TestUserSetupError("registration", label, registration.status);
  }

  const signIn = await attempt("sign-in", label, () =>
    anonymous(app).post("/api/auth/sign-in/email").send({ email, password: TEST_PASSWORD }),
  );
  const cookie =
    signIn.status === 200
      ? sessionCookieFrom(signIn.headers["set-cookie"] as unknown as string[] | undefined)
      : null;
  if (cookie === null) throw new TestUserSetupError("sign-in", label, signIn.status);

  const session = await attempt("session check", label, () =>
    builder(app, cookie).get("/api/auth/get-session"),
  );
  const userId = (session.body as { user?: { id?: unknown } } | null)?.user?.id;
  if (session.status !== 200 || typeof userId !== "string") {
    throw new TestUserSetupError("session check", label, session.status);
  }

  return { email, userId, cookie };
}

/** Two independent users, created one after the other. */
export async function createTwoUsers(
  app: Express,
  labels: [string, string] = ["user-a", "user-b"],
): Promise<[TestUser, TestUser]> {
  const first = await createSignedInUser(app, labels[0]);
  const second = await createSignedInUser(app, labels[1]);
  return [first, second];
}

/** Signs `user` out through the real endpoint; resolves only on `{ success: true }`. */
export async function signOut(app: Express, user: TestUser, label = "user"): Promise<void> {
  const response = await attempt("sign-out", label, () =>
    asUser(app, user).post("/api/auth/sign-out").send({}),
  );
  if (response.status !== 200 || (response.body as { success?: unknown })?.success !== true) {
    throw new TestUserSetupError("sign-out", label, response.status);
  }
}
