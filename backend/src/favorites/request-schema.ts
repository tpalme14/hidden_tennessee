import { z } from "zod";

/**
 * Request validation for the favorites API (M03-T05 Increment 2; spec
 * AUTHENTICATION_FAVORITES_SPEC.md §7; ADR-012 decision 5).
 *
 * Strict Zod objects reject every unexpected field — including any
 * client-supplied identity such as `user_id` — as defence in depth. Identity
 * itself never comes from the request: it is the session-derived user ID
 * (`authenticatedUserId`), applied inside every query (repository.ts).
 *
 * Every error carries a fixed, safe message and never echoes the submitted
 * value. Mapping errors to HTTP envelopes is the router's job (Increment 3).
 */

export type FavoritesRequestErrorCode = "INVALID_REQUEST" | "INVALID_QUERY";

export class FavoritesRequestError extends Error {
  constructor(
    readonly code: FavoritesRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FavoritesRequestError";
  }
}

/**
 * Any 8-4-4-4-12 hexadecimal string, any case (decision E2) — the same
 * syntax `findLandmarkById` accepts and PostgreSQL's `uuid` type parses. Not
 * RFC version/variant-strict, so DELETE answers 200 for every well-formed ID.
 */
const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A positive decimal integer with no sign, leading zero, fraction, exponent, or whitespace (decision E3). */
const POSITIVE_DIGITS = /^[1-9][0-9]*$/;

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

const landmarkIdSchema = z.string().regex(UUID_SYNTAX);
const emptyObjectSchema = z.strictObject({});
const listQuerySchema = z.strictObject({
  page: z.string().regex(POSITIVE_DIGITS).optional(),
  limit: z.string().regex(POSITIVE_DIGITS).optional(),
});

/** The `:landmarkId` path value, returned in canonical lower-case form. */
export function parseLandmarkId(raw: unknown): string {
  const result = landmarkIdSchema.safeParse(raw);
  if (!result.success) {
    throw new FavoritesRequestError("INVALID_REQUEST", "Invalid landmark ID.");
  }
  return result.data.toLowerCase();
}

/**
 * The query and body of a PUT/DELETE mutation. No query parameter is
 * accepted. The body must be absent or an empty JSON object (decision E6);
 * any key — `user_id`, `userId`, `landmarkId`, … — or an array is rejected.
 */
export function parseMutationRequest(query: unknown, body: unknown): void {
  if (!emptyObjectSchema.safeParse(query ?? {}).success) {
    throw new FavoritesRequestError("INVALID_QUERY", "This request accepts no query parameters.");
  }
  if (body !== undefined && !emptyObjectSchema.safeParse(body).success) {
    throw new FavoritesRequestError("INVALID_REQUEST", "This request accepts no body fields.");
  }
}

export interface FavoritesListQuery {
  page: number;
  limit: number;
  offset: number;
}

/**
 * `GET` query: only `page` (default 1) and `limit` (default 50, maximum 100),
 * each a single positive decimal integer. Unknown keys, repeated parameters
 * (arrays), and an offset that is not a safe integer are rejected.
 */
export function parseListQuery(query: unknown): FavoritesListQuery {
  const result = listQuerySchema.safeParse(query ?? {});
  if (!result.success) {
    throw new FavoritesRequestError(
      "INVALID_QUERY",
      "page and limit must be positive integers; no other query parameters are accepted.",
    );
  }

  const page = result.data.page === undefined ? DEFAULT_PAGE : Number(result.data.page);
  const limit = result.data.limit === undefined ? DEFAULT_LIMIT : Number(result.data.limit);

  if (!Number.isSafeInteger(page)) {
    throw new FavoritesRequestError("INVALID_QUERY", "page is too large.");
  }
  if (limit > MAX_LIMIT) {
    throw new FavoritesRequestError("INVALID_QUERY", `limit must be from 1 through ${MAX_LIMIT}.`);
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    throw new FavoritesRequestError("INVALID_QUERY", "page is too large.");
  }
  return { page, limit, offset };
}
