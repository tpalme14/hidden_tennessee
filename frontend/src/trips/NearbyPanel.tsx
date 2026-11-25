import { useMemo, type KeyboardEvent, type RefObject } from "react";
import { Link } from "react-router";
import { ALLOWED_RADII_MILES } from "../map/geo";
import { categoryLabel } from "../map/categoryMarkerStyle";
import { MessageText } from "./MessageText";
import { NearbyMap } from "./NearbyMap";
import {
  NEARBY_MAP_LEGEND,
  nearbyMapCaption,
  nearbyMapPresentation,
  type NearbyMapOrigin,
} from "./nearbyMapMarkers";
import {
  NEARBY_ERROR_TEXT,
  emptyText,
  headingParts,
  incompleteText,
  isIncomplete,
  malformedText,
  nearbyDistanceText,
  panelStatusParts,
  radiusText,
  shownCaption,
} from "./nearbyMessages";
import type { NearbyLandmarkView } from "./nearbyLandmarks";
import type {
  NearbyOriginView,
  NearbyStatus,
  ShownNearbyResults,
  UseNearbyLandmarksResult,
} from "./useNearbyLandmarks";
import styles from "./NearbyPanel.module.css";

export const NEARBY_HEADING_ID = "trip-nearby-heading";
export const NEARBY_PANEL_ID = "trip-nearby-panel";

export interface NearbyPanelProps {
  nearby: UseNearbyLandmarksResult;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** An explicit close (Close button or Escape inside the panel). */
  onClose: () => void;
  /**
   * "Add to this trip" (Increment 4). Offered only on rows of the CURRENT
   * successful search that are not already in the trip, while the trip has
   * room; `busy` (the trip's single change lock) makes every Add control
   * `aria-disabled`, keeping focus where it is.
   */
  adding?: {
    busy: boolean;
    tripFull: boolean;
    maxStops: number;
    onAdd: (landmark: NearbyLandmarkView, origin: HTMLElement) => void;
  };
}

/**
 * The read-only nearby panel (M05-T05 Increment 2; N1, N3, N5, N6, N8):
 * landmarks near ONE selected stop, from the accepted `useNearbyLandmarks`
 * state only — no fetch, distance calculation, sorting, or completeness
 * inference of its own. Rendered only while a search is open.
 *
 * - The heading names the stop by its CURRENT number and name.
 * - The radius selector shows the REQUESTED radius; the caption above the list
 *   names the radius the SHOWN results belong to, so earlier results are never
 *   labelled with a newly requested radius.
 * - One polite status line (loading, updating, results, empty); a failure is an
 *   alert with "Try again" instead, so nothing is announced twice.
 * - Names are plain text in `<bdi>`; each links to the landmark's profile.
 * - Escape anywhere inside the panel closes it (an explicit close).
 *
 * After the list, a supplementary map (Increment 3) of the same shown set and
 * the origin, with a text legend and a caption naming its radius. Rows of the
 * current search can be added to this trip (Increment 4); earlier results kept
 * during an update or after a failure cannot. The map has no add controls.
 */
