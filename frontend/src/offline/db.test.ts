import {
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
} from "fake-indexeddb";
import type { DBSchema, IDBPDatabase } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectAvailableLandmark, projectAvailableTrip } from "./projection";
import { validateStoredLandmark } from "./records";
import { flush } from "./testSupport";

/**
 * M06-T03 Increment 3a — the offline database definitions against
 * `fake-indexeddb` (an in-memory IndexedDB for Node; it is NOT a real browser
 * and proves nothing about real storage, quota, or eviction). Every test gets
 * a fresh, isolated `IDBFactory`; the IndexedDB globals are stubbed per test
 * (idb checks `instanceof` against them) and restored afterwards.
 */

let factory: IDBFactory;
/** An isolated, test-only database for the DR-6 blocked-upgrade verification. */
const DR6_TEST_DB = "tnle-test-dr6-blocked-upgrade";

beforeEach(() => {
  factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  for (const [name, value] of Object.entries({
    IDBCursor,
    IDBCursorWithValue,
    IDBDatabase,
    IDBFactory,
    IDBIndex,
    IDBKeyRange,
    IDBObjectStore,
    IDBOpenDBRequest,
    IDBRequest,
    IDBTransaction,
    IDBVersionChangeEvent,
  })) {
    vi.stubGlobal(name, value);
  }
});

