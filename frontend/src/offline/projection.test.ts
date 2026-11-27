import { describe, expect, it } from "vitest";
import {
  projectAvailableLandmark,
  projectAvailableTrip,
  projectUnavailableLandmark,
  projectUnavailableTrip,
  type ProjectionContext,
} from "./projection";
import { validateStoredLandmark, validateStoredTrip } from "./records";

/**
 * M06-T03 Increment 3a — projection of validated API data into persisted
 * records: field-by-field from the allowlist, never a copied response.
 */

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIFECYCLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LANDMARK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LM_2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const LM_3 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const TRIP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STOP_1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const STOP_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const STOP_3 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const T1 = "2026-11-26T10:00:00.000Z";
const T2 = "2026-11-26T11:00:00.000Z";
/** Planted values that must never reach a projected record. */
const PLANTED_VERSION = 987_654_321;
const PLANTED_CREATED = "2001-02-03T04:05:06.789Z";
const SECRET = "synthetic-secret-token-7f3a91";

const context: ProjectionContext = {
  account_id: ACCOUNT,
  lifecycle_id: LIFECYCLE,
  revision: 1,
  saved_at: T1,
};

const fullProfile = () => ({
  id: LANDMARK,
  display_name: "Synthetic Falls",
  category: "falls",
  latitude: 35.5,
  longitude: -85.5,
  source_description: "From the import",
  source_access_label: null,
  source_url: "https://example.test/source",
});

const ownerTripResponse = (stops: unknown[], summary: unknown) => ({
  trip: {
    id: TRIP,
    name: "Weekend loop",
    version: PLANTED_VERSION,
    created_at: PLANTED_CREATED,
    updated_at: T2,
    is_shared: true,
    sharing_enabled: true,
    stops,
    distance_summary: summary,
  },
});

const responseStop = (id: string, landmark: string, position: number, distance: number | null) => ({
  id,
  position,
  is_available: true,
  distance_from_previous_miles: distance,
  landmark: {
    id: landmark,
    display_name: `Stop ${position}`,
    category: "peak",
    latitude: 36,
    longitude: -84,
  },
});

describe("projectAvailableLandmark", () => {
  it("builds exactly the allowlisted snapshot from a validated full profile", () => {
    const record = projectAvailableLandmark(fullProfile(), LANDMARK, {
      ...context,
      refreshed_at: T2,
    });
    expect(record).toEqual({
      schema_version: 1,
      account_id: ACCOUNT,
      lifecycle_id: LIFECYCLE,
      revision: 1,
      landmark_id: LANDMARK,
      status: "available",
      display_name: "Synthetic Falls",
      category: "falls",
      latitude: 35.5,
      longitude: -85.5,
      saved_at: T1,
      source_description: "From the import",
      source_access_label: null,
      source_url: "https://example.test/source",
      refreshed_at: T2,
    });
    expect(validateStoredLandmark(record).ok).toBe(true);
  });

  it("omits refreshed_at on a first save", () => {
    expect(projectAvailableLandmark(fullProfile(), LANDMARK, context)).not.toHaveProperty(
      "refreshed_at",
    );
  });

  it.each<[string, () => unknown, string]>([
    [
      "a minimal (redacted) profile",
      () => ({ id: LANDMARK, display_name: "X", category: "falls", redacted: true }),
      LANDMARK,
    ],
    [
      "a full profile carrying a redacted flag",
      () => ({ ...fullProfile(), redacted: false }),
      LANDMARK,
    ],
    ["a profile carrying a token", () => ({ ...fullProfile(), token: SECRET }), LANDMARK],
    [
      "a profile carrying sensitivity",
      () => ({ ...fullProfile(), sensitivity_status: "SENSITIVE" }),
      LANDMARK,
    ],
    ["a mismatched id", () => fullProfile(), LM_2],
    ["an unknown category", () => ({ ...fullProfile(), category: "volcano" }), LANDMARK],
    ["out-of-range coordinates", () => ({ ...fullProfile(), latitude: 120 }), LANDMARK],
    ["a non-object", () => SECRET, LANDMARK],
  ])("rejects %s (never projects anything)", (_label, profile, requested) => {
    expect(projectAvailableLandmark(profile(), requested, context)).toBeNull();
  });
});

describe("projectUnavailableLandmark", () => {
  it("keeps only the identifier and the original saved_at — no protected field of the available record", () => {
    const available = projectAvailableLandmark(
      { ...fullProfile(), display_name: SECRET, source_url: `https://example.test/${SECRET}` },
      LANDMARK,
      { ...context, refreshed_at: T2 },
    )!;
    const marker = projectUnavailableLandmark(available, T2, 2)!;
    // Non-echoing assertions: a failure must never print the planted values.
    expect(Object.keys(marker).sort()).toEqual(
      [
        "schema_version",
        "account_id",
        "lifecycle_id",
        "revision",
        "landmark_id",
        "status",
        "saved_at",
        "unavailable_recorded_at",
      ].sort(),
    );
    expect([marker.landmark_id, marker.status, marker.saved_at, marker.revision]).toEqual([
      LANDMARK,
      "unavailable",
      T1,
      2,
    ]);
    expect([marker.account_id, marker.lifecycle_id, marker.unavailable_recorded_at]).toEqual([
      ACCOUNT,
      LIFECYCLE,
      T2,
    ]);
    expect(JSON.stringify(marker).includes(SECRET)).toBe(false);
    expect(JSON.stringify(marker).includes("35.5")).toBe(false);
  });
});

