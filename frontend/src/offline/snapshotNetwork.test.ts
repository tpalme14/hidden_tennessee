import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { fetchLandmark, fetchTrip } from "./snapshotNetwork";

/**
 * M06-T03 Increment 3d — snapshot response classification (OFF-EV-1/2/3).
 * Only `unavailable` is authoritative; 401 is an authentication failure;
 * transient and invalid responses are never authoritative.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const TRIP = "22222222-2222-4222-8222-222222222222";
const T = "2026-11-20T10:00:00.000Z";

const full = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  display_name: "Falls",
  category: "falls",
  latitude: 36.1,
  longitude: -84.1,
  source_description: null,
  source_access_label: null,
  source_url: null,
  ...overrides,
});
const ok = (body: unknown) => () => Promise.resolve(body);
const fail = (error: unknown) => () => Promise.reject(error);

describe("fetchLandmark", () => {
  it("a validated full profile with the requested id is available", async () => {
    expect(await fetchLandmark(ID, ok(full()))).toEqual({ kind: "available", body: full() });
  });

  it("a valid minimal redacted profile is authoritative unavailability (redacted)", async () => {
    const minimal = { id: ID, display_name: "Falls", category: "falls", redacted: true };
    expect(await fetchLandmark(ID, ok(minimal))).toEqual({
      kind: "unavailable",
      evidence: "redacted",
    });
  });

  it.each([
    ["a mismatched id", full({ id: TRIP })],
    ["an extra field", { ...full(), version: 3 }],
    ["out-of-range coordinates", full({ latitude: 91 })],
    [
      "a minimal profile without the redacted flag",
      { id: ID, display_name: "F", category: "falls" },
    ],
  ])("%s is invalid, never available", async (_label, body) => {
    expect(await fetchLandmark(ID, ok(body))).toEqual({ kind: "invalid" });
  });

  it.each([
    [
      "a 404 with the JSON envelope",
      new ApiError(404, "NOT_FOUND", "x"),
      { kind: "unavailable", evidence: "not-found" },
    ],
    [
      "a 404 without the envelope code",
      new ApiError(404, "UNKNOWN_ERROR", "x"),
      { kind: "invalid" },
    ],
    ["a 401", new ApiError(401, "UNAUTHENTICATED", "x"), { kind: "auth" }],
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "x"), { kind: "transient" }],
    ["a 429", new ApiError(429, "RATE_LIMITED", "x"), { kind: "transient" }],
    ["a 503", new ApiError(503, "SERVICE_UNAVAILABLE", "x"), { kind: "transient" }],
    ["a 400", new ApiError(400, "VALIDATION_ERROR", "x"), { kind: "invalid" }],
    ["a malformed body", new ApiError(200, "INVALID_RESPONSE", "x"), { kind: "invalid" }],
    ["a non-API error", new Error("boom"), { kind: "invalid" }],
  ])("%s is classified correctly", async (_label, error, expected) => {
    expect(await fetchLandmark(ID, fail(error))).toEqual(expected);
  });
});

describe("fetchTrip", () => {
  const trip = (id = TRIP) => ({
    trip: {
      id,
      name: "Trip",
      version: 1,
      created_at: T,
      updated_at: T,
      is_shared: false,
      sharing_enabled: false,
      stops: [],
      distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
    },
  });

  it("a validated owner trip with the requested id is available", async () => {
    expect(await fetchTrip(TRIP, ok(trip()))).toEqual({ kind: "available", body: trip() });
  });

  it.each([
    ["a mismatched id", trip(ID)],
    ["an unwrapped trip", trip().trip],
  ])("%s is invalid", async (_label, body) => {
    expect(await fetchTrip(TRIP, ok(body))).toEqual({ kind: "invalid" });
  });

  it.each([
    [new ApiError(404, "NOT_FOUND", "x"), "unavailable"],
    [new ApiError(401, "UNAUTHENTICATED", "x"), "auth"],
    [new ApiError(500, "INTERNAL", "x"), "transient"],
    [new ApiError(403, "FORBIDDEN", "x"), "invalid"],
  ])("%o is %s", async (error, kind) => {
    expect(await fetchTrip(TRIP, fail(error))).toEqual({ kind });
  });
});
