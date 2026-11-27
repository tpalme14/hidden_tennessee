import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupAll,
  cleanupResidual,
  deleteAllOfflineData,
  type DatabaseDeleter,
  type DeletionProgress,
  type DeletionRequestLike,
} from "./cleanup";
import { DATA_DB_NAME, openOfflineDataDatabase, openOfflineStateDatabase } from "./db";
import { releaseLocalBlock } from "./lifecycle";
import { createLockCoordinator, SECURITY_LOCK } from "./locks";
import { validateStoredLandmark } from "./records";
import { SAFETY_LOCK_KEY } from "./safetyLock";
import { readSecurityState } from "./securityState";
import {
  createOfflineTestTab,
  createOfflineTestWorld,
  deferred,
  flush,
  ignoreClears,
  injectTransactionFailures,
  openBlockingConnection,
  type OfflineTestWorld,
} from "./testSupport";

/**
 * M06-T03 Increment 3b-iii-b — residual and full cleanup, failure recording,
 * and "Delete all offline data". fake-indexeddb, FakeLockManager, and an
 * in-memory D22 store are stand-ins: they model documented contracts and are
 * NOT evidence of real browser deletion, blocking, or termination behavior.
 * Every asynchronous operation started by a test is settled before it ends.
 */

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LIFECYCLE_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIFECYCLE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ITEM_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ITEM_2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const T0 = "2026-11-25T09:00:00.000Z";

const marker = (account = ACCOUNT_A, lifecycle = LIFECYCLE_1) => ({
  key: "marker",
  schema_version: 1,
  account_id: account,
  lifecycle_id: lifecycle,
  verified_at: T0,
});
const landmark = (account: string, lifecycle: string, id = ITEM_1) => ({
  schema_version: 1,
  account_id: account,
  lifecycle_id: lifecycle,
  revision: 1,
  landmark_id: id,
  status: "unavailable",
  saved_at: T0,
  unavailable_recorded_at: T0,
});
/** Owner-keyed but malformed content (an invalid timestamp). */
const malformedLandmark = (account: string, lifecycle: string) => ({
  ...landmark(account, lifecycle, ITEM_2),
  saved_at: "not-a-time",
});
const invalidation = (account: string, lifecycle: string) => ({
  schema_version: 1,
  account_id: account,
  lifecycle_id: lifecycle,
  landmark_id: ITEM_1,
  seq: 1,
  recorded_at: T0,
});
const deletion = (account: string, lifecycle: string) => ({
  schema_version: 1,
  account_id: account,
  lifecycle_id: lifecycle,
  kind: "trip",
  item_id: ITEM_1,
  seq: 2,
});
const sequence = (account: string, lifecycle: string, value = 2) => ({
  key: "sequence",
  schema_version: 1,
  account_id: account,
  lifecycle_id: lifecycle,
  value,
});
const intent = { key: "signout_intent", schema_version: 1, pending: true, created_at: T0 };
const failure = { key: "failure", schema_version: 1, kind: "invalidation", recorded_at: T0 };

async function withData<T>(fn: (db: DataDb) => Promise<T>): Promise<T> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  try {
    return await fn(opened.db as unknown as DataDb);
  } finally {
    opened.db.close();
  }
}
type DataDb = {
  put(store: string, value: unknown): Promise<unknown>;
  get(store: string, key: unknown): Promise<unknown>;
  getAll(store: string): Promise<unknown[]>;
  count(store: string): Promise<number>;
};
const putData = (store: string, value: unknown) => withData((db) => db.put(store, value));
const countAll = () =>
  withData(async (db) => {
    const counts: Record<string, number> = {};
    for (const name of ["meta", "landmarks", "trips", "invalidations", "deletions"]) {
      counts[name] = await db.count(name);
    }
    return counts;
  });
async function stateRecords(): Promise<Record<string, unknown>> {
  const opened = await openOfflineStateDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const intentValue: unknown = await opened.db.get("state", "signout_intent");
  const failureValue: unknown = await opened.db.get("state", "failure");
  opened.db.close();
  return { intent: intentValue, failure: failureValue };
}
async function putState(value: unknown) {
  const opened = await openOfflineStateDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  await opened.db.put("state", value);
  opened.db.close();
}
async function classify(tab = createOfflineTestTab(world)) {
  const result = await readSecurityState(tab);
  if (result.kind !== "done") throw new Error(result.kind);
  return result.value;
}

