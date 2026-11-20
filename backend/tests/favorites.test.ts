import { describe, expect, it } from "vitest";
import type { FavoriteListRow } from "../src/favorites/repository.js";
import {
  FavoritesRequestError,
  parseLandmarkId,
  parseListQuery,
  parseMutationRequest,
} from "../src/favorites/request-schema.js";
import { toAddOutcomeKind, toFavoriteEntry } from "../src/favorites/service.js";

/** Unit tests for M03-T05 Increment 2: request validation, outcome mapping, entry shaping. No database. */

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

function expectRequestError(run: () => unknown, code: "INVALID_REQUEST" | "INVALID_QUERY") {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(FavoritesRequestError);
  expect((caught as FavoritesRequestError).code).toBe(code);
  return caught as FavoritesRequestError;
}

describe("parseLandmarkId", () => {
  it.each([
    ["lower case", ID],
    ["upper case", ID.toUpperCase()],
    ["mixed case", "3F2b8C1e-9A4d-4E6f-8B7a-1C2d3E4f5A6b"],
    [
      "the all-zero UUID (syntax only, not RFC-strict — E2)",
      "00000000-0000-0000-0000-000000000000",
    ],
  ])("accepts %s and returns canonical lower case", (_label, raw) => {
    expect(parseLandmarkId(raw)).toBe(raw.toLowerCase());
  });

  it.each([
    ["empty", ""],
    ["too short", ID.slice(0, -1)],
    ["too long", `${ID}0`],
    ["no hyphens", ID.replace(/-/g, "")],
    ["non-hex", ID.replace("3f2b", "3g2b")],
    ["leading space", ` ${ID}`],
    ["trailing space", `${ID} `],
    ["path traversal", "../../etc/passwd"],
    ["a GPX source code", "ARC001"],
    ["a number", 123],
    ["undefined", undefined],
    ["an array", [ID]],
  ])("rejects %s with INVALID_REQUEST", (_label, raw) => {
    expectRequestError(() => parseLandmarkId(raw), "INVALID_REQUEST");
  });

  it("never echoes the submitted value in its message", () => {
    const hostile = "<script>alert(1)</script>";
    const err = expectRequestError(() => parseLandmarkId(hostile), "INVALID_REQUEST");
    expect(err.message).toBe("Invalid landmark ID.");
    expect(err.message).not.toContain("script");
  });
});

describe("parseMutationRequest", () => {
  it.each([
    ["absent body and query", undefined, undefined],
    ["empty query and empty object body", {}, {}],
    ["empty query, absent body", {}, undefined],
  ])("accepts %s", (_label, query, body) => {
    expect(() => parseMutationRequest(query, body)).not.toThrow();
  });

  it.each([
    ["user_id", { user_id: ID }],
    ["userId", { userId: ID }],
    ["landmarkId", { landmarkId: ID }],
    ["an unrelated key", { note: "x" }],
    ["a nested object", { data: { user_id: ID } }],
    ["an array", []],
    ["an array with an object", [{ user_id: ID }]],
    ["a string", "user_id"],
    ["null", null],
  ])("rejects a body with %s (INVALID_REQUEST)", (_label, body) => {
    const err = expectRequestError(() => parseMutationRequest({}, body), "INVALID_REQUEST");
    expect(err.message).not.toContain(ID);
  });

  it.each([
    ["user_id", { user_id: ID }],
    ["page", { page: "1" }],
    ["an empty-valued key", { x: "" }],
  ])("rejects a query parameter %s (INVALID_QUERY)", (_label, query) => {
    expectRequestError(() => parseMutationRequest(query, undefined), "INVALID_QUERY");
  });
});