afterEach(async () => {
  for (const name of ["tnle-offline-data", "tnle-offline-state", DR6_TEST_DB]) {
    await new Promise<void>((resolve) => {
      const request = factory.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LIFECYCLE_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIFECYCLE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const LANDMARK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TRIP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T1 = "2026-11-26T10:00:00.000Z";
const PLANTED_VERSION = 987_654_321;
const PLANTED_CREATED = "2001-02-03T04:05:06.789Z";

const profile = {
  id: LANDMARK,
  display_name: "Synthetic Falls",
  category: "falls",
  latitude: 35.5,
  longitude: -85.5,
  source_description: null,
  source_access_label: null,
  source_url: null,
};

function landmarkRecord(account: string, lifecycle: string) {
  return projectAvailableLandmark(profile, LANDMARK, {
    account_id: account,
    lifecycle_id: lifecycle,
    revision: 1,
    saved_at: T1,
  })!;
}

/** Store, key-path, and index inventory of an open raw database. */
function inventory(db: IDBDatabase) {
  const names = [...db.objectStoreNames].sort();
  const tx = db.transaction(names, "readonly");
  return Object.fromEntries(
    names.map((name) => {
      const store = tx.objectStore(name);
      const indexes = Object.fromEntries(
        [...store.indexNames].map((indexName) => {
          const index = store.index(indexName);
          return [
            indexName,
            { keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry },
          ];
        }),
      );
      return [name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes }];
    }),
  );
}

describe("module import", () => {
  it("opens no database when the modules are imported", async () => {
    const open = vi.spyOn(factory, "open");
    vi.resetModules();
    await import("./db");
    await import("./records");
    await import("./projection");
    await import("./safetyLock");
    expect(open).not.toHaveBeenCalled();
    expect(await factory.databases()).toEqual([]);
  });
});

describe("tnle-offline-data (schema v1)", () => {
  it("creates exactly the approved stores, key paths, and indexes", async () => {
    const { openOfflineDataDatabase, closeOfflineDatabase } = await import("./db");
    const result = await openOfflineDataDatabase();
    if (result.kind !== "open") throw new Error(`expected open, got ${result.kind}`);
    expect(result.db.version).toBe(1);
    const lifecycleIndex = {
      by_lifecycle: { keyPath: ["account_id", "lifecycle_id"], unique: false, multiEntry: false },
    };
    expect(inventory(result.db as unknown as IDBDatabase)).toEqual({
      deletions: {
        keyPath: ["account_id", "lifecycle_id", "kind", "item_id"],
        autoIncrement: false,
        indexes: lifecycleIndex,
      },
      invalidations: {
        keyPath: ["account_id", "lifecycle_id", "landmark_id"],
        autoIncrement: false,
        indexes: lifecycleIndex,
      },
      landmarks: {
        keyPath: ["account_id", "lifecycle_id", "landmark_id"],
        autoIncrement: false,
        indexes: lifecycleIndex,
      },
      meta: { keyPath: "key", autoIncrement: false, indexes: {} },
      trips: {
        keyPath: ["account_id", "lifecycle_id", "trip_id"],
        autoIncrement: false,
        indexes: lifecycleIndex,
      },
    });
    closeOfflineDatabase(result.db);
  });

  it("scopes records by account and lifecycle: the same landmark is a separate record per owner, and the index returns only one lifecycle", async () => {
    const { openOfflineDataDatabase, closeOfflineDatabase } = await import("./db");
    const result = await openOfflineDataDatabase();
    if (result.kind !== "open") throw new Error(result.kind);
    const db = result.db;
    await db.put("landmarks", landmarkRecord(ACCOUNT_A, LIFECYCLE_1));
    await db.put("landmarks", landmarkRecord(ACCOUNT_A, LIFECYCLE_2));
    await db.put("landmarks", landmarkRecord(ACCOUNT_B, LIFECYCLE_1));
    expect(await db.count("landmarks")).toBe(3);
    const a1 = await db.getAllFromIndex("landmarks", "by_lifecycle", [ACCOUNT_A, LIFECYCLE_1]);
    expect(a1).toHaveLength(1);
    expect((a1[0] as { account_id: string; lifecycle_id: string }).lifecycle_id).toBe(LIFECYCLE_1);
    expect(await db.get("landmarks", [ACCOUNT_B, LIFECYCLE_2, LANDMARK])).toBeUndefined();
    const stored = await db.get("landmarks", [ACCOUNT_A, LIFECYCLE_1, LANDMARK]);
    expect(validateStoredLandmark(stored).ok).toBe(true);
    closeOfflineDatabase(db);
  });

  it("the account marker lives in the same database as the snapshots and can join one transaction", async () => {
    const { openOfflineDataDatabase, closeOfflineDatabase } = await import("./db");
    const result = await openOfflineDataDatabase();
    if (result.kind !== "open") throw new Error(result.kind);
    const tx = result.db.transaction(
      ["meta", "landmarks", "trips", "invalidations", "deletions"],
      "readwrite",
    );
    await tx.objectStore("meta").put({
      key: "marker",
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_1,
      verified_at: T1,
    });
    await tx.objectStore("landmarks").put(landmarkRecord(ACCOUNT_A, LIFECYCLE_1));
    await tx.done;
    expect(await result.db.get("meta", "marker")).toMatchObject({ lifecycle_id: LIFECYCLE_1 });
    closeOfflineDatabase(result.db);
  });

  it("stores a projected trip without any planted response-only value (version, sharing, created_at)", async () => {
    const { openOfflineDataDatabase, closeOfflineDatabase } = await import("./db");
    const result = await openOfflineDataDatabase();
    if (result.kind !== "open") throw new Error(result.kind);
    const trip = projectAvailableTrip(
      {
        trip: {
          id: TRIP,
          name: "Weekend loop",
          version: PLANTED_VERSION,
          created_at: PLANTED_CREATED,
          updated_at: T1,
          is_shared: true,
          sharing_enabled: true,
          stops: [],
          distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
        },
      },
      TRIP,
      { account_id: ACCOUNT_A, lifecycle_id: LIFECYCLE_1, revision: 1, saved_at: T1 },
    )!;
    await result.db.put("trips", trip);
    // Inspect what is actually stored, across every store.
    const everything: unknown[] = [];
    for (const store of ["meta", "landmarks", "trips", "invalidations", "deletions"] as const) {
      everything.push(...(await result.db.getAll(store)));
    }
    const json = JSON.stringify(everything);
    expect(json).toContain("Weekend loop");
    expect(json.includes(String(PLANTED_VERSION))).toBe(false);
    expect(json.includes(PLANTED_CREATED)).toBe(false);
    expect(/is_shared|sharing_enabled|"version"|created_at/.test(json)).toBe(false);
    closeOfflineDatabase(result.db);
  });

  it("reopens an existing database without re-running the upgrade, keeping its records", async () => {
    const db = await import("./db");
    const first = await db.openOfflineDataDatabase();
    if (first.kind !== "open") throw new Error(first.kind);
    await first.db.put("landmarks", landmarkRecord(ACCOUNT_A, LIFECYCLE_1));
    db.closeOfflineDatabase(first.db);
    const upgrade = vi.spyOn(db, "upgradeDataDatabase");
    const second = await db.openOfflineDataDatabase();
    if (second.kind !== "open") throw new Error(second.kind);
    expect(await second.db.count("landmarks")).toBe(1);
    expect(upgrade).not.toHaveBeenCalled();
    db.closeOfflineDatabase(second.db);
  });

  it("an explicit close ends the connection", async () => {
    const { openOfflineDataDatabase, closeOfflineDatabase } = await import("./db");
    const result = await openOfflineDataDatabase();
    if (result.kind !== "open") throw new Error(result.kind);
    closeOfflineDatabase(result.db);
    expect(() => result.db.transaction("meta")).toThrow();
  });

  it("closes itself and reports a version change when another context deletes the database (deletion then succeeds)", async () => {
    const { openOfflineDataDatabase } = await import("./db");
    const onVersionChange = vi.fn();
    const result = await openOfflineDataDatabase({ onVersionChange });
    if (result.kind !== "open") throw new Error(result.kind);
    const outcome = await new Promise<string>((resolve) => {
      const request = factory.deleteDatabase("tnle-offline-data");
      request.onsuccess = () => resolve("deleted");
      request.onblocked = () => resolve("blocked");
      request.onerror = () => resolve("error");
    });
    expect(onVersionChange).toHaveBeenCalledTimes(1);
    expect(outcome).toBe("deleted");
    expect(() => result.db.transaction("meta")).toThrow(); // already closed
  });

  it("reports a newer stored version without deleting or downgrading it", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("tnle-offline-data", 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const { openOfflineDataDatabase } = await import("./db");
    expect(await openOfflineDataDatabase()).toEqual({ kind: "newer-version" });
    expect(await factory.databases()).toEqual([{ name: "tnle-offline-data", version: 2 }]);
  });

  it("reports IndexedDB as unavailable when it does not exist or access is denied", async () => {
    const { openOfflineDataDatabase } = await import("./db");
    vi.stubGlobal("indexedDB", undefined);
    expect(await openOfflineDataDatabase()).toEqual({ kind: "unavailable" });
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(await openOfflineDataDatabase()).toEqual({ kind: "unavailable" });
  });

  it("reports any other open failure as failed (and creates nothing)", async () => {
    const { openOfflineDataDatabase } = await import("./db");
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("disk", "UnknownError");
      },
    });
    expect(await openOfflineDataDatabase()).toEqual({ kind: "failed" });
    expect(await factory.databases()).toEqual([]);
  });
});

describe("tnle-offline-state (schema v1)", () => {
  it("creates exactly the state store, separate from the data database", async () => {
    const { openOfflineStateDatabase, closeOfflineDatabase } = await import("./db");
    const result = await openOfflineStateDatabase();
    if (result.kind !== "open") throw new Error(result.kind);
    expect(inventory(result.db as unknown as IDBDatabase)).toEqual({
      state: { keyPath: "key", autoIncrement: false, indexes: {} },
    });
    await result.db.put("state", {
      key: "signout_intent",
      schema_version: 1,
      pending: true,
      created_at: T1,
    });
    expect(await result.db.get("state", "signout_intent")).toEqual({
      key: "signout_intent",
      schema_version: 1,
      pending: true,
      created_at: T1,
    });
    closeOfflineDatabase(result.db);
    expect((await factory.databases()).map((d) => d.name)).toEqual(["tnle-offline-state"]);
  });

  it("deleting the data database leaves the state database and its intent untouched", async () => {
    const db = await import("./db");
    const data = await db.openOfflineDataDatabase();
    const state = await db.openOfflineStateDatabase();
    if (data.kind !== "open" || state.kind !== "open") throw new Error("open failed");
    await state.db.put("state", {
      key: "signout_intent",
      schema_version: 1,
      pending: true,
      created_at: T1,
    });
    db.closeOfflineDatabase(data.db);
    await new Promise<void>((resolve) => {
      const request = factory.deleteDatabase("tnle-offline-data");
      request.onsuccess = () => resolve();
    });
    expect(await state.db.get("state", "signout_intent")).toMatchObject({ pending: true });
    db.closeOfflineDatabase(state.db);
  });
});

// ---------------------------------------------------------------------------
// 3b-iii-d (DR-1) — non-creating probe
// ---------------------------------------------------------------------------

function rawCreate(name: string, version: number, setup: (db: IDBDatabase) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => setup(request.result as unknown as IDBDatabase);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

function deleteOutcome(name: string) {
  return new Promise<string>((resolve) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve("deleted");
    request.onblocked = () => resolve("blocked");
    request.onerror = () => resolve("error");
  });
}

/** The oldVersion seen by a later ordinary versioned open (0 means it did not exist). */
function laterOpenOldVersion(name: string) {
  return new Promise<number | "no-upgrade">((resolve, reject) => {
    const request = factory.open(name, 1);
    let oldVersion: number | "no-upgrade" = "no-upgrade";
    request.onupgradeneeded = (event) => {
      oldVersion = event.oldVersion;
    };
    request.onsuccess = () => {
      request.result.close();
      resolve(oldVersion);
    };
    request.onerror = () => reject(request.error);
  });
}

type Scripted = {
  result: { close: () => void };
  transaction: { abort: () => void } | null;
  error: DOMException | null;
  onupgradeneeded?: (event: { oldVersion: number }) => void;
  onsuccess?: () => void;
  onerror?: (event: { preventDefault: () => void }) => void;
};

/** An `indexedDB` stand-in whose open request follows `script` (event-sequence edge cases). */
function scriptedIndexedDb(script: (request: Scripted) => void) {
  const close = vi.fn();
  return {
    close,
    factory: {
      open: () => {
        const request: Scripted = { result: { close }, transaction: null, error: null };
        setTimeout(() => script(request), 0);
        return request;
      },
    },
  };
}

const fail = (request: Scripted, name: string) => {
  request.error = new DOMException("synthetic", name);
  request.onerror?.({ preventDefault: () => undefined });
};

describe("3b-iii-d non-creating probe (DR-1)", () => {
  it("an absent database stays absent: no database is listed, a second probe again finds it absent, and a later open still upgrades from 0", async () => {
    const { probeOfflineDataDatabase, probeOfflineStateDatabase } = await import("./db");
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "absent" });
    expect(await probeOfflineStateDatabase()).toEqual({ kind: "absent" });
    expect(await factory.databases()).toEqual([]);
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "absent" });
    expect(await factory.databases()).toEqual([]);
    expect(await laterOpenOldVersion("tnle-offline-data")).toBe(0);
  });

  it("an existing v1 database is returned at its own version with its records unchanged; the upgrade never runs", async () => {
    const db = await import("./db");
    const seeded = await db.openOfflineDataDatabase();
    if (seeded.kind !== "open") throw new Error(seeded.kind);
    await seeded.db.put("landmarks", landmarkRecord(ACCOUNT_A, LIFECYCLE_1));
    db.closeOfflineDatabase(seeded.db);
    const upgrade = vi.spyOn(db, "upgradeDataDatabase");
    const probed = await db.probeOfflineDataDatabase();
    if (probed.kind !== "open") throw new Error(probed.kind);
    expect(probed.db.version).toBe(1);
    expect(await probed.db.count("landmarks")).toBe(1);
    probed.db.close();
    expect(upgrade).not.toHaveBeenCalled();
    expect(await factory.databases()).toEqual([{ name: "tnle-offline-data", version: 1 }]);
  });

  it("the returned connection closes itself when another context needs a version change", async () => {
    const { openOfflineStateDatabase, probeOfflineStateDatabase } = await import("./db");
    const seeded = await openOfflineStateDatabase();
    if (seeded.kind !== "open") throw new Error(seeded.kind);
    seeded.db.close();
    const probed = await probeOfflineStateDatabase();
    if (probed.kind !== "open") throw new Error(probed.kind);
    expect(await deleteOutcome("tnle-offline-state")).toBe("deleted");
    expect(() => probed.db.transaction("state")).toThrow();
  });

  it("a newer stored version is reported, never upgraded, and its connection is closed", async () => {
    await rawCreate("tnle-offline-data", 2, () => undefined);
    const { probeOfflineDataDatabase } = await import("./db");
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "unsupported-version", version: 2 });
    expect(await factory.databases()).toEqual([{ name: "tnle-offline-data", version: 2 }]);
    expect(await deleteOutcome("tnle-offline-data")).toBe("deleted");
  });

  it("an unexpected store, key-path, or index inventory is reported, unchanged, and its connection is closed", async () => {
    const { probeOfflineStateDatabase, probeOfflineDataDatabase } = await import("./db");
    await rawCreate("tnle-offline-state", 1, (db) => {
      db.createObjectStore("state", { keyPath: "id" });
    });
    expect(await probeOfflineStateDatabase()).toEqual({ kind: "unexpected-schema" });
    expect(await deleteOutcome("tnle-offline-state")).toBe("deleted");
    await rawCreate("tnle-offline-state", 1, (db) => {
      db.createObjectStore("state", { keyPath: "key" });
      db.createObjectStore("extra", { keyPath: "key" });
    });
    expect(await probeOfflineStateDatabase()).toEqual({ kind: "unexpected-schema" });
    await rawCreate("tnle-offline-data", 1, (db) => {
      for (const name of ["meta", "landmarks", "trips", "invalidations", "deletions"]) {
        db.createObjectStore(name, { keyPath: name === "meta" ? "key" : ["account_id"] });
      }
    });
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "unexpected-schema" });
    expect(await deleteOutcome("tnle-offline-state")).toBe("deleted");
    expect(await deleteOutcome("tnle-offline-data")).toBe("deleted");
  });

  it("reports unavailable storage when IndexedDB does not exist or access is denied", async () => {
    const { probeOfflineDataDatabase } = await import("./db");
    vi.stubGlobal("indexedDB", undefined);
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "unavailable" });
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "unavailable" });
  });

  it("an open failure is never absence: a thrown error, an error event, and an arbitrary AbortError without this probe's creation abort are all failed", async () => {
    const { probeOfflineDataDatabase } = await import("./db");
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("disk", "UnknownError");
      },
    });
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "failed" });
    for (const name of ["UnknownError", "AbortError", "QuotaExceededError"]) {
      vi.stubGlobal("indexedDB", scriptedIndexedDb((request) => fail(request, name)).factory);
      expect(await probeOfflineDataDatabase()).toEqual({ kind: "failed" });
    }
    expect(await factory.databases()).toEqual([]);
  });

  it("an unexpected event sequence is indeterminate: the abort throws, oldVersion is not 0, or the creation fails with another error", async () => {
    const { probeOfflineDataDatabase } = await import("./db");
    const throwing = scriptedIndexedDb((request) => {
      request.transaction = {
        abort: () => {
          throw new DOMException("finished", "InvalidStateError");
        },
      };
      request.onupgradeneeded?.({ oldVersion: 0 });
      fail(request, "AbortError");
    });
    vi.stubGlobal("indexedDB", throwing.factory);
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "indeterminate" });
    expect(throwing.close).toHaveBeenCalled(); // the creation connection is closed anyway

    vi.stubGlobal(
      "indexedDB",
      scriptedIndexedDb((request) => {
        request.transaction = { abort: () => undefined };
        request.onupgradeneeded?.({ oldVersion: 1 });
        fail(request, "AbortError");
      }).factory,
    );
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "indeterminate" });

    vi.stubGlobal(
      "indexedDB",
      scriptedIndexedDb((request) => {
        request.transaction = { abort: () => undefined };
        request.onupgradeneeded?.({ oldVersion: 0 });
        fail(request, "UnknownError");
      }).factory,
    );
    expect(await probeOfflineDataDatabase()).toEqual({ kind: "indeterminate" });
  });
});

