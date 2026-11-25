import { describe, expect, it } from "vitest";
import type { NearbyLandmarkView, NearbyResultSet } from "./nearbyLandmarks";
import {
  nearbyMapCaption,
  nearbyMapMarkers,
  nearbyMapPresentation,
  nearbyMarkerBadge,
  nearbyMarkerName,
  nearbyPopupLabel,
  type NearbyMapOrigin,
} from "./nearbyMapMarkers";
import type { NearbyStatus, ShownNearbyResults } from "./useNearbyLandmarks";

/** M05-T05 Increment 3 — what the supplementary nearby map shows, derived only from the shown set. */

const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const ORIGIN: NearbyMapOrigin = {
  stopNumber: 2,
  displayName: "Beta Arch",
  landmarkId: id(999),
  latitude: 35.6,
  longitude: -84.6,
};
const SNAPSHOT = { stopId: "s", landmarkId: id(999), latitude: 35.6, longitude: -84.6 };

function result(
  n: number,
  latitude: number,
  longitude: number,
  extra: Partial<NearbyLandmarkView> = {},
): NearbyLandmarkView {
  return {
    id: id(n),
    display_name: `Place ${n}`,
    category: "falls",
    latitude,
    longitude,
    distance_miles: n / 10,
    inTrip: null,
    ...extra,
  };
}

function set(results: NearbyLandmarkView[], extra: Partial<NearbyResultSet> = {}): NearbyResultSet {
  return {
    origin: SNAPSHOT,
    radius: 25,
    results,
    hasMore: false,
    isTruncated: false,
    malformedCount: 0,
    ...extra,
  };
}

describe("nearbyMapMarkers — exact-coordinate grouping", () => {
  it("puts the origin first, one marker per exact pair, results in server order; nearby points stay separate", () => {
    const markers = nearbyMapMarkers(ORIGIN, [
      result(3, 35.7, -84.7),
      result(1, 35.6000001, -84.6),
      result(2, 35.7, -84.7),
      result(4, 35.6, -84.6),
    ]);
    expect(
      markers.map((m) => [m.key, m.origin?.stopNumber ?? null, m.results.map((r) => r.id)]),
    ).toEqual([
      ["35.6,-84.6", 2, [id(4)]],
      ["35.7,-84.7", null, [id(3), id(2)]],
      ["35.6000001,-84.6", null, [id(1)]],
    ]);
  });

  it("does not assume the origin was in the response: it is always present, from the snapshot", () => {
    const markers = nearbyMapMarkers(ORIGIN, []);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      latitude: 35.6,
      longitude: -84.6,
      origin: ORIGIN,
      results: [],
    });
  });

  it("supports 200 results at distinct points plus the origin, and 200 at the origin's point", () => {
    const spread = Array.from({ length: 200 }, (_, i) => result(i + 1, 36 + i / 1000, -85));
    expect(nearbyMapMarkers(ORIGIN, spread)).toHaveLength(201);
    const stacked = Array.from({ length: 200 }, (_, i) => result(i + 1, 35.6, -84.6));
    const [only] = nearbyMapMarkers(ORIGIN, stacked);
    expect(nearbyMapMarkers(ORIGIN, stacked)).toHaveLength(1);
    expect(nearbyMarkerBadge(only!)).toBe("Stop 2 +200");
    const name = nearbyMarkerName(only!);
    expect(
      name.startsWith(
        "Stop 2 +200, search origin and 200 nearby landmarks at the same location: Beta Arch, search origin; ",
      ),
    ).toBe(true);
    for (let n = 1; n <= 200; n += 1) expect(name).toContain(`Place ${n}, Waterfall,`);
  });
});

