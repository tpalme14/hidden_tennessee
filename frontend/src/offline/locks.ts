/**
 * Cross-context lock coordination (M06-T03 Increment 3b-i; Specification 6
 * v1.1 OFF-OUT-7, §12.6a, OFF-CONC-3; accepted 3b architecture).
 *
 * Two locks, always taken in this order when both are needed:
 *
 * 1. `tnle-auth` — exclusive only; spans one authentication operation.
 * 2. `tnle-offline-security` — shared for authorized reads and commits,
 *    exclusive for security transitions; never held across a network request
 *    (a caller obligation from 3b-ii onward).
 *
 * Ownership is the browser's: Web Locks releases a lock exactly when the
 * callback's returned promise settles. This module therefore awaits the whole
 * protected operation INSIDE the lock callback and implements no ownership,
 * release, timeout, or stealing of its own.
 *
 * Nesting is tracked per operation by a `LockScope`, never by module state, so
 * independent operations in one tab queue normally. Within one scope:
 * re-acquiring a held lock, and requesting `tnle-auth` while holding
 * `tnle-offline-security`, are rejected with `LockOrderError` before anything
 * is requested.
 *
 * Cancellation: aborting `signal` while waiting removes the request and the
 * callback never runs (`aborted`). After acquisition the browser ignores the
 * signal: abort does NOT release the lock; the callback receives the signal to
 * stop cooperatively, and the lock is released only when it settles.
 *
 * Waiting reports (`onState`, `onLongWait`) are observations only: "waiting"
 * never implies acquisition, and the long-wait timer never releases, steals, or
 * cancels anything.
 *
 * Nothing runs on import; no application code uses this module in 3b-i.
 */

export const AUTH_LOCK = "tnle-auth";
export const SECURITY_LOCK = "tnle-offline-security";

export type CoordinationLock = typeof AUTH_LOCK | typeof SECURITY_LOCK;
export type CoordinationMode = "exclusive" | "shared";

export type LockOrderReason =
  "already-held" | "reverse-order" | "auth-not-exclusive" | "invalid-options";

/** A programming error: the requested acquisition is not supported. Nothing was requested. */
export class LockOrderError extends Error {
  constructor(readonly reason: LockOrderReason) {
    super(`Unsupported lock acquisition: ${reason}`);
    this.name = "LockOrderError";
  }
}

/** One operation's view of the locks it currently holds. */
export interface LockScope {
  readonly held: ReadonlySet<CoordinationLock>;
}

interface MutableLockScope {
  readonly held: Set<CoordinationLock>;
}

/** Creates the scope for ONE operation; independent operations use separate scopes. */
export function createLockScope(): LockScope {
  const scope: MutableLockScope = { held: new Set() };
  return scope;
}

export type LockState = "waiting" | "acquired" | "released";

export interface LockContext {
  /** The operation's scope, to pass to any nested `withLock`. */
  scope: LockScope;
  /** The caller's signal; after acquisition it is advisory (cooperative stop only). */
  signal: AbortSignal | undefined;
}

export interface WithLockOptions {
  /** Cancels while waiting. Cannot be combined with `ifAvailable` (Web Locks rule). */
  signal?: AbortSignal;
  /** Do not queue: `not-acquired` if the lock cannot be granted now. */
  ifAvailable?: boolean;
  onState?: (state: LockState) => void;
  /** Milliseconds after which `onLongWait` fires once if still waiting. */
  longWaitMs?: number;
  onLongWait?: () => void;
}

export type LockResult<T> =
  | { kind: "done"; value: T }
  /** No Web Locks in this context; the callback did not run. */
  | { kind: "unavailable" }
  /** `ifAvailable` and the lock was not grantable; the callback did not run. */
  | { kind: "not-acquired" }
  /** Cancelled while waiting; the callback did not run. */
  | { kind: "aborted" }
  /** The request failed before the callback ran. */
  | { kind: "failed" };

