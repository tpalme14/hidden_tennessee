import { categoryLabel } from "./categoryMarkerStyle";
import type { LandmarkMarker } from "./useMapMarkers";

/**
 * The accessible name applied to a map marker's focusable DOM element
 * (M02-T08 Increment 3). Built only from the already-approved public
 * discovery fields the popup also shows — display name, category label, and
 * (proximity mode only) the straight-line distance — so a screen-reader user
 * can identify a landmark from the marker alone, without opening its popup,
 * and without any field the popup wouldn't show.
 */
export function markerAccessibleName(
  marker: Pick<LandmarkMarker, "display_name" | "category" | "distance_miles">,
): string {
  const parts = [marker.display_name, categoryLabel(marker.category)];
  if (marker.distance_miles !== undefined) {
    parts.push(`approx. ${marker.distance_miles.toFixed(1)} mi straight-line distance`);
  }
  return parts.join(", ");
}
