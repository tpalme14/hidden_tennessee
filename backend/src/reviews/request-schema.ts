import { z } from "zod";

/**
 * Request validation for the reviews API (M04-T02 Increment 2;
 * specs/RATINGS_REVIEWS_SPEC.md v1.1 §§3, 4.1, 4.2, 6, 10.1; ADR-013
 * decision 8; ADR-012 decision 5).
 *
 * Strict Zod objects reject every unexpected field — including any
 * client-supplied identity such as `user_id` — as defence in depth. Identity
 * itself never comes from the request: it is the session-derived user ID,
 * applied inside every query (repository.ts).
 *
 * Every error carries a FIXED, safe message chosen here and never echoes the
 * submitted value. Mapping errors to HTTP envelopes is the router's job
 * (Increment 3): `INVALID_REQUEST` and `INVALID_QUERY` both answer 400.
 */

export type ReviewsRequestErrorCode = "INVALID_REQUEST" | "INVALID_QUERY";

export class ReviewsRequestError extends Error {
  constructor(
    readonly code: ReviewsRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewsRequestError";
  }
}

/** Fixed messages — the only text a validation error can carry. */
export const MESSAGES = {
  invalidReviewId: "Invalid review ID.",
  invalidLandmarkId: "Invalid landmark ID.",
  invalidBodyShape: "The request body must be a JSON object.",
  unsupportedFields: "The request body contains unsupported fields.",
  invalidRating: "rating must be a whole number from 1 through 5.",
  invalidBodyType: "body must be text or null.",
  bodyCharacters: "body contains characters that are not allowed.",
  bodyTooLong: "body must be at most 2,000 characters.",
  emptyPatch: "Provide rating, body, or both.",
  noBodyFields: "This request accepts no body fields.",
  noQuery: "This request accepts no query parameters.",
  lookupQuery:
    "landmark_id is required and must be a valid ID; no other query parameters are accepted.",
  listQuery: "page and limit must be positive integers; no other query parameters are accepted.",
  pageTooLarge: "page is too large.",
} as const;

/**
 * Any 8-4-4-4-12 hexadecimal string, any case — the same syntax the favorites
 * and landmark endpoints accept and PostgreSQL's `uuid` type parses.
 */
const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A positive decimal integer with no sign, leading zero, fraction, exponent, or whitespace. */
const POSITIVE_DIGITS = /^[1-9][0-9]*$/;

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
/** Spec §3/§4.1: at most 2,000 characters, counted as Unicode code points. */
export const MAX_BODY_CODE_POINTS = 2000;

const idSchema = z.string().regex(UUID_SYNTAX);
const ratingSchema = z.number().int().min(1).max(5);
const bodySchema = z.union([z.string(), z.null()]);

const createSchema = z.strictObject({
  landmark_id: idSchema,
  rating: ratingSchema,
  body: bodySchema.optional(),
});

const patchSchema = z.strictObject({
  rating: ratingSchema.optional(),
  body: bodySchema.optional(),
});

