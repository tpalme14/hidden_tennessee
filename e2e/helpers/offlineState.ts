import type { Page } from "@playwright/test";

/**
 * M06-T03 Increment 3c-1b — test-side inspection of the application's REAL
 * offline security state in the browser (Specification 6 §12.3–§12.6).
 *
 * `readOfflineState` is READ-ONLY: it lists databases, opens only databases
 * that already exist (an open without a version never creates or upgrades an
 * existing database), reads in read-only transactions, closes its
 * connections, and reads the D22 key without writing it.
 *
 * `seedResidualLandmark` (3c) and `seedLandmarkMarkers` (3e) are the
 * INSTRUMENTED writes: a scenario that needs records it cannot cheaply create
 * through the application seeds them itself, under the application's own
 * exclusive `tnle-offline-security` Web Lock, so they never interleave with
 * the application's security operations. `injectStorageFaults` and
 * `allowDroppingNotices` instrument one page only. Each is used only where a
 * scenario says so.
 */

export const DATA_DB = "tnle-offline-data";
export const STATE_DB = "tnle-offline-state";
export const SAFETY_LOCK_KEY = "tnle-offline-safety-lock";

export interface OfflineState {
  /** Names of the `tnle-offline-*` databases that exist. */
  databases: string[];
  marker: { account_id: string; lifecycle_id: string; verified_at: string } | null;
  intent: { pending: boolean; created_at: string } | null;
  failure: unknown;
  landmarks: number;
  safetyLock: string | null;
}

export function readOfflineState(page: Page): Promise<OfflineState> {
  return page.evaluate(
    async ({ dataDb, stateDb, lockKey }) => {
      const names = (await indexedDB.databases())
        .map((entry) => entry.name ?? "")
        .filter((name) => name.startsWith("tnle-offline-"))
        .sort();
      const openExisting = (name: string) =>
        new Promise<IDBDatabase | null>((resolve, reject) => {
          if (!names.includes(name)) {
            resolve(null);
            return;
          }
          const request = indexedDB.open(name);
          request.onupgradeneeded = () => {
            // Never create: abort if the database disappeared meanwhile.
            request.transaction?.abort();
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error(`open ${name} failed`));
        });
      const get = (db: IDBDatabase, store: string, key: string) =>
        new Promise<unknown>((resolve, reject) => {
          const request = db.transaction(store, "readonly").objectStore(store).get(key);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(new Error(`get ${store}/${key} failed`));
        });
      const count = (db: IDBDatabase, store: string) =>
        new Promise<number>((resolve, reject) => {
          const request = db.transaction(store, "readonly").objectStore(store).count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error(`count ${store} failed`));
        });

      const data = await openExisting(dataDb);
      const state = await openExisting(stateDb);
      try {
        return {
          databases: names,
          marker: (data ? await get(data, "meta", "marker") : null) as never,
          intent: (state ? await get(state, "state", "signout_intent") : null) as never,
          failure: state ? await get(state, "state", "failure") : null,
          landmarks: data ? await count(data, "landmarks") : 0,
          safetyLock: localStorage.getItem(lockKey),
        };
      } finally {
        data?.close();
        state?.close();
      }
    },
    { dataDb: DATA_DB, stateDb: STATE_DB, lockKey: SAFETY_LOCK_KEY },
  );
}

/** INSTRUMENTED: seeds one unavailable-landmark record owned by the given lifecycle. */
export function seedResidualLandmark(
  page: Page,
  owner: { account_id: string; lifecycle_id: string },
): Promise<void> {
  return page.evaluate(
    ({ dataDb, owner }) =>
      navigator.locks.request(
        "tnle-offline-security",
        { mode: "exclusive" },
        () =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(dataDb);
            request.onupgradeneeded = () => {
              request.transaction?.abort();
            };
            request.onerror = () => reject(new Error("seed: database missing"));
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction("landmarks", "readwrite");
              const now = new Date().toISOString();
              tx.objectStore("landmarks").put({
                schema_version: 1,
                account_id: owner.account_id,
                lifecycle_id: owner.lifecycle_id,
                revision: 1,
                landmark_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                status: "unavailable",
                saved_at: now,
                unavailable_recorded_at: now,
              });
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => {
                db.close();
                reject(new Error("seed: write failed"));
              };
            };
          }),
      ),
    { dataDb: DATA_DB, owner },
  );
}

/** Names of the Web Locks currently held and pending in this origin (all tabs). */
export function lockQuery(page: Page): Promise<{ held: string[]; pending: string[] }> {
  return page.evaluate(async () => {
    const snapshot = await navigator.locks.query();
    return {
      held: (snapshot.held ?? []).map((lock) => lock.name ?? ""),
      pending: (snapshot.pending ?? []).map((lock) => lock.name ?? ""),
    };
  });
}

// ---------------------------------------------------------------------------
// M06-T03 Increment 3c-2 — INSTRUMENTED conditions for the recovery scenarios
// ---------------------------------------------------------------------------

/**
 * INSTRUMENTED: records a durable cleanup-failure record, as the application
 * does when a cleanup fails, under the application's exclusive
 * `tnle-offline-security` lock. The state database must already exist.
 */