export function NearbyPanel({ nearby, headingRef, onClose, adding }: NearbyPanelProps) {
  const { status, radius, origin, shown } = nearby;
  if (status.kind === "closed" || origin === null) return null;

  const statusParts = panelStatusParts(status, origin);
  const set = shown?.set ?? null;
  const landmarks = shown?.landmarks ?? [];

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <section
      id={NEARBY_PANEL_ID}
      aria-labelledby={NEARBY_HEADING_ID}
      className={styles.panel}
      onKeyDown={onKeyDown}
    >
      <div className={styles.header}>
        <h3 id={NEARBY_HEADING_ID} ref={headingRef} tabIndex={-1} className={styles.heading}>
          <MessageText parts={headingParts(origin)} />
        </h3>
        <button
          type="button"
          className={styles.button}
          aria-label="Close nearby landmarks"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <p className={styles.note}>
        Landmarks within the chosen radius of this stop, closest first, by straight-line distance —
        not travel or trail distance.
      </p>

      <label className={styles.radius}>
        Radius{" "}
        <select
          value={radius}
          onChange={(event) => nearby.setRadius(Number(event.target.value))}
          className={styles.select}
        >
          {ALLOWED_RADII_MILES.map((choice) => (
            <option key={choice} value={choice}>
              {radiusText(choice)}
            </option>
          ))}
        </select>
      </label>

      <p role="status" className={styles.status}>
        {statusParts.length > 0 ? <MessageText parts={statusParts} /> : null}
      </p>

      {status.kind === "error" ? (
        <div role="alert" className={styles.alert}>
          <p>{NEARBY_ERROR_TEXT}</p>
          <button type="button" className={styles.button} onClick={nearby.retry}>
            Try again
          </button>
        </div>
      ) : null}

      {status.kind === "empty" ? <p className={styles.notice}>{emptyText(status.result)}</p> : null}

      {set !== null && landmarks.length > 0 ? (
        <>
          <p className={styles.caption}>{shownCaption(set, shown!.isCurrent, status)}</p>
          {isIncomplete(set) ? <p className={styles.notice}>{incompleteText(set)}</p> : null}
          {set.malformedCount > 0 ? (
            <p className={styles.notice}>{malformedText(set.malformedCount)}</p>
          ) : null}
          {adding !== undefined && !shown!.isCurrent ? (
            <p className={styles.notice}>
              Landmarks can be added again once a search for the chosen radius succeeds.
            </p>
          ) : null}
          {adding !== undefined && shown!.isCurrent && adding.tripFull ? (
            <p className={styles.notice}>
              This trip is full: it has {adding.maxStops} stops, the most a trip can hold. Remove a
              stop to add another.
            </p>
          ) : null}
          <ul
            className={styles.list}
            aria-label={`Landmarks near Stop ${origin.stopNumber}`}
            aria-busy={status.kind === "updating" ? true : undefined}
          >
            {landmarks.map((landmark) => (
              <li key={landmark.id} className={styles.item}>
                <Link
                  to={`/landmarks/${encodeURIComponent(landmark.id)}`}
                  className={styles.name}
                  data-nearby-link={landmark.id}
                >
                  <bdi>{landmark.display_name}</bdi>
                </Link>
                <span className={styles.category}>{categoryLabel(landmark.category)}</span>
                <span className={styles.distance}>
                  {nearbyDistanceText(landmark.distance_miles)}
                </span>
                {landmark.inTrip !== null ? (
                  <span className={styles.member}>
                    In this trip (Stop {landmark.inTrip.stopNumber})
                  </span>
                ) : adding !== undefined && shown!.isCurrent && !adding.tripFull ? (
                  <button
                    type="button"
                    className={styles.button}
                    data-nearby-add={landmark.id}
                    aria-label={`Add to this trip: ${landmark.display_name}`}
                    aria-disabled={adding.busy ? true : undefined}
                    onClick={(event) => adding.onAdd(landmark, event.currentTarget)}
                  >
                    Add to this trip
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <NearbyMapSection
        status={status}
        shown={shown}
        origin={origin}
        onFocusLost={() => headingRef.current?.focus()}
      />
    </section>
  );
}

/**
 * The supplementary map and its text (M05-T05 Increment 3). Shown only when it
 * cannot mislead (`nearbyMapPresentation`); keyed by the origin stop, so another
 * stop's search never inherits this map's markers or viewport. A focused marker
 * that disappears while the panel stays open hands focus to the panel heading.
 */
function NearbyMapSection({
  status,
  shown,
  origin,
  onFocusLost,
}: {
  status: NearbyStatus;
  shown: ShownNearbyResults | null;
  origin: NearbyOriginView;
  onFocusLost: () => void;
}) {
  const presentation = nearbyMapPresentation(status, shown);
  const set = presentation.kind === "map" ? presentation.set : null;
  const mapOrigin = useMemo<NearbyMapOrigin | null>(
    () =>
      set === null
        ? null
        : {
            stopNumber: origin.stopNumber,
            displayName: origin.displayName,
            landmarkId: set.origin.landmarkId,
            latitude: set.origin.latitude,
            longitude: set.origin.longitude,
          },
    [set, origin.stopNumber, origin.displayName],
  );
  if (presentation.kind !== "map" || mapOrigin === null) return null;
  return (
    <div className={styles.mapSection}>
      <p className={styles.caption}>{nearbyMapCaption(presentation, status)}</p>
      <p className={styles.note}>{NEARBY_MAP_LEGEND}</p>
      <NearbyMap
        key={origin.stopId}
        origin={mapOrigin}
        set={presentation.set}
        landmarks={presentation.landmarks}
        onFocusLost={onFocusLost}
      />
    </div>
  );
}
