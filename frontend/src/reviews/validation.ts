/**
 * Client-side review validation (M04-T03 Increment 1). It MIRRORS the
 * server's rules (specs/RATINGS_REVIEWS_SPEC.md v1.1 §4.1; ADR-013 decision 8;
 * backend/src/reviews/request-schema.ts) so a form can explain problems before
 * sending — but the server stays authoritative: anything this accepts may
 * still be refused, and the UI must handle that.
 *
 * Body processing, in the server's order:
 *  1. absent or `null` → `null`;
 *  2. reject U+0000 (NUL);
 *  3. reject text that is not well-formed (an unpaired UTF-16 surrogate);
 *  4. trim with ECMAScript `String.prototype.trim()`;
 *  5. empty after trimming → `null`;
 *  6. more than 2,000 Unicode code points → error.
 * No Unicode normalization is applied; internal line breaks and every other
 * well-formed character are kept exactly. (Zero-width-only text, e.g. U+200B,
 * is not whitespace under `trim()`, so — like the server — this keeps it;
 * decision Q5.)
 */

export const MIN_RATING = 1;
export const MAX_RATING = 5;
/** Spec §3/§4.1: at most 2,000 characters, counted as Unicode code points. */
export const MAX_BODY_CODE_POINTS = 2000;

/** User-facing messages (the UI may show them next to the field). */
export const REVIEW_MESSAGES = {
  ratingRequired: "Choose a rating from 1 to 5 stars.",
  bodyCharacters: "Your review contains characters that can't be saved. Remove them and try again.",
  bodyTooLong: `Your review can be at most ${MAX_BODY_CODE_POINTS.toLocaleString("en-US")} characters.`,
  nothingToUpdate: "Change the rating, the review text, or both.",
} as const;

/** Unpaired UTF-16 surrogates — the fallback when `isWellFormed` is unavailable. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * True when `text` contains no unpaired surrogate. Uses the ES2024
 * `String.prototype.isWellFormed()` where the browser provides it (its type is
 * declared locally because the project's TypeScript `lib` is ES2022) and an
 * equivalent check otherwise.
 */
export function isWellFormedText(text: string): boolean {
  const candidate = text as string & { isWellFormed?: () => boolean };
  if (typeof candidate.isWellFormed === "function") return candidate.isWellFormed();
  return !LONE_SURROGATE.test(text);
}

/** Number of Unicode code points (not UTF-16 code units). */
export function countCodePoints(text: string): number {
  return Array.from(text).length;
}

export type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** A rating must be an integer from 1 through 5. */
export function validateRating(value: unknown): FieldResult<number> {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RATING &&
    value <= MAX_RATING
    ? { ok: true, value }
    : { ok: false, message: REVIEW_MESSAGES.ratingRequired };
}

/** Normalizes review text exactly as the server does (see the module comment). */
export function normalizeReviewBody(value: string | null | undefined): FieldResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (value.includes("\u0000") || !isWellFormedText(value)) {
    return { ok: false, message: REVIEW_MESSAGES.bodyCharacters };
  }
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (countCodePoints(trimmed) > MAX_BODY_CODE_POINTS) {
    return { ok: false, message: REVIEW_MESSAGES.bodyTooLong };
  }
  return { ok: true, value: trimmed };
}

/** A complete new review, ready to send. */
export interface ReviewDraftValue {
  rating: number;
  body: string | null;
}

export interface ReviewFieldErrors {
  rating?: string;
  body?: string;
}

export type DraftResult =
  { ok: true; value: ReviewDraftValue } | { ok: false; errors: ReviewFieldErrors };

/**
 * Validates a whole form for creating a review: a rating is required, text is
 * optional. Reports every field's problem at once (for an error summary).
 */
export function validateReviewDraft(draft: {
  rating: number | null | undefined;
  body: string | null | undefined;
}): DraftResult {
  const rating = validateRating(draft.rating);
  const body = normalizeReviewBody(draft.body);
  const errors: ReviewFieldErrors = {};
  if (!rating.ok) errors.rating = rating.message;
  if (!body.ok) errors.body = body.message;
  if (!rating.ok || !body.ok) return { ok: false, errors };
  return { ok: true, value: { rating: rating.value, body: body.value } };
}

/**
 * A validated edit. A key is present ONLY when it was supplied: an omitted
 * `body` leaves the stored text unchanged, while `body: null` (or text that is
 * empty after trimming) clears it (spec §4.2).
 */
export interface ReviewPatchValue {
  rating?: number;
  body?: string | null;
}

export type PatchResult =
  | { ok: true; value: ReviewPatchValue }
  | { ok: false; errors: ReviewFieldErrors & { form?: string } };

/** Validates an edit, keeping the omitted-versus-null distinction by key presence. */
export function validateReviewPatch(patch: {
  rating?: number | null;
  body?: string | null;
}): PatchResult {
  const hasRating = Object.prototype.hasOwnProperty.call(patch, "rating");
  const hasBody = Object.prototype.hasOwnProperty.call(patch, "body");
  if (!hasRating && !hasBody) {
    return { ok: false, errors: { form: REVIEW_MESSAGES.nothingToUpdate } };
  }
  const errors: ReviewFieldErrors = {};
  const value: ReviewPatchValue = {};
  if (hasRating) {
    const rating = validateRating(patch.rating);
    if (rating.ok) value.rating = rating.value;
    else errors.rating = rating.message;
  }
  if (hasBody) {
    const body = normalizeReviewBody(patch.body);
    if (body.ok) value.body = body.value;
    else errors.body = body.message;
  }
  if (errors.rating !== undefined || errors.body !== undefined) return { ok: false, errors };
  return { ok: true, value };
}
