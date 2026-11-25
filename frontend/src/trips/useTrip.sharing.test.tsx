import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  addTripStop,
  deleteTrip,
  enableTripSharing,
  getTrip,
  revokeTripSharing,
  type OwnerTrip,
} from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { useTrip } from "./useTrip";

/**
 * M05-T06 Increment 4 — `useTrip`'s sharing in isolation: a received link is
 * held only when the mandatory re-read confirms it at exactly the captured
 * version + 1 with sharing enabled and active; deletion and unmount drop it;
 * add and the sharing changes share the lock in both directions.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  enableTripSharing: vi.fn(),
  revokeTripSharing: vi.fn(),
  addTripStop: vi.fn(),
  deleteTrip: vi.fn(),
}));

const get = vi.mocked(getTrip);
const enable = vi.mocked(enableTripSharing);
const revoke = vi.mocked(revokeTripSharing);
const add = vi.mocked(addTripStop);
const del = vi.mocked(deleteTrip);

const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TIME = "2026-11-23T16:00:00.000Z";
const URL_1 = `https://share.example.test/shared/trips/${"C".repeat(43)}`;
const LANDMARK = "11111111-1111-4111-8111-000000000099";

function trip(extra: Partial<OwnerTrip> = {}): OwnerTrip {
  return {
    id: TRIP_A,
    name: "Weekend",
    version: 3,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops: [],
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
    ...extra,
  };
}

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

async function ready(initial = trip()) {
  get.mockResolvedValueOnce(initial);
  const hook = renderHook(() => useTrip(TRIP_A), {
    wrapper: wrapperFor({ status: "authenticated", user: TEST_USER }),
  });
  await act(async () => {});
  return hook;
}

beforeEach(() => {
  for (const mock of [get, enable, revoke, add, del]) mock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("useTrip — share-link confirmation", () => {
  it.each<[string, Partial<OwnerTrip>, boolean]>([
    ["captured + 1, enabled and active", { version: 4, is_shared: true }, true],
    ["the same version", { version: 3, is_shared: true }, false],
    ["captured + 2", { version: 5, is_shared: true }, false],
    ["inactive", { version: 4, is_shared: false }, false],
    ["disabled", { version: 4, is_shared: true, sharing_enabled: false }, false],
  ])("a re-read at %s → link held: %s", async (_label, reread, held) => {
    const { result } = await ready();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip(reread));
    let outcome;
    await act(async () => {
      outcome = await result.current.enableSharing();
    });
    expect(result.current.shareLink).toBe(held ? URL_1 : null);
    expect(result.current.isShareLinkCurrent(URL_1)).toBe(held);
    expect(outcome).toMatchObject({ kind: held ? "share_created" : "share_unconfirmed" });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("the link is never exposed while the re-read is pending", async () => {
    const { result } = await ready();
    const reread = deferred<OwnerTrip>();
    enable.mockResolvedValueOnce(URL_1);
    get.mockReturnValueOnce(reread.promise);
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.enableSharing();
    });
    await act(async () => {});
    expect(enable).toHaveBeenCalledTimes(1);
    expect(result.current.shareLink).toBeNull();
    expect(result.current.pending).toBe("refresh");
    await act(async () => {
      reread.resolve(trip({ version: 4, is_shared: true }));
      await pending;
    });
    expect(result.current.shareLink).toBe(URL_1);
  });

  it("deletion drops the held link", async () => {
    const { result } = await ready();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    await act(async () => {
      await result.current.enableSharing();
    });
    expect(result.current.shareLink).toBe(URL_1);
    del.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.deleteTrip();
    });
    expect(result.current.shareLink).toBeNull();
    expect(result.current.isShareLinkCurrent(URL_1)).toBe(false);
  });

  it("a share response after unmount holds nothing", async () => {
    const { result, unmount } = await ready();
    const request = deferred<string>();
    enable.mockReturnValueOnce(request.promise);
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.enableSharing();
    });
    unmount();
    await act(async () => {
      request.resolve(URL_1);
      await pending;
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.isShareLinkCurrent(URL_1)).toBe(false);
  });

  it("an uncertain revoke is never re-sent", async () => {
    const { result } = await ready(trip({ is_shared: true }));
    revoke.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockResolvedValueOnce(trip({ is_shared: true }));
    let outcome;
    await act(async () => {
      outcome = await result.current.revokeSharing();
    });
    expect(outcome).toMatchObject({ kind: "revoke_uncertain", active: true });
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

describe("useTrip — sharing and the single change lock", () => {
  it("a pending add blocks enable and revoke; a pending enable blocks add", async () => {
    const { result } = await ready();
    const adding = deferred<never>();
    add.mockReturnValueOnce(adding.promise);
    let addPromise!: Promise<unknown>;
    act(() => {
      addPromise = result.current.addStop(LANDMARK, "New");
    });
    const blocked = await act(async () =>
      Promise.all([result.current.enableSharing(), result.current.revokeSharing()]),
    );
    expect(blocked.map((o) => o.kind)).toEqual(["ignored", "ignored"]);
    expect(enable).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => {
      adding.reject(new ApiError(429, "RATE_LIMITED", "x"));
      await addPromise;
    });

    const request = deferred<string>();
    enable.mockReturnValueOnce(request.promise);
    let enablePromise!: Promise<unknown>;
    act(() => {
      enablePromise = result.current.enableSharing();
    });
    const alsoBlocked = await act(async () => result.current.addStop(LANDMARK, "New"));
    expect(alsoBlocked.kind).toBe("ignored");
    expect(add).toHaveBeenCalledTimes(1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    await act(async () => {
      request.resolve(URL_1);
      await enablePromise;
    });
  });
});
