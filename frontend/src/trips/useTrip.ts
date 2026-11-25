import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import {
  MAX_TRIP_STOPS,
  TRIP_SHARING_UNAVAILABLE,
  TRIP_STOP_ALREADY_EXISTS,
  TRIP_STOP_LIMIT_REACHED,
  TRIP_VERSION_CONFLICT,
  addTripStop,
  deleteTrip as deleteTripRequest,
  enableTripSharing,
  getTrip,
  removeTripStop,
  renameTrip,
  reorderTripStops,
  revokeTripSharing,
  type OwnerTrip,
  type TripStop,
} from "../api/trips";
import { parseUuid } from "../api/tripValidation";
import { useAuth } from "../auth/session";
import { TRIP_NAME_MESSAGES } from "./tripNameRule";

const NAME_MESSAGES = new Set<string>(Object.values(TRIP_NAME_MESSAGES));

/**
 * The signed-in user's trip — one authoritative state for reading and editing
 * it (M05-T04 Increments 2–3; spec v1.1 §§4, 5.3, 6.2–6.4, 7.2–7.3).
 *
 * States:
 * - `idle` — no verified signed-in user: nothing fetched, nothing held.
 * - `loading` — the trip is being fetched; nothing from before is kept.
 * - `ready` — the validated, server-confirmed trip.
 * - `not_found` — the generic outcome for a missing trip, another user's
 *   trip, or a malformed ID (spec §4).
 * - `error` — a load failed (`unauthenticated`, `rate-limited`, `error`); no
 *   trip data is kept.
 * - `stale` — a change was made (or may have been made) but the trip could not
 *   be re-read afterwards. The outdated trip is NOT kept: no list, no version,
 *   so no further change can be based on it. Only a reload (`retry`) leaves it.
 *
 * SESSION ISOLATION (Increment 3 refinement). The trip follows the VERIFIED
 * session only. Whenever the session is not verified (`loading`/`unavailable`)
 * or is anonymous, the trip is cleared and every outstanding request is
 * invalidated; when a user is verified again — even the same user — the trip
 * is fetched fresh. A change of trip ID or user does the same immediately.
 *
 * ORDERING. Every scope change, invalidation, and load starts a new EPOCH; a
 * response (load or mutation) may write only if its epoch is still current
 * and the component is mounted. Late responses are dropped.
 *
 * MUTATIONS (no optimism). At most one change or its required re-read runs at
 * a time; the guard is a ref, so a second click before React re-renders is
 * refused (`ignored`). Nothing is shown as changed until the server confirms:
 * - remove → `204`, then a fresh `getTrip` before anything else is allowed
 *   (the `204` carries no version); a failed re-read leaves `stale`.
 * - move → `PUT …/order` with the whole new order and the CURRENT version;
 *   the validated `200` trip becomes the state.
 * - A `409 TRIP_VERSION_CONFLICT` (or a `400` stop-set mismatch) re-reads the
 *   trip and never replays the move.
 * - An uncertain outcome (network error, `5xx`, unreadable response) re-reads
 *   the trip and never replays the request.
 * - `401` clears the trip (an `error` state) and re-checks the session.
 * - A refusal that changed nothing for certain (`429`, `400`, `403`) keeps the
 *   current trip and reports the failure.
 * - add (M05-T05 Increment 4) → `POST …/stops`; the `201` carries no trip,
 *   distances, or version, so a fresh `getTrip` follows before anything else is
 *   allowed (a failed re-read leaves `stale`, reason `added`, never inviting a
 *   repeat). `409 TRIP_STOP_ALREADY_EXISTS` / `TRIP_STOP_LIMIT_REACHED` and a
 *   generic `404` re-read the trip (a `404` re-read that finds no trip is the
 *   generic not-found; otherwise the landmark simply cannot be added — no
 *   reason is guessed). An uncertain outcome re-reads and reports whether the
 *   landmark is now in the trip; it is never re-sent automatically.
 * - rename (M05-T06 Increment 3) → `PATCH` with the name and the CURRENT
 *   version; the validated `200` trip becomes the state (stops, distances, and
 *   sharing state included). A server name error keeps the trip and reports
 *   the message. A `409 TRIP_VERSION_CONFLICT` re-reads the trip and never
 *   replays the rename. An uncertain outcome re-reads and reports whether the
 *   trip now has the requested name — without claiming the request caused it
 *   (a failed re-read leaves `stale`, reason `renamed`).
 * - delete (M05-T06 Increment 3) → `DELETE` (no version: the backend contract
 *   takes none). A `204` moves to the TERMINAL `deleted` state: the trip and
 *   its version are dropped, every outstanding request is invalidated, and no
 *   change can start again (only a different trip or user leaves it; `retry`
 *   does nothing). A `404` means the trip is no longer available to this user
 *   — not that this request deleted it — and also ends in `deleted`. An
 *   uncertain outcome re-reads the trip: gone → `deleted`; still there → the
 *   fresh trip, with deletion unconfirmed; a failed re-read → `stale`, reason
 *   `delete_uncertain`. DELETE is never re-sent: Reload only reads.
 * Callers receive a `MutationOutcome` describing what happened, for focus
 * and announcements.
 */

