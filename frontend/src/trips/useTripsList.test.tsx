import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listTrips, type TripListPage } from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { useTripsList } from "./useTripsList";

/**
 * M05-T06 Increment 2 — `useTripsList` in isolation: the validated response's
 * own page and `has_more` are kept, the server's order is untouched, nothing
 * is requested without a verified user or a valid page, `reload` is explicit,
 * and nothing is written after unmount.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  listTrips: vi.fn(),
}));

const list = vi.mocked(listTrips);
const TIME = "2026-11-23T16:00:00.000Z";
const item = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `Trip ${n}`,
  stop_count: n,
  updated_at: TIME,
  is_shared: false,
});

function wrapperFor(session: SessionState) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  return ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
  );
}

const signedIn: SessionState = { status: "authenticated", user: TEST_USER };

beforeEach(() => list.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("useTripsList", () => {
  it("keeps the response's page, has_more, and order exactly", async () => {
    const trips = [item(9), item(2), item(5)];
    list.mockResolvedValueOnce({ trips, page: 2, limit: 20, has_more: true });
    const { result } = renderHook(() => useTripsList(2), { wrapper: wrapperFor(signedIn) });
    await act(async () => {});
    expect(result.current.state).toEqual({ status: "ready", trips, page: 2, hasMore: true });
    expect(list).toHaveBeenCalledWith({ page: 2, limit: 20 });
  });

  it.each<[string, SessionState, number | null]>([
    ["a loading session", { status: "loading" }, 1],
    ["an unavailable session", { status: "unavailable", retry: () => Promise.resolve() }, 1],
    ["a signed-out session", { status: "anonymous" }, 1],
    ["an invalid page", signedIn, null],
  ])("requests nothing for %s", (_label, session, page) => {
    const { result } = renderHook(() => useTripsList(page), { wrapper: wrapperFor(session) });
    expect(result.current.state).toEqual({ status: "idle" });
    act(() => result.current.reload());
    expect(list).not.toHaveBeenCalled();
  });

  it("reload re-requests the same page; nothing is retried automatically after a failure", async () => {
    list.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({
      trips: [item(1)],
      page: 1,
      limit: 20,
      has_more: false,
    });
    const { result } = renderHook(() => useTripsList(1), { wrapper: wrapperFor(signedIn) });
    await act(async () => {});
    expect(result.current.state).toEqual({ status: "error", failure: { kind: "error" } });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => result.current.reload());
    expect(result.current.state.status).toBe("ready");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("writes nothing after unmount", async () => {
    const pending = deferred<TripListPage>();
    list.mockReturnValueOnce(pending.promise);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useTripsList(1), {
      wrapper: wrapperFor(signedIn),
    });
    expect(result.current.state).toEqual({ status: "loading" });
    unmount();
    await act(async () =>
      pending.resolve({ trips: [item(1)], page: 1, limit: 20, has_more: false }),
    );
    expect(result.current.state).toEqual({ status: "loading" });
    expect(errors).not.toHaveBeenCalled();
  });
});
