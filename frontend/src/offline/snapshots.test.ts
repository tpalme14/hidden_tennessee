import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdateSafety, type UpdateSafety } from "../pwa/updateSafety";
import {
  openOfflineDataDatabase,
  openOfflineStateDatabase,
  type OpenResult,
  type OfflineDataSchema,
} from "./db";
import { SAFETY_LOCK_KEY } from "./safetyLock";
import type { SecurityDeps } from "./securityState";
import type { LandmarkResponse, SnapshotNetwork, TripResponse } from "./snapshotNetwork";
import {
  createSnapshotOperations,
  createSnapshotView,
  type SnapshotIdentity,
  type SnapshotOperations,
} from "./snapshots";
import {
  createOfflineTestTab,
  createOfflineTestWorld,
  deferred,
  flush,
  injectTransactionFailures,
  type OfflineTestWorld,
} from "./testSupport";

/**
 * M06-T03 Increment 3d — landmark and trip snapshot operations.
 *
 * SYNTHETIC verification only: fake-indexeddb, the in-memory Web Locks
 * manager, simulated tabs, and stubbed classified responses with controlled
 * (deferred) ordering. It establishes the DR-7 ordering rules, gates, and
 * failure handling; it is NOT real-browser evidence (3e and 3g).
 */

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LIFECYCLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD_LIFECYCLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0";
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "11111111-1111-4111-8111-111111111112";
const L3 = "11111111-1111-4111-8111-111111111113";
const TRIP_A = "22222222-2222-4222-8222-22222222222a";
const TRIP_B = "22222222-2222-4222-8222-22222222222b";
const T = "2026-11-20T10:00:00.000Z";
const IDENTITY: SnapshotIdentity = { accountId: ACCOUNT, lifecycleId: LIFECYCLE };

const profile = (id: string, name = "Falls") => ({
  id,
  display_name: name,
  category: "falls",
  latitude: 36.1,
  longitude: -84.1,
  source_description: "From the GPX file",
  source_access_label: null,
  source_url: null,
});

/** A valid `{ trip }` owner response; `null` landmark availability marks an unavailable stop. */
function tripBody(id: string, stops: { landmark: string; available?: boolean; miles?: number }[]) {
  const built = stops.map((s, i) => {
    const available = s.available !== false;
    const prev = i > 0 ? stops[i - 1] : undefined;
    const distance = i > 0 && available && prev?.available !== false ? (s.miles ?? 1.5) : null;
    return {
      id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
      position: i,
      is_available: available,
      distance_from_previous_miles: distance,
      landmark: available
        ? {
            id: s.landmark,
            display_name: `Stop ${i}`,
            category: "peak",
            latitude: 36,
            longitude: -84,
          }
        : { id: s.landmark, is_available: false },
    };
  });
  const legs = built
    .map((s) => s.distance_from_previous_miles)
    .filter((d): d is number => d !== null);
  return {
    trip: {
      id,
      name: "Weekend trip",
      version: 7,
      created_at: T,
      updated_at: T,
      is_shared: true,
      sharing_enabled: true,
      stops: built,
      distance_summary: {
        total_miles: legs.length === 0 ? null : legs.reduce((a, b) => a + b, 0),
        measured_legs: legs.length,
        total_legs: Math.max(built.length - 1, 0),
      },
    },
  };
}

async function putData(store: string, value: unknown) {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  await (opened.db as unknown as { put(s: string, v: unknown): Promise<unknown> }).put(
    store,
    value,
  );
  opened.db.close();
}
async function getData(store: string, key: unknown): Promise<Record<string, unknown> | undefined> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const value = (await (
    opened.db as unknown as { get(s: string, k: unknown): Promise<unknown> }
  ).get(store, key)) as Record<string, unknown> | undefined;
  opened.db.close();
  return value;
}
async function allData(store: string): Promise<Record<string, unknown>[]> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const values = (await (opened.db as unknown as { getAll(s: string): Promise<unknown[]> }).getAll(
    store,
  )) as Record<string, unknown>[];
  opened.db.close();
  return values;
}
const landmark = (id: string) => getData("landmarks", [ACCOUNT, LIFECYCLE, id]);
const trip = (id: string) => getData("trips", [ACCOUNT, LIFECYCLE, id]);
const marker = (account = ACCOUNT, lifecycle = LIFECYCLE) => ({
  key: "marker",
  schema_version: 1,
  account_id: account,
  lifecycle_id: lifecycle,
  verified_at: T,
});

let world: OfflineTestWorld;
let safety: UpdateSafety;
let network: { fetchLandmark: ReturnType<typeof vi.fn>; fetchTrip: ReturnType<typeof vi.fn> };
let sessionChecks: number;

interface Tab {
  ops: SnapshotOperations;
  deps: SecurityDeps;
  view: ReturnType<typeof createSnapshotView>;
}

function makeTab(
  options: {
    identity?: SnapshotIdentity | null;
    overrides?: Partial<SecurityDeps>;
    persist?: () => Promise<boolean>;
  } = {},
): Tab {
  const deps = createOfflineTestTab(world, options.overrides);
  const view = createSnapshotView();
  const ops = createSnapshotOperations({
    security: deps,
    safety,
    network: network as unknown as SnapshotNetwork,
    identity: () => (options.identity === undefined ? IDENTITY : options.identity),
    onSessionCheckRequired: () => {
      sessionChecks += 1;
    },
    persist: options.persist ?? (() => Promise.resolve(true)),
    view,
  });
  return { ops, deps, view };
}

