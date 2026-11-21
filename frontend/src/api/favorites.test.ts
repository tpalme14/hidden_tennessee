import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import {
  addFavorite,
  listFavorites,
  parseFavoritesPage,
  removeFavorite,
  type FavoriteEntry,
} from "./favorites";

/**
 * M03-T06 Increment 1 — the favorites API layer. Shapes mirror the M03-T05
 * contract exactly (backend favorites.integration.test.ts asserts the same
 * objects). Every test stubs `fetch`; no request leaves the process.
 */

const A = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const B = "4a3c9d2f-0b5e-4f70-9c8b-2d3e4f5a6b7c";
const C = "5b4dae30-1c6f-4081-ad9c-3e4f5a6b7c8d";

const AVAILABLE = {
  landmark_id: A,
  availability: "available",
  landmark: {
    id: A,
    display_name: "Public Falls",
    category: "falls",
    latitude: 35.6,
    longitude: -83.5,
  },
};
const REDACTED = {
  landmark_id: B,
  availability: "redacted",
  landmark: { id: B, display_name: "Sensitive Falls", category: "falls", redacted: true },
};
const UNAVAILABLE = { landmark_id: C, availability: "unavailable" };

function page(favorites: unknown[], extra: Record<string, unknown> = {}) {
  return { favorites, page: 1, limit: 50, has_more: false, ...extra };
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listFavorites", () => {
  it("requests page 1 / limit 50 by default and returns all three entry types exactly", async () => {
    const fetchMock = stubFetch(200, page([AVAILABLE, REDACTED, UNAVAILABLE], { has_more: true }));

    const result = await listFavorites();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/favorites?page=1&limit=50");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      mode: "cors",
      credentials: "same-origin",
    });
    expect(result).toEqual({
      favorites: [AVAILABLE, REDACTED, UNAVAILABLE],
      page: 1,
      limit: 50,
      has_more: true,
    });
  });

  it("passes page and limit and accepts the maximum limit of 100", async () => {
    const fetchMock = stubFetch(200, page([], { page: 3, limit: 100 }));
    await expect(listFavorites({ page: 3, limit: 100 })).resolves.toEqual({
      favorites: [],
      page: 3,
      limit: 100,
      has_more: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/favorites?page=3&limit=100");
  });

  it.each([
    [{ page: 0 }],
    [{ page: 1.5 }],
    [{ limit: 0 }],
    [{ limit: 101 }],
    [{ limit: Number.NaN }],
  ])("rejects an invalid query %j before sending anything", async (query) => {
    const fetchMock = stubFetch(200, page([]));
    await expect(listFavorites(query)).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the server's error contract (401 UNAUTHENTICATED)", async () => {
    stubFetch(401, { error: { code: "UNAUTHENTICATED", message: "Authentication required." } });
    await expect(listFavorites()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });

  it("keeps Retry-After on 429", async () => {
    stubFetch(
      429,
      { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
      { "Retry-After": "30" },
    );
    await expect(listFavorites()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30 });
  });

  it("a malformed body is INVALID_RESPONSE, never a partial result", async () => {
    stubFetch(200, { favorites: "nope" });
    const error = await listFavorites().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: "INVALID_RESPONSE" });
  });
});

describe("parseFavoritesPage — envelope", () => {
  const expected = { page: 1, limit: 50 };

  it.each([
    ["null", null],
    ["an array", []],
    ["favorites missing", { page: 1, limit: 50, has_more: false }],
    ["has_more not boolean", page([], { has_more: "false" })],
    ["page not a positive integer", page([], { page: 0 })],
    ["limit not an integer", page([], { limit: "50" })],
    ["a page other than the one requested", page([], { page: 2 })],
    ["a limit other than the one requested", page([], { limit: 20 })],
    ["more entries than the limit", page([AVAILABLE, REDACTED], { limit: 1 })],
    ["the same landmark twice", page([AVAILABLE, AVAILABLE])],
  ])("rejects %s", (_label, raw) => {
    const query = _label === "more entries than the limit" ? { page: 1, limit: 1 } : expected;
    expect(parseFavoritesPage(raw, query)).toBeNull();
  });
});

