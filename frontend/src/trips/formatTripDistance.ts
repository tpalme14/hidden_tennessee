import type { DistanceSummary } from "../api/trips";
import { milesToKm } from "../map/geo";

/**
 * Straight-line distance wording for trips (M05-T04 Increment 2; spec v1.1
 * §5.6; ADR-014 decision 7). The values always come from the server — this
 * module only formats them and never computes a distance.
 *
 * Miles and kilometres are shown to one decimal place with `toFixed(1)`, the
 * same rounding the proximity-discovery screens use (spec §5.6: "as
 * Specification 2 does"). A measured value that would display as 0.0 is shown
 * as "less than 0.1 mi (less than 0.2 km)" instead, so a real leg never reads
 * as zero.
 */

export const STRAIGHT_LINE_DISCLAIMER = "Straight-line distances, not travel or trail distances.";

/** Below this, `toFixed(1)` would show 0.0 miles. */
const SMALLEST_SHOWN_MILES = 0.05;

/** "5.2 mi (8.4 km)" — or "less than 0.1 mi (less than 0.2 km)" for a tiny measured value. */
export function formatMilesAndKm(miles: number): string {
  if (!Number.isFinite(miles) || miles < 0) {
    throw new RangeError("a distance must be a finite, non-negative number of miles");
  }
  if (miles < SMALLEST_SHOWN_MILES) return "less than 0.1 mi (less than 0.2 km)";
  return `${miles.toFixed(1)} mi (${milesToKm(miles).toFixed(1)} km)`;
}

/**
 * The text under an AVAILABLE stop about the leg that ends at it, or null for
 * the first stop (which has no previous leg). Unavailable stops show no
 * distance text at all.
 */
export function previousLegText(position: number, miles: number | null): string | null {
  if (position === 0) return null;
  if (miles === null) {
    return "Distance from the previous stop not measured, because the previous stop is no longer available.";
  }
  return `${formatMilesAndKm(miles)} straight-line from the previous stop`;
}

export type TotalKind = "none" | "unmeasured" | "partial" | "complete";

export interface TripTotalText {
  kind: TotalKind;
  /** The visible sentence, or null when no total is shown (fewer than two stops). */
  text: string | null;
}

function legs(n: number): string {
  return `${n} leg${n === 1 ? "" : "s"}`;
}

/**
 * The trip total (spec §5.6): none for fewer than two stops; complete when
 * every leg was measured; partial (labelled with the measured count) when
 * some were not; and an explicit "no total" — never a zero — when none were.
 */
export function tripTotalText(summary: DistanceSummary): TripTotalText {
  const { total_miles, measured_legs, total_legs } = summary;
  if (total_legs === 0) return { kind: "none", text: null };
  if (measured_legs === 0 || total_miles === null) {
    return {
      kind: "unmeasured",
      text: `No straight-line total: none of the ${legs(total_legs)} can be measured, because each is next to a stop that is no longer available.`,
    };
  }
  if (measured_legs < total_legs) {
    return {
      kind: "partial",
      text: `Straight-line total of ${measured_legs} of ${legs(total_legs)}: ${formatMilesAndKm(total_miles)}. Legs next to a stop that is no longer available are not measured.`,
    };
  }
  return {
    kind: "complete",
    text: `Straight-line total: ${formatMilesAndKm(total_miles)}.`,
  };
}
