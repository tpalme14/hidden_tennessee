import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  addTripStop,
  enableTripSharing,
  getTrip,
  revokeTripSharing,
  type AddedTripStop,
  type OwnerTrip,
} from "../api/trips";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { updateSafety } from "../pwa/updateSafety";
import { useTrip } from "./useTrip";

/**
 * M06-T02 Increment 4b-i — `useTrip`'s update-safety hold. A change holds
 * from `begin()` until its required re-read has finished, so the transition
 * gate cannot be acquired in the gap between a mutation response and the
 * re-read (the API module is mocked, so the request counter stays at zero
 * there: only the hold protects that gap). While a transition owns the gate,
 * a change is refused before any side effect.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  enableTripSharing: vi.fn(),
  revokeTripSharing: vi.fn(),
  addTripStop: vi.fn(),
}));

const get = vi.mocked(getTrip);
const enable = vi.mocked(enableTripSharing);
const revoke = vi.mocked(revokeTripSharing);
const add = vi.mocked(addTripStop);

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

async function ready(initial = trip()) {
  get.mockResolvedValueOnce(initial);
  const hook = renderHook(() => useTrip(TRIP_A), { wrapper });
  await act(async () => {});
  return hook;
}

/** Tries to acquire the gate at this exact moment; releases it again if acquired. */
function gateAttempt(): string {
  const result = updateSafety.tryAcquireGate();
  if (result.kind === "acquired") result.gate.release();
  return result.kind;
}
const holds = () => updateSafety.getSnapshot().operationHolds;

