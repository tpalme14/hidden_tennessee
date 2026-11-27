import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useAccountSecurity } from "../auth/accountSecurity";
import { categoryLabel } from "../map/categoryMarkerStyle";
import { OfflineCopyControl } from "../offline/OfflineCopyControl";
import {
  formatSavedTime,
  lastSyncedText,
  OUTDATED_WARNING,
  recordedUnavailableText,
  UNREADABLE_COPY,
} from "../offline/offlineText";
import { useSnapshotView } from "../offline/useSnapshotView";
import { previousLegText, STRAIGHT_LINE_DISCLAIMER } from "../trips/formatTripDistance";
import { TripDistanceSummary } from "../trips/TripDistanceSummary";
import { OfflineAccessNotice, OfflineReadNotice } from "./OfflineLibraryPage";
import styles from "./OfflineLibrary.module.css";

/**
 * A saved trip (M06-T03 Increment 3e; Specification 6 §3.4, OFF-SNAP-4/5/6,
 * OFF-EV-6/7, OFF-UX-3/4). Stops in the server's order; an unavailable stop is
 * only a placeholder; distances only as stored, straight-line, never
 * recalculated; an invalidated summary says it is unavailable until the trip is
 * refreshed. No map. Rendered ONLY from the authorized view store (DR-3).
 */
export function OfflineTripPage() {
  const { tripId = "" } = useParams<{ tripId: string }>();
  const itemId = tripId.toLowerCase();
  const account = useAccountSecurity();
  const { view, ops } = useSnapshotView();
  const [loaded, setLoaded] = useState(false);
  const readable = account.offline === "eligible" || account.offline === "offline-read";

  useEffect(() => {
    if (!readable) return;
    let current = true;
    setLoaded(false);
    void ops.getTrip(itemId).then(() => {
      if (current) setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [readable, itemId, ops, account.offline]);

  const entry = view.trips.get(itemId);
  let content;
  if (!readable) content = <OfflineAccessNotice />;
  else if (entry === undefined) {
    content = loaded ? (
      <p>This trip isn&apos;t saved on this device.</p>
    ) : (
      <p role="status">Loading the saved copy…</p>
    );
  } else if (entry.status === "unreadable") {
    content = (
      <>
        <p>{UNREADABLE_COPY}</p>
      </>
    );
  } else if (entry.record.status === "unavailable") {
    content = (
      <>
        <p>{recordedUnavailableText(entry.record.unavailable_recorded_at)}.</p>
        <p className={styles.muted}>Its details were removed from this device.</p>
      </>
    );
  } else {
    const record = entry.record;
    const anyLeg = record.stops.some((s) => s.distance_from_previous_miles !== null);
    content = (
      <>
        <p className={styles.muted}>{lastSyncedText(entry.lastSyncedAt ?? record.saved_at)}</p>
        <p className={styles.warning}>{OUTDATED_WARNING}</p>
        {record.partially_invalidated_at !== undefined ? (
          <p className={styles.notice}>
            Part of this trip was updated on this device about{" "}
            {formatSavedTime(record.partially_invalidated_at)} because a stop is no longer
            available. Refresh the trip to get the current version.
          </p>
        ) : null}
        {record.stops.length === 0 ? (
          <p>This trip has no stops.</p>
        ) : (
          <ol className={styles.stops} aria-label="Stops">
            {record.stops.map((stop) =>
              stop.is_available ? (
                <li key={stop.stop_id}>
                  <p>{stop.landmark.display_name}</p>
                  <p className={styles.muted}>{categoryLabel(stop.landmark.category)}</p>
                  {previousLegText(stop.position, stop.distance_from_previous_miles) !== null ? (
                    <p className={styles.muted}>
                      {previousLegText(stop.position, stop.distance_from_previous_miles)}
                    </p>
                  ) : null}
                </li>
              ) : (
                <li key={stop.stop_id}>
                  <p>This stop is no longer available.</p>
                </li>
              ),
            )}
          </ol>
        )}
        {record.distance_summary_state === "server" && record.distance_summary !== null ? (
          <TripDistanceSummary summary={record.distance_summary} />
        ) : (
          <>
            <p>The distance summary is unavailable until you refresh this trip.</p>
            {anyLeg ? <p className={styles.muted}>{STRAIGHT_LINE_DISCLAIMER}</p> : null}
          </>
        )}
      </>
    );
  }

  const heading =
    entry?.status === "ok" && entry.record.status === "available"
      ? entry.record.name
      : "Saved trip";
  const controlName =
    entry?.status === "ok" && entry.record.status === "available" ? entry.record.name : "this trip";

  return (
    <section aria-labelledby="offline-trip-heading" className={styles.page}>
      <h2 id="offline-trip-heading">{heading}</h2>
      {account.offline === "offline-read" ? <OfflineReadNotice /> : null}
      {content}
      {/* One stable slot (3e): the control stays mounted when its own action
          removes the copy, so its result is still announced. */}
      {readable && (entry !== undefined || loaded) ? (
        <OfflineCopyControl kind="trip" id={itemId} name={controlName} />
      ) : null}
      <p>
        <Link to="/offline">All saved copies</Link> ·{" "}
        <Link to={`/trips/${itemId}`}>Online trip (needs a connection)</Link>
      </p>
    </section>
  );
}
