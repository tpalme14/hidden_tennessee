/**
 * D22 device-wide safety lock — minimal primitive (M06-T03 Increment 3a;
 * Specification 6 v1.1 OFF-FAIL-5; ADR-007 amendment item 4).
 *
 * - The durable form is ONE fixed `localStorage` entry whose value is the
 *   constant "true" — no account or lifecycle identifier, token, timestamp,
 *   failure detail, or content. It is not authentication.
 * - Reads distinguish absent, present, and unreadable. An unreadable store is
 *   never reported as "absent", and any value other than "absent" blocks
 *   (`isBlocked`). A missing lock is not evidence that anything succeeded.
 * - A set ALWAYS blocks in memory first, and reports whether the durable write
 *   succeeded; a failed write is never reported as durable protection
 *   (OFF-FAIL-4 then applies: the in-memory block may not survive a reload).
 * - Clearing is restricted to verified recovery (OFF-FAIL-5 "Clearing"), which
 *   Increments 3b/3c will implement. No application path calls it in 3a, and
 *   it is not exported as an application action.
 *
 * Nothing touches storage on import; every operation is an explicit call.
 */

/** The single fixed key and value. */
export const SAFETY_LOCK_KEY = "tnle-offline-safety-lock";
export const SAFETY_LOCK_VALUE = "true";

export type SafetyLockReading = "absent" | "present" | "unreadable";
export type SafetyLockWrite =
  { durable: true } | { durable: false; reason: "unavailable" | "write-failed" };
export type SafetyLockClear = "cleared" | "unavailable" | "clear-failed";

/** How the primitive reaches storage; the default resolves `window.localStorage` at call time. */
export type StorageProvider = () => Storage;

const defaultProvider: StorageProvider = () => window.localStorage;

export interface SafetyLock {
  /** The durable state as read now. */
  read(): SafetyLockReading;
  /** True when offline-library access must be blocked: an in-memory block, a present lock, or an unreadable store. */
  isBlocked(): boolean;
  /** Blocks in memory, then attempts the durable write. */
  set(): SafetyLockWrite;
  /**
   * RESTRICTED — for verified recovery only (OFF-FAIL-5), implemented in a later
   * increment. Removes the durable lock and, only if that succeeded, the
   * in-memory block.
   */
  clearAfterVerifiedRecovery(): SafetyLockClear;
}

export function createSafetyLock(provider: StorageProvider = defaultProvider): SafetyLock {
  let blockedInMemory = false;

  function storage(): Storage | null {
    try {
      return provider();
    } catch {
      return null; // for example a SecurityError when storage is denied
    }
  }

  function read(): SafetyLockReading {
    const store = storage();
    if (store === null) return "unreadable";
    try {
      return store.getItem(SAFETY_LOCK_KEY) === null ? "absent" : "present";
    } catch {
      return "unreadable";
    }
  }

  return {
    read,
    isBlocked: () => blockedInMemory || read() !== "absent",
    set() {
      blockedInMemory = true;
      const store = storage();
      if (store === null) return { durable: false, reason: "unavailable" };
      try {
        store.setItem(SAFETY_LOCK_KEY, SAFETY_LOCK_VALUE);
      } catch {
        return { durable: false, reason: "write-failed" };
      }
      // A write that does not read back is not durable protection.
      try {
        if (store.getItem(SAFETY_LOCK_KEY) !== SAFETY_LOCK_VALUE) {
          return { durable: false, reason: "write-failed" };
        }
      } catch {
        return { durable: false, reason: "write-failed" };
      }
      return { durable: true };
    },
    clearAfterVerifiedRecovery() {
      const store = storage();
      if (store === null) return "unavailable";
      try {
        store.removeItem(SAFETY_LOCK_KEY);
        if (store.getItem(SAFETY_LOCK_KEY) !== null) return "clear-failed";
      } catch {
        return "clear-failed";
      }
      blockedInMemory = false;
      return "cleared";
    },
  };
}
