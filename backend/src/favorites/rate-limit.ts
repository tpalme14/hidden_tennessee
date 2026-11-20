import type { NextFunction, Request, RequestHandler, Response } from "express";
import { authenticatedUserId } from "../auth/protected-route.js";
import { safeAuthLog, type SafeLogLevel } from "../auth/log-sanitizer.js";
import { rateLimitedEnvelope } from "../http/error-envelope.js";

/**
 * Per-user throttling for the favorites API (M03-T05 Increment 3; decision D6
 * as refined, F1–F5).
 *
 * - Keyed by the AUTHENTICATED user ID (`authenticatedUserId`) and a bucket:
 *   `read` (GET) or `mutation` (PUT/DELETE), counted independently. It runs
 *   only after `requireSession`, so anonymous requests never reach it.
 * - Fixed window per key, opened by the first allowed request. Each allowed
 *   request counts (valid or not — F1); a blocked request neither counts nor
 *   extends the window. Blocked → 429 `RATE_LIMITED` with `Retry-After`.
 *
 * SCOPE: counters live in this Node process only. They are not shared across
 * application instances (N instances allow up to N × the limit) and reset
 * whenever the process restarts or redeploys. Acceptable for the single
 * Render instance (ADR-006/ADR-008); shared storage needs its own decision.
 *
 * MEMORY: bounded without timers —
 *  1. an expired entry is reset in place on its next use;
 *  2. a full sweep deletes every expired entry, run during a request whenever
 *     at least one window has passed since the previous sweep;
 *  3. a hard cap (`maxKeys`): a NEW key arriving at the cap triggers an
 *     immediate sweep; if the map is still full, that request is refused with
 *     429 (fail closed) and no live counter is ever evicted. One sanitized log
 *     line is written each time the map becomes full, not per refusal (F3).
 */

export type RateLimitBucket = "read" | "mutation";

export interface FavoritesRateLimitOptions {
  limits?: { read: number; mutation: number };
  windowMs?: number;
  maxKeys?: number;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Injectable logger (tests); defaults to the shared sanitized logger. */
  log?: (level: SafeLogLevel, message: string) => void;
}

export const DEFAULT_FAVORITES_RATE_LIMITS = { read: 120, mutation: 60 } as const;
export const DEFAULT_FAVORITES_RATE_WINDOW_MS = 60_000;
export const DEFAULT_FAVORITES_RATE_MAX_KEYS = 10_000;
export const RATE_LIMIT_CAPACITY_EVENT = "FAVORITES_RATE_LIMIT_CAPACITY";

export type RateLimitDecision =
  { allowed: true } | { allowed: false; reason: "limit" | "capacity"; retryAfterSeconds: number };

interface Entry {
  windowStart: number;
  count: number;
}

export interface FavoritesRateLimiter {
  /** Route-level middleware for GET (F2). */
  read: RequestHandler;
  /** Route-level middleware for PUT/DELETE (F2). */
  mutation: RequestHandler;
  /** The decision for one request; exposed for unit tests. */
  consume(bucket: RateLimitBucket, userId: string): RateLimitDecision;
  /** Number of live counter entries; exposed for tests. */
  size(): number;
}

export function createFavoritesRateLimiter(
  options: FavoritesRateLimitOptions = {},
): FavoritesRateLimiter {
  const limits = options.limits ?? DEFAULT_FAVORITES_RATE_LIMITS;
  const windowMs = options.windowMs ?? DEFAULT_FAVORITES_RATE_WINDOW_MS;
  const maxKeys = options.maxKeys ?? DEFAULT_FAVORITES_RATE_MAX_KEYS;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((level, message) => safeAuthLog(level, message));

  const entries = new Map<string, Entry>();
  let lastSweep = now();
  let capacityLogged = false;

  const expired = (entry: Entry, t: number) => t - entry.windowStart >= windowMs;

  function sweep(t: number): void {
    for (const [key, entry] of entries) {
      if (expired(entry, t)) entries.delete(key);
    }
    lastSweep = t;
    if (entries.size < maxKeys) capacityLogged = false;
  }

  function consume(bucket: RateLimitBucket, userId: string): RateLimitDecision {
    const t = now();
    if (t - lastSweep >= windowMs) sweep(t);

    const key = `${bucket}:${userId}`;
    let entry = entries.get(key);
    if (entry && expired(entry, t)) {
      entry.windowStart = t;
      entry.count = 0;
    }
    if (!entry) {
      if (entries.size >= maxKeys) sweep(t);
      if (entries.size >= maxKeys) {
        if (!capacityLogged) {
          capacityLogged = true;
          // Event code only: never a user ID, key, or count.
          log("warn", RATE_LIMIT_CAPACITY_EVENT);
        }
        return {
          allowed: false,
          reason: "capacity",
          retryAfterSeconds: Math.ceil(windowMs / 1000),
        };
      }
      entry = { windowStart: t, count: 0 };
      entries.set(key, entry);
    }

    if (entry.count >= limits[bucket]) {
      const remainingMs = entry.windowStart + windowMs - t;
      return {
        allowed: false,
        reason: "limit",
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
      };
    }
    entry.count += 1;
    return { allowed: true };
  }

  function middlewareFor(bucket: RateLimitBucket): RequestHandler {
    return function favoritesRateLimit(req: Request, res: Response, next: NextFunction): void {
      // Throws (→ fixed 500) if no validated identity: fail closed.
      const decision = consume(bucket, authenticatedUserId(req));
      if (decision.allowed) {
        next();
        return;
      }
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json(rateLimitedEnvelope());
    };
  }

  return {
    read: middlewareFor("read"),
    mutation: middlewareFor("mutation"),
    consume,
    size: () => entries.size,
  };
}