describe("parseFavoritesPage — entries", () => {
  const parseOne = (entry: unknown): FavoriteEntry | null =>
    parseFavoritesPage(page([entry]), { page: 1, limit: 50 })?.favorites[0] ?? null;

  it("normalizes landmark IDs to lower case", () => {
    const upper = A.toUpperCase();
    expect(
      parseOne({
        ...AVAILABLE,
        landmark_id: upper,
        landmark: { ...AVAILABLE.landmark, id: upper },
      }),
    ).toEqual(AVAILABLE);
  });

  it("available: drops any field outside the public collection item (e.g. distance, source data)", () => {
    expect(
      parseOne({
        ...AVAILABLE,
        extra: "x",
        landmark: { ...AVAILABLE.landmark, distance_miles: 3, source_url: "https://example.com" },
      }),
    ).toEqual(AVAILABLE);
  });

  it("redacted: never carries coordinates, even if the response contained them", () => {
    const entry = parseOne({
      ...REDACTED,
      landmark: { ...REDACTED.landmark, latitude: 35.6, longitude: -83.5, source_url: "x" },
    });
    expect(entry).toEqual(REDACTED);
    expect(JSON.stringify(entry)).not.toMatch(/latitude|longitude|35\.6|source/);
  });

  it("unavailable: the landmark ID only — any name, category, or location is discarded", () => {
    const entry = parseOne({
      ...UNAVAILABLE,
      landmark: { id: C, display_name: "Retired Falls", category: "falls", latitude: 35.6 },
    });
    expect(entry).toEqual(UNAVAILABLE);
    expect(JSON.stringify(entry)).not.toMatch(/Retired|falls|35\.6/);
  });

  it("an unrecognised availability value fails closed to unavailable (ID only)", () => {
    expect(
      parseOne({ landmark_id: A, availability: "archived", landmark: AVAILABLE.landmark }),
    ).toEqual({ landmark_id: A, availability: "unavailable" });
  });

  it.each([
    ["not an object", "x"],
    ["landmark_id missing", { availability: "unavailable" }],
    ["landmark_id not a UUID", { landmark_id: "ARC001", availability: "unavailable" }],
    ["availability missing", { landmark_id: A }],
    ["availability not a string", { landmark_id: A, availability: 1 }],
    ["available without landmark", { landmark_id: A, availability: "available" }],
    [
      "available with a mismatched landmark.id",
      { ...AVAILABLE, landmark: { ...AVAILABLE.landmark, id: B } },
    ],
    [
      "available without coordinates",
      { ...AVAILABLE, landmark: { id: A, display_name: "X", category: "falls" } },
    ],
    [
      "available with an out-of-range latitude",
      { ...AVAILABLE, landmark: { ...AVAILABLE.landmark, latitude: 91 } },
    ],
    [
      "available with a non-finite longitude",
      { ...AVAILABLE, landmark: { ...AVAILABLE.landmark, longitude: Number.POSITIVE_INFINITY } },
    ],
    [
      "available with an empty display_name",
      { ...AVAILABLE, landmark: { ...AVAILABLE.landmark, display_name: "" } },
    ],
    [
      "redacted without redacted: true",
      { ...REDACTED, landmark: { id: B, display_name: "X", category: "falls" } },
    ],
    [
      "redacted with a missing category",
      { ...REDACTED, landmark: { id: B, display_name: "X", redacted: true } },
    ],
  ])("a malformed entry (%s) fails the whole page", (_label, entry) => {
    expect(parseFavoritesPage(page([AVAILABLE, entry]), { page: 1, limit: 50 })).toBeNull();
  });
});

describe("addFavorite", () => {
  it("201 → created: true; sends a body-less PUT to the encoded path", async () => {
    const fetchMock = stubFetch(201, { success: true, landmark_id: A });
    await expect(addFavorite(A)).resolves.toEqual({ landmarkId: A, created: true });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/favorites/${A}`);
    expect(init).toMatchObject({ method: "PUT", mode: "cors", credentials: "same-origin" });
    expect(init.body).toBeUndefined();
  });

  it("200 → created: false (already saved)", async () => {
    stubFetch(200, { success: true, landmark_id: A });
    await expect(addFavorite(A)).resolves.toEqual({ landmarkId: A, created: false });
  });

  it("an upper-case request is confirmed by the server's lower-case landmark_id", async () => {
    stubFetch(201, { success: true, landmark_id: A });
    await expect(addFavorite(A.toUpperCase())).resolves.toEqual({ landmarkId: A, created: true });
  });

  it("encodes the path segment, so an ID can never change the request path", async () => {
    const fetchMock = stubFetch(400, {
      error: { code: "INVALID_REQUEST", message: "Invalid landmark ID." },
    });
    await expect(addFavorite("../landmarks?x=1")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/favorites/..%2Flandmarks%3Fx%3D1");
  });

  it.each([
    ["success missing", { landmark_id: A }],
    ["success false", { success: false, landmark_id: A }],
    ["a different landmark_id", { success: true, landmark_id: B }],
    ["landmark_id not a UUID", { success: true, landmark_id: "x" }],
    ["not an object", "ok"],
  ])("a 2xx body with %s is INVALID_RESPONSE", async (_label, body) => {
    stubFetch(201, body);
    await expect(addFavorite(A)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("a success status other than 200/201 (202) is INVALID_RESPONSE", async () => {
    stubFetch(202, { success: true, landmark_id: A });
    await expect(addFavorite(A)).rejects.toMatchObject({ status: 202, code: "INVALID_RESPONSE" });
  });

  it("404 NOT_FOUND (not saveable) keeps the server's error contract", async () => {
    stubFetch(404, { error: { code: "NOT_FOUND", message: "Resource not found." } });
    await expect(addFavorite(A)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("removeFavorite", () => {
  it("200 → confirmed; sends a body-less DELETE", async () => {
    const fetchMock = stubFetch(200, { success: true, landmark_id: A });
    await expect(removeFavorite(A)).resolves.toEqual({ landmarkId: A });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/favorites/${A}`);
    expect(init).toMatchObject({ method: "DELETE" });
    expect(init.body).toBeUndefined();
  });

  it("201 from a DELETE is INVALID_RESPONSE", async () => {
    stubFetch(201, { success: true, landmark_id: A });
    await expect(removeFavorite(A)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("a body naming a different landmark is INVALID_RESPONSE", async () => {
    stubFetch(200, { success: true, landmark_id: B });
    await expect(removeFavorite(A)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    [401, "UNAUTHENTICATED", "Authentication required."],
    [403, "INVALID_ORIGIN", "Request origin not allowed."],
    [500, "INTERNAL_ERROR", "Something went wrong. Please try again."],
  ])("keeps the server's %i %s error", async (status, code, message) => {
    stubFetch(status, { error: { code, message } });
    await expect(removeFavorite(A)).rejects.toMatchObject({ status, code, message });
  });
});
