import { describe, expect, it } from "vitest";
import type { NearbyResultSet } from "./nearbyLandmarks";
import {
  closedParts,
  emptyText,
  incompleteText,
  isIncomplete,
  malformedText,
  nearbyDistanceText,
  panelStatusParts,
  radiusText,
  shownCaption,
} from "./nearbyMessages";
import type { NearbyStatus } from "./useNearbyLandmarks";

/** M05-T05 Increment 2 — nearby panel wording, derived only from the hook's state. */

const ORIGIN = { stopId: "s", landmarkId: "l", latitude: 35, longitude: -84 };

function set(overrides: Partial<NearbyResultSet> = {}): NearbyResultSet {
  return {
    origin: ORIGIN,
    radius: 25,
    results: [],
    hasMore: false,
    isTruncated: false,
    malformedCount: 0,
    ...overrides,
  };
}

const one = {
  id: "x",
  display_name: "X",
  category: "falls",
  latitude: 35,
  longitude: -84,
  distance_miles: 1,
};

describe("distance and radius wording", () => {
  it("uses the trip formatter in miles and kilometres, labelled straight-line, never computing", () => {
    expect(nearbyDistanceText(0)).toBe("Less than 0.1 mi (less than 0.2 km), straight-line");
    expect(nearbyDistanceText(0.004)).toBe("Less than 0.1 mi (less than 0.2 km), straight-line");
    expect(nearbyDistanceText(0.05)).toBe("About 0.1 mi (0.1 km), straight-line");
    expect(nearbyDistanceText(3.2)).toBe("About 3.2 mi (5.1 km), straight-line");
    expect(radiusText(5)).toBe("5 mi (8.0 km)");
    expect(radiusText(100)).toBe("100 mi (160.9 km)");
  });
});

describe("completeness and malformed results", () => {
  it("is incomplete when EITHER server flag says so, whatever is displayed", () => {
    expect(isIncomplete(set())).toBe(false);
    expect(isIncomplete(set({ hasMore: true }))).toBe(true);
    expect(isIncomplete(set({ isTruncated: true }))).toBe(true);
    expect(incompleteText(set({ radius: 50, isTruncated: true }))).toMatch(
      /^More landmarks are within 50 mi \(80\.5 km\) than are listed here\./,
    );
    expect(malformedText(1)).toBe("1 result could not be displayed.");
    expect(malformedText(3)).toBe("3 results could not be displayed.");
  });

  it("empty: only a complete, fully usable result says nothing else is there", () => {
    expect(emptyText(set())).toBe(
      "No other publicly viewable landmarks were found within 25 mi (40.2 km) of this stop. Try a larger radius.",
    );
    expect(emptyText(set({ radius: 100 }))).toBe(
      "No other publicly viewable landmarks were found within 100 mi (160.9 km) of this stop.",
    );
    expect(emptyText(set({ malformedCount: 2 }))).toBe(
      "No results within 25 mi (40.2 km) can be displayed: the results returned could not be shown.",
    );
    expect(emptyText(set({ hasMore: true }))).toBe(
      "No other landmarks could be listed, although the search reports more matches within 25 mi (40.2 km).",
    );
    for (const s of [set({ malformedCount: 1 }), set({ isTruncated: true })]) {
      expect(emptyText(s)).not.toMatch(/No other publicly viewable/);
    }
  });
});

describe("captions and status", () => {
  it("labels shown results with THEIR radius, never the newly requested one", () => {
    const earlier = set({ radius: 25, results: [one, one] });
    expect(shownCaption(earlier, true, { kind: "success", result: earlier })).toBe(
      "2 landmarks within 25 mi (40.2 km), closest first.",
    );
    const updating: NearbyStatus = {
      kind: "updating",
      origin: ORIGIN,
      radius: 50,
      previous: earlier,
    };
    expect(shownCaption(earlier, false, updating)).toBe(
      "Showing the earlier 2 landmarks found within 25 mi (40.2 km) while the search within 50 mi (80.5 km) loads.",
    );
    const failed: NearbyStatus = {
      kind: "error",
      origin: ORIGIN,
      radius: 5,
      failure: "error",
      previous: earlier,
    };
    expect(shownCaption(earlier, false, failed)).toBe(
      "The search within 5 mi (8.0 km) failed. Still showing the earlier 2 landmarks found within 25 mi (40.2 km).",
    );
  });

  it("status line: loading, updating, results with notes, empty; none for errors and closed", () => {
    const origin = { stopId: "s", stopNumber: 2, displayName: "Beta" };
    expect(panelStatusParts({ kind: "loading", origin: ORIGIN, radius: 10 }, origin)).toEqual([
      "Finding landmarks within 10 mi (16.1 km) of Stop 2…",
    ]);
    const ok = set({ results: [one], isTruncated: true, malformedCount: 1 });
    expect(panelStatusParts({ kind: "success", result: ok }, origin).join("")).toBe(
      "1 landmark within 25 mi (40.2 km), closest first. Not every landmark in this radius is listed. 1 result could not be displayed.",
    );
    expect(panelStatusParts({ kind: "empty", result: set() }, origin)).toEqual([emptyText(set())]);
    expect(
      panelStatusParts(
        { kind: "error", origin: ORIGIN, radius: 25, failure: "invalid_response" },
        origin,
      ),
    ).toEqual([]);
    expect(panelStatusParts({ kind: "closed", reason: null }, origin)).toEqual([]);
  });

  it("closure notices only for changes to the stop", () => {
    expect(closedParts("origin_removed")).toEqual([
      "The nearby search was closed because its stop was removed from the trip.",
    ]);
    expect(closedParts("origin_unavailable")?.join("")).toMatch(/no longer available/);
    expect(closedParts("origin_changed")?.join("")).toMatch(/location changed/);
    expect(closedParts(null)).toBeNull();
    expect(closedParts("session_ended")).toBeNull();
    expect(closedParts("trip_unavailable")).toBeNull();
  });
});
