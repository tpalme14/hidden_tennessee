import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, deleteJson, putJson } from "./client";

/** M03-T06 Increment 1 — the body-less PUT/DELETE helpers share the client's request defaults and error mapping. */

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

describe.each([
  ["putJson", putJson, "PUT"],
  ["deleteJson", deleteJson, "DELETE"],
] as const)("%s", (_name, send, method) => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(`sends a body-less ${method} in cors mode with same-origin credentials and returns status and body`, async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ success: true }),
    });

    await expect(send("/api/v1/favorites/x")).resolves.toEqual({
      status: 201,
      body: { success: true },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/favorites/x");
    expect(init).toMatchObject({ method, mode: "cors", credentials: "same-origin" });
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: "application/json" });
  });

  it("maps the application error envelope, keeping status and code", async () => {
    stubFetch({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." },
        }),
    });

    await expect(send("/x")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "INVALID_ORIGIN",
      message: "Request origin not allowed.",
    });
  });

  it("keeps Retry-After on a 429 RATE_LIMITED envelope", async () => {
    stubFetch({
      ok: false,
      status: 429,
      headers: { "Retry-After": "17" },
      json: () =>
        Promise.resolve({
          error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
        }),
    });

    const error = await send("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMITED", retryAfterSeconds: 17 });
  });

  it("treats a non-JSON body (e.g. Express's HTML 400) as INVALID_RESPONSE with the real status", async () => {
    stubFetch({ ok: false, status: 400, json: () => Promise.reject(new SyntaxError("html")) });

    await expect(send("/x")).rejects.toMatchObject({ status: 400, code: "INVALID_RESPONSE" });
  });

  it("throws NETWORK_ERROR when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(send("/x")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});
