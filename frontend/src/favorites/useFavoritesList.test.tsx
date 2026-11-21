import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { listFavorites, type FavoriteEntry, type FavoritesPage } from "../api/favorites";
import type { AuthUser } from "../api/auth";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { FAVORITES_PAGE_SIZE, useFavoritesList } from "./useFavoritesList";

/**
 * M03-T06 Increment 5 — `useFavoritesList`: request ordering, user isolation,
 * unverified sessions, 401/429, explicit retry, and the M5 re-fetch after a
 * confirmed removal (stale-response filtering, coalescing, failure).
 */

vi.mock("../api/favorites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/favorites")>()),
  listFavorites: vi.fn(),
}));

const list = vi.mocked(listFavorites);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function entry(n: number): FavoriteEntry {
  return { landmark_id: id(n), availability: "unavailable" };
}

function pageOf(ns: number[], hasMore = false, page = 1): FavoritesPage {
  return { favorites: ns.map(entry), page, limit: FAVORITES_PAGE_SIZE, has_more: hasMore };
}

const authenticated = (user: AuthUser = TEST_USER): SessionState => ({
  status: "authenticated",
  user,
});

function setup(initialSession: SessionState, initialPage: number | null = 1) {
  const refresh = vi.fn(() => Promise.resolve());
  let session = initialSession;
  const wrapper = ({ children }: { children: ReactNode }) => {
    const value: AuthContextValue = {
      session,
      checking: false,
      refresh,
      signOut: vi.fn(() => Promise.resolve()),
    };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  };
  const hook = renderHook(({ page }: { page: number | null }) => useFavoritesList(page), {
    wrapper,
    initialProps: { page: initialPage },
  });
  return {
    ...hook,
    refresh,
    setSession(next: SessionState, page: number | null = initialPage) {
      session = next;
      hook.rerender({ page });
    },
  };
}

function ids(state: ReturnType<typeof useFavoritesList>["state"]): string[] {
  return state.status === "ready" ? state.entries.map((e) => e.landmark_id) : [];
}

beforeEach(() => {
  list.mockReset();
});

