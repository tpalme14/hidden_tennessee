import type { PrismaClient } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma as defaultPrisma } from "../db/prisma.js";
import {
  invalidQueryEnvelope,
  invalidRequestEnvelope,
  notFoundEnvelope,
} from "../http/error-envelope.js";
import { ReviewsRequestError, parseLandmarkId, parseListQuery } from "./request-schema.js";
import * as defaultService from "./service.js";

/**
 * Public review list (M04-T02 Increment 3; specs/RATINGS_REVIEWS_SPEC.md v1.1
 * §§5–7; ADR-013 decisions 4 and 6; decisions R3 and A6).
 *
 *   GET /landmarks/:landmarkId/reviews → 200 { reviews, aggregate, page, limit, has_more }
 *
 * Anonymous and identical for every caller: it never reads the session or a
 * cookie, carries no per-user field, and sets no `Cache-Control` (the same
 * policy as the other public landmark routes). Not throttled (A6). A missing,
 * retired, SENSITIVE, or UNREVIEWED landmark is the same 404 NOT_FOUND, with
 * no review, aggregate, or landmark data. A malformed ID is 400 INVALID_REQUEST
 * (A1); invalid pagination is 400 INVALID_QUERY.
 *
 * Mounted with `apiRouter.use(...)` and listed — GET only, exact path — in the
 * reviewed public allowlist (tests/helpers/public-api-routes.ts).
 */

type PublicReviewsService = Pick<typeof defaultService, "listPublicReviews">;

export interface PublicReviewsRouterDependencies {
  prisma?: PrismaClient;
  service?: PublicReviewsService;
}

export function createPublicReviewsRouter(deps: PublicReviewsRouterDependencies = {}): Router {
  const prisma = deps.prisma ?? defaultPrisma;
  const service = deps.service ?? defaultService;
  const router = Router();

  router.get(
    "/landmarks/:landmarkId/reviews",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const landmarkId = parseLandmarkId(req.params.landmarkId);
        const query = parseListQuery(req.query);
        const outcome = await service.listPublicReviews(prisma, landmarkId, query);
        if (outcome.kind === "not_found") {
          res.status(404).json(notFoundEnvelope());
          return;
        }
        res.status(200).json(outcome.body);
      } catch (err) {
        if (err instanceof ReviewsRequestError) {
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
    },
  );

  return router;
}

export const publicReviewsRouter = createPublicReviewsRouter();
