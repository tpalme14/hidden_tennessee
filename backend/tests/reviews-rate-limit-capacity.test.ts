import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REVIEWS_RATE_MAX_KEYS,
  DEFAULT_REVIEWS_RATE_WINDOW_MS,
  REVIEWS_RATE_LIMIT_CAPACITY_EVENT,
  createReviewsRateLimiter,
} from "../src/reviews/rate-limit.js";

/**
 * M04-T04 Increment 4 — the reviews limiter at its REAL default capacity of
 * 10,000 keys (R1; per-process, fail-closed). A key is one (bucket, user)
 * pair, so 10,000 keys can be 10,000 users' mutation counters, or any mix of
 * mutation and lookup counters. Runs in milliseconds, so it belongs in the
 * default unit suite. Verification only: the limiter is unchanged.
 */

const WINDOW = DEFAULT_REVIEWS_RATE_WINDOW_MS;
const CAP = DEFAULT_REVIEWS_RATE_MAX_KEYS;
const userId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function clock(start = 7_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("reviews limiter capacity at the real 10,000-key default (M04-T04 Increment 4)", () => {
  it("admits exactly 10,000 keys, refuses the next NEW key (Retry-After 60), never evicts a live key, and logs once", () => {
    expect(CAP).toBe(10_000);
    const c = clock();
    const log = vi.fn();
    const limiter = createReviewsRateLimiter({ now: c.now, log });

    for (let i = 0; i < CAP; i += 1) {
      expect(limiter.consume("mutation", userId(i)).allowed).toBe(true);
    }
    expect(limiter.size()).toBe(CAP);

    // A new user (or a known user's OTHER bucket) is a new key: refused, fail closed.
    const refused = limiter.consume("mutation", userId(CAP));
    expect(refused).toEqual({ allowed: false, reason: "capacity", retryAfterSeconds: 60 });
    expect(limiter.consume("read", userId(0))).toEqual(refused);
    for (let i = 1; i <= 50; i += 1) {
      expect(limiter.consume("mutation", userId(CAP + i)).allowed).toBe(false);
    }
    // Existing keys keep working within their own limit, and nothing was evicted.
    expect(limiter.consume("mutation", userId(0)).allowed).toBe(true);
    expect(limiter.consume("mutation", userId(CAP - 1)).allowed).toBe(true);
    expect(limiter.size()).toBe(CAP);
    // One sanitized line for the whole episode: the event code only.
    expect(log.mock.calls).toEqual([["warn", REVIEWS_RATE_LIMIT_CAPACITY_EVENT]]);
  });

  it("recovers as windows expire: only expired keys are freed, then new keys are admitted; the event can be logged again", () => {
    const c = clock();
    const log = vi.fn();
    const limiter = createReviewsRateLimiter({ now: c.now, log });

    // Half the keys at t0, half 30 s later.
    for (let i = 0; i < CAP / 2; i += 1) limiter.consume("mutation", userId(i));
    c.advance(30_000);
    for (let i = CAP / 2; i < CAP; i += 1) limiter.consume("mutation", userId(i));
    expect(limiter.consume("mutation", userId(CAP)).allowed).toBe(false);

    // 1 ms before the first half expires: still full.
    c.advance(WINDOW - 30_000 - 1);
    expect(limiter.consume("mutation", userId(CAP)).allowed).toBe(false);
    // At exactly t0 + 60 s the first half has expired: the new key's arrival sweeps it.
    c.advance(1);
    expect(limiter.consume("mutation", userId(CAP))).toEqual({ allowed: true });
    expect(limiter.size()).toBe(CAP / 2 + 1);
    // The second half is still live, with its counts intact.
    for (let i = 0; i < 19; i += 1) limiter.consume("mutation", userId(CAP - 1));
    expect(limiter.consume("mutation", userId(CAP - 1)).allowed).toBe(false);

    // Refill to the cap: the event is logged a second time (once per fill).
    for (let i = 0; limiter.size() < CAP; i += 1) limiter.consume("read", userId(i));
    expect(limiter.consume("read", userId(CAP + 1)).allowed).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);

    // A full window after everything: all keys expire and the map empties on the next sweep.
    c.advance(2 * WINDOW);
    expect(limiter.consume("mutation", userId(CAP + 2)).allowed).toBe(true);
    expect(limiter.size()).toBe(1);
  });

  it("an idle period sweeps on the next request even below the cap (memory stays bounded)", () => {
    const c = clock();
    const limiter = createReviewsRateLimiter({ now: c.now });
    for (let i = 0; i < 1_000; i += 1) limiter.consume("read", userId(i));
    expect(limiter.size()).toBe(1_000);
    c.advance(WINDOW);
    limiter.consume("read", userId(0));
    expect(limiter.size()).toBe(1);
  });
});
