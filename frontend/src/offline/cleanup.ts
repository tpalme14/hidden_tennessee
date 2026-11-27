import { DATA_DB_NAME } from "./db";
import { createLockScope, SECURITY_LOCK, type LockScope } from "./locks";
import {
  OFFLINE_SCHEMA_VERSION,
  validateStoredFailureRecord,
  validateStoredSequence,
  type StoredFailureRecord,
} from "./records";
import type { SafetyLockWrite } from "./safetyLock";
import {
  assertSecurityLockHeld,
  inspectSecurityState,
  inspectStateEvidence,
  isOwnedKey,
  openDataDatabase,
  openStateDatabase,
  type FailureEvidence,
  type IntentEvidence,
  type SecurityClassification,
  type SecurityDeps,
} from "./securityState";
import { advise, escalate } from "./signOutIntent";

/**
 * Offline cleanup and "Delete all offline data" (M06-T03 Increment 3b-iii-b;
 * Specification 6 v1.1 OFF-LIFE-5/8/9, OFF-FAIL-1–5, OFF-OUT-9).
 *
 * Every operation holds `tnle-offline-security` EXCLUSIVE (never `tnle-auth`,
 * never across a network request) and fails closed when the lock is unusable:
 * no uncoordinated IndexedDB write is made. Deletion is LOGICAL only (records
 * removed and verified by a separate read); physical erasure is never claimed.
 *
 * - `cleanupResidual` (ordinary): only when the fresh state is `residual`.
 *   Keeps the valid marker, every record whose primary key belongs to the
 *   current owner (even malformed ones — preserving a record never makes it
 *   valid; reads must validate it), and the current lifecycle's valid
 *   sequence. Removes foreign-owner records and a foreign (or, without a
 *   marker, any) sequence. Unknown meta keys and an invalid sequence beside a
 *   valid marker are `unreadable` and refuse ordinary cleanup.
 * - `cleanupAll`: clears all five data stores in ONE transaction, then verifies
 *   emptiness by a separate inspection. Ordinary only when no valid marker
 *   exists or its lifecycle is terminated (a pending intent). Removing an
 *   otherwise valid lifecycle (or a malformed or unreadable marker) requires
 *   `destructive: true` — an isolated implementation boundary, NOT evidence of
 *   user consent; explicit user-facing authorization and disclosure are a later
 *   integration obligation.
 * - `deleteAllOfflineData`: deletes the data database only, waiting for the
 *   browser's actual outcome while holding the lock (no timer releases it, and
 *   the request cannot be cancelled). If the state database or D22 cannot be
 *   reliably inspected, D22 must first be durably set, or nothing is deleted.
 *
 * Never touched: the state database (intent, failure record) except to write
 * or join a failure record, and D22 except to set it. Nothing here clears an
 * intent, a failure record, or D22, lifts the local block, creates a
 * lifecycle, or implies a server sign-out or verified recovery.
 */

const SCOPED_STORES = ["landmarks", "trips", "invalidations", "deletions"] as const;

// ---------------------------------------------------------------------------
// Failure recording (join, never replace)
// ---------------------------------------------------------------------------

export type FailureRecordOutcome =
  /** A new `cleanup` failure record was written and verified. */
  | "written"
  /** A valid record already existed and was preserved (it is not exhaustive). */
  | "joined"
  /** A malformed record exists; it was preserved, never overwritten. */
  | "preserved-malformed"
  | "write-failed"
  | "state-unreadable";

export interface FailureEscalation {
  failureRecord: FailureRecordOutcome;
  /** The D22 write, when escalation was required. */
  safetyLock: SafetyLockWrite | null;
}

/** What a fresh inspection found after a failure (an `unreadable` observation is not durable evidence). */
export interface RemainingEvidence {
  observed: SecurityClassification;
  /** A readable state that durably blocks: D22, failure record, intent, or residual records. */
  durableBlocking: boolean;
  failureRecordDurable: boolean;
  safetyLockDurable: boolean;
}

