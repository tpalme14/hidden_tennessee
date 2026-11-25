import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLandmarkGeoMarkers } from "../api/landmarks";
import type { OwnerTrip } from "../api/trips";
import { useAuth } from "../auth/session";
import { DEFAULT_RADIUS_MILES, formatNearParam, isAllowedRadius } from "../map/geo";
import type { AllowedRadiusMiles } from "../map/geo";
import {
  nearbyOriginOf,
  parseNearbyResponse,
  sameOrigin,
  withTripMembership,
  type NearbyLandmarkView,
  type NearbyOrigin,
  type NearbyResultSet,
} from "./nearbyLandmarks";

/**
 * Nearby-landmark search for one selected trip stop (M05-T05 Increment 1).
 * Data layer only: no UI, no map, no add mutation.
 *
 * ACTIVATION. Nothing is fetched until `open(stopId)`; after that, only a
 * radius change or `retry()` fetches. No prefetching, polling, geolocation,
 * or URL state. Reopening (any stop, including the same one) fetches fresh.
 *
 * ORIGIN. Only an AVAILABLE stop of the validated owner trip can be an origin,
 * identified by its stop ID; its landmark ID and coordinates are taken from
 * the trip at `open` time. Reordering the trip keeps the origin. If the stop
 * is removed, becomes unavailable, or its landmark or coordinates change — or
 * the trip itself is no longer ready — the search closes at once (with a
 * reason), its results are dropped, and any pending request is invalidated.
 *
 * SESSION. The search follows the verified user who opened it. If the session
 * is no longer verified (`loading`/`unavailable`/`anonymous`) or another user
 * is verified, everything is cleared and pending requests are invalidated.
 *
 * ORDERING. Every request has an ID; a response writes only if it is still the
 * latest request and the hook is mounted. Closing, reopening, a radius change,
 * a retry, and every invalidation start or cancel a request ID, so late
 * responses are dropped.
 *
 * RADIUS. Starts at 25 miles (Specification 2 §5.2); an allowed choice stays
 * selected for later searches in this hook's lifetime. During a same-origin
 * radius change the previous results may be shown as `updating`, carrying
 * THEIR OWN radius; they are never labelled with the newly requested one.
 *
 * MEMBERSHIP is derived from the current trip on every render — never cached —
 * so it follows adds, removals, and reorders without a new request.
 */

export type NearbyCloseReason =
  "origin_removed" | "origin_unavailable" | "origin_changed" | "trip_unavailable" | "session_ended";

export type NearbyFailure = "error" | "invalid_response";

export type NearbyStatus =
  /** No search: never opened, closed by the user (`reason: null`), or closed by a change. */
  | { kind: "closed"; reason: NearbyCloseReason | null }
  /** First request for this origin: nothing to show yet. */
  | { kind: "loading"; origin: NearbyOrigin; radius: AllowedRadiusMiles }
  /** A request for `radius` is running; `previous` holds earlier results for the SAME origin and their own radius. */
  | {
      kind: "updating";
      origin: NearbyOrigin;
      radius: AllowedRadiusMiles;
      previous: NearbyResultSet;
    }
  /** The latest request succeeded with at least one landmark (after leaving out the origin). */
  | { kind: "success"; result: NearbyResultSet }
  /** The latest request succeeded with no landmark to show (after leaving out the origin). */
  | { kind: "empty"; result: NearbyResultSet }
  /** The latest request failed; `previous` (same origin) is kept for display, labelled with its own radius. */
  | {
      kind: "error";
      origin: NearbyOrigin;
      radius: AllowedRadiusMiles;
      failure: NearbyFailure;
      previous?: NearbyResultSet;
    };

export interface NearbyOriginView {
  stopId: string;
  /** The stop's CURRENT number (position + 1). */
  stopNumber: number;
  displayName: string;
}

export interface ShownNearbyResults {
  /** The result set the landmarks belong to — its `radius` is the radius they were found within. */
  set: NearbyResultSet;
  landmarks: NearbyLandmarkView[];
  /** True only when `set` answers the latest request (success or empty). */
  isCurrent: boolean;
}

export interface UseNearbyLandmarksResult {
  status: NearbyStatus;
  /** The selected radius (the one requested or about to be requested). */
  radius: AllowedRadiusMiles;
  /** The origin stop as the trip currently shows it, while a search is open. */
  origin: NearbyOriginView | null;
  /** The results to show, with current trip membership; null when there are none. */
  shown: ShownNearbyResults | null;
  /** Opens (or reopens) a search from an available stop. Returns false when it cannot. */
  open: (stopId: string) => boolean;
  setRadius: (radius: number) => void;
  /** Repeats the failed request (only from `error`). */
  retry: () => void;
  close: () => void;
}

interface Selection {
  userId: string;
  tripId: string;
  origin: NearbyOrigin;
}

/** Why `selection` no longer holds for this trip and user; null while it is still valid. */
function invalidReason(
  selection: Selection,
  trip: OwnerTrip | null,
  userId: string | null,
): NearbyCloseReason | null {
  if (userId !== selection.userId) return "session_ended";
  if (trip === null || trip.id !== selection.tripId) return "trip_unavailable";
  const stop = trip.stops.find((s) => s.id === selection.origin.stopId);
  if (stop === undefined) return "origin_removed";
  if (!stop.is_available) return "origin_unavailable";
  const now = nearbyOriginOf(trip, stop.id);
  if (now === null || !sameOrigin(now, selection.origin)) return "origin_changed";
  return null;
}

