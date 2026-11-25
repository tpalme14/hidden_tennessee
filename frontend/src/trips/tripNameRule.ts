import { isWellFormedText } from "../reviews/validation";

/**
 * The client-side trip-name rule (M05-T04 Increment 1;
 * specs/TRIP_PLANNING_SPEC.md v1.1 §5.1.1; ADR-014 decision 5). It mirrors the
 * server's `backend/src/trips/name-rule.ts` step for step; the SERVER is
 * authoritative, and the interface shows the server's validation error when
 * the two disagree (for example, a character assigned after this browser's
 * Unicode version). Both sides are tested against one shared ASCII-only corpus
 * (`testdata/tripNameCorpus.json`) and pin the same fingerprint.
 *
 * Steps, in this exact order — the first failure decides the outcome:
 *   1. a string                                             → "type"
 *   2. well-formed Unicode (no unpaired surrogate)          → "characters"
 *   3. trim with String.prototype.trim() (outer whitespace, including tabs
 *      and line breaks, is removed and therefore allowed)
 *   4. no control or line-separator character anywhere: U+0000–U+001F,
 *      U+007F–U+009F (including U+0085, which trim() keeps), U+2028, U+2029
 *                                                           → "characters"
 *   5. at least one Letter, Number, Punctuation, or Symbol  → "noVisible"
 *   6. at most 100 Unicode code points                      → "tooLong"
 * No normalization: the value is exactly the trimmed input. Control
 * characters are tested by numeric code point, so this file contains no
 * literal invisible characters.
 */

export const MAX_TRIP_NAME_CODE_POINTS = 100;

export type TripNameRejection = "type" | "characters" | "noVisible" | "tooLong";

/** The server's fixed messages for each rejection (backend `request-schema.ts`), word for word. */
export const TRIP_NAME_MESSAGES: Record<TripNameRejection, string> = {
  type: "name is required and must be text.",
  characters: "name contains characters that are not allowed.",
  noVisible: "name must contain at least one letter, number, punctuation mark, or symbol.",
  tooLong: "name must be at most 100 characters.",
};

export type TripNameResult =
  { ok: true; value: string } | { ok: false; reason: TripNameRejection; message: string };

const VISIBLE_CHARACTER = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** C0 controls, DEL and C1 controls, LINE SEPARATOR, PARAGRAPH SEPARATOR. */
export function isForbiddenNameCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

function reject(reason: TripNameRejection): TripNameResult {
  return { ok: false, reason, message: TRIP_NAME_MESSAGES[reason] };
}

/** Applies spec v1.1 §5.1.1 to a trip name typed by the user. */
export function validateTripName(value: unknown): TripNameResult {
  if (typeof value !== "string") return reject("type");
  if (!isWellFormedText(value)) return reject("characters");

  const trimmed = value.trim();
  const codePoints = Array.from(trimmed);
  if (codePoints.some((ch) => isForbiddenNameCodePoint(ch.codePointAt(0)!))) {
    return reject("characters");
  }
  if (!VISIBLE_CHARACTER.test(trimmed)) return reject("noVisible");
  if (codePoints.length > MAX_TRIP_NAME_CODE_POINTS) return reject("tooLong");
  return { ok: true, value: trimmed };
}
