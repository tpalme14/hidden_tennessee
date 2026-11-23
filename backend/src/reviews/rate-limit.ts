import type { SafeLogLevel } from "../auth/log-sanitizer.js";
import { createUserRateLimiter, type UserRateLimiter } from "../http/user-rate-limiter.js";

/**
 * Per-user throttling for the authenticated reviews API (M04-T02 Increment 3;
 * decision R1, approved as initial limits): 20 mutations (POST, PATCH, and
 * DELETE combined) and 120 own-review lookups (GET) per user per 60-second
 * fixed window, with the shared 10,000-key cap that refuses rather than
 * evicts. Counters are independent of the favorites limiter (a separate
 * instance) and, like it, live in this process only. The public review list is
 * NOT throttled (decision A6).
 */

export interface ReviewsRateLimitOptions {
  limits?: { read: number; mutation: number };
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
  log?: (level: SafeLogLevel, message: string) => void;
}

export const DEFAULT_REVIEWS_RATE_LIMITS = { read: 120, mutation: 20 } as const;
export const DEFAULT_REVIEWS_RATE_WINDOW_MS = 60_000;
export const DEFAULT_REVIEWS_RATE_MAX_KEYS = 10_000;
export const REVIEWS_RATE_LIMIT_CAPACITY_EVENT = "REVIEWS_RATE_LIMIT_CAPACITY";

export type ReviewsRateLimiter = UserRateLimiter;

export function createReviewsRateLimiter(
  options: ReviewsRateLimitOptions = {},
): ReviewsRateLimiter {
  return createUserRateLimiter({
    limits: options.limits ?? DEFAULT_REVIEWS_RATE_LIMITS,
    windowMs: options.windowMs ?? DEFAULT_REVIEWS_RATE_WINDOW_MS,
    maxKeys: options.maxKeys ?? DEFAULT_REVIEWS_RATE_MAX_KEYS,
    capacityEvent: REVIEWS_RATE_LIMIT_CAPACITY_EVENT,
    ...(options.now ? { now: options.now } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
}