/** The result set currently on display for `status`, if any. */
function shownSet(status: NearbyStatus): { set: NearbyResultSet; isCurrent: boolean } | null {
  switch (status.kind) {
    case "success":
    case "empty":
      return { set: status.result, isCurrent: true };
    case "updating":
      return { set: status.previous, isCurrent: false };
    case "error":
      return status.previous ? { set: status.previous, isCurrent: false } : null;
    default:
      return null;
  }
}

export function useNearbyLandmarks(trip: OwnerTrip | null): UseNearbyLandmarksResult {
  const { session } = useAuth();
  const userId = session.status === "authenticated" ? session.user.id : null;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [status, setStatus] = useState<NearbyStatus>({ kind: "closed", reason: null });
  const [radius, setRadiusState] = useState<AllowedRadiusMiles>(DEFAULT_RADIUS_MILES);

  const requestIdRef = useRef(0);
  const mounted = useRef(true);
  const selectionRef = useRef<Selection | null>(null);
  const statusRef = useRef<NearbyStatus>(status);
  const tripRef = useRef(trip);
  const userIdRef = useRef(userId);
  tripRef.current = trip;
  userIdRef.current = userId;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commitStatus = useCallback((next: NearbyStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const commitSelection = useCallback((next: Selection | null) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  /** Clears the search and invalidates any pending request. */
  const shut = useCallback(
    (reason: NearbyCloseReason | null) => {
      requestIdRef.current += 1;
      commitSelection(null);
      commitStatus({ kind: "closed", reason });
    },
    [commitSelection, commitStatus],
  );

  const request = useCallback(
    (origin: NearbyOrigin, requested: AllowedRadiusMiles, previous: NearbyResultSet | null) => {
      requestIdRef.current += 1;
      const id = requestIdRef.current;
      commitStatus(
        previous === null
          ? { kind: "loading", origin, radius: requested }
          : { kind: "updating", origin, radius: requested, previous },
      );
      const isLatest = () => mounted.current && requestIdRef.current === id;
      getLandmarkGeoMarkers({
        q: "",
        categories: [],
        geo: {
          mode: "near",
          near: formatNearParam({ lat: origin.latitude, lng: origin.longitude }),
          radius: requested,
        },
      }).then(
        (raw: unknown) => {
          if (!isLatest()) return;
          const result = parseNearbyResponse(raw, origin, requested);
          if (result === null) {
            commitStatus({
              kind: "error",
              origin,
              radius: requested,
              failure: "invalid_response",
              ...(previous ? { previous } : {}),
            });
            return;
          }
          commitStatus(
            result.results.length > 0 ? { kind: "success", result } : { kind: "empty", result },
          );
        },
        () => {
          if (!isLatest()) return;
          commitStatus({
            kind: "error",
            origin,
            radius: requested,
            failure: "error",
            ...(previous ? { previous } : {}),
          });
        },
      );
    },
    [commitStatus],
  );

  const open = useCallback(
    (stopId: string): boolean => {
      const currentTrip = tripRef.current;
      const currentUser = userIdRef.current;
      if (currentTrip === null || currentUser === null) return false;
      const origin = nearbyOriginOf(currentTrip, stopId);
      if (origin === null) return false;
      commitSelection({ userId: currentUser, tripId: currentTrip.id, origin });
      // A fresh search: nothing from an earlier search (any origin) is carried over.
      request(origin, radius, null);
      return true;
    },
    [commitSelection, request, radius],
  );

  const setRadius = useCallback(
    (next: number) => {
      if (!isAllowedRadius(next)) return;
      setRadiusState(next);
      const current = selectionRef.current;
      if (current === null) return;
      const shownNow = shownSet(statusRef.current);
      request(current.origin, next, shownNow?.set ?? null);
    },
    [request],
  );

  const retry = useCallback(() => {
    const current = selectionRef.current;
    const now = statusRef.current;
    if (current === null || now.kind !== "error") return;
    request(current.origin, now.radius, now.previous ?? null);
  }, [request]);

  const close = useCallback(() => shut(null), [shut]);

  // A search that no longer holds (trip, stop, or session changed) is closed.
  // The render below already hides it; this commits the change and cancels
  // the pending request.
  const reason = selection === null ? null : invalidReason(selection, trip, userId);
  useEffect(() => {
    if (reason !== null) shut(reason);
  }, [reason, shut]);

  const effectiveStatus: NearbyStatus = reason !== null ? { kind: "closed", reason } : status;

  const originView = useMemo<NearbyOriginView | null>(() => {
    if (reason !== null || selection === null || trip === null) return null;
    const stop = trip.stops.find((s) => s.id === selection.origin.stopId);
    if (stop === undefined || !stop.is_available) return null;
    return {
      stopId: stop.id,
      stopNumber: stop.position + 1,
      displayName: stop.landmark.display_name,
    };
  }, [reason, selection, trip]);

  const shown = useMemo<ShownNearbyResults | null>(() => {
    const current = shownSet(effectiveStatus);
    if (current === null || trip === null) return null;
    return {
      set: current.set,
      landmarks: withTripMembership(current.set.results, trip.stops),
      isCurrent: current.isCurrent,
    };
  }, [effectiveStatus, trip]);

  return {
    status: effectiveStatus,
    radius,
    origin: originView,
    shown,
    open,
    setRadius,
    retry,
    close,
  };
}
