import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import {
  TRIP_STOP_ALREADY_EXISTS,
  TRIP_STOP_LIMIT_REACHED,
  addTripStop,
  createTrip,
  getTrip,
  listTrips,
  type TripListItem,
} from "../api/trips";
import { useAuth } from "../auth/session";
import { updateSafety, type OperationHold, type Protection } from "../pwa/updateSafety";
import type { TripFailure } from "./useTrip";

/**
 * State and actions behind "Add to trip" for one landmark (M05-T04 Increment
 * 5; spec v1.1 §§6.1, 8; decisions D2, D5, D6). The server stays
 * authoritative for the landmark's availability, duplicates, and the 25-stop
 * limit; nothing here is optimistic or invented.
 *
 * TRIP LIST. Fetched fresh each time the picker opens: page 1 with
 * `limit=100`; "Show more" asks for the next page only while `has_more` is
 * true, one request at a time, appending without duplicate trip IDs. A quiet
 * refresh (after an add, or an uncertain outcome) re-reads every page loaded
 * so far. A selected trip that is no longer listed is DESELECTED with a note —
 * never silently replaced by another trip.
 *
 * ONE ACTION AT A TIME. A synchronous ref guard covers the whole
 * create-then-add sequence, so a second submission is refused even before
 * React re-renders.
 *
 * - Add to an existing trip → `added`, or a mapped error. A `404` re-reads the
 *   list: if the trip is gone, its selection is cleared; otherwise the
 *   landmark can no longer be added and further adds are blocked.
 * - New trip → `createTrip`, then (only then) `addTripStop` with the NEW
 *   trip's ID. If the add fails, the created trip is kept and named, and
 *   "Try adding again" retries the ADD ONLY with that ID — never another
 *   create. Nothing is deleted or repeated automatically.
 * - An uncertain outcome (network error, `5xx`, unreadable response) is never
 *   reported as success or failure and never replayed; the list is
 *   refreshed, and a trip is never assumed to be ours because of its name.
 * - `401` clears every account-specific value (list, selection, messages)
 *   and asks the auth mechanism to re-check the session.
 *
 * ISOLATION. Everything follows the VERIFIED user and the landmark: an
 * unverified or anonymous session, a different user, or a different landmark
 * clears all of it and invalidates every outstanding request (epochs), so a
 * late response can never restore another user's trips or an outdated
 * message. Closing the picker cancels list reads only; an in-flight change
 * still finishes and reports — it is neither replayed nor undone.
 */

export type PickerListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; failure: TripFailure }
  | {
      status: "ready";
      trips: TripListItem[];
      page: number;
      hasMore: boolean;
      loadingMore: boolean;
      moreFailure: TripFailure | null;
    };

/** `"new"` selects the New trip option. */
export type PickerSelection = string | "new" | null;

export const NEW_TRIP = "new";
export const PICKER_PAGE_LIMIT = 100;

export interface TripRef {
  id: string;
  name: string;
}

export type AddFeedback =
  | { kind: "added"; trip: TripRef; created: boolean }
  | { kind: "already_exists"; trip: TripRef }
  | { kind: "limit_reached"; trip: TripRef }
  | { kind: "landmark_unavailable" }
  | { kind: "trip_gone" }
  | { kind: "rate_limited"; retryAfterSeconds?: number }
  | { kind: "add_failed"; trip: TripRef }
  | { kind: "add_uncertain"; trip: TripRef }
  /** A retry after an uncertain add could not read the trip to check: nothing was sent. */
  | { kind: "verify_failed"; trip: TripRef }
  /** The trip was created; adding the landmark to it then failed or is uncertain. */
  | {
      kind: "partial";
      trip: TripRef;
      reason: "failed" | "uncertain" | "limit" | "unavailable" | "rate_limited";
      retryAfterSeconds?: number;
    }
  | { kind: "create_failed" }
  | { kind: "create_uncertain" };

export type ActionKind = "adding" | "creating";

export type SessionView = "unverified" | "signed-out" | "signed-in";