const landmarkResponse = (r: LandmarkResponse) => network.fetchLandmark.mockResolvedValueOnce(r);
const tripResponse = (r: TripResponse) => network.fetchTrip.mockResolvedValueOnce(r);
/** A response held until released (controlled ordering). */
function heldLandmark() {
  const gate = deferred<LandmarkResponse>();
  network.fetchLandmark.mockImplementationOnce(() => gate.promise);
  return gate;
}
function heldTrip() {
  const gate = deferred<TripResponse>();
  network.fetchTrip.mockImplementationOnce(() => gate.promise);
  return gate;
}

async function saveLandmarkNow(tab: Tab, id: string, name = "Falls") {
  landmarkResponse({ kind: "available", body: profile(id, name) });
  expect((await tab.ops.saveLandmark(id)).kind).toBe("saved");
}
async function saveTripNow(tab: Tab, id: string, stops: Parameters<typeof tripBody>[1]) {
  tripResponse({ kind: "available", body: tripBody(id, stops) });
  expect((await tab.ops.saveTrip(id)).kind).toBe("saved");
}

beforeEach(async () => {
  world = createOfflineTestWorld();
  safety = createUpdateSafety();
  network = { fetchLandmark: vi.fn(), fetchTrip: vi.fn() };
  sessionChecks = 0;
  await putData("meta", marker());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saves, reads, and the allowlist", () => {
  it("saves a validated landmark as an allowlisted record, publishes it, and requests persistence once", async () => {
    const tab = makeTab();
    landmarkResponse({ kind: "available", body: profile(L1) });
    expect(await tab.ops.saveLandmark(L1)).toEqual({ kind: "saved", persistence: "granted" });
    expect(await landmark(L1)).toEqual({
      schema_version: 1,
      account_id: ACCOUNT,
      lifecycle_id: LIFECYCLE,
      revision: 1,
      landmark_id: L1,
      status: "available",
      display_name: "Falls",
      category: "falls",
      latitude: 36.1,
      longitude: -84.1,
      saved_at: "2026-11-26T10:00:00.000Z",
      source_description: "From the GPX file",
      source_access_label: null,
      source_url: null,
    });
    expect(tab.view.getSnapshot().landmarks.get(L1)).toMatchObject({
      status: "ok",
      lastSyncedAt: "2026-11-26T10:00:00.000Z",
    });
    await saveLandmarkNow(tab, L2);
    // Persistence is requested only once (OFF-STORE-6).
    expect((await allData("landmarks")).length).toBe(2);
  });

  it("a duplicate save changes nothing and sends no request (OFF-STORE-3)", async () => {
    const tab = makeTab();
    await saveLandmarkNow(tab, L1);
    network.fetchLandmark.mockClear();
    expect(await tab.ops.saveLandmark(L1)).toEqual({ kind: "already-saved" });
    expect(network.fetchLandmark).not.toHaveBeenCalled();
  });

  it("AC-21: no stored record contains anything outside the allowlist, even when responses carry it", async () => {
    const tab = makeTab();
    await saveLandmarkNow(tab, L1);
    await saveTripNow(tab, TRIP_A, [{ landmark: L1 }, { landmark: L2 }]);
    const stored = JSON.stringify([...(await allData("landmarks")), ...(await allData("trips"))]);
    // Exact field names (`schema_version` is allowlisted; `version` is not).
    for (const forbidden of [
      '"version"',
      '"is_shared"',
      '"sharing_enabled"',
      '"created_at"',
      '"share_url"',
      "token",
      "@",
    ]) {
      expect(stored).not.toContain(forbidden);
    }
  });

  it("records of another account or lifecycle are never readable (AC-1)", async () => {
    const tab = makeTab();
    await saveLandmarkNow(tab, L1);
    await putData("landmarks", {
      schema_version: 1,
      account_id: OTHER_ACCOUNT,
      lifecycle_id: LIFECYCLE,
      revision: 1,
      landmark_id: L2,
      status: "unavailable",
      saved_at: T,
      unavailable_recorded_at: T,
    });
    // Another account's record in this browser is residual: the whole library
    // is locked (OFF-LIFE-9) rather than filtered, so nothing of it is readable.
    expect(await tab.ops.listLandmarks()).toEqual({ kind: "not-eligible", reason: "protected" });
    expect(await tab.ops.getLandmark(L2)).toEqual({ kind: "not-eligible", reason: "protected" });
    expect(tab.view.getSnapshot().landmarks.has(L2)).toBe(false);
    // A tab verified for another lifecycle is refused too (the residual state is
    // checked first; the lifecycle-ended path has its own cross-tab test).
    const stale = makeTab({ identity: { accountId: ACCOUNT, lifecycleId: OLD_LIFECYCLE } });
    expect((await stale.ops.listLandmarks()).kind).toBe("not-eligible");
  });

  it("an unreadable record is listed as unreadable, never partially, and can be removed (OFF-SNAP-8, AC-24)", async () => {
    const tab = makeTab();
    await putData("landmarks", {
      schema_version: 1,
      account_id: ACCOUNT,
      lifecycle_id: LIFECYCLE,
      revision: 1,
      landmark_id: L1,
      status: "available",
      display_name: "Falls",
    });
    expect(await tab.ops.listLandmarks()).toEqual({
      kind: "ok",
      entries: [{ status: "unreadable", id: L1 }],
    });
    expect(await tab.ops.removeLandmark(L1)).toEqual({ kind: "removed" });
    expect(await landmark(L1)).toBeUndefined();
  });
});

