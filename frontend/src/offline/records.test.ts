import { describe, expect, it } from "vitest";
import {
  KNOWN_CATEGORY_SLUGS,
  validateStoredDeletion,
  validateStoredFailureRecord,
  validateStoredInvalidation,
  validateStoredLandmark,
  validateStoredMarker,
  validateStoredSequence,
  validateStoredSignOutIntent,
  validateStoredTrip,
  type Validation,
} from "./records";
import { categoryLabel } from "../map/categoryMarkerStyle";

/**
 * M06-T03 Increment 3a — stored-record validation. Records read from storage
 * are untrusted: every contract is checked exactly, and a rejection reports a
 * reason code only, never any of the record's values.
 */

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIFECYCLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LANDMARK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TRIP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STOP_1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const STOP_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const STOP_3 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const LM_2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const LM_3 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const T1 = "2026-11-26T10:00:00.000Z";
const T2 = "2026-11-26T11:00:00.000Z";
/** Planted synthetic secrets: must never be echoed by a validation result. */
const SECRET = "synthetic-secret-token-7f3a91";

const own = { schema_version: 1, account_id: ACCOUNT, lifecycle_id: LIFECYCLE };

const availableLandmark = () => ({
  ...own,
  revision: 1,
  landmark_id: LANDMARK,
  status: "available",
  display_name: "Synthetic Falls",
  category: "falls",
  latitude: 35.5,
  longitude: -85.5,
  saved_at: T1,
  source_description: null,
  source_access_label: "Public trail",
  source_url: "https://example.test/source",
  refreshed_at: T2,
});

const unavailableLandmark = () => ({
  ...own,
  revision: 2,
  landmark_id: LANDMARK,
  status: "unavailable",
  saved_at: T1,
  unavailable_recorded_at: T2,
});

const availableStop = (
  stopId: string,
  landmarkId: string,
  position: number,
  distance: number | null,
) => ({
  stop_id: stopId,
  position,
  is_available: true,
  distance_from_previous_miles: distance,
  landmark: {
    id: landmarkId,
    display_name: `Stop ${position}`,
    category: "peak",
    latitude: 36,
    longitude: -84,
  },
});

const unavailableStop = (stopId: string, landmarkId: string, position: number) => ({
  stop_id: stopId,
  position,
  is_available: false,
  distance_from_previous_miles: null,
  landmark: { id: landmarkId, is_available: false },
});

const availableTrip = () => ({
  ...own,
  revision: 1,
  trip_id: TRIP,
  status: "available",
  name: "Weekend loop",
  stops: [availableStop(STOP_1, LANDMARK, 0, null), availableStop(STOP_2, LM_2, 1, 2.5)],
  distance_summary: { total_miles: 2.5, measured_legs: 1, total_legs: 1 },
  distance_summary_state: "server",
  saved_at: T1,
  trip_updated_at: T1,
});

const unavailableTrip = () => ({
  ...own,
  revision: 3,
  trip_id: TRIP,
  status: "unavailable",
  saved_at: T1,
  unavailable_recorded_at: T2,
});

function expectRejected<T>(result: Validation<T>) {
  expect(result.ok).toBe(false);
  // A rejection carries a reason code only — never values from the record.
  expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
  expect(JSON.stringify(result).includes(SECRET)).toBe(false); // non-echoing
}

describe("known category slugs", () => {
  it("are exactly the eight backend slugs, each with a real label in the existing map styles", () => {
    expect([...KNOWN_CATEGORY_SLUGS].sort()).toEqual([
      "arch",
      "bald",
      "falls",
      "lake",
      "other",
      "peak",
      "rock",
      "sink",
    ]);
    for (const slug of KNOWN_CATEGORY_SLUGS) expect(categoryLabel(slug)).not.toBe("Landmark");
  });
});