export interface UseAddToTrip {
  session: SessionView;
  list: PickerListState;
  selection: PickerSelection;
  /** Set when the selected trip disappeared from the list and was deselected. */
  selectionCleared: boolean;
  action: ActionKind | null;
  feedback: AddFeedback | null;
  /** The landmark can no longer be added (the server answered 404 for it). */
  landmarkUnavailable: boolean;
  /** A created trip the landmark could not (yet) be added to — the only target of "Try adding again". */
  pendingTrip: TripRef | null;
  select: (selection: PickerSelection) => void;
  retryList: () => void;
  loadMore: () => void;
  addToSelected: () => Promise<void>;
  /** `name` must already pass `validateTripName`. Returns the server's name error, if any. */
  createAndAdd: (name: string) => Promise<{ nameError?: string }>;
  retryAdd: () => Promise<void>;
}

interface Scope {
  userId: string;
  landmarkId: string;
}

type Classified =
  | { kind: "unauthenticated" }
  | { kind: "not_found" }
  | { kind: "already_exists" }
  | { kind: "limit_reached" }
  | { kind: "rate_limited"; retryAfterSeconds?: number }
  | { kind: "bad_request"; message: string }
  | { kind: "refused" }
  | { kind: "uncertain" };

function classify(error: unknown): Classified {
  if (error instanceof RangeError) return { kind: "refused" };
  if (!(error instanceof ApiError)) return { kind: "uncertain" };
  if (error.status === 401) return { kind: "unauthenticated" };
  if (error.status === 404) return { kind: "not_found" };
  if (error.status === 409 && error.code === TRIP_STOP_ALREADY_EXISTS)
    return { kind: "already_exists" };
  if (error.status === 409 && error.code === TRIP_STOP_LIMIT_REACHED)
    return { kind: "limit_reached" };
  if (error.status === 429) {
    return error.retryAfterSeconds === undefined
      ? { kind: "rate_limited" }
      : { kind: "rate_limited", retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error.status === 400) return { kind: "bad_request", message: error.message };
  if (error.status === 403) return { kind: "refused" };
  return { kind: "uncertain" };
}

function listFailure(error: unknown): TripFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "unauthenticated" };
    if (error.status === 429) {
      return error.retryAfterSeconds === undefined
        ? { kind: "rate-limited" }
        : { kind: "rate-limited", retryAfterSeconds: error.retryAfterSeconds };
    }
  }
  return { kind: "error" };
}

/** Appends `incoming` to `current`, skipping trip IDs already present. */
export function mergeTrips(current: readonly TripListItem[], incoming: readonly TripListItem[]) {
  const seen = new Set(current.map((t) => t.id));
  const merged = [...current];
  for (const trip of incoming) {
    if (seen.has(trip.id)) continue;
    seen.add(trip.id);
    merged.push(trip);
  }
  return merged;
}

