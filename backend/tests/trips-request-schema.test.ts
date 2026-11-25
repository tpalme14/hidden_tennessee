import { describe, expect, it } from "vitest";
import {
  MAX_VERSION,
  MESSAGES,
  TripsRequestError,
  parseAddStopBody,
  parseCreateTripBody,
  parseEmptyBody,
  parseListQuery,
  parseNoQuery,
  parseRenameTripBody,
  parseReorderBody,
  parseStopId,
  parseTripId,
} from "../src/trips/request-schema.js";

/**
 * M05-T03 Increment 1 — strict request validation for the trips API
 * (specs/TRIP_PLANNING_SPEC.md v1.1 §§5.1.1, 5.5, 6.3, 7, 10.1; ADR-014
 * decisions 3–5; ADR-012 decision 5). Every failure is a TripsRequestError
 * with a fixed message that never echoes the input.
 */

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID_UPPER = ID.toUpperCase();
const ID2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function rejects(fn: () => unknown, code: "INVALID_REQUEST" | "INVALID_QUERY", message: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TripsRequestError);
    expect((error as TripsRequestError).code).toBe(code);
    expect((error as TripsRequestError).message).toBe(message);
    return;
  }
  throw new Error("expected a TripsRequestError");
}

describe("path IDs", () => {
  it("accept any-case UUID syntax and return lower case", () => {
    expect(parseTripId(ID_UPPER)).toBe(ID);
    expect(parseStopId(ID)).toBe(ID);
  });

  it("reject malformed IDs with fixed messages that never echo the value", () => {
    for (const bad of ["", "not-a-uuid", `${ID}0`, ` ${ID}`, 123, undefined, null, [ID]]) {
      rejects(() => parseTripId(bad), "INVALID_REQUEST", MESSAGES.invalidTripId);
      rejects(() => parseStopId(bad), "INVALID_REQUEST", MESSAGES.invalidStopId);
    }
  });
});

describe("query and empty-body rules", () => {
  it("parseNoQuery accepts an empty or missing query only", () => {
    expect(() => parseNoQuery({})).not.toThrow();
    expect(() => parseNoQuery(undefined)).not.toThrow();
    rejects(() => parseNoQuery({ page: "1" }), "INVALID_QUERY", MESSAGES.noQuery);
  });

  it("parseEmptyBody accepts an absent or empty object only", () => {
    expect(() => parseEmptyBody(undefined)).not.toThrow();
    expect(() => parseEmptyBody({})).not.toThrow();
    for (const bad of [{ a: 1 }, [], "x", null]) {
      rejects(() => parseEmptyBody(bad), "INVALID_REQUEST", MESSAGES.noBodyFields);
    }
  });
});

describe("list query (spec §10.1)", () => {
  it("defaults to page 1, limit 20", () => {
    expect(parseListQuery({})).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(parseListQuery(undefined)).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it("accepts limit 1 to 100 and computes the offset", () => {
    expect(parseListQuery({ page: "3", limit: "100" })).toEqual({
      page: 3,
      limit: 100,
      offset: 200,
    });
    expect(parseListQuery({ limit: "1" })).toEqual({ page: 1, limit: 1, offset: 0 });
  });

  it("rejects limit over 100, zero, signs, fractions, repeats, and unknown keys", () => {
    for (const bad of [
      { limit: "101" },
      { page: "0" },
      { limit: "0" },
      { page: "-1" },
      { page: "+1" },
      { page: "1.0" },
      { page: "01" },
      { page: " 1" },
      { page: ["1", "2"] },
      { sort: "name" },
      { user_id: ID },
    ]) {
      rejects(() => parseListQuery(bad), "INVALID_QUERY", MESSAGES.listQuery);
    }
  });

  it("rejects a page whose offset is not a safe integer", () => {
    rejects(
      () => parseListQuery({ page: "99999999999999999999" }),
      "INVALID_QUERY",
      MESSAGES.pageTooLarge,
    );
    rejects(
      () => parseListQuery({ page: String(Number.MAX_SAFE_INTEGER), limit: "100" }),
      "INVALID_QUERY",
      MESSAGES.pageTooLarge,
    );
  });
});

describe("create trip body: { name }", () => {
  it("returns the trimmed name", () => {
    expect(parseCreateTripBody({ name: "  Weekend Waterfalls " })).toEqual({
      name: "Weekend Waterfalls",
    });
  });

  it("rejects non-objects, unknown fields, and client identity fields", () => {
    for (const bad of [null, [], "name", 1]) {
      rejects(() => parseCreateTripBody(bad), "INVALID_REQUEST", MESSAGES.invalidBodyShape);
    }
    for (const bad of [
      { name: "A", user_id: ID },
      { name: "A", version: 0 },
      { name: "A", stops: [] },
    ]) {
      rejects(() => parseCreateTripBody(bad), "INVALID_REQUEST", MESSAGES.unsupportedFields);
    }
  });

  it("maps each name-rule failure to its fixed message", () => {
    rejects(() => parseCreateTripBody({}), "INVALID_REQUEST", MESSAGES.nameType);
    rejects(() => parseCreateTripBody({ name: 5 }), "INVALID_REQUEST", MESSAGES.nameType);
    rejects(() => parseCreateTripBody({ name: null }), "INVALID_REQUEST", MESSAGES.nameType);
    rejects(
      () => parseCreateTripBody({ name: `a${String.fromCodePoint(9)}b` }),
      "INVALID_REQUEST",
      MESSAGES.nameCharacters,
    );
    rejects(() => parseCreateTripBody({ name: "   " }), "INVALID_REQUEST", MESSAGES.nameNoVisible);
    rejects(
      () => parseCreateTripBody({ name: "a".repeat(101) }),
      "INVALID_REQUEST",
      MESSAGES.nameTooLong,
    );
  });

  it("never echoes the submitted name in an error message", () => {
    const secret = "<script>alert(1)</script>".repeat(5);
    try {
      parseCreateTripBody({ name: secret });
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as Error).message).not.toContain("script");
    }
  });
});

