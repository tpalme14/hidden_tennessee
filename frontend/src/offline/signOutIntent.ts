import { createLockScope, SECURITY_LOCK } from "./locks";
import {
  OFFLINE_SCHEMA_VERSION,
  validateStoredSignOutIntent,
  type StoredSignOutIntent,
} from "./records";
import type { SafetyLockWrite } from "./safetyLock";
import {
  assertLiveTicket,
  assertSecurityLockHeld,
  inspectSecurityState,
  openStateDatabase,
  OwnershipError,
  removeMarkerWithin,
  type AuthTicket,
  type MarkerRemoval,
  type SecurityDeps,
  type SecurityState,
} from "./securityState";
import type { LockScope } from "./locks";
import type { NoticeType } from "./notices";

/**
 * Durable sign-out intent (M06-T03 Increment 3b-ii; Specification 6 v1.1
 * OFF-OUT-1–8, OFF-LIFE-9, OFF-FAIL-1/4/5; approved DR-2 Option B and
 * approvals 2–5).
 *
 * Ordering (Option B, with the 3b-iii-a Q21 correction):
 * 1. `beginSignOut` blocks this tab synchronously (generation), posts the
 *    advisory `lifecycle-ended` notice, and requests `tnle-offline-security`
 *    EXCLUSIVE (never `tnle-auth`) in the same synchronous turn, so a busy
 *    security lock never delays the notice. Inside the lock it records or
 *    JOINS the device's single intent, and only then removes the marker (two
 *    databases, two transactions, intent first; no cross-database atomicity is
 *    claimed), then posts `state-changed`. It releases the security lock before
 *    any `tnle-auth` request: sequential, not reverse-nested.
 *
 *    Notice semantics (advisory only, see notices.ts): `lifecycle-ended` means
 *    "a tab has BEGUN ending the lifecycle — block locally and re-validate";
 *    it never states that termination is durable. `state-changed` means
 *    "durable security state may have changed — re-validate". No notice is
 *    evidence of durable intent, cleanup, or server sign-out, and a notice that
 *    fails (or throws) never prevents the durable steps.
 * 2. Later, under a live `tnle-auth` ticket, `readIntentUnderAuth` re-reads the
 *    intent (nested shared security lock) and yields an observation;
 *    `planQueuedSignOut` suppresses a duplicate server request when the
 *    intent this sign-out recorded or joined is already resolved.
 * 3. `beginConfirmingRequest` must be called BEFORE the server request is sent;
 *    no security lock is held during the request.
 * 4. `completeServerSignOut` accepts only that request's handle, under the same
 *    live ticket. Under a nested EXCLUSIVE security lock it compares the
 *    intent's ownership, then removes and verifies the absence of any surviving
 *    marker (3b-iii-b, Q25: clearing the intent must never leave a terminated
 *    lifecycle eligible for reuse), and only then compare-and-clears the
 *    intent. If the marker cannot be removed and verified, the intent is
 *    retained (`marker-remove-failed`). It clears nothing else (not D22,
 *    failure records, or residual records). A stale result — one without a handle created after the
 *    intent was observed under `tnle-auth` — cannot confirm the intent.
 *
 * Intent persistence failure (approval 5): escalation to D22 inside the
 * exclusive callback when the lock is held; otherwise an emergency D22 set
 * outside any lock (documented limitation: it can race with a future D22
 * clearing, a 3b-iii requirement). The marker is then still removed when the
 * lock is held. Outcomes are reported individually; durable intent is never
 * reported when only D22 or marker removal succeeded.
 *
 * No server request is made here; outcomes are supplied by the caller (3c).
 */

export type IntentOutcome =
  | { status: "recorded"; token: string }
  | { status: "joined"; token: string }
  /** The write or its read-back failed. */
  | { status: "failed" }
  /** A stored intent exists but is malformed or unreadable; it was NOT overwritten. */
  | { status: "unreadable" }
  /** The security lock could not be used, so no write was attempted. */
  | { status: "not-attempted" };

export interface BeginSignOutResult {
  /** This tab's block token (the generation after `block()`). */
  blockToken: number;
  /** `ordinary`: intent established, then marker removal. `exceptional`: escalation path. */
  path: "ordinary" | "exceptional";
  coordination: "acquired" | "unavailable";
  intent: IntentOutcome;
  /** The D22 write result, when escalation was attempted. */
  escalation: SafetyLockWrite | null;
  marker: MarkerRemoval | "not-attempted";
  /** What durable evidence was actually established (for truthful reporting). */
  durable: { intent: boolean; safetyLock: boolean; markerInvalidated: boolean };
}

/** Posts an advisory notice; a failing or throwing channel never affects the caller. */
export function advise(deps: SecurityDeps, type: NoticeType): void {
  try {
    deps.notices.post(type);
  } catch {
    // Advisory only: delivery is never relied upon.
  }
}

/** The narrow failure-escalation boundary: set D22 and notify. No clearing, no recovery. */
export function escalate(deps: SecurityDeps): SafetyLockWrite {
  const write = deps.safetyLock.set();
  advise(deps, "lock-set");
  return write;
}

