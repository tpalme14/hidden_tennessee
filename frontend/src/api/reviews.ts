import { MAX_BODY_CODE_POINTS, countCodePoints } from "../reviews/validation";
import type { ReviewDraftValue, ReviewPatchValue } from "../reviews/validation";
import { ApiError, deleteJson, getJson, patchJson, postJson } from "./client";

/**
 * Typed wrappers over the reviews API (M04-T03 Increment 1), mirroring the
 * contract implemented and verified in M04-T02 (specs/RATINGS_REVIEWS_SPEC.md
 * v1.1 §6; ADR-013; the M04-T02 record in docs/IMPLEMENTATION_PLAN.md). The
 * session cookie identifies the user; no user ID is ever sent or received.
 *
 * Every response is checked before it reaches the UI. Reviews are REBUILT
 * from exactly the six approved fields (`id`, `rating`, `body`, `created_at`,
 * `updated_at`, `author_label`), so nothing else in a response — a user ID, an
 * email, landmark data — can pass through. A structurally malformed response
 * is an `INVALID_RESPONSE` `ApiError`, never a partial result.
 *
 * Server errors keep the existing `ApiError` contract (status, code, message,
 * `retryAfterSeconds` on 429), so callers see 400 `INVALID_REQUEST` /
 * `INVALID_QUERY`, 401, 403, 404, 409 `REVIEW_ALREADY_EXISTS`, 429, and 5xx
 * exactly as the backend reports them.
 */

const REVIEWS_PATH = "/api/v1/reviews";
const landmarkReviewsPath = (landmarkId: string) =>
  `/api/v1/landmarks/${encodeURIComponent(landmarkId)}/reviews`;
const reviewPath = (reviewId: string) => `${REVIEWS_PATH}/${encodeURIComponent(reviewId)}`;

/** Spec §3, §10.2.1: the fixed public attribution label. */
export const COMMUNITY_MEMBER = "Community Member";

/** The 409 code for a second review of the same landmark (ADR-013 decision 7). */
export const REVIEW_ALREADY_EXISTS = "REVIEW_ALREADY_EXISTS";

/** One review as the API returns it — never an author identity. */
export interface Review {
  id: string;
  rating: number;
  body: string | null;
  /** ISO 8601, UTC, with milliseconds. */
  created_at: string;
  updated_at: string;
  author_label: typeof COMMUNITY_MEMBER;
}

export interface ReviewAggregate {
  /** The unrounded mean, or `null` exactly when `rating_count` is 0. */
  average_rating: number | null;
  rating_count: number;
}

export interface LandmarkReviewsPage {
  reviews: Review[];
  aggregate: ReviewAggregate;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface LandmarkReviewsQuery {
  /** Positive integer; the server's default is 1. */
  page?: number;
  /** 1–100; the server's default is 20. */
  limit?: number;
}

export const DEFAULT_REVIEWS_PAGE = 1;
export const DEFAULT_REVIEWS_LIMIT = 20;
export const MAX_REVIEWS_LIMIT = 100;

/** Any 8-4-4-4-12 hexadecimal string, any case — the syntax the backend accepts. */
const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The exact timestamp form the backend produces (`Date#toISOString`). */
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalidResponse(status: number): ApiError {
  return new ApiError(status, "INVALID_RESPONSE", "The server returned an unexpected response.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function parseId(value: unknown): string | null {
  return typeof value === "string" && UUID_SYNTAX.test(value) ? value.toLowerCase() : null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_UTC_MS.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * One validated review rebuilt from its approved fields, or null when it is
 * malformed (which fails the whole response). A body is `null` or non-empty
 * text of at most 2,000 code points; the label must be exactly
 * "Community Member" (fail closed on anything else).
 */
export function parseReview(raw: unknown): Review | null {
  if (!isRecord(raw)) return null;
  const id = parseId(raw.id);
  if (id === null) return null;
  const { rating, body, created_at, updated_at, author_label } = raw;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return null;
  }
  if (
    body !== null &&
    (typeof body !== "string" || body.length === 0 || countCodePoints(body) > MAX_BODY_CODE_POINTS)
  ) {
    return null;
  }
  if (!isTimestamp(created_at) || !isTimestamp(updated_at)) return null;
  if (author_label !== COMMUNITY_MEMBER) return null;
  return { id, rating, body, created_at, updated_at, author_label: COMMUNITY_MEMBER };
}

function parseAggregate(raw: unknown): ReviewAggregate | null {
  if (!isRecord(raw)) return null;
  const { average_rating, rating_count } = raw;
  if (typeof rating_count !== "number" || !Number.isSafeInteger(rating_count) || rating_count < 0) {
    return null;
  }
  if (rating_count === 0) {
    return average_rating === null ? { average_rating: null, rating_count: 0 } : null;
  }
  if (
    typeof average_rating !== "number" ||
    !Number.isFinite(average_rating) ||
    average_rating < 1 ||
    average_rating > 5
  ) {
    return null;
  }
  return { average_rating, rating_count };
}

/** A validated public list page, or null when malformed or not matching the request. */
export function parseLandmarkReviewsPage(
  raw: unknown,
  expected: { page: number; limit: number },
): LandmarkReviewsPage | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.reviews) || typeof raw.has_more !== "boolean") return null;
  if (!isPositiveInteger(raw.page) || !isPositiveInteger(raw.limit)) return null;
  if (raw.page !== expected.page || raw.limit !== expected.limit) return null;
  if (raw.reviews.length > raw.limit) return null;

  const aggregate = parseAggregate(raw.aggregate);
  if (aggregate === null) return null;
  // The page and the aggregate come from one database snapshot (ADR-013).
  if (raw.reviews.length > aggregate.rating_count) return null;

  const reviews: Review[] = [];
  const seen = new Set<string>();
  for (const item of raw.reviews) {
    const review = parseReview(item);
    if (review === null || seen.has(review.id)) return null;
    seen.add(review.id);
    reviews.push(review);
  }
  return { reviews, aggregate, page: raw.page, limit: raw.limit, has_more: raw.has_more };
}

