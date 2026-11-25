import { milesToKm, type AllowedRadiusMiles } from "../map/geo";
import { formatMilesAndKm } from "./formatTripDistance";
import { name, type MessagePart } from "./messageParts";
import type { NearbyResultSet } from "./nearbyLandmarks";
import type { NearbyCloseReason, NearbyOriginView, NearbyStatus } from "./useNearbyLandmarks";

/**
 * Wording for the read-only nearby panel (M05-T05 Increment 2). Pure: every
 * sentence is derived from the hook's state, never from counting what is
 * displayed. Names are `{ name }` parts (rendered in `<bdi>`).
 */

export const LARGEST_RADIUS: AllowedRadiusMiles = 100;

/** "25 mi (40.2 km)" — an allowed radius with its kilometre equivalent. */
export function radiusText(radius: number): string {
  return `${radius} mi (${milesToKm(radius).toFixed(1)} km)`;
}

/**
 * A result's straight-line distance, from the trip formatter: "About 3.2 mi
 * (5.1 km), straight-line" — or "Less than 0.1 mi (less than 0.2 km),
 * straight-line" for 0 and other tiny measured values.
 */
export function nearbyDistanceText(miles: number): string {
  const formatted = formatMilesAndKm(miles);
  return formatted.startsWith("less than")
    ? `L${formatted.slice(1)}, straight-line`
    : `About ${formatted}, straight-line`;
}

/** True when the server said the full query had more matches than this page. */
export function isIncomplete(set: NearbyResultSet): boolean {
  return set.hasMore || set.isTruncated;
}

export function incompleteText(set: NearbyResultSet): string {
  return `More landmarks are within ${radiusText(set.radius)} than are listed here. These are the closest ones returned; choose a smaller radius to narrow the search.`;
}

export function malformedText(count: number): string {
  return count === 1
    ? "1 result could not be displayed."
    : `${count} results could not be displayed.`;
}

/**
 * The message when a CURRENT result set has no landmark to list. Never claims
 * the area is empty unless the server said the result was complete and every
 * returned item was usable.
 */
export function emptyText(set: NearbyResultSet): string {
  const within = radiusText(set.radius);
  if (set.malformedCount > 0) {
    return `No results within ${within} can be displayed: the results returned could not be shown.`;
  }
  if (isIncomplete(set)) {
    return `No other landmarks could be listed, although the search reports more matches within ${within}.`;
  }
  const larger = set.radius < LARGEST_RADIUS ? " Try a larger radius." : "";
  return `No other publicly viewable landmarks were found within ${within} of this stop.${larger}`;
}

/** The caption above the list, naming the radius the SHOWN results belong to. */
export function shownCaption(
  set: NearbyResultSet,
  isCurrent: boolean,
  status: NearbyStatus,
): string {
  const count = set.results.length;
  const landmarks = `${count} landmark${count === 1 ? "" : "s"}`;
  if (isCurrent) return `${landmarks} within ${radiusText(set.radius)}, closest first.`;
  if (status.kind === "error") {
    return `The search within ${radiusText(status.radius)} failed. Still showing the earlier ${landmarks} found within ${radiusText(set.radius)}.`;
  }
  const requested = status.kind === "updating" ? status.radius : set.radius;
  return `Showing the earlier ${landmarks} found within ${radiusText(set.radius)} while the search within ${radiusText(requested)} loads.`;
}

/** The panel's polite status line (the one nearby live region while the panel is open). */
export function panelStatusParts(
  status: NearbyStatus,
  origin: NearbyOriginView | null,
): MessagePart[] {
  const stop = origin === null ? "this stop" : `Stop ${origin.stopNumber}`;
  switch (status.kind) {
    case "loading":
      return [`Finding landmarks within ${radiusText(status.radius)} of ${stop}…`];
    case "updating":
      return [`Updating: finding landmarks within ${radiusText(status.radius)} of ${stop}…`];
    case "success": {
      const set = status.result;
      const parts: MessagePart[] = [shownCaption(set, true, status)];
      if (isIncomplete(set)) parts.push(" Not every landmark in this radius is listed.");
      if (set.malformedCount > 0) parts.push(` ${malformedText(set.malformedCount)}`);
      return parts;
    }
    case "empty":
      return [emptyText(status.result)];
    default:
      // Errors use the panel's alert; a closed panel has no status line.
      return [];
  }
}

/** Why an open search was closed by a change, for the page-level nearby status; null when silent. */
export function closedParts(reason: NearbyCloseReason | null): MessagePart[] | null {
  switch (reason) {
    case "origin_removed":
      return ["The nearby search was closed because its stop was removed from the trip."];
    case "origin_unavailable":
      return ["The nearby search was closed because its stop is no longer available."];
    case "origin_changed":
      return ["The nearby search was closed because its stop's location changed."];
    default:
      // Closed by the user, or the trip or session went away (the page says so itself).
      return null;
  }
}

export const NEARBY_ERROR_TEXT = "Nearby landmarks couldn't be loaded. Please try again.";

/** The panel heading's parts: "Near Stop 2: <bdi>Beta Arch</bdi>". */
export function headingParts(origin: NearbyOriginView): MessagePart[] {
  return [`Near Stop ${origin.stopNumber}: `, name(origin.displayName)];
}
