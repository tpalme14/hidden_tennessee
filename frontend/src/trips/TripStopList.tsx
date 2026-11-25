import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { TripStop } from "../api/trips";
import { TripStopItem, type TripStopControls } from "./TripStopItem";
import styles from "./TripStops.module.css";

export const STOPS_HEADING_ID = "trip-stops-heading";

export interface TripStopListProps {
  stops: readonly TripStop[];
  /**
   * The list heading — the focus target after a change (Increment 3), so it
   * is programmatically focusable (`tabIndex={-1}`) but not in the tab order.
   */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Editing controls for each stop (Increment 3); omitted for a read-only list. */
  controlsFor?: (stop: TripStop, index: number) => TripStopControls;
  /** A change or its re-read is in progress (`aria-busy` on the list). */
  busy?: boolean;
  /**
   * Replaces the empty-trip content (M05-T06 Increment 5a, decision D12; the
   * public shared page says "This trip has no stops."). Omitted → the owner's
   * existing empty state, unchanged.
   */
  emptyState?: ReactNode;
}

/**
 * The trip's stops as a semantic ordered list — the primary, fully accessible
 * representation of the trip (spec v1.1 §8). An empty trip gets an actionable
 * empty state instead of an empty list.
 */
export function TripStopList({
  stops,
  headingRef,
  controlsFor,
  busy = false,
  emptyState,
}: TripStopListProps) {
  return (
    <section aria-labelledby={STOPS_HEADING_ID} className={styles.section}>
      <h3 id={STOPS_HEADING_ID} ref={headingRef} tabIndex={-1} className={styles.heading}>
        Stops
      </h3>
      {stops.length === 0 && emptyState !== undefined ? (
        <div className={styles.empty}>{emptyState}</div>
      ) : stops.length === 0 ? (
        <div className={styles.empty}>
          <p>This trip has no stops yet.</p>
          <p>
            Find a landmark to add from <Link to="/">landmark discovery</Link> or a landmark&apos;s
            page.
          </p>
        </div>
      ) : (
        <ol
          className={styles.list}
          aria-labelledby={STOPS_HEADING_ID}
          aria-busy={busy ? true : undefined}
        >
          {stops.map((stop, index) => (
            <TripStopItem
              key={stop.id}
              stop={stop}
              {...(controlsFor ? { controls: controlsFor(stop, index) } : {})}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
