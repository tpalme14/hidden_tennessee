import type { PrismaClient } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { authenticatedUserId } from "../auth/protected-route.js";
import { env } from "../config/env.js";
import { prisma as defaultPrisma } from "../db/prisma.js";
import {
  invalidQueryEnvelope,
  invalidRequestEnvelope,
  notFoundEnvelope,
  tripStopAlreadyExistsEnvelope,
  tripSharingUnavailableEnvelope,
  tripStopLimitReachedEnvelope,
  tripVersionConflictEnvelope,
} from "../http/error-envelope.js";
import { createTripsRateLimiter, type TripsRateLimiter } from "./rate-limit.js";
import {
  MESSAGES,
  TripsRequestError,
  parseAddStopBody,
  parseCreateTripBody,
  parseEmptyBody,
  parseListQuery,
  parseNoQuery,
  parseRenameTripBody,
  parseReorderBody,
  parseStopId,
  parseTripId,
} from "./request-schema.js";
import * as defaultService from "./service.js";

/**
 * Authenticated trip-management API router (M05-T03 Increment 4;
 * specs/TRIP_PLANNING_SPEC.md v1.1 §§4, 5, 6, 7, 7.1–7.3, 10.1, 10.2;
 * ADR-012; ADR-014).
 *
 * MUST be mounted with `mountProtected(apiRouter, "/trips", …)`, which places
 * `noStore → requireSession` ahead of it and the protected-route error handler
 * after it; `requireTrustedOrigin` already runs on all of /api/v1. The order
 * is therefore origin → session → rate limit → validation → service (spec
 * §7.1), so a 400 never depends on whether a trip or stop exists. Identity
 * comes only from `authenticatedUserId(req)`; ownership and landmark
 * visibility are enforced inside every query by the service/repository.
 *
 * Exactly ten routes, each with its own limiter middleware attached BEFORE
 * validation (a bare `router.use` would be an extra endpoint in the
 * deny-by-default inventory). The public shared-trip read is a separate
 * router (shared-router.ts).
 *
 *   GET    /                         → 200 { trips, page, limit, has_more }
 *   POST   /                         → 201 { trip }
 *   GET    /:tripId                  → 200 { trip }
 *   PATCH  /:tripId                  → 200 { trip } | 409 TRIP_VERSION_CONFLICT
 *   DELETE /:tripId                  → 204 (no body)
 *   POST   /:tripId/stops            → 201 { stop } | 409 TRIP_STOP_ALREADY_EXISTS
 *                                      | 409 TRIP_STOP_LIMIT_REACHED
 *   DELETE /:tripId/stops/:stopId    → 204 (no body)
 *   PUT    /:tripId/stops/order      → 200 { trip } | 409 TRIP_VERSION_CONFLICT
 *                                      | 400 INVALID_REQUEST (stop-ID set)
 *   POST   /:tripId/share            → 200 { share_url } | 409 TRIP_SHARING_UNAVAILABLE
 *                                      (owner only: the 404 comes first)
 *   DELETE /:tripId/share            → 204 (no body), whether sharing is on or off
 *
 * Every refusal for a missing or non-owned trip or stop, and for a missing or
 * non-visible landmark, is the same 404 NOT_FOUND.
 */

type TripsService = Pick<
  typeof defaultService,
  | "listTrips"
  | "createTrip"
  | "getTrip"
  | "renameTrip"
  | "deleteTrip"
  | "addTripStop"
  | "removeTripStop"
  | "reorderTripStops"
  | "enableTripSharing"
  | "revokeTripSharing"
>;

export interface TripsRouterDependencies {
  prisma?: PrismaClient;
  limiter?: TripsRateLimiter;
  /** Defaults to `env.trips.sharingEnabled`; reported to the owner as `sharing_enabled`. */
  sharingEnabled?: boolean;
  /** Origin of `share_url`; defaults to `env.auth.baseUrl` (as for password-reset links). */
  publicOrigin?: string;
  /** Injectable for tests (e.g. a failing service to prove the fixed 500). */
  service?: TripsService;
}

/** Maps validation failures to their 400 envelope; everything else goes to the protected-route error handler. */
function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof TripsRequestError) {
    res
      .status(400)
      .json(
        err.code === "INVALID_QUERY"
          ? invalidQueryEnvelope(err.message)
          : invalidRequestEnvelope(err.message),
      );
    return;
  }
  next(err);
}

function notFound(res: Response): void {
  res.status(404).json(notFoundEnvelope());
}

/** 204 No Content: no body and no Content-Type. */
function noContent(res: Response): void {
  res.status(204).end();
}