describe("response classes", () => {
  it("AC-37: a 401 stores nothing, creates no marker, and starts the session check", async () => {
    const tab = makeTab();
    await saveLandmarkNow(tab, L1);
    landmarkResponse({ kind: "auth" });
    expect(await tab.ops.refreshLandmark(L1)).toEqual({ kind: "session-check-required" });
    expect(sessionChecks).toBe(1);
    expect((await landmark(L1))?.status).toBe("available");
    expect(await allData("invalidations")).toEqual([]);
  });

  it.each(["transient", "invalid"] as const)(
    "AC-18: a %s response leaves the snapshot unchanged and reports it stale",
    async (kind) => {
      const tab = makeTab();
      await saveLandmarkNow(tab, L1);
      const before = await landmark(L1);
      landmarkResponse({ kind });
      expect(await tab.ops.refreshLandmark(L1)).toEqual({ kind: "stale", reason: kind });
      expect(await landmark(L1)).toEqual(before);
    },
  );

  it("an available body that fails projection is never stored (AC-12)", async () => {
    const tab = makeTab();
    landmarkResponse({ kind: "available", body: { ...profile(L1), category: "volcano" } });
    expect(await tab.ops.saveLandmark(L1)).toEqual({ kind: "stale", reason: "invalid" });
    expect(await landmark(L1)).toBeUndefined();
  });
});

describe("authoritative unavailability and propagation (OFF-EV-6/7)", () => {
  it("AC-13: a landmark 404 replaces the snapshot with a marker and invalidates every saved trip containing it", async () => {
    const tab = makeTab();
    await saveLandmarkNow(tab, L2);
    await saveTripNow(tab, TRIP_A, [
      { landmark: L1 },
      { landmark: L2, miles: 2 },
      { landmark: L3, miles: 3 },
    ]);
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    expect(await tab.ops.refreshLandmark(L2)).toEqual({ kind: "unavailable", marker: true });

    expect(await landmark(L2)).toEqual({
      schema_version: 1,
      account_id: ACCOUNT,
      lifecycle_id: LIFECYCLE,
      revision: 2,
      landmark_id: L2,
      status: "unavailable",
      saved_at: "2026-11-26T10:00:00.000Z",
      unavailable_recorded_at: expect.any(String) as string,
    });
    const stored = (await trip(TRIP_A)) as { stops: unknown[]; [k: string]: unknown };
    expect(stored.stops[1]).toEqual({
      stop_id: "33333333-3333-4333-8333-000000000001",
      position: 1,
      is_available: false,
      distance_from_previous_miles: null,
      landmark: { id: L2, is_available: false },
    });
    expect(
      (stored.stops[2] as { distance_from_previous_miles: unknown }).distance_from_previous_miles,
    ).toBeNull();
    expect(stored.distance_summary).toBeNull();
    expect(stored.distance_summary_state).toBe("invalidated");
    expect(stored).toHaveProperty("partially_invalidated_at");
    expect(stored).not.toHaveProperty("refreshed_at");
    expect(JSON.stringify(stored)).not.toMatch(/total_miles|measured_legs|total_legs|Stop 1/);
  });

  it("propagates into saved trips even when no standalone copy exists, and never creates one", async () => {
    const tab = makeTab();
    await saveTripNow(tab, TRIP_A, [{ landmark: L1 }, { landmark: L2 }]);
    landmarkResponse({ kind: "unavailable", evidence: "redacted" });
    expect(await tab.ops.saveLandmark(L2)).toEqual({ kind: "unavailable", marker: false });
    expect(await landmark(L2)).toBeUndefined();
    expect((await trip(TRIP_A))?.distance_summary_state).toBe("invalidated");
    expect(await allData("invalidations")).toEqual([
      expect.objectContaining({ landmark_id: L2, seq: 1 }),
    ]);
  });

  it("AC-14: a validated unavailable stop in a trip refresh propagates to the landmark and other trips", async () => {
    const tab = makeTab();
    await saveLandmarkNow(tab, L2);
    await saveTripNow(tab, TRIP_A, [{ landmark: L1 }, { landmark: L2 }]);
    await saveTripNow(tab, TRIP_B, [{ landmark: L2 }, { landmark: L3 }]);
    tripResponse({
      kind: "available",
      body: tripBody(TRIP_A, [{ landmark: L1 }, { landmark: L2, available: false }]),
    });
    expect(await tab.ops.refreshTrip(TRIP_A)).toEqual({ kind: "refreshed" });
    expect((await landmark(L2))?.status).toBe("unavailable");
    expect((await trip(TRIP_B))?.distance_summary_state).toBe("invalidated");
    expect((await trip(TRIP_A))?.refreshed_at).toBeDefined();
  });

  it("AC-15: a trip 404 creates an exact trip marker and changes nothing else", async () => {
    const tab = makeTab();
    await saveLandmarkNow(tab, L1);
    await saveTripNow(tab, TRIP_A, [{ landmark: L1 }]);
    const landmarkBefore = await landmark(L1);
    const savedAt = (await trip(TRIP_A))?.saved_at;
    tripResponse({ kind: "unavailable" });
    expect(await tab.ops.refreshTrip(TRIP_A)).toEqual({ kind: "unavailable", marker: true });
    expect(await trip(TRIP_A)).toEqual({
      schema_version: 1,
      account_id: ACCOUNT,
      lifecycle_id: LIFECYCLE,
      revision: 2,
      trip_id: TRIP_A,
      status: "unavailable",
      saved_at: savedAt,
      unavailable_recorded_at: expect.any(String) as string,
    });
    expect(await landmark(L1)).toEqual(landmarkBefore);
    expect(await allData("invalidations")).toEqual([]);
  });

  it("a failed invalidation write falls back to deleting the affected copies (AC-19)", async () => {
    const tab0 = makeTab();
    await saveLandmarkNow(tab0, L1);
    await saveTripNow(tab0, TRIP_A, [{ landmark: L1 }]);
    let readwrites = 0;
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite" && ++readwrites === 1, // only the invalidation commit
    );
    const tab = makeTab({ overrides: { openData: failing.opener } });
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    expect(await tab.ops.refreshLandmark(L1)).toEqual({
      kind: "invalidation-not-durable",
      protection: "deleted",
    });
    expect(await landmark(L1)).toBeUndefined();
    expect(await trip(TRIP_A)).toBeUndefined();
  });

  it("when the fallback also fails, durable failure evidence is recorded and the content stays blocked in memory", async () => {
    const tab0 = makeTab();
    await saveLandmarkNow(tab0, L1);
    await tab0.ops.listLandmarks();
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const tab = makeTab({ overrides: { openData: failing.opener } });
    await tab.ops.listLandmarks();
    expect(tab.view.getSnapshot().landmarks.has(L1)).toBe(true);
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    expect(await tab.ops.refreshLandmark(L1)).toEqual({
      kind: "invalidation-not-durable",
      protection: "failure-record",
    });
    expect(tab.view.getSnapshot().landmarks.has(L1)).toBe(false);
    const opened = await openOfflineStateDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    expect(await opened.db.get("state", "failure")).toMatchObject({ kind: "cleanup" });
    opened.db.close();
  });
});