let world: OfflineTestWorld;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("residual cleanup (ordinary)", () => {
  it("keeps the marker and every current-owner record and metadata; removes foreign records", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("meta", sequence(ACCOUNT_A, LIFECYCLE_1));
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    await putData("landmarks", malformedLandmark(ACCOUNT_A, LIFECYCLE_1));
    await putData("invalidations", invalidation(ACCOUNT_A, LIFECYCLE_1));
    await putData("deletions", deletion(ACCOUNT_A, LIFECYCLE_1));
    // Foreign: another lifecycle of the same account, and another account (valid and malformed).
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_2));
    await putData("landmarks", malformedLandmark(ACCOUNT_B, LIFECYCLE_2));
    await putData("trips", { ...landmark(ACCOUNT_B, LIFECYCLE_2), trip_id: ITEM_1 });
    await putData("invalidations", invalidation(ACCOUNT_B, LIFECYCLE_2));
    await putData("deletions", deletion(ACCOUNT_A, LIFECYCLE_2));
    expect((await classify()).primary).toBe("residual");

    const other = createOfflineTestTab(world);
    expect(await cleanupResidual(createOfflineTestTab(world))).toEqual({
      kind: "cleaned",
      mode: "residual",
      after: "lifecycle",
    });
    expect(await countAll()).toEqual({
      meta: 2,
      landmarks: 2,
      trips: 0,
      invalidations: 1,
      deletions: 1,
    });
    await withData(async (db) => {
      expect(await db.get("meta", "marker")).toEqual(marker());
      expect(await db.get("meta", "sequence")).toEqual(sequence(ACCOUNT_A, LIFECYCLE_1));
      // Preserved does NOT mean valid: the owner-keyed malformed copy still fails validation.
      const kept = await db.get("landmarks", [ACCOUNT_A, LIFECYCLE_1, ITEM_2]);
      expect(validateStoredLandmark(kept).ok).toBe(false);
      expect(await db.get("invalidations", [ACCOUNT_A, LIFECYCLE_1, ITEM_1])).toBeDefined();
      expect(await db.get("deletions", [ACCOUNT_A, LIFECYCLE_1, "trip", ITEM_1])).toBeDefined();
    });
    await flush();
    expect(other.received).toEqual(["state-changed"]);
  });

  it("removes a foreign sequence but keeps the marker", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("meta", sequence(ACCOUNT_B, LIFECYCLE_2));
    expect(await cleanupResidual(createOfflineTestTab(world))).toMatchObject({
      kind: "cleaned",
      after: "lifecycle",
    });
    await withData(async (db) => {
      expect(await db.get("meta", "sequence")).toBeUndefined();
      expect(await db.get("meta", "marker")).toEqual(marker());
    });
  });

  it("without a marker every data record is residual and is removed", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    await putData("meta", sequence(ACCOUNT_A, LIFECYCLE_1, -1)); // invalid, no marker: residual
    expect(await cleanupResidual(createOfflineTestTab(world))).toEqual({
      kind: "cleaned",
      mode: "residual",
      after: "none",
    });
    expect((await classify()).evidence.dataEmpty).toBe(true);
  });

  const refusals: [string, () => Promise<unknown> | void, string, object?][] = [
    ["a malformed marker", () => putData("meta", { ...marker(), extra: 1 }), "unreadable"],
    [
      "an invalid sequence beside a valid marker",
      async () => {
        await putData("meta", marker());
        await putData("meta", sequence(ACCOUNT_A, LIFECYCLE_1, -1));
      },
      "unreadable",
    ],
    ["an unknown meta key", () => putData("meta", { key: "future-thing" }), "unreadable"],
    ["a pending intent", () => putState(intent), "intent-pending"],
    ["a failure record", () => putState(failure), "failure"],
    ["D22", () => world.storage.setItem(SAFETY_LOCK_KEY, "true"), "safety-lock"],
    // The seeded record then belongs to the marker's own lifecycle.
    ["nothing residual", () => putData("meta", marker(ACCOUNT_B, LIFECYCLE_2)), "lifecycle"],
  ];
  for (const [label, arrange, reason] of refusals) {
    it(`refuses (fails closed) with ${label}, removing nothing`, async () => {
      world = createOfflineTestWorld();
      await putData("landmarks", landmark(ACCOUNT_B, LIFECYCLE_2));
      await arrange();
      const before = await countAll();
      expect(await cleanupResidual(createOfflineTestTab(world))).toEqual({
        kind: "refused",
        reason,
      });
      expect(await countAll()).toEqual(before);
    });
  }

  it("refuses when the state database is unreadable", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_B, LIFECYCLE_2));
    const tab = createOfflineTestTab(world, {
      openState: () => Promise.resolve({ kind: "unavailable" }),
    });
    expect(await cleanupResidual(tab)).toEqual({ kind: "refused", reason: "unreadable" });
    expect((await countAll()).landmarks).toBe(1);
  });

  it("a failed removal writes and verifies a cleanup failure record; residual records remain as durable evidence", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_B, LIFECYCLE_2));
    const other = createOfflineTestTab(world);
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await cleanupResidual(createOfflineTestTab(world, { openData: failing.opener }));
    expect(result).toEqual({
      kind: "failed",
      stage: "transaction",
      escalation: { failureRecord: "written", safetyLock: null },
      remaining: {
        observed: "failure",
        durableBlocking: true,
        failureRecordDurable: true,
        safetyLockDurable: false,
      },
    });
    expect((await stateRecords()).failure).toMatchObject({ key: "failure", kind: "cleanup" });
    expect((await countAll()).landmarks).toBe(1);
    await flush();
    expect(other.received).toContain("failure-changed");
  });
});