/** Test-only v1 → v2 transition; production versions stay at 1 (no migration). */
interface Dr6Schema extends DBSchema {
  items: { key: string; value: unknown };
  added: { key: string; value: unknown };
}
const DR6_RECORD = { key: "k1", label: "synthetic" };

function dr6Upgrade(target: 1 | 2) {
  return (db: IDBPDatabase<Dr6Schema>, oldVersion: number) => {
    const raw = db as unknown as IDBDatabase;
    if (oldVersion < 1) raw.createObjectStore("items", { keyPath: "key" });
    if (target >= 2 && oldVersion < 2) raw.createObjectStore("added", { keyPath: "key" });
  };
}

function rawOpen(version: number, setup: (request: IDBOpenDBRequest) => void = () => undefined) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DR6_TEST_DB, version);
    setup(request as unknown as IDBOpenDBRequest);
    request.onsuccess = () => resolve(request.result as unknown as IDBDatabase);
    request.onerror = () => reject(request.error);
  });
}

describe("DR-6 blocked upgrade (isolated test database)", () => {
  it("a deliberately retained older connection genuinely blocks the upgrade; it settles only after that connection closes, preserving records", async () => {
    const { openWith } = await import("./db");
    const seeded = await openWith<Dr6Schema>(DR6_TEST_DB, 1, dr6Upgrade(1), {});
    if (seeded.kind !== "open") throw new Error(seeded.kind);
    await seeded.db.put("items", DR6_RECORD);
    seeded.db.close();

    // Opened directly, NOT through openWith: it never closes itself on a version change.
    const retained = await rawOpen(1);
    let retainedVersionChanges = 0;
    retained.onversionchange = () => {
      retainedVersionChanges += 1;
    };

    const onBlocked = vi.fn();
    const upgrade = vi.fn(dr6Upgrade(2));
    let settled = "pending";
    const pending = openWith<Dr6Schema>(DR6_TEST_DB, 2, upgrade, { onBlocked });
    void pending.then(
      (result) => (settled = result.kind),
      () => (settled = "rejected"),
    );
    for (let i = 0; i < 5; i += 1) await flush();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(retainedVersionChanges).toBe(1);
    expect(settled).toBe("pending"); // neither a premature success nor a failure
    expect(upgrade).not.toHaveBeenCalled();

    retained.close();
    const result = await pending;
    if (result.kind !== "open") throw new Error(result.kind);
    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(upgrade.mock.calls[0]?.[1]).toBe(1);
    expect(result.db.version).toBe(2);
    expect([...result.db.objectStoreNames].sort()).toEqual(["added", "items"]);
    expect(await result.db.get("items", "k1")).toEqual(DR6_RECORD);
    result.db.close();

    const deleted = await new Promise<string>((resolve) => {
      const request = factory.deleteDatabase(DR6_TEST_DB);
      request.onsuccess = () => resolve("deleted");
      request.onblocked = () => resolve("blocked");
      request.onerror = () => resolve("error");
    });
    expect(deleted).toBe("deleted");
    expect(await factory.databases()).toEqual([]);
  });

  it("the application's own connection closes itself on a version change and reports it, so it never blocks another context's upgrade", async () => {
    const { openWith } = await import("./db");
    const onVersionChange = vi.fn();
    const app = await openWith<Dr6Schema>(DR6_TEST_DB, 1, dr6Upgrade(1), { onVersionChange });
    if (app.kind !== "open") throw new Error(app.kind);
    await app.db.put("items", DR6_RECORD);

    const otherBlocked = vi.fn();
    const other = await rawOpen(2, (request) => {
      request.onblocked = otherBlocked;
      request.onupgradeneeded = () => {
        request.result.createObjectStore("added", { keyPath: "key" });
      };
    });
    expect(onVersionChange).toHaveBeenCalledTimes(1);
    expect(otherBlocked).not.toHaveBeenCalled();
    expect(() => app.db.transaction("items")).toThrow(); // closed by the application itself
    expect(other.version).toBe(2);
    const count = await new Promise<number>((resolve, reject) => {
      const request = other.transaction("items").objectStore("items").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(count).toBe(1);
    other.close();
  });
});
