import { describe, expect, it } from "vitest";
import {
  isValidFullProfile,
  isValidMinimalProfile,
  parseLandmarkProfile,
  parseSafeHttpUrl,
} from "./landmarkProfileValidation";

const VALID_FULL = {
  id: "11111111-1111-1111-1111-111111111111",
  display_name: "Public Arch",
  category: "arch",
  latitude: 36.2,
  longitude: -84.1,
  source_description: "Anderson",
  source_access_label: "private",
  source_url: "http://example.com/arch",
};

const VALID_MINIMAL = {
  id: "22222222-2222-2222-2222-222222222222",
  display_name: "Hidden Falls",
  category: "falls",
  redacted: true,
};

describe("isValidFullProfile", () => {
  it("accepts a well-formed full profile with all fields present", () => {
    expect(isValidFullProfile(VALID_FULL)).toBe(true);
  });

  it("accepts nullable optional fields set to null", () => {
    expect(
      isValidFullProfile({
        ...VALID_FULL,
        source_description: null,
        source_access_label: null,
        source_url: null,
      }),
    ).toBe(true);
  });

  it("rejects invalid WGS84 coordinates", () => {
    expect(isValidFullProfile({ ...VALID_FULL, latitude: 95 })).toBe(false);
    expect(isValidFullProfile({ ...VALID_FULL, longitude: -185 })).toBe(false);
    expect(isValidFullProfile({ ...VALID_FULL, latitude: Number.NaN })).toBe(false);
  });

  it("rejects a missing required field", () => {
    const withoutName: Record<string, unknown> = { ...VALID_FULL };
    delete withoutName.display_name;
    expect(isValidFullProfile(withoutName)).toBe(false);
  });

  it("rejects an object with an unexpected extra field", () => {
    expect(isValidFullProfile({ ...VALID_FULL, sensitivityStatus: "PUBLIC" })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isValidFullProfile(null)).toBe(false);
    expect(isValidFullProfile("not an object")).toBe(false);
    expect(isValidFullProfile([VALID_FULL])).toBe(false);
  });
});

describe("isValidMinimalProfile", () => {
  it("accepts a well-formed minimal profile", () => {
    expect(isValidMinimalProfile(VALID_MINIMAL)).toBe(true);
  });

  it("rejects a minimal-shaped object that also carries protected fields", () => {
    expect(isValidMinimalProfile({ ...VALID_MINIMAL, latitude: 35, longitude: -85 })).toBe(false);
    expect(isValidMinimalProfile({ ...VALID_MINIMAL, source_url: "http://example.com" })).toBe(false);
    expect(isValidMinimalProfile({ ...VALID_MINIMAL, sensitivityStatus: "UNREVIEWED" })).toBe(false);
  });

  it("rejects redacted: false or a non-boolean redacted value", () => {
    expect(isValidMinimalProfile({ ...VALID_MINIMAL, redacted: false })).toBe(false);
    expect(isValidMinimalProfile({ ...VALID_MINIMAL, redacted: "true" })).toBe(false);
  });

  it("rejects a missing required field", () => {
    const withoutCategory: Record<string, unknown> = { ...VALID_MINIMAL };
    delete withoutCategory.category;
    expect(isValidMinimalProfile(withoutCategory)).toBe(false);
  });
});

describe("parseLandmarkProfile", () => {
  it("returns the full profile when it matches that shape", () => {
    expect(parseLandmarkProfile(VALID_FULL)).toEqual(VALID_FULL);
  });

  it("returns the minimal profile when it matches that shape", () => {
    expect(parseLandmarkProfile(VALID_MINIMAL)).toEqual(VALID_MINIMAL);
  });

  it("returns null for a malformed or unrecognized shape, without throwing", () => {
    expect(parseLandmarkProfile({ foo: "bar" })).toBeNull();
    expect(parseLandmarkProfile(null)).toBeNull();
    expect(parseLandmarkProfile("a string response")).toBeNull();
    expect(parseLandmarkProfile({ ...VALID_MINIMAL, latitude: 35 })).toBeNull();
  });
});

describe("parseSafeHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(parseSafeHttpUrl("http://example.com/page")).toBe("http://example.com/page");
    expect(parseSafeHttpUrl("https://example.com/page")).toBe("https://example.com/page");
  });

  it("rejects non-http(s) schemes", () => {
    expect(parseSafeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseSafeHttpUrl("ftp://example.com/file")).toBeNull();
  });

  it("rejects malformed URLs and null", () => {
    expect(parseSafeHttpUrl("not a url")).toBeNull();
    expect(parseSafeHttpUrl(null)).toBeNull();
  });
});
