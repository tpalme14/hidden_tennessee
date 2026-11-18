import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJson, postJson } from "./client";

/** M03-T03 Increment 1 — the JSON POST helper and the auth error shapes. */

function stubFetch(partial: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: Record<string, string>;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ...partial,
    headers: new Headers(partial.headers ?? {}),
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("postJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a JSON POST in cors mode with same-origin credentials and returns the parsed body", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: () => Promise.resolve({ ok: 1 }) });

    await expect(postJson("/api/auth/sign-in/email", { email: "a@b.co" })).resolves.toEqual({
      ok: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/auth/sign-in/email");
    expect(init).toMatchObject({
      method: "POST",
      mode: "cors",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.co" }),
    });
  });

  it("maps the application envelope { error: { code, message } } (e.g. the 503 wrapper)", async () => {
    stubFetch({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." },
        }),
    });

    await expect(postJson("/api/auth/sign-up/email", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Service temporarily unavailable.",
    });
  });

  it("maps Better Auth's flat { code, message } shape", async () => {
    stubFetch({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          code: "INVALID_EMAIL_OR_PASSWORD",
          message: "Invalid email or password",
        }),
    });

    await expect(postJson("/api/auth/sign-in/email", {})).rejects.toMatchObject({
      status: 401,
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    });
  });

  it("maps a 429 with only { message } to RATE_LIMITED and reads X-Retry-After in whole seconds", async () => {
    stubFetch({
      ok: false,
      status: 429,
      headers: { "X-Retry-After": "42" },
      json: () => Promise.resolve({ message: "Too many requests. Please try again later." }),
    });

    const error = await postJson("/api/auth/sign-in/email", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
      retryAfterSeconds: 42,
    });
  });

  it("also accepts the standard Retry-After header and rounds fractional seconds up", async () => {
    stubFetch({
      ok: false,
      status: 429,
      headers: { "Retry-After": "0.4" },
      json: () => Promise.resolve({ message: "slow down" }),
    });

    await expect(postJson("/x", {})).rejects.toMatchObject({ retryAfterSeconds: 1 });
  });

  it("leaves retryAfterSeconds undefined when the header is absent or not a number", async () => {
    stubFetch({
      ok: false,
      status: 429,
      headers: { "Retry-After": "soon" },
      json: () => Promise.resolve({ message: "slow down" }),
    });

    const error = (await postJson("/x", {}).catch((e: unknown) => e)) as ApiError;
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("falls back to safe generic values when an error body has neither shape", async () => {
    stubFetch({ ok: false, status: 500, json: () => Promise.resolve({ weird: true }) });

    await expect(postJson("/x", {})).rejects.toMatchObject({
      status: 500,
      code: "UNKNOWN_ERROR",
      message: "Something went wrong. Please try again.",
    });
  });

  it("treats a non-JSON body (e.g. a plain-text 404) as INVALID_RESPONSE with the real status", async () => {
    stubFetch({ ok: false, status: 404, json: () => Promise.reject(new SyntaxError("no json")) });

    await expect(postJson("/api/auth/update-user", {})).rejects.toMatchObject({
      status: 404,
      code: "INVALID_RESPONSE",
    });
  });

  it("treats a 2xx with a malformed body as INVALID_RESPONSE", async () => {
    stubFetch({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("no json")) });

    await expect(postJson("/x", {})).rejects.toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
  });

  it("throws a NETWORK_ERROR ApiError when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(postJson("/x", {})).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});

describe("getJson request options (unchanged behaviour, now explicit)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses cors mode and same-origin credentials so the session cookie reaches our own origin only", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: () => Promise.resolve(null) });

    await expect(getJson("/api/auth/get-session")).resolves.toBeNull();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init).toMatchObject({ mode: "cors", credentials: "same-origin" });
    expect(init.method).toBeUndefined();
  });
});
