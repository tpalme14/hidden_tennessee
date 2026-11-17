import type { Express, NextFunction, Request, Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { serviceUnavailableEnvelope } from "../http/error-envelope.js";
import { safeAuthLog } from "./log-sanitizer.js";

/** Whatever `toNodeHandler` accepts: the Better Auth instance (or its raw handler). */
type MountableAuth = Parameters<typeof toNodeHandler>[0];

/**
 * A short, safe identifier for an error: a driver/library `code` property,
 * else a Better Auth `APIError`'s own body code or status, else the class
 * name. Never the message.
 */
function diagnosticCode(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const withCode = err as { code?: unknown; body?: { code?: unknown }; status?: unknown };
    if (typeof withCode.code === "string") return withCode.code;
    if (typeof withCode.body?.code === "string") return withCode.body.code;
    if (typeof withCode.status === "string") return withCode.status;
  }
  return err instanceof Error ? err.name : "unknown";
}

/**
 * Error handler for the auth mount only (M03-T02 Increment 5). Reached when
 * the library's Node handler REJECTED instead of producing a response —
 * verified in 1.7.18: its pre-request hook (rate limiter, one-time schema
 * check) runs outside the router's try/catch, so a storage failure there
 * would otherwise leave the request hanging and raise an unhandled
 * rejection. Every response the library produces itself (400/401/403/404/
 * 429/500 …) never comes through here and keeps its status.
 *
 * Fail closed with the project envelope; log a stable event code plus the
 * error's class/code only — no message, SQL, stack, credential, or token.
 */
export function authInfrastructureErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  const code = diagnosticCode(err);
  safeAuthLog("error", "AUTH_INFRASTRUCTURE_FAILURE", { code });
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(503).json(serviceUnavailableEnvelope());
}

/**
 * Mounts Better Auth at /api/auth/* exactly as src/app.ts needs it: ahead of
 * any body parser (the handler reads the raw body itself), with the Node
 * handler's promise forwarded to Express error handling, and the 503 handler
 * scoped to this route only. Shared with the test-only apps so they exercise
 * the same path.
 */
export function mountBetterAuth(app: Express, auth: MountableAuth) {
  const handler = toNodeHandler(auth);
  app.all(
    "/api/auth/*",
    (req: Request, res: Response, next: NextFunction) => {
      handler(req, res).catch(next);
    },
    authInfrastructureErrorHandler,
  );
}
