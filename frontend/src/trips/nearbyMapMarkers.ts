import { categoryLabel } from "../map/categoryMarkerStyle";
import type { NearbyLandmarkView, NearbyResultSet } from "./nearbyLandmarks";
import { nearbyDistanceText, radiusText } from "./nearbyMessages";
import type { NearbyStatus, ShownNearbyResults } from "./useNearbyLandmarks";

/**
 * What the supplementary nearby map shows (M05-T05 Increment 3; N2). Derived
 * only from the nearby hook's SHOWN result set and the origin as the trip
 * currently shows it — no request, cache, or search state of its own.
 *
 * - The origin (the selected available stop) at its validated coordinates,
 *   from the result set's own origin snapshot; never an unavailable stop.
 * - Every listed result at its exact coordinates, in server order.
 * - One marker per EXACT coordinate pair (no rounding, offsets, or
 *   clustering). The origin's location is always the first marker; a result
 *   at exactly the origin's point joins the origin's marker, which keeps its
 *   "Stop N" search-origin identity.
 * - Marker identity is the coordinate pair, so renumbering the origin or a
 *   change of membership keeps the same marker.
 */

export interface NearbyMapOrigin {
  stopNumber: number;
  displayName: string;
  landmarkId: string;
  latitude: number;
  longitude: number;
}

export interface NearbyMapMarker {
  /** The exact coordinate pair — the marker's stable identity. */
  key: string;
  latitude: number;
  longitude: number;
  /** The search origin, when it is at this location. */
  origin: NearbyMapOrigin | null;
  /** The results at this location, in server order. */
  results: NearbyLandmarkView[];
}

export function nearbyMapMarkers(
  origin: NearbyMapOrigin,
  results: readonly NearbyLandmarkView[],
): NearbyMapMarker[] {
  const byLocation = new Map<string, NearbyMapMarker>();
  const originKey = `${origin.latitude},${origin.longitude}`;
  byLocation.set(originKey, {
    key: originKey,
    latitude: origin.latitude,
    longitude: origin.longitude,
    origin,
    results: [],
  });
  for (const result of results) {
    const key = `${result.latitude},${result.longitude}`;
    let marker = byLocation.get(key);
    if (marker === undefined) {
      marker = {
        key,
        latitude: result.latitude,
        longitude: result.longitude,
        origin: null,
        results: [],
      };
      byLocation.set(key, marker);
    }
    marker.results.push(result);
  }
  return [...byLocation.values()];
}

/**
 * The visible badge. Deterministic: the origin shows "Stop N" (plus " +k" for
 * k results at the same point); one result shows no text (a plain round
 * marker); k ≥ 2 results show "k". It contains only "Stop", digits, spaces,
 * and "+" — never a name.
 */
export function nearbyMarkerBadge(marker: NearbyMapMarker): string {
  const k = marker.results.length;
  if (marker.origin !== null) {
    return k === 0 ? `Stop ${marker.origin.stopNumber}` : `Stop ${marker.origin.stopNumber} +${k}`;
  }
  return k === 1 ? "" : String(k);
}

function resultName(result: NearbyLandmarkView): string {
  const member = result.inTrip === null ? "" : `, in this trip (Stop ${result.inTrip.stopNumber})`;
  return `${result.display_name}, ${categoryLabel(result.category)}, ${nearbyDistanceText(result.distance_miles)}${member}`;
}

/**
 * The marker's complete accessible name, beginning with the visible badge
 * text (label in name):
 * - "Stop 2, search origin: Beta Arch"
 * - "Stop 2 +1, search origin and 1 nearby landmark at the same location: Beta Arch, search origin; Twin Arch, Natural Arch, Less than 0.1 mi …"
 * - "Twin Arch, Natural Arch, About 0.8 mi (1.3 km), straight-line"
 * - "3 nearby landmarks at the same location: A, …; B, …; C, …"
 */
export function nearbyMarkerName(marker: NearbyMapMarker): string {
  const k = marker.results.length;
  const all = marker.results.map(resultName).join("; ");
  if (marker.origin !== null) {
    const badge = nearbyMarkerBadge(marker);
    const originName = marker.origin.displayName;
    if (k === 0) return `${badge}, search origin: ${originName}`;
    const nearby = `${k} nearby landmark${k === 1 ? "" : "s"}`;
    return `${badge}, search origin and ${nearby} at the same location: ${originName}, search origin; ${all}`;
  }
  if (k === 1) return resultName(marker.results[0]!);
  return `${k} nearby landmarks at the same location: ${all}`;
}

/** The popup group's label. */
export function nearbyPopupLabel(marker: NearbyMapMarker): string {
  if (marker.origin !== null) {
    return marker.results.length === 0
      ? `Search origin: Stop ${marker.origin.stopNumber} details`
      : `Search origin and nearby landmarks at this location`;
  }
  return marker.results.length === 1
    ? `${marker.results[0]!.display_name} details`
    : "Nearby landmarks at this location";
}

export type NearbyMapPresentation =
  | { kind: "none" }
  | {
      kind: "map";
      set: NearbyResultSet;
      landmarks: NearbyLandmarkView[];
      isCurrent: boolean;
      /** True when the map shows the origin only because the search genuinely found nothing else. */
      originOnly: boolean;
    };

/**
 * Whether the panel shows a map, and of what:
 * - landmarks to show (current, or earlier ones kept during an update or after
 *   a failure) → a map of them and the origin;
 * - a CURRENT, complete, fully usable empty result → the origin only, captioned;
 * - initial loading, an error with nothing kept, an empty result with
 *   malformed items or incomplete coverage → no map (it would mislead).
 */
export function nearbyMapPresentation(
  status: NearbyStatus,
  shown: ShownNearbyResults | null,
): NearbyMapPresentation {
  if (shown === null) return { kind: "none" };
  const { set, landmarks, isCurrent } = shown;
  if (landmarks.length > 0) return { kind: "map", set, landmarks, isCurrent, originOnly: false };
  const genuineEmpty =
    status.kind === "empty" &&
    isCurrent &&
    set.malformedCount === 0 &&
    !set.hasMore &&
    !set.isTruncated;
  return genuineEmpty
    ? { kind: "map", set, landmarks, isCurrent, originOnly: true }
    : { kind: "none" };
}

/** The sentence above the map, naming the radius its results belong to. */
export function nearbyMapCaption(
  presentation: Extract<NearbyMapPresentation, { kind: "map" }>,
  status: NearbyStatus,
): string {
  const { set, landmarks, isCurrent, originOnly } = presentation;
  const within = radiusText(set.radius);
  if (originOnly) {
    return `The map shows the search origin only: no other landmarks were found within ${within}.`;
  }
  const n = landmarks.length;
  const these = `${n} landmark${n === 1 ? "" : "s"}`;
  let text = isCurrent
    ? `The map shows the search origin and the ${these} listed above, within ${within}.`
    : `The map still shows the earlier ${these} found within ${within}${
        status.kind === "updating" || status.kind === "error"
          ? `, not results for ${radiusText(status.radius)}`
          : ""
      }.`;
  if (set.hasMore || set.isTruncated) {
    text += ` Not every landmark within ${within} is on the map.`;
  }
  return text;
}

export const NEARBY_MAP_LEGEND =
  "Legend: the dark square marker labelled “Stop” and a number is the stop this search is from. Round markers are nearby landmarks; a number on a round marker shows how many share one location.";
