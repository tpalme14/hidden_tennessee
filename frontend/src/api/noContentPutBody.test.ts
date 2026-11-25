import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, deleteNoContent, putJsonBody, requestNoContent } from "./client";

/**
 * M05-T04 Increment 1 — the `204 No Content` helpers and the body-carrying
 * PUT share the client's request defaults and error mapping. The existing
 * JSON helpers are covered, unchanged, by their own test files.
 */

function stubResponse(partial: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  headers?: Record<string, string>;
}) {
  const json = vi.fn(partial.json ?? (() => Promise.reject(new SyntaxError("no body"))));
  const fetchMock = vi.fn().mockResolvedValue({
    ok: partial.ok,
    status: partial.status,
    json,
    headers: new Headers(partial.headers ?? {}),
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, json };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deleteNoContent / requestNoContent", () => {
  it("sends a body-less DELETE in cors mode with same-origin credentials and resolves on 204 without reading a body", async () => {
    const { fetchMock, json } = stubResponse({ ok: true, status: 204 });

    await expect(deleteNoContent("/api/v1/trips/t/stops/s")).resolves.toBeUndefined();

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/trips/t/stops/s");
    expect(init).toMatchObject({ method: "DELETE", mode: "cors", credentials: "same-origin" });
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    ["no headers", {}],
    ["Content-Type: application/json", { "Content-Type": "application/json" }],
    [
      "Content-Type: text/html with a length",
      { "Content-Type": "text/html", "Content-Length": "9" },
    ],
    [
      "Cache-Control and X-Robots-Tag",
      { "Cache-Control": "private, no-store", "X-Robots-Tag": "x" },
    ],
  ])("accepts a 204 regardless of headers (%s)", async (_label, headers) => {
    const { json } = stubResponse({ ok: true, status: 204, headers });
    await expect(deleteNoContent("/x")).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it.each([200, 201, 202, 205])(
    "treats any other 2xx (%i) as INVALID_RESPONSE with its status",
    async (status) => {
      stubResponse({ ok: true, status, json: () => Promise.resolve({ success: true }) });
      await expect(deleteNoContent("/x")).rejects.toMatchObject({
        name: "ApiError",
        status,
        code: "INVALID_RESPONSE",
      });
    },
  );

  it("maps the application error envelope, keeping status, code, and message", async () => {
    stubResponse({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: "NOT_FOUND", message: "Resource not found." } }),
    });
    await expect(deleteNoContent("/x")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "Resource not found.",
    });
  });

  it("keeps Retry-After on a 429 RATE_LIMITED envelope", async () => {
    stubResponse({
      ok: false,
      status: 429,
      headers: { "Retry-After": "45" },
      json: () =>
        Promise.resolve({
          error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
        }),
    });
    const error = await deleteNoContent("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMITED", retryAfterSeconds: 45 });
  });

  it("treats a non-JSON error body (Express's HTML 400) as INVALID_RESPONSE with the real status", async () => {
    stubResponse({ ok: false, status: 400, json: () => Promise.reject(new SyntaxError("html")) });
    await expect(deleteNoContent("/x")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_RESPONSE",
    });
  });

  it("throws NETWORK_ERROR when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(deleteNoContent("/x")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("requestNoContent passes the caller's method and headers through with the same defaults", async () => {
    const { fetchMock } = stubResponse({ ok: true, status: 204 });
    await requestNoContent("/y", { method: "POST", headers: { Accept: "application/json" } });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      mode: "cors",
      credentials: "same-origin",
    });
  });
});

describe("putJsonBody", () => {
  it("sends the payload as JSON in cors mode with same-origin credentials and returns status and body", async () => {
    const { fetchMock } = stubResponse({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ trip: { id: "t" } }),
    });
    await expect(
      putJsonBody("/api/v1/trips/t/stops/order", { stop_ids: ["a"], version: 2 }),
    ).resolves.toEqual({
      status: 200,
      body: { trip: { id: "t" } },
    });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/trips/t/stops/order");
    expect(init).toMatchObject({ method: "PUT", mode: "cors", credentials: "same-origin" });
    expect(init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(init.body).toBe(JSON.stringify({ stop_ids: ["a"], version: 2 }));
  });

  it("maps errors exactly like the other JSON helpers", async () => {
    stubResponse({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          error: {
            code: "TRIP_VERSION_CONFLICT",
            message: "This trip has changed. Reload it and try again.",
          },
        }),
    });
    await expect(putJsonBody("/x", {})).rejects.toMatchObject({
      status: 409,
      code: "TRIP_VERSION_CONFLICT",
    });
    stubResponse({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("empty")) });
    await expect(putJsonBody("/x", {})).rejects.toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(putJsonBody("/x", {})).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
