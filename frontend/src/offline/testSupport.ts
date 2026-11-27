/**
 * TEST-ONLY stand-ins for M06-T03 Increment 3b-i unit tests. Not imported by
 * application code. They model the documented contracts; they are NOT
 * evidence of real browser behavior.
 *
 * `FakeLockManager` models the W3C Web Locks request algorithm as relevant
 * here: one FIFO queue per name in which only the FIRST item is grantable
 * (so a shared request waits behind an earlier queued exclusive request);
 * exclusive is grantable when no lock of that name is held, shared when no
 * exclusive one is held; `ifAvailable` invokes the callback with `null`
 * without queueing when not grantable; an abort before grant rejects with the
 * signal's reason and dequeues, and is ignored after grant; the lock is
 * released when the callback's promise settles, and `request()` then settles
 * with the callback's result; invalid option combinations reject with
 * `NotSupportedError`.
 *
 * `createBroadcastHub` returns a BroadcastChannel-like constructor whose
 * instances deliver structured clones asynchronously to the OTHER open
 * instances of the same name (never to the sender).
 */

import {
  IDBCursor as FakeIDBCursor,
  IDBCursorWithValue as FakeIDBCursorWithValue,
  IDBDatabase as FakeIDBDatabase,
  IDBFactory as FakeIDBFactory,
  IDBIndex as FakeIDBIndex,
  IDBKeyRange as FakeIDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
  IDBOpenDBRequest as FakeIDBOpenDBRequest,
  IDBRequest as FakeIDBRequest,
  IDBTransaction as FakeIDBTransaction,
  IDBVersionChangeEvent as FakeIDBVersionChangeEvent,
} from "fake-indexeddb";
import type { DBSchema, IDBPDatabase } from "idb";
import { vi } from "vitest";
import { openOfflineDataDatabase, openOfflineStateDatabase, type OpenResult } from "./db";
import { createLockCoordinator, type LockManagerLike } from "./locks";
import { createNoticeChannel, type NoticeType } from "./notices";
import { createSafetyLock } from "./safetyLock";
import { createSecurityGeneration } from "./securityGeneration";
import type { SecurityDeps } from "./securityState";

export type FakeLockMode = "exclusive" | "shared";

interface FakeLockOptions {
  mode?: FakeLockMode;
  ifAvailable?: boolean;
  steal?: boolean;
  signal?: AbortSignal;
}

interface PendingRequest {
  name: string;
  mode: FakeLockMode;
  callback: (lock: { name: string; mode: FakeLockMode } | null) => unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface FakeLockSnapshot {
  held: { name: string; mode: FakeLockMode }[];
  pending: { name: string; mode: FakeLockMode }[];
}

export class FakeLockManager {
  private readonly held: { name: string; mode: FakeLockMode }[] = [];
  private readonly queues = new Map<string, PendingRequest[]>();
  /** Number of `request()` calls received (for "nothing was requested" assertions). */
  requestCount = 0;

  request(
    name: string,
    options: FakeLockOptions,
    callback: PendingRequest["callback"],
  ): Promise<unknown> {
    this.requestCount += 1;
    const mode = options.mode ?? "exclusive";
    const notSupported = () => Promise.reject(new DOMException("", "NotSupportedError"));
    if (name.startsWith("-")) return notSupported();
    if (options.steal && options.ifAvailable) return notSupported();
    if (options.steal && mode !== "exclusive") return notSupported();
    if ((options.steal || options.ifAvailable) && options.signal) return notSupported();
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);

    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { name, mode, callback, resolve, reject };
      const queue = this.queueFor(name);
      if (options.ifAvailable && !(queue.length === 0 && this.modeAllowed(name, mode))) {
        // Not queued: the callback runs with null on a later task.
        void Promise.resolve()
          .then(() => callback(null))
          .then(resolve, reject);
        return;
      }
      if (options.signal) {
        const signal = options.signal;
        pending.signal = signal;
        pending.onAbort = () => {
          const index = queue.indexOf(pending);
          if (index < 0) return; // already granted: ignored
          queue.splice(index, 1);
          reject(signal.reason);
          this.process(name);
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      queue.push(pending);
      this.process(name);
    });
  }

  /** Mirrors `LockManager.query()`. */
  snapshot(): FakeLockSnapshot {
    return {
      held: this.held.map((lock) => ({ ...lock })),
      pending: [...this.queues.values()].flat().map(({ name, mode }) => ({ name, mode })),
    };
  }