describe("validateStoredLandmark", () => {
  it("accepts a valid available snapshot (with and without the optional fields)", () => {
    expect(validateStoredLandmark(availableLandmark()).ok).toBe(true);
    const minimal: Record<string, unknown> = availableLandmark();
    for (const key of ["source_description", "source_access_label", "source_url", "refreshed_at"]) {
      delete minimal[key];
    }
    expect(validateStoredLandmark(minimal).ok).toBe(true);
  });

  it("accepts a valid unavailable marker", () => {
    expect(validateStoredLandmark(unavailableLandmark()).ok).toBe(true);
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ["missing display_name", (r) => delete r.display_name],
    ["missing saved_at", (r) => delete r.saved_at],
    ["an unknown field (session token)", (r) => (r.token = SECRET)],
    ["an email address", (r) => (r.email = `${SECRET}@example.test`)],
    ["a share URL", (r) => (r.share_url = `https://example.test/shared/trips/${SECRET}`)],
    ["review content", (r) => (r.review = SECRET)],
    ["sensitivity status", (r) => (r.sensitivity_status = "SENSITIVE")],
    ["the redacted flag", (r) => (r.redacted = true)],
    ["schema version 2", (r) => (r.schema_version = 2)],
    ["an upper-case account id", (r) => (r.account_id = ACCOUNT.toUpperCase())],
    ["a non-UUID lifecycle id", (r) => (r.lifecycle_id = SECRET)],
    ["an unknown status", (r) => (r.status = "stale")],
    ["latitude 91", (r) => (r.latitude = 91)],
    ["longitude -181", (r) => (r.longitude = -181)],
    ["NaN latitude", (r) => (r.latitude = Number.NaN)],
    ["Infinity longitude", (r) => (r.longitude = Number.POSITIVE_INFINITY)],
    ["a string latitude", (r) => (r.latitude = "35.5")],
    ["an unknown category", (r) => (r.category = "volcano")],
    ["an empty name", (r) => (r.display_name = "")],
    ["a timestamp without milliseconds", (r) => (r.saved_at = "2026-11-26T10:00:00Z")],
    ["a timestamp with an offset", (r) => (r.saved_at = "2026-11-26T10:00:00.000+01:00")],
    ["an impossible date", (r) => (r.saved_at = "2026-02-30T10:00:00.000Z")],
    ["revision 0", (r) => (r.revision = 0)],
    ["a fractional revision", (r) => (r.revision = 1.5)],
    ["a nested object source", (r) => (r.source_url = { href: SECRET })],
  ])("rejects an available snapshot with %s", (_label, mutate) => {
    const record: Record<string, unknown> = availableLandmark();
    mutate(record);
    expectRejected(validateStoredLandmark(record));
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ["a retained display name", (r) => (r.display_name = SECRET)],
    ["retained coordinates", (r) => Object.assign(r, { latitude: 35, longitude: -85 })],
    ["a retained category", (r) => (r.category = "falls")],
    ["a retained source", (r) => (r.source_url = SECRET)],
    ["refreshed_at", (r) => (r.refreshed_at = T2)],
    ["no unavailable_recorded_at", (r) => delete r.unavailable_recorded_at],
  ])("rejects an unavailable marker with %s", (_label, mutate) => {
    const record: Record<string, unknown> = unavailableLandmark();
    mutate(record);
    expectRejected(validateStoredLandmark(record));
  });

  it.each([null, undefined, 42, "record", [], new Date(), Object.create({ inherited: true })])(
    "rejects a non-record value (%#)",
    (value) => expectRejected(validateStoredLandmark(value)),
  );
});

