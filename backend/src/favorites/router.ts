import type { PrismaClient } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { authenticatedUserId } from "../auth/protected-route.js";
import { prisma as defaultPrisma } from "../db/prisma.js";
import {
  invalidQueryEnvelope,
  invalidRequestEnvelope,
  notFoundEnvelope,
} from "../http/error-envelope.js";
import { createFavoritesRateLimiter, type FavoritesRateLimiter } from "./rate-limit.js";
import {
  FavoritesRequestError,
  parseLandmarkId,
  parseListQuery,
  parseMutationRequest,
} from "./request-schema.js";
import * as defaultService from "./service.js";

/**
 * Favorites API router (M03-T05 Increment 3; spec §7; ADR-012).
 *
 * MUST be mounted with `mountProtected(apiRouter, "/favorites", …)`, which
 * places `noStore → requireSession` ahead of it and the protected-route error
 * handler after it. Identity comes only from `authenticatedUserId(req)`;
 * ownership is enforced inside every query by the service/repository.
 *
 * Exactly three routes, each with its own limiter middleware (F2) — a bare
 * `router.use` would be an extra endpoint in the deny-by-default inventory:
 *   GET    /             → 200 { favorites, page, limit, has_more }
 *   PUT    /:landmarkId  → 201 created | 200 existing | 404 not found
 *   DELETE /:landmarkId  → 200 always (idempotent; D2)
 * PUT/DELETE answer `{ success: true, landmark_id }`.
 */

type FavoritesService = Pick<
  typeof defaultService,
  "addFavorite" | "removeFavorite" | "listFavorites"
>;

export interface FavoritesRouterDependencies {
  prisma?: PrismaClient;
  limiter?: FavoritesRateLimiter;
  /** Injectable for tests (e.g. a failing service to prove the fixed 500). */
  service?: FavoritesService;
}

/** Maps validation failures to their 400 envelope; everything else goes to the protected-route error handler. */
function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof FavoritesRequestError) {
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

export function createFavoritesRouter(deps: FavoritesRouterDependencies = {}): Router {
  const prisma = deps.prisma ?? defaultPrisma;
  const limiter = deps.limiter ?? createFavoritesRateLimiter();
  const service = deps.service ?? defaultService;
  const router = Router();

  router.get("/", limiter.read, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = authenticatedUserId(req);
      const query = parseListQuery(req.query);
      res.status(200).json(await service.listFavorites(prisma, userId, query));
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.put(
    "/:landmarkId",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const landmarkId = parseLandmarkId(req.params.landmarkId);
        parseMutationRequest(req.query, req.body);
        const outcome = await service.addFavorite(prisma, userId, landmarkId);
        if (outcome.kind === "not_found") {
          res.status(404).json(notFoundEnvelope());
          return;
        }
        res
          .status(outcome.kind === "created" ? 201 : 200)
          .json({ success: true, landmark_id: outcome.landmarkId });
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  router.delete(
    "/:landmarkId",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const landmarkId = parseLandmarkId(req.params.landmarkId);
        parseMutationRequest(req.query, req.body);
        const outcome = await service.removeFavorite(prisma, userId, landmarkId);
        res.status(200).json({ success: true, landmark_id: outcome.landmarkId });
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  return router;
}

/** The production router: shared Prisma client, approved limits (120 reads / 60 mutations per user per minute). */
export const favoritesRouter = createFavoritesRouter();