describe("projectAvailableTrip", () => {
  it("builds exactly the allowlisted snapshot; version, sharing, and created_at are never copied", () => {
    const response = ownerTripResponse(
      [responseStop(STOP_1, LANDMARK, 0, null), responseStop(STOP_2, LM_2, 1, 2.5)],
      { total_miles: 2.5, measured_legs: 1, total_legs: 1 },
    );
    const record = projectAvailableTrip(response, TRIP, context)!;
    expect(Object.keys(record).sort()).toEqual(
      [
        "schema_version",
        "account_id",
        "lifecycle_id",
        "revision",
        "trip_id",
        "status",
        "name",
        "stops",
        "distance_summary",
        "distance_summary_state",
        "saved_at",
        "trip_updated_at",
      ].sort(),
    );
    expect(record.stops[1]).toEqual({
      stop_id: STOP_2,
      position: 1,
      is_available: true,
      distance_from_previous_miles: 2.5,
      landmark: {
        id: LM_2,
        display_name: "Stop 1",
        category: "peak",
        latitude: 36,
        longitude: -84,
      },
    });
    expect(record.distance_summary_state).toBe("server");
    expect(record.trip_updated_at).toBe(T2);
    const json = JSON.stringify(record);
    expect(json).not.toContain(String(PLANTED_VERSION));
    expect(json).not.toContain(PLANTED_CREATED);
    expect(json).not.toMatch(/is_shared|sharing_enabled|"version"/);
    expect(validateStoredTrip(record).ok).toBe(true);
  });

  it("keeps an unavailable stop as the exact placeholder", () => {
    const response = ownerTripResponse(
      [
        responseStop(STOP_1, LANDMARK, 0, null),
        {
          id: STOP_2,
          position: 1,
          is_available: false,
          distance_from_previous_miles: null,
          landmark: { id: LM_2, is_available: false },
        },
        responseStop(STOP_3, LM_3, 2, null),
      ],
      { total_miles: null, measured_legs: 0, total_legs: 2 },
    );
    const record = projectAvailableTrip(response, TRIP, context)!;
    expect(record.stops[1]).toEqual({
      stop_id: STOP_2,
      position: 1,
      is_available: false,
      distance_from_previous_miles: null,
      landmark: { id: LM_2, is_available: false },
    });
  });

  it.each<[string, () => unknown, string]>([
    [
      "a response with a share URL",
      () => ({
        ...ownerTripResponse([], { total_miles: null, measured_legs: 0, total_legs: 0 }),
        share_url: SECRET,
      }),
      TRIP,
    ],
    [
      "a trip with an extra field",
      () => {
        const r = ownerTripResponse([], { total_miles: null, measured_legs: 0, total_legs: 0 });
        (r.trip as Record<string, unknown>).owner_email = SECRET;
        return r;
      },
      TRIP,
    ],
    [
      "a mismatched trip id",
      () => ownerTripResponse([], { total_miles: null, measured_legs: 0, total_legs: 0 }),
      "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
    ],
    [
      "a stop landmark with an unknown category",
      () =>
        ownerTripResponse(
          [
            {
              ...responseStop(STOP_1, LANDMARK, 0, null),
              landmark: {
                id: LANDMARK,
                display_name: "X",
                category: "volcano",
                latitude: 1,
                longitude: 1,
              },
            },
          ],
          { total_miles: null, measured_legs: 0, total_legs: 0 },
        ),
      TRIP,
    ],
    ["an invalid response", () => ({ trip: SECRET }), TRIP],
  ])("rejects %s", (_label, response, requested) => {
    expect(projectAvailableTrip(response(), requested, context)).toBeNull();
  });
});

describe("projectUnavailableTrip", () => {
  it("keeps only the identifier and the original saved_at", () => {
    const available = projectAvailableTrip(
      ownerTripResponse([responseStop(STOP_1, LANDMARK, 0, null)], {
        total_miles: null,
        measured_legs: 0,
        total_legs: 0,
      }),
      TRIP,
      context,
    )!;
    const marker = projectUnavailableTrip(available, T2, 4);
    expect(marker).toEqual({
      schema_version: 1,
      account_id: ACCOUNT,
      lifecycle_id: LIFECYCLE,
      revision: 4,
      trip_id: TRIP,
      status: "unavailable",
      saved_at: T1,
      unavailable_recorded_at: T2,
    });
    expect(JSON.stringify(marker)).not.toMatch(/Weekend loop|stops|distance|trip_updated_at/);
  });
});
