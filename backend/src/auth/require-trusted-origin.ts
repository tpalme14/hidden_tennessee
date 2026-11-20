import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { invalidOriginEnvelope } from "../http/error-envelope.js";
import { PROTECTED_CACHE_CONTROL } from "./protected-route.js";

/**
 * CSRF protection for application-owned routes (M03-T02 Increment 4; spec
 * §9.1, ADR-006, approved Increment 4 rules).
 *
 * SECURITY BOUNDARY — read before adding a state-changing /api/v1 route:
 * this middleware establishes only that a cookie-bearing, state-changing
 * request came from an allowed browser origin. It establishes NO identity.
 * Cookie presence is not authentication: a forged or expired cookie passes
 * this check and must still be rejected by `requireSession`. Therefore every
 * POST/PUT/PATCH/DELETE route under /api/v1 that reads or mutates user-owned
 * state MUST run `requireSession` ahead of its handler, and the handler must
 * act only on `req.auth`. tests/api-route-guard.integration.test.ts enforces
 * this structurally for every route in the API router.
 *
 * Rules, in order:
 *  1. GET/HEAD/OPTIONS pass untouched.
 *  2. No session cookie → pass through; the route's own 401 applies.
 *  3. `Origin` present → must exactly equal an allowed origin ("null",
 *     a different scheme/host/port, or anything else → 403).
 *  4. `Origin` absent, `Referer` present → the Referer's ORIGIN must match
 *     exactly (unparseable → 403).
 *  5. Neither header → 403.
 * The rejection never logs or echoes the offending value.
 *
 * Every 403 carries `Cache-Control: private, no-store` (M03-T05 Increment 3,
 * developer-approved Option A). This middleware runs ahead of any protected
 * mount, so the mount's own `noStore` never reaches these responses.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Both names the installed library can use: plain over http, `__Secure-` prefixed over https. */
export const SESSION_COOKIE_NAMES: readonly string[] = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

export function hasSessionCookie(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((pair) => {
    const name = pair.slice(0, pair.indexOf("=")).trim();
    return SESSION_COOKIE_NAMES.includes(name);
  });
}

/** The single 403 response: unchanged status and body, plus no-store. */
function rejectUntrustedOrigin(res: Response): void {
  res.setHeader("Cache-Control", PROTECTED_CACHE_CONTROL);
  res.status(403).json(invalidOriginEnvelope());
}

function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Builds the middleware for an explicit allow-list (each entry is normalised
 * to its origin). Exported for the test-only app; the application uses
 * `requireTrustedOrigin` below.
 */
export function createRequireTrustedOrigin(allowedOrigins: readonly string[]) {
  const allowed = new Set<string>();
  for (const entry of allowedOrigins) {
    const origin = originOf(entry);
    if (!origin) throw new Error("requireTrustedOrigin: allowed origin is not a valid URL");
    allowed.add(origin);
  }

  return function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!hasSessionCookie(req.headers.cookie)) return next();

    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (allowed.has(origin)) return next();
      rejectUntrustedOrigin(res);
      return;
    }

    const referer = req.headers.referer;
    if (referer !== undefined) {
      const refererOrigin = originOf(referer);
      if (refererOrigin && allowed.has(refererOrigin)) return next();
    }
    rejectUntrustedOrigin(res);
  };
}

/** Allowed origins: the configured public origin, plus the Vite dev origin in development only. */
export const requireTrustedOrigin = createRequireTrustedOrigin([
  env.auth.baseUrl,
  ...env.auth.trustedOrigins,
]);
