import type { PrismaClient } from "@prisma/client";
import * as repository from "./repository.js";
import type { ReviewRow } from "./repository.js";
import type { CreateReviewInput, PatchReviewInput, ReviewsListQuery } from "./request-schema.js";

/**
 * Reviews business logic (M04-T02 Increment 2; ADR-013 decisions 4–7;
 * specs/RATINGS_REVIEWS_SPEC.md v1.1 §§3–6). Callers pass the authenticated
 * user ID (from `authenticatedUserId`) and already-validated request values
 * (request-schema.ts). HTTP status codes and envelopes are the router's job
 * (Increment 3); this module returns outcome kinds only:
 *
 *   created    → 201          updated / deleted / found / listed → 200
 *   duplicate  → 409 REVIEW_ALREADY_EXISTS (no review ID, A4)
 *   not_found  → 404 NOT_FOUND — ONE outcome for a missing, retired,
 *                SENSITIVE, or UNREVIEWED landmark, a missing review, another
 *                user's review, and an edit of one's own review while its
 *                landmark is not visible (ADR-012 decision 4; A2, A3).
 */

/** Spec §3, §10.2.1: the fixed public attribution label. */
export const AUTHOR_LABEL = "Community Member";

/** The safe public representation (spec §6). No user ID, email, or landmark data. */
export interface ReviewRepresentation {
  id: string;
  rating: number;
  body: string | null;
  created_at: string;
  updated_at: string;
  author_label: typeof AUTHOR_LABEL;
}

/**
 * ISO 8601 in UTC with milliseconds, e.g. `2026-11-21T16:31:04.123Z` (R4).
 * The columns are `TIMESTAMP(3)` holding UTC wall-clock time (both databases
 * verified `TimeZone = Etc/UTC`); the round trip is proven by integration test.
 */
export function toIsoTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("reviews service: invalid timestamp");
  }
  return value.toISOString();
}

export function toRepresentation(row: ReviewRow): ReviewRepresentation {
  return {
    id: row.id,
    rating: row.rating,
    body: row.body,
    created_at: toIsoTimestamp(row.createdAt),
    updated_at: toIsoTimestamp(row.updatedAt),
    author_label: AUTHOR_LABEL,
  };
}

export type CreateOutcome =
  { kind: "created"; review: ReviewRepresentation } | { kind: "duplicate" } | { kind: "not_found" };

/** Maps the single create statement's result (spec §4.1; ADR-013 decision 6). */
export function toCreateOutcome(result: repository.CreateReviewResult): CreateOutcome {
  if (!result.visible) return { kind: "not_found" };
  if (result.review === null) return { kind: "duplicate" };
  return { kind: "created", review: toRepresentation(result.review) };
}

export async function createReview(
  prisma: PrismaClient,
  userId: string,
  input: CreateReviewInput,
): Promise<CreateOutcome> {
  return toCreateOutcome(await repository.createReview(prisma, userId, input));
}

export type UpdateOutcome =
  { kind: "updated"; review: ReviewRepresentation } | { kind: "not_found" };

export async function updateReview(
  prisma: PrismaClient,
  userId: string,
  reviewId: string,
  patch: PatchReviewInput,
): Promise<UpdateOutcome> {
  const row = await repository.updateReview(prisma, userId, reviewId, patch);
  return row ? { kind: "updated", review: toRepresentation(row) } : { kind: "not_found" };
}

export type DeleteOutcome = { kind: "deleted" } | { kind: "not_found" };

export async function deleteReview(
  prisma: PrismaClient,
  userId: string,
  reviewId: string,
): Promise<DeleteOutcome> {
  return (await repository.deleteReview(prisma, userId, reviewId))
    ? { kind: "deleted" }
    : { kind: "not_found" };
}

export type OwnReviewOutcome =
  { kind: "found"; review: ReviewRepresentation | null } | { kind: "not_found" };

export async function getOwnReview(
  prisma: PrismaClient,
  userId: string,
  landmarkId: string,
): Promise<OwnReviewOutcome> {
  const result = await repository.findOwnReview(prisma, userId, landmarkId);
  if (!result.visible) return { kind: "not_found" };
  return { kind: "found", review: result.review ? toRepresentation(result.review) : null };
}

/** Spec §6 response body for `GET /api/v1/landmarks/:landmarkId/reviews`. */
export interface PublicReviewsResponse {
  reviews: ReviewRepresentation[];
  aggregate: { average_rating: number | null; rating_count: number };
  page: number;
  limit: number;
  has_more: boolean;
}

export type ListOutcome = { kind: "listed"; body: PublicReviewsResponse } | { kind: "not_found" };

export function toListOutcome(
  result: repository.PublicListResult,
  query: ReviewsListQuery,
): ListOutcome {
  if (!result.visible) return { kind: "not_found" };
  return {
    kind: "listed",
    body: {
      reviews: result.rows.map(toRepresentation),
      aggregate: {
        average_rating: result.ratingCount === 0 ? null : result.averageRating,
        rating_count: result.ratingCount,
      },
      page: query.page,
      limit: query.limit,
      has_more: result.hasMore,
    },
  };
}

export async function listPublicReviews(
  prisma: PrismaClient,
  landmarkId: string,
  query: ReviewsListQuery,
): Promise<ListOutcome> {
  return toListOutcome(await repository.listPublicReviews(prisma, landmarkId, query), query);
}
