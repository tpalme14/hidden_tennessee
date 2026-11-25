import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import { getLandmarkGeoMarkers } from "../api/landmarks";
import type { LandmarkCollectionResponse } from "../api/types";
import type { OwnerTrip, TripStop } from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { useNearbyLandmarks } from "./useNearbyLandmarks";

/**
 * M05-T05 Increment 1 — `useNearbyLandmarks`: explicit activation, request
 * parameters, result processing, completeness flags, derived membership,
 * origin and session invalidation, stale responses, and failure states.
 */

vi.mock("../api/landmarks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/landmarks")>()),
  getLandmarkGeoMarkers: vi.fn(),
}));

const geo = vi.mocked(getLandmarkGeoMarkers);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TRIP = "11111111-1111-4111-8111-111111111111";

function stop(n: number, position: number, lat = 35.5 + n / 100, lng = -84.5): TripStop {
  return {
    id: id(n),
    position,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: id(100 + n),
      display_name: `Stop place ${n}`,
      category: "falls",
      latitude: lat,
      longitude: lng,
    },
  };
}

function hidden(n: number, position: number): TripStop {
  return {
    id: id(n),
    position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: id(100 + n), is_available: false },
  };
}

function tripOf(stops: TripStop[], tripId = TRIP): OwnerTrip {
  return {
    id: tripId,
    name: "Trip",
    version: 1,
    created_at: "2026-11-24T00:00:00.000Z",
    updated_at: "2026-11-24T00:00:00.000Z",
    is_shared: false,
    sharing_enabled: false,
    stops,
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
  };
}

function item(n: number, distance: number) {
  return {
    id: id(n),
    display_name: `Nearby ${n}`,
    category: "arch",
    latitude: 35.6,
    longitude: -84.6,
    distance_miles: distance,
  };
}

function page(
  items: ReturnType<typeof item>[],
  flags: { has_more?: boolean; is_truncated?: boolean } = {},
): LandmarkCollectionResponse {
  return {
    items,
    page: 1,
    limit: 200,
    has_more: flags.has_more ?? false,
    is_truncated: flags.is_truncated ?? false,
  };
}

const authenticated = (user: AuthUser = TEST_USER): SessionState => ({
  status: "authenticated",
  user,
});

/** Each call to the API returns a promise the test settles. */
function controlled() {
  const calls: ReturnType<typeof deferred<LandmarkCollectionResponse>>[] = [];
  geo.mockImplementation(() => {
    const d = deferred<LandmarkCollectionResponse>();
    calls.push(d);
    return d.promise;
  });
  return calls;
}

async function settle<T>(d: ReturnType<typeof deferred<T>>, value: T | Error) {
  await act(async () => {
    if (value instanceof Error) d.reject(value);
    else d.resolve(value);
    await Promise.resolve();
  });
}

function setup(initialTrip: OwnerTrip | null, initialSession: SessionState = authenticated()) {
  let session = initialSession;
  const wrapper = ({ children }: { children: ReactNode }) => {
    const value: AuthContextValue = {
      session,
      checking: false,
      refresh: vi.fn(() => Promise.resolve()),
      signOut: vi.fn(() => Promise.resolve()),
    };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  };
  const hook = renderHook(({ trip }: { trip: OwnerTrip | null }) => useNearbyLandmarks(trip), {
    wrapper,
    initialProps: { trip: initialTrip },
  });
  let currentTrip = initialTrip;
  return {
    ...hook,
    setTrip(next: OwnerTrip | null) {
      currentTrip = next;
      hook.rerender({ trip: next });
    },
    setSession(next: SessionState) {
      session = next;
      hook.rerender({ trip: currentTrip });
    },
  };
}

const ids = (r: ReturnType<typeof useNearbyLandmarks>) =>
  r.shown?.landmarks.map((l) => l.id) ?? null;

const BASE = tripOf([stop(1, 0), stop(2, 1), hidden(3, 2)]);

beforeEach(() => {
  geo.mockReset();
});

