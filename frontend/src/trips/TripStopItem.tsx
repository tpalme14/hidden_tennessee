import { Link } from "react-router";
import type { TripStop } from "../api/trips";
import { OnlineOnlyReason } from "../connectivity/OnlineOnlyReason";
import { useOnlineOnlyAction } from "../connectivity/useOnlineOnlyAction";
import { categoryLabel } from "../map/categoryMarkerStyle";
import { previousLegText } from "./formatTripDistance";
import { stopLabel } from "./tripMessages";
import styles from "./TripStops.module.css";

/**
 * One stop of the ordered list (M05-T04 Increments 2–3; spec v1.1 §§4, 5.3,
 * 5.6, 6.2, 6.3, 8).
 *
 * Everything shown comes from the validated stop alone:
 * - available: "Stop N", the landmark name linking to its profile, the
 *   category label, and the straight-line distance from the previous stop
 *   (none for the first stop; an explanation when that leg is unmeasured);
 * - unavailable: "Stop N" and "No longer available" only — no name,
 *   category, coordinates, link, or distance. Nothing is looked up for it.
 *
 * "Stop N" is the server's `position` + 1. Names are isolated (`<bdi>`).
 *
 * Controls (when `controls` is given): Move up, Move down, and Remove, with
 * accessible names that START with the visible text (WCAG 2.5.3, label in
 * name — corrected in Increment 6) and identify the stop — by landmark name when it is
 * available, by position only when it is not (no hidden information). Move up
 * is disabled on the first stop and Move down on the last (`disabled`). While
 * a change is pending every control is `aria-disabled` instead, so a focused
 * control keeps focus; the click handlers are refused by the hook's lock.
 */

export interface TripStopControls {
  isFirst: boolean;
  isLast: boolean;
  /** A change or its re-read is in progress. */
  busy: boolean;
  onMove: (direction: "up" | "down", origin: HTMLElement) => void;
  onRemove: (origin: HTMLElement) => void;
  setButtonRef: (
    kind: "up" | "down" | "remove" | "nearby",
  ) => (node: HTMLButtonElement | null) => void;
  /**
   * Find nearby (M05-T05 Increment 2): opens the nearby panel for this stop.
   * Offered for AVAILABLE stops only; omitted when not provided.
   */
  nearby?: { onFind: (origin: HTMLElement) => void; isOpen: boolean; panelId: string };
}

export function TripStopItem({ stop, controls }: { stop: TripStop; controls?: TripStopControls }) {
  const number = stop.position + 1;
  const legText = stop.is_available
    ? previousLegText(stop.position, stop.distance_from_previous_miles)
    : null;

  return (
    <li className={styles.stop}>
      <span className={styles.number}>Stop {number}</span>
      {stop.is_available ? (
        <span className={styles.details}>
          <Link to={`/landmarks/${encodeURIComponent(stop.landmark.id)}`} className={styles.name}>
            <bdi>{stop.landmark.display_name}</bdi>
          </Link>
          <span className={styles.category}>{categoryLabel(stop.landmark.category)}</span>
          {legText === null ? null : <span className={styles.leg}>{legText}</span>}
        </span>
      ) : (
        <span className={styles.unavailable}>No longer available</span>
      )}
      {controls ? <StopControls stop={stop} controls={controls} /> : null}
    </li>
  );
}

function StopControls({ stop, controls }: { stop: TripStop; controls: TripStopControls }) {
  const label = stopLabel(stop);
  // M06-T02 Increment 3b-ii: reordering and removing need the server
  // (OFF-UX-5). Refused here, before the page is asked, so nothing changes
  // locally; the first/last `disabled` rules and the page's lock are unchanged.
  // Find nearby is read-only and stays available.
  const online = useOnlineOnlyAction();
  const busy = controls.busy || online.unavailable ? true : undefined;
  /** Presentation only (cursor): the trip's change or its re-read is genuinely in progress. */
  const pending = controls.busy ? "true" : undefined;
  const nearby = stop.is_available ? controls.nearby : undefined;
  return (
    <>
      <span className={styles.controls}>
        <button
          ref={controls.setButtonRef("up")}
          type="button"
          className={styles.button}
          aria-label={`Move up: ${label}`}
          disabled={controls.isFirst}
          aria-disabled={busy}
          data-pending={pending}
          aria-describedby={online.describedBy}
          onClick={(event) => {
            if (!online.unavailable) controls.onMove("up", event.currentTarget);
          }}
        >
          Move up
        </button>
        <button
          ref={controls.setButtonRef("down")}
          type="button"
          className={styles.button}
          aria-label={`Move down: ${label}`}
          disabled={controls.isLast}
          aria-disabled={busy}
          data-pending={pending}
          aria-describedby={online.describedBy}
          onClick={(event) => {
            if (!online.unavailable) controls.onMove("down", event.currentTarget);
          }}
        >
          Move down
        </button>
        <button
          ref={controls.setButtonRef("remove")}
          type="button"
          className={styles.button}
          aria-label={`Remove ${label} from the trip`}
          aria-disabled={busy}
          data-pending={pending}
          aria-describedby={online.describedBy}
          onClick={(event) => {
            if (!online.unavailable) controls.onRemove(event.currentTarget);
          }}
        >
          Remove
        </button>
        {nearby === undefined || !stop.is_available ? null : (
          // Read-only, so not blocked while a change is pending. The name starts
          // with the visible text: "Find nearby: Stop 2, Beta Arch".
          <button
            ref={controls.setButtonRef("nearby")}
            type="button"
            className={styles.button}
            aria-label={`Find nearby: Stop ${stop.position + 1}, ${stop.landmark.display_name}`}
            aria-expanded={nearby.isOpen}
            aria-controls={nearby.isOpen ? nearby.panelId : undefined}
            onClick={(event) => nearby.onFind(event.currentTarget)}
          >
            Find nearby
          </button>
        )}
      </span>
      <OnlineOnlyReason action={online} className={styles.leg} />
    </>
  );
}
