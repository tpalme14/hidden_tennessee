import { describe, expect, it, vi } from "vitest";
import { resolveTripSharingEnabled } from "../src/config/trip-sharing.js";
import { createFavoritesRateLimiter } from "../src/favorites/rate-limit.js";
import {
  notFoundEnvelope,
  tripSharingUnavailableEnvelope,
  tripStopAlreadyExistsEnvelope,
  tripStopLimitReachedEnvelope,
  tripVersionConflictEnvelope,
} from "../src/http/error-envelope.js";
import { createReviewsRateLimiter } from "../src/reviews/rate-limit.js";
import {
  DEFAULT_TRIPS_RATE_LIMITS,
  DEFAULT_TRIPS_RATE_MAX_KEYS,
  DEFAULT_TRIPS_RATE_WINDOW_MS,
  TRIPS_RATE_LIMIT_CAPACITY_EVENT,
  createTripsRateLimiter,
} from "../src/trips/rate-limit.js";

/**
 * M05-T03 Increment 1 — the trips API foundation: the TRIP_SHARING_ENABLED
 * defaults (spec v1.1 §10.6; ADR-014 decision 10), the four trip error
 * envelopes (spec v1.1 §7.3; ADR-014 decision 3), and the trips limiter
 * (spec v1.1 §7.1; ADR-014 decision 9).
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

function clock() {
  let t = 7_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("TRIP_SHARING_ENABLED", () => {
  it("defaults to OFF in production and ON in development and test", () => {
    expect(resolveTripSharingEnabled(undefined, "production")).toBe(false);
    expect(resolveTripSharingEnabled("", "production")).toBe(false);
    expect(resolveTripSharingEnabled(undefined, "development")).toBe(true);
    expect(resolveTripSharingEnabled(undefined, "test")).toBe(true);
    expect(resolveTripSharingEnabled("", "test")).toBe(true);
  });

  it("respects explicit values in every environment", () => {
    for (const nodeEnv of ["production", "development", "test"]) {
      expect(resolveTripSharingEnabled("true", nodeEnv)).toBe(true);
      expect(resolveTripSharingEnabled("1", nodeEnv)).toBe(true);
      expect(resolveTripSharingEnabled("false", nodeEnv)).toBe(false);
      expect(resolveTripSharingEnabled("0", nodeEnv)).toBe(false);
    }
  });

  it("refuses any other value at startup, without echoing it", () => {
    for (const bad of ["TRUE", "yes", "on", "2", " true", "enabled"]) {
      expect(() => resolveTripSharingEnabled(bad, "production")).toThrow(
        'Environment variable TRIP_SHARING_ENABLED must be "true" or "false"',
      );
    }
  });
});

describe("trip error envelopes", () => {
  it("have the approved codes, fixed messages, and the standard envelope shape", () => {
    expect(tripStopAlreadyExistsEnvelope()).toEqual({
      error: { code: "TRIP_STOP_ALREADY_EXISTS", message: "This landmark is already in the trip." },
    });
    expect(tripStopLimitReachedEnvelope()).toEqual({
      error: { code: "TRIP_STOP_LIMIT_REACHED", message: "A trip can have at most 25 stops." },
    });
    expect(tripVersionConflictEnvelope()).toEqual({
      error: {
        code: "TRIP_VERSION_CONFLICT",
        message: "This trip has changed. Reload it and try again.",
      },
    });
    expect(tripSharingUnavailableEnvelope()).toEqual({
      error: { code: "TRIP_SHARING_UNAVAILABLE", message: "Trip sharing is not available." },
    });
  });

  it("share the shape of the existing envelopes and contain no identifiers", () => {
    for (const envelope of [
      tripStopAlreadyExistsEnvelope(),
      tripStopLimitReachedEnvelope(),
      tripVersionConflictEnvelope(),
      tripSharingUnavailableEnvelope(),
    ]) {
      expect(Object.keys(envelope)).toEqual(Object.keys(notFoundEnvelope()));
      expect(Object.keys(envelope.error).sort()).toEqual(["code", "message"]);
      expect(JSON.stringify(envelope)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });
});

describe("trips limiter (spec §7.1)", () => {
  it("defaults to 60 mutations and 120 reads per 60-second window, with a 10,000-key cap", () => {
    expect(DEFAULT_TRIPS_RATE_LIMITS).toEqual({ read: 120, mutation: 60 });
    expect(DEFAULT_TRIPS_RATE_WINDOW_MS).toBe(60_000);
    expect(DEFAULT_TRIPS_RATE_MAX_KEYS).toBe(10_000);
    expect(TRIPS_RATE_LIMIT_CAPACITY_EVENT).toBe("TRIPS_RATE_LIMIT_CAPACITY");
  });

  it("allows exactly 60 mutations, then refuses with the remaining window as Retry-After", () => {
    const c = clock();
    const limiter = createTripsRateLimiter({ now: c.now });
    for (let i = 0; i < 60; i += 1) {
      expect(limiter.consume("mutation", A)).toEqual({ allowed: true });
    }
    c.advance(30_000);
    expect(limiter.consume("mutation", A)).toEqual({
      allowed: false,
      reason: "limit",
      retryAfterSeconds: 30,
    });
    c.advance(30_000);
    expect(limiter.consume("mutation", A)).toEqual({ allowed: true });
  });

  it("allows exactly 120 reads; buckets and users are independent", () => {
    const c = clock();
    const limiter = createTripsRateLimiter({ now: c.now });
    for (let i = 0; i < 120; i += 1) expect(limiter.consume("read", A).allowed).toBe(true);
    expect(limiter.consume("read", A).allowed).toBe(false);
    expect(limiter.consume("mutation", A).allowed).toBe(true);
    expect(limiter.consume("read", B).allowed).toBe(true);
  });

  it("is independent of the reviews and favorites limiters", () => {
    const c = clock();
    const trips = createTripsRateLimiter({ now: c.now });
    const reviews = createReviewsRateLimiter({ now: c.now });
    const favorites = createFavoritesRateLimiter({ now: c.now });
    for (let i = 0; i < 60; i += 1) trips.consume("mutation", A);
    expect(trips.consume("mutation", A).allowed).toBe(false);
    expect(reviews.consume("mutation", A).allowed).toBe(true);
    expect(favorites.consume("mutation", A).allowed).toBe(true);
  });

  it("refuses a NEW key at capacity with its own event code, logged once per fill", () => {
    const c = clock();
    const log = vi.fn();
    const limiter = createTripsRateLimiter({ now: c.now, maxKeys: 2, log });
    expect(limiter.consume("read", A).allowed).toBe(true);
    expect(limiter.consume("read", B).allowed).toBe(true);
    const third = "cccccccc-0000-4000-8000-000000000003";
    expect(limiter.consume("read", third)).toEqual({
      allowed: false,
      reason: "capacity",
      retryAfterSeconds: 60,
    });
    expect(limiter.consume("read", third).allowed).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[1])).toContain(TRIPS_RATE_LIMIT_CAPACITY_EVENT);
    expect(limiter.consume("read", A).allowed).toBe(true);
  });
});
