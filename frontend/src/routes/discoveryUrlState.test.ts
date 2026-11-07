import { describe, expect, it } from "vitest";
import { DEFAULT_BBOX } from "../map/geo";
import { parseDiscoveryParams } from "./discoveryUrlState";

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("parseDiscoveryParams", () => {
  it("defaults to the Tennessee-wide bbox, bbox mode, and no viewport on a fresh, param-less visit — without flagging normalization", () => {
    const state = parseDiscoveryParams(params({}));

    expect(state.q).toBe("");
    expect(state.categories).toEqual([]);
    expect(state.mode).toBe("bbox");
    expect(state.bbox).toEqual(DEFAULT_BBOX);
    expect(state.near).toBeNull();
    expect(state.radius).toBeNull();
    expect(state.viewport).toBeNull();
    expect(state.wasNormalized).toBe(false);
  });

  it("trims and caps q at 100 characters", () => {
    const state = parseDiscoveryParams(params({ q: `  ${"x".repeat(150)}  ` }));
    expect(state.q).toBe("x".repeat(100));
  });

  it("parses, dedupes, and sorts categories", () => {
    const state = parseDiscoveryParams(params({ categories: "falls,arch,falls" }));
    expect(state.categories).toEqual(["arch", "falls"]);
  });

  it("parses a valid committed bbox", () => {
    const state = parseDiscoveryParams(params({ bbox: "-85,35,-84,36" }));
    expect(state.bbox).toEqual({ minLng: -85, minLat: 35, maxLng: -84, maxLat: 36 });
    expect(state.wasNormalized).toBe(false);
  });

  it("falls back to the default bbox and flags normalization when bbox is present but malformed", () => {
    const state = parseDiscoveryParams(params({ bbox: "not,a,valid,bbox" }));
    expect(state.bbox).toEqual(DEFAULT_BBOX);
    expect(state.wasNormalized).toBe(true);
  });

  it("falls back to the default bbox and flags normalization when bbox crosses the antimeridian (minLng >= maxLng)", () => {
    const state = parseDiscoveryParams(params({ bbox: "-84,35,-85,36" }));
    expect(state.bbox).toEqual(DEFAULT_BBOX);
    expect(state.wasNormalized).toBe(true);
  });

  it("falls back to the default bbox and flags normalization when bbox values are out of WGS84 range", () => {
    const state = parseDiscoveryParams(params({ bbox: "-200,35,-84,36" }));
    expect(state.bbox).toEqual(DEFAULT_BBOX);
    expect(state.wasNormalized).toBe(true);
  });

  it("parses mode=near with a valid near/radius pair", () => {
    const state = parseDiscoveryParams(params({ mode: "near", near: "35.5,-85.5", radius: "25" }));
    expect(state.mode).toBe("near");
    expect(state.near).toEqual({ lat: 35.5, lng: -85.5 });
    expect(state.radius).toBe(25);
    expect(state.wasNormalized).toBe(false);
  });

  it("falls back to bbox mode and flags normalization when mode=near but near is missing", () => {
    const state = parseDiscoveryParams(params({ mode: "near", radius: "25" }));
    expect(state.mode).toBe("bbox");
    expect(state.near).toBeNull();
    expect(state.radius).toBeNull();
    expect(state.wasNormalized).toBe(true);
  });

  it("falls back to bbox mode and flags normalization when mode=near but radius is not an allowed value", () => {
    const state = parseDiscoveryParams(params({ mode: "near", near: "35.5,-85.5", radius: "17" }));
    expect(state.mode).toBe("bbox");
    expect(state.wasNormalized).toBe(true);
  });

  it("falls back to bbox mode and flags normalization when the near origin is out of WGS84 range", () => {
    const state = parseDiscoveryParams(params({ mode: "near", near: "200,-85.5", radius: "25" }));
    expect(state.mode).toBe("bbox");
    expect(state.wasNormalized).toBe(true);
  });

  it("treats an absent bbox/mode/near/radius as an ordinary default, never as 'normalized'", () => {
    // Only a PRESENT-but-invalid param should trip wasNormalized — a fresh
    // visit with none of these params at all is the expected common case.
    const state = parseDiscoveryParams(params({ q: "Falls" }));
    expect(state.wasNormalized).toBe(false);
  });

  it("parses a valid viewport (lat/lng/zoom)", () => {
    const state = parseDiscoveryParams(params({ lat: "35.5", lng: "-85.5", zoom: "10" }));
    expect(state.viewport).toEqual({ center: [35.5, -85.5], zoom: 10 });
  });

  it("treats an incomplete or invalid viewport as no viewport, without flagging normalization", () => {
    const incomplete = parseDiscoveryParams(params({ lat: "35.5", lng: "-85.5" }));
    expect(incomplete.viewport).toBeNull();
    expect(incomplete.wasNormalized).toBe(false);

    const invalid = parseDiscoveryParams(params({ lat: "200", lng: "-85.5", zoom: "10" }));
    expect(invalid.viewport).toBeNull();
    expect(invalid.wasNormalized).toBe(false);
  });
});