export function createTripsRouter(deps: TripsRouterDependencies = {}): Router {
  const prisma = deps.prisma ?? defaultPrisma;
  const limiter = deps.limiter ?? createTripsRateLimiter();
  const service = deps.service ?? defaultService;
  const options = { sharingEnabled: deps.sharingEnabled ?? env.trips.sharingEnabled };
  const publicOrigin = deps.publicOrigin ?? env.auth.baseUrl;
  const router = Router();

  router.get("/", limiter.read, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = authenticatedUserId(req);
      const query = parseListQuery(req.query);
      const outcome = await service.listTrips(prisma, userId, query);
      res.status(200).json(outcome.body);
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.post("/", limiter.mutation, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = authenticatedUserId(req);
      parseNoQuery(req.query);
      const { name } = parseCreateTripBody(req.body);
      const outcome = await service.createTrip(prisma, userId, name, options);
      res.status(201).json({ trip: outcome.trip });
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.get("/:tripId", limiter.read, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = authenticatedUserId(req);
      const tripId = parseTripId(req.params.tripId);
      parseNoQuery(req.query);
      const outcome = await service.getTrip(prisma, userId, tripId, options);
      if (outcome.kind === "not_found") {
        notFound(res);
        return;
      }
      res.status(200).json({ trip: outcome.trip });
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.patch(
    "/:tripId",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const tripId = parseTripId(req.params.tripId);
        parseNoQuery(req.query);
        const input = parseRenameTripBody(req.body);
        const outcome = await service.renameTrip(prisma, userId, tripId, input, options);
        switch (outcome.kind) {
          case "renamed":
            res.status(200).json({ trip: outcome.trip });
            return;
          case "version_conflict":
            res.status(409).json(tripVersionConflictEnvelope());
            return;
          default:
            notFound(res);
        }
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  router.delete(
    "/:tripId",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const tripId = parseTripId(req.params.tripId);
        parseNoQuery(req.query);
        parseEmptyBody(req.body);
        const outcome = await service.deleteTrip(prisma, userId, tripId);
        if (outcome.kind === "not_found") {
          notFound(res);
          return;
        }
        noContent(res);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  router.post(
    "/:tripId/stops",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const tripId = parseTripId(req.params.tripId);
        parseNoQuery(req.query);
        const { landmarkId } = parseAddStopBody(req.body);
        const outcome = await service.addTripStop(prisma, userId, tripId, landmarkId);
        switch (outcome.kind) {
          case "added":
            res.status(201).json({ stop: outcome.stop });
            return;
          case "already_exists":
            res.status(409).json(tripStopAlreadyExistsEnvelope());
            return;
          case "limit_reached":
            res.status(409).json(tripStopLimitReachedEnvelope());
            return;
          default:
            notFound(res);
        }
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  router.delete(
    "/:tripId/stops/:stopId",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const tripId = parseTripId(req.params.tripId);
        const stopId = parseStopId(req.params.stopId);
        parseNoQuery(req.query);
        parseEmptyBody(req.body);
        const outcome = await service.removeTripStop(prisma, userId, tripId, stopId);
        if (outcome.kind === "not_found") {
          notFound(res);
          return;
        }
        noContent(res);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  router.put(
    "/:tripId/stops/order",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const tripId = parseTripId(req.params.tripId);
        parseNoQuery(req.query);
        const input = parseReorderBody(req.body);
        const outcome = await service.reorderTripStops(prisma, userId, tripId, input, options);
        switch (outcome.kind) {
          case "reordered":
            res.status(200).json({ trip: outcome.trip });
            return;
          case "version_conflict":
            res.status(409).json(tripVersionConflictEnvelope());
            return;
          case "invalid_stop_ids":
            res.status(400).json(invalidRequestEnvelope(MESSAGES.invalidStopIds));
            return;
          default:
            notFound(res);
        }
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  router.post(
    "/:tripId/share",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const tripId = parseTripId(req.params.tripId);
        parseNoQuery(req.query);
        parseEmptyBody(req.body);
        const outcome = await service.enableTripSharing(prisma, userId, tripId, {
          ...options,
          publicOrigin,
        });
        switch (outcome.kind) {
          case "shared":
            res.status(200).json({ share_url: outcome.shareUrl });
            return;
          case "sharing_unavailable":
            res.status(409).json(tripSharingUnavailableEnvelope());
            return;
          default:
            notFound(res);
        }
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  router.delete(
    "/:tripId/share",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const tripId = parseTripId(req.params.tripId);
        parseNoQuery(req.query);
        parseEmptyBody(req.body);
        const outcome = await service.revokeTripSharing(prisma, userId, tripId);
        if (outcome.kind === "not_found") {
          notFound(res);
          return;
        }
        noContent(res);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  return router;
}

/** The production router: shared Prisma client, approved limits (60 mutations / 120 reads per user per minute). */
export const tripsRouter = createTripsRouter();
