/**
 * Display formatting for review aggregates (M04-T03 Increment 1; spec v1.1
 * §5: "Display rating precision consistently (recommended: one decimal
 * place); retain full precision for calculation"; decision Q4 as approved).
 *
 * The API's `average_rating` is the correctly rounded double of the exact
 * mean (`sum(rating)::float8 / count(*)`, R5). This module only formats it for
 * display; it never changes the value it is given and never reconstructs the
 * rating sum.
 *
 * Rounding: half up at one decimal place, applied to the number's SHORTEST
 * round-trip decimal representation (`String(value)`), not to its binary
 * value. This is what makes boundaries reliable: 4.05 is stored in binary as
 * 4.04999999999999982…, so `(4.05).toFixed(1)` gives "4.0", whereas
 * `String(4.05)` is "4.05", which rounds half up to "4.1". For an exact mean
 * k/n whose decimal expansion ends at the hundredths (every true x.x5
 * boundary), the correctly rounded double's shortest representation is that
 * exact decimal, so the boundary is classified correctly. A mean that is not
 * exactly on a boundary but lies within about 1e-15 of one would need an
 * astronomically large review count; it is not reachable in practice.
 */

/** Spec §5: shown instead of a misleading zero-star rating. */
export const NO_REVIEWS_TEXT = "No reviews yet";

const SCIENTIFIC = /[eE]/;

/**
 * Formats an average rating (1–5) to exactly one decimal place, rounding half
 * up as described above — e.g. 4 → "4.0", 4.25 → "4.3", 4.05 → "4.1",
 * 13 / 3 → "4.3", 4.96 → "5.0". Throws for a value outside 1–5, because an
 * average outside the rating scale is a contract violation that the API layer
 * already rejects.
 */
export function formatAverageRating(value: number): string {
  if (!Number.isFinite(value) || value < 1 || value > 5) {
    throw new RangeError("average rating must be a finite number from 1 through 5");
  }
  const text = String(value);
  if (SCIENTIFIC.test(text)) {
    // Not reachable for 1–5 (no exponent form below 1e21); kept fail-closed.
    throw new RangeError("unexpected exponent form for an average rating");
  }
  const [integerPart, fractionPart = ""] = text.split(".") as [string, string?];
  const integer = Number(integerPart);
  const tenths = fractionPart.length > 0 ? Number(fractionPart[0]) : 0;
  const hundredths = fractionPart.length > 1 ? Number(fractionPart[1]) : 0;

  // Work in whole tenths to avoid any further binary arithmetic on fractions.
  let totalTenths = integer * 10 + tenths;
  if (hundredths >= 5) totalTenths += 1;
  return `${Math.floor(totalTenths / 10)}.${totalTenths % 10}`;
}

/** "1 review", "2 reviews", "1,234 reviews". */
export function formatReviewCount(count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("review count must be a non-negative integer");
  }
  return `${count.toLocaleString("en-US")} ${count === 1 ? "review" : "reviews"}`;
}

export interface RatingAggregate {
  average_rating: number | null;
  rating_count: number;
}

/**
 * The summary line for a landmark's reviews: "No reviews yet" when there are
 * none, otherwise e.g. "4.3 out of 5 · 12 reviews".
 */
export function formatRatingSummary(aggregate: RatingAggregate): string {
  if (aggregate.rating_count === 0 || aggregate.average_rating === null) return NO_REVIEWS_TEXT;
  return `${formatAverageRating(aggregate.average_rating)} out of 5 · ${formatReviewCount(
    aggregate.rating_count,
  )}`;
}