describe("badges, names, and popup labels", () => {
  it("origin: 'Stop N' (+k); one result: no text; several: the count — names start with the badge", () => {
    const [origin, single, group] = nearbyMapMarkers(ORIGIN, [
      result(1, 35.8, -84.8, { inTrip: { stopId: "x", stopNumber: 4 } }),
      result(2, 35.9, -84.9),
      result(3, 35.9, -84.9),
    ]);
    expect(nearbyMarkerBadge(origin!)).toBe("Stop 2");
    expect(nearbyMarkerName(origin!)).toBe("Stop 2, search origin: Beta Arch");
    expect(nearbyPopupLabel(origin!)).toBe("Search origin: Stop 2 details");
    expect(nearbyMarkerBadge(single!)).toBe("");
    expect(nearbyMarkerName(single!)).toBe(
      "Place 1, Waterfall, About 0.1 mi (0.2 km), straight-line, in this trip (Stop 4)",
    );
    expect(nearbyPopupLabel(single!)).toBe("Place 1 details");
    expect(nearbyMarkerBadge(group!)).toBe("2");
    expect(nearbyMarkerName(group!)).toBe(
      "2 nearby landmarks at the same location: Place 2, Waterfall, About 0.2 mi (0.3 km), straight-line; Place 3, Waterfall, About 0.3 mi (0.5 km), straight-line",
    );
    expect(nearbyPopupLabel(group!)).toBe("Nearby landmarks at this location");
    for (const m of [origin!, single!, group!]) {
      expect(nearbyMarkerName(m).startsWith(nearbyMarkerBadge(m))).toBe(true);
    }
  });

  it("an origin/result group keeps the search-origin identity first", () => {
    const [group] = nearbyMapMarkers(ORIGIN, [result(5, 35.6, -84.6, { distance_miles: 0 })]);
    expect(nearbyMarkerBadge(group!)).toBe("Stop 2 +1");
    expect(nearbyMarkerName(group!)).toBe(
      "Stop 2 +1, search origin and 1 nearby landmark at the same location: Beta Arch, search origin; Place 5, Waterfall, Less than 0.1 mi (less than 0.2 km), straight-line",
    );
    expect(nearbyPopupLabel(group!)).toBe("Search origin and nearby landmarks at this location");
  });
});

describe("nearbyMapPresentation and captions", () => {
  const listed = set([result(1, 35.8, -84.8), result(2, 35.9, -84.9)]);
  const shown = (s: NearbyResultSet, isCurrent: boolean): ShownNearbyResults => ({
    set: s,
    landmarks: s.results as NearbyLandmarkView[],
    isCurrent,
  });

  it("no map while first loading, after an error with nothing kept, or for an empty result that is not genuine", () => {
    const loading: NearbyStatus = { kind: "loading", origin: SNAPSHOT, radius: 25 };
    expect(nearbyMapPresentation(loading, null)).toEqual({ kind: "none" });
    const failed: NearbyStatus = { kind: "error", origin: SNAPSHOT, radius: 25, failure: "error" };
    expect(nearbyMapPresentation(failed, null)).toEqual({ kind: "none" });
    for (const empty of [
      set([], { malformedCount: 3 }),
      set([], { hasMore: true }),
      set([], { isTruncated: true }),
    ]) {
      expect(nearbyMapPresentation({ kind: "empty", result: empty }, shown(empty, true))).toEqual({
        kind: "none",
      });
    }
  });

  it("a genuine empty result shows the origin only, saying why", () => {
    const empty = set([]);
    const p = nearbyMapPresentation({ kind: "empty", result: empty }, shown(empty, true));
    expect(p).toMatchObject({ kind: "map", originOnly: true });
    expect(
      nearbyMapCaption(p as Extract<typeof p, { kind: "map" }>, { kind: "empty", result: empty }),
    ).toBe(
      "The map shows the search origin only: no other landmarks were found within 25 mi (40.2 km).",
    );
  });

  it("current results; earlier results during an update or after a failure keep THEIR radius", () => {
    const current = nearbyMapPresentation({ kind: "success", result: listed }, shown(listed, true));
    expect(nearbyMapCaption(current as never, { kind: "success", result: listed })).toBe(
      "The map shows the search origin and the 2 landmarks listed above, within 25 mi (40.2 km).",
    );
    const updating: NearbyStatus = {
      kind: "updating",
      origin: SNAPSHOT,
      radius: 50,
      previous: listed,
    };
    const kept = nearbyMapPresentation(updating, shown(listed, false));
    expect(kept).toMatchObject({ kind: "map", isCurrent: false, originOnly: false });
    expect(nearbyMapCaption(kept as never, updating)).toBe(
      "The map still shows the earlier 2 landmarks found within 25 mi (40.2 km), not results for 50 mi (80.5 km).",
    );
    const failed: NearbyStatus = {
      kind: "error",
      origin: SNAPSHOT,
      radius: 5,
      failure: "error",
      previous: listed,
    };
    expect(
      nearbyMapCaption(nearbyMapPresentation(failed, shown(listed, false)) as never, failed),
    ).toBe(
      "The map still shows the earlier 2 landmarks found within 25 mi (40.2 km), not results for 5 mi (8.0 km).",
    );
  });

  it("incomplete coverage is stated for the map too", () => {
    const partial = set([result(1, 35.8, -84.8)], { isTruncated: true });
    const p = nearbyMapPresentation({ kind: "success", result: partial }, shown(partial, true));
    expect(nearbyMapCaption(p as never, { kind: "success", result: partial })).toMatch(
      / Not every landmark within 25 mi \(40\.2 km\) is on the map\.$/,
    );
  });
});