beforeEach(() => {
  for (const mock of [get, enable, revoke, add]) mock.mockReset();
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

describe("useTrip — the hold spans each change and its required re-read", () => {
  it("share: the gate cannot be acquired between the share response and the confirming re-read", async () => {
    const { result } = await ready();
    const seen: string[] = [];
    enable.mockImplementation(async () => {
      seen.push(`share request: holds ${holds()}, gate ${gateAttempt()}`);
      return URL_1;
    });
    get.mockImplementationOnce(async () => {
      seen.push(`re-read: holds ${holds()}, gate ${gateAttempt()}`);
      return trip({ version: 4, is_shared: true });
    });
    await act(async () => {
      await result.current.enableSharing();
    });
    expect(seen).toEqual(["share request: holds 1, gate busy", "re-read: holds 1, gate busy"]);
    expect(result.current.shareLink).toBe(URL_1);
    expect(holds()).toBe(0);
  });

  it("rotation and revocation hold through their re-reads too", async () => {
    const { result } = await ready(trip({ is_shared: true }));
    const seen: string[] = [];
    enable.mockResolvedValueOnce(URL_1);
    get.mockImplementationOnce(async () => {
      seen.push(`rotate re-read: gate ${gateAttempt()}`);
      return trip({ version: 4, is_shared: true });
    });
    await act(async () => {
      await result.current.enableSharing();
    });
    revoke.mockResolvedValueOnce(undefined);
    get.mockImplementationOnce(async () => {
      seen.push(`revoke re-read: gate ${gateAttempt()}`);
      return trip({ version: 5, is_shared: false });
    });
    await act(async () => {
      await result.current.revokeSharing();
    });
    expect(seen).toEqual(["rotate re-read: gate busy", "revoke re-read: gate busy"]);
  });

  it("a trip change (add stop) holds through its re-read", async () => {
    const { result } = await ready();
    const seen: string[] = [];
    add.mockResolvedValueOnce(addedStop());
    get.mockImplementationOnce(async () => {
      seen.push(`re-read: gate ${gateAttempt()}`);
      return trip({ version: 4 });
    });
    await act(async () => {
      await result.current.addStop(LANDMARK, "Falls");
    });
    expect(seen).toEqual(["re-read: gate busy"]);
  });

  it.each<[string, () => void]>([
    [
      "a definite refusal (403)",
      () => add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x")),
    ],
    [
      "an uncertain network failure (then a re-read)",
      () => {
        add.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
        get.mockResolvedValueOnce(trip({ version: 4 }));
      },
    ],
    [
      "an unexpected exception (then a re-read)",
      () => {
        add.mockRejectedValueOnce(new Error("unexpected"));
        get.mockResolvedValueOnce(trip());
      },
    ],
    [
      "a failed re-read",
      () => {
        add.mockResolvedValueOnce(addedStop());
        get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
      },
    ],
  ])("releases after %s", async (_label, arrange) => {
    const { result } = await ready();
    arrange();
    await act(async () => {
      await result.current.addStop(LANDMARK, "Falls");
    });
    expect(holds()).toBe(0);
    expect(result.current.pending).toBeNull();
  });
});

describe("useTrip — refusal while a transition owns the gate", () => {
  it("share, rotate, revoke, and a stop change are refused before any side effect; the held link survives", async () => {
    const { result } = await ready();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    await act(async () => {
      await result.current.enableSharing();
    });
    expect(result.current.shareLink).toBe(URL_1);
    enable.mockReset();
    get.mockReset();

    const gate = updateSafety.tryAcquireGate();
    if (gate.kind !== "acquired") throw new Error("expected the gate");
    // Released in `finally`, so a failure here cannot leak the gate into later tests.
    try {
      const outcomes: unknown[] = [];
      await act(async () => {
        outcomes.push(await result.current.enableSharing());
        outcomes.push(await result.current.revokeSharing());
        outcomes.push(await result.current.addStop(LANDMARK, "Falls"));
      });
      expect(outcomes).toEqual([{ kind: "ignored" }, { kind: "ignored" }, { kind: "ignored" }]);
      expect(result.current.shareLink).toBe(URL_1); // not cleared
      expect(result.current.isShareLinkCurrent(URL_1)).toBe(true);
      expect(result.current.pending).toBeNull();
      expect(enable).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(holds()).toBe(0);
    } finally {
      gate.gate.release();
    }

    // Released: changes work again (nothing was queued or replayed).
    add.mockResolvedValueOnce(addedStop());
    get.mockResolvedValueOnce(trip({ version: 5, is_shared: true }));
    await act(async () => {
      await result.current.addStop(LANDMARK, "Falls");
    });
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe("useTrip — invalidation and stale operations", () => {
  it("invalidation releases the hold; the stale change's late cleanup cannot release a newer change's hold", async () => {
    const { result } = await ready();
    const stale = deferred<string>();
    enable.mockReturnValueOnce(stale.promise);
    let first: Promise<unknown>;
    act(() => {
      first = result.current.enableSharing();
    });
    expect(holds()).toBe(1);

    // A reload of the trip invalidates the change (a new epoch).
    get.mockResolvedValueOnce(trip());
    await act(async () => {
      result.current.retry();
    });
    expect(holds()).toBe(0);

    // A newer change starts and holds.
    const newer = deferred<AddedTripStop>();
    add.mockReturnValueOnce(newer.promise);
    let second: Promise<unknown>;
    act(() => {
      second = result.current.addStop(LANDMARK, "Falls");
    });
    expect(holds()).toBe(1);

    // The stale change finishes: discarded, no re-read, and the newer hold stays.
    await act(async () => {
      stale.resolve(URL_1);
      await first;
    });
    expect(await first!).toEqual({ kind: "discarded" });
    expect(holds()).toBe(1);
    expect(gateAttempt()).toBe("busy");
    expect(result.current.shareLink).toBeNull();

    get.mockResolvedValueOnce(trip({ version: 4 }));
    await act(async () => {
      newer.resolve(addedStop());
      await second;
    });
    expect(holds()).toBe(0);
  });

  it("unmounting mid-change: the hold lasts until the change settles, then is released", async () => {
    const { result, unmount } = await ready();
    const pendingAdd = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pendingAdd.promise);
    let change: Promise<unknown>;
    act(() => {
      change = result.current.addStop(LANDMARK, "Falls");
    });
    unmount();
    expect(holds()).toBe(1);
    await act(async () => {
      pendingAdd.resolve(addedStop());
      await change;
    });
    expect(holds()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M06-T02 Increment 4b-ii — the held share link as protected information.
// ---------------------------------------------------------------------------

/** Records, at the exact moment the last operation hold is released, which categories are registered. */
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
const linkCategories = () =>
  updateSafety.getSnapshot().protectedCategories.filter((c) => c === "share-link");

describe("useTrip — the held share link is protected (4b-ii)", () => {
  it("metadata-only contract: no part of the URL reaches the registry", async () => {
    const { result } = await ready();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    await act(async () => {
      await result.current.enableSharing();
    });
    const text = JSON.stringify(updateSafety.getSnapshot());
    expect(text).not.toContain(URL_1);
    expect(text).not.toContain("share.example.test");
    expect(text).not.toContain("C".repeat(43));
  });

  it("a newly held link is registered before the change's hold is released; the URL never reaches the registry", async () => {
    const { result } = await ready();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    const observer = atHoldRelease();
    await act(async () => {
      await result.current.enableSharing();
    });
    observer.stop();
    expect(result.current.shareLink).toBe(URL_1);
    expect(observer.seen).toEqual([["share-link"]]);
    expect(JSON.stringify(updateSafety.getSnapshot())).not.toContain(URL_1);
    expect(JSON.stringify(updateSafety.getSnapshot())).not.toContain("share.example.test");
  });

  it("rotation replaces the registration (one link, a new revision); revocation removes it", async () => {
    const { result } = await ready();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    await act(async () => {
      await result.current.enableSharing();
    });
    const before = updateSafety.getSnapshot().protectedRevision;
    const URL_2 = `https://share.example.test/shared/trips/${"D".repeat(43)}`;
    enable.mockResolvedValueOnce(URL_2);
    get.mockResolvedValueOnce(trip({ version: 5, is_shared: true }));
    const observer = atHoldRelease();
    await act(async () => {
      await result.current.enableSharing();
    });
    observer.stop();
    expect(result.current.shareLink).toBe(URL_2);
    expect(observer.seen).toEqual([["share-link"]]);
    expect(linkCategories()).toEqual(["share-link"]);
    expect(updateSafety.getSnapshot().protectedRevision).toBeGreaterThan(before);

    revoke.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(trip({ version: 6, is_shared: false }));
    await act(async () => {
      await result.current.revokeSharing();
    });
    expect(result.current.shareLink).toBeNull();
    expect(linkCategories()).toEqual([]);
  });

  it("the held-link rules clearing the link (an unexplained version change) also clear its protection", async () => {
    const { result } = await ready();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    await act(async () => {
      await result.current.enableSharing();
    });
    // An add whose re-read shows another change happened as well (version + 2).
    add.mockResolvedValueOnce(addedStop());
    get.mockResolvedValueOnce(trip({ version: 6, is_shared: true }));
    await act(async () => {
      await result.current.addStop(LANDMARK, "Falls");
    });
    expect(result.current.shareLink).toBeNull();
    expect(linkCategories()).toEqual([]);
  });

  it.each<[string, () => void]>([
    [
      "an unconfirmed link (version mismatch)",
      () => {
        enable.mockResolvedValueOnce(URL_1);
        get.mockResolvedValueOnce(trip({ version: 7, is_shared: true }));
      },
    ],
    ["a refused share (403)", () => enable.mockRejectedValueOnce(new ApiError(403, "X", "x"))],
    [
      "an uncertain share",
      () => {
        enable.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
        get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
      },
    ],
  ])("nothing is registered for %s", async (_label, arrange) => {
    const { result } = await ready();
    arrange();
    await act(async () => {
      await result.current.enableSharing();
    });
    expect(result.current.shareLink).toBeNull();
    expect(linkCategories()).toEqual([]);
  });

  it("a stale share finishing after invalidation registers nothing", async () => {
    const { result } = await ready();
    const stale = deferred<string>();
    enable.mockReturnValueOnce(stale.promise);
    let first: Promise<unknown>;
    act(() => {
      first = result.current.enableSharing();
    });
    get.mockResolvedValueOnce(trip());
    await act(async () => {
      result.current.retry();
    });
    await act(async () => {
      stale.resolve(URL_1);
      await first;
    });
    expect(result.current.shareLink).toBeNull();
    expect(linkCategories()).toEqual([]);
  });

  it("unmount releases the registration", async () => {
    const { result, unmount } = await ready();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    await act(async () => {
      await result.current.enableSharing();
    });
    expect(linkCategories()).toEqual(["share-link"]);
    unmount();
    expect(linkCategories()).toEqual([]);
  });

  it("StrictMode: exactly one registration while held; none after unmount", async () => {
    get.mockResolvedValue(trip());
    const strictWrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{wrapper({ children })}</StrictMode>
    );
    const { result, unmount } = renderHook(() => useTrip(TRIP_A), { wrapper: strictWrapper });
    await act(async () => {});
    get.mockReset();
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(trip({ version: 4, is_shared: true }));
    await act(async () => {
      await result.current.enableSharing();
    });
    expect(result.current.shareLink).toBe(URL_1);
    expect(linkCategories()).toEqual(["share-link"]);
    unmount();
    expect(linkCategories()).toEqual([]);
  });
});
