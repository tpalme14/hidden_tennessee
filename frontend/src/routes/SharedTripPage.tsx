import { useLayoutEffect, useRef } from "react";
import { useParams } from "react-router";
import { TripDistanceSummary } from "../trips/TripDistanceSummary";
import { TripStopList } from "../trips/TripStopList";
import { TripStopsMap } from "../trips/TripStopsMap";
import { useRobotsNoindex } from "../trips/useRobotsNoindex";
import { useSharedTrip } from "../trips/useSharedTrip";
import styles from "./SharedTripPage.module.css";

/**
 * The public, read-only shared trip (`/shared/trips/:shareToken`; M05-T06
 * Increment 5a; spec v1.1 §§4, 5.3, 5.4, 5.6, 7.2, 8; decisions D2, D5, D6,
 * D9, D10, D12; refinements R1, R5).
 *
 * PUBLIC. No authentication gate and no sign-in redirect; this page never
 * reads the session, so a loading, signed-out, or unavailable session check
 * (the app-wide `AuthProvider`, accepted under D6) changes nothing here. The
 * only request is the shared-trip read (`credentials: "omit"`). No owner trip
 * is fetched and no owner component is mounted (no `useTrip`, editing,
 * rename/delete, add-to-trip, nearby, or sharing controls). Nothing here
 * builds a sign-in `returnTo` or navigation state, so the token in this
 * page's URL goes nowhere else from this page.
 *
 * READ-ONLY. The validated trip name is the heading; "Shared trip — view
 * only" says it cannot be changed. The stop list (no controls), the
 * straight-line distance summary, and the numbered map are the existing
 * read-only components, fed only with the validated shared data: unavailable
 * stops are the placeholder ("No longer available"), never mapped, and no
 * distance touches them. Available stops link to their public profiles (D9).
 *
 * MAP IDENTITY (R5). `TripStopsMap` needs no trip ID — the owner page keys it
 * with the trip ID only to give each trip a fresh map. Here it is keyed with
 * the hook's presentation-only `loadId` (new for every successful load) and
 * unmounted whenever the view is not `ready`, so another token's (or an
 * earlier load's) markers, popups, viewport, or focused links never carry
 * over. No ID is invented and the token is never used as an identifier.
 *
 * ROBOTS. `noindex, nofollow` meta while this route is mounted, in every
 * state (the HTTP header is Increment 5b).
 *
 * Feedback: one status region (loading) and at most one alert (a recoverable
 * failure, with Try again); the unavailable outcome is plain text. After Try
 * again — whose button then disappears — the heading takes focus when the new
 * outcome renders, only if focus was lost.
 */

const HEADING_ID = "shared-trip-heading";

export const SHARED_TRIP_UNAVAILABLE_TEXT =
  "This shared trip isn't available. The link may be incorrect, or the owner may have stopped sharing it.";

export function SharedTripPage() {
  const { shareToken } = useParams();
  useRobotsNoindex();
  const { view, retry } = useSharedTrip(shareToken);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const stopsHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingAfterRetry = useRef(false);

  useLayoutEffect(() => {
    if (!focusHeadingAfterRetry.current || view.status === "loading") return;
    focusHeadingAfterRetry.current = false;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    headingRef.current?.focus();
  }, [view.status]);

  function handleRetry() {
    focusHeadingAfterRetry.current = true;
    retry();
  }

  return (
    <section aria-labelledby={HEADING_ID} className={styles.page}>
      <h2 id={HEADING_ID} ref={headingRef} tabIndex={-1} className={styles.heading}>
        {view.status === "ready" ? <bdi>{view.trip.name}</bdi> : "Shared trip"}
      </h2>
      <p role="status" className={styles.status}>
        {view.status === "loading" ? <span>Loading shared trip…</span> : null}
      </p>
      {view.status === "error" ? (
        <div role="alert" className={styles.alert}>
          <p>Couldn&apos;t load this shared trip. Please try again.</p>
          <button type="button" className={styles.button} onClick={handleRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {view.status === "unavailable" ? (
        <p className={styles.unavailable}>{SHARED_TRIP_UNAVAILABLE_TEXT}</p>
      ) : null}
      {view.status === "ready" ? (
        <>
          <p className={styles.readOnly}>
            Shared trip — view only. Someone shared this trip with a link; it can&apos;t be changed
            here.
          </p>
          <TripStopList
            stops={view.trip.stops}
            headingRef={stopsHeadingRef}
            emptyState={<p>This trip has no stops.</p>}
          />
          <TripDistanceSummary summary={view.trip.distance_summary} />
          {/* A fresh map for every load: nothing from another token or load carries over. */}
          <TripStopsMap
            key={view.loadId}
            stops={view.trip.stops}
            onFocusLost={() => stopsHeadingRef.current?.focus()}
          />
        </>
      ) : null}
    </section>
  );
}