export type TripFailure =
  | { kind: "unauthenticated" }
  | { kind: "rate-limited"; retryAfterSeconds?: number }
  | { kind: "error" };

/** Why a trip became `stale`: what happened before the failed re-read. */
export type StaleReason =
  | "removed"
  | "conflict"
  | "uncertain"
  | "added"
  | "renamed"
  | "delete_uncertain"
  /** A link was created (enable/rotate `200`) but the trip could not be re-read; no link is shown. */
  | "shared"
  /** Sharing was turned off (`204`) but the trip could not be re-read. */
  | "unshared"
  /** A sharing change's outcome was uncertain and the trip could not be re-read. */
  | "share_uncertain"
  /** `409 TRIP_SHARING_UNAVAILABLE`, and the trip could not be re-read. */
  | "sharing_unavailable";

export type TripState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; trip: OwnerTrip }
  | { status: "not_found" }
  | { status: "error"; failure: TripFailure }
  | { status: "stale"; reason: StaleReason; failure: TripFailure }
  /** Terminal: the trip was deleted, or is no longer available after a delete request. No data is held. */
  | { status: "deleted" };

export type PendingKind =
  "remove" | "move" | "add" | "refresh" | "rename" | "delete" | "share" | "unshare";

export type MoveDirection = "up" | "down";

export type MutationOutcome =
  /** The stop was removed and the fresh trip is shown. `stop` is the removed stop as it was. */
  | { kind: "removed"; stop: TripStop; trip: OwnerTrip }
  /** The server no longer had the stop (removed elsewhere); the fresh trip is shown. */
  | { kind: "already_removed"; stop: TripStop; trip: OwnerTrip }
  /** The stop moved; `trip` is the server's reordered trip. */
  | { kind: "moved"; stop: TripStop; direction: MoveDirection; trip: OwnerTrip }
  /** The trip had changed (`version`) or its stops differed (`stops`); the latest trip is shown. */
  | { kind: "conflict_refreshed"; reason: "version" | "stops"; trip: OwnerTrip }
  /** The outcome was uncertain; the latest trip is shown (the request was not replayed). */
  | { kind: "uncertain_refreshed"; trip: OwnerTrip }
  /** Refused with nothing changed; the current trip stays. */
  | { kind: "rejected"; failure: TripFailure }
  /**
   * The landmark was added (`201`) and the fresh trip is shown. `stop` is the
   * stop now holding it in that trip — or null when a concurrent change already
   * removed it (the fresh trip is shown as it is).
   */
  | { kind: "added"; landmarkId: string; name: string; stop: TripStop | null; trip: OwnerTrip }
  /** `409`: already in the trip, or the trip is full; the latest trip is shown. */
  | {
      kind: "add_conflict";
      reason: "duplicate" | "full";
      landmarkId: string;
      name: string;
      trip: OwnerTrip;
    }
  /** A generic `404` for the landmark (the trip still exists); the latest trip is shown. */
  | { kind: "add_unavailable"; landmarkId: string; name: string; trip: OwnerTrip }
  /** The add's outcome was uncertain; the latest trip is shown, and says whether the landmark is in it. */
  | {
      kind: "add_uncertain_refreshed";
      landmarkId: string;
      name: string;
      present: boolean;
      trip: OwnerTrip;
    }
  /** Renamed; `trip` is the server's renamed trip. */
  | { kind: "renamed"; trip: OwnerTrip }
  /** The server refused the name (its fixed name-rule message); nothing changed. */
  | { kind: "rename_invalid"; message: string }
  /** `409 TRIP_VERSION_CONFLICT`: the latest trip is shown; the rename was not replayed. */
  | { kind: "rename_conflict"; trip: OwnerTrip }
  /** The rename's outcome was uncertain; the latest trip is shown and says whether it has `name`. */
  | { kind: "rename_uncertain_refreshed"; name: string; hasName: boolean; trip: OwnerTrip }
  /** `204`: deleted. `name` is the trip's name as it was. The state is now `deleted`. */
  | { kind: "deleted"; name: string }
  /** `404` to the delete: no longer available to this user (not proof this request deleted it). */
  | { kind: "delete_unavailable" }
  /** The delete's outcome was uncertain and the re-read found no trip. The state is now `deleted`. */
  | { kind: "delete_uncertain_gone" }
  /** The delete's outcome was uncertain and the trip still exists; the latest trip is shown. */
  | { kind: "delete_uncertain_exists"; trip: OwnerTrip }
  /**
   * A link was created and CONFIRMED: the re-read shows sharing enabled and
   * active at exactly the captured version + 1, so the link is now held.
   * `rotated`: a link was already active before (it no longer works).
   */
  | { kind: "share_created"; rotated: boolean; trip: OwnerTrip }
  /**
   * A link was created, but could not be confirmed as the current one — the
   * re-read shows sharing inactive or disabled (`inactive`), or a version
   * other than captured + 1 (`version`: another change intervened). The
   * received link is discarded; the latest trip is shown.
   */
  | { kind: "share_unconfirmed"; reason: "inactive" | "version"; trip: OwnerTrip }
  /** `409 TRIP_SHARING_UNAVAILABLE`: nothing changed; the latest trip is shown. */
  | { kind: "sharing_unavailable"; trip: OwnerTrip }
  /** Enable/rotate outcome uncertain; the latest trip is shown. `active`: sharing is on now. */
  | { kind: "share_uncertain"; active: boolean; trip: OwnerTrip }
  /** `204`, and the re-read shows sharing off. */
  | { kind: "sharing_revoked"; trip: OwnerTrip }
  /** `204`, but the re-read shows sharing on again (another change intervened). */
  | { kind: "revoke_superseded"; trip: OwnerTrip }
  /** Revoke outcome uncertain; the latest trip is shown. `active`: sharing is still on. */
  | { kind: "revoke_uncertain"; active: boolean; trip: OwnerTrip }
  /** The trip could not be re-read; the state is now `stale`. */
  | { kind: "refresh_failed"; reason: StaleReason }
  | { kind: "not_found" }
  | { kind: "unauthenticated" }
  /** Not started: another change is running, or there is no ready trip or such stop. */
  | { kind: "ignored" }
  /** Overtaken by a newer scope, an invalidation, or unmount; nothing was written. */
  | { kind: "discarded" };