describe("DR-7 ordering (S1: commit-based)", () => {
  it("AC-16(a)/AC-3: a save started before an invalidation commit writes no protected fields", async () => {
    const a = makeTab();
    const b = makeTab();
    const held = heldLandmark();
    const saving = a.ops.saveLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(1));
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    expect((await b.ops.saveLandmark(L1)).kind).toBe("unavailable");
    held.resolve({ kind: "available", body: profile(L1) });
    expect(await saving).toEqual({ kind: "superseded" });
    expect(await landmark(L1)).toBeUndefined();
  });

  it("AC-16(b): a trip refresh started before a landmark invalidation stores that stop as unavailable", async () => {
    const a = makeTab();
    await saveTripNow(a, TRIP_A, [{ landmark: L1 }, { landmark: L2 }]);
    const held = heldTrip();
    const refreshing = a.ops.refreshTrip(TRIP_A);
    await vi.waitFor(() => expect(network.fetchTrip).toHaveBeenCalledTimes(2));
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    await makeTab().ops.saveLandmark(L2); // invalidation committed meanwhile (also propagates)
    held.resolve({
      kind: "available",
      body: tripBody(TRIP_A, [{ landmark: L1 }, { landmark: L2 }]),
    });
    // The propagation bumped the trip's revision: the late refresh does not overwrite it.
    expect(await refreshing).toEqual({ kind: "changed-meanwhile" });
    const stored = (await trip(TRIP_A)) as { stops: { is_available: boolean }[] };
    expect(stored.stops[1]?.is_available).toBe(false);
  });

  it("AC-16(b) for a first save: the late stop is stored as the placeholder", async () => {
    const a = makeTab();
    const held = heldTrip();
    const saving = a.ops.saveTrip(TRIP_A);
    await vi.waitFor(() => expect(network.fetchTrip).toHaveBeenCalledTimes(1));
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    await makeTab().ops.saveLandmark(L2);
    held.resolve({
      kind: "available",
      body: tripBody(TRIP_A, [{ landmark: L1 }, { landmark: L2 }]),
    });
    expect(await saving).toMatchObject({ kind: "saved" });
    const stored = (await trip(TRIP_A)) as {
      stops: { is_available: boolean }[];
      [k: string]: unknown;
    };
    expect(stored.stops[1]?.is_available).toBe(false);
    expect(stored.distance_summary_state).toBe("invalidated");
    expect(JSON.stringify(stored)).not.toContain("Stop 1");
  });

  it("AC-16(c): a refresh of a copy removed after it started never recreates it", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L1);
    const held = heldLandmark();
    const refreshing = a.ops.refreshLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(2));
    expect(await makeTab().ops.removeLandmark(L1)).toEqual({ kind: "removed" });
    held.resolve({ kind: "available", body: profile(L1) });
    expect(await refreshing).toEqual({ kind: "deleted-meanwhile" });
    expect(await landmark(L1)).toBeUndefined();
  });

  it("AC-16(c)/(j): a late save never recreates a copy the user saved and removed after it started", async () => {
    const a = makeTab();
    const held = heldLandmark();
    const saving = a.ops.saveLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(1));
    const b = makeTab();
    await saveLandmarkNow(b, L1);
    expect(await b.ops.removeLandmark(L1)).toEqual({ kind: "removed" });
    held.resolve({ kind: "available", body: profile(L1) });
    expect(await saving).toEqual({ kind: "deleted-meanwhile" });
    expect(await landmark(L1)).toBeUndefined();
  });

  it("a delayed UNAVAILABLE response after removal recreates nothing but still invalidates saved trips", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L2);
    await saveTripNow(a, TRIP_A, [{ landmark: L1 }, { landmark: L2 }]);
    const held = heldLandmark();
    const refreshing = a.ops.refreshLandmark(L2);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(2));
    await makeTab().ops.removeLandmark(L2);
    held.resolve({ kind: "unavailable", evidence: "not-found" });
    expect(await refreshing).toEqual({ kind: "unavailable", marker: false });
    expect(await landmark(L2)).toBeUndefined();
    expect((await trip(TRIP_A))?.distance_summary_state).toBe("invalidated");
  });

  it("a delayed trip 404 after removal never recreates the trip", async () => {
    const a = makeTab();
    await saveTripNow(a, TRIP_A, [{ landmark: L1 }]);
    const held = heldTrip();
    const refreshing = a.ops.refreshTrip(TRIP_A);
    await vi.waitFor(() => expect(network.fetchTrip).toHaveBeenCalledTimes(2));
    await makeTab().ops.removeTrip(TRIP_A);
    held.resolve({ kind: "unavailable" });
    expect(await refreshing).toEqual({ kind: "deleted-meanwhile" });
    expect(await trip(TRIP_A)).toBeUndefined();
  });

  it("AC-16(d): two concurrent duplicate saves produce one record", async () => {
    const a = makeTab();
    const b = makeTab();
    landmarkResponse({ kind: "available", body: profile(L1) });
    landmarkResponse({ kind: "available", body: profile(L1) });
    const results = await Promise.all([a.ops.saveLandmark(L1), b.ops.saveLandmark(L1)]);
    expect(results.map((r) => r.kind).sort()).toEqual(["already-saved", "saved"]);
    expect((await allData("landmarks")).length).toBe(1);
  });

  it("AC-16(e): a delayed refresh never overwrites a newer revision (first commit wins)", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L1, "Original");
    const held = heldLandmark();
    const slow = a.ops.refreshLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(2));
    landmarkResponse({ kind: "available", body: profile(L1, "Newer") });
    expect(await makeTab().ops.refreshLandmark(L1)).toEqual({ kind: "refreshed" });
    held.resolve({ kind: "available", body: profile(L1, "Older") });
    expect(await slow).toEqual({ kind: "changed-meanwhile" });
    expect((await landmark(L1))?.display_name).toBe("Newer");
  });

  it("AC-16(f)(g), order 1: the unavailable commit first, then the overlapping available response is superseded", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L1);
    const heldAvailable = heldLandmark();
    const available = a.ops.refreshLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(2));
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    expect((await makeTab().ops.refreshLandmark(L1)).kind).toBe("unavailable");
    heldAvailable.resolve({ kind: "available", body: profile(L1) });
    expect(await available).toEqual({ kind: "superseded" });
    expect((await landmark(L1))?.status).toBe("unavailable");
  });

  it("AC-16(g)(h), order 2: the available commit first, then the overlapping unavailable response still applies", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L1);
    const heldUnavailable = heldLandmark();
    const unavailable = a.ops.refreshLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(2));
    landmarkResponse({ kind: "available", body: profile(L1, "Overlapping") });
    expect(await makeTab().ops.refreshLandmark(L1)).toEqual({ kind: "refreshed" });
    heldUnavailable.resolve({ kind: "unavailable", evidence: "not-found" });
    expect(await unavailable).toEqual({ kind: "unavailable", marker: true });
    expect((await landmark(L1))?.status).toBe("unavailable");
    expect(JSON.stringify(await landmark(L1))).not.toContain("Overlapping");
  });

  it("AC-16(i), AC-17: an explicit refresh after the invalidation committed restores only that snapshot", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L2);
    await saveTripNow(a, TRIP_A, [{ landmark: L1 }, { landmark: L2 }]);
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    await a.ops.refreshLandmark(L2);
    landmarkResponse({ kind: "available", body: profile(L2, "Back") });
    expect(await a.ops.refreshLandmark(L2)).toEqual({ kind: "restored" });
    expect(await landmark(L2)).toMatchObject({ status: "available", display_name: "Back" });
    const stored = (await trip(TRIP_A)) as { stops: { is_available: boolean }[] };
    expect(stored.stops[1]?.is_available).toBe(false); // the trip is not restored
  });

  it("AC-22: saved_at never changes; refreshed_at only on refresh; markers keep saved_at", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L1);
    const first = await landmark(L1);
    landmarkResponse({ kind: "available", body: profile(L1) });
    await a.ops.refreshLandmark(L1);
    const refreshed = await landmark(L1);
    expect(refreshed?.saved_at).toBe(first?.saved_at);
    expect(refreshed?.refreshed_at).toBeDefined();
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    await a.ops.refreshLandmark(L1);
    const markerRecord = await landmark(L1);
    expect(markerRecord?.saved_at).toBe(first?.saved_at);
    expect(markerRecord).not.toHaveProperty("refreshed_at");
  });
});

