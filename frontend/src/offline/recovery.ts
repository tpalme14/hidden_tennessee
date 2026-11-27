import { fullCleanupWithin, type FailureEscalation, type RemainingEvidence } from "./cleanup";
import { createLockScope, SECURITY_LOCK } from "./locks";
import { validateStoredSignOutIntent } from "./records";
import {
  assertLiveTicket,
  inspectSecurityState,
  openStateDatabase,
  OwnershipError,
  removeMarkerWithin,
  type AuthTicket,
  type FailureEvidence,
  type IntentEvidence,
  type SecurityClassification,
  type SecurityDeps,
  type SecurityState,
} from "./securityState";
import { advise } from "./signOutIntent";

/**
 * Local failure-record recovery (M06-T03 Increment 3b-iii-c2; Specification 6
 * v1.1 OFF-FAIL-3 and OFF-LIFE-9 clarifications of November 26, 2026; AC-40).
 *
 * `recoverLocalFailure` resolves a durable failure record WITHOUT any server
 * request: it requires that every record in the offline data database (all
 * five stores) has been removed and that removal verified, then removes the
 * failure record transactionally and verifies the removal. It holds
 * `tnle-offline-security` EXCLUSIVE only — never `tnle-auth` — and makes no
 * network request.
 *
 * It is refused, without durable modification, when at its initial inspection
 * a sign-out intent (valid, malformed, or unreadable) or the safety lock
 * (present or unreadable) exists, or the data database cannot be reliably
 * inspected. These are server-obligation or uncertainty conditions (the
 * failure-record invariant: a failure record is never the sole evidence of an
 * unresolved server sign-out). Reader-side refusal detects such evidence only
 * when it EXISTS.
 *
 * Discard authorization: `authorizeDiscard` is required whenever recovery would
 * remove saved copies (any `landmarks`/`trips` record, counted without
 * validation), a valid current lifecycle, a malformed lifecycle marker, or
 * unrecognized metadata. It is an isolated implementation input — NOT evidence
 * that a user consented; the disclosure and consent flow is an integration
 * obligation. It never overrides unreadable storage.
 *
 * It never clears D22 or a sign-out intent, never implies a server sign-out,
 * never releases this tab's local block (taken synchronously at the start),
 * and never creates a lifecycle. `cleanAtFinalInspection` is an observation at
 * one instant, not a guarantee: a later emergency D22 is not prevented, and
 * any later authorization must re-inspect durable state. There is no
 * atomicity between IndexedDB and `localStorage`.
 *
 * 3b-iii-c3a (restricted; see below): recovery ownership capabilities and safe
 * partial server-confirmed recovery that never removes an intent or clears D22.
 *
 * Nothing runs on import; nothing here is connected to the application.
 */

export type RecordState = "removed-verified" | "retained" | "absent" | "unknown";
export type CleanupPerformed = "not-needed" | "metadata-only" | "saved-copies-discarded";

export type LocalRecoveryRefusal =
  | "no-failure-record"
  | "state-unreadable"
  | "intent-pending"
  | "intent-malformed"
  | "safety-lock-present"
  | "safety-lock-unreadable"
  | "data-unreadable"
  | "authorization-required";

export type LocalRecoveryResult =
  /** The failure record was removed and the removal verified (the local obligation is resolved). */
  | {
      kind: "recovered";
      blockToken: number;
      recordState: "removed-verified";
      cleanup: CleanupPerformed;
      /** The primary classification observed by the final inspection. */
      final: SecurityClassification;
      /** An observation at the final inspection only — never a continuing guarantee or capability. */
      cleanAtFinalInspection: boolean;
    }
  /** Data verified empty, but D22 was present or unreadable at the final removal gate: the record was kept. */
  | {
      kind: "local-resolved-record-retained";
      blockToken: number;
      recordState: "retained";
      reason: "safety-lock-present" | "safety-lock-unreadable";
      cleanup: CleanupPerformed;
    }
  /** Refused without durable modification. */
  | {
      kind: "refused";
      blockToken: number;
      reason: LocalRecoveryRefusal;
      recordState: "retained" | "absent" | "unknown";
    }
  | {
      kind: "failed";
      blockToken: number;
      stage: "cleanup" | "verification" | "record-removal" | "record-verification";
      recordState: "retained" | "unknown";
      escalation: FailureEscalation | null;
      remaining: RemainingEvidence | null;
    }
  /** The security lock could not be used; nothing was inspected or modified. */
  | { kind: "unavailable"; blockToken: number; recordState: "unknown" };