export interface UseTripResult {
  state: TripState;
  /** The change or re-read in progress, if any. */
  pending: PendingKind | null;
  /** Re-fetches the trip after a failure or from `stale` (never automatic). */
  retry: () => void;
  removeStop: (stopId: string) => Promise<MutationOutcome>;
  moveStop: (stopId: string, direction: MoveDirection) => Promise<MutationOutcome>;
  /** Adds a landmark (by ID; `name` is for messages only) to this trip, then re-reads it. */
  addStop: (landmarkId: string, name: string) => Promise<MutationOutcome>;
  /** Renames the trip; `name` must already pass `validateTripName`. Sends the current version. */
  renameTrip: (name: string) => Promise<MutationOutcome>;
  /** Deletes the trip (the caller has obtained explicit confirmation). */
  deleteTrip: () => Promise<MutationOutcome>;
  /**
   * The CONFIRMED share URL for this trip, held in memory only — or null. It is
   * never provisional (see `enableSharing`) and is cleared by the held-link
   * rules (see the comment on `reconcileHeldLink`).
   */
  shareLink: string | null;
  /** Whether `url` is still the held link right now (read synchronously, for late async callbacks). */
  isShareLinkCurrent: (url: string) => boolean;
  /** Creates a share link, or rotates it (the previous link stops working). */
  enableSharing: () => Promise<MutationOutcome>;
  /** Turns sharing off; the link stops working. */
  revokeSharing: () => Promise<MutationOutcome>;
}

interface Scope {
  userId: string;
  tripId: string;
}

type FetchResult = { ok: true; trip: OwnerTrip } | { ok: false; state: TripState };

function rateLimited(error: ApiError): TripFailure {
  return error.retryAfterSeconds === undefined
    ? { kind: "rate-limited" }
    : { kind: "rate-limited", retryAfterSeconds: error.retryAfterSeconds };
}

function loadFailure(error: unknown): TripState {
  if (error instanceof ApiError) {
    // 404 for missing or non-owned; 400 for a malformed ID — the same generic outcome.
    if (error.status === 404 || error.status === 400) return { status: "not_found" };
    if (error.status === 401) return { status: "error", failure: { kind: "unauthenticated" } };
    if (error.status === 429) return { status: "error", failure: rateLimited(error) };
  }
  return { status: "error", failure: { kind: "error" } };
}

