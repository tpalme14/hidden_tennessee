import type { PrismaClient } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { authenticatedUserId } from "../auth/protected-route.js";
import { prisma as defaultPrisma } from "../db/prisma.js";
import {
  invalidQueryEnvelope,
  invalidRequestEnvelope,
  notFoundEnvelope,
  reviewAlreadyExistsEnvelope,
} from "../http/error-envelope.js";
import { createReviewsRateLimiter, type ReviewsRateLimiter } from "./rate-limit.js";
import {
  ReviewsRequestError,
  parseCreateBody,
  parseEmptyBody,
  parseNoQuery,
  parseOwnReviewQuery,
  parsePatchBody,
  parseReviewId,
} from "./request-schema.js";
import * as defaultService from "./service.js";

/**
 * Authenticated reviews API router (M04-T02 Increment 3;
 * specs/RATINGS_REVIEWS_SPEC.md v1.1 §6; ADR-012; ADR-013 decisions 4–7).
 *
 * MUST be mounted with `mountProtected(apiRouter, "/reviews", …)`, which
 * places `noStore → requireSession` ahead of it and the protected-route error
 * handler after it (and `requireTrustedOrigin` already runs on all of
 * /api/v1). Identity comes only from `authenticatedUserId(req)`; ownership
 * and visibility are enforced inside every query by the service/repository.
 *
 * Exactly four routes, each with its own limiter middleware attached BEFORE
 * validation (F1/F2 pattern) — a bare `router.use` would be an extra endpoint
 * in the deny-by-default inventory:
 *   POST   /            → 201 representation | 404 | 409 REVIEW_ALREADY_EXISTS
 *   GET    /?landmark_id → 200 { review: representation | null } | 404
 *   PATCH  /:reviewId   → 200 representation | 404
 *   DELETE /:reviewId   → 200 { success: true } | 404
 * Every refusal (missing, non-visible, non-owned) is the same 404 NOT_FOUND.
 */

type ReviewsService = Pick<
  typeof defaultService,
  "createReview" | "getOwnReview" | "updateReview" | "deleteReview"
>;

export interface ReviewsRouterDependencies {
  prisma?: PrismaClient;
  limiter?: ReviewsRateLimiter;
  /** Injectable for tests (e.g. a failing service to prove the fixed 500). */
  service?: ReviewsService;
}

/** Maps validation failures to their 400 envelope; everything else goes to the protected-route error handler. */
function handleError(err: unknown, res: Response, next: NextFunction): void {
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

export function createReviewsRouter(deps: ReviewsRouterDependencies = {}): Router {
  const prisma = deps.prisma ?? defaultPrisma;
  const limiter = deps.limiter ?? createReviewsRateLimiter();
  const service = deps.service ?? defaultService;
  const router = Router();

  router.post("/", limiter.mutation, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = authenticatedUserId(req);
      parseNoQuery(req.query);
      const input = parseCreateBody(req.body);
      const outcome = await service.createReview(prisma, userId, input);
      switch (outcome.kind) {
        case "created":
          res.status(201).json(outcome.review);
          return;
        case "duplicate":
          res.status(409).json(reviewAlreadyExistsEnvelope());
          return;
        default:
          res.status(404).json(notFoundEnvelope());
      }
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.get("/", limiter.read, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = authenticatedUserId(req);
      const { landmarkId } = parseOwnReviewQuery(req.query);
      const outcome = await service.getOwnReview(prisma, userId, landmarkId);
      if (outcome.kind === "not_found") {
        res.status(404).json(notFoundEnvelope());
        return;
      }
      res.status(200).json({ review: outcome.review });
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.patch(
    "/:reviewId",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const reviewId = parseReviewId(req.params.reviewId);
        parseNoQuery(req.query);
        const patch = parsePatchBody(req.body);
        const outcome = await service.updateReview(prisma, userId, reviewId, patch);
        if (outcome.kind === "not_found") {
          res.status(404).json(notFoundEnvelope());
          return;
        }
        res.status(200).json(outcome.review);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  router.delete(
    "/:reviewId",
    limiter.mutation,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = authenticatedUserId(req);
        const reviewId = parseReviewId(req.params.reviewId);
        parseNoQuery(req.query);
        parseEmptyBody(req.body);
        const outcome = await service.deleteReview(prisma, userId, reviewId);
        if (outcome.kind === "not_found") {
          res.status(404).json(notFoundEnvelope());
          return;
        }
        res.status(200).json({ success: true });
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  return router;
}

/** The production router: shared Prisma client, approved limits (20 mutations / 120 lookups per user per minute). */
export const reviewsRouter = createReviewsRouter();
