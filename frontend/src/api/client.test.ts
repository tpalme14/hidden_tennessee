import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteJson,
  getJson,
  getPublicJson,
  patchJson,
  postJson,
  putJson,
  putJsonBody,
} from "./client";

function stubFetchResolved(partial: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(partial as unknown as Response));
}

describe("getJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed body on a successful response", async () => {
    stubFetchResolved({ ok: true, status: 200, json: () => Promise.resolve({ hello: "world" }) });

    await expect(getJson("/api/v1/whatever")).resolves.toEqual({ hello: "world" });
  });

  it("throws an ApiError built from the backend's error envelope on a non-2xx response", async () => {
    stubFetchResolved({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { code: "INVALID_QUERY", message: "Bad input." } }),
    });

    await expect(getJson("/api/v1/whatever")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "INVALID_QUERY",
      message: "Bad input.",
    });
  });

  it("falls back to a safe generic code/message when the error body is malformed", async () => {
    stubFetchResolved({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await expect(getJson("/api/v1/whatever")).rejects.toMatchObject({
      status: 500,
      code: "UNKNOWN_ERROR",
    });
  });

  it("throws a network ApiError when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(getJson("/api/v1/whatever")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("throws an ApiError when the response body isn't valid JSON", async () => {
    stubFetchResolved({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    await expect(getJson("/api/v1/whatever")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

/**
 * M05-T06 Increment 1 (decision D5) — the opt-in public GET: no credentials
 * and no header but `Accept`, with getJson's parsing and error mapping; the
 * authenticated helpers keep `credentials: "same-origin"`.
 */
describe("getPublicJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stub(partial: { ok: boolean; status: number; json: () => Promise<unknown> }) {
    const fetchMock = vi.fn().mockResolvedValue({
      headers: new Headers({ "Retry-After": "9" }),
      ...partial,
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("GETs with credentials omitted and only an Accept header, returning the parsed body", async () => {
    const fetchMock = stub({ ok: true, status: 200, json: () => Promise.resolve({ a: 1 }) });
    await expect(getPublicJson("/api/v1/public")).resolves.toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/public");
    expect(init.credentials).toBe("omit");
    expect(init.mode).toBe("cors");
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(Object.keys(init).sort()).toEqual(["credentials", "headers", "mode"]);
  });

  it("maps errors exactly as getJson does, including Retry-After, and never retries", async () => {
    const fetchMock = stub({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: { code: "RATE_LIMITED", message: "Slow down." } }),
    });
    await expect(getPublicJson("/api/v1/public")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 9,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stub({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("x")) });
    await expect(getPublicJson("/api/v1/public")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(getPublicJson("/api/v1/public")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("leaves the authenticated helpers on credentials: same-origin", async () => {
    const fetchMock = stub({ ok: true, status: 200, json: () => Promise.resolve({}) });
    await getJson("/api/v1/a");
    await postJson("/api/v1/b", {});
    await patchJson("/api/v1/c", {});
    await putJson("/api/v1/d");
    await putJsonBody("/api/v1/e", {});
    await deleteJson("/api/v1/f");
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init.credentials).toBe("same-origin");
      expect(init.mode).toBe("cors");
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