describe("activation and request parameters", () => {
  it("fetches nothing until a search is opened, and nothing for a trip change before that", () => {
    controlled();
    const { result, setTrip } = setup(BASE);
    setTrip(tripOf([stop(2, 0), stop(1, 1)]));
    expect(geo).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ kind: "closed", reason: null });
    expect(result.current.radius).toBe(25);
    expect(result.current.shown).toBeNull();
  });

  it("opens from an available stop with its exact coordinates, page 1 of 200, default radius 25", () => {
    controlled();
    const t = tripOf([stop(1, 0, 36.1234567, -85.7654321)]);
    const { result } = setup(t);
    let opened = false;
    act(() => {
      opened = result.current.open(id(1));
    });
    expect(opened).toBe(true);
    expect(geo).toHaveBeenCalledTimes(1);
    expect(geo).toHaveBeenCalledWith({
      q: "",
      categories: [],
      geo: { mode: "near", near: "36.1234567,-85.7654321", radius: 25 },
    });
    expect(result.current.status.kind).toBe("loading");
    expect(result.current.origin).toEqual({
      stopId: id(1),
      stopNumber: 1,
      displayName: "Stop place 1",
    });
  });

  it("refuses an unavailable or unknown stop, no trip, or an unverified session — with no request", () => {
    controlled();
    const { result, setTrip, setSession } = setup(BASE);
    act(() => {
      expect(result.current.open(id(3))).toBe(false);
      expect(result.current.open(id(9))).toBe(false);
    });
    setTrip(null);
    act(() => {
      expect(result.current.open(id(1))).toBe(false);
    });
    setTrip(BASE);
    for (const session of [
      { status: "loading" },
      { status: "anonymous" },
      { status: "unavailable", retry: () => Promise.resolve() },
    ] as SessionState[]) {
      setSession(session);
      act(() => {
        expect(result.current.open(id(1))).toBe(false);
      });
    }
    expect(geo).not.toHaveBeenCalled();
    expect(result.current.status.kind).toBe("closed");
  });

  it("requests each allowed radius and ignores any other value", () => {
    controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    for (const radius of [5, 10, 50, 100, 25]) {
      act(() => result.current.setRadius(radius));
      expect(geo).toHaveBeenLastCalledWith(
        expect.objectContaining({ geo: { mode: "near", near: "35.51,-84.5", radius } }),
      );
    }
    const before = geo.mock.calls.length;
    for (const radius of [0, 7, 30, 200, Number.NaN]) act(() => result.current.setRadius(radius));
    expect(geo).toHaveBeenCalledTimes(before);
    expect(result.current.radius).toBe(25);
  });

  it("a radius chosen before opening is used by the next search; nothing is fetched until then", () => {
    controlled();
    const { result } = setup(BASE);
    act(() => result.current.setRadius(10));
    expect(geo).not.toHaveBeenCalled();
    act(() => void result.current.open(id(2)));
    expect(geo).toHaveBeenCalledWith(
      expect.objectContaining({ geo: expect.objectContaining({ radius: 10 }) }),
    );
  });
});

describe("results and completeness", () => {
  it("success: server order kept, origin left out by ID, a landmark at the same point kept, zero distance kept", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, page([item(101, 0), item(7, 0), item(4, 0.02), item(5, 3)]));
    expect(result.current.status.kind).toBe("success");
    expect(ids(result.current)).toEqual([id(7), id(4), id(5)]);
    expect(result.current.shown?.landmarks[0]!.distance_miles).toBe(0);
    expect(result.current.shown?.isCurrent).toBe(true);
    expect(result.current.shown?.set.radius).toBe(25);
  });

  it("empty when only the origin came back — completeness flags still the server's", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, page([item(101, 0)], { has_more: true, is_truncated: true }));
    expect(result.current.status.kind).toBe("empty");
    expect(result.current.shown?.landmarks).toEqual([]);
    expect(result.current.shown?.set).toMatchObject({ hasMore: true, isTruncated: true });
  });

  it("leaves out malformed items and reports how many", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    const broken = { ...item(8, 1), latitude: 120 };
    await settle(calls[0]!, page([item(6, 1), broken as ReturnType<typeof item>]));
    expect(ids(result.current)).toEqual([id(6)]);
    expect(result.current.shown?.set.malformedCount).toBe(1);
  });

  it("an envelope of the wrong shape is an invalid_response error, with nothing shown", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, { ...page([item(6, 1)]), page: 2 });
    expect(result.current.status).toMatchObject({ kind: "error", failure: "invalid_response" });
    expect(result.current.shown).toBeNull();
  });
});

