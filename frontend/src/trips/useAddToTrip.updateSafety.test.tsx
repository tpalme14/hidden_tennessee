import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  addTripStop,
  createTrip,
  getTrip,
  listTrips,
  type AddedTripStop,
  type OwnerTrip,
  type TripListPage,
} from "../api/trips";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { updateSafety } from "../pwa/updateSafety";
import { useAddToTrip } from "./useAddToTrip";

/**
 * M06-T02 Increment 4b-i — `useAddToTrip`'s update-safety hold. An action
 * holds from `begin()` to `end()`, so the gate cannot be acquired between
 * create and add, or between the verifying read and the add. While a
 * transition owns the gate, an action is refused before any side effect.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  listTrips: vi.fn(),
  addTripStop: vi.fn(),
  createTrip: vi.fn(),
  getTrip: vi.fn(),
}));

const list = vi.mocked(listTrips);
const add = vi.mocked(addTripStop);
const create = vi.mocked(createTrip);
const read = vi.mocked(getTrip);

const LANDMARK = "11111111-1111-4111-8111-000000000001";
const OTHER_LANDMARK = "11111111-1111-4111-8111-000000000002";
const TRIP_7 = "00000000-0000-4000-8000-000000000007";
const TIME = "2026-11-23T16:00:00.000Z";

const emptyPage: TripListPage = { trips: [], page: 1, limit: 100, has_more: false };
function ownerTrip(id: string, stops: OwnerTrip["stops"] = []): OwnerTrip {
  return {
    id,
    name: "Smokies Loop",
    version: 0,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops,
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
  };
}
function addedStop(): AddedTripStop {
  return {
    id: "00000000-0000-4000-8000-000000000900",
    position: 0,
    is_available: true,
    landmark: {
      id: LANDMARK,
      display_name: "Falls",
      category: "falls",
      latitude: 35,
      longitude: -85,
    },
  };
}

const wrapper = ({ children }: { children: ReactNode }) => {
  const auth: AuthContextValue = {
    session: { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

async function openPicker(landmarkId = LANDMARK) {
  list.mockResolvedValue(emptyPage);
  const hook = renderHook(({ id }: { id: string }) => useAddToTrip(id, true), {
    wrapper,
    initialProps: { id: landmarkId },
  });
  await act(async () => {});
  return hook;
}

function gateAttempt(): string {
  const result = updateSafety.tryAcquireGate();
  if (result.kind === "acquired") result.gate.release();
  return result.kind;
}
const holds = () => updateSafety.getSnapshot().operationHolds;

beforeEach(() => {
  for (const mock of [list, add, create, read]) mock.mockReset();
});
afterEach(() => {
  // Unmount first, so every hook has released its registrations (4b-ii).
  cleanup();
  expect(updateSafety.getSnapshot()).toMatchObject({
    pendingRequests: 0,
    operationHolds: 0,
    gateHeld: false,
    protectedCategories: [],
  });
});

describe("useAddToTrip — the hold spans every step of an action", () => {
  it("create-then-add: the gate cannot be acquired between the create response and the add request", async () => {
    const { result } = await openPicker();
    const seen: string[] = [];
    create.mockImplementation(async () => {
      seen.push(`create: holds ${holds()}, gate ${gateAttempt()}`);
      return ownerTrip(TRIP_7);
    });
    add.mockImplementation(async () => {
      seen.push(`add: holds ${holds()}, gate ${gateAttempt()}`);
      return addedStop();
    });
    await act(async () => {
      await result.current.createAndAdd("Smokies Loop");
    });
    expect(seen).toEqual(["create: holds 1, gate busy", "add: holds 1, gate busy"]);
    expect(result.current.feedback).toMatchObject({ kind: "added", created: true });
    expect(holds()).toBe(0);
  });

  it("verify-then-add: the gate cannot be acquired between the verifying read and the add", async () => {
    const { result } = await openPicker();
    create.mockResolvedValueOnce(ownerTrip(TRIP_7));
    add.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x")); // uncertain → verify on retry
    await act(async () => {
      await result.current.createAndAdd("Smokies Loop");
    });
    expect(result.current.feedback).toMatchObject({ kind: "partial", reason: "uncertain" });
    expect(holds()).toBe(0);

    const seen: string[] = [];
    read.mockImplementationOnce(async () => {
      seen.push(`verify: gate ${gateAttempt()}`);
      return ownerTrip(TRIP_7);
    });
    add.mockImplementationOnce(async () => {
      seen.push(`add: gate ${gateAttempt()}`);
      return addedStop();
    });
    await act(async () => {
      await result.current.retryAdd();
    });
    expect(seen).toEqual(["verify: gate busy", "add: gate busy"]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => void]>([
    [
      "a create refusal",
      () => create.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x")),
    ],
    [
      "an uncertain create",
      () => create.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x")),
    ],
    ["an unexpected exception", () => create.mockRejectedValueOnce(new Error("unexpected"))],
    [
      "a failed add after the create",
      () => {
        create.mockResolvedValueOnce(ownerTrip(TRIP_7));
        add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
      },
    ],
  ])("releases after %s", async (_label, arrange) => {
    const { result } = await openPicker();
    arrange();
    await act(async () => {
      await result.current.createAndAdd("Smokies Loop");
    });
    expect(holds()).toBe(0);
    expect(result.current.action).toBeNull();
  });
});

describe("useAddToTrip — refusal while a transition owns the gate", () => {
  it("create-and-add and retry are refused before any side effect: no request, feedback kept, no action", async () => {
    const { result } = await openPicker();
    create.mockResolvedValueOnce(ownerTrip(TRIP_7));
    add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
    await act(async () => {
      await result.current.createAndAdd("Smokies Loop");
    });
    const feedbackBefore = result.current.feedback;
    expect(feedbackBefore).toMatchObject({ kind: "partial" });
    create.mockReset();
    add.mockReset();

    const gate = updateSafety.tryAcquireGate();
    if (gate.kind !== "acquired") throw new Error("expected the gate");
    // Released in `finally`, so a failure here cannot leak the gate into later tests.
    try {
      await act(async () => {
        await result.current.createAndAdd("Another");
        await result.current.retryAdd();
      });
      expect(create).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(result.current.feedback).toBe(feedbackBefore); // not cleared
      expect(result.current.pendingTrip).toMatchObject({ id: TRIP_7 }); // retry target kept
      expect(result.current.action).toBeNull();
      expect(holds()).toBe(0);
    } finally {
      gate.gate.release();
    }
  });
});

describe("useAddToTrip — clearAll and stale actions", () => {
  it("clearAll releases the hold; the stale action's late cleanup cannot release a newer action's hold", async () => {
    const { result, rerender } = await openPicker();
    const staleCreate = deferred<OwnerTrip>();
    create.mockReturnValueOnce(staleCreate.promise);
    let first: Promise<unknown>;
    act(() => {
      first = result.current.createAndAdd("Stale");
    });
    expect(holds()).toBe(1);

    // A different landmark clears everything (a new scope epoch).
    await act(async () => {
      rerender({ id: OTHER_LANDMARK });
    });
    expect(holds()).toBe(0);

    const newerCreate = deferred<OwnerTrip>();
    create.mockReturnValueOnce(newerCreate.promise);
    let second: Promise<unknown>;
    act(() => {
      second = result.current.createAndAdd("Newer");
    });
    expect(holds()).toBe(1);

    // The stale create finishes: no add is attempted, and the newer hold stays.
    await act(async () => {
      staleCreate.resolve(ownerTrip(TRIP_7));
      await first;
    });
    expect(add).not.toHaveBeenCalled();
    expect(holds()).toBe(1);
    expect(gateAttempt()).toBe("busy");

    add.mockResolvedValueOnce(addedStop());
    await act(async () => {
      newerCreate.resolve(ownerTrip(TRIP_7));
      await second;
    });
    expect(holds()).toBe(0);
  });

  it("unmounting mid-action: the hold lasts until the action settles, then is released", async () => {
    const { result, unmount } = await openPicker();
    const pendingCreate = deferred<OwnerTrip>();
    create.mockReturnValueOnce(pendingCreate.promise);
    let action: Promise<unknown>;
    act(() => {
      action = result.current.createAndAdd("Smokies Loop");
    });
    unmount();
    expect(holds()).toBe(1);
    await act(async () => {
      pendingCreate.resolve(ownerTrip(TRIP_7));
      await action;
    });
    expect(add).not.toHaveBeenCalled(); // unmounted: no further step
    expect(holds()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M06-T02 Increment 4b-ii — the unfinished-retry state as protected information.
// ---------------------------------------------------------------------------

function atHoldRelease() {
  const seen: string[][] = [];
  let holdsBefore = updateSafety.getSnapshot().operationHolds;
  const unsubscribe = updateSafety.subscribe(() => {
    const now = updateSafety.getSnapshot();
    if (holdsBefore > 0 && now.operationHolds === 0) seen.push([...now.protectedCategories]);
    holdsBefore = now.operationHolds;
  });
  return { seen, stop: unsubscribe };
}
const retryCategories = () =>
  updateSafety.getSnapshot().protectedCategories.filter((c) => c === "unfinished-trip-add");

describe("useAddToTrip — the unfinished retry state is protected (4b-ii)", () => {
  it("a partial create-then-add is registered before the action's hold is released; no identifiers reach the registry", async () => {
    const { result } = await openPicker();
    create.mockResolvedValueOnce(ownerTrip(TRIP_7));
    add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
    const observer = atHoldRelease();
    await act(async () => {
      await result.current.createAndAdd("Smokies Loop");
    });
    observer.stop();
    expect(result.current.pendingTrip).toMatchObject({ id: TRIP_7 });
    expect(observer.seen).toEqual([["unfinished-trip-add"]]);
    const text = JSON.stringify(updateSafety.getSnapshot());
    expect(text).not.toContain(TRIP_7);
    expect(text).not.toContain(LANDMARK);
  });

  it("an uncertain add to an existing trip (verify-first marker) is registered", async () => {
    list.mockResolvedValue({
      ...emptyPage,
      trips: [
        { id: TRIP_7, name: "Smokies Loop", stop_count: 0, updated_at: TIME, is_shared: false },
      ],
    });
    const { result } = renderHook(() => useAddToTrip(LANDMARK, true), { wrapper });
    await act(async () => {});
    act(() => result.current.select(TRIP_7));
    add.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    await act(async () => {
      await result.current.addToSelected();
    });
    expect(result.current.feedback).toMatchObject({ kind: "add_uncertain" });
    expect(retryCategories()).toEqual(["unfinished-trip-add"]);
  });

  it("a failed retry keeps it; a successful retry removes it", async () => {
    const { result } = await openPicker();
    create.mockResolvedValueOnce(ownerTrip(TRIP_7));
    add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
    await act(async () => {
      await result.current.createAndAdd("Smokies Loop");
    });
    add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
    await act(async () => {
      await result.current.retryAdd();
    });
    expect(retryCategories()).toEqual(["unfinished-trip-add"]);
    add.mockResolvedValueOnce(addedStop());
    await act(async () => {
      await result.current.retryAdd();
    });
    expect(result.current.pendingTrip).toBeNull();
    expect(retryCategories()).toEqual([]);
  });

  it("clearing everything (another landmark) removes it; a stale action cannot remove a newer registration", async () => {
    const { result, rerender } = await openPicker();
    const staleCreate = deferred<OwnerTrip>();
    create.mockReturnValueOnce(staleCreate.promise);
    let first: Promise<unknown>;
    act(() => {
      first = result.current.createAndAdd("Stale");
    });
    await act(async () => {
      rerender({ id: OTHER_LANDMARK });
    });
    // A newer action ends partially: registered.
    create.mockResolvedValueOnce(ownerTrip(TRIP_7));
    add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
    await act(async () => {
      await result.current.createAndAdd("Newer");
    });
    expect(retryCategories()).toEqual(["unfinished-trip-add"]);
    // The stale action finishes: it touches nothing.
    await act(async () => {
      staleCreate.resolve(ownerTrip(TRIP_7));
      await first;
    });
    expect(retryCategories()).toEqual(["unfinished-trip-add"]);
    await act(async () => {
      rerender({ id: LANDMARK });
    });
    expect(retryCategories()).toEqual([]);
  });

  it("unmount releases it; StrictMode keeps exactly one", async () => {
    list.mockResolvedValue(emptyPage);
    const strictWrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{wrapper({ children })}</StrictMode>
    );
    const { result, unmount } = renderHook(() => useAddToTrip(LANDMARK, true), {
      wrapper: strictWrapper,
    });
    await act(async () => {});
    create.mockResolvedValueOnce(ownerTrip(TRIP_7));
    add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
    await act(async () => {
      await result.current.createAndAdd("Smokies Loop");
    });
    expect(retryCategories()).toEqual(["unfinished-trip-add"]);
    unmount();
    expect(retryCategories()).toEqual([]);
  });
});