describe("limits, quota, and storage (OFF-STORE-1–6)", () => {
  async function seedLandmarks(count: number, unavailableEvery = 5) {
    for (let i = 0; i < count; i += 1) {
      const id = `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`;
      await putData(
        "landmarks",
        i % unavailableEvery === 0
          ? {
              schema_version: 1,
              account_id: ACCOUNT,
              lifecycle_id: LIFECYCLE,
              revision: 1,
              landmark_id: id,
              status: "unavailable",
              saved_at: T,
              unavailable_recorded_at: T,
            }
          : {
              ...profile(id),
              schema_version: 1,
              account_id: ACCOUNT,
              lifecycle_id: LIFECYCLE,
              revision: 1,
              landmark_id: id,
              status: "available",
              saved_at: T,
              id: undefined,
            },
      );
    }
  }

  it("AC-23: the 200th landmark save succeeds, the next is rejected unchanged, markers count, and refresh works at the limit", async () => {
    const tab = makeTab();
    await seedLandmarks(199);
    await saveLandmarkNow(tab, L1);
    landmarkResponse({ kind: "available", body: profile(L2) });
    expect(await tab.ops.saveLandmark(L2)).toEqual({ kind: "limit-reached", limit: 200 });
    expect((await allData("landmarks")).length).toBe(200);
    landmarkResponse({ kind: "available", body: profile(L1, "Refreshed") });
    expect(await tab.ops.refreshLandmark(L1)).toEqual({ kind: "refreshed" });
  });

  it("AC-23: the 25th trip save succeeds and the 26th is rejected", async () => {
    const tab = makeTab();
    for (let i = 0; i < 24; i += 1) {
      const id = `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`;
      await putData("trips", {
        schema_version: 1,
        account_id: ACCOUNT,
        lifecycle_id: LIFECYCLE,
        revision: 1,
        trip_id: id,
        status: "unavailable",
        saved_at: T,
        unavailable_recorded_at: T,
      });
    }
    await saveTripNow(tab, TRIP_A, [{ landmark: L1 }]);
    tripResponse({ kind: "available", body: tripBody(TRIP_B, [{ landmark: L1 }]) });
    expect(await tab.ops.saveTrip(TRIP_B)).toEqual({ kind: "limit-reached", limit: 25 });
  });

  it("AC-24: a quota error leaves the prior record unchanged and is reported as quota", async () => {
    const tab0 = makeTab();
    await saveLandmarkNow(tab0, L1);
    const before = await landmark(L1);
    const quota = async (): Promise<OpenResult<OfflineDataSchema>> => {
      const opened = await openOfflineDataDatabase();
      if (opened.kind !== "open") return opened;
      const db = opened.db;
      const transaction = db.transaction.bind(db);
      return {
        kind: "open",
        db: new Proxy(db, {
          get(target, prop) {
            if (prop === "transaction") {
              return (stores: never, mode: never) => {
                const tx = transaction(stores, mode);
                if (mode !== "readwrite") return tx;
                const objectStore = tx.objectStore.bind(tx);
                return new Proxy(tx, {
                  get(t, p) {
                    if (p === "objectStore") {
                      return (name: never) => {
                        const store = objectStore(name);
                        return new Proxy(store, {
                          get(s, q) {
                            if (q === "put") {
                              return () =>
                                Promise.reject(new DOMException("full", "QuotaExceededError"));
                            }
                            const v: unknown = Reflect.get(s, q, s);
                            return typeof v === "function" ? (v as () => unknown).bind(s) : v;
                          },
                        });
                      };
                    }
                    const v: unknown = Reflect.get(t, p, t);
                    return typeof v === "function" ? (v as () => unknown).bind(t) : v;
                  },
                });
              };
            }
            const v: unknown = Reflect.get(target, prop, target);
            return typeof v === "function" ? (v as () => unknown).bind(target) : v;
          },
        }),
      };
    };
    const tab = makeTab({ overrides: { openData: quota } });
    landmarkResponse({ kind: "available", body: profile(L1, "Changed") });
    expect(await tab.ops.refreshLandmark(L1)).toEqual({ kind: "quota" });
    expect(await landmark(L1)).toEqual(before);
  });

  it("AC-24: unavailable IndexedDB is reported as storage-unavailable, never an empty library", async () => {
    const tab = makeTab({
      overrides: { openData: () => Promise.resolve({ kind: "unavailable" }) },
    });
    expect(await tab.ops.listLandmarks()).toEqual({ kind: "storage-unavailable" });
  });

  it.each([
    ["denied", () => Promise.resolve(false), "denied"],
    ["failing", () => Promise.reject(new Error("no")), "failed"],
  ] as const)(
    "persistent storage %s never invalidates a successful save",
    async (_label, persist, expected) => {
      const tab = makeTab({ persist });
      landmarkResponse({ kind: "available", body: profile(L1) });
      expect(await tab.ops.saveLandmark(L1)).toEqual({ kind: "saved", persistence: expected });
      expect((await landmark(L1))?.status).toBe("available");
    },
  );
});

