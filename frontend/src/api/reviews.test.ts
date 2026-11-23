import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import {
  COMMUNITY_MEMBER,
  REVIEW_ALREADY_EXISTS,
  createReview,
  deleteReview,
  getOwnReview,
  listLandmarkReviews,
  parseLandmarkReviewsPage,
  parseReview,
  updateReview,
} from "./reviews";

/**
 * M04-T03 Increment 1 — the reviews API layer. Shapes mirror the M04-T02
 * contract exactly (backend tests/reviews.integration.test.ts asserts the same
 * objects). Every test stubs `fetch`; no request leaves the process.
 */

const L = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const R1 = "4a3c9d2f-0b5e-4f70-9c8b-2d3e4f5a6b7c";
const R2 = "5b4dae30-1c6f-4081-ad9c-3e4f5a6b7c8d";

const REVIEW = {
  id: R1,
  rating: 4,
  body: "Lovely falls.\nWorth the walk.",
  created_at: "2026-11-21T16:31:04.123Z",
  updated_at: "2026-11-22T08:00:00.000Z",
  author_label: "Community Member",
};
const RATING_ONLY = { ...REVIEW, id: R2, rating: 2, body: null };

function listBody(reviews: unknown[], extra: Record<string, unknown> = {}) {
  return {
    reviews,
    aggregate: { average_rating: 3, rating_count: 2 },
    page: 1,
    limit: 20,
    has_more: false,
    ...extra,
  };
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

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseReview", () => {
  it("accepts a review with text and a rating-only review, exactly", () => {
    expect(parseReview(REVIEW)).toEqual(REVIEW);
    expect(parseReview(RATING_ONLY)).toEqual(RATING_ONLY);
  });

  it("drops every field outside the six approved ones (user IDs, emails, landmark data)", () => {
    const leaky = {
      ...REVIEW,
      user_id: L,
      email: "someone@example.com",
      landmark_id: L,
      is_own_review: true,
      display_name: "Hidden Falls",
    };
    const parsed = parseReview(leaky);
    expect(parsed).toEqual(REVIEW);
    expect(Object.keys(parsed!).sort()).toEqual(
      ["author_label", "body", "created_at", "id", "rating", "updated_at"].sort(),
    );
  });

  it("normalizes the ID to lower case and keeps text verbatim (no HTML interpretation)", () => {
    const html = { ...REVIEW, id: R1.toUpperCase(), body: "<script>alert(1)</script>" };
    expect(parseReview(html)).toEqual({ ...REVIEW, body: "<script>alert(1)</script>" });
  });

  it.each([
    ["not an object", "review"],
    ["null", null],
    ["an array", [REVIEW]],
    ["a malformed id", { ...REVIEW, id: "nope" }],
    ["a missing id", { ...REVIEW, id: undefined }],
    ["rating 0", { ...REVIEW, rating: 0 }],
    ["rating 6", { ...REVIEW, rating: 6 }],
    ["a fractional rating", { ...REVIEW, rating: 4.5 }],
    ["a string rating", { ...REVIEW, rating: "4" }],
    ["an empty body", { ...REVIEW, body: "" }],
    ["a numeric body", { ...REVIEW, body: 7 }],
    ["a body over 2,000 code points", { ...REVIEW, body: "a".repeat(2001) }],
    ["a missing body key", (({ body: _b, ...rest }) => rest)(REVIEW)],
    ["a timestamp without milliseconds", { ...REVIEW, created_at: "2026-11-21T16:31:04Z" }],
    ["a non-UTC timestamp", { ...REVIEW, updated_at: "2026-11-21T16:31:04.123+01:00" }],
    ["an impossible date", { ...REVIEW, created_at: "2026-13-45T25:61:61.000Z" }],
    ["a different author label", { ...REVIEW, author_label: "jane@example.com" }],
    ["a missing author label", { ...REVIEW, author_label: undefined }],
  ])("rejects %s", (_label, raw) => {
    expect(parseReview(raw)).toBeNull();
  });

  it("accepts exactly 2,000 non-BMP code points in a body", () => {
    const body = "\u{1F332}".repeat(2000);
    expect(parseReview({ ...REVIEW, body })?.body).toBe(body);
  });
});