const emptyObjectSchema = z.strictObject({});
const lookupQuerySchema = z.strictObject({ landmark_id: idSchema });
const listQuerySchema = z.strictObject({
  page: z.string().regex(POSITIVE_DIGITS).optional(),
  limit: z.string().regex(POSITIVE_DIGITS).optional(),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `String.prototype.isWellFormed()` (ES2024) is available at runtime under the
 * project's Node `>=22` engine (ADR-013 decision 8), but the shared
 * TypeScript `lib` setting is ES2022, so its type is declared locally rather
 * than changing project-wide compiler settings.
 */
function isWellFormedText(text: string): boolean {
  return (text as string & { isWellFormed(): boolean }).isWellFormed();
}

/** Number of Unicode code points (not UTF-16 code units). */
export function countCodePoints(text: string): number {
  return Array.from(text).length;
}

/**
 * Normalizes a submitted review body (spec v1.1 §4.1, ADR-013 decision 8), in
 * this order:
 *  1. `undefined` or `null` → `null`; any non-string → error;
 *  2. reject U+0000 (PostgreSQL `text` cannot store it);
 *  3. reject text that is not well-formed (an unpaired UTF-16 surrogate,
 *     which the database driver would otherwise silently replace with U+FFFD);
 *  4. trim with ECMAScript `String.prototype.trim()`;
 *  5. empty after trimming → `null`;
 *  6. more than 2,000 code points → error.
 * No Unicode normalization is applied; internal line breaks and all other
 * well-formed characters are preserved exactly.
 */
export function normalizeReviewBody(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ReviewsRequestError("INVALID_REQUEST", MESSAGES.invalidBodyType);
  }
  if (value.includes("\u0000") || !isWellFormedText(value)) {
    throw new ReviewsRequestError("INVALID_REQUEST", MESSAGES.bodyCharacters);
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (countCodePoints(trimmed) > MAX_BODY_CODE_POINTS) {
    throw new ReviewsRequestError("INVALID_REQUEST", MESSAGES.bodyTooLong);
  }
  return trimmed;
}

/** Maps a failed body parse to one fixed message, by the first offending field. */
function bodyError(issues: z.ZodError["issues"]): ReviewsRequestError {
  const issue = issues[0];
  if (!issue || issue.code === "unrecognized_keys") {
    return new ReviewsRequestError("INVALID_REQUEST", MESSAGES.unsupportedFields);
  }
  switch (issue.path[0]) {
    case "rating":
      return new ReviewsRequestError("INVALID_REQUEST", MESSAGES.invalidRating);
    case "body":
      return new ReviewsRequestError("INVALID_REQUEST", MESSAGES.invalidBodyType);
    case "landmark_id":
      return new ReviewsRequestError("INVALID_REQUEST", MESSAGES.invalidLandmarkId);
    default:
      return new ReviewsRequestError("INVALID_REQUEST", MESSAGES.unsupportedFields);
  }
}

function parseId(raw: unknown, message: string): string {
  const result = idSchema.safeParse(raw);
  if (!result.success) throw new ReviewsRequestError("INVALID_REQUEST", message);
  return result.data.toLowerCase();
}

/** The `:reviewId` path value, in canonical lower case (400 INVALID_REQUEST otherwise). */
export function parseReviewId(raw: unknown): string {
  return parseId(raw, MESSAGES.invalidReviewId);
}

/** The public list's `:landmarkId` path value, in canonical lower case (decision A1: 400, not 404). */
export function parseLandmarkId(raw: unknown): string {
  return parseId(raw, MESSAGES.invalidLandmarkId);
}

/** Mutations (POST, PATCH, DELETE) accept no query parameters (R7). */
export function parseNoQuery(query: unknown): void {
  if (!emptyObjectSchema.safeParse(query ?? {}).success) {
    throw new ReviewsRequestError("INVALID_QUERY", MESSAGES.noQuery);
  }
}

/** DELETE: the body must be absent or an empty JSON object (R7). */
export function parseEmptyBody(body: unknown): void {
  if (body !== undefined && !emptyObjectSchema.safeParse(body).success) {
    throw new ReviewsRequestError("INVALID_REQUEST", MESSAGES.noBodyFields);
  }
}

export interface CreateReviewInput {
  landmarkId: string;
  rating: number;
  body: string | null;
}

/** `POST /api/v1/reviews` body: `{ landmark_id, rating, body? }`, nothing else. */
export function parseCreateBody(body: unknown): CreateReviewInput {
  if (!isPlainObject(body)) {
    throw new ReviewsRequestError("INVALID_REQUEST", MESSAGES.invalidBodyShape);
  }
  const result = createSchema.safeParse(body);
  if (!result.success) throw bodyError(result.error.issues);
  return {
    landmarkId: result.data.landmark_id.toLowerCase(),
    rating: result.data.rating,
    body: normalizeReviewBody(result.data.body),
  };
}

/**
 * A validated PATCH. A key is present only when the client supplied it:
 * an omitted `body` leaves the stored text unchanged, while `body: null` or
 * whitespace-only text clears it (spec §4.2).
 */
export interface PatchReviewInput {
  rating?: number;
  body?: string | null;
}

/** `PATCH /api/v1/reviews/:reviewId` body: at least one of `rating`, `body`. */
export function parsePatchBody(body: unknown): PatchReviewInput {
  if (!isPlainObject(body)) {
    throw new ReviewsRequestError("INVALID_REQUEST", MESSAGES.invalidBodyShape);
  }
  const result = patchSchema.safeParse(body);
  if (!result.success) throw bodyError(result.error.issues);

  const hasRating = Object.prototype.hasOwnProperty.call(body, "rating");
  const hasBody = Object.prototype.hasOwnProperty.call(body, "body");
  if (!hasRating && !hasBody) {
    throw new ReviewsRequestError("INVALID_REQUEST", MESSAGES.emptyPatch);
  }
  const patch: PatchReviewInput = {};
  if (hasRating) patch.rating = result.data.rating;
  if (hasBody) patch.body = normalizeReviewBody(result.data.body);
  return patch;
}

/** `GET /api/v1/reviews?landmark_id=<uuid>`: exactly one well-formed `landmark_id` (R7: 400 INVALID_QUERY). */
export function parseOwnReviewQuery(query: unknown): { landmarkId: string } {
  const result = lookupQuerySchema.safeParse(query ?? {});
  if (!result.success) throw new ReviewsRequestError("INVALID_QUERY", MESSAGES.lookupQuery);
  return { landmarkId: result.data.landmark_id.toLowerCase() };
}

export interface ReviewsListQuery {
  page: number;
  limit: number;
  offset: number;
}

/**
 * Public list query: only `page` (default 1) and `limit` (default 20, maximum
 * 100), each a single positive decimal integer (spec §6). Unknown keys,
 * repeated parameters (arrays), and an offset beyond a safe integer are
 * rejected.
 */
export function parseListQuery(query: unknown): ReviewsListQuery {
  const result = listQuerySchema.safeParse(query ?? {});
  if (!result.success) throw new ReviewsRequestError("INVALID_QUERY", MESSAGES.listQuery);

  const page = result.data.page === undefined ? DEFAULT_PAGE : Number(result.data.page);
  const limit = result.data.limit === undefined ? DEFAULT_LIMIT : Number(result.data.limit);
  if (!Number.isSafeInteger(page)) {
    throw new ReviewsRequestError("INVALID_QUERY", MESSAGES.pageTooLarge);
  }
  if (limit > MAX_LIMIT) {
    throw new ReviewsRequestError("INVALID_QUERY", MESSAGES.listQuery);
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    throw new ReviewsRequestError("INVALID_QUERY", MESSAGES.pageTooLarge);
  }
  return { page, limit, offset };
}