function recordStateOf(failure: FailureEvidence): "retained" | "absent" | "unknown" {
  if (failure.kind === "present" || failure.kind === "invalid") return "retained";
  return failure.kind === "absent" ? "absent" : "unknown";
}

function dataReadable(state: SecurityState): boolean {
  const e = state.evidence;
  return (
    e.marker.kind !== "unreadable" &&
    e.residual !== "unreadable" &&
    e.metadata !== "unreadable" &&
    e.savedCopies !== "unknown"
  );
}

/** Whether removing the data database's contents needs explicit discard authorization. */
function needsDiscardAuthorization(state: SecurityState): boolean {
  const e = state.evidence;
  return (
    e.savedCopies !== "none" ||
    e.marker.kind === "valid" ||
    e.marker.kind === "invalid" ||
    e.metadata !== "valid"
  );
}

function refusalFor(state: SecurityState): LocalRecoveryRefusal | null {
  const e = state.evidence;
  if (e.failure.kind === "absent") return "no-failure-record";
  if (e.failure.kind === "unreadable") return "state-unreadable";
  if (e.intent.kind === "pending") return "intent-pending";
  if (e.intent.kind === "invalid") return "intent-malformed";
  if (e.intent.kind === "unreadable") return "state-unreadable";
  if (e.safetyLock === "present") return "safety-lock-present";
  if (e.safetyLock === "unreadable") return "safety-lock-unreadable";
  if (!dataReadable(state)) return "data-unreadable";
  return null;
}

type RemovalOutcome =
  | { kind: "removed" }
  | { kind: "refused"; reason: LocalRecoveryRefusal; recordState: "retained" | "absent" }
  | { kind: "failed"; recordState: "retained" | "unknown" };

/** Aborts a transaction and consumes its expected rejection (nothing was written). */
async function abortQuietly(tx: { abort(): void; done: Promise<void> }): Promise<void> {
  tx.abort();
  await tx.done.catch(() => undefined);
}

/**
 * One readwrite `state` transaction: re-check the failure record (valid or
 * malformed) still exists, then delete it. With `must-be-absent` (c2) any
 * intent aborts the removal; with `independent-evidence-allowed` (c3a) an
 * intent may remain as the independent server-obligation evidence — it is
 * never touched.
 */
async function removeFailureRecord(
  deps: SecurityDeps,
  intentPolicy: "must-be-absent" | "independent-evidence-allowed" = "must-be-absent",
): Promise<RemovalOutcome> {
  const db = await openStateDatabase(deps);
  if (db === null) return { kind: "failed", recordState: "unknown" };
  let deleteIssued = false;
  try {
    const tx = db.transaction("state", "readwrite");
    const intent: unknown = await tx.store.get("signout_intent");
    if (intent !== undefined && intentPolicy === "must-be-absent") {
      await abortQuietly(tx);
      const reason = validateStoredSignOutIntent(intent).ok ? "intent-pending" : "intent-malformed";
      return { kind: "refused", reason, recordState: "retained" };
    }
    const failure: unknown = await tx.store.get("failure");
    if (failure === undefined) {
      await abortQuietly(tx);
      return { kind: "refused", reason: "no-failure-record", recordState: "absent" };
    }
    deleteIssued = true;
    await tx.store.delete("failure");
    await tx.done;
    return { kind: "removed" };
  } catch {
    // Before the delete was issued nothing could have committed.
    return { kind: "failed", recordState: deleteIssued ? "unknown" : "retained" };
  } finally {
    db.close();
  }
}

