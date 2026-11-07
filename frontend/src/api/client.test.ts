import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson } from "./client";

function stubFetchResolved(partial: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(partial as unknown as Response),
  );
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
