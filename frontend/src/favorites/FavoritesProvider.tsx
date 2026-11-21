import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { addFavorite, listFavorites, removeFavorite, MAX_FAVORITES_LIMIT } from "../api/favorites";
import { useAuth } from "../auth/session";
import {
  FavoritesContext,
  type FavoriteStatus,
  type FavoritesContextValue,
  type FavoritesFailure,
  type MembershipState,
  type RemoveOutcome,
  type SaveOutcome,
} from "./favoritesContext";

/** L1: at most five pages of 100 — never an unlimited fetch, never assumed complete at the cap. */
export const MEMBERSHIP_PAGE_SIZE = MAX_FAVORITES_LIMIT;
export const MEMBERSHIP_MAX_PAGES = 5;

/**
 * Saved-state provider (M03-T06 Increment 2; approved design K1, L1–L4, with
 * the developer's ordering and user-isolation requirements).
 *
 * MEMBERSHIP. For the verified signed-in user, pages of 100 favorites are
 * loaded one after another, up to five. A last page without `has_more` makes
 * membership `complete` (absent → known `unsaved`); reaching the cap makes it
 * `partial` and a failed page makes it `failed` (absent → `unknown`, never
 * `unsaved`). Nothing retries automatically and nothing reloads on focus (L3);
 * `retry`/`refresh` are explicit.
 *
 * ORDERING. Every confirmed save/removal is recorded as an override stamped
 * with a monotonically increasing operation number. Each list load records the
 * operation number current when it STARTED. An override newer than a load's
 * start always beats that load's data, so a stale list response can never
 * overwrite a newer confirmed mutation; an override no newer than the load's
 * start is superseded by what the newer list shows. Overlapping loads are
 * ordered by a load number: only the latest load may write.
 *
 * USER ISOLATION. All state belongs to a scope bound to one verified user ID.
 * A different user, or a verified sign-out, replaces the scope; every
 * in-flight list load and mutation checks its captured scope before writing,
 * so results for a previous user are discarded. `loading`/`unavailable`
 * session states (unverified) neither clear nor create a scope.
 *
 * 401. A favorites 401 asks the existing auth mechanism to re-check the
 * session (`refresh`). Only the verified answer from that check can end the
 * scope; this provider never treats a 401 as a sign-out on its own.
 *
 * Everything is held in memory only — no browser storage, no logging.
 */

interface Override {
  value: "saved" | "unsaved" | "unknown";
  /** Operation number at confirmation. */
  seq: number;
}

interface ScopeData {
  load: MembershipState;
  /** Landmarks the latest load has listed so far. */
  listed: ReadonlySet<string>;
  /** Operation number current when the latest load started. */
  loadStartSeq: number;
  overrides: ReadonlyMap<string, Override>;
  pending: ReadonlySet<string>;
}

interface Scope {
  userId: string;
}

const EMPTY_DATA: ScopeData = {
  load: { status: "inactive" },
  listed: new Set(),
  loadStartSeq: 0,
  overrides: new Map(),
  pending: new Set(),
};

