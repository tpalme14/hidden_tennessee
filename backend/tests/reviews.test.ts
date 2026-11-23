import { describe, expect, it } from "vitest";
import type { ReviewRow } from "../src/reviews/repository.js";
import {
  MESSAGES,
  ReviewsRequestError,
  countCodePoints,
  normalizeReviewBody,
  parseCreateBody,
  parseEmptyBody,
  parseLandmarkId,
  parseListQuery,
  parseNoQuery,
  parseOwnReviewQuery,
  parsePatchBody,
  parseReviewId,
} from "../src/reviews/request-schema.js";
import {
  AUTHOR_LABEL,
  toCreateOutcome,
  toIsoTimestamp,
  toListOutcome,
  toRepresentation,
} from "../src/reviews/service.js";

/** Unit tests for M04-T02 Increment 2: request validation and service mapping. No database. */

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const NON_BMP = "\u{1F332}"; // 🌲 — one code point, two UTF-16 code units
const LONE_HIGH = "\uD83C";
const LONE_LOW = "\uDF32";

function expectRequestError(
  run: () => unknown,
  code: "INVALID_REQUEST" | "INVALID_QUERY",
  message?: string,
): ReviewsRequestError {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ReviewsRequestError);
  const error = caught as ReviewsRequestError;
  expect(error.code).toBe(code);
  if (message !== undefined) expect(error.message).toBe(message);
  return error;
}

describe("countCodePoints", () => {
  it("counts code points, not UTF-16 code units", () => {
    expect(countCodePoints("")).toBe(0);
    expect(countCodePoints("abc")).toBe(3);
    expect(NON_BMP.length).toBe(2);
    expect(countCodePoints(NON_BMP)).toBe(1);
    expect(countCodePoints("a\r\nb")).toBe(4);
  });
});