describe("full cleanup", () => {
  it("ordinary without a valid marker: clears all five stores in ONE transaction; intent, failure record, and D22 survive", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    await putData("trips", { ...landmark(ACCOUNT_A, LIFECYCLE_1), trip_id: ITEM_1 });
    await putData("invalidations", invalidation(ACCOUNT_A, LIFECYCLE_1));
    await putData("deletions", deletion(ACCOUNT_A, LIFECYCLE_1));
    await putData("meta", sequence(ACCOUNT_A, LIFECYCLE_1));
    await putState(intent);
    await putState(failure);
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const data = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      () => false,
    );
    const result = await cleanupAll(createOfflineTestTab(world, { openData: data.opener }));
    expect(result).toEqual({ kind: "cleaned", mode: "ordinary-full", after: "safety-lock" });
    expect(await countAll()).toEqual({
      meta: 0,
      landmarks: 0,
      trips: 0,
      invalidations: 0,
      deletions: 0,
    });
    const writes = data.log.filter((call) => call.mode === "readwrite");
    expect(writes).toHaveLength(1);
    expect([...writes[0]!.stores].sort()).toEqual([
      "deletions",
      "invalidations",
      "landmarks",
      "meta",
      "trips",
    ]);
    expect(await stateRecords()).toEqual({ intent, failure });
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });

  it("ordinary for a terminated lifecycle (pending intent): the surviving marker is removed", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putState(intent);
    expect(await cleanupAll(createOfflineTestTab(world))).toEqual({
      kind: "cleaned",
      mode: "ordinary-full",
      after: "intent-pending",
    });
    expect((await countAll()).meta).toBe(0);
  });

  it("a valid non-terminated lifecycle requires destructive; destructive blocks locally first", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    const tab = createOfflineTestTab(world);
    const other = createOfflineTestTab(world);
    expect(await cleanupAll(tab)).toEqual({ kind: "refused", reason: "destructive-required" });
    expect(await countAll()).toMatchObject({ meta: 1, landmarks: 1 });
    expect(tab.generation.isBlocked()).toBe(false);
    const pending = cleanupAll(tab, { destructive: true });
    expect(tab.generation.isBlocked()).toBe(true); // synchronous, before any wait
    expect(await pending).toEqual({ kind: "cleaned", mode: "destructive-full", after: "none" });
    expect((await classify()).evidence.dataEmpty).toBe(true);
    await flush();
    expect(other.received).toEqual(["lifecycle-ended", "state-changed"]);
  });

  it("a malformed marker requires destructive", async () => {
    world = createOfflineTestWorld();
    await putData("meta", { ...marker(), verified_at: "x" });
    expect(await cleanupAll(createOfflineTestTab(world))).toEqual({
      kind: "refused",
      reason: "destructive-required",
    });
    expect(await cleanupAll(createOfflineTestTab(world), { destructive: true })).toMatchObject({
      kind: "cleaned",
    });
  });

  it("verification is separate: a store that silently ignores clear() is reported as failed, not cleaned", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    const tab = createOfflineTestTab(world, {
      openData: ignoreClears(() => openOfflineDataDatabase()),
    });
    const result = await cleanupAll(tab);
    expect(result).toMatchObject({
      kind: "failed",
      stage: "verification",
      escalation: { failureRecord: "written", safetyLock: null },
    });
    expect((await countAll()).landmarks).toBe(1);
  });

  it("a failed transaction is all-or-nothing and joins (never replaces) an existing failure record", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    await putState(failure); // kind "invalidation", recorded first
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await cleanupAll(createOfflineTestTab(world, { openData: failing.opener }));
    expect(result).toMatchObject({
      kind: "failed",
      stage: "transaction",
      escalation: { failureRecord: "joined", safetyLock: null },
      remaining: { durableBlocking: true, failureRecordDurable: true },
    });
    expect((await stateRecords()).failure).toEqual(failure); // unchanged, not exhaustive
    expect((await countAll()).landmarks).toBe(1);
  });

  it("a malformed failure record is preserved and D22 is escalated", async () => {
    world = createOfflineTestWorld();
    const malformed = { ...failure, kind: "other" };
    await putState(malformed);
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await cleanupAll(createOfflineTestTab(world, { openData: failing.opener }));
    expect(result).toMatchObject({
      escalation: { failureRecord: "preserved-malformed", safetyLock: { durable: true } },
    });
    expect((await stateRecords()).failure).toEqual(malformed);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });

  it("state database and D22 both failing: reported separately; remaining residual records are still durable blocking evidence", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    world.storage.failSet = true;
    const data = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await cleanupAll(
      createOfflineTestTab(world, { openData: data.opener, openState: state.opener }),
    );
    expect(result).toEqual({
      kind: "failed",
      stage: "transaction",
      escalation: {
        failureRecord: "write-failed",
        safetyLock: { durable: false, reason: "write-failed" },
      },
      remaining: {
        observed: "residual",
        durableBlocking: true,
        failureRecordDurable: false,
        safetyLockDurable: false,
      },
    });
  });

  it("an unreadable observation after failure is not claimed as durable evidence", async () => {
    world = createOfflineTestWorld();
    world.storage.failSet = true;
    const tab = createOfflineTestTab(world, {
      openData: () => Promise.resolve({ kind: "unavailable" }),
      openState: () => Promise.resolve({ kind: "unavailable" }),
    });
    const result = await cleanupAll(tab, { destructive: true });
    expect(result).toMatchObject({
      kind: "failed",
      escalation: { failureRecord: "state-unreadable", safetyLock: { durable: false } },
      remaining: { observed: "unreadable", durableBlocking: false },
    });
  });

  it("fails closed without a usable security lock", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    const tab = createOfflineTestTab(world, {
      coordinator: createLockCoordinator(() => undefined),
    });
    expect(await cleanupAll(tab)).toEqual({ kind: "unavailable" });
    expect(await cleanupResidual(tab)).toEqual({ kind: "unavailable" });
    expect((await countAll()).landmarks).toBe(1);
  });
});

