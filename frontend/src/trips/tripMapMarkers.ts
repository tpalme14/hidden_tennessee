import type { TripStop } from "../api/trips";
import { categoryLabel } from "../map/categoryMarkerStyle";

/**
 * What the trip map shows (M05-T04 Increments 4 and 6; spec v1.1 §8; ADR-014
 * decision 8; decision D4). Derived from the validated trip state only — no
 * other data is fetched or kept.
 *
 * - Only AVAILABLE stops are mapped; an unavailable stop has no coordinates
 *   in the validated state and is never placed, grouped, or mentioned.
 * - A stop's number is its `position + 1`, so it always equals the list's
 *   "Stop N" and keeps gaps where unavailable stops are.
 * - **One marker per unique coordinate pair** (Increment 6 correction, approved
 *   2026-11-24): stops whose latitude AND longitude are exactly equal share one
 *   marker at that true location, listing every stop. Coordinates are compared
 *   exactly — never rounded — so nearby but distinct locations stay separate;
 *   nothing is offset or clustered. Without this, the later of two coincident
 *   markers completely covered the earlier one (hidden number; unreachable by
 *   pointer).
 * - A marker's identity is its coordinate pair: stable across reorders,
 *   renumbering, and members joining or leaving the group.
 */

export interface TripMapStop {
  stopId: string;
  /** `position + 1` — the same number the list shows. */
  number: number;
  landmarkId: string;
  displayName: string;
  category: string;
}

export interface TripMapMarker {
  /** Stable identity: the exact coordinate pair (never a position or number). */
  key: string;
  latitude: number;
  longitude: number;
  /** The available stops at this location, in trip order (ascending numbers). */
  stops: TripMapStop[];
}

export function tripMapMarkers(stops: readonly TripStop[]): TripMapMarker[] {
  const byLocation = new Map<string, TripMapMarker>();
  for (const stop of stops) {
    if (!stop.is_available) continue;
    const { latitude, longitude } = stop.landmark;
    const key = `${latitude},${longitude}`;
    let marker = byLocation.get(key);
    if (marker === undefined) {
      marker = { key, latitude, longitude, stops: [] };
      byLocation.set(key, marker);
    }
    marker.stops.push({
      stopId: stop.id,
      number: stop.position + 1,
      landmarkId: stop.landmark.id,
      displayName: stop.landmark.display_name,
      category: stop.landmark.category,
    });
  }
  const markers = [...byLocation.values()];
  for (const marker of markers) marker.stops.sort((a, b) => a.number - b.number);
  return markers;
}

/** How many stop numbers a combined badge shows before the overflow indicator. */
export const BADGE_MAX_NUMBERS = 2;

/**
 * The badge text. Deterministic rule: up to `BADGE_MAX_NUMBERS` (2) stop
 * numbers in ascending trip order, comma-separated; for 3 or more stops, the
 * first two followed by "+k", where k is the exact number of further stops at
 * that location. Examples: "4"; "2,3"; "2,3 +1" (stops 2, 3, 5); "1,2 +23"
 * (25 stops). The accessible name always lists every stop.
 */
export function tripMarkerBadge(marker: TripMapMarker): string {
  const numbers = marker.stops.map((s) => s.number);
  const shown = numbers.slice(0, BADGE_MAX_NUMBERS).join(",");
  const more = numbers.length - BADGE_MAX_NUMBERS;
  return more > 0 ? `${shown} +${more}` : shown;
}

function stopName(stop: TripMapStop): string {
  return `Stop ${stop.number}: ${stop.displayName}, ${categoryLabel(stop.category)}`;
}

function joinNumbers(numbers: readonly number[]): string {
  if (numbers.length <= 2) return numbers.join(" and ");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * The marker's accessible name — every stop, whatever the badge shows:
 * "Stop 2: Example Falls, Waterfall", or for a shared location
 * "Stops 2,3, 2 at the same location: Stop 2: A, Waterfall; Stop 3: B, Natural Arch"
 * ("Stops 1,2 +23, 25 at the same location: …"). A shared location's name
 * starts with "Stops " and the exact badge text, so the visible label is part
 * of the name (WCAG 2.5.3 label in name; speech users can say what they see).
 */
export function tripMarkerName(marker: TripMapMarker): string {
  if (marker.stops.length === 1) return stopName(marker.stops[0]!);
  const count = marker.stops.length;
  return `Stops ${tripMarkerBadge(marker)}, ${count} at the same location: ${marker.stops.map(stopName).join("; ")}`;
}

/** The popup's group label: "Stop 2: A details" or "Stops 2 and 3 details". */
export function tripPopupLabel(marker: TripMapMarker): string {
  if (marker.stops.length === 1) {
    const stop = marker.stops[0]!;
    return `Stop ${stop.number}: ${stop.displayName} details`;
  }
  return `Stops ${joinNumbers(marker.stops.map((s) => s.number))} details`;
}

/**
 * A key for the SET of mapped locations and their stops, independent of
 * order: it changes when a mapped stop is added, removed, becomes
 * (un)available, or moves location — not when stops are only renumbered. The
 * map refits its view only when this changes.
 */
export function mappedLocationsKey(markers: readonly TripMapMarker[]): string {
  return markers
    .flatMap((m) => m.stops.map((s) => `${s.stopId}@${m.key}`))
    .sort()
    .join("|");
}