  private queueFor(name: string): PendingRequest[] {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = [];
      this.queues.set(name, queue);
    }
    return queue;
  }

  private modeAllowed(name: string, mode: FakeLockMode): boolean {
    const same = this.held.filter((lock) => lock.name === name);
    return mode === "exclusive" ? same.length === 0 : same.every((l) => l.mode === "shared");
  }

  private process(name: string): void {
    const queue = this.queueFor(name);
    // Only the first queued request is grantable (FIFO).
    for (let next = queue[0]; next && this.modeAllowed(name, next.mode); next = queue[0]) {
      queue.shift();
      this.grant(next);
    }
  }

  private grant(request: PendingRequest): void {
    if (request.signal && request.onAbort) {
      request.signal.removeEventListener("abort", request.onAbort);
    }
    const lock = { name: request.name, mode: request.mode };
    this.held.push(lock);
    const release = () => {
      this.held.splice(this.held.indexOf(lock), 1);
      this.process(request.name);
    };
    void Promise.resolve()
      .then(() => request.callback(lock))
      .then(
        (value) => {
          release();
          request.resolve(value);
        },
        (error: unknown) => {
          release();
          request.reject(error);
        },
      );
  }
}

/** Resolves after pending microtasks and one macrotask. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A manually settled promise. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface HubChannel {
  name: string;
  closed: boolean;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface BroadcastHub {
  /** A BroadcastChannel-like constructor bound to this hub. */
  Channel: new (name: string) => {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage(message: unknown): void;
    close(): void;
  };
  /** Number of channels constructed. */
  created(): number;
  /** Number of channels currently open. */
  openCount(): number;
}

export function createBroadcastHub(): BroadcastHub {
  const channels: HubChannel[] = [];
  let created = 0;

  class Channel implements HubChannel {
    closed = false;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(readonly name: string) {
      created += 1;
      channels.push(this);
    }
    postMessage(message: unknown) {
      if (this.closed) throw new DOMException("closed", "InvalidStateError");
      const data: unknown = structuredClone(message); // throws DataCloneError like the platform
      for (const target of channels) {
        if (target === this || target.closed || target.name !== this.name) continue;
        setTimeout(() => {
          if (!target.closed) target.onmessage?.({ data: structuredClone(data) });
        }, 0);
      }
    }
    close() {
      this.closed = true;
    }
  }

  return {
    Channel,
    created: () => created,
    openCount: () => channels.filter((c) => !c.closed).length,
  };
}

// ---------------------------------------------------------------------------
// M06-T03 Increment 3b-ii — IndexedDB installation and failure injection
// ---------------------------------------------------------------------------

/**
 * Installs a fresh, isolated `fake-indexeddb` factory as the IndexedDB globals
 * (idb checks `instanceof` against them). Callers restore with
 * `vi.unstubAllGlobals()` in `afterEach`.
 */
/** An instance of fake-indexeddb's `IDBFactory`. */
export type FakeFactory = InstanceType<typeof FakeIDBFactory>;

export function installFakeIndexedDb(): FakeFactory {
  const factory = new FakeIDBFactory();
  vi.stubGlobal("indexedDB", factory);
  for (const [name, value] of Object.entries({
    IDBCursor: FakeIDBCursor,
    IDBCursorWithValue: FakeIDBCursorWithValue,
    IDBDatabase: FakeIDBDatabase,
    IDBFactory: FakeIDBFactory,
    IDBIndex: FakeIDBIndex,
    IDBKeyRange: FakeIDBKeyRange,
    IDBObjectStore: FakeIDBObjectStore,
    IDBOpenDBRequest: FakeIDBOpenDBRequest,
    IDBRequest: FakeIDBRequest,
    IDBTransaction: FakeIDBTransaction,
    IDBVersionChangeEvent: FakeIDBVersionChangeEvent,
  })) {
    vi.stubGlobal(name, value);
  }
  return factory;
}

