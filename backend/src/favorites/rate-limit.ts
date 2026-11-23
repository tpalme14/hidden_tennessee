import type { SafeLogLevel } from "../auth/log-sanitizer.js";
import {
  createUserRateLimiter,
  type RateLimitBucket,
  type RateLimitDecision,
  type UserRateLimiter,
} from "../http/user-rate-limiter.js";

/**
 * Per-user throttling for the favorites API (M03-T05 Increment 3; decision D6
 * as refined, F1–F5): 120 reads (GET) and 60 mutations (PUT/DELETE) per user
 * per 60-second fixed window, a 10,000-key cap that refuses rather than
 * evicts, and the `FAVORITES_RATE_LIMIT_CAPACITY` log event.
 *
 * The mechanism itself now lives in `../http/user-rate-limiter.ts`, extracted
 * without behavioural change in M04-T02 Increment 3 (decision R2(a)); this
 * module keeps the favorites limits, event code, and public API unchanged.
 * Its scope and memory notes apply here: counters are per process and reset
 * on restart.
 */

export type { RateLimitBucket, RateLimitDecision };

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

export type FavoritesRateLimiter = UserRateLimiter;

export function createFavoritesRateLimiter(
  options: FavoritesRateLimitOptions = {},
): FavoritesRateLimiter {
  return createUserRateLimiter({
    limits: options.limits ?? DEFAULT_FAVORITES_RATE_LIMITS,
    windowMs: options.windowMs ?? DEFAULT_FAVORITES_RATE_WINDOW_MS,
    maxKeys: options.maxKeys ?? DEFAULT_FAVORITES_RATE_MAX_KEYS,
    capacityEvent: RATE_LIMIT_CAPACITY_EVENT,
    ...(options.now ? { now: options.now } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
}