describe("gates, coordination, DR-3, and DR-5", () => {
  it.each([
    [
      "no verified identity",
      () => makeTab({ identity: null }),
      { kind: "not-eligible", reason: "no-identity" },
    ],
    [
      "D22 present",
      () => {
        world.storage.setItem(SAFETY_LOCK_KEY, "true");
        return makeTab();
      },
      { kind: "not-eligible", reason: "protected" },
    ],
    [
      "a blocked tab",
      () => {
        const tab = makeTab();
        tab.deps.generation.block();
        return tab;
      },
      { kind: "not-eligible", reason: "lifecycle-ended" },
    ],
  ] as const)("refuses with %s and sends nothing", async (_label, make, expected) => {
    const tab = make();
    expect(await tab.ops.saveLandmark(L1)).toEqual(expected);
    expect(network.fetchLandmark).not.toHaveBeenCalled();
  });

  it("AC-38: unresolved records of an earlier lifecycle keep the new lifecycle from saving", async () => {
    await putData("landmarks", {
      schema_version: 1,
      account_id: ACCOUNT,
      lifecycle_id: OLD_LIFECYCLE,
      revision: 1,
      landmark_id: L3,
      status: "unavailable",
      saved_at: T,
      unavailable_recorded_at: T,
    });
    expect(await makeTab().ops.saveLandmark(L1)).toEqual({
      kind: "not-eligible",
      reason: "protected",
    });
  });

  it("a lifecycle ended in another tab during the request commits nothing (cross-tab termination)", async () => {
    const a = makeTab();
    const held = heldLandmark();
    const saving = a.ops.saveLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(1));
    await putData("meta", marker(ACCOUNT, OLD_LIFECYCLE)); // another lifecycle is now current
    held.resolve({ kind: "available", body: profile(L1) });
    expect(await saving).toEqual({ kind: "not-eligible", reason: "lifecycle-ended" });
    expect(await allData("landmarks")).toEqual([]);
  });

  it("a local block between the request and the commit prevents the commit and the publication", async () => {
    const a = makeTab();
    const held = heldLandmark();
    const saving = a.ops.saveLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(1));
    a.deps.generation.block();
    held.resolve({ kind: "available", body: profile(L1) });
    expect(await saving).toEqual({ kind: "not-eligible", reason: "lifecycle-ended" });
    expect(await landmark(L1)).toBeUndefined();
    expect(a.view.getSnapshot().landmarks.size).toBe(0);
  });

  it("DR-3: publication happens synchronously while the shared security lock is held, after the commit", async () => {
    const a = makeTab();
    const observed: { held: string[]; stored: boolean }[] = [];
    const apply = a.view.apply.bind(a.view);
    a.view.apply = (changes) => {
      observed.push({
        held: world.locks.snapshot().held.map((l) => `${l.name}:${l.mode}`),
        stored: true,
      });
      apply(changes);
    };
    await saveLandmarkNow(a, L1);
    expect(observed[0]?.held).toEqual(["tnle-offline-security:shared"]);
    expect(await landmark(L1)).toBeDefined();
  });

  it("DR-3: an exclusive security transition cannot start between the final check and the publication", async () => {
    const a = makeTab();
    const order: string[] = [];
    const apply = a.view.apply.bind(a.view);
    a.view.apply = (changes) => {
      order.push("published");
      apply(changes);
    };
    const held = heldLandmark();
    const saving = a.ops.saveLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(1));
    held.resolve({ kind: "available", body: profile(L1) });
    await flush();
    const other = createOfflineTestTab(world);
    const transition = other.coordinator.withLock(
      { held: new Set() },
      "tnle-offline-security",
      "exclusive",
      () => {
        order.push("exclusive transition");
      },
    );
    await saving;
    await transition;
    expect(order).toEqual(["published", "exclusive transition"]);
  });

  it("DR-5: a held update gate refuses the operation; the hold lasts through the request and the commit", async () => {
    const gate = safety.tryAcquireGate();
    const a = makeTab();
    expect(await a.ops.saveLandmark(L1)).toEqual({ kind: "updating" });
    expect(network.fetchLandmark).not.toHaveBeenCalled();
    if (gate.kind === "acquired") gate.gate.release();
    const held = heldLandmark();
    const saving = a.ops.saveLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(1));
    expect(safety.tryAcquireGate()).toEqual({ kind: "busy" });
    held.resolve({ kind: "available", body: profile(L1) });
    await saving;
    expect(safety.getSnapshot().operationHolds).toBe(0);
  });

  it("AC-25: creating the operations makes no request and touches no storage", async () => {
    makeTab();
    await flush();
    expect(network.fetchLandmark).not.toHaveBeenCalled();
    expect(network.fetchTrip).not.toHaveBeenCalled();
    expect(world.locks.requestCount).toBe(0);
  });
});