describe("trip membership (derived, no refetch)", () => {
  it("labels members with their current number and follows adds, removals, and reorders without a request", async () => {
    const calls = controlled();
    const { result, setTrip } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, page([item(102, 1), item(103, 2), item(9, 3)]));
    const members = () => result.current.shown!.landmarks.map((l) => l.inTrip?.stopNumber ?? null);
    expect(members()).toEqual([2, 3, null]);

    // Reorder: stop 2 first. The origin (stop 1) keeps its identity and is now Stop 2.
    setTrip(tripOf([stop(2, 0), stop(1, 1), hidden(3, 2)]));
    expect(members()).toEqual([1, 3, null]);
    expect(result.current.origin?.stopNumber).toBe(2);
    expect(result.current.status.kind).toBe("success");

    // Landmark 9 added as stop 4; stop 2 removed.
    const added: TripStop = {
      id: id(4),
      position: 2,
      is_available: true,
      distance_from_previous_miles: null,
      landmark: {
        id: id(9),
        display_name: "Nearby 9",
        category: "arch",
        latitude: 35.6,
        longitude: -84.6,
      },
    };
    setTrip(tripOf([stop(1, 0), hidden(3, 1), added]));
    expect(members()).toEqual([null, 2, 3]);
    expect(geo).toHaveBeenCalledTimes(1);
  });
});

describe("radius changes and previous results", () => {
  it("shows the previous results as `updating`, labelled with THEIR radius, until the new one lands", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, page([item(6, 4)]));
    act(() => result.current.setRadius(50));
    expect(result.current.status).toMatchObject({ kind: "updating", radius: 50 });
    expect(result.current.radius).toBe(50);
    expect(result.current.shown).toMatchObject({ isCurrent: false, set: { radius: 25 } });
    await settle(calls[1]!, page([item(6, 4), item(8, 40)], { is_truncated: true }));
    expect(result.current.status.kind).toBe("success");
    expect(result.current.shown).toMatchObject({
      isCurrent: true,
      set: { radius: 50, isTruncated: true },
    });
  });

  it("a failed radius change keeps the earlier results with their own radius; retry repeats the new radius", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, page([item(6, 4)]));
    act(() => result.current.setRadius(5));
    await settle(calls[1]!, new ApiError(500, "INTERNAL", "Server error"));
    expect(result.current.status).toMatchObject({ kind: "error", radius: 5, failure: "error" });
    expect(result.current.shown).toMatchObject({ isCurrent: false, set: { radius: 25 } });
    act(() => result.current.retry());
    expect(geo).toHaveBeenCalledTimes(3);
    expect(geo).toHaveBeenLastCalledWith(
      expect.objectContaining({ geo: expect.objectContaining({ radius: 5 }) }),
    );
    expect(result.current.status).toMatchObject({ kind: "updating", radius: 5 });
    await settle(calls[2]!, page([]));
    expect(result.current.status.kind).toBe("empty");
    expect(result.current.shown?.set.radius).toBe(5);
  });

  it("an older radius's late response never replaces the newer one", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    act(() => result.current.setRadius(100));
    await settle(calls[1]!, page([item(8, 60)]));
    await settle(calls[0]!, page([item(6, 4)]));
    expect(ids(result.current)).toEqual([id(8)]);
    expect(result.current.shown?.set.radius).toBe(100);
  });
});

