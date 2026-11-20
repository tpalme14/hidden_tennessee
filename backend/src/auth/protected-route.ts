import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { internalErrorEnvelope } from "../http/error-envelope.js";
import { safeAuthLog } from "./log-sanitizer.js";

/**
 * Building blocks for account-scoped API routes (M03-T04 Increment 1; the
 * conventions are recorded in ADR-012, Accepted). This module has no runtime dependency
 * on the Better Auth instance, so it can be unit-tested without configuration;
 * `mount-protected.ts` binds it to the real `requireSession`.
 *
 * Authentication establishes identity (`requireSession`); ownership of any
 * specific resource is enforced separately, inside each owned-resource query
 * (ADR-006). Nothing here authorizes access to a particular resource.
 */

/** `Cache-Control` value for every response under a protected mount. */
export const PROTECTED_CACHE_CONTROL = "private, no-store";

/**
 * Tells shared caches and the browser's HTTP cache not to store the response.
 * It does not guarantee that a browser's back-forward cache or other in-memory
 * page restoration will not redisplay previously rendered content.
 */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", PROTECTED_CACHE_CONTROL);
  next();
}

/** A protected handler ran without an identity established by `requireSession` — a programming error. */
export class AuthenticationContextMissingError extends Error {
  constructor() {
    super("No authenticated identity is available on this request.");
    this.name = "AuthenticationContextMissingError";
  }
}

/**
 * The acting user's ID — the ONLY sanctioned source of identity for
 * account-scoped handlers. It comes from the session validated by
 * `requireSession`; query parameters, bodies, path segments, and headers are
 * never consulted. Returns the ID alone, so the session object (which carries
 * the session token) never reaches a handler's response by accident.
 *
 * Throws `AuthenticationContextMissingError` when no validated identity is
 * present, so a route mounted without protection fails closed instead of
 * acting anonymously.
 */
export function authenticatedUserId(req: Request): string {
  const id = req.auth?.user?.id;
  if (typeof id !== "string" || id === "") {
    throw new AuthenticationContextMissingError();
  }
  return id;
}

/** The HTTP status an error deliberately carries (`status`/`statusCode`, as body-parser and http-errors set), if any. */
function intendedHttpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  const value = typeof status === "number" ? status : statusCode;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/**
 * Last handler of every protected mount. Responses that middleware sends
 * itself — 401 `UNAUTHENTICATED`, 503 `SERVICE_UNAVAILABLE` from
 * `requireSession`, 403 `INVALID_ORIGIN` from the CSRF check — never come
 * through here. Of the errors that do:
 *  - an intentional client error carrying a 4xx status (for example a
 *    malformed JSON body rejected by the body parser, or a deliberate
 *    `next(err)` with status 404) is passed on unchanged, keeping its status
 *    and its existing handling;
 *  - anything else — including `AuthenticationContextMissingError` — becomes
 *    the fixed 500 `INTERNAL_ERROR` envelope, logged as one event code plus
 *    the error's class name only (no message, SQL, stack, or identifier).
 */
export function protectedRouteErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const status = intendedHttpStatus(err);
  if (res.headersSent || (status !== undefined && status >= 400 && status < 500)) {
    next(err);
    return;
  }
  const event =
    err instanceof AuthenticationContextMissingError
      ? "AUTHORIZATION_CONTEXT_MISSING"
      : "PROTECTED_ROUTE_FAILURE";
  safeAuthLog("error", event, { code: err instanceof Error ? err.name : typeof err });
  res.setHeader("Cache-Control", PROTECTED_CACHE_CONTROL);
  res.status(500).json(internalErrorEnvelope());
}

/**
 * Returns `mountProtected(parent, path, router)`, which mounts an
 * account-scoped router at a SPECIFIC path behind, in order: `noStore`, the
 * given session middleware, the router itself, and
 * `protectedRouteErrorHandler`. Every method and every nested route under the
 * path is protected. Mounting at the root or a wildcard is refused, so public
 * routes and the 404 for unknown API paths are never turned into 401s.
 */
export function createMountProtected(requireSession: RequestHandler) {
  return function mountProtected(parent: Router, path: string, router: Router): void {
    if (!/^\/[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(path)) {
      throw new Error(
        `mountProtected requires a specific literal path such as "/favorites", got ${JSON.stringify(path)}`,
      );
    }
    parent.use(path, noStore, requireSession, router, protectedRouteErrorHandler);
  };
}
