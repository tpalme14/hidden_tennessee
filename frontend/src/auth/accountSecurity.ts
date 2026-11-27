import { createContext, useContext } from "react";
import {
  getSession as apiGetSession,
  signIn as apiSignIn,
  signOut as apiSignOut,
  type AuthUser,
  type SessionResponse,
} from "../api/auth";
import { ApiError } from "../api/client";
import { probeWebLocks, type ProbeOutcome } from "../offline/capabilities";
import {
  cleanupAll,
  cleanupResidual,
  deleteAllOfflineData,
  type CleanupResult,
  type DeletionProgress,
} from "../offline/cleanup";
import { recoverLocalFailure, type LocalRecoveryRefusal } from "../offline/recovery";
import { browserSnapshotNetwork, type SnapshotNetwork } from "../offline/snapshotNetwork";
import {
  createSnapshotOperations,
  createSnapshotView,
  type SnapshotIdentity,
  type SnapshotOperations,
} from "../offline/snapshots";
import {
  openOfflineDataDatabase,
  openOfflineStateDatabase,
  probeOfflineDataDatabase,
  probeOfflineStateDatabase,
} from "../offline/db";
import { confirmIdentity, endLifecycleWithoutSession } from "../offline/lifecycle";
import { createLockCoordinator } from "../offline/locks";
import { createNoticeChannel, type NoticeChannel } from "../offline/notices";
import { createSafetyLock } from "../offline/safetyLock";
import { createSecurityGeneration } from "../offline/securityGeneration";
import {
  inspectWithoutCreating,
  readSecurityState,
  runAuthOperation,
  type AuthTicket,
  type NonCreatingInspectionDeps,
  type SecurityDeps,
  type SecurityEvidence,
  type SecurityState,
} from "../offline/securityState";
import {
  beginConfirmingRequest,
  beginSignOut,
  completeServerSignOut,
  planQueuedSignOut,
  readIntentUnderAuth,
  type CompletionResult,
  type ConfirmingRequest,
  type ServerOutcome,
} from "../offline/signOutIntent";
import { updateSafety, type UpdateSafety } from "../pwa/updateSafety";

/**
 * Authentication integration with the offline security foundation (M06-T03
 * Increment 3c-1a; Specification 6 v1.1 as amended November 26, 2026:
 * OFF-OUT-1–11, OFF-LIFE-2–9, OFF-CONC-4, OFF-FAIL-5; ADR-007 amendment;
 * approved decisions U3, U4, U5, U7; DR-2, DR-4, DR-5; A3).
 *
 * Every operation that can change signed-in state or offline security state
 * is COORDINATED: it holds an update-safety operation hold (DR-5) from before
 * its first request through every durable follow-up step, and runs its server
 * requests under exclusive `tnle-auth` (`runAuthOperation`). A refused hold
 * starts nothing (DR-4). Without usable Web Locks nothing is started, no
 * session is restored, and no offline storage is probed, created, or modified
 * (OFF-OUT-7 amendment, U2, AC-36).
 *
 * Restriction rule (U4). Authenticated functionality and sign-in credentials
 * are refused when Web Locks is unusable, D22 is present or unreadable, or the
 * sign-out intent is pending, invalid, or cannot be read (an unreadable state
 * database included). Unreadable intent evidence is never treated as absent.
 * Other offline storage problems only lock the offline library: verified
 * online access remains (OFF-LIFE-9).
 *
 * Server confirmation (OFF-OUT-11, A3, U7). A sign-out is confirmed only by
 * `api/auth.signOut` resolving (its validated `success: true`) or by
 * `api/auth.getSession` resolving `null` (a validated 200 with a null body),
 * each obtained under the same live ticket through a confirming request created
 * BEFORE the request was sent, and passed straight to `completeServerSignOut`.
 * Network failures, malformed bodies, and other errors are never confirmation.
 * A confirmation means the server reported no session at that time; it does
 * not establish that an earlier interrupted request cannot issue one later.
 *
 * Nothing here clears D22, uses the restricted recovery capabilities, reads or
 * writes snapshots, or changes any server contract.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Why signed-in functionality (and sign-in credentials) are unavailable on this device. */
export type AuthRestriction =
  | "coordination-unavailable"
  | "safety-lock"
  | "safety-lock-unreadable"
  | "sign-out-pending"
  | "state-unreadable";

/** Whether this tab's verified account may use the offline library (3d/3e consume it). */
/**
 * `offline-read` (3e; Specification 6 §4.2, §9.1): the server cannot be reached,
 * and this device's stored marker is the last account verified online, with a
 * clean, readable lifecycle and no restriction. Saved copies may be READ and
 * removed locally (E2) — nothing else. It is not authentication and never a
 * confirmed server session; only a coordinated check promotes it.
 */
export type OfflineEligibility = "eligible" | "offline-read" | "locked" | "none";

export type AccountSession =
  { status: "anonymous" } | { status: "authenticated"; user: AuthUser } | { status: "unavailable" };

/** The state an operation publishes: session, restriction, and offline eligibility are distinct. */
export interface AccountState {
  session: AccountSession;
  restriction: AuthRestriction | null;
  offline: OfflineEligibility;
}

export type RefusalReason = AuthRestriction | "updating" | "sign-out-not-confirmed";

/** A locally refused authentication operation: nothing was sent for it. */
export class AuthRefusal extends Error {
  constructor(readonly reason: RefusalReason) {
    super(`Authentication operation refused: ${reason}`);
    this.name = "AuthRefusal";
  }
}

