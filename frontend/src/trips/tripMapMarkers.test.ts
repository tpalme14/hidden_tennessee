import { describe, expect, it } from "vitest";
import type { TripStop } from "../api/trips";
import {
  mappedLocationsKey,
  tripMapMarkers,
  tripMarkerBadge,
  tripMarkerName,
  tripPopupLabel,
} from "./tripMapMarkers";

/** M05-T04 Increment 4 — what the trip map shows, derived from validated stops only. */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function available(position: number, lat = 35 + position / 10): TripStop {
  return {
    id: id(position),
    position,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: id(100 + position),
      display_name: `Falls ${position}`,
      category: "falls",
      latitude: lat,
      longitude: -84,
    },
  };
}

function unavailable(position: number): TripStop {
  return {
    id: id(position),
    position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: id(100 + position), is_available: false },
  };
}

describe("tripMapMarkers", () => {
  it("maps only available stops, one marker per exact location, numbered position + 1 with gaps kept", () => {
    const markers = tripMapMarkers([available(0), unavailable(1), available(2)]);
    expect(markers).toEqual([
      {
        key: "35,-84",
        latitude: 35,
        longitude: -84,
        stops: [
          {
            stopId: id(0),
            number: 1,
            landmarkId: id(100),
            displayName: "Falls 0",
            category: "falls",
          },
        ],
      },
      {
        key: "35.2,-84",
        latitude: 35.2,
        longitude: -84,
        stops: [
          {
            stopId: id(2),
            number: 3,
            landmarkId: id(102),
            displayName: "Falls 2",
            category: "falls",
          },
        ],
      },
    ]);
  });

  it("groups exactly equal coordinates only (never rounded), in trip order", () => {
    const a = available(0, 35.5);
    const b = available(1, 35.5);
    const c = available(2, 35.5000000001);
    const markers = tripMapMarkers([b, c, a].map((s, i) => ({ ...s, position: i }) as TripStop));
    expect(markers.map((m) => m.stops.map((s) => s.number))).toEqual([[1, 3], [2]]);
    expect(tripMarkerBadge(markers[0]!)).toBe("1,3");
  });

  it("badge rule: one number; two numbers; then the first two and +k for the exact remainder", () => {
    const group = (n: number) =>
      tripMapMarkers(
        Array.from({ length: n }, (_, i) => ({ ...available(i, 35.5), position: i }) as TripStop),
      )[0]!;
    expect(tripMarkerBadge(group(1))).toBe("1");
    expect(tripMarkerBadge(group(2))).toBe("1,2");
    expect(tripMarkerBadge(group(3))).toBe("1,2 +1");
    expect(tripMarkerBadge(group(25))).toBe("1,2 +23");
    expect(tripMarkerName(group(3))).toBe(
      "Stops 1,2 +1, 3 at the same location: Stop 1: Falls 0, Waterfall; Stop 2: Falls 1, Waterfall; Stop 3: Falls 2, Waterfall",
    );
    expect(tripMarkerName(group(25)).startsWith("Stops 1,2 +23, 25 at the same location: ")).toBe(
      true,
    );
    expect(tripPopupLabel(group(2))).toBe("Stops 1 and 2 details");
    expect(tripPopupLabel(group(1))).toBe("Stop 1: Falls 0 details");
  });

  it("is empty for no stops and for only unavailable stops", () => {
    expect(tripMapMarkers([])).toEqual([]);
    expect(tripMapMarkers([unavailable(0), unavailable(1)])).toEqual([]);
  });

  it("names a marker by stop number, landmark name, and category", () => {
    expect(tripMarkerName(tripMapMarkers([unavailable(0), available(1)])[0]!)).toBe(
      "Stop 2: Falls 1, Waterfall",
    );
  });
});

describe("mappedLocationsKey", () => {
  it("does not change when stops are only renumbered (reordered)", () => {
    const before = tripMapMarkers([available(0, 35), available(1, 36)]);
    const swapped: TripStop[] = [
      { ...available(1, 36), position: 0 },
      { ...available(0, 35), position: 1 },
    ];
    expect(mappedLocationsKey(tripMapMarkers(swapped))).toBe(mappedLocationsKey(before));
  });

  it("changes when a mapped stop is removed or becomes unavailable", () => {
    const all = mappedLocationsKey(tripMapMarkers([available(0), available(1)]));
    expect(mappedLocationsKey(tripMapMarkers([available(0)]))).not.toBe(all);
    expect(mappedLocationsKey(tripMapMarkers([available(0), unavailable(1)]))).not.toBe(all);
  });
});