describe("validateStoredTrip", () => {
  it("accepts a valid available trip, an empty trip, and an unavailable marker", () => {
    expect(validateStoredTrip(availableTrip()).ok).toBe(true);
    expect(
      validateStoredTrip({
        ...availableTrip(),
        stops: [],
        distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
      }).ok,
    ).toBe(true);
    expect(validateStoredTrip(unavailableTrip()).ok).toBe(true);
  });

  it("accepts an unavailable stop placeholder (with the next leg unmeasured) and an invalidated summary", () => {
    const trip = {
      ...availableTrip(),
      stops: [
        availableStop(STOP_1, LANDMARK, 0, null),
        unavailableStop(STOP_2, LM_2, 1),
        availableStop(STOP_3, LM_3, 2, null),
      ],
      distance_summary: null,
      distance_summary_state: "invalidated",
      partially_invalidated_at: T2,
    };
    expect(validateStoredTrip(trip).ok).toBe(true);
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ["sharing state", (r) => (r.is_shared = true)],
    ["sharing_enabled", (r) => (r.sharing_enabled = true)],
    ["a share URL", (r) => (r.share_url = SECRET)],
    ["the trip version", (r) => (r.version = 7)],
    ["created_at", (r) => (r.created_at = T1)],
    ["an owner identifier", (r) => (r.user_id = ACCOUNT)],
    ["an empty name", (r) => (r.name = "")],
    ["a 101-code-point name", (r) => (r.name = "x".repeat(101))],
    ["stops out of order", (r) => (r.stops = [...(r.stops as unknown[])].reverse())],
    ["a position gap", (r) => ((r.stops as Record<string, unknown>[])[1]!.position = 2)],
    ["a duplicate stop id", (r) => ((r.stops as Record<string, unknown>[])[1]!.stop_id = STOP_1)],
    [
      "a duplicate landmark",
      (r) =>
        (((r.stops as Record<string, unknown>[])[1]!.landmark as Record<string, unknown>).id =
          LANDMARK),
    ],
    [
      "a distance on the first stop",
      (r) => ((r.stops as Record<string, unknown>[])[0]!.distance_from_previous_miles = 1),
    ],
    [
      "a negative distance",
      (r) => ((r.stops as Record<string, unknown>[])[1]!.distance_from_previous_miles = -1),
    ],
    [
      "a stop with an extra field",
      (r) => ((r.stops as Record<string, unknown>[])[0]!.note = SECRET),
    ],
    [
      "a stop landmark with an extra field",
      (r) =>
        ((
          (r.stops as Record<string, unknown>[])[0]!.landmark as Record<string, unknown>
        ).sensitivity_status = "SENSITIVE"),
    ],
    [
      "a stop landmark with an unknown category",
      (r) =>
        (((r.stops as Record<string, unknown>[])[0]!.landmark as Record<string, unknown>).category =
          "volcano"),
    ],
    [
      "an inconsistent summary",
      (r) => (r.distance_summary = { total_miles: 9, measured_legs: 1, total_legs: 1 }),
    ],
    [
      "a summary with an extra field",
      (r) =>
        (r.distance_summary = { total_miles: 2.5, measured_legs: 1, total_legs: 1, route: SECRET }),
    ],
    [
      "an invalidated state that keeps summary values",
      (r) => (r.distance_summary_state = "invalidated"),
    ],
    ["an unknown summary state", (r) => (r.distance_summary_state = "client")],
    [
      "26 stops",
      (r) =>
        (r.stops = Array.from({ length: 26 }, (_, i) =>
          unavailableStop(
            `eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, "0")}`,
            `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, "0")}`,
            i,
          ),
        )),
    ],
  ])("rejects an available trip with %s", (_label, mutate) => {
    const record: Record<string, unknown> = JSON.parse(JSON.stringify(availableTrip()));
    mutate(record);
    expectRejected(validateStoredTrip(record));
  });

  it.each<[string, Record<string, unknown>]>([
    [
      "an unavailable stop with a distance",
      { ...unavailableStop(STOP_2, LM_2, 1), distance_from_previous_miles: 1 },
    ],
    [
      "an unavailable stop that keeps the landmark name",
      {
        ...unavailableStop(STOP_2, LM_2, 1),
        landmark: { id: LM_2, is_available: false, display_name: SECRET },
      },
    ],
    [
      "an unavailable stop that keeps coordinates",
      {
        ...unavailableStop(STOP_2, LM_2, 1),
        landmark: { id: LM_2, is_available: false, latitude: 35, longitude: -85 },
      },
    ],
    [
      "a stop with a non-boolean availability",
      { ...unavailableStop(STOP_2, LM_2, 1), is_available: "false" },
    ],
  ])("rejects %s", (_label, stop) => {
    const record = {
      ...availableTrip(),
      stops: [availableStop(STOP_1, LANDMARK, 0, null), stop],
      distance_summary: { total_miles: null, measured_legs: 0, total_legs: 1 },
    };
    expectRejected(validateStoredTrip(record));
  });

  it("rejects a leg measured next to an unavailable stop", () => {
    const record = {
      ...availableTrip(),
      stops: [unavailableStop(STOP_1, LANDMARK, 0), availableStop(STOP_2, LM_2, 1, 3)],
      distance_summary: { total_miles: 3, measured_legs: 1, total_legs: 1 },
    };
    expectRejected(validateStoredTrip(record));
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ["a retained name", (r) => (r.name = SECRET)],
    ["retained stops", (r) => (r.stops = [])],
    ["a retained summary", (r) => (r.distance_summary = null)],
    ["trip_updated_at", (r) => (r.trip_updated_at = T1)],
  ])("rejects an unavailable trip marker with %s", (_label, mutate) => {
    const record: Record<string, unknown> = unavailableTrip();
    mutate(record);
    expectRejected(validateStoredTrip(record));
  });
});

