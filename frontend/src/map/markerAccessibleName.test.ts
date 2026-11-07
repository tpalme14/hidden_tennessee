import { describe, expect, it } from "vitest";
import { markerAccessibleName } from "./markerAccessibleName";

describe("markerAccessibleName", () => {
  it("names the marker by display name and category label in bbox mode (no distance)", () => {
    expect(markerAccessibleName({ display_name: "Abrams Falls", category: "falls" })).toBe(
      "Abrams Falls, Waterfall",
    );
  });

  it("appends the straight-line distance, rounded to one decimal, in proximity mode", () => {
    expect(
      markerAccessibleName({
        display_name: "Abrams Falls",
        category: "falls",
        distance_miles: 3.456,
      }),
    ).toBe("Abrams Falls, Waterfall, approx. 3.5 mi straight-line distance");
  });

  it("falls back to the generic label for an unknown category rather than exposing the raw slug", () => {
    expect(markerAccessibleName({ display_name: "Mystery Spot", category: "unknown-slug" })).toBe(
      "Mystery Spot, Landmark",
    );
  });
});