/** Server confirmation, intent resolution, and local cleanup are reported separately. */
export interface SignOutOutcome {
  /** `confirmed-elsewhere`: another tab's validated confirmation resolved this sign-out's intent. */
  server: "confirmed" | "confirmed-elsewhere" | "not-confirmed" | "not-sent" | "not-needed";
  intent: "resolved" | "pending" | "not-recorded" | "unreadable" | "none";
  cleanup: "completed" | "failed" | "not-run";
  /**
   * 3c-2 (AC-32): the durable protection this sign-out established — its
   * intent record, the D22 safety lock when the intent could not be stored, or
   * only this page's memory when neither could be stored. Sign-out only.
   */
  protection?: "intent" | "safety-lock" | "memory-only";
}

/**
 * 3c-2: the durable state of the offline data on this device, from an
 * authoritative inspection. Separate from authentication restrictions, offline
 * eligibility, and server confirmation.
 * - `clean`: nothing to recover;
 * - `cleanup-required`: records of an ended lifecycle remain (mandatory cleanup);
 * - `failure-recorded`: a durable cleanup or invalidation failure is recorded;
 * - `unreadable`: the offline data, a marker, metadata, or the failure record
 *   cannot be reliably read;
 * - `unknown`: not inspected (no usable coordination).
 */
export type StorageStatus =
  "clean" | "cleanup-required" | "failure-recorded" | "unreadable" | "unknown";

export type RecoveryRefusal = "updating" | "coordination-unavailable";

export type RetryCleanupResult =
  | { kind: "refused"; reason: RecoveryRefusal }
  | { kind: "cleaned" }
  | { kind: "nothing-to-clean" }
  /** The cleanup failed; durable failure evidence was recorded (see `storage`). */
  | { kind: "failed" }
  /** The current state does not permit ordinary cleanup (for example unreadable storage). */
  | { kind: "not-possible" };

export type RecoverStorageResult =
  | { kind: "refused"; reason: RecoveryRefusal }
  | { kind: "recovered" }
  /** Saved copies or other data would be discarded: explicit consent is required first. */
  | { kind: "authorization-required" }
  | { kind: "not-possible"; reason: LocalRecoveryRefusal | "safety-lock-at-removal" }
  | { kind: "failed" };

export type DeleteAllOutcome =
  | { kind: "refused"; reason: RecoveryRefusal }
  /** Deleted on the browser's success event; then the failure-record result (R2). */
  | {
      kind: "deleted";
      failureRecord: "none" | "recovered" | "retained";
      retainedReason?: LocalRecoveryRefusal | "safety-lock-at-removal" | "failed";
    }
  | { kind: "failed" }
  /** Nothing was deleted: durable protection could not be established first. */
  | { kind: "not-attempted" };

export type CheckResult =
  { kind: "not-started" } | { kind: "done"; state: AccountState; followUp: boolean };

export type SignInResult =
  | { kind: "signed-in"; state: AccountState; followUp: boolean }
  | { kind: "refused"; reason: RefusalReason; state: AccountState | null }
  | { kind: "failed"; error: unknown };

export type SignOutStart =
  | { kind: "refused"; reason: RefusalReason }
  | { kind: "started"; done: Promise<{ outcome: SignOutOutcome; state: AccountState }> };

export type FinishResult =
  | { kind: "refused"; reason: RefusalReason }
  | { kind: "done"; outcome: SignOutOutcome; state: AccountState };

export interface AuthApi {
  getSession(): Promise<SessionResponse | null>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
}

export interface AccountSecurityOptions {
  deps: SecurityDeps;
  /** The same notice channel as `deps.notices`, opened and closed by the provider. */
  channel: Pick<NoticeChannel, "open" | "close">;
  inspection: NonCreatingInspectionDeps;
  api: AuthApi;
  safety: Pick<UpdateSafety, "acquireHold">;
  probeLocks: () => Promise<ProbeOutcome>;
  /** 3d: snapshot response classification (defaults to the browser wiring). */
  network?: SnapshotNetwork;
  /** 3d: best-effort persistent-storage request; absent when unsupported. */
  persist?: () => Promise<boolean>;
}

