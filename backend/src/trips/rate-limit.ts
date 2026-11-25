import type { SafeLogLevel } from "../auth/log-sanitizer.js";
import { createUserRateLimiter, type UserRateLimiter } from "../http/user-rate-limiter.js";

/**
 * Per-user throttling for the authenticated trips API (M05-T03 Increment 1;
 * specs/TRIP_PLANNING_SPEC.md v1.1 §7.1; ADR-014 decision 9): 60 mutations
 * (create, rename, delete, stop add/remove/reorder, share enable/revoke) and
 * 120 reads (list and detail) per user per 60-second fixed window, with the
 * shared 10,000-key cap that refuses rather than evicts. A separate instance
 * from the favorites and reviews limiters, so its counters are independent;
 * like them, counters live in this process only. The public shared-trip read
 * is NOT throttled.
 */

export interface TripsRateLimitOptions {
  limits?: { read: number; mutation: number };
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
  log?: (level: SafeLogLevel, message: string) => void;
}

export const DEFAULT_TRIPS_RATE_LIMITS = { read: 120, mutation: 60 } as const;
export const DEFAULT_TRIPS_RATE_WINDOW_MS = 60_000;
export const DEFAULT_TRIPS_RATE_MAX_KEYS = 10_000;
export const TRIPS_RATE_LIMIT_CAPACITY_EVENT = "TRIPS_RATE_LIMIT_CAPACITY";

export type TripsRateLimiter = UserRateLimiter;

export function createTripsRateLimiter(options: TripsRateLimitOptions = {}): TripsRateLimiter {
  return createUserRateLimiter({
    limits: options.limits ?? DEFAULT_TRIPS_RATE_LIMITS,
    windowMs: options.windowMs ?? DEFAULT_TRIPS_RATE_WINDOW_MS,
    maxKeys: options.maxKeys ?? DEFAULT_TRIPS_RATE_MAX_KEYS,
    capacityEvent: TRIPS_RATE_LIMIT_CAPACITY_EVENT,
    ...(options.now ? { now: options.now } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
}