type MutationError =
  | { kind: "unauthenticated" }
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "bad_request" }
  /** Refused before anything could change (429, 403). */
  | { kind: "refused"; failure: TripFailure }
  /** The request may or may not have taken effect. */
  | { kind: "uncertain" };

function classifyMutationError(error: unknown): MutationError {
  if (error instanceof RangeError) return { kind: "refused", failure: { kind: "error" } };
  if (!(error instanceof ApiError)) return { kind: "uncertain" };
  if (error.status === 401) return { kind: "unauthenticated" };
  if (error.status === 404) return { kind: "not_found" };
  if (error.status === 409 && error.code === TRIP_VERSION_CONFLICT) {
    return { kind: "version_conflict" };
  }
  if (error.status === 400) return { kind: "bad_request" };
  if (error.status === 429) return { kind: "refused", failure: rateLimited(error) };
  if (error.status === 403) return { kind: "refused", failure: { kind: "error" } };
  return { kind: "uncertain" };
}

function staleFailure(state: TripState): TripFailure {
  return state.status === "error" ? state.failure : { kind: "error" };
}

export function useTrip(tripId: string | undefined): UseTripResult {
  const { session, refresh: refreshSession } = useAuth();
  const [state, setState] = useState<TripState>({ status: "idle" });
  const [pending, setPending] = useState<PendingKind | null>(null);

  const stateRef = useRef<TripState>(state);
  const scopeRef = useRef<Scope | null>(null);
  const epochRef = useRef(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // Not a new epoch: under StrictMode's simulated remount the same scope continues.
      mounted.current = false;
    };
  }, []);

  // ---- The held share link (M05-T06 Increment 4) ----
  //
  // `linkRef` is the only place a CONFIRMED share URL lives (memory only), with
  // the trip version at which it was confirmed; `shareLink` mirrors it for
  // rendering. A link is held only after the confirmation rule in
  // `enableSharing`. Backend contract relied on (verified 2026-11-24 in
  // backend/src/trips/service.ts and repository.ts): every successful
  // mutation — rename, stop add/remove/reorder, share enable/rotate, share
  // revoke — increments `version` by exactly 1 under the owner's trip-row lock.
  const linkRef = useRef<{ url: string; version: number } | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  /**
   * Set immediately before committing the result of OUR OWN confirmed
   * non-sharing change (rename `200`, reorder `200`, add `201`, remove `204`):
   * the version the request was based on. Consumed by the next commit.
   */
  const ownTransition = useRef<number | null>(null);

  const isShareLinkCurrent = useCallback(
    (url: string) => mounted.current && linkRef.current !== null && linkRef.current.url === url,
    [],
  );

  const clearLink = useCallback(() => {
    if (linkRef.current === null) return;
    linkRef.current = null;
    setShareLink(null);
  }, []);

  /**
   * HELD-LINK RULES, applied on every state commit. A held link is KEPT only when:
   *  - the new state is a ready trip with `sharing_enabled` and `is_shared`; and
   *  - its version equals the link's version (nothing has changed), or it is
   *    exactly link version + 1 and the commit is the result of our own
   *    confirmed non-sharing change based on the link's version (that change
   *    accounts for the single increment, so no sharing change intervened).
   * Otherwise it is CLEARED: any non-ready state (loading, idle, stale, error,
   * not found, deleted — so also a session or trip change), sharing disabled
   * or inactive, an uncertain or conflicting outcome, or any other version
   * change. When in doubt, the link is discarded.
   */
  const reconcileHeldLink = useCallback(
    (next: TripState) => {
      const own = ownTransition.current;
      ownTransition.current = null;
      const link = linkRef.current;
      if (link === null) return;
      if (next.status !== "ready" || !next.trip.sharing_enabled || !next.trip.is_shared) {
        clearLink();
        return;
      }
      if (next.trip.version === link.version) return;
      if (own === link.version && next.trip.version === link.version + 1) {
        linkRef.current = { url: link.url, version: next.trip.version };
        return;
      }
      clearLink();
    },
    [clearLink],
  );

  const commit = useCallback(
    (next: TripState) => {
      stateRef.current = next;
      setState(next);
      reconcileHeldLink(next);
    },
    [reconcileHeldLink],
  );

  /** Starts a new epoch: every in-flight load or change becomes stale, and the change lock is released. */
  const invalidate = useCallback(() => {
    epochRef.current += 1;
    busyRef.current = false;
    setPending(null);
    return epochRef.current;
  }, []);

  const isCurrent = useCallback(
    (epoch: number, scope: Scope) =>
      mounted.current && epochRef.current === epoch && scopeRef.current === scope,
    [],
  );

  const fetchTrip = useCallback(async (scope: Scope): Promise<FetchResult> => {
    const canonicalId = parseUuid(scope.tripId);
    if (canonicalId === null) return { ok: false, state: { status: "not_found" } };
    try {
      return { ok: true, trip: await getTrip(canonicalId) };
    } catch (error) {
      return { ok: false, state: loadFailure(error) };
    }
  }, []);

  /** A 401: clear the private trip, invalidate everything outstanding, re-check the session. */
  const unauthenticated = useCallback(() => {
    invalidate();
    commit({ status: "error", failure: { kind: "unauthenticated" } });
    void refreshSession();
  }, [invalidate, commit, refreshSession]);

  const load = useCallback(
    async (scope: Scope): Promise<void> => {
      const epoch = invalidate();
      commit({ status: "loading" });
      const result = await fetchTrip(scope);
      if (!isCurrent(epoch, scope)) return;
      if (result.ok) {
        commit({ status: "ready", trip: result.trip });
        return;
      }
      commit(result.state);
      if (result.state.status === "error" && result.state.failure.kind === "unauthenticated") {
        void refreshSession();
      }
    },
    [invalidate, commit, fetchTrip, isCurrent, refreshSession],
  );

  /**
   * The required re-read after a change. Returns the fresh trip; or an outcome
   * when it could not be shown (the state then says why).
   */
  const reread = useCallback(
    async (
      scope: Scope,
      epoch: number,
      reason: StaleReason,
    ): Promise<{ trip: OwnerTrip } | { outcome: MutationOutcome }> => {
      setPending("refresh");
      const result = await fetchTrip(scope);
      if (!isCurrent(epoch, scope)) return { outcome: { kind: "discarded" } };
      if (result.ok) {
        commit({ status: "ready", trip: result.trip });
        return { trip: result.trip };
      }
      if (result.state.status === "not_found") {
        commit(result.state);
        return { outcome: { kind: "not_found" } };
      }
      if (result.state.status === "error" && result.state.failure.kind === "unauthenticated") {
        unauthenticated();
        return { outcome: { kind: "unauthenticated" } };
      }
      commit({ status: "stale", reason, failure: staleFailure(result.state) });
      return { outcome: { kind: "refresh_failed", reason } };
    },
    [fetchTrip, isCurrent, commit, unauthenticated],
  );

  /** Takes the change lock synchronously, or returns null when a change cannot start. */
  const begin = useCallback(
    (kind: PendingKind): { scope: Scope; epoch: number; trip: OwnerTrip } | null => {
      const current = stateRef.current;
      const scope = scopeRef.current;
      if (busyRef.current || current.status !== "ready" || scope === null) return null;
      busyRef.current = true;
      setPending(kind);
      return { scope, epoch: epochRef.current, trip: current.trip };
    },
    [],
  );

  /** Releases the lock — only if no newer epoch has taken over meanwhile. */
  const end = useCallback((epoch: number) => {
    if (epochRef.current !== epoch) return;
    busyRef.current = false;
    setPending(null);
  }, []);

  const removeStop = useCallback(
    async (stopId: string): Promise<MutationOutcome> => {
      const current = stateRef.current;
      const stop =
        current.status === "ready" ? current.trip.stops.find((s) => s.id === stopId) : undefined;
      if (stop === undefined) return { kind: "ignored" };
      const started = begin("remove");
      if (started === null) return { kind: "ignored" };
      const { scope, epoch, trip } = started;
      try {
        try {
          await removeTripStop(trip.id, stop.id);
        } catch (error) {
          if (!isCurrent(epoch, scope)) return { kind: "discarded" };
          const failure = classifyMutationError(error);
          switch (failure.kind) {
            case "unauthenticated":
              unauthenticated();
              return { kind: "unauthenticated" };
            case "refused":
              return { kind: "rejected", failure: failure.failure };
            case "bad_request":
              return { kind: "rejected", failure: { kind: "error" } };
            case "not_found": {
              // The stop may have been removed elsewhere, or the trip may be gone: re-read to tell.
              const result = await reread(scope, epoch, "uncertain");
              if ("outcome" in result) return result.outcome;
              return result.trip.stops.some((s) => s.id === stop.id)
                ? { kind: "rejected", failure: { kind: "error" } }
                : { kind: "already_removed", stop, trip: result.trip };
            }
            default: {
              const result = await reread(scope, epoch, "uncertain");
              if ("outcome" in result) return result.outcome;
              return { kind: "uncertain_refreshed", trip: result.trip };
            }
          }
        }
        if (!isCurrent(epoch, scope)) return { kind: "discarded" };
        ownTransition.current = trip.version; // our confirmed removal: one increment
        const result = await reread(scope, epoch, "removed");
        if ("outcome" in result) return result.outcome;
        return { kind: "removed", stop, trip: result.trip };
      } finally {
        end(epoch);
      }
    },
    [begin, end, isCurrent, reread, unauthenticated],
  );

  const moveStop = useCallback(
    async (stopId: string, direction: MoveDirection): Promise<MutationOutcome> => {
      const current = stateRef.current;
      if (current.status !== "ready") return { kind: "ignored" };
      const stops = current.trip.stops;
      const index = stops.findIndex((s) => s.id === stopId);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= stops.length) return { kind: "ignored" };
      const started = begin("move");
      if (started === null) return { kind: "ignored" };
      const { scope, epoch, trip } = started;
      const stop = trip.stops[index]!;
      const order = trip.stops.map((s) => s.id);
      order[index] = order[target]!;
      order[target] = stop.id;
      try {
        let reordered: OwnerTrip;
        try {
          reordered = await reorderTripStops(trip.id, order, trip.version);
        } catch (error) {
          if (!isCurrent(epoch, scope)) return { kind: "discarded" };
          const failure = classifyMutationError(error);
          switch (failure.kind) {
            case "unauthenticated":
              unauthenticated();
              return { kind: "unauthenticated" };
            case "not_found":
              commit({ status: "not_found" });
              return { kind: "not_found" };
            case "refused":
              return { kind: "rejected", failure: failure.failure };
            case "version_conflict":
            case "bad_request": {
              const result = await reread(scope, epoch, "conflict");
              if ("outcome" in result) return result.outcome;
              return {
                kind: "conflict_refreshed",
                reason: failure.kind === "version_conflict" ? "version" : "stops",
                trip: result.trip,
              };
            }
            default: {
              const result = await reread(scope, epoch, "uncertain");
              if ("outcome" in result) return result.outcome;
              return { kind: "uncertain_refreshed", trip: result.trip };
            }
          }
        }
        if (!isCurrent(epoch, scope)) return { kind: "discarded" };
        ownTransition.current = trip.version; // our confirmed reorder: one increment
        commit({ status: "ready", trip: reordered });
        return { kind: "moved", stop, direction, trip: reordered };
      } finally {
        end(epoch);
      }
    },
    [begin, end, isCurrent, reread, unauthenticated, commit],
  );

  const addStop = useCallback(
    async (landmarkId: string, name: string): Promise<MutationOutcome> => {
      const current = stateRef.current;
      if (current.status !== "ready") return { kind: "ignored" };
      // Client-side eligibility only (the server decides): not already a member, not full.
      if (current.trip.stops.some((s) => s.landmark.id === landmarkId)) return { kind: "ignored" };
      if (current.trip.stops.length >= MAX_TRIP_STOPS) return { kind: "ignored" };
      const started = begin("add");
      if (started === null) return { kind: "ignored" };
      const { scope, epoch, trip } = started;
      const isIn = (t: OwnerTrip) => t.stops.some((s) => s.landmark.id === landmarkId);
      try {
        try {
          await addTripStop(trip.id, landmarkId);
        } catch (error) {
          if (!isCurrent(epoch, scope)) return { kind: "discarded" };
          if (error instanceof ApiError && error.status === 409) {
            const reason =
              error.code === TRIP_STOP_ALREADY_EXISTS
                ? "duplicate"
                : error.code === TRIP_STOP_LIMIT_REACHED
                  ? "full"
                  : null;
            if (reason !== null) {
              const result = await reread(scope, epoch, "conflict");
              if ("outcome" in result) return result.outcome;
              return { kind: "add_conflict", reason, landmarkId, name, trip: result.trip };
            }
          }
          const failure = classifyMutationError(error);
          switch (failure.kind) {
            case "unauthenticated":
              unauthenticated();
              return { kind: "unauthenticated" };
            case "refused":
              return { kind: "rejected", failure: failure.failure };
            case "bad_request":
              return { kind: "rejected", failure: { kind: "error" } };
            case "not_found": {
              // The trip may be gone, or the landmark cannot be added: a re-read tells which.
              const result = await reread(scope, epoch, "uncertain");
              if ("outcome" in result) return result.outcome;
              return { kind: "add_unavailable", landmarkId, name, trip: result.trip };
            }
            default: {
              const result = await reread(scope, epoch, "uncertain");
              if ("outcome" in result) return result.outcome;
              return {
                kind: "add_uncertain_refreshed",
                landmarkId,
                name,
                present: isIn(result.trip),
                trip: result.trip,
              };
            }
          }
        }
        if (!isCurrent(epoch, scope)) return { kind: "discarded" };
        ownTransition.current = trip.version; // our confirmed addition: one increment
        const result = await reread(scope, epoch, "added");
        if ("outcome" in result) return result.outcome;
        const stop = result.trip.stops.find((s) => s.landmark.id === landmarkId) ?? null;
        return { kind: "added", landmarkId, name, stop, trip: result.trip };
      } finally {
        end(epoch);
      }
    },
    [begin, end, isCurrent, reread, unauthenticated],
  );

  const rename = useCallback(
    async (name: string): Promise<MutationOutcome> => {
      const started = begin("rename");
      if (started === null) return { kind: "ignored" };
      const { scope, epoch, trip } = started;
      try {
        let renamed: OwnerTrip;
        try {
          renamed = await renameTrip(trip.id, name, trip.version);
        } catch (error) {
          if (!isCurrent(epoch, scope)) return { kind: "discarded" };
          if (
            error instanceof ApiError &&
            error.status === 400 &&
            NAME_MESSAGES.has(error.message)
          ) {
            return { kind: "rename_invalid", message: error.message };
          }
          const failure = classifyMutationError(error);
          switch (failure.kind) {
            case "unauthenticated":
              unauthenticated();
              return { kind: "unauthenticated" };
            case "not_found":
              commit({ status: "not_found" });
              return { kind: "not_found" };
            case "refused":
              return { kind: "rejected", failure: failure.failure };
            case "bad_request":
              return { kind: "rejected", failure: { kind: "error" } };
            case "version_conflict": {
              const result = await reread(scope, epoch, "conflict");
              if ("outcome" in result) return result.outcome;
              return { kind: "rename_conflict", trip: result.trip };
            }
            default: {
              const result = await reread(scope, epoch, "renamed");
              if ("outcome" in result) return result.outcome;
              return {
                kind: "rename_uncertain_refreshed",
                name,
                hasName: result.trip.name === name,
                trip: result.trip,
              };
            }
          }
        }
        if (!isCurrent(epoch, scope)) return { kind: "discarded" };
        ownTransition.current = trip.version; // our confirmed rename: one increment
        commit({ status: "ready", trip: renamed });
        return { kind: "renamed", trip: renamed };
      } finally {
        end(epoch);
      }
    },
    [begin, end, isCurrent, reread, unauthenticated, commit],
  );

  /** Terminal: no data, no lock, nothing outstanding; nothing can change this trip again. */
  const markDeleted = useCallback(() => {
    invalidate();
    commit({ status: "deleted" });
  }, [invalidate, commit]);

  const remove = useCallback(async (): Promise<MutationOutcome> => {
    const started = begin("delete");
    if (started === null) return { kind: "ignored" };
    const { scope, epoch, trip } = started;
    try {
      try {
        await deleteTripRequest(trip.id);
      } catch (error) {
        if (!isCurrent(epoch, scope)) return { kind: "discarded" };
        const failure = classifyMutationError(error);
        switch (failure.kind) {
          case "unauthenticated":
            unauthenticated();
            return { kind: "unauthenticated" };
          case "not_found":
            markDeleted();
            return { kind: "delete_unavailable" };
          case "refused":
            return { kind: "rejected", failure: failure.failure };
          case "bad_request":
            return { kind: "rejected", failure: { kind: "error" } };
          default: {
            const result = await reread(scope, epoch, "delete_uncertain");
            if ("outcome" in result) {
              if (result.outcome.kind !== "not_found") return result.outcome;
              markDeleted();
              return { kind: "delete_uncertain_gone" };
            }
            return { kind: "delete_uncertain_exists", trip: result.trip };
          }
        }
      }
      if (!isCurrent(epoch, scope)) return { kind: "discarded" };
      markDeleted();
      return { kind: "deleted", name: trip.name };
    } finally {
      end(epoch);
    }
  }, [begin, end, isCurrent, reread, unauthenticated, markDeleted]);

  /**
   * Enable or rotate sharing (Increment 4). The previously held link is
   * cleared as the change begins. The URL in the `200` is PROVISIONAL: it is
   * kept only in this function until the mandatory re-read (under the lock)
   * confirms it — sharing enabled, active, and the version exactly the
   * captured version + 1 (our change and nothing else). Only then is it held.
   * Otherwise it is dropped: it is never returned, rendered, or announced.
   */
  const enableSharing = useCallback(async (): Promise<MutationOutcome> => {
    const started = begin("share");
    if (started === null) return { kind: "ignored" };
    const { scope, epoch, trip } = started;
    const captured = trip.version;
    const rotated = trip.is_shared;
    clearLink();
    try {
      let provisional: string;
      try {
        provisional = await enableTripSharing(trip.id);
      } catch (error) {
        if (!isCurrent(epoch, scope)) return { kind: "discarded" };
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.code === TRIP_SHARING_UNAVAILABLE
        ) {
          const result = await reread(scope, epoch, "sharing_unavailable");
          if ("outcome" in result) return result.outcome;
          return { kind: "sharing_unavailable", trip: result.trip };
        }
        const failure = classifyMutationError(error);
        switch (failure.kind) {
          case "unauthenticated":
            unauthenticated();
            return { kind: "unauthenticated" };
          case "not_found":
            commit({ status: "not_found" });
            return { kind: "not_found" };
          case "refused":
            return { kind: "rejected", failure: failure.failure };
          case "bad_request":
            return { kind: "rejected", failure: { kind: "error" } };
          default: {
            const result = await reread(scope, epoch, "share_uncertain");
            if ("outcome" in result) return result.outcome;
            return { kind: "share_uncertain", active: result.trip.is_shared, trip: result.trip };
          }
        }
      }
      if (!isCurrent(epoch, scope)) return { kind: "discarded" };
      const result = await reread(scope, epoch, "shared");
      if ("outcome" in result) return result.outcome; // the provisional link is dropped
      const fresh = result.trip;
      if (!fresh.sharing_enabled || !fresh.is_shared) {
        return { kind: "share_unconfirmed", reason: "inactive", trip: fresh };
      }
      if (fresh.version !== captured + 1) {
        return { kind: "share_unconfirmed", reason: "version", trip: fresh };
      }
      linkRef.current = { url: provisional, version: fresh.version };
      setShareLink(provisional);
      return { kind: "share_created", rotated, trip: fresh };
    } finally {
      end(epoch);
    }
  }, [begin, end, isCurrent, reread, unauthenticated, commit, clearLink]);

  /** Turn sharing off (Increment 4). The held link is cleared as the change begins. */
  const revokeSharing = useCallback(async (): Promise<MutationOutcome> => {
    const started = begin("unshare");
    if (started === null) return { kind: "ignored" };
    const { scope, epoch, trip } = started;
    clearLink();
    try {
      try {
        await revokeTripSharing(trip.id);
      } catch (error) {
        if (!isCurrent(epoch, scope)) return { kind: "discarded" };
        const failure = classifyMutationError(error);
        switch (failure.kind) {
          case "unauthenticated":
            unauthenticated();
            return { kind: "unauthenticated" };
          case "not_found":
            commit({ status: "not_found" });
            return { kind: "not_found" };
          case "refused":
            return { kind: "rejected", failure: failure.failure };
          case "bad_request":
            return { kind: "rejected", failure: { kind: "error" } };
          default: {
            const result = await reread(scope, epoch, "share_uncertain");
            if ("outcome" in result) return result.outcome;
            return { kind: "revoke_uncertain", active: result.trip.is_shared, trip: result.trip };
          }
        }
      }
      if (!isCurrent(epoch, scope)) return { kind: "discarded" };
      const result = await reread(scope, epoch, "unshared");
      if ("outcome" in result) return result.outcome;
      return result.trip.is_shared
        ? { kind: "revoke_superseded", trip: result.trip }
        : { kind: "sharing_revoked", trip: result.trip };
    } finally {
      end(epoch);
    }
  }, [begin, end, isCurrent, reread, unauthenticated, commit, clearLink]);

  const verifiedUserId = session.status === "authenticated" ? session.user.id : null;

  useEffect(() => {
    if (verifiedUserId === null || tripId === undefined) {
      // Not verified (loading/unavailable), signed out, or no trip: hold nothing.
      scopeRef.current = null;
      invalidate();
      commit({ status: "idle" });
      return;
    }
    const current = scopeRef.current;
    if (current !== null && current.userId === verifiedUserId && current.tripId === tripId) return;
    const scope: Scope = { userId: verifiedUserId, tripId };
    scopeRef.current = scope;
    void load(scope);
  }, [verifiedUserId, tripId, load, invalidate, commit]);

  const retry = useCallback(() => {
    const scope = scopeRef.current;
    // A deleted trip is terminal: nothing is re-read for it.
    if (scope === null || stateRef.current.status === "deleted") return;
    void load(scope);
  }, [load]);

  return {
    state,
    pending,
    retry,
    removeStop,
    moveStop,
    addStop,
    renameTrip: rename,
    deleteTrip: remove,
    shareLink,
    isShareLinkCurrent,
    enableSharing,
    revokeSharing,
  };
}
