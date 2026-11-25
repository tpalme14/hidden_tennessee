import { describe, expect, it } from "vitest";
import {
  STRAIGHT_LINE_DISCLAIMER,
  formatMilesAndKm,
  previousLegText,
  tripTotalText,
} from "./formatTripDistance";

/** M05-T04 Increment 2 — straight-line distance wording (spec v1.1 §5.6). */

describe("formatMilesAndKm", () => {
  it("shows miles and kilometres to one decimal place", () => {
    expect(formatMilesAndKm(5.24)).toBe("5.2 mi (8.4 km)");
    expect(formatMilesAndKm(1)).toBe("1.0 mi (1.6 km)");
    expect(formatMilesAndKm(123.456)).toBe("123.5 mi (198.7 km)");
  });

  it("never shows a measured leg as zero", () => {
    expect(formatMilesAndKm(0.01)).toBe("less than 0.1 mi (less than 0.2 km)");
    expect(formatMilesAndKm(0)).toBe("less than 0.1 mi (less than 0.2 km)");
    expect(formatMilesAndKm(0.05)).toBe("0.1 mi (0.1 km)");
  });

  it("refuses a value that is not a non-negative finite number", () => {
    for (const bad of [-1, Number.NaN, Infinity]) {
      expect(() => formatMilesAndKm(bad)).toThrow(RangeError);
    }
  });
});

describe("previousLegText", () => {
  it("is null for the first stop, whatever the value", () => {
    expect(previousLegText(0, null)).toBeNull();
    expect(previousLegText(0, 3)).toBeNull();
  });

  it("labels a measured leg as straight-line", () => {
    expect(previousLegText(2, 5.24)).toBe("5.2 mi (8.4 km) straight-line from the previous stop");
  });

  it("explains an unmeasured leg next to an unavailable stop", () => {
    expect(previousLegText(1, null)).toBe(
      "Distance from the previous stop not measured, because the previous stop is no longer available.",
    );
  });
});

describe("tripTotalText", () => {
  it("shows no total for fewer than two stops", () => {
    expect(tripTotalText({ total_miles: null, measured_legs: 0, total_legs: 0 })).toEqual({
      kind: "none",
      text: null,
    });
  });

  it("states a complete total", () => {
    expect(tripTotalText({ total_miles: 12.34, measured_legs: 3, total_legs: 3 })).toEqual({
      kind: "complete",
      text: "Straight-line total: 12.3 mi (19.9 km).",
    });
  });

  it("labels a partial total with the measured-leg count and explains why", () => {
    expect(tripTotalText({ total_miles: 5.24, measured_legs: 1, total_legs: 3 })).toEqual({
      kind: "partial",
      text: "Straight-line total of 1 of 3 legs: 5.2 mi (8.4 km). Legs next to a stop that is no longer available are not measured.",
    });
  });

  it("never shows a zero total when no leg is measurable", () => {
    const result = tripTotalText({ total_miles: null, measured_legs: 0, total_legs: 1 });
    expect(result.kind).toBe("unmeasured");
    expect(result.text).toBe(
      "No straight-line total: none of the 1 leg can be measured, because each is next to a stop that is no longer available.",
    );
    expect(result.text).not.toMatch(/0\.0|\b0 mi/);
  });

  it("has a fixed disclaimer", () => {
    expect(STRAIGHT_LINE_DISCLAIMER).toBe(
      "Straight-line distances, not travel or trail distances.",
    );
  });
});
