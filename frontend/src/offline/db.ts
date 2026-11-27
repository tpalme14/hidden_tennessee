import {
  openDB,
  wrap,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from "idb";

/**
 * Offline IndexedDB definitions (M06-T03 Increment 3a; Specification 6 v1.1
 * §12.2–§12.8; decision D-c). Two databases:
 *
 * - `tnle-offline-data` — the account marker and every account-scoped record,
 *   so a commit can check the marker in the SAME transaction (OFF-LIFE-6).
 * - `tnle-offline-state` — only records "Delete all offline data" must not
 *   remove: the sign-out intent and the durable failure record (OFF-LIFE-9,
 *   OFF-FAIL-3).
 *
 * Transactions cannot span the two databases, and splitting them is not
 * itself a coordination protocol: how security state is coordinated across
 * them is decided in Increment 3b. The D22 safety lock lives in
 * `localStorage` (`safetyLock.ts`), not here.
 *
 * Nothing is opened when this module is imported: callers invoke the open
 * functions explicitly. Values are typed `unknown` so every read must go
 * through the validators in `records.ts`. An open or upgrade failure is
 * reported, never "repaired" by deleting or recreating a database, and no
 * security state is ever cleared here.
 */

export const DATA_DB_NAME = "tnle-offline-data";
export const STATE_DB_NAME = "tnle-offline-state";
/** IndexedDB versions equal the schema version (`OFFLINE_SCHEMA_VERSION`). */
export const DATA_DB_VERSION = 1;
export const STATE_DB_VERSION = 1;

type LifecycleKey = [account_id: string, lifecycle_id: string];

export interface OfflineDataSchema extends DBSchema {
  /** `marker` and `sequence` records, keyed by their `key` field. */
  meta: { key: string; value: unknown };
  landmarks: {
    key: [account_id: string, lifecycle_id: string, landmark_id: string];
    value: unknown;
    indexes: { by_lifecycle: LifecycleKey };
  };
  trips: {
    key: [account_id: string, lifecycle_id: string, trip_id: string];
    value: unknown;
    indexes: { by_lifecycle: LifecycleKey };
  };
  invalidations: {
    key: [account_id: string, lifecycle_id: string, landmark_id: string];
    value: unknown;
    indexes: { by_lifecycle: LifecycleKey };
  };
  deletions: {
    key: [account_id: string, lifecycle_id: string, kind: string, item_id: string];
    value: unknown;
    indexes: { by_lifecycle: LifecycleKey };
  };
}

export interface OfflineStateSchema extends DBSchema {
  /** `signout_intent` and `failure` records, keyed by their `key` field. */
  state: { key: string; value: unknown };
}

/** The exact v1 store and index inventory (documentation and tests). */
export const DATA_DB_V1_STORES = {
  meta: { keyPath: "key", indexes: {} },
  landmarks: {
    keyPath: ["account_id", "lifecycle_id", "landmark_id"],
    indexes: { by_lifecycle: { keyPath: ["account_id", "lifecycle_id"], unique: false } },
  },
  trips: {
    keyPath: ["account_id", "lifecycle_id", "trip_id"],
    indexes: { by_lifecycle: { keyPath: ["account_id", "lifecycle_id"], unique: false } },
  },
  invalidations: {
    keyPath: ["account_id", "lifecycle_id", "landmark_id"],
    indexes: { by_lifecycle: { keyPath: ["account_id", "lifecycle_id"], unique: false } },
  },
  deletions: {
    keyPath: ["account_id", "lifecycle_id", "kind", "item_id"],
    indexes: { by_lifecycle: { keyPath: ["account_id", "lifecycle_id"], unique: false } },
  },
} as const;

export const STATE_DB_V1_STORES = {
  state: { keyPath: "key", indexes: {} },
} as const;

type StoreDefinition = {
  keyPath: string | readonly string[];
  indexes: Record<string, { keyPath: string | readonly string[]; unique: boolean }>;
};

function createStores<S extends DBSchema>(
  db: IDBPDatabase<S>,
  stores: Record<string, StoreDefinition>,
): void {
  const raw = db as unknown as IDBDatabase;
  for (const [name, definition] of Object.entries(stores)) {
    const store = raw.createObjectStore(name, {
      keyPath: definition.keyPath as string | string[],
    });
    for (const [indexName, index] of Object.entries(definition.indexes)) {
      store.createIndex(indexName, index.keyPath as string | string[], { unique: index.unique });
    }
  }
}

/** Version-aware upgrade: each step runs only when upgrading from an older version. */
export function upgradeDataDatabase(
  db: IDBPDatabase<OfflineDataSchema>,
  oldVersion: number,
  _transaction?: IDBPTransaction<
    OfflineDataSchema,
    StoreNames<OfflineDataSchema>[],
    "versionchange"
  >,
): void {
  if (oldVersion < 1) createStores(db, DATA_DB_V1_STORES);
  // Future schema versions add their own `if (oldVersion < N)` steps here.
}

export function upgradeStateDatabase(
  db: IDBPDatabase<OfflineStateSchema>,
  oldVersion: number,
): void {
  if (oldVersion < 1) createStores(db, STATE_DB_V1_STORES);
}

/** Notifications from an open request or an open connection. */
export interface OpenEvents {
  /** An upgrade is waiting for other connections (for example another tab) to close. */
  onBlocked?: () => void;
  /**
   * Another context needs this database upgraded or deleted. The connection
   * has ALREADY been closed; the caller must drop in-memory account data and
   * reopen before any further access.
   */
  onVersionChange?: () => void;
  /** The browser closed the connection abnormally. */
  onTerminated?: () => void;
}

export type OpenResult<S extends DBSchema> =
  | { kind: "open"; db: IDBPDatabase<S> }
  /** No IndexedDB, or access denied (for example some private modes; OFF-STORE-5). */
  | { kind: "unavailable" }
  /** The stored database is newer than this application understands (locks the library). */
  | { kind: "newer-version" }
  /** Any other open or upgrade failure; nothing was deleted or recreated. */
  | { kind: "failed" };

function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false; // accessing `indexedDB` itself can throw (SecurityError)
  }
}