describe("origin changes", () => {
  it("opening another stop clears the results at once and ignores the first origin's late response", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, page([item(6, 1)]));
    act(() => void result.current.open(id(2)));
    expect(result.current.status.kind).toBe("loading");
    expect(result.current.shown).toBeNull();
    act(() => void result.current.open(id(1)));
    act(() => void result.current.open(id(2)));
    await settle(calls[2]!, page([item(9, 1)]));
    expect(result.current.status.kind).toBe("loading");
    await settle(calls[3]!, page([item(102, 0), item(10, 2)]));
    expect(ids(result.current)).toEqual([id(10)]);
    expect(result.current.origin?.stopId).toBe(id(2));
  });

  it("reopening the same stop fetches fresh results", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, page([item(6, 1)]));
    act(() => result.current.close());
    expect(result.current.status).toEqual({ kind: "closed", reason: null });
    act(() => void result.current.open(id(1)));
    expect(geo).toHaveBeenCalledTimes(2);
    expect(result.current.shown).toBeNull();
    await settle(calls[1]!, page([item(7, 1)]));
    expect(ids(result.current)).toEqual([id(7)]);
  });

  it.each([
    ["origin_removed", () => tripOf([stop(2, 0), hidden(3, 1)])],
    ["origin_unavailable", () => tripOf([hidden(1, 0), stop(2, 1), hidden(3, 2)])],
    ["origin_changed", () => tripOf([stop(1, 0, 35.52), stop(2, 1), hidden(3, 2)])],
    ["trip_unavailable", () => null],
    ["trip_unavailable", () => tripOf(BASE.stops, "22222222-2222-4222-8222-222222222222")],
  ])(
    "closes with %s, drops the results, and ignores the pending response",
    async (reason, next) => {
      const calls = controlled();
      const { result, setTrip } = setup(BASE);
      act(() => void result.current.open(id(1)));
      await settle(calls[0]!, page([item(6, 1)]));
      act(() => result.current.setRadius(50));
      setTrip(next());
      expect(result.current.status).toEqual({ kind: "closed", reason });
      expect(result.current.shown).toBeNull();
      expect(result.current.origin).toBeNull();
      await settle(calls[1]!, page([item(8, 1)]));
      expect(result.current.status).toEqual({ kind: "closed", reason });
      act(() => result.current.retry());
      expect(geo).toHaveBeenCalledTimes(2);
    },
  );
});

describe("session", () => {
  it.each<[string, SessionState]>([
    ["loading", { status: "loading" }],
    ["anonymous", { status: "anonymous" }],
    ["unavailable", { status: "unavailable", retry: () => Promise.resolve() }],
    ["another user", authenticated(OTHER_USER)],
  ])(
    "clears everything when the session becomes %s, and ignores the pending response",
    async (_label, next) => {
      const calls = controlled();
      const { result, setSession } = setup(BASE);
      act(() => void result.current.open(id(1)));
      setSession(next);
      expect(result.current.status).toEqual({ kind: "closed", reason: "session_ended" });
      expect(result.current.shown).toBeNull();
      await settle(calls[0]!, page([item(6, 1)]));
      expect(result.current.status).toEqual({ kind: "closed", reason: "session_ended" });
    },
  );

  it("the same user verified again does not revive a closed search", async () => {
    const calls = controlled();
    const { result, setSession } = setup(BASE);
    act(() => void result.current.open(id(1)));
    setSession({ status: "loading" });
    setSession(authenticated());
    await settle(calls[0]!, page([item(6, 1)]));
    expect(result.current.status).toEqual({ kind: "closed", reason: "session_ended" });
    expect(geo).toHaveBeenCalledTimes(1);
  });
});

describe("failures, retry, close, unmount", () => {
  it.each<[string, Error]>([
    ["a network error", new ApiError(0, "NETWORK_ERROR", "offline")],
    ["a 429", new ApiError(429, "RATE_LIMITED", "Too many", 30)],
    ["a 400", new ApiError(400, "INVALID_QUERY", "bad")],
    ["an unexpected error", new TypeError("boom")],
  ])("%s is a generic error with nothing shown; retry fetches again", async (_label, error) => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    await settle(calls[0]!, error);
    expect(result.current.status).toEqual({
      kind: "error",
      origin: expect.objectContaining({ stopId: id(1) }),
      radius: 25,
      failure: "error",
    });
    expect(result.current.shown).toBeNull();
    act(() => result.current.retry());
    expect(result.current.status.kind).toBe("loading");
    await settle(calls[1]!, page([item(6, 1)]));
    expect(result.current.status.kind).toBe("success");
  });

  it("retry does nothing unless the latest request failed", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => result.current.retry());
    act(() => void result.current.open(id(1)));
    act(() => result.current.retry());
    await settle(calls[0]!, page([item(6, 1)]));
    act(() => result.current.retry());
    expect(geo).toHaveBeenCalledTimes(1);
  });

  it("close drops a pending response", async () => {
    const calls = controlled();
    const { result } = setup(BASE);
    act(() => void result.current.open(id(1)));
    act(() => result.current.close());
    await settle(calls[0]!, page([item(6, 1)]));
    expect(result.current.status).toEqual({ kind: "closed", reason: null });
  });

  it("a response after unmount writes nothing", async () => {
    const calls = controlled();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = setup(BASE);
    act(() => void result.current.open(id(1)));
    unmount();
    await settle(calls[0]!, page([item(6, 1)]));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
