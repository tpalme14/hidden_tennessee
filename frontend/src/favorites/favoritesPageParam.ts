import { FAVORITES_PAGE_SIZE } from "./useFavoritesList";

/** The My Favorites route (K6). Page 1 is the canonical URL without `?page=`. */
export const FAVORITES_PATH = "/favorites";

/** Positive decimal integer, no sign, no leading zero, bounded length. */
const PAGE_SYNTAX = /^[1-9][0-9]{0,15}$/;

/**
 * The page requested by `?page=` (M03-T06 Increment 5, decision M4):
 * - absent → 1;
 * - exactly one value of decimal digits with no leading zero whose offset is a
 *   safe integer (the same rule the API applies) → that page;
 * - anything else (empty, zero, negative, signed, fractional, leading zero,
 *   non-digits, repeated, or too large) → `null`, which the page normalizes to
 *   page 1 with history replace.
 * A valid page past the end is NOT invalid here; the page shows a message for it.
 */
export function parseFavoritesPageParam(params: URLSearchParams): number | null {
  const values = params.getAll("page");
  if (values.length === 0) return 1;
  const [raw] = values;
  if (values.length > 1 || raw === undefined || !PAGE_SYNTAX.test(raw)) return null;
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * FAVORITES_PAGE_SIZE)) {
    return null;
  }
  return page;
}

/** The URL of one favorites page. */
export function favoritesPageHref(page: number): string {
  return page <= 1 ? FAVORITES_PATH : `${FAVORITES_PATH}?page=${page}`;
}
