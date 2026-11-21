import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { DEFAULT_FAVORITES_LIMIT, listFavorites, type FavoriteEntry } from "../api/favorites";
import { useAuth } from "../auth/session";
import type { FavoritesFailure } from "./favoritesContext";

/** K7: My Favorites shows 50 entries per page. */
export const FAVORITES_PAGE_SIZE = DEFAULT_FAVORITES_LIMIT;

/**
 * One page of the signed-in user's favorites for the My Favorites page
 * (M03-T06 Increment 5; decisions K7, K12, M2, M5, M6).
 *
 * - `idle` — nothing to show: no verified signed-in user, or no valid page.
 * - `loading` — the requested page is being fetched for the first time.
 * - `error` — that first fetch failed; nothing is shown.
 * - `ready` — `entries` exactly as the API returned them (minus confirmed
 *   removals). `refreshing` is a quiet background re-fetch of the same page;
 *   `refreshFailure` is set when the latest one failed (the visible list is
 *   kept). `emptiedByRemoval` is true when a removal — or the re-fetch that
 *   followed one — left a previously non-empty page empty.
 */
export type FavoritesListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; failure: FavoritesFailure }
  | {
      status: "ready";
      entries: FavoriteEntry[];
      hasMore: boolean;
      refreshing: boolean;
      refreshFailure: FavoritesFailure | null;
      emptiedByRemoval: boolean;
    };

export interface FavoritesList {
  state: FavoritesListState;
  /** Explicit retry: a failed first load, or a failed background re-fetch. Never automatic. */
  retry: () => void;
  /**
   * Records a removal the SERVER CONFIRMED: the entry leaves the visible list
   * at once and can never be restored by a response to a request that started
   * before the confirmation. When later pages exist, the current page is then
   * re-fetched so entries from the next page move up (M5) — offset pagination
   * would otherwise skip them.
   */
  markRemoved: (landmarkId: string) => void;
}

interface Scope {
  userId: string;
  page: number;
}

function toFailure(error: unknown): FavoritesFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "unauthenticated" };
    if (error.status === 429) {
      return error.retryAfterSeconds === undefined
        ? { kind: "rate-limited" }
        : { kind: "rate-limited", retryAfterSeconds: error.retryAfterSeconds };
    }
    return { kind: "error", message: error.message };
  }
  return { kind: "error", message: "Couldn't load your favorites." };
}

/**
 * ORDERING. Every request carries a request number; only the latest request
 * for the CURRENT scope (verified user + page) may write, so a slow response
 * for an earlier page, an earlier request, or a previous user is dropped.
 *
 * REMOVALS. Each confirmed removal gets an operation number. A response is
 * filtered by the removals confirmed AFTER its request started, so a stale
 * response can never bring a removed entry back; removals confirmed before it
 * started are already reflected by the server and are forgotten.
 *
 * RE-FETCH COALESCING. At most one background re-fetch is in flight; removals
 * confirmed meanwhile queue exactly one more, started when it finishes. A
 * failed re-fetch drops the queue (no automatic retry; the page offers Retry).
 * No re-fetch is made when the page is known to be the last one (`has_more`
 * false): removing from the last page cannot shift any later entry.
 *
 * USER ISOLATION. As in `FavoritesProvider`, only the verified session state
 * moves the scope: `loading`/`unavailable` neither fetch nor clear (M6); a
 * verified sign-out or a different user discards everything. A 401 asks the
 * auth mechanism to re-check the session and does nothing else (K12).
 *
 * Memory only; nothing is logged or stored.
 */
