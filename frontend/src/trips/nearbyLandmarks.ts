import type { OwnerTrip, TripStop } from "../api/trips";
import { parseTripLandmark, parseUuid } from "../api/tripValidation";
import { isAllowedRadius, type AllowedRadiusMiles } from "../map/geo";

/**
 * Nearby landmarks for a selected trip stop — the pure data layer (M05-T05
 * Increment 1; ADR-014 decision 12; Specification 2 §§5.2, 7.1–7.2).
 *
 * Contract reused, unchanged: `GET /api/v1/landmarks?near=lat,lng&radius=R
 * &page=1&limit=200` (requested through `getLandmarkGeoMarkers`). Its success
 * body is exactly `{ items, page, limit, has_more, is_truncated }`; in
 * proximity mode the server returns only active `PUBLIC` landmarks (filtered
 * in SQL — the authoritative privacy boundary), each as
 * `{ id, display_name, category, latitude, longitude, distance_miles }`,
 * ordered by straight-line (geodesic) distance, then name, then ID.
 *
 * Nothing here computes a distance, infers a classification (the response
 * carries none), or reorders results.
 */

/** The origin of a nearby search: an AVAILABLE stop of the validated owner trip. */
export interface NearbyOrigin {
  /** The stop's stable ID — the origin's identity (not its position). */
  stopId: string;
  landmarkId: string;
  latitude: number;
  longitude: number;
}

/** One validated nearby landmark, in server order. */
export interface NearbyLandmark {
  id: string;
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
  /** Straight-line miles from the origin, as the server measured it (0 is valid). */
  distance_miles: number;
}

/**
 * One validated proximity response, for one origin and radius.
 *
 * `hasMore` and `isTruncated` are the server's own flags for the FULL query
 * (which includes the origin landmark itself): `has_more` — another page of
 * matches exists; `is_truncated` — the query matched more than 200. They are
 * passed through unchanged, never recomputed from `results.length` (which is
 * after the origin and any malformed items are left out).
 */
export interface NearbyResultSet {
  origin: NearbyOrigin;
  radius: AllowedRadiusMiles;
  results: NearbyLandmark[];
  hasMore: boolean;
  isTruncated: boolean;
  /** Items left out because they failed validation (or repeated an ID). */
  malformedCount: number;
}

/** A nearby landmark with its membership in the CURRENT trip (derived, never stored). */
export interface NearbyLandmarkView extends NearbyLandmark {
  /** The stop already holding this landmark, with its current number; or null. */
  inTrip: { stopId: string; stopNumber: number } | null;
}

export const NEARBY_PAGE_LIMIT = 200;

const RESPONSE_KEYS = ["items", "page", "limit", "has_more", "is_truncated"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * The origin for `stopId` in the validated trip, or null when there is no
 * such stop or it is not available (an unavailable stop has no coordinates).
 * Looked up by stop ID only — never by displayed position.
 */
export function nearbyOriginOf(trip: OwnerTrip, stopId: string): NearbyOrigin | null {
  const stop = trip.stops.find((s) => s.id === stopId);
  if (stop === undefined || !stop.is_available) return null;
  return {
    stopId: stop.id,
    landmarkId: stop.landmark.id,
    latitude: stop.landmark.latitude,
    longitude: stop.landmark.longitude,
  };
}

/** True when both describe the same stop, landmark, and exact coordinates. */
export function sameOrigin(a: NearbyOrigin, b: NearbyOrigin): boolean {
  return (
    a.stopId === b.stopId &&
    a.landmarkId === b.landmarkId &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude
  );
}

/** One item, or null: the exact public collection-item shape with a finite, non-negative distance. */
function parseNearbyItem(raw: unknown): NearbyLandmark | null {
  if (!isRecord(raw) || !Object.hasOwn(raw, "distance_miles")) return null;
  const { distance_miles, ...rest } = raw;
  if (typeof distance_miles !== "number" || !Number.isFinite(distance_miles)) return null;
  if (distance_miles < 0) return null;
  const landmark = parseTripLandmark(rest);
  if (landmark === null) return null;
  return { ...landmark, distance_miles };
}

/**
 * Validates a proximity response for `origin` and `radius`.
 *
 * - The envelope must be exactly the collection shape, page 1, limit 200,
 *   with boolean flags; otherwise the whole response is rejected (null).
 * - Items failing validation are left out individually and counted — the
 *   discovery map's established convention for malformed items — as are
 *   repeated IDs (the first occurrence is kept).
 * - The origin is left out by LANDMARK ID only; other landmarks at exactly the
 *   same coordinates (distance 0) are kept.
 * - Server order is preserved.
 */
export function parseNearbyResponse(
  raw: unknown,
  origin: NearbyOrigin,
  radius: number,
): NearbyResultSet | null {
  if (!isAllowedRadius(radius)) return null;
  if (!isRecord(raw) || !hasExactKeys(raw, RESPONSE_KEYS)) return null;
  if (!Array.isArray(raw.items) || raw.items.length > NEARBY_PAGE_LIMIT) return null;
  if (raw.page !== 1 || raw.limit !== NEARBY_PAGE_LIMIT) return null;
  if (typeof raw.has_more !== "boolean" || typeof raw.is_truncated !== "boolean") return null;

  const originId = parseUuid(origin.landmarkId);
  const results: NearbyLandmark[] = [];
  const seen = new Set<string>();
  let malformedCount = 0;
  for (const item of raw.items as unknown[]) {
    const parsed = parseNearbyItem(item);
    if (parsed === null || seen.has(parsed.id)) {
      malformedCount += 1;
      continue;
    }
    seen.add(parsed.id);
    if (parsed.id === originId) continue;
    results.push(parsed);
  }
  return {
    origin,
    radius,
    results,
    hasMore: raw.has_more,
    isTruncated: raw.is_truncated,
    malformedCount,
  };
}

/**
 * Adds each result's membership in the CURRENT trip, matched by landmark ID
 * over every stop (available or not), with that stop's current number.
 */
export function withTripMembership(
  results: readonly NearbyLandmark[],
  stops: readonly TripStop[],
): NearbyLandmarkView[] {
  const byLandmark = new Map<string, { stopId: string; stopNumber: number }>();
  for (const stop of stops) {
    byLandmark.set(stop.landmark.id, { stopId: stop.id, stopNumber: stop.position + 1 });
  }
  return results.map((result) => ({ ...result, inTrip: byLandmark.get(result.id) ?? null }));
}