describe("lifecycle and security metadata", () => {
  const marker = () => ({ key: "marker", ...own, verified_at: T1 });
  const sequence = () => ({ key: "sequence", ...own, value: 0 });
  const invalidation = () => ({ ...own, landmark_id: LANDMARK, seq: 1, recorded_at: T1 });
  const deletion = () => ({ ...own, kind: "trip", item_id: TRIP, seq: 2 });
  const intent = () => ({
    key: "signout_intent",
    schema_version: 1,
    pending: true,
    created_at: T1,
  });
  const failure = () => ({ key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T1 });

  it("accepts each valid record", () => {
    expect(validateStoredMarker(marker()).ok).toBe(true);
    expect(validateStoredSequence(sequence()).ok).toBe(true);
    expect(validateStoredInvalidation(invalidation()).ok).toBe(true);
    expect(validateStoredDeletion(deletion()).ok).toBe(true);
    expect(validateStoredSignOutIntent(intent()).ok).toBe(true);
    expect(validateStoredFailureRecord(failure()).ok).toBe(true);
  });

  it.each<[string, () => Validation<unknown>]>([
    [
      "a marker with an email",
      () => validateStoredMarker({ ...marker(), email: `${SECRET}@example.test` }),
    ],
    ["a marker with a session id", () => validateStoredMarker({ ...marker(), session_id: SECRET })],
    ["a marker with a token", () => validateStoredMarker({ ...marker(), token: SECRET })],
    ["a marker without verified_at", () => validateStoredMarker({ key: "marker", ...own })],
    ["a marker with the wrong key", () => validateStoredMarker({ ...marker(), key: "sequence" })],
    [
      "a marker with a non-UUID account",
      () => validateStoredMarker({ ...marker(), account_id: SECRET }),
    ],
    ["a negative sequence", () => validateStoredSequence({ ...sequence(), value: -1 })],
    ["a fractional sequence", () => validateStoredSequence({ ...sequence(), value: 0.5 })],
    [
      "an invalidation with content",
      () => validateStoredInvalidation({ ...invalidation(), display_name: SECRET }),
    ],
    ["an invalidation with seq 0", () => validateStoredInvalidation({ ...invalidation(), seq: 0 })],
    [
      "a deletion of an unknown kind",
      () => validateStoredDeletion({ ...deletion(), kind: "review" }),
    ],
    ["a deletion with content", () => validateStoredDeletion({ ...deletion(), name: SECRET })],
    [
      "an intent with a credential",
      () => validateStoredSignOutIntent({ ...intent(), password: SECRET }),
    ],
    [
      "an intent with an account id",
      () => validateStoredSignOutIntent({ ...intent(), account_id: ACCOUNT }),
    ],
    [
      "an intent that is not pending",
      () => validateStoredSignOutIntent({ ...intent(), pending: false }),
    ],
    [
      "an intent with schema version 2",
      () => validateStoredSignOutIntent({ ...intent(), schema_version: 2 }),
    ],
    ["a failure with details", () => validateStoredFailureRecord({ ...failure(), detail: SECRET })],
    [
      "a failure of an unknown kind",
      () => validateStoredFailureRecord({ ...failure(), kind: "network" }),
    ],
  ])("rejects %s", (_label, validate) => expectRejected(validate()));
});
