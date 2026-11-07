import { describe, expect, it } from "vitest";
import { categorySlugToValue, categoryValueToSlug, isCategorySlug } from "../src/landmarks/categories.js";
import { escapeLikePattern } from "../src/landmarks/like-escape.js";
import { InvalidQueryError, parseLandmarkCollectionQuery } from "../src/landmarks/query-schema.js";
import { toCollectionItem, toDetailResult } from "../src/landmarks/redaction.js";
import type { LandmarkRow } from "../src/landmarks/repository.js";

describe("categories", () => {
  it("round-trips every defined slug/enum pair", () => {
    expect(categorySlugToValue("falls")).toBe("FALLS");
    expect(categoryValueToSlug("FALLS")).toBe("falls");
  });

  it("rejects an unknown slug", () => {
    expect(isCategorySlug("waterfall")).toBe(false);
    expect(() => categorySlugToValue("waterfall")).toThrow();
  });
});

describe("escapeLikePattern", () => {
  it("escapes %, _, and backslash so they match literally", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("escapes backslash first so a literal backslash isn't re-interpreted by later replacements", () => {
    // If % were escaped before \, "\%" would become "\\%" (a literal backslash
    // followed by an escaped %) instead of the intended "\\%" meaning literal "\%".
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });
});

describe("parseLandmarkCollectionQuery", () => {
  it("applies defaults when no parameters are given", () => {
    const query = parseLandmarkCollectionQuery({});
    expect(query).toEqual({
      q: null,
      categories: null,
      bbox: null,
      near: null,
      radiusMiles: null,
      page: 1,
      limit: 200,
    });
  });

  it("trims q and treats whitespace-only q as no restriction", () => {
    expect(parseLandmarkCollectionQuery({ q: "  Rock House  " }).q).toBe("Rock House");
    expect(parseLandmarkCollectionQuery({ q: "   " }).q).toBeNull();
  });

  it("rejects q longer than 100 characters after trimming", () => {
    expect(() => parseLandmarkCollectionQuery({ q: "x".repeat(101) })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ q: `  ${"x".repeat(100)}  ` })).not.toThrow();
  });

  it("parses valid category slugs and rejects unknown or duplicate ones", () => {
    expect(parseLandmarkCollectionQuery({ categories: "falls,arch" }).categories).toEqual(["FALLS", "ARCH"]);
    expect(() => parseLandmarkCollectionQuery({ categories: "waterfall" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ categories: "falls,falls" })).toThrow(InvalidQueryError);
  });

  it("treats an empty categories value as no restriction", () => {
    expect(parseLandmarkCollectionQuery({ categories: "" }).categories).toBeNull();
  });

  it("parses a valid bbox", () => {
    expect(parseLandmarkCollectionQuery({ bbox: "-85,35,-84,36" }).bbox).toEqual({
      minLng: -85,
      minLat: 35,
      maxLng: -84,
      maxLat: 36,
    });
  });

  it("rejects a malformed bbox (wrong part count, non-numeric, out of range, inverted)", () => {
    expect(() => parseLandmarkCollectionQuery({ bbox: "-85,35,-84" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ bbox: "x,35,-84,36" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ bbox: "-200,35,-84,36" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ bbox: "-85,95,-84,36" })).toThrow(InvalidQueryError);
  });

  it("rejects an antimeridian-crossing bbox (minLng not less than maxLng)", () => {
    expect(() => parseLandmarkCollectionQuery({ bbox: "170,35,-170,36" })).toThrow(InvalidQueryError);
  });

  it("parses a valid near + radius", () => {
    const query = parseLandmarkCollectionQuery({ near: "35.5,-85.5", radius: "25" });
    expect(query.near).toEqual({ lat: 35.5, lng: -85.5 });
    expect(query.radiusMiles).toBe(25);
  });

  it("rejects near without radius, radius without near, and an unsupported radius value", () => {
    expect(() => parseLandmarkCollectionQuery({ near: "35.5,-85.5" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ radius: "25" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ near: "35.5,-85.5", radius: "30" })).toThrow(InvalidQueryError);
  });

  it("rejects near combined with bbox", () => {
    expect(() =>
      parseLandmarkCollectionQuery({ near: "35.5,-85.5", radius: "25", bbox: "-85,35,-84,36" }),
    ).toThrow(InvalidQueryError);
  });

  it("rejects out-of-range near coordinates", () => {
    expect(() => parseLandmarkCollectionQuery({ near: "95,-85.5", radius: "25" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ near: "35.5,-185", radius: "25" })).toThrow(InvalidQueryError);
  });

  it("parses page and limit, defaulting and validating ranges", () => {
    expect(parseLandmarkCollectionQuery({ page: "3", limit: "50" })).toMatchObject({ page: 3, limit: 50 });
    expect(() => parseLandmarkCollectionQuery({ page: "0" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ page: "1.5" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ limit: "0" })).toThrow(InvalidQueryError);
    expect(() => parseLandmarkCollectionQuery({ limit: "201" })).toThrow(InvalidQueryError);
  });

  it("rejects an unknown query parameter name", () => {
    expect(() => parseLandmarkCollectionQuery({ sort: "name" })).toThrow(InvalidQueryError);
  });

  it("rejects a query parameter provided more than once (array value)", () => {
    expect(() => parseLandmarkCollectionQuery({ q: ["a", "b"] as unknown as string })).toThrow(InvalidQueryError);
  });
});

