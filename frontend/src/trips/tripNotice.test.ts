import { describe, expect, it } from "vitest";
import {
  createdTripState,
  readCreatedTripNotice,
  readTripsListNotice,
  tripsListState,
} from "./tripNotice";

/** M05-T06 Increment 2 — the one-time created-trip notice carried in history state. */

const TRIP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("created-trip notice", () => {
  it("round-trips through history state, lower-casing the trip ID", () => {
    const state = createdTripState({ userId: USER, tripId: TRIP.toUpperCase(), name: "Falls" });
    expect(readCreatedTripNotice(state)).toEqual({
      kind: "trip-created",
      userId: USER,
      tripId: TRIP,
      name: "Falls",
    });
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "trip-created"],
    ["no notice key", { other: 1 }],
    [
      "a wrong kind",
      { tripNotice: { kind: "trip-deleted", userId: USER, tripId: TRIP, name: "x" } },
    ],
    ["a missing user", { tripNotice: { kind: "trip-created", tripId: TRIP, name: "x" } }],
    [
      "an empty user",
      { tripNotice: { kind: "trip-created", userId: "", tripId: TRIP, name: "x" } },
    ],
    [
      "a malformed trip ID",
      { tripNotice: { kind: "trip-created", userId: USER, tripId: "t", name: "x" } },
    ],
    ["a missing name", { tripNotice: { kind: "trip-created", userId: USER, tripId: TRIP } }],
    [
      "an empty name",
      { tripNotice: { kind: "trip-created", userId: USER, tripId: TRIP, name: "" } },
    ],
    [
      "a non-string name",
      { tripNotice: { kind: "trip-created", userId: USER, tripId: TRIP, name: 5 } },
    ],
  ])("ignores %s", (_label, state) => {
    expect(readCreatedTripNotice(state)).toBeNull();
  });
});

describe("My Trips notice (Increment 3)", () => {
  it("round-trips confirmed deletion and unavailability", () => {
    const deleted = { kind: "trip-deleted", userId: USER, name: "Falls" } as const;
    const unavailable = { kind: "trip-unavailable", userId: USER, uncertain: true } as const;
    expect(readTripsListNotice(tripsListState(deleted))).toEqual(deleted);
    expect(readTripsListNotice(tripsListState(unavailable))).toEqual(unavailable);
  });

  it("is not confused with a creation notice, and vice versa", () => {
    const created = createdTripState({ userId: USER, tripId: TRIP, name: "Falls" });
    expect(readTripsListNotice(created)).toBeNull();
    expect(
      readCreatedTripNotice(tripsListState({ kind: "trip-deleted", userId: USER, name: "x" })),
    ).toBeNull();
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["no user", { tripNotice: { kind: "trip-deleted", name: "x" } }],
    ["an empty user", { tripNotice: { kind: "trip-deleted", userId: "", name: "x" } }],
    ["a deletion without a name", { tripNotice: { kind: "trip-deleted", userId: USER } }],
    ["an empty name", { tripNotice: { kind: "trip-deleted", userId: USER, name: "" } }],
    ["unavailability without the flag", { tripNotice: { kind: "trip-unavailable", userId: USER } }],
    [
      "a non-boolean flag",
      { tripNotice: { kind: "trip-unavailable", userId: USER, uncertain: "yes" } },
    ],
    ["an unknown kind", { tripNotice: { kind: "trip-renamed", userId: USER, name: "x" } }],
  ])("ignores %s", (_label, state) => {
    expect(readTripsListNotice(state)).toBeNull();
  });
});