describe("Delete all offline data", () => {
  /** A deleter whose outcome the test controls; it always settles before the test ends. */
  function manualDeleter() {
    const calls: string[] = [];
    let request: DeletionRequestLike | undefined;
    const deleter: DatabaseDeleter = (name) => {
      calls.push(name);
      request = { onsuccess: null, onerror: null, onblocked: null };
      return request;
    };
    return {
      deleter,
      calls,
      succeed: () => request?.onsuccess?.(),
      fail: () => request?.onerror?.({}),
      block: () => request?.onblocked?.(),
    };
  }

  it("blocks and notifies first, holds the exclusive lock, deletes only the data database, and preserves intent, failure record, and D22", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    await putState(intent);
    await putState(failure);
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const other = createOfflineTestTab(world);
    const tab = createOfflineTestTab(world);
    const pending = deleteAllOfflineData(tab);
    expect(tab.generation.isBlocked()).toBe(true);
    const result = await pending;
    expect(result).toEqual({
      blockToken: 1,
      deletion: "completed",
      path: "ordinary",
      blockedObserved: false,
      preserved: { safetyLock: "present", intent: "pending", failure: "present" },
      safetyLock: null,
      failureEscalation: null,
      serverSignOut: "not-implied",
      recovery: "not-authorized",
    });
    // Browser-confirmed deletion; the data database is NOT reopened or recreated to prove it.
    expect((await world.factory.databases()).map((d) => d.name)).toEqual(["tnle-offline-state"]);
    expect(await stateRecords()).toEqual({ intent, failure });
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect(tab.generation.isBlocked()).toBe(true); // no automatic unblocking
    await flush();
    expect(other.received).toEqual(["lifecycle-ended", "state-changed"]);
    // A later release is still refused: deletion is not recovery.
    expect(await releaseLocalBlock(result.blockToken, tab)).toEqual({
      kind: "blocked",
      reason: "safety-lock",
    });
  });

  it("a blocked deletion stays pending with the lock held; completion only after the blocking connection closes", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    const blocker = await openBlockingConnection(world.factory, DATA_DB_NAME);
    const progress: DeletionProgress[] = [];
    const blockedSeen = deferred();
    const tab = createOfflineTestTab(world);
    let settled = false;
    const pending = deleteAllOfflineData(tab, {
      onProgress: (p) => {
        progress.push(p);
        if (p === "blocked") blockedSeen.resolve();
      },
    }).then((r) => {
      settled = true;
      return r;
    });
    await blockedSeen.promise;
    // A later security operation queues behind the held lock.
    const reader = readSecurityState(createOfflineTestTab(world));
    await flush();
    try {
      expect(progress).toEqual(["requested", "pending", "blocked"]);
      expect(blocker.versionChanges()).toBe(1);
      expect(settled).toBe(false); // never completion on "blocked"
      expect(world.locks.snapshot().held).toEqual([{ name: SECURITY_LOCK, mode: "exclusive" }]);
      expect(world.locks.snapshot().pending).toEqual([{ name: SECURITY_LOCK, mode: "shared" }]);
    } finally {
      blocker.close();
      await Promise.allSettled([pending, reader]); // settle before teardown
    }
    const result = await pending;
    expect(result).toMatchObject({ deletion: "completed", blockedObserved: true });
    expect((await reader).kind).toBe("done");
  });

  it("a later open waits behind the pending deletion (stand-in connection-queue ordering) and finds a fresh database", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    const blocker = await openBlockingConnection(world.factory, DATA_DB_NAME);
    const blockedSeen = deferred();
    const pending = deleteAllOfflineData(createOfflineTestTab(world), {
      onProgress: (p) => {
        if (p === "blocked") blockedSeen.resolve();
      },
    });
    await blockedSeen.promise;
    let opened = false;
    const later = openOfflineDataDatabase().then((r) => {
      opened = true;
      return r;
    });
    await flush();
    try {
      expect(opened).toBe(false);
    } finally {
      blocker.close();
      await Promise.allSettled([pending, later]); // settle before teardown
    }
    const result = await later;
    if (result.kind !== "open") throw new Error(result.kind);
    expect(await result.db.count("landmarks")).toBe(0);
    result.db.close();
  });

  it("a deletion that never settles keeps the lock and reports nothing as complete (until the browser answers)", async () => {
    world = createOfflineTestWorld();
    const manual = manualDeleter();
    let settled = false;
    const pending = deleteAllOfflineData(createOfflineTestTab(world), {
      deleter: manual.deleter,
    }).then((r) => {
      settled = true;
      return r;
    });
    try {
      for (let i = 0; i < 5; i += 1) await flush();
      expect(manual.calls).toEqual([DATA_DB_NAME]);
      expect(settled).toBe(false);
      expect(world.locks.snapshot().held).toEqual([{ name: SECURITY_LOCK, mode: "exclusive" }]);
      manual.block();
      await flush();
      expect(settled).toBe(false);
    } finally {
      manual.succeed(); // settle before the test ends
      await Promise.allSettled([pending]);
    }
    expect((await pending).deletion).toBe("completed");
  });

  it("a browser-reported failure or a thrown request is failed, with a failure record written", async () => {
    for (const make of [
      () => {
        const manual = manualDeleter();
        return { deleter: manual.deleter, after: () => manual.fail() };
      },
      () => ({
        deleter: (() => {
          throw new DOMException("synthetic", "UnknownError");
        }) as DatabaseDeleter,
        after: () => undefined,
      }),
    ]) {
      world = createOfflineTestWorld();
      const { deleter, after } = make();
      const pending = deleteAllOfflineData(createOfflineTestTab(world), { deleter });
      for (let i = 0; i < 5; i += 1) await flush();
      after();
      const result = await pending;
      expect(result).toMatchObject({
        deletion: "failed",
        failureEscalation: { failureRecord: "written", safetyLock: null },
      });
      expect((await stateRecords()).failure).toMatchObject({ kind: "cleanup" });
    }
  });

  it("no deletion when the security lock cannot be acquired; the local block stays", async () => {
    world = createOfflineTestWorld();
    const manual = manualDeleter();
    const tab = createOfflineTestTab(world, {
      coordinator: createLockCoordinator(() => undefined),
    });
    const result = await deleteAllOfflineData(tab, { deleter: manual.deleter });
    expect(result).toMatchObject({
      deletion: "not-attempted",
      refusal: "coordination-unavailable",
      path: "none",
    });
    expect(manual.calls).toEqual([]);
    expect(tab.generation.isBlocked()).toBe(true);
  });

  it("unreadable security state: D22 is established and verified before deletion", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world, {
      openState: () => Promise.resolve({ kind: "unavailable" }),
    });
    const result = await deleteAllOfflineData(tab);
    expect(result).toMatchObject({
      deletion: "completed",
      path: "unreadable-state",
      preserved: { intent: "unreadable", failure: "unreadable" },
      safetyLock: { durable: true },
    });
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });

  it("unreadable security state with D22 failing: no deletion request is issued", async () => {
    world = createOfflineTestWorld();
    world.storage.failSet = true;
    const manual = manualDeleter();
    const tab = createOfflineTestTab(world, {
      openState: () => Promise.resolve({ kind: "unavailable" }),
    });
    const result = await deleteAllOfflineData(tab, { deleter: manual.deleter });
    expect(result).toMatchObject({
      deletion: "not-attempted",
      refusal: "protection-not-established",
      path: "unreadable-state",
      safetyLock: { durable: false },
    });
    expect(manual.calls).toEqual([]);
    expect(tab.generation.isBlocked()).toBe(true);
  });
});

