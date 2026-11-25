import type { PrismaClient } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import { safeAuthLog } from "../auth/log-sanitizer.js";
import { env } from "../config/env.js";
import { prisma as defaultPrisma } from "../db/prisma.js";
import { internalErrorEnvelope, notFoundEnvelope } from "../http/error-envelope.js";
import * as defaultService from "./service.js";

/**
 * Public read-only shared-trip endpoint (M05-T03 Increment 5;
 * specs/TRIP_PLANNING_SPEC.md v1.1 §§4, 5.4, 7, 7.1–7.3, 10.3, 10.6;
 * ADR-012 decision 9; ADR-014 decision 10; decisions T3-3, T3-4 revised).
 *
 *   GET /shared/trips/:shareToken → 200 { trip: { name, stops, distance_summary } }
 *
 * - Never reads the session or a cookie and sets none; the response is
 *   identical for every caller. Not throttled (256-bit token; ADR-014
 *   decision 9).
 * - `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow` are set
 *   BEFORE any work, so the 200, the 404, and the 500 all carry them.
 * - The generic 404 — byte-identical to every other API 404 — for a value
 *   without token syntax (no database access), an unknown, revoked, or
 *   rotated token, and every token while `TRIP_SHARING_ENABLED` is off (no
 *   database access either).
 * - An unexpected failure is answered here with the fixed JSON 500 and one
 *   log line holding only an event code and the error's class name — never
 *   the token, URL, or message (T3-4 revised). Only this router does this;
 *   no app-wide handler changes. A malformed percent-encoded path still fails
 *   in Express's own URL decoding before this handler runs (the existing
 *   app-wide follow-up).
 * - Query parameters are ignored: they cannot change the response.
 *
 * Mounted with `apiRouter.use(...)` and listed — GET only, exact path — in the
 * reviewed public allowlist (tests/helpers/public-api-routes.ts). Owner
 * sharing routes live in the protected trips router.
 */

export const SHARED_TRIP_CACHE_CONTROL = "no-store";
export const SHARED_TRIP_ROBOTS_TAG = "noindex, nofollow";
export const SHARED_TRIP_FAILURE_EVENT = "SHARED_TRIP_READ_FAILED";

type SharedTripsService = Pick<typeof defaultService, "getSharedTrip">;

export interface SharedTripsRouterDependencies {
  prisma?: PrismaClient;
  /** Defaults to `env.trips.sharingEnabled`. */
  sharingEnabled?: boolean;
  /** Injectable for tests (e.g. a failing service to prove the fixed 500). */
  service?: SharedTripsService;
}

export function createSharedTripsRouter(deps: SharedTripsRouterDependencies = {}): Router {
  const prisma = deps.prisma ?? defaultPrisma;
  const service = deps.service ?? defaultService;
  const options = { sharingEnabled: deps.sharingEnabled ?? env.trips.sharingEnabled };
  const router = Router();

  router.get("/shared/trips/:shareToken", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", SHARED_TRIP_CACHE_CONTROL);
    res.setHeader("X-Robots-Tag", SHARED_TRIP_ROBOTS_TAG);
    try {
      const outcome = await service.getSharedTrip(prisma, req.params.shareToken, options);
      if (outcome.kind === "not_found") {
        res.status(404).json(notFoundEnvelope());
        return;
      }
      res.status(200).json({ trip: outcome.trip });
    } catch (err) {
      safeAuthLog("error", SHARED_TRIP_FAILURE_EVENT, {
        code: err instanceof Error ? err.name : typeof err,
      });
      if (!res.headersSent) res.status(500).json(internalErrorEnvelope());
    }
  });

  return router;
}

export const sharedTripsRouter = createSharedTripsRouter();
