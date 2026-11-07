import { describe, expect, it } from "vitest";
import { categoryColor, categoryLabel } from "./categoryMarkerStyle";

const SLUGS = ["arch", "bald", "falls", "lake", "other", "peak", "rock", "sink"];

describe("categoryMarkerStyle", () => {
  it("assigns a distinct color to each of the 8 approved categories", () => {
    const colors = SLUGS.map(categoryColor);
    expect(new Set(colors).size).toBe(8);
  });

  it("provides a human-readable label for each category, matching the approved mapping", () => {
    expect(categoryLabel("falls")).toBe("Waterfall");
    expect(categoryLabel("arch")).toBe("Natural Arch");
    expect(categoryLabel("sink")).toBe("Sinkhole");
  });

  it("falls back gracefully for an unrecognized category slug rather than throwing", () => {
    expect(() => categoryColor("unknown")).not.toThrow();
    expect(() => categoryLabel("unknown")).not.toThrow();
    expect(categoryColor("unknown")).toMatch(/^#/);
    expect(categoryLabel("unknown")).toBeTruthy();
  });
});