export function useFavoritesList(page: number | null): FavoritesList {
  const { session, refresh: refreshSession } = useAuth();
  const [state, setState] = useState<FavoritesListState>({ status: "idle" });

  const scopeRef = useRef<Scope | null>(null);
  const requestSeq = useRef(0);
  const opSeq = useRef(0);
  const removedRef = useRef<{ userId: string | null; byId: Map<string, number> }>({
    userId: null,
    byId: new Map(),
  });
  /** Request number of the background re-fetch in flight, if any. */
  const backgroundRequest = useRef<number | null>(null);
  const refetchQueued = useRef(false);
  /** Last known `has_more` for the current scope. */
  const hasMoreRef = useRef(false);
  /** Landmark IDs currently in the visible list (mirrors `state.entries`). */
  const visibleRef = useRef(new Set<string>());

  const fetchPage = useCallback(
    async (scope: Scope, mode: "initial" | "background"): Promise<void> => {
      const requestId = ++requestSeq.current;
      const startOp = opSeq.current;
      const isLatest = () => scopeRef.current === scope && requestSeq.current === requestId;

      if (mode === "initial") {
        backgroundRequest.current = null;
        refetchQueued.current = false;
        visibleRef.current = new Set();
        setState({ status: "loading" });
      } else {
        backgroundRequest.current = requestId;
        setState((s) => (s.status === "ready" ? { ...s, refreshing: true } : s));
      }

      let result: Awaited<ReturnType<typeof listFavorites>>;
      try {
        result = await listFavorites({ page: scope.page, limit: FAVORITES_PAGE_SIZE });
      } catch (error) {
        if (!isLatest()) return;
        const failure = toFailure(error);
        backgroundRequest.current = null;
        refetchQueued.current = false;
        if (mode === "initial") {
          setState({ status: "error", failure });
        } else {
          setState((s) =>
            s.status === "ready" ? { ...s, refreshing: false, refreshFailure: failure } : s,
          );
        }
        if (failure.kind === "unauthenticated") void refreshSession();
        return;
      }
      if (!isLatest()) return;

      const removed = removedRef.current.byId;
      const entries = result.favorites.filter((entry) => {
        const seq = removed.get(entry.landmark_id);
        return seq === undefined || seq <= startOp;
      });
      for (const [id, seq] of removed) {
        if (seq <= startOp) removed.delete(id);
      }
      hasMoreRef.current = result.has_more;
      visibleRef.current = new Set(entries.map((entry) => entry.landmark_id));
      backgroundRequest.current = null;

      setState((s) => ({
        status: "ready",
        entries,
        hasMore: result.has_more,
        refreshing: false,
        refreshFailure: null,
        emptiedByRemoval:
          mode === "background" &&
          s.status === "ready" &&
          (s.emptiedByRemoval || s.entries.length > 0) &&
          entries.length === 0,
      }));

      if (refetchQueued.current) {
        refetchQueued.current = false;
        void fetchPage(scope, "background");
      }
    },
    [refreshSession],
  );

  // Scope follows the VERIFIED user and the requested page only.
  const verifiedUserId =
    session.status === "authenticated"
      ? session.user.id
      : session.status === "anonymous"
        ? null
        : undefined; // loading/unavailable: unverified — neither fetch nor clear

  useEffect(() => {
    if (verifiedUserId === undefined) return;
    if (verifiedUserId === null || page === null) {
      if (verifiedUserId === null) removedRef.current = { userId: null, byId: new Map() };
      if (scopeRef.current === null) return;
      scopeRef.current = null;
      backgroundRequest.current = null;
      refetchQueued.current = false;
      setState({ status: "idle" });
      return;
    }
    const current = scopeRef.current;
    if (current !== null && current.userId === verifiedUserId && current.page === page) return;
    if (removedRef.current.userId !== verifiedUserId) {
      removedRef.current = { userId: verifiedUserId, byId: new Map() };
    }
    const scope: Scope = { userId: verifiedUserId, page };
    scopeRef.current = scope;
    hasMoreRef.current = false;
    void fetchPage(scope, "initial");
  }, [verifiedUserId, page, fetchPage]);

  const requestRefetch = useCallback(() => {
    const scope = scopeRef.current;
    if (scope === null) return;
    if (backgroundRequest.current !== null && backgroundRequest.current === requestSeq.current) {
      refetchQueued.current = true;
      return;
    }
    void fetchPage(scope, "background");
  }, [fetchPage]);

  const markRemoved = useCallback(
    (landmarkId: string) => {
      const scope = scopeRef.current;
      const id = landmarkId.toLowerCase();
      if (scope === null || removedRef.current.userId !== scope.userId) return;
      // Recorded even when not visible, so an in-flight load cannot show it.
      removedRef.current.byId.set(id, ++opSeq.current);
      if (!visibleRef.current.delete(id)) return;
      setState((s) => {
        if (s.status !== "ready") return s;
        const entries = s.entries.filter((entry) => entry.landmark_id !== id);
        if (entries.length === s.entries.length) return s;
        return { ...s, entries, emptiedByRemoval: entries.length === 0 };
      });
      if (hasMoreRef.current) requestRefetch();
    },
    [requestRefetch],
  );

  const retry = useCallback(() => {
    const scope = scopeRef.current;
    if (scope === null) return;
    if (state.status === "error") {
      void fetchPage(scope, "initial");
    } else if (state.status === "ready" && state.refreshFailure !== null && !state.refreshing) {
      requestRefetch();
    }
  }, [state, fetchPage, requestRefetch]);

  return { state, retry, markRemoved };
}