async function writeOrJoinFailure(deps: SecurityDeps): Promise<FailureRecordOutcome> {
  const db = await openStateDatabase(deps);
  if (db === null) return "state-unreadable";
  try {
    const tx = db.transaction("state", "readwrite");
    const existing: unknown = await tx.store.get("failure");
    if (existing !== undefined) {
      await tx.done;
      return validateStoredFailureRecord(existing).ok ? "joined" : "preserved-malformed";
    }
    const record: StoredFailureRecord = {
      key: "failure",
      schema_version: OFFLINE_SCHEMA_VERSION,
      kind: "cleanup",
      recorded_at: deps.now(),
    };
    if (!validateStoredFailureRecord(record).ok) {
      tx.abort();
      // Settle the aborted transaction; only its expected AbortError is consumed (c2a).
      await tx.done.catch((error: unknown) => {
        if ((error as { name?: unknown } | null)?.name !== "AbortError") throw error;
      });
      return "write-failed";
    }
    await tx.store.put(record);
    await tx.done;
    const stored = validateStoredFailureRecord(await db.get("state", "failure"));
    return stored.ok && stored.record.recorded_at === record.recorded_at
      ? "written"
      : "write-failed";
  } catch {
    return "write-failed";
  } finally {
    db.close();
  }
}

/**
 * Records a cleanup failure inside the caller's exclusive callback, escalating to D22 when needed.
 * Exported (3b-iii-c1) for reuse by the account-switch invalidation in `lifecycle.ts`.
 *
 * BINDING INVARIANT (Q32, 2026-11-26; Specification 6 OFF-FAIL-3 clarification):
 * a failure record must never be the sole durable representation of an
 * unresolved server-authentication obligation. A caller with an unresolved
 * server sign-out must ALREADY have established a sign-out intent or D22; this
 * helper must not be its only evidence, because local-only recovery
 * (`recovery.ts`) removes failure records without any server request.
 *
 * Future-caller review requirement: every new caller must identify the local
 * obligation it records, identify any associated server-authentication
 * obligation, establish an intent or D22 where required, demonstrate that
 * local-only recovery cannot remove the sole protection for an unresolved
 * server obligation, and provide targeted verification. Reader-side refusal in
 * `recovery.ts` detects an intent or D22 that EXISTS; it cannot detect evidence
 * a defective writer failed to establish.
 */
export async function recordCleanupFailure(
  scope: LockScope,
  deps: SecurityDeps,
): Promise<FailureEscalation> {
  assertSecurityLockHeld(scope);
  const failureRecord = await writeOrJoinFailure(deps);
  if (failureRecord === "written") advise(deps, "failure-changed");
  const durable = failureRecord === "written" || failureRecord === "joined";
  return { failureRecord, safetyLock: durable ? null : escalate(deps) };
}