describe("toCollectionItem", () => {
  const baseRow: LandmarkRow = {
    id: "11111111-1111-1111-1111-111111111111",
    displayName: "Denny Cove Falls",
    category: "FALLS",
    sensitivityStatus: "PUBLIC",
    isActive: true,
    latitude: 35.15357,
    longitude: -85.67249,
    sourceDescription: "Marion",
    sourceAccessLabel: "GSMNP",
    sourceUrl: "http://example.com",
    distanceMiles: null,
  };

  it("includes coordinates for a PUBLIC landmark", () => {
    expect(toCollectionItem(baseRow)).toEqual({
      id: baseRow.id,
      display_name: "Denny Cove Falls",
      category: "falls",
      latitude: 35.15357,
      longitude: -85.67249,
    });
  });

  it("includes distance_miles for a PUBLIC landmark in proximity mode", () => {
    const row = { ...baseRow, distanceMiles: 4.2 };
    expect(toCollectionItem(row)).toEqual({
      id: baseRow.id,
      display_name: "Denny Cove Falls",
      category: "falls",
      latitude: 35.15357,
      longitude: -85.67249,
      distance_miles: 4.2,
    });
  });

  it("omits coordinates and distance entirely for UNREVIEWED and SENSITIVE landmarks", () => {
    for (const sensitivityStatus of ["UNREVIEWED", "SENSITIVE"]) {
      const row = { ...baseRow, sensitivityStatus, distanceMiles: 4.2 };
      const item = toCollectionItem(row);
      expect(item).toEqual({ id: baseRow.id, display_name: "Denny Cove Falls", category: "falls" });
      expect(item).not.toHaveProperty("latitude");
      expect(item).not.toHaveProperty("longitude");
      expect(item).not.toHaveProperty("distance_miles");
    }
  });
});

describe("toDetailResult", () => {
  const baseRow: LandmarkRow = {
    id: "22222222-2222-2222-2222-222222222222",
    displayName: "Coal Creek Arches",
    category: "ARCH",
    sensitivityStatus: "PUBLIC",
    isActive: true,
    latitude: 36.2174,
    longitude: -84.12754,
    sourceDescription: "Anderson",
    sourceAccessLabel: "private",
    sourceUrl: "http://example.com",
    distanceMiles: null,
  };

  it("returns not_found when the row is null", () => {
    expect(toDetailResult(null)).toEqual({ kind: "not_found" });
  });

  it("returns not_found for an inactive landmark regardless of sensitivityStatus", () => {
    for (const sensitivityStatus of ["PUBLIC", "UNREVIEWED", "SENSITIVE"]) {
      expect(toDetailResult({ ...baseRow, isActive: false, sensitivityStatus })).toEqual({ kind: "not_found" });
    }
  });

  it("returns the full profile for an active PUBLIC landmark", () => {
    const result = toDetailResult(baseRow);
    expect(result).toEqual({
      kind: "full",
      body: {
        id: baseRow.id,
        display_name: "Coal Creek Arches",
        category: "arch",
        latitude: 36.2174,
        longitude: -84.12754,
        source_description: "Anderson",
        source_access_label: "private",
        source_url: "http://example.com",
      },
    });
  });

  it("returns exactly the §9.4a allowlist for active UNREVIEWED and SENSITIVE landmarks, with no other field", () => {
    for (const sensitivityStatus of ["UNREVIEWED", "SENSITIVE"]) {
      const result = toDetailResult({ ...baseRow, sensitivityStatus });
      expect(result.kind).toBe("minimal");
      if (result.kind !== "minimal") continue;
      expect(result.body).toEqual({
        id: baseRow.id,
        display_name: "Coal Creek Arches",
        category: "arch",
        redacted: true,
      });
      expect(Object.keys(result.body).sort()).toEqual(["category", "display_name", "id", "redacted"]);
    }
  });
});
