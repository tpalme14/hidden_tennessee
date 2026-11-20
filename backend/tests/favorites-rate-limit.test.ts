import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FAVORITES_RATE_LIMITS,
  RATE_LIMIT_CAPACITY_EVENT,
  createFavoritesRateLimiter,
  type FavoritesRateLimitOptions,
} from "../src/favorites/rate-limit.js";

/**
 * Unit tests for the favorites per-user limiter (M03-T05 Increment 3; D6 as
 * refined). Every test builds its OWN limiter with an injected clock, so no
 * state is shared between tests or with the production instance.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const WINDOW = 60_000;

function setup(overrides: Partial<FavoritesRateLimitOptions> = {}) {
  let t = 1_000_000;
  const log = vi.fn();
  const limiter = createFavoritesRateLimiter({
    limits: { read: 3, mutation: 2 },
    windowMs: WINDOW,
    maxKeys: 100,
    now: () => t,
    log,
    ...overrides,
  });
  return {
    limiter,
    log,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function allowedCount(results: { allowed: boolean }[]) {
  return results.filter((r) => r.allowed).length;
}

describe("favorites rate limiter", () => {
  it("production defaults are the approved limits: 120 reads and 60 mutations per minute", () => {
    expect(DEFAULT_FAVORITES_RATE_LIMITS).toEqual({ read: 120, mutation: 60 });
  });

  it("allows exactly `limit` requests in a window, then refuses with reason limit", () => {
    const { limiter } = setup();
    expect(allowedCount([1, 2].map(() => limiter.consume("mutation", A)))).toBe(2);
    expect(limiter.consume("mutation", A)).toEqual({
      allowed: false,
      reason: "limit",
      retryAfterSeconds: 60,
    });
    expect(allowedCount([1, 2, 3].map(() => limiter.consume("read", A)))).toBe(3);
    expect(limiter.consume("read", A).allowed).toBe(false);
  });

  it("independent users: A exhausted does not affect B", () => {
    const { limiter } = setup();
    limiter.consume("mutation", A);
    limiter.consume("mutation", A);
    expect(limiter.consume("mutation", A).allowed).toBe(false);
    expect(limiter.consume("mutation", B).allowed).toBe(true);
    expect(limiter.consume("mutation", B).allowed).toBe(true);
    expect(limiter.consume("mutation", B).allowed).toBe(false);
  });

  it("independent buckets: A's exhausted mutations leave A's reads available", () => {
    const { limiter } = setup();
    limiter.consume("mutation", A);
    limiter.consume("mutation", A);
    expect(limiter.consume("mutation", A).allowed).toBe(false);
    expect(limiter.consume("read", A).allowed).toBe(true);
  });

  it("window expiry: still blocked at window − 1 ms, allowed again at exactly one window, count restarts", () => {
    const { limiter, advance } = setup();
    limiter.consume("mutation", A);
    limiter.consume("mutation", A);
    advance(WINDOW - 1);
    expect(limiter.consume("mutation", A)).toEqual({
      allowed: false,
      reason: "limit",
      retryAfterSeconds: 1,
    });
    advance(1);
    expect(limiter.consume("mutation", A).allowed).toBe(true);
    expect(limiter.consume("mutation", A).allowed).toBe(true);
    expect(limiter.consume("mutation", A).allowed).toBe(false);
  });

  it("blocked requests do not extend the window", () => {
    const { limiter, advance } = setup();
    limiter.consume("mutation", A);
    limiter.consume("mutation", A);
    for (let i = 0; i < 5; i += 1) {
      advance(10_000);
      expect(limiter.consume("mutation", A).allowed).toBe(false);
    }
    advance(10_000); // 60 s after the window opened
    expect(limiter.consume("mutation", A).allowed).toBe(true);
  });

  it("Retry-After is the remaining window rounded up, never below 1", () => {
    const { limiter, advance } = setup();
    limiter.consume("mutation", A);
    limiter.consume("mutation", A);
    advance(400);
    expect(limiter.consume("mutation", A)).toMatchObject({ retryAfterSeconds: 60 });
    advance(58_700); // 900 ms left
    expect(limiter.consume("mutation", A)).toMatchObject({ retryAfterSeconds: 1 });
  });

  it("the periodic sweep deletes expired entries and keeps live ones", () => {
    const { limiter, advance } = setup();
    limiter.consume("read", A);
    limiter.consume("mutation", A);
    advance(30_000);
    limiter.consume("read", B);
    expect(limiter.size()).toBe(3);
    advance(30_000); // A's entries expire; a sweep is due
    limiter.consume("read", C);
    expect(limiter.size()).toBe(2); // read:B (live) and read:C
  });

  it("hard cap: an expired entry frees a slot for a new key", () => {
    const { limiter, advance } = setup({ maxKeys: 2 });
    limiter.consume("read", A);
    advance(30_000);
    limiter.consume("read", B);
    advance(30_000); // A expired, B live; periodic sweep runs on this request
    expect(limiter.consume("read", C).allowed).toBe(true);
    expect(limiter.size()).toBe(2);
  });

  it("hard cap: with every entry live, a new key is refused (capacity) and existing counters keep their values", () => {
    const { limiter, log } = setup({ maxKeys: 2 });
    limiter.consume("mutation", A);
    limiter.consume("mutation", B);
    expect(limiter.consume("mutation", C)).toEqual({
      allowed: false,
      reason: "capacity",
      retryAfterSeconds: 60,
    });
    expect(limiter.size()).toBe(2);
    // A and B were not evicted or reset: one mutation each remains.
    expect(limiter.consume("mutation", A).allowed).toBe(true);
    expect(limiter.consume("mutation", A).allowed).toBe(false);
    expect(limiter.consume("mutation", B).allowed).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("capacity is logged once per time the map becomes full, with the event code only", () => {
    const { limiter, log, advance } = setup({ maxKeys: 1 });
    limiter.consume("read", A);
    for (let i = 0; i < 5; i += 1) expect(limiter.consume("read", B).allowed).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", RATE_LIMIT_CAPACITY_EVENT);

    advance(WINDOW); // A expires → sweep frees the slot, re-arming the log
    expect(limiter.consume("read", B).allowed).toBe(true);
    expect(limiter.consume("read", C).allowed).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
    for (const call of log.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(new RegExp(`${A}|${B}|${C}`));
    }
  });

  describe("middleware", () => {
    function fakeRes() {
      const res = {
        headers: {} as Record<string, string>,
        statusCode: 200,
        body: undefined as unknown,
        setHeader(name: string, value: string) {
          this.headers[name.toLowerCase()] = value;
          return this;
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(body: unknown) {
          this.body = body;
          return this;
        },
      };
      return res;
    }
    const reqFor = (id: string) => ({ auth: { user: { id } } }) as unknown as Request;

    it("calls next() when allowed and answers 429 + envelope + Retry-After when blocked", () => {
      const { limiter } = setup({ limits: { read: 1, mutation: 1 } });
      const next = vi.fn() as unknown as NextFunction;
      const first = fakeRes();
      limiter.mutation(reqFor(A), first as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      const second = fakeRes();
      limiter.mutation(reqFor(A), second as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(second.statusCode).toBe(429);
      expect(second.headers["retry-after"]).toBe("60");
      expect(second.body).toEqual({
        error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
      });
    });

    it("keys by the session identity only and fails closed without one", () => {
      const { limiter } = setup({ limits: { read: 1, mutation: 1 } });
      const next = vi.fn() as unknown as NextFunction;
      // Client-supplied identity elsewhere on the request is irrelevant.
      const spoofed = {
        auth: { user: { id: A } },
        query: { user_id: B },
        body: { userId: B },
        headers: { "x-user-id": B },
      } as unknown as Request;
      limiter.read(spoofed, fakeRes() as unknown as Response, next);
      expect(limiter.consume("read", A).allowed).toBe(false);
      expect(limiter.consume("read", B).allowed).toBe(true);

      expect(() => limiter.read({} as Request, fakeRes() as unknown as Response, next)).toThrow(
        /No authenticated identity/,
      );
    });
  });
});