describe("parseListQuery", () => {
  it("defaults to page 1, limit 50", () => {
    expect(parseListQuery({})).toEqual({ page: 1, limit: 50, offset: 0 });
    expect(parseListQuery(undefined)).toEqual({ page: 1, limit: 50, offset: 0 });
  });

  it.each([
    [{ limit: "1" }, { page: 1, limit: 1, offset: 0 }],
    [{ limit: "100" }, { page: 1, limit: 100, offset: 0 }],
    [
      { page: "3", limit: "20" },
      { page: 3, limit: 20, offset: 40 },
    ],
    [{ page: "2" }, { page: 2, limit: 50, offset: 50 }],
  ])("accepts %j", (query, expected) => {
    expect(parseListQuery(query)).toEqual(expected);
  });

  it.each([
    ["limit 0", { limit: "0" }],
    ["limit 101", { limit: "101" }],
    ["page 0", { page: "0" }],
    ["negative page", { page: "-1" }],
    ["plus sign", { page: "+2" }],
    ["decimal", { page: "1.5" }],
    ["trailing .0", { limit: "10.0" }],
    ["exponent", { page: "1e2" }],
    ["hex", { limit: "0x10" }],
    ["leading space", { page: " 2" }],
    ["leading zero", { page: "01" }],
    ["empty page", { page: "" }],
    ["empty limit", { limit: "" }],
    ["repeated page (array)", { page: ["1", "2"] }],
    ["nested object", { page: { gt: "1" } }],
    ["unknown key", { sort: "name" }],
    ["identity key", { user_id: ID }],
    ["unsafe page", { page: "9007199254740993" }],
    ["unsafe offset", { page: "900719925474099", limit: "100" }],
    ["huge limit", { limit: "99999999999999999999" }],
  ])("rejects %s with INVALID_QUERY", (_label, query) => {
    expectRequestError(() => parseListQuery(query), "INVALID_QUERY");
  });
});

describe("toAddOutcomeKind", () => {
  it.each([
    [{ eligible: true, created: true }, "created"],
    [{ eligible: true, created: false }, "existing"],
    [{ eligible: false, created: false }, "not_found"],
    // Impossible from the single statement, but must still fail closed.
    [{ eligible: false, created: true }, "not_found"],
  ] as const)("maps %j to %s", (result, kind) => {
    expect(toAddOutcomeKind(result)).toBe(kind);
  });
});

describe("toFavoriteEntry", () => {
  const RESTRICTED_KEYS = [
    "latitude",
    "longitude",
    "distance_miles",
    "source_description",
    "source_access_label",
    "source_url",
    "source_code",
    "source_file",
  ];

  function row(overrides: Partial<FavoriteListRow>): FavoriteListRow {
    return {
      landmarkId: ID,
      displayName: "Hidden Arch",
      category: "ARCH",
      sensitivityStatus: "PUBLIC",
      isActive: true,
      latitude: 35.1869,
      longitude: -85.6103,
      ...overrides,
    };
  }

  function allKeys(value: unknown): string[] {
    if (value === null || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
  }

  it("active PUBLIC → available with exactly the public collection-item fields", () => {
    const entry = toFavoriteEntry(row({}));
    expect(entry).toEqual({
      landmark_id: ID,
      availability: "available",
      landmark: {
        id: ID,
        display_name: "Hidden Arch",
        category: "arch",
        latitude: 35.1869,
        longitude: -85.6103,
      },
    });
  });

  it.each(["UNREVIEWED", "SENSITIVE"])(
    "active %s → redacted with exactly the §9.4a allowlist and no location data",
    (status) => {
      const entry = toFavoriteEntry(row({ sensitivityStatus: status }));
      expect(entry).toEqual({
        landmark_id: ID,
        availability: "redacted",
        landmark: { id: ID, display_name: "Hidden Arch", category: "arch", redacted: true },
      });
      for (const key of RESTRICTED_KEYS) expect(allKeys(entry)).not.toContain(key);
    },
  );

  it.each(["PUBLIC", "UNREVIEWED", "SENSITIVE"])(
    "retired (%s) → unavailable with the landmark ID only: no name, category, or location",
    (status) => {
      const entry = toFavoriteEntry(row({ isActive: false, sensitivityStatus: status }));
      expect(entry).toEqual({ landmark_id: ID, availability: "unavailable" });
      expect(JSON.stringify(entry)).not.toMatch(/Hidden Arch|arch|35\.18|85\.61/);
    },
  );

  it("an unknown sensitivity value is never treated as public", () => {
    const entry = toFavoriteEntry(row({ sensitivityStatus: "SOMETHING_NEW" }));
    expect(entry.availability).toBe("redacted");
    for (const key of RESTRICTED_KEYS) expect(allKeys(entry)).not.toContain(key);
  });
});
