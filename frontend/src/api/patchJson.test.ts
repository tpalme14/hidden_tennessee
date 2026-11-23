import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, patchJson } from "./client";

/** M04-T03 Increment 1 — the JSON PATCH helper shares the client's request defaults and error mapping. */

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

describe("patchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a JSON PATCH in cors mode with same-origin credentials and returns status and body", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "x" }),
    });

    await expect(patchJson("/api/v1/reviews/x", { rating: 4, body: null })).resolves.toEqual({
      status: 200,
      body: { id: "x" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/reviews/x");
    expect(init).toMatchObject({ method: "PATCH", mode: "cors", credentials: "same-origin" });
    expect(init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(init.body).toBe('{"rating":4,"body":null}');
  });

  it("keeps an omitted key omitted and an explicit null as null in the JSON body", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });
    await patchJson("/x", { rating: 2 });
    await patchJson("/x", { body: null });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBe('{"rating":2}');
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].body).toBe('{"body":null}');
  });

  it("maps the application error envelope, keeping status and code", async () => {
    stubFetch({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: "NOT_FOUND", message: "Resource not found." } }),
    });
    await expect(patchJson("/x", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "NOT_FOUND",
      message: "Resource not found.",
    });
  });

  it("keeps Retry-After on a 429 RATE_LIMITED envelope", async () => {
    stubFetch({
      ok: false,
      status: 429,
      headers: { "Retry-After": "45" },
      json: () =>
        Promise.resolve({
          error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
        }),
    });
    const error = await patchJson("/x", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).retryAfterSeconds).toBe(45);
  });

  it("a network failure is NETWORK_ERROR; a non-JSON body is INVALID_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(patchJson("/x", {})).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });

    stubFetch({ ok: false, status: 413, json: () => Promise.reject(new SyntaxError("HTML")) });
    await expect(patchJson("/x", {})).rejects.toMatchObject({
      status: 413,
      code: "INVALID_RESPONSE",
    });
  });
});
