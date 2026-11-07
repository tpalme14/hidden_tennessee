import { describe, expect, it } from "vitest";
import {
  ALLOWED_RADII_MILES,
  boundsEqual,
  formatBboxParam,
  formatNearParam,
  isAllowedRadius,
  isValidBbox,
  isValidLatitude,
  isValidLongitude,
  isValidOrigin,
  milesToKm,
  parseBboxParam,
  parseNearParam,
  parseRadiusParam,
} from "./geo";

describe("coordinate validators", () => {
  it("accepts in-range WGS84 latitudes and longitudes", () => {
    expect(isValidLatitude(35)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
  });

  it("rejects out-of-range, non-finite, or NaN values", () => {
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLatitude(-90.0001)).toBe(false);
    expect(isValidLatitude(Number.NaN)).toBe(false);
    expect(isValidLatitude(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidLongitude(180.0001)).toBe(false);
    expect(isValidLongitude(-180.0001)).toBe(false);
  });

  it("validates a bbox requires min < max on both axes, in addition to range", () => {
    expect(isValidBbox({ minLng: -85, minLat: 35, maxLng: -84, maxLat: 36 })).toBe(true);
    expect(isValidBbox({ minLng: -84, minLat: 35, maxLng: -85, maxLat: 36 })).toBe(false); // antimeridian-style inversion
    expect(isValidBbox({ minLng: -85, minLat: 36, maxLng: -84, maxLat: 35 })).toBe(false);
    expect(isValidBbox({ minLng: -200, minLat: 35, maxLng: -84, maxLat: 36 })).toBe(false);
  });

  it("validates an origin", () => {
    expect(isValidOrigin({ lat: 35, lng: -85 })).toBe(true);
    expect(isValidOrigin({ lat: 91, lng: -85 })).toBe(false);
  });
});

describe("radius", () => {
  it("accepts only the five approved mile values", () => {
    for (const r of ALLOWED_RADII_MILES) expect(isAllowedRadius(r)).toBe(true);
    expect(isAllowedRadius(15)).toBe(false);
    expect(isAllowedRadius(0)).toBe(false);
  });

  it("converts miles to kilometers using the approved factor", () => {
    expect(milesToKm(1)).toBeCloseTo(1.609344, 6);
    expect(milesToKm(25)).toBeCloseTo(40.2336, 4);
  });
});

describe("bbox/near param formatting and parsing round-trip", () => {
  it("formats bbox as minLng,minLat,maxLng,maxLat", () => {
    expect(formatBboxParam({ minLng: -85, minLat: 35, maxLng: -84, maxLat: 36 })).toBe("-85,35,-84,36");
  });

  it("parses a valid bbox string back to the same object", () => {
    expect(parseBboxParam("-85,35,-84,36")).toEqual({ minLng: -85, minLat: 35, maxLng: -84, maxLat: 36 });
  });

  it("returns null for a malformed or invalid bbox string", () => {
    expect(parseBboxParam(null)).toBeNull();
    expect(parseBboxParam("not,valid")).toBeNull();
    expect(parseBboxParam("-84,35,-85,36")).toBeNull(); // inverted
  });

  it("formats near as lat,lng (NOT bbox's lng-first order)", () => {
    expect(formatNearParam({ lat: 35.5, lng: -85.5 })).toBe("35.5,-85.5");
  });

  it("parses a valid near string back to the same object", () => {
    expect(parseNearParam("35.5,-85.5")).toEqual({ lat: 35.5, lng: -85.5 });
  });

  it("returns null for a malformed or out-of-range near string", () => {
    expect(parseNearParam(null)).toBeNull();
    expect(parseNearParam("200,-85.5")).toBeNull();
  });

  it("parses only an allowed radius value, null otherwise", () => {
    expect(parseRadiusParam("25")).toBe(25);
    expect(parseRadiusParam("17")).toBeNull();
    expect(parseRadiusParam(null)).toBeNull();
  });
});

describe("bounds equality", () => {
  const a = { minLng: -85, minLat: 35, maxLng: -84, maxLat: 36 };

  it("boundsEqual requires exact equality on every field", () => {
    expect(boundsEqual(a, { ...a })).toBe(true);
    expect(boundsEqual(a, { ...a, maxLat: 36.0001 })).toBe(false);
  });
});