/** Separate read-back: true only when the failure record is verifiably absent. */
async function failureRecordAbsent(deps: SecurityDeps): Promise<boolean> {
  const db = await openStateDatabase(deps);
  if (db === null) return false;
  try {
    return (await db.get("state", "failure")) === undefined;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

export async function recoverLocalFailure(
  deps: SecurityDeps,
  options: { authorizeDiscard?: boolean } = {},
): Promise<LocalRecoveryResult> {
  const blockToken = deps.generation.block(); // 1. synchronous local block, never released here
  advise(deps, "lifecycle-ended"); // 2. advisory; recovery may remove a lifecycle
  const authorizeDiscard = options.authorizeDiscard === true;

  const result = await deps.coordinator.withLock(
    createLockScope(),
    SECURITY_LOCK,
    "exclusive",
    async ({ scope }): Promise<LocalRecoveryResult> => {
      // 4. Fresh inspection and eligibility (refusals change nothing durable).
      const initial = await inspectSecurityState(scope, deps);
      const refusal = refusalFor(initial);
      if (refusal !== null) {
        return {
          kind: "refused",
          blockToken,
          reason: refusal,
          recordState: recordStateOf(initial.evidence.failure),
        };
      }
      const needsAuthorization = needsDiscardAuthorization(initial);
      if (needsAuthorization && !authorizeDiscard) {
        return {
          kind: "refused",
          blockToken,
          reason: "authorization-required",
          recordState: "retained",
        };
      }

      // 6. Full cleanup inside the held exclusive callback when data remains.
      let cleanup: CleanupPerformed = "not-needed";
      if (!initial.evidence.dataEmpty) {
        const cleaned = await fullCleanupWithin(scope, deps, { destructive: authorizeDiscard });
        if (cleaned.kind === "failed") {
          const durable =
            cleaned.escalation.failureRecord === "written" ||
            cleaned.escalation.failureRecord === "joined" ||
            cleaned.escalation.failureRecord === "preserved-malformed";
          return {
            kind: "failed",
            blockToken,
            stage: cleaned.stage === "transaction" ? "cleanup" : "verification",
            recordState: durable ? "retained" : "unknown",
            escalation: cleaned.escalation,
            remaining: cleaned.remaining,
          };
        }
        if (cleaned.kind !== "cleaned") {
          // The extracted helper's own gate refused: never weakened for recovery.
          return {
            kind: "refused",
            blockToken,
            reason: "authorization-required",
            recordState: "retained",
          };
        }
        cleanup =
          initial.evidence.savedCopies === "present" ? "saved-copies-discarded" : "metadata-only";
      }

      // 7. Independent verification that all five data stores are empty now.
      const verified = await inspectSecurityState(scope, deps);
      if (!verified.evidence.dataEmpty) {
        return {
          kind: "failed",
          blockToken,
          stage: "verification",
          recordState:
            recordStateOf(verified.evidence.failure) === "retained" ? "retained" : "unknown",
          escalation: null,
          remaining: null,
        };
      }

      // 8. Final removal gate: D22 (which may have been set outside any lock) keeps the record.
      const gate = deps.safetyLock.read();
      if (gate !== "absent") {
        return {
          kind: "local-resolved-record-retained",
          blockToken,
          recordState: "retained",
          reason: gate === "present" ? "safety-lock-present" : "safety-lock-unreadable",
          cleanup,
        };
      }

      // 9–10. Transactional re-check and removal.
      const removal = await removeFailureRecord(deps);
      if (removal.kind === "refused") {
        return {
          kind: "refused",
          blockToken,
          reason: removal.reason,
          recordState: removal.recordState,
        };
      }
      if (removal.kind === "failed") {
        return {
          kind: "failed",
          blockToken,
          stage: "record-removal",
          recordState: removal.recordState,
          escalation: null,
          remaining: null,
        };
      }

      // 11. Verified removal (the delete may have committed even if this read fails).
      if (!(await failureRecordAbsent(deps))) {
        return {
          kind: "failed",
          blockToken,
          stage: "record-verification",
          recordState: "unknown",
          escalation: null,
          remaining: null,
        };
      }
      advise(deps, "failure-changed"); // 12.

      // 13. Final observation; 14. the local block is retained.
      const final = await inspectSecurityState(scope, deps);
      return {
        kind: "recovered",
        blockToken,
        recordState: "removed-verified",
        cleanup,
        final: final.primary,
        cleanAtFinalInspection: final.primary === "none",
      };
    },
  );
  return result.kind === "done"
    ? result.value
    : { kind: "unavailable", blockToken, recordState: "unknown" };
}

// ---------------------------------------------------------------------------
// 3b-iii-c3a — recovery ownership capabilities and SAFE PARTIAL recovery
// ---------------------------------------------------------------------------
//
// Restricted by the developer's c3 dispositions (2026-11-26; Q47–Q51; A2
// fail-closed): only transitions whose safety does NOT depend on A2 are
// performed. In particular this code NEVER removes a sign-out intent (valid or
// malformed) and NEVER clears D22: a synthetic `signed-out`/`no-session`
// outcome is not evidence that the confirmation is fresh enough to discharge a
// server obligation. What it may do, after a confirmed outcome only:
//
// - mandatory invalidation: remove (and verify) the lifecycle marker of a
//   lifecycle terminated by a pending or malformed intent (OFF-LIFE-9: no
//   discard authorization needed; the intent itself stays);
// - local failure-record resolution (Q32): optional full cleanup with discard
//   authorization where c2 requires it, an independent emptiness verification,
//   then a transactional removal and read-back of the failure record, while
//   any intent and D22 remain as the independent server-obligation evidence.
//
// The outcome enum is an isolated input; the module cannot observe network
// calls. 3c must derive it from validated responses, create the request before
// sending, and send no other authentication request under the ticket between
// the request and completion.

/** The synthetic server outcome supplied to `completeRecovery` (never proof of session termination). */
export type RecoveryOutcome = "signed-out" | "no-session" | "not-confirmed";

/** Registered, frozen record of what the recovery observed under a live ticket. */
export interface RecoveryObservation {
  readonly ticket: AuthTicket;
  readonly blockToken: number;
  readonly observed: {
    readonly intent: IntentEvidence["kind"];
    readonly failure: FailureEvidence["kind"];
    readonly safetyLock: "absent" | "present" | "unreadable";
  };
}

/** A single-use capability for the server request made after an observation. */
export interface RecoveryRequest {
  readonly observation: RecoveryObservation;
}

export type RecoveryObservationResult =
  | { status: "observed"; observation: RecoveryObservation }
  | { status: "unavailable"; blockToken: number };

const recoveryObservations = new WeakMap<RecoveryObservation, { requested: boolean }>();
const recoveryRequests = new WeakMap<RecoveryRequest, { consumed: boolean }>();
const ticketsWithRecoveryRequest = new WeakSet<AuthTicket>();

/**
 * Observes the durable security state for a recovery under a LIVE `tnle-auth`
 * ticket. Blocks this tab synchronously and posts the advisory notice first;
 * the inspection holds `tnle-offline-security` SHARED (auth → security).
 */
export async function observeForRecovery(
  ticket: AuthTicket,
  deps: SecurityDeps,
): Promise<RecoveryObservationResult> {
  assertLiveTicket(ticket);
  const blockToken = deps.generation.block();
  advise(deps, "lifecycle-ended");
  const result = await deps.coordinator.withLock(
    ticket.scope,
    SECURITY_LOCK,
    "shared",
    ({ scope }) => inspectSecurityState(scope, deps),
  );
  if (result.kind !== "done") return { status: "unavailable", blockToken };
  const e = result.value.evidence;
  const observation: RecoveryObservation = Object.freeze({
    ticket,
    blockToken,
    observed: Object.freeze({
      intent: e.intent.kind,
      failure: e.failure.kind,
      safetyLock: e.safetyLock,
    }),
  });
  recoveryObservations.set(observation, { requested: false });
  return { status: "observed", observation };
}

/**
 * Issues the single-use request capability. Must be called BEFORE the server
 * request is sent. At most one per observation and one per ticket.
 */
export function beginRecoveryRequest(observation: RecoveryObservation): RecoveryRequest {
  const entry = recoveryObservations.get(observation);
  if (entry === undefined || entry.requested) throw new OwnershipError("handle-invalid");
  assertLiveTicket(observation.ticket);
  if (ticketsWithRecoveryRequest.has(observation.ticket)) {
    throw new OwnershipError("handle-invalid");
  }
  entry.requested = true;
  ticketsWithRecoveryRequest.add(observation.ticket);
  const request: RecoveryRequest = Object.freeze({ observation });
  recoveryRequests.set(request, { consumed: false });
  return request;
}

export type RemainingObligation =
  "sign-out-intent" | "safety-lock" | "failure-record" | "saved-copies-awaiting-authorization";

export type ServerRecoveryResult =
  /** `not-confirmed`: nothing was inspected or changed; the request is consumed. */
  | { kind: "not-confirmed"; blockToken: number; changes: "none" }
  /** Refused at the fresh inspection, nothing changed. */
  | {
      kind: "refused";
      blockToken: number;
      reason: "state-unreadable" | "data-unreadable" | "safety-lock-unreadable";
      changes: "none";
    }
  /**
   * The applicable safe transitions completed. `completed` only when no
   * obligation remains; otherwise `partial`. Overall recovery is never implied
   * while an intent or D22 remains; `cleanAtFinalInspection` is an observation.
   */
  | {
      kind: "partial" | "completed";
      blockToken: number;
      serverOutcome: "signed-out" | "no-session";
      /** A2 is unapproved: the confirmation's freshness is never established here. */
      confirmationFreshness: "unestablished";
      marker: "removed" | "absent" | "not-applicable";
      intent: "retained" | "absent";
      failureRecord: "removed-verified" | "retained" | "absent";
      cleanup: CleanupPerformed | "awaiting-authorization" | "not-applicable";
      d22: "retained" | "absent";
      final: SecurityClassification;
      cleanAtFinalInspection: boolean;
      remainingObligations: RemainingObligation[];
    }
  | {
      kind: "failed";
      blockToken: number;
      stage:
        | "marker-invalidation"
        | "cleanup"
        | "verification"
        | "record-removal"
        | "record-verification";
      recordState: "retained" | "absent" | "unknown";
      escalation: FailureEscalation | null;
      remaining: RemainingEvidence | null;
    }
  | { kind: "unavailable"; blockToken: number };

/**
 * Completes a recovery with a SYNTHETIC outcome under the request's live
 * ticket. Every call with a registered request consumes it (including
 * unsuccessful ones). `not-confirmed` changes nothing. Never removes an intent,
 * never clears D22, never unblocks, never creates a lifecycle.
 */
export async function completeRecovery(
  request: RecoveryRequest,
  outcome: RecoveryOutcome,
  deps: SecurityDeps,
  options: { authorizeDiscard?: boolean } = {},
): Promise<ServerRecoveryResult> {
  const entry = recoveryRequests.get(request);
  if (entry === undefined || entry.consumed) throw new OwnershipError("handle-invalid");
  entry.consumed = true;
  const { ticket, blockToken } = request.observation;
  assertLiveTicket(ticket);
  if (outcome === "not-confirmed") return { kind: "not-confirmed", blockToken, changes: "none" };
  const authorizeDiscard = options.authorizeDiscard === true;

  const result = await deps.coordinator.withLock(
    ticket.scope,
    SECURITY_LOCK,
    "exclusive",
    async ({ scope }): Promise<ServerRecoveryResult> => {
      const initial = await inspectSecurityState(scope, deps);
      const e = initial.evidence;
      if (e.intent.kind === "unreadable" || e.failure.kind === "unreadable") {
        return { kind: "refused", blockToken, reason: "state-unreadable", changes: "none" };
      }
      if (e.safetyLock === "unreadable") {
        return { kind: "refused", blockToken, reason: "safety-lock-unreadable", changes: "none" };
      }
      if (!dataReadable(initial)) {
        return { kind: "refused", blockToken, reason: "data-unreadable", changes: "none" };
      }
      const terminated = e.intent.kind === "pending" || e.intent.kind === "invalid";

      // Mandatory invalidation: a lifecycle terminated by an intent loses its marker.
      let marker: "removed" | "absent" | "not-applicable" = "not-applicable";
      if (terminated && e.marker.kind !== "absent") {
        const removal = await removeMarkerWithin(scope, deps);
        if (removal === "remove-failed") {
          return {
            kind: "failed",
            blockToken,
            stage: "marker-invalidation",
            recordState: recordStateOf(e.failure),
            escalation: null,
            remaining: null,
          };
        }
        marker = removal;
      }

      // Local failure-record resolution (optional destructive part needs authorization).
      let failureRecord: "removed-verified" | "retained" | "absent" =
        e.failure.kind === "absent" ? "absent" : "retained";
      let cleanup: CleanupPerformed | "awaiting-authorization" | "not-applicable" =
        "not-applicable";
      if (e.failure.kind === "present" || e.failure.kind === "invalid") {
        const current = await inspectSecurityState(scope, deps);
        const needsAuthorization =
          current.evidence.savedCopies !== "none" ||
          (!terminated && current.evidence.marker.kind !== "absent") ||
          current.evidence.metadata !== "valid";
        if (needsAuthorization && !authorizeDiscard) {
          cleanup = "awaiting-authorization";
        } else {
          cleanup = "not-needed";
          if (!current.evidence.dataEmpty) {
            const cleaned = await fullCleanupWithin(scope, deps, { destructive: authorizeDiscard });
            if (cleaned.kind === "failed") {
              const durable =
                cleaned.escalation.failureRecord === "written" ||
                cleaned.escalation.failureRecord === "joined" ||
                cleaned.escalation.failureRecord === "preserved-malformed";
              return {
                kind: "failed",
                blockToken,
                stage: cleaned.stage === "transaction" ? "cleanup" : "verification",
                recordState: durable ? "retained" : "unknown",
                escalation: cleaned.escalation,
                remaining: cleaned.remaining,
              };
            }
            if (cleaned.kind !== "cleaned") {
              cleanup = "awaiting-authorization"; // the helper's own gate refused
            } else {
              cleanup =
                current.evidence.savedCopies === "present"
                  ? "saved-copies-discarded"
                  : "metadata-only";
            }
          }
          if (cleanup !== "awaiting-authorization") {
            const verified = await inspectSecurityState(scope, deps);
            if (!verified.evidence.dataEmpty) {
              return {
                kind: "failed",
                blockToken,
                stage: "verification",
                recordState: "retained",
                escalation: null,
                remaining: null,
              };
            }
            const removal = await removeFailureRecord(deps, "independent-evidence-allowed");
            if (removal.kind === "failed") {
              return {
                kind: "failed",
                blockToken,
                stage: "record-removal",
                recordState: removal.recordState,
                escalation: null,
                remaining: null,
              };
            }
            if (removal.kind === "removed") {
              if (!(await failureRecordAbsent(deps))) {
                return {
                  kind: "failed",
                  blockToken,
                  stage: "record-verification",
                  recordState: "unknown",
                  escalation: null,
                  remaining: null,
                };
              }
              failureRecord = "removed-verified";
              advise(deps, "failure-changed");
            } else {
              failureRecord = removal.recordState === "absent" ? "absent" : "retained";
            }
          }
        }
      }

      const final = await inspectSecurityState(scope, deps);
      const fe = final.evidence;
      const remainingObligations: RemainingObligation[] = [];
      if (fe.intent.kind !== "absent") remainingObligations.push("sign-out-intent");
      if (fe.safetyLock !== "absent") remainingObligations.push("safety-lock");
      if (fe.failure.kind !== "absent") remainingObligations.push("failure-record");
      if (cleanup === "awaiting-authorization") {
        remainingObligations.push("saved-copies-awaiting-authorization");
      }
      advise(deps, "state-changed");
      return {
        kind: remainingObligations.length === 0 ? "completed" : "partial",
        blockToken,
        serverOutcome: outcome,
        confirmationFreshness: "unestablished",
        marker,
        intent: fe.intent.kind === "absent" ? "absent" : "retained",
        failureRecord,
        cleanup,
        d22: fe.safetyLock === "absent" ? "absent" : "retained",
        final: final.primary,
        cleanAtFinalInspection: final.primary === "none",
        remainingObligations,
      };
    },
  );
  return result.kind === "done" ? result.value : { kind: "unavailable", blockToken };
}