function normalize(landmarkId: string): string {
  return landmarkId.toLowerCase();
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
  return { kind: "error", message: "Couldn't update favorites. Try again." };
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { session, refresh: refreshSession } = useAuth();
  const [data, setData] = useState<ScopeData>(EMPTY_DATA);
  const [scopeUserId, setScopeUserId] = useState<string | null>(null);

  const scopeRef = useRef<Scope | null>(null);
  const loadSeq = useRef(0);
  const opSeq = useRef(0);
  /** Synchronous in-flight guard (state updates are asynchronous). */
  const pendingRef = useRef(new Set<string>());

  const isCurrent = useCallback((scope: Scope) => scopeRef.current === scope, []);

  const startLoad = useCallback(
    async (scope: Scope): Promise<void> => {
      const loadId = ++loadSeq.current;
      const startSeq = opSeq.current;
      const isLatest = () => isCurrent(scope) && loadSeq.current === loadId;

      setData((d) => ({
        ...d,
        load: { status: "loading" },
        listed: new Set(),
        loadStartSeq: startSeq,
      }));

      const listed = new Set<string>();
      for (let page = 1; page <= MEMBERSHIP_MAX_PAGES; page += 1) {
        let result: Awaited<ReturnType<typeof listFavorites>>;
        try {
          result = await listFavorites({ page, limit: MEMBERSHIP_PAGE_SIZE });
        } catch (error) {
          if (!isLatest()) return;
          const failure = toFailure(error);
          setData((d) => ({ ...d, load: { status: "failed", failure } }));
          if (failure.kind === "unauthenticated") void refreshSession();
          return;
        }
        if (!isLatest()) return;

        for (const entry of result.favorites) listed.add(entry.landmark_id);
        const snapshot = new Set(listed);
        const done = !result.has_more;
        const status = done ? "complete" : page === MEMBERSHIP_MAX_PAGES ? "partial" : "loading";

        setData((d) => {
          // Overrides no newer than this load's start are superseded by the
          // list where it speaks: positively for listed landmarks, and for
          // every landmark once the list is complete.
          const overrides = new Map(d.overrides);
          for (const [id, override] of d.overrides) {
            if (override.seq <= startSeq && (snapshot.has(id) || status === "complete")) {
              overrides.delete(id);
            }
          }
          return { ...d, listed: snapshot, overrides, load: { status } };
        });
        if (done) return;
      }
    },
    [isCurrent, refreshSession],
  );

  // Scope follows the VERIFIED user only.
  const verifiedUserId =
    session.status === "authenticated"
      ? session.user.id
      : session.status === "anonymous"
        ? null
        : undefined; // loading/unavailable: unverified — leave the scope as it is

  useEffect(() => {
    if (verifiedUserId === undefined) return;
    if (verifiedUserId === null) {
      if (scopeRef.current === null) return;
      scopeRef.current = null;
      pendingRef.current = new Set();
      setScopeUserId(null);
      setData(EMPTY_DATA);
      return;
    }
    if (scopeRef.current?.userId === verifiedUserId) return;
    const scope: Scope = { userId: verifiedUserId };
    scopeRef.current = scope;
    pendingRef.current = new Set();
    setScopeUserId(verifiedUserId);
    setData(EMPTY_DATA);
    void startLoad(scope);
  }, [verifiedUserId, startLoad]);

  const setPending = useCallback((id: string, on: boolean) => {
    if (on) pendingRef.current.add(id);
    else pendingRef.current.delete(id);
    setData((d) => {
      const pending = new Set(d.pending);
      if (on) pending.add(id);
      else pending.delete(id);
      return { ...d, pending };
    });
  }, []);

  const recordOverride = useCallback((id: string, value: Override["value"]) => {
    const seq = ++opSeq.current;
    setData((d) => {
      const overrides = new Map(d.overrides);
      overrides.set(id, { value, seq });
      return { ...d, overrides };
    });
  }, []);

  const save = useCallback(
    async (landmarkId: string): Promise<SaveOutcome> => {
      const scope = scopeRef.current;
      if (scope === null) return { kind: "signed-out" };
      const id = normalize(landmarkId);
      if (pendingRef.current.has(id)) return { kind: "busy" };
      setPending(id, true);
      try {
        const result = await addFavorite(id);
        if (!isCurrent(scope)) return { kind: "discarded" };
        recordOverride(id, "saved");
        return { kind: "saved", created: result.created };
      } catch (error) {
        if (!isCurrent(scope)) return { kind: "discarded" };
        if (error instanceof ApiError && error.status === 404) {
          recordOverride(id, "unknown");
          return { kind: "not-saveable" };
        }
        const failure = toFailure(error);
        if (failure.kind === "unauthenticated") void refreshSession();
        return { kind: "failed", failure };
      } finally {
        if (isCurrent(scope)) setPending(id, false);
      }
    },
    [isCurrent, recordOverride, refreshSession, setPending],
  );

  const remove = useCallback(
    async (landmarkId: string): Promise<RemoveOutcome> => {
      const scope = scopeRef.current;
      if (scope === null) return { kind: "signed-out" };
      const id = normalize(landmarkId);
      if (pendingRef.current.has(id)) return { kind: "busy" };
      setPending(id, true);
      try {
        await removeFavorite(id);
        if (!isCurrent(scope)) return { kind: "discarded" };
        recordOverride(id, "unsaved");
        return { kind: "removed" };
      } catch (error) {
        if (!isCurrent(scope)) return { kind: "discarded" };
        const failure = toFailure(error);
        if (failure.kind === "unauthenticated") void refreshSession();
        return { kind: "failed", failure };
      } finally {
        if (isCurrent(scope)) setPending(id, false);
      }
    },
    [isCurrent, recordOverride, refreshSession, setPending],
  );

  const retry = useCallback(() => {
    const scope = scopeRef.current;
    if (scope === null || data.load.status === "loading") return;
    void startLoad(scope);
  }, [data.load.status, startLoad]);

  const refresh = useCallback(() => {
    const scope = scopeRef.current;
    if (scope === null) return;
    void startLoad(scope);
  }, [startLoad]);

  const sessionStatus = session.status;
  const statusOf = useCallback(
    (landmarkId: string): FavoriteStatus => {
      if (scopeUserId === null) {
        return sessionStatus === "loading" ? "checking" : "signed-out";
      }
      const id = normalize(landmarkId);
      const override = data.overrides.get(id);
      if (override) return override.value;
      if (data.listed.has(id)) return "saved";
      switch (data.load.status) {
        case "complete":
          return "unsaved";
        case "partial":
        case "failed":
          return "unknown";
        default:
          return "checking";
      }
    },
    [scopeUserId, sessionStatus, data],
  );

  const isPending = useCallback(
    (landmarkId: string) => data.pending.has(normalize(landmarkId)),
    [data.pending],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      membership: scopeUserId === null ? { status: "inactive" } : data.load,
      statusOf,
      isPending,
      save,
      remove,
      retry,
      refresh,
    }),
    [scopeUserId, data.load, statusOf, isPending, save, remove, retry, refresh],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}
