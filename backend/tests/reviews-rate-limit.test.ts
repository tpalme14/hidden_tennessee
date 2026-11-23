import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FAVORITES_RATE_LIMITS,
  RATE_LIMIT_CAPACITY_EVENT,
  createFavoritesRateLimiter,
} from "../src/favorites/rate-limit.js";
import { createUserRateLimiter } from "../src/http/user-rate-limiter.js";
import {
  DEFAULT_REVIEWS_RATE_LIMITS,
  DEFAULT_REVIEWS_RATE_MAX_KEYS,
  DEFAULT_REVIEWS_RATE_WINDOW_MS,
  REVIEWS_RATE_LIMIT_CAPACITY_EVENT,
  createReviewsRateLimiter,
} from "../src/reviews/rate-limit.js";

/**
 * Unit tests for M04-T02 Increment 3: the reviews limiter's approved limits
 * (R1), its own capacity event, and independence from favorites, on top of
 * the extracted generic limiter (R2(a)). The favorites limiter's own suite
 * (tests/favorites-rate-limit.test.ts) runs unchanged against the extraction.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

function clock() {
  let t = 5_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("reviews limiter (R1)", () => {
  it("defaults to 20 mutations and 120 reads per 60-second window, with a 10,000-key cap", () => {
    expect(DEFAULT_REVIEWS_RATE_LIMITS).toEqual({ read: 120, mutation: 20 });
    expect(DEFAULT_REVIEWS_RATE_WINDOW_MS).toBe(60_000);
    expect(DEFAULT_REVIEWS_RATE_MAX_KEYS).toBe(10_000);
    expect(REVIEWS_RATE_LIMIT_CAPACITY_EVENT).toBe("REVIEWS_RATE_LIMIT_CAPACITY");
  });

  it("allows exactly 20 mutations, then refuses with the remaining window as Retry-After", () => {
    const c = clock();
    const limiter = createReviewsRateLimiter({ now: c.now });
    for (let i = 0; i < 20; i += 1)
      expect(limiter.consume("mutation", A)).toEqual({ allowed: true });
    c.advance(59_001);
    expect(limiter.consume("mutation", A)).toEqual({
      allowed: false,
      reason: "limit",
      retryAfterSeconds: 1,
    });
    c.advance(999);
    expect(limiter.consume("mutation", A)).toEqual({ allowed: true });
  });

  it("allows exactly 120 reads; the read and mutation buckets and users are independent", () => {
    const c = clock();
    const limiter = createReviewsRateLimiter({ now: c.now });
    for (let i = 0; i < 120; i += 1) expect(limiter.consume("read", A).allowed).toBe(true);
    expect(limiter.consume("read", A)).toEqual({
      allowed: false,
      reason: "limit",
      retryAfterSeconds: 60,
    });
    expect(limiter.consume("mutation", A).allowed).toBe(true);
    expect(limiter.consume("read", B).allowed).toBe(true);
  });

  it("refuses a new key at the cap, logging only its own event code, once", () => {
    const c = clock();
    const log = vi.fn();
    const limiter = createReviewsRateLimiter({ now: c.now, log, maxKeys: 1 });
    expect(limiter.consume("read", A).allowed).toBe(true);
    expect(limiter.consume("read", B)).toEqual({
      allowed: false,
      reason: "capacity",
      retryAfterSeconds: 60,
    });
    expect(limiter.consume("mutation", B).allowed).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "REVIEWS_RATE_LIMIT_CAPACITY");
  });

  it("is independent of a favorites limiter instance for the same user", () => {
    const c = clock();
    const reviews = createReviewsRateLimiter({ now: c.now });
    const favorites = createFavoritesRateLimiter({ now: c.now });
    for (let i = 0; i < 20; i += 1) reviews.consume("mutation", A);
    expect(reviews.consume("mutation", A).allowed).toBe(false);
    expect(favorites.consume("mutation", A).allowed).toBe(true);
    expect(favorites.size()).toBe(1);
    expect(reviews.size()).toBe(1);
  });
});

describe("generic limiter extraction (R2(a))", () => {
  it("favorites keeps its limits and capacity event", () => {
    expect(DEFAULT_FAVORITES_RATE_LIMITS).toEqual({ read: 120, mutation: 60 });
    expect(RATE_LIMIT_CAPACITY_EVENT).toBe("FAVORITES_RATE_LIMIT_CAPACITY");
    const c = clock();
    const log = vi.fn();
    const favorites = createFavoritesRateLimiter({ now: c.now, log, maxKeys: 1 });
    favorites.consume("read", A);
    favorites.consume("read", B);
    expect(log).toHaveBeenCalledWith("warn", "FAVORITES_RATE_LIMIT_CAPACITY");
  });

  it("logs whatever event code an instance is given, and nothing else", () => {
    const c = clock();
    const log = vi.fn();
    const limiter = createUserRateLimiter({
      limits: { read: 1, mutation: 1 },
      windowMs: 1_000,
      maxKeys: 1,
      capacityEvent: "SOME_FEATURE_CAPACITY",
      now: c.now,
      log,
    });
    limiter.consume("read", A);
    limiter.consume("read", B);
    expect(log.mock.calls).toEqual([["warn", "SOME_FEATURE_CAPACITY"]]);
  });
});
