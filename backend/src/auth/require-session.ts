import type { NextFunction, Request, Response } from "express";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import { unauthenticatedEnvelope } from "../http/error-envelope.js";
import { auth } from "./auth.js";
import { authInfrastructureErrorHandler } from "./mount.js";

/** The library's own `{ session, user }` shape, exactly as `/api/auth/get-session` returns it. */
export type AuthenticatedPrincipal = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/** The part of a Better Auth instance the middleware needs; injectable for tests. */
export type SessionAuthority = {
  api: { getSession: (typeof auth)["api"]["getSession"] };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented augmentation point
  namespace Express {
    interface Request {
      /** Set by `requireSession` only after a successful, authoritative session validation. */
      auth?: AuthenticatedPrincipal;
    }
  }
}

/**
 * Express middleware for application routes that require a signed-in user
 * (M03-T02 Increment 3; error mapping corrected in Increment 7). Not mounted
 * on any route yet; favorites (M03-T05) is the first consumer.
 *
 * Validation is delegated to Better Auth's own session endpoint, called
 * server-side with the incoming headers, so the cookie signature check,
 * database lookup, expiry handling, and the 30-day/23-day renewal rule are
 * the library's — identical to a direct call of `/api/auth/get-session`.
 * Any `Set-Cookie` the library produces (a renewal, or clearing an expired
 * cookie) is appended to the response, so it reaches the browser without
 * touching other headers.
 *
 * Outcomes:
 *  - no session (missing, expired, forged, revoked) → the same 401
 *    `UNAUTHENTICATED` envelope; the library's own 4xx verdicts (e.g. a
 *    renewal racing a deletion) map to it too;
 *  - a 5xx verdict or any other exception (database, adapter, library
 *    failure) → the project 503 `SERVICE_UNAVAILABLE` envelope via the same
 *    handler the auth mount uses, logged as a sanitized event line — never a
 *    401, never `next(err)` to Express's default page.
 */
export function createRequireSession(authority: SessionAuthority) {
  return async function requireSession(req: Request, res: Response, next: NextFunction) {
    try {
      const { headers, response } = await authority.api.getSession({
        headers: fromNodeHeaders(req.headers),
        returnHeaders: true,
      });
      for (const cookie of headers.getSetCookie()) {
        res.append("Set-Cookie", cookie);
      }
      if (!response) {
        res.status(401).json(unauthenticatedEnvelope());
        return;
      }
      req.auth = response;
      next();
    } catch (err) {
      if (err instanceof APIError && err.statusCode < 500) {
        res.status(401).json(unauthenticatedEnvelope());
        return;
      }
      authInfrastructureErrorHandler(err, req, res, next);
    }
  };
}

export const requireSession = createRequireSession(auth);
