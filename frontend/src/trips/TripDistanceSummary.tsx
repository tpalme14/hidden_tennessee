import type { DistanceSummary } from "../api/trips";
import { STRAIGHT_LINE_DISCLAIMER, tripTotalText } from "./formatTripDistance";
import styles from "./TripStops.module.css";

/**
 * The trip's straight-line total (M05-T04 Increment 2; spec v1.1 §5.6),
 * built only from the server's `distance_summary`. Nothing is shown for a trip
 * with fewer than two stops. Otherwise the total — complete, partial (with
 * the measured-leg count), or an explicit "no total" when no leg could be
 * measured — and the visible disclaimer that these are not travel distances.
 */
export function TripDistanceSummary({ summary }: { summary: DistanceSummary }) {
  const total = tripTotalText(summary);
  if (total.text === null) return null;
  return (
    <div className={styles.summary} data-total-kind={total.kind}>
      <p className={styles.total}>{total.text}</p>
      <p className={styles.disclaimer}>{STRAIGHT_LINE_DISCLAIMER}</p>
    </div>
  );
}