/** The Web Locks surface this module uses. */
export interface LockManagerLike {
  request(
    name: string,
    options: { mode: CoordinationMode; signal?: AbortSignal; ifAvailable?: boolean },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>;
}

export type LocksProvider = () => LockManagerLike | null | undefined;

const defaultLocks: LocksProvider = () =>
  typeof navigator === "undefined"
    ? undefined
    : (navigator.locks as unknown as LockManagerLike | undefined);

export interface LockCoordinator {
  /**
   * Runs `callback` while holding `name` in `mode`. A callback error is
   * rethrown after the browser has released the lock.
   */
  withLock<T>(
    scope: LockScope,
    name: CoordinationLock,
    mode: CoordinationMode,
    callback: (context: LockContext) => T | Promise<T>,
    options?: WithLockOptions,
  ): Promise<LockResult<Awaited<T>>>;
}

function safely(observer: (() => void) | undefined): void {
  try {
    observer?.();
  } catch {
    // Observers never affect ownership or results.
  }
}

/** Validates an acquisition request; throws `LockOrderError` when unsupported. */
export function checkAcquisition(
  scope: LockScope,
  name: CoordinationLock,
  mode: CoordinationMode,
  options: WithLockOptions = {},
): void {
  if (name === AUTH_LOCK && mode !== "exclusive") throw new LockOrderError("auth-not-exclusive");
  if (scope.held.has(name)) throw new LockOrderError("already-held");
  if (name === AUTH_LOCK && scope.held.has(SECURITY_LOCK)) {
    throw new LockOrderError("reverse-order");
  }
  if (options.ifAvailable && options.signal) throw new LockOrderError("invalid-options");
}

const NOT_GRANTED = Symbol("not-granted");

export function createLockCoordinator(getLocks: LocksProvider = defaultLocks): LockCoordinator {
  async function withLock<T>(
    scope: LockScope,
    name: CoordinationLock,
    mode: CoordinationMode,
    callback: (context: LockContext) => T | Promise<T>,
    options: WithLockOptions = {},
  ): Promise<LockResult<Awaited<T>>> {
    checkAcquisition(scope, name, mode, options);
    const held = (scope as MutableLockScope).held;

    let manager: LockManagerLike | null | undefined;
    try {
      manager = getLocks();
    } catch {
      manager = undefined; // access refused: treated as not provided
    }
    if (!manager || typeof manager.request !== "function") return { kind: "unavailable" };
    if (options.signal?.aborted) return { kind: "aborted" };

    let entered = false;
    let longWait: ReturnType<typeof setTimeout> | undefined;
    const request: { mode: CoordinationMode; signal?: AbortSignal; ifAvailable?: boolean } = {
      mode,
    };
    if (options.signal) request.signal = options.signal;
    if (options.ifAvailable) request.ifAvailable = true;

    safely(() => options.onState?.("waiting"));
    if (options.longWaitMs !== undefined && options.onLongWait) {
      longWait = setTimeout(() => {
        if (!entered) safely(options.onLongWait);
      }, options.longWaitMs);
    }

    try {
      const outcome = await manager.request(name, request, async (lock) => {
        if (lock === null) return NOT_GRANTED;
        entered = true;
        clearTimeout(longWait);
        held.add(name);
        safely(() => options.onState?.("acquired"));
        try {
          // The protected work completes before the callback settles, so the
          // browser keeps the lock for its whole duration.
          const value = await callback({ scope, signal: options.signal });
          return { value };
        } finally {
          held.delete(name);
        }
      });
      if (outcome === NOT_GRANTED) return { kind: "not-acquired" };
      return { kind: "done", value: (outcome as { value: Awaited<T> }).value };
    } catch (error) {
      if (entered) throw error; // the callback's own error, after release
      if (options.signal?.aborted) return { kind: "aborted" };
      return { kind: "failed" };
    } finally {
      clearTimeout(longWait);
      if (entered) safely(() => options.onState?.("released"));
    }
  }

  return { withLock };
}