/**
 * Opens `name` at `version`, reporting a blocked upgrade, closing this
 * connection when another context needs a version change, and classifying
 * failures. Exported for the 3b-i blocked-upgrade verification (DR-6) and for
 * the two database-specific wrappers below.
 */
export async function openWith<S extends DBSchema>(
  name: string,
  version: number,
  upgrade: (db: IDBPDatabase<S>, oldVersion: number) => void,
  events: OpenEvents,
): Promise<OpenResult<S>> {
  if (!indexedDbAvailable()) return { kind: "unavailable" };
  try {
    const db = await openDB<S>(name, version, {
      upgrade: (database, oldVersion) => upgrade(database, oldVersion),
      blocked: () => events.onBlocked?.(),
      blocking: () => {
        db.close(); // never hold up another context's upgrade or deletion
        events.onVersionChange?.();
      },
      terminated: () => events.onTerminated?.(),
    });
    return { kind: "open", db };
  } catch (error) {
    const name = error instanceof DOMException || error instanceof Error ? error.name : "";
    if (name === "VersionError") return { kind: "newer-version" };
    if (name === "SecurityError") return { kind: "unavailable" };
    return { kind: "failed" };
  }
}

/** Opens (creating or upgrading if needed) `tnle-offline-data`. Explicit call only. */
export function openOfflineDataDatabase(
  events: OpenEvents = {},
): Promise<OpenResult<OfflineDataSchema>> {
  return openWith<OfflineDataSchema>(DATA_DB_NAME, DATA_DB_VERSION, upgradeDataDatabase, events);
}

/** Opens (creating or upgrading if needed) `tnle-offline-state`. Explicit call only. */
export function openOfflineStateDatabase(
  events: OpenEvents = {},
): Promise<OpenResult<OfflineStateSchema>> {
  return openWith<OfflineStateSchema>(
    STATE_DB_NAME,
    STATE_DB_VERSION,
    upgradeStateDatabase,
    events,
  );
}

// ---------------------------------------------------------------------------
// 3b-iii-d (DR-1) — non-creating probe
// ---------------------------------------------------------------------------

/**
 * Outcome of a probe that never creates, upgrades, or deletes a database.
 * Only `absent` and `open` are positive findings; every other kind fails
 * closed. `absent` is a point-in-time observation (Q54).
 */
export type ProbeResult<S extends DBSchema> =
  /** This request saw `upgradeneeded` (oldVersion 0), aborted that creation, and then failed with `AbortError`. */
  | { kind: "absent" }
  /** An existing database at the expected version with exactly the expected inventory. */
  | { kind: "open"; db: IDBPDatabase<S> }
  /** An existing database at any other version; closed, never upgraded. */
  | { kind: "unsupported-version"; version: number }
  /** The expected version, but a different store, key-path, or index inventory; closed. */
  | { kind: "unexpected-schema" }
  /** No IndexedDB, or access refused (SecurityError). */
  | { kind: "unavailable" }
  /** Any other open failure. Never treated as absence. */
  | { kind: "failed" }
  /** An unexpected event sequence (for example the creation abort could not be confirmed). */
  | { kind: "indeterminate" };