describe("normalizeReviewBody", () => {
  it("maps absent and null to null", () => {
    expect(normalizeReviewBody(undefined)).toBeNull();
    expect(normalizeReviewBody(null)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["tabs and newlines", "\t\n\r\n"],
    ["Unicode whitespace (NBSP, ideographic space, line separator, BOM)", " 　 ﻿"],
  ])("maps whitespace-only text (%s) to null", (_label, value) => {
    expect(normalizeReviewBody(value)).toBeNull();
  });

  it("trims leading and trailing whitespace and preserves internal newlines exactly", () => {
    expect(normalizeReviewBody("  line one\n\nline two\r\nline three \n")).toBe(
      "line one\n\nline two\r\nline three",
    );
  });

  it("preserves other valid Unicode without normalization", () => {
    const decomposed = "Café"; // e + combining acute — NOT normalized to U+00E9
    expect(normalizeReviewBody(decomposed)).toBe(decomposed);
    expect(normalizeReviewBody(`${NON_BMP} trail é`)).toBe(`${NON_BMP} trail é`);
    expect(normalizeReviewBody("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });

  it("accepts exactly 2,000 code points and rejects 2,001 (ASCII)", () => {
    expect(normalizeReviewBody("a".repeat(2000))).toBe("a".repeat(2000));
    expectRequestError(
      () => normalizeReviewBody("a".repeat(2001)),
      "INVALID_REQUEST",
      MESSAGES.bodyTooLong,
    );
  });

  it("counts non-BMP characters as one: 2,000 accepted (4,000 code units), 2,001 rejected", () => {
    const twoThousand = NON_BMP.repeat(2000);
    expect(twoThousand.length).toBe(4000);
    expect(normalizeReviewBody(twoThousand)).toBe(twoThousand);
    expectRequestError(
      () => normalizeReviewBody(NON_BMP.repeat(2001)),
      "INVALID_REQUEST",
      MESSAGES.bodyTooLong,
    );
  });

  it("applies the limit AFTER trimming", () => {
    const padded = `   ${"a".repeat(2000)}   `;
    expect(normalizeReviewBody(padded)).toBe("a".repeat(2000));
  });

  it.each([
    ["NUL inside text", "before\u0000after"],
    ["NUL only", "\u0000"],
    ["NUL at the edge (not trimmed away)", " \u0000"],
    ["a lone high surrogate", `ok ${LONE_HIGH} ok`],
    ["a lone low surrogate", `ok ${LONE_LOW} ok`],
    ["reversed surrogate pair", `${LONE_LOW}${LONE_HIGH}`],
    ["a lone surrogate at the end", `text${LONE_HIGH}`],
  ])("rejects %s with a fixed message", (_label, value) => {
    expectRequestError(
      () => normalizeReviewBody(value),
      "INVALID_REQUEST",
      MESSAGES.bodyCharacters,
    );
  });

  it("accepts a correctly paired surrogate (a valid non-BMP character)", () => {
    expect(normalizeReviewBody(`${LONE_HIGH}${LONE_LOW}`)).toBe(NON_BMP);
  });

  it.each([
    ["number", 5],
    ["boolean", true],
    ["array", ["text"]],
    ["object", { text: "x" }],
  ])("rejects a non-string body (%s)", (_label, value) => {
    expectRequestError(
      () => normalizeReviewBody(value),
      "INVALID_REQUEST",
      MESSAGES.invalidBodyType,
    );
  });
});

describe("parseCreateBody", () => {
  it("accepts a rating-only create and normalizes the landmark ID to lower case", () => {
    expect(parseCreateBody({ landmark_id: ID.toUpperCase(), rating: 4 })).toEqual({
      landmarkId: ID,
      rating: 4,
      body: null,
    });
  });

  it("accepts a create with body text, trimming it", () => {
    expect(parseCreateBody({ landmark_id: ID, rating: 5, body: "  Great view \n" })).toEqual({
      landmarkId: ID,
      rating: 5,
      body: "Great view",
    });
  });

  it.each([1, 2, 3, 4, 5, 5.0])("accepts rating %s", (rating) => {
    expect(parseCreateBody({ landmark_id: ID, rating }).rating).toBe(rating);
  });

  it.each([
    ["missing", undefined],
    ["zero", 0],
    ["six", 6],
    ["negative", -1],
    ["fractional", 4.5],
    ["numeric string", "5"],
    ["boolean", true],
    ["null", null],
    ["array", [5]],
  ])("rejects a %s rating with the fixed rating message", (_label, rating) => {
    const body: Record<string, unknown> = { landmark_id: ID };
    if (rating !== undefined) body.rating = rating;
    expectRequestError(() => parseCreateBody(body), "INVALID_REQUEST", MESSAGES.invalidRating);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-uuid"],
    ["number", 42],
  ])("rejects a %s landmark_id", (_label, landmarkId) => {
    const body: Record<string, unknown> = { rating: 3 };
    if (landmarkId !== undefined) body.landmark_id = landmarkId;
    expectRequestError(() => parseCreateBody(body), "INVALID_REQUEST", MESSAGES.invalidLandmarkId);
  });

  it.each(["user_id", "author_id", "userId", "created_at", "updated_at", "is_own_review", "id"])(
    "rejects the unexpected field %s",
    (field) => {
      expectRequestError(
        () => parseCreateBody({ landmark_id: ID, rating: 3, [field]: ID }),
        "INVALID_REQUEST",
        MESSAGES.unsupportedFields,
      );
    },
  );

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["array", [{ landmark_id: ID, rating: 3 }]],
    ["string", "rating=3"],
  ])("rejects a %s body", (_label, body) => {
    expectRequestError(() => parseCreateBody(body), "INVALID_REQUEST", MESSAGES.invalidBodyShape);
  });

  it("rejects NUL and lone surrogates in a create body", () => {
    expectRequestError(
      () => parseCreateBody({ landmark_id: ID, rating: 3, body: "a\u0000b" }),
      "INVALID_REQUEST",
      MESSAGES.bodyCharacters,
    );
    expectRequestError(
      () => parseCreateBody({ landmark_id: ID, rating: 3, body: `a${LONE_HIGH}` }),
      "INVALID_REQUEST",
      MESSAGES.bodyCharacters,
    );
  });

  it("never echoes the submitted value in the error message", () => {
    const secret = "very-distinctive-submitted-value-7Q";
    for (const body of [
      { landmark_id: secret, rating: 3 },
      { landmark_id: ID, rating: secret },
      { landmark_id: ID, rating: 3, body: secret.repeat(200) },
      { landmark_id: ID, rating: 3, [secret]: 1 },
    ]) {
      const error = expectRequestError(() => parseCreateBody(body), "INVALID_REQUEST");
      expect(error.message).not.toContain(secret);
      expect(Object.values(MESSAGES)).toContain(error.message);
    }
  });
});

describe("parsePatchBody", () => {
  it("distinguishes an omitted body (key absent) from an explicit null", () => {
    const ratingOnly = parsePatchBody({ rating: 2 });
    expect(ratingOnly).toEqual({ rating: 2 });
    expect(Object.prototype.hasOwnProperty.call(ratingOnly, "body")).toBe(false);

    const clear = parsePatchBody({ body: null });
    expect(clear).toEqual({ body: null });
    expect(Object.prototype.hasOwnProperty.call(clear, "body")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(clear, "rating")).toBe(false);
  });

  it("treats whitespace-only body as an explicit clear", () => {
    expect(parsePatchBody({ body: " \n\t " })).toEqual({ body: null });
  });

  it("accepts both fields together", () => {
    expect(parsePatchBody({ rating: 5, body: " new text " })).toEqual({
      rating: 5,
      body: "new text",
    });
  });

  it("rejects an empty PATCH", () => {
    expectRequestError(() => parsePatchBody({}), "INVALID_REQUEST", MESSAGES.emptyPatch);
  });

  it.each([null, 0, 6, 3.5, "4"])("rejects rating %s", (rating) => {
    expectRequestError(() => parsePatchBody({ rating }), "INVALID_REQUEST", MESSAGES.invalidRating);
  });

  it("rejects landmark_id, user_id, and other unexpected fields", () => {
    for (const field of ["landmark_id", "user_id", "id", "created_at"]) {
      expectRequestError(
        () => parsePatchBody({ rating: 3, [field]: ID }),
        "INVALID_REQUEST",
        MESSAGES.unsupportedFields,
      );
    }
  });

  it("applies the same body rules as create (2,001 code points, NUL, lone surrogate)", () => {
    expectRequestError(
      () => parsePatchBody({ body: NON_BMP.repeat(2001) }),
      "INVALID_REQUEST",
      MESSAGES.bodyTooLong,
    );
    expect(parsePatchBody({ body: NON_BMP.repeat(2000) })).toEqual({ body: NON_BMP.repeat(2000) });
    expectRequestError(
      () => parsePatchBody({ body: "\u0000" }),
      "INVALID_REQUEST",
      MESSAGES.bodyCharacters,
    );
    expectRequestError(
      () => parsePatchBody({ body: LONE_LOW }),
      "INVALID_REQUEST",
      MESSAGES.bodyCharacters,
    );
  });

  it("rejects a non-object body", () => {
    expectRequestError(
      () => parsePatchBody(undefined),
      "INVALID_REQUEST",
      MESSAGES.invalidBodyShape,
    );
    expectRequestError(() => parsePatchBody([]), "INVALID_REQUEST", MESSAGES.invalidBodyShape);
  });
});

describe("IDs, queries, and empty bodies", () => {
  it("parses review and landmark IDs in any case to lower case", () => {
    expect(parseReviewId(ID.toUpperCase())).toBe(ID);
    expect(parseLandmarkId(ID.toUpperCase())).toBe(ID);
  });

  it.each(["", "abc", `${ID}x`, ` ${ID}`, "3f2b8c1e9a4d4e6f8b7a1c2d3e4f5a6b", undefined, 7])(
    "rejects the malformed ID %s with 400 INVALID_REQUEST",
    (raw) => {
      expectRequestError(() => parseReviewId(raw), "INVALID_REQUEST", MESSAGES.invalidReviewId);
      expectRequestError(() => parseLandmarkId(raw), "INVALID_REQUEST", MESSAGES.invalidLandmarkId);
    },
  );

  it("own-review lookup requires exactly one well-formed landmark_id", () => {
    expect(parseOwnReviewQuery({ landmark_id: ID.toUpperCase() })).toEqual({ landmarkId: ID });
    for (const query of [
      {},
      undefined,
      { landmark_id: "bad" },
      { landmark_id: [ID, ID] },
      { landmark_id: ID, page: "1" },
      { landmark_id: ID, user_id: ID },
    ]) {
      expectRequestError(() => parseOwnReviewQuery(query), "INVALID_QUERY", MESSAGES.lookupQuery);
    }
  });

  it("mutations accept no query parameters", () => {
    expect(() => parseNoQuery({})).not.toThrow();
    expect(() => parseNoQuery(undefined)).not.toThrow();
    expectRequestError(() => parseNoQuery({ user_id: ID }), "INVALID_QUERY", MESSAGES.noQuery);
  });

  it("DELETE accepts only an absent body or {}", () => {
    expect(() => parseEmptyBody(undefined)).not.toThrow();
    expect(() => parseEmptyBody({})).not.toThrow();
    expectRequestError(
      () => parseEmptyBody({ user_id: ID }),
      "INVALID_REQUEST",
      MESSAGES.noBodyFields,
    );
    expectRequestError(() => parseEmptyBody([]), "INVALID_REQUEST", MESSAGES.noBodyFields);
  });
});

describe("parseListQuery", () => {
  it("defaults to page 1, limit 20", () => {
    expect(parseListQuery({})).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(parseListQuery(undefined)).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it("accepts limit 1 and 100 and computes the offset", () => {
    expect(parseListQuery({ page: "3", limit: "1" })).toEqual({ page: 3, limit: 1, offset: 2 });
    expect(parseListQuery({ page: "2", limit: "100" })).toEqual({
      page: 2,
      limit: 100,
      offset: 100,
    });
  });

  it.each([
    ["limit over 100", { limit: "101" }],
    ["limit zero", { limit: "0" }],
    ["page zero", { page: "0" }],
    ["negative page", { page: "-1" }],
    ["fractional limit", { limit: "2.5" }],
    ["leading zero", { page: "01" }],
    ["exponent", { limit: "1e1" }],
    ["whitespace", { page: " 1" }],
    ["repeated parameter", { page: ["1", "2"] }],
    ["unknown parameter", { sort: "rating" }],
    ["page beyond a safe integer", { page: "99999999999999999999" }],
    ["offset beyond a safe integer", { page: "900719925474099", limit: "100" }],
  ])("rejects %s with 400 INVALID_QUERY", (_label, query) => {
    expectRequestError(() => parseListQuery(query), "INVALID_QUERY");
  });
});

// ---------------------------------------------------------------------------
// Service mapping
// ---------------------------------------------------------------------------

const ROW: ReviewRow = {
  id: ID,
  rating: 4,
  body: "Lovely falls",
  createdAt: new Date("2026-11-21T16:31:04.123Z"),
  updatedAt: new Date("2026-11-22T08:00:00.000Z"),
};

describe("service mapping", () => {
  it("shapes the safe public representation with the fixed author label and UTC ISO timestamps", () => {
    const representation = toRepresentation(ROW);
    expect(representation).toEqual({
      id: ID,
      rating: 4,
      body: "Lovely falls",
      created_at: "2026-11-21T16:31:04.123Z",
      updated_at: "2026-11-22T08:00:00.000Z",
      author_label: "Community Member",
    });
    expect(AUTHOR_LABEL).toBe("Community Member");
    expect(Object.keys(representation).sort()).toEqual(
      ["author_label", "body", "created_at", "id", "rating", "updated_at"].sort(),
    );
  });

  it("always prints milliseconds and Z", () => {
    expect(toIsoTimestamp(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(() => toIsoTimestamp(new Date("not a date"))).toThrow();
  });

  it("maps create results: not visible → not_found; visible without a row → duplicate; else created", () => {
    expect(toCreateOutcome({ visible: false, review: null })).toEqual({ kind: "not_found" });
    expect(toCreateOutcome({ visible: true, review: null })).toEqual({ kind: "duplicate" });
    expect(toCreateOutcome({ visible: true, review: ROW })).toEqual({
      kind: "created",
      review: toRepresentation(ROW),
    });
  });

  it("maps a non-visible list to not_found with no aggregate or rows", () => {
    expect(
      toListOutcome(
        { visible: false, ratingCount: 0, averageRating: null, rows: [], hasMore: false },
        { page: 1, limit: 20, offset: 0 },
      ),
    ).toEqual({ kind: "not_found" });
  });

  it("returns average_rating null when the count is zero, and the unrounded average otherwise", () => {
    expect(
      toListOutcome(
        { visible: true, ratingCount: 0, averageRating: null, rows: [], hasMore: false },
        { page: 1, limit: 20, offset: 0 },
      ),
    ).toEqual({
      kind: "listed",
      body: {
        reviews: [],
        aggregate: { average_rating: null, rating_count: 0 },
        page: 1,
        limit: 20,
        has_more: false,
      },
    });
    const listed = toListOutcome(
      { visible: true, ratingCount: 3, averageRating: 13 / 3, rows: [ROW], hasMore: true },
      { page: 2, limit: 1, offset: 1 },
    );
    expect(listed).toEqual({
      kind: "listed",
      body: {
        reviews: [toRepresentation(ROW)],
        aggregate: { average_rating: 13 / 3, rating_count: 3 },
        page: 2,
        limit: 1,
        has_more: true,
      },
    });
  });
});