describe("c2a — writeOrJoinFailure validation-refusal (transaction-abort) branch", () => {
  // An injected invalid clock makes the freshly built failure record fail its own
  // validator: exceptional-path robustness evidence, not an ordinary browser condition.
  const invalidClock = () => "not-a-timestamp";

  it("aborts and settles the transaction, persists no record, escalates to D22, and reports it truthfully", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", landmark(ACCOUNT_B, LIFECYCLE_2));
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const tab = createOfflineTestTab(world, { openData: failing.opener, now: invalidClock });
    const result = await cleanupResidual(tab);
    expect(result).toEqual({
      kind: "failed",
      stage: "transaction",
      escalation: { failureRecord: "write-failed", safetyLock: { durable: true } },
      remaining: {
        observed: "safety-lock",
        durableBlocking: true,
        failureRecordDurable: false,
        safetyLockDurable: true,
      },
    });
    expect((await stateRecords()).failure).toBeUndefined(); // nothing invalid persisted
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect((await countAll()).landmarks).toBe(1);
    // The aborted transaction settled: a later valid failure record can be written.
    const later = await cleanupAll(createOfflineTestTab(world, { openData: failing.opener }));
    expect(later).toMatchObject({ kind: "failed", escalation: { failureRecord: "written" } });
  });

  it("an existing valid record is still joined (the abort branch is not reached)", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    await putData("landmarks", landmark(ACCOUNT_A, LIFECYCLE_1));
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const tab = createOfflineTestTab(world, { openData: failing.opener, now: invalidClock });
    expect(await cleanupAll(tab)).toMatchObject({
      escalation: { failureRecord: "joined", safetyLock: null },
    });
    expect((await stateRecords()).failure).toEqual(failure);
  });

  it("with D22 also failing and no other durable evidence, the outcome is reported as memory-only; the local block remains", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    world.storage.failSet = true;
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const tab = createOfflineTestTab(world, { openData: failing.opener, now: invalidClock });
    const result = await cleanupAll(tab, { destructive: true });
    expect(result).toEqual({
      kind: "failed",
      stage: "transaction",
      escalation: {
        failureRecord: "write-failed",
        safetyLock: { durable: false, reason: "write-failed" },
      },
      remaining: {
        observed: "lifecycle",
        durableBlocking: false,
        failureRecordDurable: false,
        safetyLockDurable: false,
      },
    });
    expect((await stateRecords()).failure).toBeUndefined();
    expect(tab.generation.isBlocked()).toBe(true);
  });
});