export function seedFailureRecord(page: Page): Promise<void> {
  return page.evaluate(
    ({ stateDb }) =>
      navigator.locks.request(
        "tnle-offline-security",
        { mode: "exclusive" },
        () =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(stateDb);
            request.onupgradeneeded = () => {
              request.transaction?.abort();
            };
            request.onerror = () => reject(new Error("seed failure: database missing"));
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction("state", "readwrite");
              tx.objectStore("state").put({
                key: "failure",
                schema_version: 1,
                kind: "cleanup",
                recorded_at: new Date().toISOString(),
              });
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => {
                db.close();
                reject(new Error("seed failure: write failed"));
              };
            };
          }),
      ),
    { stateDb: STATE_DB },
  );
}

/**
 * INSTRUMENTED: opens a raw connection to the offline data database that
 * IGNORES `versionchange`, so a deletion stays blocked until
 * `closeBlockingConnection`. Application tabs close their connections; only
 * this test connection blocks.
 */
export function openBlockingConnection(page: Page): Promise<void> {
  return page.evaluate(
    ({ dataDb }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dataDb);
        request.onupgradeneeded = () => {
          request.transaction?.abort();
        };
        request.onerror = () => reject(new Error("blocking connection: database missing"));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            // Deliberately not closed.
          };
          (window as unknown as { __tnleBlocker?: IDBDatabase }).__tnleBlocker = db;
          resolve();
        };
      }),
    { dataDb: DATA_DB },
  );
}

export function closeBlockingConnection(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as { __tnleBlocker?: IDBDatabase };
    w.__tnleBlocker?.close();
    delete w.__tnleBlocker;
  });
}

/**
 * INSTRUMENTED init scripts that make specific browser storage operations
 * fail in ONE page (the application code is unchanged):
 * - `state-put`: `IDBObjectStore.put` throws for the `state` store (the
 *   sign-out intent and failure records cannot be written);
 * - `data-clear`: `IDBObjectStore.clear` throws (cleanup cannot remove records);
 * - `local-storage-set`: `Storage.setItem` throws (D22 cannot be written).
 */
/**
 * INSTRUMENTED (3e): seeds `count` unavailable-landmark markers owned by the
 * given lifecycle, under the application's exclusive security lock, to reach
 * the per-lifecycle saved-landmark limit without hundreds of real saves.
 */
export function seedLandmarkMarkers(
  page: Page,
  owner: { account_id: string; lifecycle_id: string },
  count: number,
): Promise<void> {
  return page.evaluate(
    ({ dataDb, owner, count }) =>
      navigator.locks.request(
        "tnle-offline-security",
        { mode: "exclusive" },
        () =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(dataDb);
            request.onupgradeneeded = () => {
              request.transaction?.abort();
            };
            request.onerror = () => reject(new Error("seed: database missing"));
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction("landmarks", "readwrite");
              const now = new Date().toISOString();
              for (let n = 0; n < count; n += 1) {
                tx.objectStore("landmarks").put({
                  schema_version: 1,
                  account_id: owner.account_id,
                  lifecycle_id: owner.lifecycle_id,
                  revision: 1,
                  landmark_id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`,
                  status: "unavailable",
                  saved_at: now,
                  unavailable_recorded_at: now,
                });
              }
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => {
                db.close();
                reject(new Error("seed: write failed"));
              };
            };
          }),
      ),
    { dataDb: DATA_DB, owner, count },
  );
}

/**
 * INSTRUMENTED (3e): lets a page DROP incoming cross-tab notices while
 * `window.__tnleDropNotices` is true, to show that rendered content is
 * withdrawn by revalidation, not only by notices. Sending is unaffected.
 */
export async function allowDroppingNotices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(BroadcastChannel.prototype, "onmessage");
    if (descriptor?.set === undefined || descriptor.get === undefined) return;
    const { get, set } = descriptor;
    Object.defineProperty(BroadcastChannel.prototype, "onmessage", {
      configurable: true,
      get(this: BroadcastChannel) {
        return get.call(this) as unknown;
      },
      set(this: BroadcastChannel, handler: ((event: MessageEvent) => void) | null) {
        set.call(
          this,
          handler === null
            ? null
            : (event: MessageEvent) => {
                if ((window as { __tnleDropNotices?: boolean }).__tnleDropNotices !== true) {
                  handler.call(this, event);
                }
              },
        );
      },
    });
  });
}

export type StorageFault = "state-put" | "data-clear" | "local-storage-set" | "landmark-put-quota";

export async function injectStorageFaults(page: Page, faults: StorageFault[]): Promise<void> {
  await page.addInitScript((active: string[]) => {
    if (active.includes("state-put")) {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
        if (this.name === "state") throw new DOMException("injected", "UnknownError");
        return (put as (...a: unknown[]) => IDBRequest).apply(this, args);
      } as typeof put;
    }
    if (active.includes("landmark-put-quota")) {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
        if (this.name === "landmarks") throw new DOMException("injected", "QuotaExceededError");
        return (put as (...a: unknown[]) => IDBRequest).apply(this, args);
      } as typeof put;
    }
    if (active.includes("data-clear")) {
      IDBObjectStore.prototype.clear = function () {
        throw new DOMException("injected", "UnknownError");
      };
    }
    if (active.includes("local-storage-set")) {
      Storage.prototype.setItem = function () {
        throw new DOMException("injected", "QuotaExceededError");
      };
    }
  }, faults);
}
