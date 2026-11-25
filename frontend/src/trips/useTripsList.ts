import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { listTrips, type TripListItem } from "../api/trips";
import { useAuth } from "../auth/session";
import { TRIPS_PAGE_SIZE } from "./tripsPageParam";
import type { TripFailure } from "./useTrip";

/**
 * One page of the signed-in user's trips for My Trips (M05-T06 Increment 2;
 * spec v1.1 §§5.2, 7.2, 10.1; decision D13).
 *
 * A READ SNAPSHOT, not an editor: nothing here changes a trip, nothing is
 * cached between views or mounts, and no trip detail is fetched for a row.
 * `trips` are exactly the validated server page, in the server's order
 * (`updated_at DESC, id DESC`); `page` and `hasMore` are the validated
 * response's own values — pagination is never inferred from item counts.
 *
 * States:
 * - `idle` — no verified signed-in user, or no valid page: nothing fetched,
 *   nothing held.
 * - `loading` — the page is being fetched; nothing from before is kept.
 * - `ready` — the validated page.
 * - `error` — the fetch failed (`unauthenticated`, `rate-limited`, `error`);
 *   nothing is kept.
 *
 * SESSION ISOLATION (as `useTrip`). The list follows the VERIFIED session
 * only: whenever the session is `loading`, `unavailable`, or `anonymous`, the
 * list is cleared and every outstanding request is invalidated, so no other
 * user's (or an unconfirmed user's) trips are ever shown; when a user is
 * verified again — even the same user — the page is fetched fresh.
 *
 * ORDERING. Every request carries a number; only the latest request for the
 * CURRENT scope (verified user + page) may write, and only while mounted. A
 * late response for an earlier page, request, or user is dropped.
 *
 * A 401 clears the list (an `error` state) and asks the auth mechanism to
 * re-check the session. No request is ever retried automatically: `reload`
 * is explicit (Try again, or the page-1 check after an uncertain create).
 */

export type TripsListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; failure: TripFailure }
  | { status: "ready"; trips: TripListItem[]; page: number; hasMore: boolean };

export interface TripsList {
  state: TripsListState;
  /** Fetches the current page again, fresh (shows `loading`). Does nothing without a scope. */
  reload: () => void;
}

interface Scope {
  userId: string;
  page: number;
}

function toFailure(error: unknown): TripFailure {
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

export function useTripsList(page: number | null): TripsList {
  const { session, refresh: refreshSession } = useAuth();
  const [state, setState] = useState<TripsListState>({ status: "idle" });

  const scopeRef = useRef<Scope | null>(null);
  const requestSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (scope: Scope): Promise<void> => {
      const requestId = ++requestSeq.current;
      const isLatest = () =>
        mounted.current && scopeRef.current === scope && requestSeq.current === requestId;
      setState({ status: "loading" });
      try {
        const result = await listTrips({ page: scope.page, limit: TRIPS_PAGE_SIZE });
        if (!isLatest()) return;
        setState({
          status: "ready",
          trips: result.trips,
          page: result.page,
          hasMore: result.has_more,
        });
      } catch (error) {
        if (!isLatest()) return;
        const failure = toFailure(error);
        setState({ status: "error", failure });
        if (failure.kind === "unauthenticated") void refreshSession();
      }
    },
    [refreshSession],
  );

  const verifiedUserId = session.status === "authenticated" ? session.user.id : null;

  useEffect(() => {
    if (verifiedUserId === null || page === null) {
      // Not verified (loading/unavailable), signed out, or an invalid page: hold nothing.
      scopeRef.current = null;
      requestSeq.current += 1;
      setState({ status: "idle" });
      return;
    }
    const current = scopeRef.current;
    if (current !== null && current.userId === verifiedUserId && current.page === page) return;
    const scope: Scope = { userId: verifiedUserId, page };
    scopeRef.current = scope;
    void load(scope);
  }, [verifiedUserId, page, load]);

  const reload = useCallback(() => {
    const scope = scopeRef.current;
    if (scope === null) return;
    void load(scope);
  }, [load]);

  return { state, reload };
}