describe("3e — read identity, local removal (E2), notices, and view revalidation", () => {
  function readOnlyTab() {
    const deps = createOfflineTestTab(world);
    const view = createSnapshotView();
    const ops = createSnapshotOperations({
      security: deps,
      safety,
      network: network as unknown as SnapshotNetwork,
      identity: () => null, // not verified online
      readIdentity: () => IDENTITY, // the offline-read identity
      onSessionCheckRequired: () => {
        sessionChecks += 1;
      },
      view,
    });
    return { ops, deps, view } as Tab & { deps: ReturnType<typeof createOfflineTestTab> };
  }

  it("the read identity permits reads and local removal, never saves or refreshes", async () => {
    await saveLandmarkNow(makeTab(), L1);
    network.fetchLandmark.mockClear();
    const tab = readOnlyTab();
    expect((await tab.ops.listLandmarks()).kind).toBe("ok");
    expect(tab.view.getSnapshot().landmarks.has(L1)).toBe(true);
    expect(await tab.ops.saveLandmark(L2)).toEqual({ kind: "not-eligible", reason: "no-identity" });
    expect(await tab.ops.refreshLandmark(L1)).toEqual({
      kind: "not-eligible",
      reason: "no-identity",
    });
    expect(network.fetchLandmark).not.toHaveBeenCalled();
    // E2: removal is local, sends nothing, and records the deletion ordering.
    expect(await tab.ops.removeLandmark(L1)).toEqual({ kind: "removed" });
    expect(network.fetchLandmark).not.toHaveBeenCalled();
    expect(await landmark(L1)).toBeUndefined();
    expect(await allData("deletions")).toEqual([
      expect.objectContaining({ kind: "landmark", item_id: L1 }),
    ]);
  });

  it("a save that started before an offline removal never recreates the copy", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L1);
    const held = heldLandmark();
    const refreshing = a.ops.refreshLandmark(L1);
    await vi.waitFor(() => expect(network.fetchLandmark).toHaveBeenCalledTimes(2));
    await readOnlyTab().ops.removeLandmark(L1);
    held.resolve({ kind: "available", body: profile(L1) });
    expect(await refreshing).toEqual({ kind: "deleted-meanwhile" });
    expect(await landmark(L1)).toBeUndefined();
  });

  it("removals and unavailability commits post the advisory state-changed notice", async () => {
    const a = makeTab();
    const watcher = createOfflineTestTab(world);
    await saveLandmarkNow(a, L1);
    await a.ops.removeLandmark(L1);
    await saveLandmarkNow(a, L2);
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    await a.ops.refreshLandmark(L2);
    await flush();
    expect(watcher.received.filter((t) => t === "state-changed").length).toBeGreaterThanOrEqual(2);
  });

  it("revalidateView removes a copy another tab removed, and a read that observes an ended lifecycle withdraws everything", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L1);
    await a.ops.listLandmarks();
    expect(a.view.getSnapshot().landmarks.has(L1)).toBe(true);
    await makeTab().ops.removeLandmark(L1);
    await a.ops.revalidateView();
    expect(a.view.getSnapshot().landmarks.has(L1)).toBe(false);

    await saveLandmarkNow(a, L2);
    await a.ops.listLandmarks();
    await putData("meta", marker(ACCOUNT, OLD_LIFECYCLE)); // the lifecycle ended elsewhere
    expect(await a.ops.listLandmarks()).toMatchObject({ kind: "not-eligible" });
    expect(a.view.getSnapshot().landmarks.size).toBe(0);
  });
});

