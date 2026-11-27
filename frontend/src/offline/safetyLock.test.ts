import { describe, expect, it } from "vitest";
import { createSafetyLock, SAFETY_LOCK_KEY, SAFETY_LOCK_VALUE } from "./safetyLock";

/**
 * M06-T03 Increment 3a — the D22 safety-lock primitive, with controlled
 * `Storage` stand-ins (no real `localStorage` is touched).
 */

class MemoryStorage implements Storage {
  readonly map = new Map<string, string>();
  failGet = false;
  failSet = false;
  failRemove = false;
  /** Accepts the write but does not keep it (a storage that silently drops writes). */
  dropWrites = false;
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
    if (this.failGet) throw new DOMException("denied", "SecurityError");
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failSet) throw new DOMException("full", "QuotaExceededError");
    if (!this.dropWrites) this.map.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemove) throw new DOMException("denied", "SecurityError");
    this.map.delete(key);
  }
}

describe("D22 safety lock", () => {
  it("absent by default: not blocked", () => {
    const storage = new MemoryStorage();
    const lock = createSafetyLock(() => storage);
    expect(lock.read()).toBe("absent");
    expect(lock.isBlocked()).toBe(false);
  });

  it("set writes exactly one fixed entry with the constant value — nothing else", () => {
    const storage = new MemoryStorage();
    const lock = createSafetyLock(() => storage);
    expect(lock.set()).toEqual({ durable: true });
    expect([...storage.map.entries()]).toEqual([[SAFETY_LOCK_KEY, SAFETY_LOCK_VALUE]]);
    expect(SAFETY_LOCK_VALUE).toBe("true");
    expect(lock.read()).toBe("present");
    expect(lock.isBlocked()).toBe(true);
  });

  it("a lock set by another instance (another tab or a reload) is present", () => {
    const storage = new MemoryStorage();
    createSafetyLock(() => storage).set();
    const fresh = createSafetyLock(() => storage);
    expect(fresh.read()).toBe("present");
    expect(fresh.isBlocked()).toBe(true);
  });

  it("any stored value counts as present (a missing lock is the only 'absent')", () => {
    const storage = new MemoryStorage();
    storage.map.set(SAFETY_LOCK_KEY, "unexpected");
    expect(createSafetyLock(() => storage).read()).toBe("present");
  });

  it.each<[string, () => Storage]>([
    ["getItem throws", () => Object.assign(new MemoryStorage(), { failGet: true })],
    [
      "the storage itself cannot be reached",
      () => {
        throw new DOMException("denied", "SecurityError");
      },
    ],
  ])(
    "unreadable storage (%s) is 'unreadable' and blocks — never treated as unlocked",
    (_l, provider) => {
      const lock = createSafetyLock(provider);
      expect(lock.read()).toBe("unreadable");
      expect(lock.isBlocked()).toBe(true);
    },
  );

  it.each<[string, (s: MemoryStorage) => void, string]>([
    ["setItem throws (quota)", (s) => (s.failSet = true), "write-failed"],
    ["the write does not read back", (s) => (s.dropWrites = true), "write-failed"],
  ])(
    "a failed write (%s) is not durable — but the in-memory block holds",
    (_l, configure, reason) => {
      const storage = new MemoryStorage();
      configure(storage);
      const lock = createSafetyLock(() => storage);
      expect(lock.set()).toEqual({ durable: false, reason });
      expect(lock.isBlocked()).toBe(true); // in-memory block (OFF-FAIL-4 limits apply)
    },
  );

  it("unavailable storage on set: in-memory block only", () => {
    const lock = createSafetyLock(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(lock.set()).toEqual({ durable: false, reason: "unavailable" });
    expect(lock.isBlocked()).toBe(true);
  });

  it("restricted clear: removes the durable lock and then the in-memory block", () => {
    const storage = new MemoryStorage();
    const lock = createSafetyLock(() => storage);
    lock.set();
    expect(lock.clearAfterVerifiedRecovery()).toBe("cleared");
    expect(storage.map.size).toBe(0);
    expect(lock.isBlocked()).toBe(false);
  });

  it("a failed clear keeps every block", () => {
    const storage = new MemoryStorage();
    const lock = createSafetyLock(() => storage);
    lock.set();
    storage.failRemove = true;
    expect(lock.clearAfterVerifiedRecovery()).toBe("clear-failed");
    expect(lock.read()).toBe("present");
    expect(lock.isBlocked()).toBe(true);
  });

  it("clear with unavailable storage reports it and keeps the in-memory block", () => {
    let available = true;
    const storage = new MemoryStorage();
    const lock = createSafetyLock(() => {
      if (!available) throw new DOMException("denied", "SecurityError");
      return storage;
    });
    lock.set();
    available = false;
    expect(lock.clearAfterVerifiedRecovery()).toBe("unavailable");
    expect(lock.isBlocked()).toBe(true);
  });

  it("touches no storage until called", () => {
    let calls = 0;
    createSafetyLock(() => {
      calls += 1;
      return new MemoryStorage();
    });
    expect(calls).toBe(0);
  });
});
