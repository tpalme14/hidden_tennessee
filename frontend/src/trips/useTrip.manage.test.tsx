import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  addTripStop,
  deleteTrip,
  getTrip,
  removeTripStop,
  renameTrip,
  reorderTripStops,
  type OwnerTrip,
} from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { useTrip } from "./useTrip";

/**
 * M05-T06 Increment 3 — `useTrip`'s rename and delete in isolation: the
 * current version is sent, the terminal `deleted` state refuses every later
 * change (add, remove, move, rename, delete) and every re-read, and rename and
 * delete share the single change lock with add.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  renameTrip: vi.fn(),
  deleteTrip: vi.fn(),
  addTripStop: vi.fn(),
  removeTripStop: vi.fn(),
  reorderTripStops: vi.fn(),
}));

const get = vi.mocked(getTrip);
const rename = vi.mocked(renameTrip);
const del = vi.mocked(deleteTrip);
const add = vi.mocked(addTripStop);
const remove = vi.mocked(removeTripStop);
const reorder = vi.mocked(reorderTripStops);

const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TIME = "2026-11-23T16:00:00.000Z";
const LANDMARK = "11111111-1111-4111-8111-000000000099";

function trip(version = 3): OwnerTrip {
  return {
    id: TRIP_A,
    name: "Weekend",
    version,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops: [0, 1].map((i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      position: i,
      is_available: true as const,
      distance_from_previous_miles: null,
      landmark: {
        id: `11111111-1111-4111-8111-00000000000${i}`,
        display_name: `Falls ${i}`,
        category: "falls",
        latitude: 35.6,
        longitude: -83.5 + i,
      },
    })),
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 1 },
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
  expect(hook.result.current.state.status).toBe("ready");
  return hook;
}

beforeEach(() => {
  for (const mock of [get, rename, del, add, remove, reorder]) mock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("useTrip — rename and delete", () => {
  it("rename sends the name with the current version and returns the server's trip", async () => {
    const { result } = await ready(trip(11));
    rename.mockResolvedValueOnce({ ...trip(12), name: "Fall Loop" });
    let outcome;
    await act(async () => {
      outcome = await result.current.renameTrip("Fall Loop");
    });
    expect(rename).toHaveBeenCalledWith(TRIP_A, "Fall Loop", 11);
    expect(outcome).toMatchObject({ kind: "renamed" });
    expect(result.current.state).toMatchObject({ status: "ready", trip: { version: 12 } });
  });

  it("after a confirmed deletion every change and re-read is refused", async () => {
    const { result } = await ready();
    del.mockResolvedValueOnce(undefined);
    let outcome;
    await act(async () => {
      outcome = await result.current.deleteTrip();
    });
    expect(outcome).toEqual({ kind: "deleted", name: "Weekend" });
    expect(result.current.state).toEqual({ status: "deleted" });
    expect(result.current.pending).toBeNull();

    const attempts = await act(async () =>
      Promise.all([
        result.current.renameTrip("Again"),
        result.current.deleteTrip(),
        result.current.addStop(LANDMARK, "New"),
        result.current.removeStop("00000000-0000-4000-8000-000000000000"),
        result.current.moveStop("00000000-0000-4000-8000-000000000000", "down"),
      ]),
    );
    expect(attempts.map((o) => o.kind)).toEqual([
      "ignored",
      "ignored",
      "ignored",
      "ignored",
      "ignored",
    ]);
    act(() => result.current.retry());
    await act(async () => {});
    expect(get).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(reorder).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: "deleted" });
  });

  it("a 404 to the delete is 'unavailable' and also terminal", async () => {
    const { result } = await ready();
    del.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    let outcome;
    await act(async () => {
      outcome = await result.current.deleteTrip();
    });
    expect(outcome).toEqual({ kind: "delete_unavailable" });
    expect(result.current.state).toEqual({ status: "deleted" });
  });

  it("rename and delete share the lock with add (both directions)", async () => {
    const { result } = await ready();
    const adding = deferred<never>();
    add.mockReturnValueOnce(adding.promise);
    let addPromise!: Promise<unknown>;
    act(() => {
      addPromise = result.current.addStop(LANDMARK, "New");
    });
    const blocked = await act(async () =>
      Promise.all([result.current.renameTrip("X"), result.current.deleteTrip()]),
    );
    expect(blocked.map((o) => o.kind)).toEqual(["ignored", "ignored"]);
    get.mockResolvedValueOnce(trip(4));
    await act(async () => {
      adding.reject(new ApiError(429, "RATE_LIMITED", "x"));
      await addPromise;
    });

    const renaming = deferred<OwnerTrip>();
    rename.mockReturnValueOnce(renaming.promise);
    let renamePromise!: Promise<unknown>;
    act(() => {
      renamePromise = result.current.renameTrip("Y");
    });
    const alsoBlocked = await act(async () => result.current.addStop(LANDMARK, "New"));
    expect(alsoBlocked.kind).toBe("ignored");
    expect(add).toHaveBeenCalledTimes(1);
    await act(async () => {
      renaming.resolve({ ...trip(4), name: "Y" });
      await renamePromise;
    });
  });
});
