import { describe, expect, it } from "vitest";
import type { OwnerTrip, TripStop } from "../api/trips";
import {
  nearbyOriginOf,
  parseNearbyResponse,
  withTripMembership,
  type NearbyOrigin,
} from "./nearbyLandmarks";

/** M05-T05 Increment 1 — the pure nearby-landmark data layer. */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TRIP = "11111111-1111-4111-8111-111111111111";

function availableStop(n: number, position: number, lat = 35.5, lng = -84.5): TripStop {
  return {
    id: id(n),
    position,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: id(100 + n),
      display_name: `Stop place ${n}`,
      category: "falls",
      latitude: lat,
      longitude: lng,
    },
  };
}

function unavailableStop(n: number, position: number): TripStop {
  return {
    id: id(n),
    position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: id(100 + n), is_available: false },
  };
}

function trip(stops: TripStop[]): OwnerTrip {
  return {
    id: TRIP,
    name: "Trip",
    version: 1,
    created_at: "2026-11-24T00:00:00.000Z",
    updated_at: "2026-11-24T00:00:00.000Z",
    is_shared: false,
    sharing_enabled: false,
    stops,
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
  };
}

const ORIGIN: NearbyOrigin = {
  stopId: id(1),
  landmarkId: id(101),
  latitude: 35.5,
  longitude: -84.5,
};

function item(n: number, distance: number, overrides: Record<string, unknown> = {}) {
  return {
    id: id(n),
    display_name: `Nearby ${n}`,
    category: "arch",
    latitude: 35.5,
    longitude: -84.5,
    distance_miles: distance,
    ...overrides,
  };
}

function body(items: unknown[], flags: { has_more?: boolean; is_truncated?: boolean } = {}) {
  return {
    items,
    page: 1,
    limit: 200,
    has_more: flags.has_more ?? false,
    is_truncated: flags.is_truncated ?? false,
  };
}

describe("nearbyOriginOf", () => {
  it("returns the stop's ID, landmark ID, and exact coordinates for an available stop", () => {
    const t = trip([availableStop(2, 0, 36.1234567, -85.7654321), availableStop(1, 1)]);
    expect(nearbyOriginOf(t, id(2))).toEqual({
      stopId: id(2),
      landmarkId: id(102),
      latitude: 36.1234567,
      longitude: -85.7654321,
    });
  });

  it("is null for an unavailable or unknown stop, and finds stops by ID, not position", () => {
    const t = trip([unavailableStop(1, 0), availableStop(2, 1)]);
    expect(nearbyOriginOf(t, id(1))).toBeNull();
    expect(nearbyOriginOf(t, id(9))).toBeNull();
    expect(nearbyOriginOf(t, "1")).toBeNull();
    expect(nearbyOriginOf(t, id(2))?.landmarkId).toBe(id(102));
  });
});