describe("useFavoritesList — sessions and loading", () => {
  it.each<[string, SessionState]>([
    ["loading", { status: "loading" }],
    ["unavailable", { status: "unavailable", retry: () => Promise.resolve() }],
    ["anonymous", { status: "anonymous" }],
  ])("fetches nothing while the session is %s", (_label, session) => {
    const { result } = setup(session);
    expect(result.current.state).toEqual({ status: "idle" });
    expect(list).not.toHaveBeenCalled();
  });

  it("fetches nothing for an invalid page (null)", () => {
    const { result } = setup(authenticated(), null);
    expect(result.current.state).toEqual({ status: "idle" });
    expect(list).not.toHaveBeenCalled();
  });

  it("loads the requested page with 50 per page", async () => {
    const d = deferred<FavoritesPage>();
    list.mockReturnValueOnce(d.promise);
    const { result } = setup(authenticated(), 3);
    expect(result.current.state).toEqual({ status: "loading" });
    expect(list).toHaveBeenCalledWith({ page: 3, limit: 50 });
    await act(async () => d.resolve(pageOf([1, 2], true, 3)));
    expect(result.current.state).toEqual({
      status: "ready",
      entries: [entry(1), entry(2)],
      hasMore: true,
      refreshing: false,
      refreshFailure: null,
      emptiedByRemoval: false,
    });
  });

  it("a response for a page no longer requested never updates the state", async () => {
    const first = deferred<FavoritesPage>();
    const second = deferred<FavoritesPage>();
    list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = setup(authenticated(), 1);
    rerender({ page: 2 });
    expect(list).toHaveBeenLastCalledWith({ page: 2, limit: 50 });
    await act(async () => second.resolve(pageOf([20], false, 2)));
    await act(async () => first.resolve(pageOf([10], false, 1)));
    expect(ids(result.current.state)).toEqual([id(20)]);
  });

  it("discards a previous user's in-flight results and loads for the new user", async () => {
    const forA = deferred<FavoritesPage>();
    list.mockReturnValueOnce(forA.promise).mockResolvedValueOnce(pageOf([2]));
    const harness = setup(authenticated());
    harness.setSession(authenticated(OTHER_USER));
    await waitFor(() => expect(ids(harness.result.current.state)).toEqual([id(2)]));
    await act(async () => forA.resolve(pageOf([1])));
    expect(ids(harness.result.current.state)).toEqual([id(2)]);
  });

  it("a verified sign-out clears the list; a late response is discarded", async () => {
    const d = deferred<FavoritesPage>();
    list.mockReturnValueOnce(d.promise);
    const harness = setup(authenticated());
    harness.setSession({ status: "anonymous" });
    expect(harness.result.current.state).toEqual({ status: "idle" });
    await act(async () => d.resolve(pageOf([1])));
    expect(harness.result.current.state).toEqual({ status: "idle" });
  });

  it("an unverified session (loading/unavailable) keeps the loaded list and does not re-fetch", async () => {
    list.mockResolvedValueOnce(pageOf([1]));
    const harness = setup(authenticated());
    await waitFor(() => expect(ids(harness.result.current.state)).toEqual([id(1)]));
    harness.setSession({ status: "unavailable", retry: () => Promise.resolve() });
    harness.setSession(authenticated());
    expect(ids(harness.result.current.state)).toEqual([id(1)]);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("useFavoritesList — failures and retry", () => {
  it("401: error state and auth.refresh() only — the session is not changed here", async () => {
    list.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Sign in required."));
    const harness = setup(authenticated());
    await waitFor(() =>
      expect(harness.result.current.state).toEqual({
        status: "error",
        failure: { kind: "unauthenticated" },
      }),
    );
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("429 keeps Retry-After; nothing retries automatically", async () => {
    list.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "Slow down.", 30));
    const { result } = setup(authenticated());
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        failure: { kind: "rate-limited", retryAfterSeconds: 30 },
      }),
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("retry after a failed load fetches the same page again", async () => {
    list.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"));
    list.mockResolvedValueOnce(pageOf([1], false, 2));
    const { result } = setup(authenticated(), 2);
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(ids(result.current.state)).toEqual([id(1)]));
    expect(list).toHaveBeenLastCalledWith({ page: 2, limit: 50 });
  });
});

describe("useFavoritesList — confirmed removals and the M5 re-fetch", () => {
  async function ready(ns: number[], hasMore: boolean) {
    list.mockResolvedValueOnce(pageOf(ns, hasMore));
    const harness = setup(authenticated());
    await waitFor(() => expect(ids(harness.result.current.state)).toEqual(ns.map(id)));
    return harness;
  }

  it("removes the entry at once; no re-fetch on the last page (has_more false)", async () => {
    const { result } = await ready([1, 2], false);
    act(() => result.current.markRemoved(id(1)));
    expect(ids(result.current.state)).toEqual([id(2)]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("re-fetches the current page when later pages exist, keeping the list visible", async () => {
    const { result } = await ready([1, 2], true);
    const refetch = deferred<FavoritesPage>();
    list.mockReturnValueOnce(refetch.promise);
    act(() => result.current.markRemoved(id(1)));
    expect(ids(result.current.state)).toEqual([id(2)]);
    expect(result.current.state).toMatchObject({ status: "ready", refreshing: true });
    expect(list).toHaveBeenLastCalledWith({ page: 1, limit: 50 });
    await act(async () => refetch.resolve(pageOf([2, 3], false)));
    expect(ids(result.current.state)).toEqual([id(2), id(3)]);
    expect(result.current.state).toMatchObject({ refreshing: false, hasMore: false });
  });

  it("a stale response cannot restore a removal confirmed after it started; one queued re-fetch follows", async () => {
    const { result } = await ready([1, 2, 3], true);
    const first = deferred<FavoritesPage>();
    const second = deferred<FavoritesPage>();
    list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    act(() => result.current.markRemoved(id(1)));
    // Confirmed while the first re-fetch is in flight: queued, not sent yet.
    act(() => result.current.markRemoved(id(2)));
    act(() => result.current.markRemoved(id(3)));
    expect(list).toHaveBeenCalledTimes(2); // initial + one in flight
    // The first re-fetch started before 2 and 3 were removed and still lists them.
    await act(async () => first.resolve(pageOf([2, 3, 4], true)));
    expect(ids(result.current.state)).toEqual([id(4)]);
    expect(list).toHaveBeenCalledTimes(3); // exactly one queued re-fetch
    await act(async () => second.resolve(pageOf([4, 5], false)));
    expect(ids(result.current.state)).toEqual([id(4), id(5)]);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("a failed re-fetch keeps the list and confirmed removals, drops the queue, and offers retry", async () => {
    const { result, refresh } = await ready([1, 2, 3], true);
    const failing = deferred<FavoritesPage>();
    list.mockReturnValueOnce(failing.promise);
    act(() => result.current.markRemoved(id(1)));
    act(() => result.current.markRemoved(id(2)));
    await act(async () => failing.reject(new ApiError(429, "RATE_LIMITED", "Slow down.", 12)));
    expect(ids(result.current.state)).toEqual([id(3)]);
    expect(result.current.state).toMatchObject({
      refreshing: false,
      refreshFailure: { kind: "rate-limited", retryAfterSeconds: 12 },
    });
    expect(list).toHaveBeenCalledTimes(2); // queue dropped: no automatic retry
    expect(refresh).not.toHaveBeenCalled();

    list.mockResolvedValueOnce(pageOf([1, 2, 3, 4], false));
    act(() => result.current.retry());
    // Removals of 1 and 2 were confirmed before this request started, so the
    // server's answer is authoritative for them.
    await waitFor(() => expect(ids(result.current.state)).toEqual([id(1), id(2), id(3), id(4)]));
    expect(result.current.state).toMatchObject({ refreshFailure: null });
  });

  it("a re-fetch 401 asks the session to be re-checked and keeps the list", async () => {
    const { result, refresh } = await ready([1, 2], true);
    list.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "x"));
    act(() => result.current.markRemoved(id(1)));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ refreshFailure: { kind: "unauthenticated" } }),
    );
    expect(ids(result.current.state)).toEqual([id(2)]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("flags a page emptied by removals, but not one that was empty to begin with", async () => {
    const { result } = await ready([1], false);
    act(() => result.current.markRemoved(id(1)));
    expect(result.current.state).toMatchObject({ entries: [], emptiedByRemoval: true });

    list.mockResolvedValueOnce(pageOf([], false, 4));
    const other = setup(authenticated(), 4);
    await waitFor(() =>
      expect(other.result.current.state).toMatchObject({
        status: "ready",
        emptiedByRemoval: false,
      }),
    );
  });

  it("a removal of a landmark not on the page changes nothing and re-fetches nothing", async () => {
    const { result } = await ready([1], true);
    const before = result.current.state;
    act(() => result.current.markRemoved(id(9)));
    expect(result.current.state).toBe(before);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("a removal confirmed while a page is loading is filtered from that page's response", async () => {
    const d = deferred<FavoritesPage>();
    list.mockReturnValueOnce(d.promise);
    const { result } = setup(authenticated());
    act(() => result.current.markRemoved(id(1)));
    await act(async () => d.resolve(pageOf([1, 2])));
    expect(ids(result.current.state)).toEqual([id(2)]);
  });
});
