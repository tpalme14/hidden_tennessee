import { DEFAULT_TRIPS_LIMIT } from "../api/trips";

/** The My Trips route (M05-T06 Increment 2). Page 1 is the canonical URL without `?page=`. */
export const TRIPS_PATH = "/trips";

/** Decision D13: My Trips shows the server's default page size, 20 trips per page. */
export const TRIPS_PAGE_SIZE = DEFAULT_TRIPS_LIMIT;

/** Positive decimal integer, no sign, no leading zero, bounded length. */
const PAGE_SYNTAX = /^[1-9][0-9]{0,15}$/;

/**
 * The page requested by `?page=`, following the My Favorites convention
 * (`favoritesPageParam.ts`, M03-T06 decision M4):
 * - absent → 1;
 * - exactly one value of decimal digits with no leading zero whose offset is a
 *   safe integer → that page;
 * - anything else (empty, zero, negative, signed, fractional, leading zero,
 *   non-digits, repeated, or too large) → `null`, which the page replaces with
 *   page 1 (history replace) without requesting anything first.
 * A valid page past the end is NOT invalid here; the page shows a message for it.
 */
export function parseTripsPageParam(params: URLSearchParams): number | null {
  const values = params.getAll("page");
  if (values.length === 0) return 1;
  const [raw] = values;
  if (values.length > 1 || raw === undefined || !PAGE_SYNTAX.test(raw)) return null;
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * TRIPS_PAGE_SIZE)) {
    return null;
  }
  return page;
}

/** The URL of one My Trips page. */
export function tripsPageHref(page: number): string {
  return page <= 1 ? TRIPS_PATH : `${TRIPS_PATH}?page=${page}`;
}