describe("parseNearbyResponse", () => {
  it("keeps server order, leaves out the origin by landmark ID, and keeps others at the same point", () => {
    const raw = body([
      item(101, 0), // the origin itself
      item(7, 0), // another landmark at exactly the same coordinates
      item(3, 0.004),
      item(2, 1.25, { display_name: "Alpha" }), // server order kept even where names are not sorted
      item(5, 1.25, { display_name: "Aardvark" }),
    ]);
    const result = parseNearbyResponse(raw, ORIGIN, 25)!;
    expect(result.results.map((r) => [r.id, r.distance_miles])).toEqual([
      [id(7), 0],
      [id(3), 0.004],
      [id(2), 1.25],
      [id(5), 1.25],
    ]);
    expect(result).toMatchObject({ origin: ORIGIN, radius: 25, malformedCount: 0 });
  });

  it("excludes the origin by ID even at other coordinates, and never by coordinates alone", () => {
    const raw = body([
      item(101, 3, { latitude: 36, longitude: -85 }),
      item(8, 0, { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude }),
      { ...item(0, 1), id: id(101).toUpperCase() },
    ]);
    const result = parseNearbyResponse(raw, ORIGIN, 25)!;
    expect(result.results.map((r) => r.id)).toEqual([id(8)]);
  });

  it("returns the validated fields only, with zero and small positive distances as measured values", () => {
    const result = parseNearbyResponse(body([item(4, 0), item(6, 0.0001)]), ORIGIN, 5)!;
    expect(result.results).toEqual([
      {
        id: id(4),
        display_name: "Nearby 4",
        category: "arch",
        latitude: 35.5,
        longitude: -84.5,
        distance_miles: 0,
      },
      {
        id: id(6),
        display_name: "Nearby 6",
        category: "arch",
        latitude: 35.5,
        longitude: -84.5,
        distance_miles: 0.0001,
      },
    ]);
  });

  it("leaves out each malformed item (and repeated IDs), counting them, and keeps the valid ones", () => {
    const bad: unknown[] = [
      null,
      "text",
      item(10, 1, { latitude: 91 }),
      item(11, 1, { longitude: -180.5 }),
      item(12, 1, { latitude: "35.5" }),
      item(13, 1, { latitude: undefined }),
      item(14, -0.1),
      item(15, Number.POSITIVE_INFINITY),
      item(16, 1, { distance_miles: "1" }),
      { ...item(17, 1), distance_miles: undefined },
      (() => {
        const { distance_miles: _d, ...rest } = item(18, 1);
        void _d;
        return rest;
      })(),
      item(19, 1, { id: "not-a-uuid" }),
      item(20, 1, { display_name: "" }),
      item(21, 1, { category: "Bad Category" }),
      item(22, 1, { sensitivity_status: "PUBLIC" }),
      item(23, 1, { latitude: Number.NaN }),
    ];
    const raw = body([item(30, 0.5), ...bad, item(31, 2), item(30, 3)]);
    const result = parseNearbyResponse(raw, ORIGIN, 25)!;
    expect(result.results.map((r) => r.id)).toEqual([id(30), id(31)]);
    expect(result.malformedCount).toBe(bad.length + 1);
  });

  it("rejects an envelope that is not exactly the first 200-item page of the collection shape", () => {
    const good = body([item(2, 1)]);
    const cases: unknown[] = [
      null,
      [],
      { ...good, extra: true },
      (() => {
        const { is_truncated: _t, ...rest } = good;
        void _t;
        return rest;
      })(),
      { ...good, items: "x" },
      { ...good, page: 2 },
      { ...good, limit: 100 },
      { ...good, has_more: "false" },
      { ...good, is_truncated: 0 },
      { ...good, items: Array.from({ length: 201 }, (_, i) => item(1000 + i, 1)) },
    ];
    for (const raw of cases) expect(parseNearbyResponse(raw, ORIGIN, 25)).toBeNull();
    expect(parseNearbyResponse(good, ORIGIN, 30)).toBeNull();
    expect(parseNearbyResponse(good, ORIGIN, 25)).not.toBeNull();
  });

  it("passes has_more and is_truncated through unchanged, even when only the origin was returned", () => {
    const onlyOrigin = parseNearbyResponse(
      body([item(101, 0)], { has_more: true, is_truncated: true }),
      ORIGIN,
      100,
    )!;
    expect(onlyOrigin).toMatchObject({ results: [], hasMore: true, isTruncated: true });
    const full = Array.from({ length: 200 }, (_, i) => item(i === 0 ? 101 : 2000 + i, i / 10));
    const page = parseNearbyResponse(body(full, { has_more: false }), ORIGIN, 100)!;
    expect(page.results).toHaveLength(199);
    expect(page).toMatchObject({ hasMore: false, isTruncated: false });
  });
});

describe("withTripMembership", () => {
  it("marks results already in the trip with that stop's current number, including unavailable stops", () => {
    const stops = [availableStop(1, 0), unavailableStop(2, 1), availableStop(3, 2)];
    const results = [item(103, 0.5), item(9, 1), item(102, 2)].map(
      (r) => parseNearbyResponse(body([r]), ORIGIN, 25)!.results[0]!,
    );
    expect(withTripMembership(results, stops).map((r) => [r.id, r.inTrip])).toEqual([
      [id(103), { stopId: id(3), stopNumber: 3 }],
      [id(9), null],
      [id(102), { stopId: id(2), stopNumber: 2 }],
    ]);
  });

  it("follows the given stops: renumbered after a reorder, cleared after a removal", () => {
    const result = parseNearbyResponse(body([item(103, 1)]), ORIGIN, 25)!.results;
    const s1 = availableStop(1, 0);
    const s3 = availableStop(3, 1);
    expect(withTripMembership(result, [s1, s3])[0]!.inTrip?.stopNumber).toBe(2);
    expect(
      withTripMembership(result, [
        { ...s3, position: 0 },
        { ...s1, position: 1 },
      ])[0]!.inTrip?.stopNumber,
    ).toBe(1);
    expect(withTripMembership(result, [s1])[0]!.inTrip).toBeNull();
  });
});