describe("rename body: { name, version? } (spec §5.5)", () => {
  it("returns version only when supplied", () => {
    expect(parseRenameTripBody({ name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(parseRenameTripBody({ name: "Renamed", version: 0 })).toEqual({
      name: "Renamed",
      version: 0,
    });
    expect(parseRenameTripBody({ name: "Renamed", version: MAX_VERSION })).toEqual({
      name: "Renamed",
      version: MAX_VERSION,
    });
  });

  it("requires a name and rejects unknown fields", () => {
    rejects(() => parseRenameTripBody({ version: 1 }), "INVALID_REQUEST", MESSAGES.nameType);
    rejects(
      () => parseRenameTripBody({ name: "A", user_id: ID }),
      "INVALID_REQUEST",
      MESSAGES.unsupportedFields,
    );
  });

  it("rejects a version that is not a non-negative integer within PostgreSQL's integer range", () => {
    for (const bad of [-1, 1.5, "3", null, true, [], {}, MAX_VERSION + 1, Number.NaN, Infinity]) {
      rejects(
        () => parseRenameTripBody({ name: "A", version: bad }),
        "INVALID_REQUEST",
        MESSAGES.invalidVersion,
      );
    }
  });
});

describe("add stop body: { landmark_id }", () => {
  it("returns the landmark ID in lower case", () => {
    expect(parseAddStopBody({ landmark_id: ID_UPPER })).toEqual({ landmarkId: ID });
  });

  it("rejects a malformed or missing landmark ID", () => {
    for (const bad of [{}, { landmark_id: "x" }, { landmark_id: 1 }, { landmark_id: null }]) {
      rejects(() => parseAddStopBody(bad), "INVALID_REQUEST", MESSAGES.invalidLandmarkId);
    }
  });

  it("rejects unknown fields, including position and identity", () => {
    for (const bad of [
      { landmark_id: ID, position: 0 },
      { landmark_id: ID, user_id: ID },
      { landmark_id: ID, trip_id: ID },
    ]) {
      rejects(() => parseAddStopBody(bad), "INVALID_REQUEST", MESSAGES.unsupportedFields);
    }
    rejects(() => parseAddStopBody([ID]), "INVALID_REQUEST", MESSAGES.invalidBodyShape);
  });
});

describe("reorder body: { stop_ids, version } (spec §§6.3, 6.4)", () => {
  it("returns lower-case IDs in the submitted order and the version", () => {
    expect(parseReorderBody({ stop_ids: [ID2, ID_UPPER], version: 3 })).toEqual({
      stopIds: [ID2, ID],
      version: 3,
    });
  });

  it("requires version", () => {
    rejects(() => parseReorderBody({ stop_ids: [ID] }), "INVALID_REQUEST", MESSAGES.invalidVersion);
    rejects(
      () => parseReorderBody({ stop_ids: [ID], version: "3" }),
      "INVALID_REQUEST",
      MESSAGES.invalidVersion,
    );
  });

  it("rejects an empty, oversized, malformed, or duplicated list (duplicates compared case-insensitively)", () => {
    const many = Array.from(
      { length: 26 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    for (const stop_ids of [
      [],
      many,
      "x",
      null,
      [ID, "not-a-uuid"],
      [ID, 5],
      [ID, ID],
      [ID, ID_UPPER],
    ]) {
      rejects(
        () => parseReorderBody({ stop_ids, version: 0 }),
        "INVALID_REQUEST",
        MESSAGES.invalidStopIds,
      );
    }
    expect(parseReorderBody({ stop_ids: many.slice(0, 25), version: 0 }).stopIds).toHaveLength(25);
  });

  it("rejects unknown fields", () => {
    rejects(
      () => parseReorderBody({ stop_ids: [ID], version: 0, positions: [0] }),
      "INVALID_REQUEST",
      MESSAGES.unsupportedFields,
    );
  });
});
