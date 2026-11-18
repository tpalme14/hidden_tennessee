import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSession,
  register,
  requestPasswordReset,
  resetPassword,
  signIn,
  signOut,
  type AuthUser,
} from "./auth";
import { ApiError } from "./client";

/** M03-T03 Increment 1 — the auth API wrappers against the verified M03-T02 contracts. */

const USER: AuthUser = {
  id: "3f2e1d0c-1111-4222-8333-444455556666",
  name: "",
  email: "hiker@example.com",
  emailVerified: false,
  image: null,
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

function sentPath(fetchMock: ReturnType<typeof vi.fn>): string {
  return (fetchMock.mock.calls[0] as [string, RequestInit])[0];
}

describe("auth API wrappers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("register posts email, password, and the required empty name, and returns the user", async () => {
    const fetchMock = stubFetch(200, { token: null, user: USER });

    await expect(register("Hiker@Example.com", "correct-horse-battery")).resolves.toEqual(USER);

    expect(sentPath(fetchMock)).toBe("/api/auth/sign-up/email");
    expect(sentBody(fetchMock)).toEqual({
      name: "",
      email: "Hiker@Example.com",
      password: "correct-horse-battery",
    });
  });

  it("register rejects an unexpected success body instead of returning garbage", async () => {
    stubFetch(200, { token: null });
    await expect(register("a@b.co", "correct-horse-battery")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("signIn posts the credentials and returns the user", async () => {
    const fetchMock = stubFetch(200, { redirect: false, token: "t", user: USER });

    await expect(signIn("hiker@example.com", "correct-horse-battery")).resolves.toEqual(USER);
    expect(sentPath(fetchMock)).toBe("/api/auth/sign-in/email");
    expect(sentBody(fetchMock)).toEqual({
      email: "hiker@example.com",
      password: "correct-horse-battery",
    });
  });

  it("signIn surfaces the backend's generic 401 unchanged", async () => {
    stubFetch(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });

    await expect(signIn("hiker@example.com", "wrong")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_EMAIL_OR_PASSWORD",
    });
  });

  it("signIn surfaces a 429 with its retry hint", async () => {
    stubFetch(
      429,
      { message: "Too many requests. Please try again later." },
      { "X-Retry-After": "30" },
    );

    await expect(signIn("hiker@example.com", "x")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
    });
  });

  it("getSession returns null for no session and the { session, user } pair otherwise", async () => {
    stubFetch(200, null);
    await expect(getSession()).resolves.toBeNull();

    const session = { id: "s1", userId: USER.id, expiresAt: "x", createdAt: "x", updatedAt: "x" };
    const fetchMock = stubFetch(200, { session, user: USER });
    await expect(getSession()).resolves.toEqual({ session, user: USER });
    expect(sentPath(fetchMock)).toBe("/api/auth/get-session");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBeUndefined(); // GET
  });

  it("getSession rejects a malformed body rather than treating it as signed in", async () => {
    stubFetch(200, { user: { nope: true } });
    await expect(getSession()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("signOut resolves only on a confirmed { success: true }", async () => {
    const fetchMock = stubFetch(200, { success: true });
    await expect(signOut()).resolves.toBeUndefined();
    expect(sentPath(fetchMock)).toBe("/api/auth/sign-out");
    expect(sentBody(fetchMock)).toEqual({});

    stubFetch(200, { success: false });
    await expect(signOut()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    stubFetch(200, {});
    await expect(signOut()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("signOut surfaces a CSRF or infrastructure failure instead of pretending success", async () => {
    stubFetch(403, { code: "INVALID_ORIGIN", message: "Invalid origin" });
    await expect(signOut()).rejects.toMatchObject({ status: 403, code: "INVALID_ORIGIN" });

    stubFetch(503, {
      error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." },
    });
    await expect(signOut()).rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
  });

  it("requestPasswordReset sends only the email and resolves on the neutral body", async () => {
    const fetchMock = stubFetch(200, {
      status: true,
      message: "If this email exists in our system, check your email for the reset link",
    });

    await expect(requestPasswordReset("hiker@example.com")).resolves.toBeUndefined();
    expect(sentPath(fetchMock)).toBe("/api/auth/request-password-reset");
    expect(sentBody(fetchMock)).toEqual({ email: "hiker@example.com" });
  });

  it("requestPasswordReset surfaces the readiness 503 with its code", async () => {
    stubFetch(503, {
      code: "RESET_UNAVAILABLE",
      message: "Password reset is temporarily unavailable. Please try again later.",
    });
    await expect(requestPasswordReset("hiker@example.com")).rejects.toMatchObject({
      status: 503,
      code: "RESET_UNAVAILABLE",
    });
  });

  it("resetPassword sends the token in the body only and resolves on { status: true }", async () => {
    const fetchMock = stubFetch(200, { status: true });

    await expect(resetPassword("tok3n", "a-brand-new-password")).resolves.toBeUndefined();
    expect(sentPath(fetchMock)).toBe("/api/auth/reset-password");
    expect(sentPath(fetchMock)).not.toContain("tok3n");
    expect(sentBody(fetchMock)).toEqual({ token: "tok3n", newPassword: "a-brand-new-password" });
  });

  it("resetPassword surfaces INVALID_TOKEN and policy errors, and rejects an unconfirmed success", async () => {
    stubFetch(400, { code: "INVALID_TOKEN", message: "Invalid token" });
    await expect(resetPassword("x", "a-brand-new-password")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_TOKEN",
    });

    stubFetch(400, { code: "PASSWORD_TOO_SHORT", message: "Password too short" });
    await expect(resetPassword("x", "short")).rejects.toMatchObject({ code: "PASSWORD_TOO_SHORT" });

    stubFetch(200, { status: false });
    const error = await resetPassword("x", "a-brand-new-password").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
