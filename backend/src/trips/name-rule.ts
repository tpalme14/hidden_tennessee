/**
 * The trip-name rule (M05-T03 Increment 1; specs/TRIP_PLANNING_SPEC.md v1.1
 * §5.1.1; ADR-014 decision 5). The server is authoritative; the frontend
 * mirrors this rule (M05-T04), and both sides are tested against one shared,
 * ASCII-only corpus (frontend/src/trips/testdata/tripNameCorpus.json).
 *
 * Steps, in this exact order — the first failure decides the outcome:
 *   1. the value must be a string                          → "type"
 *   2. it must be well-formed Unicode (no unpaired surrogate) → "characters"
 *   3. trim with ECMAScript String.prototype.trim() — whitespace at either
 *      end, including tabs and line breaks, is removed and therefore allowed
 *   4. after trimming, no control or line-separator character anywhere:
 *      U+0000–U+001F, U+007F–U+009F (including U+0085, which trim() keeps),
 *      U+2028, U+2029                                       → "characters"
 *   5. at least one visible character: a code point in Unicode General
 *      Category L (letter), N (number), P (punctuation), or S (symbol).
 *      Marks, separators, format, private-use, and unassigned code points
 *      do not count                                        → "noVisible"
 *   6. at most 100 Unicode code points                     → "tooLong"
 * No Unicode normalization is applied: the stored name is exactly the trimmed
 * input. Format characters (Cf, e.g. U+200D ZERO WIDTH JOINER) are allowed
 * inside a name; names are always rendered direction-isolated.
 *
 * Control characters are tested by numeric code point rather than with
 * escape sequences in a regular expression, so this source file contains no
 * literal invisible characters.
 */

export const MAX_TRIP_NAME_CODE_POINTS = 100;

export type TripNameRejection = "type" | "characters" | "noVisible" | "tooLong";

export type TripNameResult = { ok: true; value: string } | { ok: false; reason: TripNameRejection };

/** Letter, Number, Punctuation, or Symbol (spec §5.1.1 step 5). */
const VISIBLE_CHARACTER = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * `String.prototype.isWellFormed()` (ES2024) exists at runtime under the
 * project's Node `>=22` engine, but the shared TypeScript `lib` is ES2022, so
 * its type is declared locally (as in the reviews validator).
 */
function isWellFormedText(text: string): boolean {
  return (text as string & { isWellFormed(): boolean }).isWellFormed();
}

/** C0 controls, DEL and C1 controls, LINE SEPARATOR, PARAGRAPH SEPARATOR. */
export function isForbiddenNameCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

/** Applies spec v1.1 §5.1.1 to a submitted trip name. */
export function validateTripName(value: unknown): TripNameResult {
  if (typeof value !== "string") return { ok: false, reason: "type" };
  if (!isWellFormedText(value)) return { ok: false, reason: "characters" };

  const trimmed = value.trim();
  const codePoints = Array.from(trimmed);
  if (codePoints.some((ch) => isForbiddenNameCodePoint(ch.codePointAt(0)!))) {
    return { ok: false, reason: "characters" };
  }
  if (!VISIBLE_CHARACTER.test(trimmed)) return { ok: false, reason: "noVisible" };
  if (codePoints.length > MAX_TRIP_NAME_CODE_POINTS) return { ok: false, reason: "tooLong" };
  return { ok: true, value: trimmed };
}