export interface AccountSecurity {
  readonly channel: Pick<NoticeChannel, "open" | "close">;
  /**
   * A coordinated session check (startup, refresh, retry, notices, visibility).
   * `proceed` is asked immediately before the request would be sent: a check
   * whose result can no longer be used (superseded, or the provider unmounted)
   * sends nothing and reports `not-started`.
   */
  checkSession(options?: { proceed?: () => boolean }): Promise<CheckResult>;
  /** Ordinary sign-in (`again: false`) or the explicit Sign in again (OFF-OUT-6). */
  signIn(email: string, password: string, again: boolean): Promise<SignInResult>;
  /** OFF-OUT-1. The local block happens synchronously, before this returns. */
  startSignOut(): SignOutStart;
  /** OFF-OUT-5 (also available with D22 or unreadable state; it never clears D22). */
  finishSigningOut(): Promise<FinishResult>;
  /** Synchronous in-memory block on a cross-tab notice (never authorizes anything). */
  blockLocally(): void;
  /** 3c-2: the durable storage status (non-creating when nothing is stored; never writes). */
  inspectStorage(): Promise<StorageStatus>;
  /** 3c-2: mandatory cleanup of an ended lifecycle (OFF-LIFE-9); no discard consent. */
  retryCleanup(): Promise<RetryCleanupResult>;
  /** 3c-2: local failure-record recovery (AC-40); `authorizeDiscard` only after explicit consent. */
  recoverStorage(authorizeDiscard: boolean): Promise<RecoverStorageResult>;
  /** 3c-2: Delete all offline data on this device (only after confirmation), then R2. */
  deleteAllData(onProgress?: (progress: DeletionProgress) => void): Promise<DeleteAllOutcome>;
  /** Whether Web Locks was found usable (null until probed). */
  coordinationUsable(): boolean | null;
  /**
   * 3d: landmark and trip snapshot operations for this tab's VERIFIED lifecycle
   * (set only by a created or reused lifecycle; cleared by any block, sign-out,
   * destructive recovery, or non-eligible result, which also clears the view).
   */
  readonly snapshots: SnapshotOperations;
  /** 3d (AC-37): a snapshot request answered 401; the provider starts a coordinated check. */
  onSessionCheckRequired(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const anonymous = (restriction: AuthRestriction | null): AccountState => ({
  session: { status: "anonymous" },
  restriction,
  offline: "none",
});
const unavailable = (): AccountState => ({
  session: { status: "unavailable" },
  restriction: null,
  offline: "none",
});
const authenticated = (user: AuthUser, offline: OfflineEligibility): AccountState => ({
  session: { status: "authenticated", user },
  restriction: null,
  offline,
});

/** U4: the only durable evidence that restricts authentication itself. */
export function restrictionFrom(evidence: SecurityEvidence): AuthRestriction | null {
  if (evidence.safetyLock === "present") return "safety-lock";
  if (evidence.safetyLock === "unreadable") return "safety-lock-unreadable";
  if (evidence.intent.kind === "pending") return "sign-out-pending";
  if (evidence.intent.kind !== "absent") return "state-unreadable"; // never treated as absent
  return null;
}

/** 3c-2: the storage status from authoritative evidence (independent of restrictions). */
export function storageFrom(evidence: SecurityEvidence): StorageStatus {
  if (evidence.failure.kind === "present") return "failure-recorded";
  if (
    evidence.failure.kind !== "absent" ||
    evidence.marker.kind === "invalid" ||
    evidence.marker.kind === "unreadable" ||
    evidence.residual === "unreadable" ||
    evidence.metadata !== "valid" ||
    evidence.savedCopies === "unknown"
  ) {
    return "unreadable";
  }
  if (evidence.residual === "present") return "cleanup-required";
  // Records of a lifecycle ended by a pending sign-out (its marker removed) remain.
  if (evidence.intent.kind === "pending" && !evidence.dataEmpty) return "cleanup-required";
  return "clean";
}

function cleanupStatus(result: CleanupResult): SignOutOutcome["cleanup"] {
  if (result.kind === "cleaned") return "completed";
  if (result.kind === "failed") return "failed";
  return "not-run";
}

function intentAfter(completion: CompletionResult): SignOutOutcome["intent"] {
  if (completion.kind === "cleared" || completion.kind === "already-resolved") return "resolved";
  if (completion.kind === "unreadable") return "unreadable";
  return "pending";
}

export function createAccountSecurity(options: AccountSecurityOptions): AccountSecurity {
  const { deps, inspection, api, safety } = options;
  let locks: boolean | null = null;
  let probing: Promise<boolean> | null = null;

  // 3d: the tab's verified lifecycle for snapshot operations.
  let verified: SnapshotIdentity | null = null;
  // 3e: the read-only identity while the server cannot be reached (never a session).
  let offlineRead: SnapshotIdentity | null = null;
  let offlineReadCandidate: SnapshotIdentity | null = null;
  const sessionCheckListeners = new Set<() => void>();
  const snapshots = createSnapshotOperations({
    security: deps,
    safety,
    network: options.network ?? browserSnapshotNetwork,
    identity: () => verified,
    readIdentity: () => verified ?? offlineRead,
    onSessionCheckRequired: () => {
      for (const listener of sessionCheckListeners) listener();
    },
    persist: options.persist,
    view: createSnapshotView(),
  });
  /** Ends snapshot eligibility in this tab and withdraws published content at once. */
  function forget(): void {
    verified = null;
    offlineRead = null;
    snapshots.clearView();
  }

  function locksUsable(): Promise<boolean> {
    probing ??= options.probeLocks().then(
      (outcome) => (locks = outcome === "operational"),
      () => (locks = false),
    );
    return probing;
  }

  /** Validated server sign-out outcome (A3): only a resolved `api.signOut` confirms. */
  async function sendSignOut(): Promise<ServerOutcome> {
    try {
      await api.signOut();
      return "server-confirmed";
    } catch {
      return "not-confirmed";
    }
  }

  /** The authoritative restriction after an operation's durable steps. */
  async function restrictionNow(ticket: AuthTicket): Promise<AuthRestriction | null> {
    const read = await readSecurityState(deps, ticket);
    return read.kind === "done" ? restrictionFrom(read.value.evidence) : "coordination-unavailable";
  }

  /** The D22 reading just before credentials are sent (another tab may set it without any lock). */
  function lockBeforeCredentials(): AuthRestriction | null {
    const reading = deps.safetyLock.read();
    if (reading === "present") return "safety-lock";
    if (reading === "unreadable") return "safety-lock-unreadable";
    return null;
  }

  /** Binds a validated server identity to the offline lifecycle (U5 identity-bound release). */
  async function applyIdentity(
    ticket: AuthTicket,
    user: AuthUser,
  ): Promise<{ state: AccountState; followUp: boolean }> {
    const confirmed = await confirmIdentity(ticket, user.id, deps, {
      releaseBlock: "identity-bound",
    });
    switch (confirmed.kind) {
      case "created":
      case "reused":
        verified = { accountId: user.id, lifecycleId: confirmed.lifecycleId };
        return { state: authenticated(user, "eligible"), followUp: false };
      case "account-switch": {
        if (confirmed.marker === "remove-failed") {
          return { state: authenticated(user, "locked"), followUp: false };
        }
        // OFF-LIFE-8: the previous lifecycle's records are cleaned before any
        // new lifecycle; a follow-up check (fresh ticket, fresh validated
        // identity) then creates it.
        const cleanup = await cleanupResidual(deps);
        const clean =
          cleanup.kind === "cleaned" || (cleanup.kind === "refused" && cleanup.reason === "none");
        return { state: authenticated(user, "locked"), followUp: clean };
      }
      case "refused": {
        if (confirmed.reason === "coordination-unavailable") {
          return { state: anonymous("coordination-unavailable"), followUp: false };
        }
        const restriction = await restrictionNow(ticket);
        return restriction !== null
          ? { state: anonymous(restriction), followUp: false } // never restored (OFF-OUT-4)
          : { state: authenticated(user, "locked"), followUp: false };
      }
    }
  }

  async function checkSession(options: { proceed?: () => boolean } = {}): Promise<CheckResult> {
    offlineReadCandidate = null;
    const result = await checkSessionOnce(options);
    if (result.kind === "done" && result.state.offline !== "eligible") {
      forget(); // withdraws content at once; then only an offline-read result re-grants reads
      if (result.state.offline === "offline-read") offlineRead = offlineReadCandidate;
    }
    if (result.kind === "done" && result.state.offline === "eligible") offlineRead = null;
    offlineReadCandidate = null;
    return result;
  }

  async function checkSessionOnce(options: { proceed?: () => boolean }): Promise<CheckResult> {
    const proceed = options.proceed ?? (() => true);
    const hold = safety.acquireHold();
    if (hold === null) return { kind: "not-started" };
    try {
      if (!(await locksUsable())) {
        return { kind: "done", state: anonymous("coordination-unavailable"), followUp: false };
      }
      const op = await runAuthOperation(deps, async (ticket): Promise<CheckResult> => {
        // Non-creating pre-check: when nothing is stored, no database is created.
        const pre = await inspectWithoutCreating(inspection);
        let request: ConfirmingRequest | null = null;
        let restriction: AuthRestriction | null = null;
        let stored = false;
        let inspected: SecurityState | null = null;
        if (pre.kind !== "no-conflicting-state") {
          const read = await readIntentUnderAuth(ticket, deps);
          if (read.status === "unavailable") {
            return { kind: "done", state: anonymous("coordination-unavailable"), followUp: false };
          }
          inspected = read.state;
          restriction = restrictionFrom(read.state.evidence);
          stored = !read.state.evidence.dataEmpty;
          // U7: the confirming request exists BEFORE get-session is sent.
          if (read.status === "pending") request = beginConfirmingRequest(read.observation);
        }

        if (!proceed()) {
          // Abandoned: nothing is sent, and an observed intent is left exactly as it was.
          if (request !== null) await completeServerSignOut(request, "not-confirmed", deps);
          return { kind: "not-started" };
        }
        let response: SessionResponse | null;
        try {
          response = await api.getSession();
        } catch (error) {
          // Not a confirmation of anything (OFF-OUT-8): nothing durable changes.
          if (request !== null) await completeServerSignOut(request, "not-confirmed", deps);
          if (restriction !== null) {
            return { kind: "done", state: anonymous(restriction), followUp: false };
          }
          // 3e offline-read: only when the server could not be REACHED (network,
          // 429, 5xx — never a 401, a malformed body, or a confirmed absence) and
          // the authoritative inspection found the stored marker's clean lifecycle.
          const unreachable =
            error instanceof ApiError &&
            (error.status === 0 || error.status === 429 || error.status >= 500);
          const marker = inspected?.evidence.marker;
          if (
            unreachable &&
            inspected !== null &&
            inspected.primary === "lifecycle" &&
            marker?.kind === "valid" &&
            !deps.generation.isBlocked()
          ) {
            offlineReadCandidate = {
              accountId: marker.marker.account_id,
              lifecycleId: marker.marker.lifecycle_id,
            };
            return {
              kind: "done",
              state: { ...unavailable(), offline: "offline-read" },
              followUp: false,
            };
          }
          return { kind: "done", state: unavailable(), followUp: false };
        }

        if (response === null) {
          // Validated session absence (U7, OFF-OUT-8).
          if (request !== null) await completeServerSignOut(request, "server-confirmed", deps);
          if (stored || request !== null) await endLifecycleWithoutSession(ticket, deps);
          const after = pre.kind === "no-conflicting-state" ? null : await restrictionNow(ticket);
          return { kind: "done", state: anonymous(after), followUp: false };
        }

        if (request !== null) await completeServerSignOut(request, "not-confirmed", deps);
        if (restriction !== null) {
          return { kind: "done", state: anonymous(restriction), followUp: false };
        }
        return { kind: "done", ...(await applyIdentity(ticket, response.user)) };
      });
      if (op.kind !== "done") {
        return { kind: "done", state: anonymous("coordination-unavailable"), followUp: false };
      }
      return op.value;
    } finally {
      hold.release();
    }
  }

  async function signIn(email: string, password: string, again: boolean): Promise<SignInResult> {
    const result = await signInOnce(email, password, again);
    if (result.kind !== "signed-in" || result.state.offline !== "eligible") forget();
    return result;
  }

  async function signInOnce(
    email: string,
    password: string,
    again: boolean,
  ): Promise<SignInResult> {
    const hold = safety.acquireHold();
    if (hold === null) return { kind: "refused", reason: "updating", state: null };
    try {
      if (!(await locksUsable())) {
        return {
          kind: "refused",
          reason: "coordination-unavailable",
          state: anonymous("coordination-unavailable"),
        };
      }
      const op = await runAuthOperation(deps, async (ticket): Promise<SignInResult> => {
        const refuse = (reason: AuthRestriction): SignInResult => ({
          kind: "refused",
          reason,
          state: anonymous(reason),
        });
        const read = await readIntentUnderAuth(ticket, deps);
        if (read.status === "unavailable") return refuse("coordination-unavailable");
        let restriction = restrictionFrom(read.state.evidence);

        if (restriction === "sign-out-pending") {
          // OFF-OUT-6: only the explicit Sign in again may proceed, and only
          // after the previous session's server sign-out is confirmed.
          if (!again || read.status !== "pending") return refuse("sign-out-pending");
          const request = beginConfirmingRequest(read.observation);
          const completion = await completeServerSignOut(request, await sendSignOut(), deps);
          if (completion.kind !== "cleared" && completion.kind !== "already-resolved") {
            const after = await restrictionNow(ticket);
            return {
              kind: "refused",
              reason: "sign-out-not-confirmed",
              state: anonymous(after),
            };
          }
          await cleanupResidual(deps); // mandatory cleanup of the ended lifecycle (OFF-LIFE-9)
          restriction = await restrictionNow(ticket);
        }
        if (restriction !== null) return refuse(restriction);
        const lockNow = lockBeforeCredentials();
        if (lockNow !== null) return refuse(lockNow);

        try {
          await api.signIn(email, password);
        } catch (error) {
          return { kind: "failed", error };
        }
        // The identity comes only from the validated session response; nothing
        // is published as signed in before the security checks complete.
        let response: SessionResponse | null;
        try {
          response = await api.getSession();
        } catch {
          return { kind: "signed-in", state: unavailable(), followUp: false };
        }
        if (response === null)
          return { kind: "signed-in", state: anonymous(null), followUp: false };
        const applied = await applyIdentity(ticket, response.user);
        return { kind: "signed-in", ...applied };
      });
      if (op.kind !== "done") {
        return {
          kind: "refused",
          reason: "coordination-unavailable",
          state: anonymous("coordination-unavailable"),
        };
      }
      return op.value;
    } finally {
      hold.release();
    }
  }

  function startSignOut(): SignOutStart {
    if (locks !== true) return { kind: "refused", reason: "coordination-unavailable" }; // U2
    const hold = safety.acquireHold();
    if (hold === null) return { kind: "refused", reason: "updating" }; // DR-4: nothing initiated
    const begun = beginSignOut(deps); // OFF-OUT-1 steps 1–2 run synchronously here
    forget();
    const done = (async () => {
      try {
        const begin = await begun;
        // AC-32: what actually protects this sign-out durably (truthful disclosure).
        const protection: SignOutOutcome["protection"] = begin.durable.intent
          ? "intent"
          : begin.durable.safetyLock
            ? "safety-lock"
            : "memory-only";
        const cleanup: SignOutOutcome["cleanup"] =
          begin.coordination === "acquired" ? cleanupStatus(await cleanupAll(deps)) : "not-run";
        const token =
          begin.intent.status === "recorded" || begin.intent.status === "joined"
            ? begin.intent.token
            : null;
        const op = await runAuthOperation(deps, async (ticket) => {
          let server: SignOutOutcome["server"];
          let intent: SignOutOutcome["intent"];
          if (token !== null) {
            const plan = planQueuedSignOut(token, await readIntentUnderAuth(ticket, deps));
            if (plan.action === "send") {
              const request = beginConfirmingRequest(plan.observation);
              const outcome = await sendSignOut();
              const completion = await completeServerSignOut(request, outcome, deps);
              server = outcome === "server-confirmed" ? "confirmed" : "not-confirmed";
              intent = intentAfter(completion);
            } else if (plan.action === "resolved") {
              server = "confirmed-elsewhere";
              intent = "resolved";
            } else {
              server = "not-sent";
              intent = "unreadable";
            }
          } else {
            // Exceptional path: no durable intent (D22 escalated). The server
            // sign-out is still requested; there is nothing to clear.
            server = (await sendSignOut()) === "server-confirmed" ? "confirmed" : "not-confirmed";
            intent = "not-recorded";
          }
          return {
            outcome: { server, intent, cleanup, protection },
            state: anonymous(await restrictionNow(ticket)),
          };
        });
        if (op.kind === "done") return op.value;
        return {
          outcome: {
            server: "not-sent" as const,
            intent: token !== null ? ("pending" as const) : ("not-recorded" as const),
            cleanup,
            protection,
          },
          state: anonymous("coordination-unavailable"),
        };
      } finally {
        hold.release();
      }
    })();
    return { kind: "started", done };
  }

  async function finishSigningOut(): Promise<FinishResult> {
    const hold = safety.acquireHold();
    if (hold === null) return { kind: "refused", reason: "updating" };
    try {
      if (!(await locksUsable())) return { kind: "refused", reason: "coordination-unavailable" };
      const op = await runAuthOperation(deps, async (ticket): Promise<FinishResult> => {
        const read = await readIntentUnderAuth(ticket, deps);
        if (read.status === "unavailable") {
          return { kind: "refused", reason: "coordination-unavailable" };
        }
        let outcome: SignOutOutcome;
        if (read.status === "pending") {
          const request = beginConfirmingRequest(read.observation);
          const sent = await sendSignOut();
          const completion = await completeServerSignOut(request, sent, deps);
          const intent = intentAfter(completion);
          const cleanup =
            intent === "resolved" ? cleanupStatus(await cleanupResidual(deps)) : "not-run";
          outcome = {
            server: sent === "server-confirmed" ? "confirmed" : "not-confirmed",
            intent,
            cleanup,
          };
        } else if (restrictionFrom(read.state.evidence) !== null) {
          // D22 or unreadable state: the server sign-out is still requested; nothing is cleared.
          const sent = await sendSignOut();
          outcome = {
            server: sent === "server-confirmed" ? "confirmed" : "not-confirmed",
            intent: read.status === "unreadable" ? "unreadable" : "none",
            cleanup: "not-run",
          };
        } else {
          outcome = { server: "not-needed", intent: "none", cleanup: "not-run" };
        }
        return { kind: "done", outcome, state: anonymous(await restrictionNow(ticket)) };
      });
      return op.kind === "done"
        ? op.value
        : { kind: "refused", reason: "coordination-unavailable" };
    } finally {
      hold.release();
    }
  }

  // -------------------------------------------------------------------------
  // 3c-2 — storage status and recovery operations. Each recovery holds an
  // update-safety hold for its whole duration (DR-5), requires usable Web Locks,
  // never takes tnle-auth, and reuses the accepted foundation unchanged. None
  // clears D22, removes a sign-out intent, or implies a server sign-out; the
  // caller runs a coordinated session check afterwards, so offline eligibility
  // returns only through a verified identity (AC-40).
  // -------------------------------------------------------------------------

  async function inspectStorage(): Promise<StorageStatus> {
    if (!(await locksUsable())) return "unknown";
    // Non-creating first: a visitor with nothing stored gets no database.
    const pre = await inspectWithoutCreating(inspection);
    if (pre.kind === "no-conflicting-state") return "clean";
    const read = await readSecurityState(deps);
    return read.kind === "done" ? storageFrom(read.value.evidence) : "unknown";
  }

  /** Runs one recovery operation under a hold and with coordination, or refuses. */
  async function guarded<T>(
    run: () => Promise<T>,
  ): Promise<T | { kind: "refused"; reason: RecoveryRefusal }> {
    const hold = safety.acquireHold();
    if (hold === null) return { kind: "refused", reason: "updating" };
    try {
      if (!(await locksUsable())) return { kind: "refused", reason: "coordination-unavailable" };
      return await run();
    } finally {
      hold.release();
    }
  }

  function retryCleanup(): Promise<RetryCleanupResult> {
    return guarded(async (): Promise<RetryCleanupResult> => {
      const read = await readSecurityState(deps);
      if (read.kind !== "done") return { kind: "refused", reason: "coordination-unavailable" };
      // A lifecycle ended by a pending sign-out is cleaned by the ordinary full
      // cleanup; otherwise only residual records of invalidated lifecycles.
      const result =
        read.value.evidence.intent.kind === "pending"
          ? await cleanupAll(deps)
          : await cleanupResidual(deps);
      if (result.kind === "cleaned") return { kind: "cleaned" };
      if (result.kind === "failed") return { kind: "failed" };
      if (result.kind === "unavailable") {
        return { kind: "refused", reason: "coordination-unavailable" };
      }
      return result.reason === "none" || result.reason === "lifecycle"
        ? { kind: "nothing-to-clean" }
        : { kind: "not-possible" };
    });
  }

  function recoverStorage(authorizeDiscard: boolean): Promise<RecoverStorageResult> {
    return guarded(async (): Promise<RecoverStorageResult> => {
      forget(); // recovery blocks this tab and may remove the lifecycle
      const result = await recoverLocalFailure(deps, { authorizeDiscard });
      switch (result.kind) {
        case "recovered":
          return { kind: "recovered" };
        case "refused":
          return result.reason === "authorization-required"
            ? { kind: "authorization-required" }
            : { kind: "not-possible", reason: result.reason };
        case "local-resolved-record-retained":
          return { kind: "not-possible", reason: "safety-lock-at-removal" };
        case "failed":
          return { kind: "failed" };
        case "unavailable":
          return { kind: "refused", reason: "coordination-unavailable" };
      }
    });
  }

  function deleteAllData(
    onProgress?: (progress: DeletionProgress) => void,
  ): Promise<DeleteAllOutcome> {
    return guarded(async (): Promise<DeleteAllOutcome> => {
      forget(); // deletion blocks this tab and removes every saved copy
      const deleted = await deleteAllOfflineData(deps, { onProgress });
      if (deleted.deletion === "failed") return { kind: "failed" };
      if (deleted.deletion === "not-attempted") {
        return deleted.refusal === "coordination-unavailable"
          ? { kind: "refused", reason: "coordination-unavailable" }
          : { kind: "not-attempted" };
      }
      if (deleted.preserved.failure === "absent") return { kind: "deleted", failureRecord: "none" };
      // R2: the deletion alone authorizes nothing. The accepted recovery re-verifies
      // every condition (verified-empty data, no intent, D22 absent, readable state,
      // verified record removal) and runs WITHOUT discard authorization, so any new
      // saved data keeps the failure record.
      const recovered = await recoverLocalFailure(deps);
      if (recovered.kind === "recovered") return { kind: "deleted", failureRecord: "recovered" };
      return {
        kind: "deleted",
        failureRecord: "retained",
        retainedReason:
          recovered.kind === "refused"
            ? recovered.reason
            : recovered.kind === "local-resolved-record-retained"
              ? "safety-lock-at-removal"
              : "failed",
      };
    });
  }

  return {
    channel: options.channel,
    checkSession,
    signIn,
    startSignOut,
    finishSigningOut,
    blockLocally: () => {
      deps.generation.block();
      forget();
    },
    coordinationUsable: () => locks,
    inspectStorage,
    retryCleanup,
    recoverStorage,
    deleteAllData,
    snapshots,
    onSessionCheckRequired(listener) {
      sessionCheckListeners.add(listener);
      return () => sessionCheckListeners.delete(listener);
    },
  };
}

/** The application's production wiring (one instance per provider). */
export function createBrowserAccountSecurity(): AccountSecurity {
  const channel = createNoticeChannel();
  const safetyLock = createSafetyLock();
  return createAccountSecurity({
    deps: {
      coordinator: createLockCoordinator(),
      safetyLock,
      generation: createSecurityGeneration(),
      notices: channel,
      openData: () => openOfflineDataDatabase(),
      openState: () => openOfflineStateDatabase(),
      now: () => new Date().toISOString(),
      newLifecycleId: () => crypto.randomUUID(),
    },
    channel,
    inspection: {
      safetyLock,
      probeData: () => probeOfflineDataDatabase(),
      probeState: () => probeOfflineStateDatabase(),
    },
    api: {
      getSession: () => apiGetSession(),
      signIn: (email, password) => apiSignIn(email, password),
      signOut: () => apiSignOut(),
    },
    safety: updateSafety,
    probeLocks: () => probeWebLocks(),
    network: browserSnapshotNetwork,
    persist:
      typeof navigator !== "undefined" && typeof navigator.storage?.persist === "function"
        ? () => navigator.storage.persist()
        : undefined,
  });
}

// ---------------------------------------------------------------------------
// Interface text (3c-1a minimal explanations; the complete OFF-REC-2–4
// explanations, including site-data removal, are 3c-2)
// ---------------------------------------------------------------------------

const BROWSE = "You can still browse landmarks.";

/** Why signing in is unavailable here, for each blocking restriction. */
export const RESTRICTION_MESSAGES: Record<AuthRestriction, string> = {
  "coordination-unavailable": `Signing in isn't available in this browser because it can't coordinate sign-in safely between tabs. Use a current version of a supported browser. If you were signed in before, that sign-in may stay active on the server until it expires. ${BROWSE}`,
  "safety-lock": `Signing in isn't available in this browser right now because offline data protection is turned on after a storage problem. ${BROWSE}`,
  "safety-lock-unreadable": `Signing in isn't available in this browser right now because the status of its offline data protection can't be read. ${BROWSE}`,
  "sign-out-pending":
    "You're signed out on this device, but the server sign-out isn't confirmed, so your browser's earlier sign-in may still be valid.",
  "state-unreadable": `Signing in isn't available in this browser right now because its saved sign-out status can't be read. ${BROWSE}`,
};

export const REFUSAL_MESSAGES: Record<"updating" | "sign-out-not-confirmed", string> = {
  updating: "The app is updating. Try again when the update finishes.",
  "sign-out-not-confirmed":
    "The earlier sign-out couldn't be confirmed with the server, so your details weren't sent and you aren't signed in. Try again.",
};

/**
 * 3c-2 (OFF-REC-3): the only description of removing this site's data. It is
 * never presented as verified recovery, a confirmed server sign-out, or a
 * security bypass, and the application never performs it.
 */
export const SITE_DATA_MESSAGE =
  "Removing this site's data in your browser's settings is the only way to remove this protection. It is destructive: it deletes every saved offline copy in this browser for every account, this browser's offline security information, and its sign-in cookie. It does not sign you out on the server or confirm a sign-out, and it is not a verified recovery. Landmarks, favorites, trips, and reviews saved on the server are not affected.";

/** One unsupported or restricted state, explained (AC-41, OFF-REC-4). */
export interface Explanation {
  unavailable: string;
  reason: string;
  actions: string[];
  /** Whether site-data removal (OFF-REC-3) is the remaining remedy to mention. */
  siteData: boolean;
}

export type ExplainedState =
  | "safety-lock"
  | "safety-lock-unreadable"
  | "state-unreadable"
  | "storage-unreadable"
  | "coordination-unavailable"
  | "sign-out-pending";

export const EXPLANATIONS: Record<ExplainedState, Explanation> = {
  "safety-lock": {
    unavailable: "Signing in and offline copies in this browser.",
    reason:
      "Offline data protection was turned on because this browser couldn't save a security change. The app can't turn it off.",
    actions: ["Finish signing out (it doesn't turn the protection off).", "Browse landmarks."],
    siteData: true,
  },
  "safety-lock-unreadable": {
    unavailable: "Signing in and offline copies in this browser.",
    reason:
      "The app can't read whether offline data protection is turned on, so it treats it as on.",
    actions: ["Try again later.", "Finish signing out.", "Browse landmarks."],
    siteData: true,
  },
  "state-unreadable": {
    unavailable: "Signing in and offline copies in this browser.",
    reason: "This browser's saved sign-out status can't be read, so it can't be shown to be safe.",
    actions: ["Try again later.", "Finish signing out.", "Browse landmarks."],
    siteData: true,
  },
  "storage-unreadable": {
    unavailable: "Offline copies on this device.",
    reason: "The offline data stored in this browser can't be read reliably.",
    actions: ["Try again later.", "Delete all offline data on this device.", "Browse landmarks."],
    siteData: false,
  },
  "coordination-unavailable": {
    unavailable: "Signing in, signing out, and offline copies in this browser.",
    reason:
      "This browser can't coordinate these features safely between tabs. If you were signed in before, that sign-in may stay active on the server until it expires.",
    actions: ["Use a current version of a supported browser.", "Browse landmarks."],
    siteData: false,
  },
  "sign-out-pending": {
    unavailable: "Signed-in features and recovering offline storage.",
    reason:
      "You're signed out on this device, but the server sign-out isn't confirmed, so your browser's earlier sign-in may still be valid.",
    actions: ["Finish signing out.", "Sign in again.", "Browse landmarks."],
    siteData: false,
  },
};

/** The message for any refusal reason. */
export function refusalMessage(reason: RefusalReason): string {
  return reason === "updating" || reason === "sign-out-not-confirmed"
    ? REFUSAL_MESSAGES[reason]
    : RESTRICTION_MESSAGES[reason];
}

// ---------------------------------------------------------------------------
// React context (the AuthContextValue contract is unchanged; this adds to it)
// ---------------------------------------------------------------------------

export interface AccountSecurityContextValue {
  restriction: AuthRestriction | null;
  offline: OfflineEligibility;
  /** The latest sign-out or Finish signing out outcome in this tab, if any. */
  lastSignOut: SignOutOutcome | null;
  /** The latest locally refused sign-out, if any (cleared by the next attempt). */
  signOutRefusal: RefusalReason | null;
  /**
   * Sign-in through the coordinated operation. Resolves once the security
   * checks completed and the resulting state is published. Rejects with the
   * server's `ApiError`, or with `AuthRefusal` when refused locally.
   */
  signIn(email: string, password: string, options?: { again?: boolean }): Promise<void>;
  /** Resolves with the outcome; rejects only with `AuthRefusal` (nothing sent). */
  finishSigningOut(): Promise<SignOutOutcome>;
  /** 3c-2: the durable storage status from the latest authoritative inspection. */
  storage: StorageStatus;
  /** 3c-2 recovery actions; each re-inspects and re-checks the session afterwards. */
  retryCleanup(): Promise<RetryCleanupResult>;
  recoverStorage(authorizeDiscard: boolean): Promise<RecoverStorageResult>;
  deleteAllData(onProgress?: (progress: DeletionProgress) => void): Promise<DeleteAllOutcome>;
  /** 3e: snapshot operations and the authorized view store (render only from `snapshots.view`). */
  snapshots: SnapshotOperations;
}

export const AccountSecurityContext = createContext<AccountSecurityContextValue | null>(null);

const outsideProvider = () =>
  Promise.reject(new Error("useAccountSecurity is used outside <AuthProvider>"));

/**
 * Outside `AuthProvider` (components rendered with a mocked `AuthContext` in
 * tests) there is no coordinated operation: every operation rejects, and no
 * restriction or outcome is reported. The application always mounts the provider.
 */
const INERT: AccountSecurityContextValue = Object.freeze({
  restriction: null,
  offline: "none",
  lastSignOut: null,
  signOutRefusal: null,
  signIn: outsideProvider,
  finishSigningOut: outsideProvider,
  storage: "unknown",
  retryCleanup: outsideProvider,
  recoverStorage: outsideProvider,
  deleteAllData: outsideProvider,
  snapshots: createInertSnapshots(),
});

/** Outside the provider: no identity, so every snapshot operation is refused and nothing is published. */
export function createInertSnapshots(): SnapshotOperations {
  const refused = () =>
    Promise.resolve({ kind: "not-eligible" as const, reason: "no-identity" as const });
  const view = createSnapshotView();
  return {
    view,
    saveLandmark: refused,
    refreshLandmark: refused,
    removeLandmark: refused,
    getLandmark: refused,
    listLandmarks: refused,
    saveTrip: refused,
    refreshTrip: refused,
    removeTrip: refused,
    getTrip: refused,
    listTrips: refused,
    revalidateView: () => Promise.resolve(),
    clearView: () => view.clear(),
  };
}

/** The account-security context provided by `AuthProvider`. */
export function useAccountSecurity(): AccountSecurityContextValue {
  return useContext(AccountSecurityContext) ?? INERT;
}