/** A `Storage` stand-in for the D22 lock with failure switches. */
export class MemoryStorage implements Storage {
  readonly map = new Map<string, string>();
  failGet = false;
  failSet = false;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    if (this.failGet) throw new DOMException("synthetic", "SecurityError");
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failSet) throw new DOMException("synthetic", "QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

export interface TransactionCall {
  /** 1-based count of transactions started through this opener. */
  index: number;
  stores: string[];
  mode: string;
}

/**
 * Wraps an opener so that `transaction(...)` throws a synthetic error when
 * `shouldFail` returns true for that call. Every call is recorded in `log`.
 */
export function injectTransactionFailures<S extends DBSchema>(
  open: () => Promise<OpenResult<S>>,
  shouldFail: (call: TransactionCall) => boolean,
) {
  const log: TransactionCall[] = [];
  let index = 0;
  const opener = async (): Promise<OpenResult<S>> => {
    const result = await open();
    if (result.kind !== "open") return result;
    const target = result.db;
    const db = new Proxy(target, {
      get(object, property) {
        if (property === "transaction") {
          return (stores: string | string[], mode = "readonly") => {
            index += 1;
            const call = { index, stores: [stores].flat(), mode };
            log.push(call);
            if (shouldFail(call)) throw new DOMException("synthetic", "UnknownError");
            return (object.transaction as (s: unknown, m: unknown) => unknown)(stores, mode);
          };
        }
        const value: unknown = Reflect.get(object, property, object);
        return typeof value === "function" ? (value as () => unknown).bind(object) : value;
      },
    }) as IDBPDatabase<S>;
    return { kind: "open", db };
  };
  return { opener, log };
}

/** Holds the Nth call of an opener until `release()`; `reached` resolves when it is waiting. */
export function gateOpen<S extends DBSchema>(open: () => Promise<OpenResult<S>>, callNumber = 1) {
  let calls = 0;
  const gate = deferred();
  const reached = deferred();
  const opener = async (): Promise<OpenResult<S>> => {
    calls += 1;
    if (calls === callNumber) {
      reached.resolve();
      await gate.promise;
    }
    return open();
  };
  return { opener, release: () => gate.resolve(), reached: reached.promise };
}

/** Deterministic ISO clock: each call advances 1 ms, or stays fixed when `step` is 0. */
export function createClock(start = "2026-11-26T10:00:00.000Z", step = 1) {
  let time = Date.parse(start);
  return () => {
    const value = new Date(time).toISOString();
    time += step;
    return value;
  };
}

/** Deterministic synthetic lifecycle UUIDs. */
export function createLifecycleIds() {
  let n = 0;
  return () => {
    n += 1;
    return `eeeeeeee-eeee-4eee-8eee-${n.toString(16).padStart(12, "0")}`;
  };
}

export interface OfflineTestWorld {
  factory: FakeFactory;
  locks: FakeLockManager;
  storage: MemoryStorage;
  hub: BroadcastHub;
}

/** One shared "browser profile": IndexedDB, Web Locks, D22 storage, and channels. */
export function createOfflineTestWorld(): OfflineTestWorld {
  return {
    factory: installFakeIndexedDb(),
    locks: new FakeLockManager(),
    storage: new MemoryStorage(),
    hub: createBroadcastHub(),
  };
}

/** One "tab" in a world: its own generation and notice channel, shared storage and locks. */
export function createOfflineTestTab(
  world: OfflineTestWorld,
  overrides: Partial<SecurityDeps> = {},
): SecurityDeps & { received: NoticeType[] } {
  const received: NoticeType[] = [];
  const notices = createNoticeChannel((name) => new world.hub.Channel(name));
  notices.open((type) => received.push(type));
  return {
    coordinator: createLockCoordinator(() => world.locks as unknown as LockManagerLike),
    safetyLock: createSafetyLock(() => world.storage),
    generation: createSecurityGeneration(),
    notices,
    openData: () => openOfflineDataDatabase(),
    openState: () => openOfflineStateDatabase(),
    now: createClock(),
    newLifecycleId: createLifecycleIds(),
    ...overrides,
    received,
  };
}

// ---------------------------------------------------------------------------
// M06-T03 Increment 3b-iii-b — blocked deletion and verification fault injection
// ---------------------------------------------------------------------------

/**
 * Opens a raw connection that does NOT close on `versionchange` (unlike the
 * application's `openWith`), so it genuinely blocks a deletion until `close()`.
 */
export function openBlockingConnection(
  factory: FakeFactory,
  name: string,
): Promise<{ close: () => void; versionChanges: () => number }> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => {
      const db = request.result;
      let changes = 0;
      db.onversionchange = () => {
        changes += 1; // observed, deliberately not closed
      };
      resolve({ close: () => db.close(), versionChanges: () => changes });
    };
    request.onerror = () => reject(new Error("blocking connection failed"));
  });
}

function bindAll<T extends object>(target: T, overrides: Record<string, unknown>): T {
  return new Proxy(target, {
    get(object, property) {
      if (typeof property === "string" && property in overrides) return overrides[property];
      const value: unknown = Reflect.get(object, property, object);
      return typeof value === "function" ? (value as () => unknown).bind(object) : value;
    },
  });
}

/**
 * A storage fault: every object store's `clear()` resolves WITHOUT removing
 * anything (a storage layer that silently drops the operation).
 */
export function ignoreClears<S extends DBSchema>(open: () => Promise<OpenResult<S>>) {
  return async (): Promise<OpenResult<S>> => {
    const result = await open();
    if (result.kind !== "open") return result;
    const db = result.db;
    const transaction = (stores: unknown, mode?: unknown) => {
      const tx = (db.transaction as (s: unknown, m: unknown) => object)(stores, mode);
      const objectStore = (name: string) =>
        bindAll((tx as { objectStore(n: string): object }).objectStore(name), {
          clear: () => Promise.resolve(),
        });
      return bindAll(tx, { objectStore });
    };
    return { kind: "open", db: bindAll(db, { transaction }) as IDBPDatabase<S> };
  };
}

/**
 * A verification fault: `db.get(store, key)` returns `value` for the matching
 * store and key instead of the stored value (a stale read-back).
 */
export function staleGet<S extends DBSchema>(
  open: () => Promise<OpenResult<S>>,
  storeName: string,
  key: string,
  value: unknown,
) {
  return async (): Promise<OpenResult<S>> => {
    const result = await open();
    if (result.kind !== "open") return result;
    const db = result.db;
    const get = (store: string, k: unknown) =>
      store === storeName && k === key
        ? Promise.resolve(value)
        : (db.get as (s: string, k: unknown) => Promise<unknown>)(store, k);
    return { kind: "open", db: bindAll(db, { get }) as IDBPDatabase<S> };
  };
}