async function establishIntent(scope: LockScope, deps: SecurityDeps): Promise<IntentOutcome> {
  assertSecurityLockHeld(scope);
  const db = await openStateDatabase(deps);
  if (db === null) return { status: "failed" };
  try {
    const tx = db.transaction("state", "readwrite");
    const existing: unknown = await tx.store.get("signout_intent");
    if (existing !== undefined) {
      await tx.done;
      const checked = validateStoredSignOutIntent(existing);
      // Join the unresolved intent; never replace it or its identity.
      return checked.ok
        ? { status: "joined", token: checked.record.created_at }
        : { status: "unreadable" };
    }
    const record: StoredSignOutIntent = {
      key: "signout_intent",
      schema_version: OFFLINE_SCHEMA_VERSION,
      pending: true,
      created_at: deps.now(),
    };
    if (!validateStoredSignOutIntent(record).ok) {
      tx.abort();
      // Settle the aborted transaction; only its expected AbortError is consumed (c2a).
      await tx.done.catch((error: unknown) => {
        if ((error as { name?: unknown } | null)?.name !== "AbortError") throw error;
      });
      return { status: "failed" };
    }
    await tx.store.put(record);
    await tx.done;
    const stored = validateStoredSignOutIntent(await db.get("state", "signout_intent"));
    return stored.ok && stored.record.created_at === record.created_at
      ? { status: "recorded", token: record.created_at }
      : { status: "failed" };
  } catch {
    return { status: "failed" };
  } finally {
    db.close();
  }
}

export async function beginSignOut(deps: SecurityDeps): Promise<BeginSignOutResult> {
  const blockToken = deps.generation.block(); // OFF-OUT-1 step 1, synchronous
  advise(deps, "lifecycle-ended"); // step 2: advisory, before waiting for any lock

  let locked;
  try {
    // Requested in the same synchronous turn as the notice (withLock calls
    // LockManager.request before its first await).
    locked = await deps.coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "exclusive",
      async ({ scope }) => {
        const intent = await establishIntent(scope, deps);
        const established = intent.status === "recorded" || intent.status === "joined";
        const escalation = established ? null : escalate(deps);
        const marker = await removeMarkerWithin(scope, deps);
        advise(deps, "state-changed");
        return { intent, escalation, marker, established };
      },
    );
  } catch {
    locked = { kind: "failed" as const };
  }

  if (locked.kind === "done") {
    const { intent, escalation, marker, established } = locked.value;
    return {
      blockToken,
      path: established ? "ordinary" : "exceptional",
      coordination: "acquired",
      intent,
      escalation,
      marker,
      durable: {
        intent: established,
        safetyLock: escalation?.durable === true,
        markerInvalidated: marker === "removed" || marker === "absent",
      },
    };
  }

  // Emergency escalation OUTSIDE any lock (lock unavailable or failed). The
  // in-memory block remains; no IndexedDB write is attempted uncoordinated.
  const escalation = escalate(deps);
  return {
    blockToken,
    path: "exceptional",
    coordination: "unavailable",
    intent: { status: "not-attempted" },
    escalation,
    marker: "not-attempted",
    durable: { intent: false, safetyLock: escalation.durable, markerInvalidated: false },
  };
}

// ---------------------------------------------------------------------------
// Under tnle-auth
// ---------------------------------------------------------------------------

/** The intent as observed under a live `tnle-auth` ticket. */
export interface IntentObservation {
  readonly ticket: AuthTicket;
  readonly token: string;
}

/** A server request begun AFTER an observation, under the same ticket. */
export interface ConfirmingRequest {
  readonly observation: IntentObservation;
}

const observations = new WeakMap<IntentObservation, { requested: boolean }>();
const requests = new WeakMap<ConfirmingRequest, { consumed: boolean }>();

export type IntentRead =
  | { status: "pending"; observation: IntentObservation; state: SecurityState }
  | { status: "none"; state: SecurityState }
  | { status: "unreadable"; state: SecurityState }
  | { status: "unavailable" };

export async function readIntentUnderAuth(
  ticket: AuthTicket,
  deps: SecurityDeps,
): Promise<IntentRead> {
  assertLiveTicket(ticket);
  const result = await deps.coordinator.withLock(
    ticket.scope,
    SECURITY_LOCK,
    "shared",
    ({ scope }) => inspectSecurityState(scope, deps),
  );
  if (result.kind !== "done") return { status: "unavailable" };
  const state = result.value;
  const intent = state.evidence.intent;
  if (intent.kind === "pending") {
    const observation: IntentObservation = Object.freeze({ ticket, token: intent.token });
    observations.set(observation, { requested: false });
    return { status: "pending", observation, state };
  }
  if (intent.kind === "absent") return { status: "none", state };
  return { status: "unreadable", state };
}

export type QueuedSignOutPlan =
  | { action: "send"; observation: IntentObservation }
  /** The intent this sign-out recorded or joined has been resolved; send nothing. */
  | { action: "resolved" }
  | { action: "blocked" };