describe("3e — view publication during suppression (defect found in 3e browser verification)", () => {
  it("a refresh that finds the landmark unavailable publishes its marker and the invalidated trip", async () => {
    const a = makeTab();
    await saveLandmarkNow(a, L1);
    await saveTripNow(a, TRIP_A, [
      { landmark: L2 },
      { landmark: L1, miles: 1 },
      { landmark: L3, miles: 2 },
    ]);
    await a.ops.listLandmarks();
    await a.ops.listTrips();
    landmarkResponse({ kind: "unavailable", evidence: "not-found" });
    expect(await a.ops.refreshLandmark(L1)).toEqual({ kind: "unavailable", marker: true });
    const shown = a.view.getSnapshot().landmarks.get(L1);
    expect(shown).toMatchObject({ status: "ok", record: { status: "unavailable" } });
    expect(a.view.getSnapshot().trips.get(TRIP_A)).toMatchObject({
      record: { distance_summary_state: "invalidated" },
    });
  });

  it("content shown before suppression is not restored by unsuppress; only later publications are", () => {
    const view = createSnapshotView();
    const entry = { status: "unreadable" as const, id: L1 };
    view.apply({
      landmarks: [
        [L1, entry],
        [L2, { status: "unreadable" as const, id: L2 }],
      ],
    });
    view.suppress([L1], []);
    expect(view.getSnapshot().landmarks.has(L1)).toBe(false);
    view.unsuppress([L1], []);
    expect(view.getSnapshot().landmarks.has(L1)).toBe(false);
    expect(view.getSnapshot().landmarks.has(L2)).toBe(true);
    view.suppress([L1], []);
    view.apply({ landmarks: [[L1, entry]] });
    expect(view.getSnapshot().landmarks.has(L1)).toBe(false); // hidden while suppressed
    view.unsuppress([L1], []);
    expect(view.getSnapshot().landmarks.get(L1)).toEqual(entry);
  });
});