async function remainingEvidence(
  scope: LockScope,
  deps: SecurityDeps,
  escalation: FailureEscalation,
): Promise<RemainingEvidence> {
  const state = await inspectSecurityState(scope, deps);
  return {
    observed: state.primary,
    durableBlocking: ["safety-lock", "failure", "intent-pending", "residual"].includes(
      state.primary,
    ),
    failureRecordDurable:
      escalation.failureRecord === "written" || escalation.failureRecord === "joined",
    safetyLockDurable: escalation.safetyLock?.durable === true,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export type CleanupRefusal =
  | Exclude<SecurityClassification, "residual">
  /** A valid, non-terminated lifecycle (or a malformed/unreadable marker) needs `destructive`. */
  | "destructive-required";

export type CleanupResult =
  | {
      kind: "cleaned";
      mode: "residual" | "ordinary-full" | "destructive-full";
      after: SecurityClassification;
    }
  | { kind: "refused"; reason: CleanupRefusal }
  | {
      kind: "failed";
      stage: "transaction" | "verification";
      escalation: FailureEscalation;
      remaining: RemainingEvidence;
    }
  | { kind: "unavailable" };

async function failCleanup(
  scope: LockScope,
  deps: SecurityDeps,
  stage: "transaction" | "verification",
): Promise<CleanupResult> {
  const escalation = await recordCleanupFailure(scope, deps);
  return {
    kind: "failed",
    stage,
    escalation,
    remaining: await remainingEvidence(scope, deps, escalation),
  };
}

/** Removes every record not owned by `owner` in one transaction. Never deletes unknown meta keys. */
async function removeForeignRecords(
  deps: SecurityDeps,
  owner: readonly [string, string] | null,
): Promise<boolean> {
  const db = await openDataDatabase(deps);
  if (db === null) return false;
  try {
    const tx = db.transaction(["meta", ...SCOPED_STORES], "readwrite");
    for (const name of SCOPED_STORES) {
      const store = tx.objectStore(name);
      for (const key of await store.getAllKeys()) {
        if (!isOwnedKey(key, owner)) await store.delete(key);
      }
    }
    const meta = tx.objectStore("meta");
    const raw: unknown = await meta.get("sequence");
    if (raw !== undefined) {
      const sequence = validateStoredSequence(raw);
      const foreign =
        owner === null ||
        (sequence.ok &&
          (sequence.record.account_id !== owner[0] || sequence.record.lifecycle_id !== owner[1]));
      if (foreign) await meta.delete("sequence");
    }
    await tx.done;
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** Ordinary residual cleanup: only when the fresh state is `residual`. */
export async function cleanupResidual(deps: SecurityDeps): Promise<CleanupResult> {
  const result = await deps.coordinator.withLock(
    createLockScope(),
    SECURITY_LOCK,
    "exclusive",
    async ({ scope }): Promise<CleanupResult> => {
      const before = await inspectSecurityState(scope, deps);
      if (before.primary !== "residual") return { kind: "refused", reason: before.primary };
      const marker = before.evidence.marker;
      const owner: [string, string] | null =
        marker.kind === "valid" ? [marker.marker.account_id, marker.marker.lifecycle_id] : null;
      if (!(await removeForeignRecords(deps, owner))) {
        return failCleanup(scope, deps, "transaction");
      }
      const after = await inspectSecurityState(scope, deps);
      const markerKept =
        owner === null
          ? after.evidence.marker.kind === "absent"
          : after.evidence.marker.kind === "valid" &&
            after.evidence.marker.marker.lifecycle_id === owner[1] &&
            after.evidence.marker.marker.account_id === owner[0];
      if (after.primary !== (owner === null ? "none" : "lifecycle") || !markerKept) {
        return failCleanup(scope, deps, "verification");
      }
      advise(deps, "state-changed");
      return { kind: "cleaned", mode: "residual", after: after.primary };
    },
  );
  return result.kind === "done" ? result.value : { kind: "unavailable" };
}

async function clearDataStores(deps: SecurityDeps): Promise<boolean> {
  const db = await openDataDatabase(deps);
  if (db === null) return false;
  try {
    const tx = db.transaction(["meta", ...SCOPED_STORES], "readwrite");
    await tx.objectStore("meta").clear();
    for (const name of SCOPED_STORES) await tx.objectStore(name).clear();
    await tx.done;
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** Full cleanup of the five data stores; `destructive` is required to remove a valid, non-terminated lifecycle. */
/**
 * The body of full cleanup (3b-iii-c2 extraction; behavior unchanged): call only
 * inside a held EXCLUSIVE `tnle-offline-security` callback, passing its scope.
 * It never acquires the lock itself. The same ordinary/destructive gate,
 * single five-store transaction, separate emptiness verification, failure
 * joining, and D22 escalation as `cleanupAll`.
 */
export async function fullCleanupWithin(
  scope: LockScope,
  deps: SecurityDeps,
  options: { destructive?: boolean } = {},
): Promise<CleanupResult> {
  assertSecurityLockHeld(scope);
  const destructive = options.destructive === true;
  const before = await inspectSecurityState(scope, deps);
  const marker = before.evidence.marker;
  const terminated = before.evidence.intent.kind === "pending";
  const protectedLifecycle = marker.kind === "valid" && !terminated;
  const unknownMarker = marker.kind === "invalid" || marker.kind === "unreadable";
  if ((protectedLifecycle || unknownMarker) && !destructive) {
    return { kind: "refused", reason: "destructive-required" };
  }
  if (!(await clearDataStores(deps))) return failCleanup(scope, deps, "transaction");
  const after = await inspectSecurityState(scope, deps);
  if (!after.evidence.dataEmpty) return failCleanup(scope, deps, "verification");
  advise(deps, "state-changed");
  return {
    kind: "cleaned",
    mode: destructive ? "destructive-full" : "ordinary-full",
    after: after.primary,
  };
}

export async function cleanupAll(
  deps: SecurityDeps,
  options: { destructive?: boolean } = {},
): Promise<CleanupResult> {
  const destructive = options.destructive === true;
  if (destructive) {
    deps.generation.block(); // a valid lifecycle may be removed: block this tab first
    advise(deps, "lifecycle-ended");
  }
  const result = await deps.coordinator.withLock(
    createLockScope(),
    SECURITY_LOCK,
    "exclusive",
    ({ scope }) => fullCleanupWithin(scope, deps, { destructive }),
  );
  return result.kind === "done" ? result.value : { kind: "unavailable" };
}

// ---------------------------------------------------------------------------
// Delete all offline data
// ---------------------------------------------------------------------------

/** The parts of an `IDBOpenDBRequest` a deletion uses. */
export interface DeletionRequestLike {
  onsuccess: (() => void) | null;
  onerror: ((event: { preventDefault?: () => void }) => void) | null;
  onblocked: (() => void) | null;
}

export type DatabaseDeleter = (name: string) => DeletionRequestLike;

const defaultDeleter: DatabaseDeleter = (name) =>
  indexedDB.deleteDatabase(name) as unknown as DeletionRequestLike;

/** Progress reports only; none of them is completion. */
export type DeletionProgress = "requested" | "pending" | "blocked";

export interface DeleteAllResult {
  blockToken: number;
  /** `completed` only on the browser's success event. */
  deletion: "completed" | "failed" | "not-attempted";
  /** Why nothing was deleted, when `not-attempted`. */
  refusal?: "coordination-unavailable" | "protection-not-established";
  /** `unreadable-state`: security state could not be reliably inspected; D22 was required first. */
  path: "ordinary" | "unreadable-state" | "none";
  blockedObserved: boolean;
  /** Security evidence observed before deletion; all of it is preserved. */
  preserved: {
    safetyLock: "absent" | "present" | "unreadable";
    intent: IntentEvidence["kind"] | "not-inspected";
    failure: FailureEvidence["kind"] | "not-inspected";
  };
  /** D22 write when required (unreadable-state path or deletion failure). */
  safetyLock: SafetyLockWrite | null;
  failureEscalation: FailureEscalation | null;
  serverSignOut: "not-implied";
  recovery: "not-authorized";
}

function requestDeletion(
  deleter: DatabaseDeleter,
  onProgress: (progress: DeletionProgress) => void,
  onBlocked: () => void,
): Promise<"completed" | "failed"> {
  return new Promise((resolve) => {
    let request: DeletionRequestLike;
    try {
      onProgress("requested");
      request = deleter(DATA_DB_NAME);
    } catch {
      resolve("failed");
      return;
    }
    request.onsuccess = () => resolve("completed");
    request.onerror = (event) => {
      event.preventDefault?.();
      resolve("failed");
    };
    request.onblocked = () => {
      onBlocked();
      onProgress("blocked"); // still pending: never completion
    };
    onProgress("pending");
  });
}

export async function deleteAllOfflineData(
  deps: SecurityDeps,
  options: { deleter?: DatabaseDeleter; onProgress?: (progress: DeletionProgress) => void } = {},
): Promise<DeleteAllResult> {
  const blockToken = deps.generation.block(); // synchronous local block
  advise(deps, "lifecycle-ended"); // advisory, before waiting for the lock
  const deleter = options.deleter ?? defaultDeleter;
  const report = (progress: DeletionProgress) => {
    try {
      options.onProgress?.(progress);
    } catch {
      // Progress observers never affect the operation.
    }
  };
  const base = {
    blockToken,
    serverSignOut: "not-implied",
    recovery: "not-authorized",
  } as const;

  const result = await deps.coordinator.withLock(
    createLockScope(),
    SECURITY_LOCK,
    "exclusive",
    async ({ scope }): Promise<DeleteAllResult> => {
      const state = await inspectStateEvidence(scope, deps);
      const preserved = {
        safetyLock: state.safetyLock,
        intent: state.intent.kind,
        failure: state.failure.kind,
      };
      const unreliable =
        state.safetyLock === "unreadable" ||
        state.intent.kind === "unreadable" ||
        state.failure.kind === "unreadable";
      let safetyLock: SafetyLockWrite | null = null;
      if (unreliable) {
        // Unknown security state is never proof that no intent or failure exists:
        // durable protection must exist before anything is deleted.
        safetyLock = escalate(deps);
        if (!safetyLock.durable) {
          return {
            ...base,
            deletion: "not-attempted",
            refusal: "protection-not-established",
            path: "unreadable-state",
            blockedObserved: false,
            preserved,
            safetyLock,
            failureEscalation: null,
          };
        }
      }
      let blockedObserved = false;
      const outcome = await requestDeletion(deleter, report, () => {
        blockedObserved = true;
      });
      const failureEscalation =
        outcome === "failed" ? await recordCleanupFailure(scope, deps) : null;
      advise(deps, "state-changed");
      return {
        ...base,
        deletion: outcome,
        path: unreliable ? "unreadable-state" : "ordinary",
        blockedObserved,
        preserved,
        safetyLock,
        failureEscalation,
      };
    },
  );
  if (result.kind === "done") return result.value;
  return {
    ...base,
    deletion: "not-attempted",
    refusal: "coordination-unavailable",
    path: "none",
    blockedObserved: false,
    preserved: {
      safetyLock: deps.safetyLock.read(),
      intent: "not-inspected",
      failure: "not-inspected",
    },
    safetyLock: null,
    failureEscalation: null,
  };
}