function errorName(error: unknown): string {
  return error instanceof DOMException || error instanceof Error ? error.name : "";
}

function sameKeyPath(actual: string | string[] | null, expected: string | readonly string[]) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/** True when `db` holds exactly `expected`'s stores, key paths, and indexes. Throws on read failure. */
function inventoryMatches(db: IDBDatabase, expected: Record<string, StoreDefinition>): boolean {
  const actualNames = [...db.objectStoreNames].sort();
  const expectedNames = Object.keys(expected).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) return false;
  const tx = db.transaction(actualNames, "readonly"); // no request is issued; it completes on its own
  return expectedNames.every((name) => {
    const definition = expected[name] as StoreDefinition;
    const store = tx.objectStore(name);
    if (store.autoIncrement || !sameKeyPath(store.keyPath, definition.keyPath)) return false;
    const indexNames = [...store.indexNames].sort();
    if (JSON.stringify(indexNames) !== JSON.stringify(Object.keys(definition.indexes).sort())) {
      return false;
    }
    return indexNames.every((indexName) => {
      const index = store.index(indexName);
      const want = definition.indexes[indexName];
      return (
        want !== undefined &&
        index.unique === want.unique &&
        !index.multiEntry &&
        sameKeyPath(index.keyPath, want.keyPath)
      );
    });
  });
}

/**
 * Probes `name` WITHOUT creating, upgrading, or deleting it (DR-1). The open
 * passes no version, so an existing database opens at its own version. If the
 * database does not exist, this request's `upgradeneeded` (oldVersion 0) is
 * answered by aborting that creation; absence is reported only when the same
 * request then fails with `AbortError` (Q54). Every connection not returned is
 * closed; the returned one closes itself on `versionchange`. A probe that
 * never settles authorizes nothing (Q55).
 */
export function probeWith<S extends DBSchema>(
  name: string,
  expectedVersion: number,
  expectedStores: Record<string, StoreDefinition>,
): Promise<ProbeResult<S>> {
  if (!indexedDbAvailable()) return Promise.resolve({ kind: "unavailable" });
  return new Promise<ProbeResult<S>>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name);
    } catch (error) {
      resolve({ kind: errorName(error) === "SecurityError" ? "unavailable" : "failed" });
      return;
    }
    let creation: "none" | "aborted" | "anomalous" = "none";
    request.onupgradeneeded = (event) => {
      creation = "anomalous";
      try {
        if (event.oldVersion === 0 && request.transaction !== null) {
          request.transaction.abort();
          creation = "aborted";
        }
      } catch {
        creation = "anomalous";
      }
      try {
        request.result.close();
      } catch {
        // already closed by the abort
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (creation !== "none") {
        db.close();
        resolve({ kind: "indeterminate" });
        return;
      }
      if (db.version !== expectedVersion) {
        db.close();
        resolve({ kind: "unsupported-version", version: db.version });
        return;
      }
      let matches: boolean;
      try {
        matches = inventoryMatches(db, expectedStores);
      } catch {
        db.close();
        resolve({ kind: "failed" });
        return;
      }
      if (!matches) {
        db.close();
        resolve({ kind: "unexpected-schema" });
        return;
      }
      db.onversionchange = () => db.close(); // never hold up another context
      resolve({ kind: "open", db: wrap(db) as unknown as IDBPDatabase<S> });
    };
    request.onerror = (event) => {
      event.preventDefault();
      const failure = errorName(request.error);
      if (creation === "aborted" && failure === "AbortError") resolve({ kind: "absent" });
      else if (creation !== "none") resolve({ kind: "indeterminate" });
      else resolve({ kind: failure === "SecurityError" ? "unavailable" : "failed" });
    };
  });
}

/** Probes `tnle-offline-data` without creating it. Explicit call only. */
export function probeOfflineDataDatabase(): Promise<ProbeResult<OfflineDataSchema>> {
  return probeWith<OfflineDataSchema>(DATA_DB_NAME, DATA_DB_VERSION, DATA_DB_V1_STORES);
}

/** Probes `tnle-offline-state` without creating it. Explicit call only. */
export function probeOfflineStateDatabase(): Promise<ProbeResult<OfflineStateSchema>> {
  return probeWith<OfflineStateSchema>(STATE_DB_NAME, STATE_DB_VERSION, STATE_DB_V1_STORES);
}

/** Closes a connection opened by this module. */
export function closeOfflineDatabase(
  db: IDBPDatabase<OfflineDataSchema> | IDBPDatabase<OfflineStateSchema>,
): void {
  db.close();
}