function assertQuery(page: number, limit: number): void {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("reviews page must be a positive integer");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REVIEWS_LIMIT) {
    throw new RangeError(`reviews limit must be an integer from 1 through ${MAX_REVIEWS_LIMIT}`);
  }
}

/**
 * `GET /api/v1/landmarks/:landmarkId/reviews` — one page of a visible
 * landmark's reviews, newest first, with the aggregate over all of them. A
 * missing, retired, or non-public landmark is a 404 `ApiError`.
 */
export async function listLandmarkReviews(
  landmarkId: string,
  query: LandmarkReviewsQuery = {},
): Promise<LandmarkReviewsPage> {
  const page = query.page ?? DEFAULT_REVIEWS_PAGE;
  const limit = query.limit ?? DEFAULT_REVIEWS_LIMIT;
  assertQuery(page, limit);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const raw = await getJson<unknown>(`${landmarkReviewsPath(landmarkId)}?${params.toString()}`);
  const parsed = parseLandmarkReviewsPage(raw, { page, limit });
  if (parsed === null) throw invalidResponse(200);
  return parsed;
}

/**
 * `GET /api/v1/reviews?landmark_id=` — the signed-in user's own review of a
 * visible landmark, or `null` when they have none. 401 without a session; 404
 * for a landmark that is missing, retired, or not public.
 */
export async function getOwnReview(landmarkId: string): Promise<Review | null> {
  const params = new URLSearchParams({ landmark_id: landmarkId });
  const raw = await getJson<unknown>(`${REVIEWS_PATH}?${params.toString()}`);
  if (!isRecord(raw) || !("review" in raw)) throw invalidResponse(200);
  if (raw.review === null) return null;
  const review = parseReview(raw.review);
  if (review === null) throw invalidResponse(200);
  return review;
}

/**
 * `POST /api/v1/reviews` — creates the signed-in user's review. `draft` must
 * already be validated (`validateReviewDraft`). A second review of the same
 * landmark is a 409 `ApiError` with code `REVIEW_ALREADY_EXISTS`.
 */
export async function createReview(landmarkId: string, draft: ReviewDraftValue): Promise<Review> {
  const raw = await postJson<unknown>(REVIEWS_PATH, {
    landmark_id: landmarkId,
    rating: draft.rating,
    body: draft.body,
  });
  const review = parseReview(raw);
  if (review === null) throw invalidResponse(201);
  return review;
}

/**
 * `PATCH /api/v1/reviews/:reviewId` — edits the signed-in user's own review.
 * `patch` must already be validated (`validateReviewPatch`); only its present
 * keys are sent, so an omitted `body` stays omitted and `body: null` clears it.
 */
export async function updateReview(reviewId: string, patch: ReviewPatchValue): Promise<Review> {
  const payload: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(patch, "rating")) payload.rating = patch.rating;
  if (Object.prototype.hasOwnProperty.call(patch, "body")) payload.body = patch.body;
  if (Object.keys(payload).length === 0) {
    throw new RangeError("a review update must include rating, body, or both");
  }
  const { status, body } = await patchJson<unknown>(reviewPath(reviewId), payload);
  const review = parseReview(body);
  if (status !== 200 || review === null || review.id !== reviewId.toLowerCase()) {
    throw invalidResponse(status);
  }
  return review;
}

/** `DELETE /api/v1/reviews/:reviewId` — deletes the signed-in user's own review (200 `{ success: true }`). */
export async function deleteReview(reviewId: string): Promise<void> {
  const { status, body } = await deleteJson<unknown>(reviewPath(reviewId));
  if (status !== 200 || !isRecord(body) || body.success !== true) throw invalidResponse(status);
}