export function useAddToTrip(landmarkId: string, open: boolean): UseAddToTrip {
  const { session, refresh: refreshSession } = useAuth();
  const [list, setList] = useState<PickerListState>({ status: "idle" });
  const [selection, setSelection] = useState<PickerSelection>(null);
  const [selectionCleared, setSelectionCleared] = useState(false);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);
  const [landmarkUnavailable, setLandmarkUnavailable] = useState(false);
  const [pendingTrip, setPendingTrip] = useState<TripRef | null>(null);

  const scopeRef = useRef<Scope | null>(null);
  /** Bumped by any scope change: invalidates list reads AND changes in flight. */
  const scopeEpoch = useRef(0);
  /** Bumped when the picker opens, closes, or reloads: invalidates list reads only. */
  const listEpoch = useRef(0);
  const listRef = useRef<PickerListState>(list);
  const selectionRef = useRef<PickerSelection>(selection);
  const busyRef = useRef(false);
  /**
   * The update-safety hold of the action in progress (M06-T02 Increment 4b-i):
   * taken in `begin()` before any side effect, released with the lock in
   * `end()` or `clearAll()`. An action spans create-then-add and
   * verify-then-add, so an application update can never reload between steps.
   */
  const holdRef = useRef<OperationHold | null>(null);
  const loadingMoreRef = useRef(false);
  /** The trip whose last add had an UNCERTAIN outcome; the next add to it verifies first. */
  const uncertainTripRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commitList = useCallback((next: PickerListState) => {
    listRef.current = next;
    setList(next);
  }, []);

  const commitSelection = useCallback((next: PickerSelection) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  /** After any list (re)load: keep a still-listed selection; deselect (with a note) one that disappeared. */
  const reconcileSelection = useCallback(
    (trips: readonly TripListItem[]) => {
      const current = selectionRef.current;
      if (current === null || current === NEW_TRIP) return;
      if (trips.some((t) => t.id === current)) return;
      commitSelection(null);
      setSelectionCleared(true);
    },
    [commitSelection],
  );

  /**
   * M06-T02 Increment 4b-ii: the unfinished-retry state — a created trip the
   * landmark could not (yet) be added to (`pendingTrip`) and the verify-first
   * marker for an uncertain add (`uncertainTripRef`) — is unfinished user
   * intent. Its PRESENCE is registered (never a trip or landmark identifier),
   * synchronously wherever it is set or cleared — inside the action, before
   * its operation hold is released — and released on unmount.
   */
  const pendingTripRef = useRef<TripRef | null>(null);
  const retryProtection = useRef<Protection | null>(null);
  const syncRetryProtection = useCallback((changed: boolean) => {
    const active = pendingTripRef.current !== null || uncertainTripRef.current !== null;
    if (active) {
      if (retryProtection.current === null) {
        retryProtection.current = updateSafety.protect("unfinished-trip-add");
      } else if (changed) {
        retryProtection.current.touch();
      }
    } else if (retryProtection.current !== null) {
      retryProtection.current.release();
      retryProtection.current = null;
    }
  }, []);
  const commitPendingTrip = useCallback(
    (trip: TripRef | null) => {
      const changed = pendingTripRef.current?.id !== trip?.id;
      pendingTripRef.current = trip;
      setPendingTrip(trip);
      syncRetryProtection(changed);
    },
    [syncRetryProtection],
  );
  const setUncertainTrip = useCallback(
    (tripId: string | null) => {
      const changed = uncertainTripRef.current !== tripId;
      uncertainTripRef.current = tripId;
      syncRetryProtection(changed);
    },
    [syncRetryProtection],
  );
  useLayoutEffect(() => {
    // StrictMode's simulated remount: re-register retry state that still exists.
    syncRetryProtection(false);
    const owned = retryProtection;
    return () => {
      owned.current?.release();
      owned.current = null;
    };
  }, [syncRetryProtection]);

  const releaseHold = useCallback(() => {
    const hold = holdRef.current;
    holdRef.current = null;
    hold?.release();
  }, []);

  /** Clears every account-specific value and invalidates everything in flight. */
  const clearAll = useCallback(() => {
    scopeEpoch.current += 1;
    listEpoch.current += 1;
    busyRef.current = false;
    // A stale action starts no further request after its current one (every step
    // re-checks `currentScope` first); that request stays counted by the API client.
    releaseHold();
    loadingMoreRef.current = false;
    commitList({ status: "idle" });
    commitSelection(null);
    setSelectionCleared(false);
    setAction(null);
    setFeedback(null);
    setLandmarkUnavailable(false);
    commitPendingTrip(null);
    setUncertainTrip(null);
  }, [commitList, commitSelection, releaseHold, commitPendingTrip, setUncertainTrip]);

  const unauthenticated = useCallback(() => {
    clearAll();
    void refreshSession();
  }, [clearAll, refreshSession]);

  const currentScope = (scope: Scope, epoch: number) =>
    mounted.current && scopeRef.current === scope && scopeEpoch.current === epoch;

  /** Reads pages 1…`pages` (fresh), or just page 1 when `pages` is 1. */
  const readPages = useCallback(
    async (
      scope: Scope,
      epochs: { scope: number; list: number },
      pages: number,
      quiet: boolean,
    ): Promise<void> => {
      const stillCurrent = () =>
        currentScope(scope, epochs.scope) && listEpoch.current === epochs.list;
      if (!quiet) commitList({ status: "loading" });
      let trips: TripListItem[] = [];
      let page = 0;
      let hasMore = false;
      try {
        for (let p = 1; p <= pages; p += 1) {
          const result = await listTrips({ page: p, limit: PICKER_PAGE_LIMIT });
          if (!stillCurrent()) return;
          trips = mergeTrips(trips, result.trips);
          page = p;
          hasMore = result.has_more;
          if (!hasMore) break;
        }
      } catch (error) {
        if (!stillCurrent()) return;
        const failure = listFailure(error);
        if (failure.kind === "unauthenticated") {
          unauthenticated();
          return;
        }
        if (!quiet) commitList({ status: "error", failure });
        return; // a failed quiet refresh keeps the list already shown
      }
      commitList({ status: "ready", trips, page, hasMore, loadingMore: false, moreFailure: null });
      reconcileSelection(trips);
    },
    [commitList, reconcileSelection, unauthenticated],
  );

  const loadFresh = useCallback(() => {
    const scope = scopeRef.current;
    if (scope === null) return;
    listEpoch.current += 1;
    loadingMoreRef.current = false;
    void readPages(scope, { scope: scopeEpoch.current, list: listEpoch.current }, 1, false);
  }, [readPages]);

  /** Re-reads every page loaded so far, keeping the visible list until it answers. */
  const refreshQuietly = useCallback(() => {
    const scope = scopeRef.current;
    const current = listRef.current;
    if (scope === null || current.status !== "ready") return;
    listEpoch.current += 1;
    loadingMoreRef.current = false;
    void readPages(
      scope,
      { scope: scopeEpoch.current, list: listEpoch.current },
      Math.max(current.page, 1),
      true,
    );
  }, [readPages]);

  const loadMore = useCallback(() => {
    const scope = scopeRef.current;
    const current = listRef.current;
    if (scope === null || current.status !== "ready" || !current.hasMore) return;
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const epochs = { scope: scopeEpoch.current, list: listEpoch.current };
    const nextPage = current.page + 1;
    commitList({ ...current, loadingMore: true, moreFailure: null });
    void (async () => {
      try {
        const result = await listTrips({ page: nextPage, limit: PICKER_PAGE_LIMIT });
        if (!currentScope(scope, epochs.scope) || listEpoch.current !== epochs.list) return;
        const latest = listRef.current;
        if (latest.status !== "ready") return;
        commitList({
          status: "ready",
          trips: mergeTrips(latest.trips, result.trips),
          page: nextPage,
          hasMore: result.has_more,
          loadingMore: false,
          moreFailure: null,
        });
      } catch (error) {
        if (!currentScope(scope, epochs.scope) || listEpoch.current !== epochs.list) return;
        const failure = listFailure(error);
        if (failure.kind === "unauthenticated") {
          unauthenticated();
          return;
        }
        const latest = listRef.current;
        if (latest.status === "ready")
          commitList({ ...latest, loadingMore: false, moreFailure: failure });
      } finally {
        if (listEpoch.current === epochs.list) loadingMoreRef.current = false;
      }
    })();
  }, [commitList, unauthenticated]);

  // ---- scope: the verified user and the landmark ----
  const verifiedUserId = session.status === "authenticated" ? session.user.id : null;
  useEffect(() => {
    const current = scopeRef.current;
    if (verifiedUserId === null) {
      scopeRef.current = null;
      clearAll();
      return;
    }
    if (
      current !== null &&
      current.userId === verifiedUserId &&
      current.landmarkId === landmarkId
    ) {
      return;
    }
    scopeRef.current = { userId: verifiedUserId, landmarkId };
    clearAll();
  }, [verifiedUserId, landmarkId, clearAll]);

  // ---- open/close: fresh list on every open; closing cancels list reads only ----
  const scopeKey = verifiedUserId === null ? null : `${verifiedUserId}:${landmarkId}`;
  useEffect(() => {
    if (!open || scopeKey === null) {
      listEpoch.current += 1;
      loadingMoreRef.current = false;
      return;
    }
    setSelectionCleared(false);
    loadFresh();
  }, [open, scopeKey, loadFresh]);

  const select = useCallback(
    (next: PickerSelection) => {
      commitSelection(next);
      setSelectionCleared(false);
    },
    [commitSelection],
  );

  /**
   * Adds the landmark to `trip`; shared by "Add" and "Try adding again".
   *
   * After an UNCERTAIN add to a trip, the next attempt for that trip first
   * reads the trip and inspects its stops: if the landmark is already there,
   * the add is confirmed and NO request is sent; if the trip cannot be read,
   * nothing is sent and the outcome stays unconfirmed (each later attempt
   * verifies again); only a trip read that shows the landmark absent leads
   * to a new add request.
   */
  const addTo = useCallback(
    async (scope: Scope, epoch: number, trip: TripRef, created: boolean): Promise<void> => {
      if (uncertainTripRef.current === trip.id) {
        let present: boolean;
        try {
          const current = await getTrip(trip.id);
          present = current.stops.some((stop) => stop.landmark.id === scope.landmarkId);
        } catch (readError) {
          if (!currentScope(scope, epoch)) return;
          if (readError instanceof ApiError && readError.status === 401) {
            unauthenticated();
            return;
          }
          if (readError instanceof ApiError && readError.status === 404) {
            setUncertainTrip(null);
            commitPendingTrip(null);
            setFeedback({ kind: "trip_gone" });
            refreshQuietly();
            return;
          }
          setFeedback({ kind: "verify_failed", trip });
          return;
        }
        if (!currentScope(scope, epoch)) return;
        setUncertainTrip(null);
        if (present) {
          commitPendingTrip(null);
          setFeedback({ kind: "added", trip, created });
          refreshQuietly();
          return;
        }
      }
      try {
        await addTripStop(trip.id, scope.landmarkId);
      } catch (error) {
        if (!currentScope(scope, epoch)) return;
        const c = classify(error);
        if (c.kind === "unauthenticated") {
          unauthenticated();
          return;
        }
        if (created) {
          // The trip exists; keep it as the recovery target.
          commitPendingTrip(trip);
          if (c.kind === "already_exists") {
            commitPendingTrip(null);
            setFeedback({ kind: "already_exists", trip });
            refreshQuietly();
            return;
          }
          if (c.kind === "not_found") setLandmarkUnavailable(true);
          if (c.kind === "uncertain") setUncertainTrip(trip.id);
          setFeedback({
            kind: "partial",
            trip,
            reason:
              c.kind === "uncertain"
                ? "uncertain"
                : c.kind === "limit_reached"
                  ? "limit"
                  : c.kind === "not_found"
                    ? "unavailable"
                    : c.kind === "rate_limited"
                      ? "rate_limited"
                      : "failed",
            ...(c.kind === "rate_limited" && c.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: c.retryAfterSeconds }
              : {}),
          });
          refreshQuietly();
          return;
        }
        switch (c.kind) {
          case "already_exists":
            setFeedback({ kind: "already_exists", trip });
            return;
          case "limit_reached":
            setFeedback({ kind: "limit_reached", trip });
            return;
          case "rate_limited":
            setFeedback(
              c.retryAfterSeconds === undefined
                ? { kind: "rate_limited" }
                : { kind: "rate_limited", retryAfterSeconds: c.retryAfterSeconds },
            );
            return;
          case "not_found": {
            // The trip may be gone, or the landmark no longer addable: read the trip to tell.
            let tripExists: boolean;
            try {
              await getTrip(trip.id);
              tripExists = true;
            } catch (readError) {
              if (!currentScope(scope, epoch)) return;
              if (readError instanceof ApiError && readError.status === 401) {
                unauthenticated();
                return;
              }
              if (!(readError instanceof ApiError && readError.status === 404)) {
                // Cannot tell which: report the landmark as not addable now, without blocking.
                setFeedback({ kind: "landmark_unavailable" });
                return;
              }
              tripExists = false;
            }
            if (!currentScope(scope, epoch)) return;
            if (tripExists) {
              setLandmarkUnavailable(true);
              setFeedback({ kind: "landmark_unavailable" });
            } else {
              setFeedback({ kind: "trip_gone" });
              refreshQuietly(); // deselects the vanished trip (with a note)
            }
            return;
          }
          case "uncertain":
            setUncertainTrip(trip.id);
            setFeedback({ kind: "add_uncertain", trip });
            refreshQuietly();
            return;
          default:
            setFeedback({ kind: "add_failed", trip });
        }
        return;
      }
      if (!currentScope(scope, epoch)) return;
      setUncertainTrip(null);
      commitPendingTrip(null);
      setFeedback({ kind: "added", trip, created });
      refreshQuietly();
    },
    [unauthenticated, refreshQuietly],
  );

  /** Takes the action lock synchronously, or returns null. */
  const begin = (kind: ActionKind): { scope: Scope; epoch: number } | null => {
    const scope = scopeRef.current;
    if (busyRef.current || scope === null) return null;
    // Refused while an application update owns the transition gate — before any
    // side effect (no lock, no action state, no cleared feedback, no request).
    const hold = updateSafety.acquireHold();
    if (hold === null) return null;
    holdRef.current = hold;
    busyRef.current = true;
    setAction(kind);
    setFeedback(null);
    return { scope, epoch: scopeEpoch.current };
  };

  const end = (epoch: number) => {
    if (scopeEpoch.current !== epoch) return;
    busyRef.current = false;
    releaseHold();
    if (mounted.current) setAction(null);
  };

  const addToSelected = useCallback(async () => {
    const selected = selectionRef.current;
    const current = listRef.current;
    if (landmarkUnavailable || selected === null || selected === NEW_TRIP) return;
    if (current.status !== "ready") return;
    const trip = current.trips.find((t) => t.id === selected);
    if (trip === undefined) return;
    const started = begin("adding");
    if (started === null) return;
    try {
      await addTo(started.scope, started.epoch, { id: trip.id, name: trip.name }, false);
    } finally {
      end(started.epoch);
    }
  }, [landmarkUnavailable, addTo]);

  const createAndAdd = useCallback(
    async (name: string): Promise<{ nameError?: string }> => {
      if (landmarkUnavailable) return {};
      const started = begin("creating");
      if (started === null) return {};
      const { scope, epoch } = started;
      try {
        let created: TripRef;
        try {
          const trip = await createTrip(name);
          created = { id: trip.id, name: trip.name };
        } catch (error) {
          if (!currentScope(scope, epoch)) return {};
          const c = classify(error);
          switch (c.kind) {
            case "unauthenticated":
              unauthenticated();
              return {};
            case "bad_request":
              return { nameError: c.message };
            case "rate_limited":
              setFeedback(
                c.retryAfterSeconds === undefined
                  ? { kind: "rate_limited" }
                  : { kind: "rate_limited", retryAfterSeconds: c.retryAfterSeconds },
              );
              return {};
            case "uncertain":
              setFeedback({ kind: "create_uncertain" });
              refreshQuietly();
              return {};
            default:
              setFeedback({ kind: "create_failed" });
              return {};
          }
        }
        if (!currentScope(scope, epoch)) return {};
        // The trip now exists: from here on, only adds to THIS trip are ever attempted
        // (`addTo` keeps it as the recovery target if the add does not succeed).
        await addTo(scope, epoch, created, true);
        return {};
      } finally {
        end(epoch);
      }
    },
    [landmarkUnavailable, unauthenticated, refreshQuietly, addTo],
  );

  const retryAdd = useCallback(async () => {
    const trip = pendingTrip;
    if (trip === null || landmarkUnavailable) return;
    const started = begin("adding");
    if (started === null) return;
    try {
      await addTo(started.scope, started.epoch, trip, true);
    } finally {
      end(started.epoch);
    }
  }, [pendingTrip, landmarkUnavailable, addTo]);

  const sessionView: SessionView =
    session.status === "authenticated"
      ? "signed-in"
      : session.status === "anonymous"
        ? "signed-out"
        : "unverified";

  return {
    session: sessionView,
    list,
    selection,
    selectionCleared,
    action,
    feedback,
    landmarkUnavailable,
    pendingTrip,
    select,
    retryList: loadFresh,
    loadMore,
    addToSelected,
    createAndAdd,
    retryAdd,
  };
}