describe("parseLandmarkReviewsPage", () => {
  const expected = { page: 1, limit: 20 };

  it("accepts a page and rebuilds every review", () => {
    expect(
      parseLandmarkReviewsPage(listBody([{ ...REVIEW, user_id: L }, RATING_ONLY]), expected),
    ).toEqual({
      reviews: [REVIEW, RATING_ONLY],
      aggregate: { average_rating: 3, rating_count: 2 },
      page: 1,
      limit: 20,
      has_more: false,
    });
  });

  it("accepts the empty state: no reviews, count 0, average null", () => {
    expect(
      parseLandmarkReviewsPage(
        listBody([], { aggregate: { average_rating: null, rating_count: 0 } }),
        expected,
      ),
    ).toEqual({
      reviews: [],
      aggregate: { average_rating: null, rating_count: 0 },
      page: 1,
      limit: 20,
      has_more: false,
    });
  });

  it("keeps the unrounded average exactly", () => {
    const parsed = parseLandmarkReviewsPage(
      listBody([REVIEW], { aggregate: { average_rating: 13 / 3, rating_count: 3 } }),
      expected,
    );
    expect(parsed?.aggregate.average_rating).toBe(13 / 3);
  });

  it.each([
    ["not an object", []],
    ["reviews not an array", listBody([], { reviews: {} })],
    ["has_more not boolean", listBody([], { has_more: "no" })],
    ["a different page", listBody([], { page: 2 })],
    ["a different limit", listBody([], { limit: 50 })],
    ["more reviews than the limit", listBody([REVIEW, RATING_ONLY], { limit: 1 })],
    ["a malformed review", listBody([REVIEW, { ...RATING_ONLY, rating: 9 }])],
    ["a duplicate review ID", listBody([REVIEW, REVIEW])],
    ["a missing aggregate", listBody([], { aggregate: undefined })],
    [
      "count 0 with an average",
      listBody([], { aggregate: { average_rating: 4, rating_count: 0 } }),
    ],
    [
      "a count with a null average",
      listBody([], { aggregate: { average_rating: null, rating_count: 2 } }),
    ],
    ["an average below 1", listBody([], { aggregate: { average_rating: 0.5, rating_count: 2 } })],
    ["an average above 5", listBody([], { aggregate: { average_rating: 5.5, rating_count: 2 } })],
    ["a negative count", listBody([], { aggregate: { average_rating: null, rating_count: -1 } })],
    ["a fractional count", listBody([], { aggregate: { average_rating: 3, rating_count: 2.5 } })],
    [
      "more reviews than the count",
      listBody([REVIEW, RATING_ONLY], { aggregate: { average_rating: 3, rating_count: 1 } }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseLandmarkReviewsPage(raw, expected)).toBeNull();
  });
});

describe("listLandmarkReviews", () => {
  it("requests page 1 / limit 20 by default from the encoded landmark path", async () => {
    const fetchMock = stubFetch(200, listBody([REVIEW, RATING_ONLY], { has_more: true }));
    const result = await listLandmarkReviews(L);
    expect(result.reviews).toEqual([REVIEW, RATING_ONLY]);
    expect(result.has_more).toBe(true);
    const [path, init] = lastCall(fetchMock);
    expect(path).toBe(`/api/v1/landmarks/${L}/reviews?page=1&limit=20`);
    expect(init.method).toBeUndefined();
    expect(init).toMatchObject({ mode: "cors", credentials: "same-origin" });
  });

  it("passes page and limit and accepts the maximum limit of 100", async () => {
    const fetchMock = stubFetch(
      200,
      listBody([], { page: 3, limit: 100, aggregate: { average_rating: 4, rating_count: 1 } }),
    );
    await listLandmarkReviews(L, { page: 3, limit: 100 });
    expect(lastCall(fetchMock)[0]).toBe(`/api/v1/landmarks/${L}/reviews?page=3&limit=100`);
  });

  it("encodes the landmark segment, so an ID can never change the request path", async () => {
    const fetchMock = stubFetch(200, listBody([]));
    await listLandmarkReviews("../favorites?x=1").catch(() => undefined);
    expect(lastCall(fetchMock)[0]).toBe(
      "/api/v1/landmarks/..%2Ffavorites%3Fx%3D1/reviews?page=1&limit=20",
    );
  });

  it.each([[{ page: 0 }], [{ page: 1.5 }], [{ limit: 0 }], [{ limit: 101 }]])(
    "rejects an invalid query %j before any request",
    async (query) => {
      const fetchMock = stubFetch(200, listBody([]));
      await expect(listLandmarkReviews(L, query)).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("keeps the server's 404 NOT_FOUND for a missing or non-visible landmark", async () => {
    stubFetch(404, { error: { code: "NOT_FOUND", message: "Resource not found." } });
    const error = await rejection(listLandmarkReviews(L));
    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("keeps 400 INVALID_QUERY and INVALID_REQUEST as reported", async () => {
    stubFetch(400, { error: { code: "INVALID_REQUEST", message: "Invalid landmark ID." } });
    expect(await rejection(listLandmarkReviews("bad"))).toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
      message: "Invalid landmark ID.",
    });
  });

  it("a malformed body is INVALID_RESPONSE, never a partial result", async () => {
    stubFetch(200, listBody([REVIEW, { ...REVIEW, id: R2, author_label: "Jane" }]));
    expect(await rejection(listLandmarkReviews(L))).toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
  });

  it("an HTML error page (non-JSON) is INVALID_RESPONSE with the HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      } as unknown as Response),
    );
    expect(await rejection(listLandmarkReviews(L))).toMatchObject({
      status: 500,
      code: "INVALID_RESPONSE",
    });
  });

  it("a network failure is NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await rejection(listLandmarkReviews(L))).toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });
});

describe("getOwnReview", () => {
  it("returns the caller's own review, rebuilt, from the encoded lookup", async () => {
    const fetchMock = stubFetch(200, { review: { ...REVIEW, user_id: L } });
    await expect(getOwnReview(L)).resolves.toEqual(REVIEW);
    expect(lastCall(fetchMock)[0]).toBe(`/api/v1/reviews?landmark_id=${L}`);
  });

  it("returns null when the caller has no review", async () => {
    stubFetch(200, { review: null });
    await expect(getOwnReview(L)).resolves.toBeNull();
  });

  it("encodes the landmark ID as a query value", async () => {
    const fetchMock = stubFetch(200, { review: null });
    await getOwnReview("a&user_id=b");
    expect(lastCall(fetchMock)[0]).toBe("/api/v1/reviews?landmark_id=a%26user_id%3Db");
  });

  it.each([
    ["a missing review key", {}],
    ["a bare review object (not wrapped)", REVIEW],
    ["a malformed review", { review: { ...REVIEW, rating: 0 } }],
    ["not an object", "x"],
  ])("rejects %s as INVALID_RESPONSE", async (_label, body) => {
    stubFetch(200, body);
    expect(await rejection(getOwnReview(L))).toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    [401, "UNAUTHENTICATED", "Authentication required."],
    [404, "NOT_FOUND", "Resource not found."],
    [503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable."],
  ])("keeps %s %s", async (status, code, message) => {
    stubFetch(status, { error: { code, message } });
    expect(await rejection(getOwnReview(L))).toMatchObject({ status, code, message });
  });

  it("keeps Retry-After on 429", async () => {
    stubFetch(
      429,
      { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
      { "Retry-After": "60" },
    );
    expect(await rejection(getOwnReview(L))).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    });
  });
});

describe("createReview", () => {
  it("POSTs { landmark_id, rating, body } as JSON and returns the rebuilt review", async () => {
    const fetchMock = stubFetch(201, { ...REVIEW, user_id: L });
    await expect(createReview(L, { rating: 4, body: REVIEW.body })).resolves.toEqual(REVIEW);
    const [path, init] = lastCall(fetchMock);
    expect(path).toBe("/api/v1/reviews");
    expect(init).toMatchObject({ method: "POST", mode: "cors", credentials: "same-origin" });
    expect(JSON.parse(init.body as string)).toEqual({
      landmark_id: L,
      rating: 4,
      body: REVIEW.body,
    });
  });

  it("sends body: null for a rating-only review", async () => {
    const fetchMock = stubFetch(201, RATING_ONLY);
    await createReview(L, { rating: 2, body: null });
    expect(JSON.parse(lastCall(fetchMock)[1].body as string)).toEqual({
      landmark_id: L,
      rating: 2,
      body: null,
    });
  });

  it("keeps 409 REVIEW_ALREADY_EXISTS (no review ID in it)", async () => {
    stubFetch(409, {
      error: { code: REVIEW_ALREADY_EXISTS, message: "You have already reviewed this landmark." },
    });
    expect(await rejection(createReview(L, { rating: 3, body: null }))).toMatchObject({
      status: 409,
      code: "REVIEW_ALREADY_EXISTS",
      message: "You have already reviewed this landmark.",
    });
  });

  it.each([
    [400, "INVALID_REQUEST", "rating must be a whole number from 1 through 5."],
    [401, "UNAUTHENTICATED", "Authentication required."],
    [403, "INVALID_ORIGIN", "Request origin not allowed."],
    [404, "NOT_FOUND", "Resource not found."],
    [500, "INTERNAL_ERROR", "Something went wrong. Please try again."],
  ])("keeps %s %s", async (status, code, message) => {
    stubFetch(status, { error: { code, message } });
    expect(await rejection(createReview(L, { rating: 3, body: null }))).toMatchObject({
      status,
      code,
      message,
    });
  });

  it("a malformed created review is INVALID_RESPONSE", async () => {
    stubFetch(201, { success: true });
    expect(await rejection(createReview(L, { rating: 3, body: null }))).toMatchObject({
      status: 201,
      code: "INVALID_RESPONSE",
    });
  });
});

describe("updateReview", () => {
  it("PATCHes only the present keys to the encoded review path", async () => {
    const fetchMock = stubFetch(200, REVIEW);
    await expect(updateReview(R1, { rating: 4 })).resolves.toEqual(REVIEW);
    const [path, init] = lastCall(fetchMock);
    expect(path).toBe(`/api/v1/reviews/${R1}`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"rating":4}');

    await updateReview(R1, { body: null });
    expect(lastCall(fetchMock)[1].body).toBe('{"body":null}');

    await updateReview(R1, { rating: 5, body: "text" });
    expect(lastCall(fetchMock)[1].body).toBe('{"rating":5,"body":"text"}');
  });

  it("refuses an empty update before any request", async () => {
    const fetchMock = stubFetch(200, REVIEW);
    await expect(updateReview(R1, {})).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encodes the review segment", async () => {
    const fetchMock = stubFetch(404, {
      error: { code: "NOT_FOUND", message: "Resource not found." },
    });
    await updateReview("../favorites", { rating: 1 }).catch(() => undefined);
    expect(lastCall(fetchMock)[0]).toBe("/api/v1/reviews/..%2Ffavorites");
  });

  it("accepts an upper-case request ID confirmed by the server's lower-case ID", async () => {
    stubFetch(200, REVIEW);
    await expect(updateReview(R1.toUpperCase(), { rating: 4 })).resolves.toEqual(REVIEW);
  });

  it.each([
    ["a different review", 200, { ...REVIEW, id: R2 }],
    ["a malformed review", 200, { ...REVIEW, rating: 9 }],
    ["an unexpected success status (201)", 201, REVIEW],
  ])("rejects %s as INVALID_RESPONSE", async (_label, status, body) => {
    stubFetch(status, body);
    expect(await rejection(updateReview(R1, { rating: 4 }))).toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("keeps 404 (missing, another user's, or a non-visible landmark) and 429 with Retry-After", async () => {
    stubFetch(404, { error: { code: "NOT_FOUND", message: "Resource not found." } });
    expect(await rejection(updateReview(R1, { rating: 4 }))).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    stubFetch(
      429,
      { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
      { "Retry-After": "45" },
    );
    expect(await rejection(updateReview(R1, { rating: 4 }))).toMatchObject({
      status: 429,
      retryAfterSeconds: 45,
    });
  });
});

describe("deleteReview", () => {
  it("sends a body-less DELETE to the encoded review path and resolves on { success: true }", async () => {
    const fetchMock = stubFetch(200, { success: true });
    await expect(deleteReview(R1)).resolves.toBeUndefined();
    const [path, init] = lastCall(fetchMock);
    expect(path).toBe(`/api/v1/reviews/${R1}`);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it.each([
    ["success false", 200, { success: false }],
    ["a missing success flag", 200, {}],
    ["an unexpected status (204-like 202)", 202, { success: true }],
  ])("rejects %s as INVALID_RESPONSE", async (_label, status, body) => {
    stubFetch(status, body);
    expect(await rejection(deleteReview(R1))).toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("keeps 404 for a repeated delete or another user's review", async () => {
    stubFetch(404, { error: { code: "NOT_FOUND", message: "Resource not found." } });
    expect(await rejection(deleteReview(R1))).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("constants", () => {
  it("exposes the fixed label and the 409 code", () => {
    expect(COMMUNITY_MEMBER).toBe("Community Member");
    expect(REVIEW_ALREADY_EXISTS).toBe("REVIEW_ALREADY_EXISTS");
  });
});