/**
 * Decides, under `tnle-auth`, whether a sign-out that recorded or joined the
 * intent identified by `token` must still send its server request.
 */
export function planQueuedSignOut(token: string, read: IntentRead): QueuedSignOutPlan {
  if (read.status === "pending") {
    return read.observation.token === token
      ? { action: "send", observation: read.observation }
      : { action: "resolved" };
  }
  return read.status === "none" ? { action: "resolved" } : { action: "blocked" };
}

/** Call BEFORE sending the server request whose outcome may confirm the observed intent. */
export function beginConfirmingRequest(observation: IntentObservation): ConfirmingRequest {
  const entry = observations.get(observation);
  if (entry === undefined || entry.requested) throw new OwnershipError("handle-invalid");
  assertLiveTicket(observation.ticket);
  entry.requested = true;
  const request: ConfirmingRequest = Object.freeze({ observation });
  requests.set(request, { consumed: false });
  return request;
}

export type ServerOutcome = "server-confirmed" | "not-confirmed";

export type CompletionResult =
  /** Marker absent (removed and verified, or already absent), then the intent cleared and verified. */
  | { kind: "cleared"; marker: "removed" | "absent" }
  /**
   * The server sign-out WAS confirmed, but the surviving lifecycle marker could
   * not be removed or its removal verified: local termination is incomplete,
   * and the intent is RETAINED (3b-iii-b, Q25).
   */
  | { kind: "marker-remove-failed"; serverConfirmed: true }
  /** Server sign-out not confirmed: the intent remains pending. */
  | { kind: "not-confirmed" }
  /** The observed intent was already resolved; nothing cleared. */
  | { kind: "already-resolved" }
  /** A different (newer) intent is stored; it was preserved. */
  | { kind: "newer-intent-preserved" }
  | { kind: "unreadable" }
  /** Marker absent, but the intent could not be cleared or its clearing verified; it remains. */
  | { kind: "clear-failed"; marker: "removed" | "absent" }
  | { kind: "unavailable" };

type StoredIntentRead = { kind: "absent" } | { kind: "invalid" } | { kind: "valid"; token: string };

/** Read-only intent read (one state transaction). Throws on storage failure. */
async function readIntentRecord(deps: SecurityDeps): Promise<StoredIntentRead | null> {
  const db = await openStateDatabase(deps);
  if (db === null) return null;
  try {
    const stored: unknown = await db.get("state", "signout_intent");
    if (stored === undefined) return { kind: "absent" };
    const checked = validateStoredSignOutIntent(stored);
    return checked.ok ? { kind: "valid", token: checked.record.created_at } : { kind: "invalid" };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function completeServerSignOut(
  request: ConfirmingRequest,
  outcome: ServerOutcome,
  deps: SecurityDeps,
): Promise<CompletionResult> {
  const entry = requests.get(request);
  if (entry === undefined || entry.consumed) throw new OwnershipError("handle-invalid");
  const { ticket, token } = request.observation;
  assertLiveTicket(ticket);
  entry.consumed = true;
  if (outcome !== "server-confirmed") return { kind: "not-confirmed" };

  const result = await deps.coordinator.withLock(
    ticket.scope,
    SECURITY_LOCK,
    "exclusive",
    async ({ scope }): Promise<CompletionResult> => {
      assertSecurityLockHeld(scope);
      // 1. Read and compare ownership BEFORE touching the data database.
      const observed = await readIntentRecord(deps);
      if (observed === null || observed.kind === "invalid") return { kind: "unreadable" };
      if (observed.kind === "absent") return { kind: "already-resolved" };
      if (observed.token !== token) return { kind: "newer-intent-preserved" };

      // 2. Remove any surviving marker of the terminated lifecycle and verify
      //    its absence (removal never assumes validity). On failure the intent
      //    is retained: clearing it would make the terminated lifecycle current.
      const marker = await removeMarkerWithin(scope, deps);
      if (marker === "remove-failed")
        return { kind: "marker-remove-failed", serverConfirmed: true };

      // 3. Re-read, compare again, clear, and verify.
      const db = await openStateDatabase(deps);
      if (db === null) return { kind: "clear-failed", marker };
      try {
        const tx = db.transaction("state", "readwrite");
        const stored: unknown = await tx.store.get("signout_intent");
        if (stored === undefined) {
          await tx.done;
          return { kind: "already-resolved" };
        }
        const current = validateStoredSignOutIntent(stored);
        if (!current.ok) {
          await tx.done;
          return { kind: "unreadable" };
        }
        if (current.record.created_at !== token) return { kind: "newer-intent-preserved" };
        await tx.store.delete("signout_intent");
        await tx.done;
        if ((await db.get("state", "signout_intent")) !== undefined) {
          return { kind: "clear-failed", marker };
        }
      } catch {
        return { kind: "clear-failed", marker };
      } finally {
        db.close();
      }
      // 4. Residual records, failure records, and D22 are deliberately untouched.
      advise(deps, "state-changed");
      return { kind: "cleared", marker };
    },
  );
  return result.kind === "done" ? result.value : { kind: "unavailable" };
}
