import {
  cleanupResidual,
  recordCleanupFailure,
  type CleanupResult,
  type FailureEscalation,
} from "./cleanup";
import { createLockScope, SECURITY_LOCK } from "./locks";
import {
  isUuid,
  OFFLINE_SCHEMA_VERSION,
  validateStoredMarker,
  type StoredAccountMarker,
} from "./records";
import {
  assertLiveTicket,
  inspectSecurityState,
  removeMarkerWithin,
  writeMarkerWithin,
  type AuthTicket,
  type SecurityClassification,
  type SecurityDeps,
} from "./securityState";
import { advise } from "./signOutIntent";

/**
 * Offline account lifecycle transitions (M06-T03 Increment 3b-ii;
 * Specification 6 v1.1 OFF-LIFE-1–9, OFF-OUT-4, OFF-FAIL-5; DR-2 Option B;
 * DR-3; Q18).
 *
 * `confirmIdentity` is the post-check for an authentication completion. It
 * requires a live `tnle-auth` ticket and takes `tnle-offline-security`
 * EXCLUSIVE (auth → security, the permitted nesting). Inside that callback it
 * re-reads every piece of durable security evidence, checks that the ticket's
 * generation snapshot is still current, and re-reads D22 immediately before
 * any marker write. A lifecycle is created only when nothing blocks it; an
 * existing matching lifecycle is reused (only `verified_at` changes); a
 * different verified account invalidates the previous lifecycle (marker
 * removed) and blocks replacement until cleanup (3b-iii).
 *
 * Account-switch invalidation failure (3b-iii-c1, Q29): if the previous
 * account's marker cannot be removed AND verified absent, a failed removal is
 * never treated as termination. This tab is blocked (generation), and durable
 * failure evidence is established in the same exclusive callback through the
 * shared `recordCleanupFailure` (join an existing record; preserve a malformed
 * one and escalate; otherwise D22). The protection actually achieved is
 * re-inspected and reported; a surviving valid marker is never counted as
 * protection. No server request and no authentication state change occur.
 *
 * The `accountId` is the isolated verified-identity input of this interface.
 * Obtaining it from a real server response is 3c; nothing here performs or
 * trusts a network request.
 *
 * `releaseLocalBlock` lifts this tab's generation block ONLY after a fresh
 * durable inspection, inside a shared security-lock callback, shows a
 * COMPLETELY CLEAN state (primary `none`: no marker, no residual records, no
 * intent, no failure record, D22 absent, everything readable) and the token is
 * still current (Q18; 3b-iii-a Q22). A valid lifecycle marker also refuses:
 * unblocking is never identity-bound. Unblocking establishes no identity,
 * creates no lifecycle, authorizes no offline access, publishes nothing, and
 * writes nothing. A blocked tab whose state shows an existing lifecycle needs a
 * different, identity-bound path (an integration design requirement), never a
 * weaker release.
 *
 * 3c-1a (approved decision U5): that identity-bound path is the
 * `releaseBlock: "identity-bound"` option of `confirmIdentity`, and
 * `endLifecycleWithoutSession` performs the OFF-OUT-8 invalidation after a
 * validated no-session response. Both are used by `auth/accountSecurity.ts`.
 */

export type RefusalReason =
  | Exclude<SecurityClassification, "none" | "lifecycle">
  | "stale"
  | "invalid-identity"
  | "coordination-unavailable"
  | "write-failed";

export type ConfirmIdentityResult =
  | { kind: "created"; lifecycleId: string }
  | { kind: "reused"; lifecycleId: string }
  /** The previous lifecycle was invalidated; no replacement until cleanup (3b-iii). */
  | { kind: "account-switch"; marker: "removed" | "absent"; replacement: "blocked" }
  /**
   * The previous account's marker could not be removed and verified absent
   * (3b-iii-c1, Q29). This tab is blocked; `escalation` reports the durable
   * evidence attempted and `protection` what a fresh inspection actually found.
   */
  | {
      kind: "account-switch";
      marker: "remove-failed";
      replacement: "blocked";
      blockToken: number;
      escalation: FailureEscalation;
      protection: AccountSwitchProtection;
    }
  | { kind: "refused"; reason: RefusalReason };

/**
 * Protection after a failed account-switch invalidation: `failure-record` or
 * `safety-lock` when that write was verified by read-back; `other-durable-evidence`
 * when a readable blocking state (intent, residual records) remains; `memory-only`
 * otherwise (including an unreadable observation or a surviving valid marker):
 * protection after a restart cannot be guaranteed.
 */
export type AccountSwitchProtection =
  "failure-record" | "safety-lock" | "other-durable-evidence" | "memory-only";

const refused = (reason: RefusalReason): ConfirmIdentityResult => ({ kind: "refused", reason });

function protectionAfter(
  escalation: FailureEscalation,
  observed: SecurityClassification,
): AccountSwitchProtection {
  // The escalation results are verified by read-back; the fresh observation is
  // used only for evidence this operation did not itself establish.
  if (escalation.failureRecord === "written" || escalation.failureRecord === "joined") {
    return "failure-record";
  }
  if (escalation.safetyLock?.durable === true) return "safety-lock";
  if (["safety-lock", "failure", "intent-pending", "residual"].includes(observed)) {
    return "other-durable-evidence";
  }
  return "memory-only";
}

/**
 * Options for `confirmIdentity` (M06-T03 Increment 3c-1a, approved decision U5).
 *
 * `releaseBlock: "identity-bound"` lets a tab that is blocked in memory lift
 * that block as part of confirming a VERIFIED identity. The caller asserts that
 * `accountId` comes from a validated server response obtained under the same
 * live ticket. The release happens only inside this function's exclusive
 * security-lock callback, after its fresh authoritative inspection, and only
 * when ALL of these hold:
 * - the tab is blocked;
 * - no block or advance happened since the ticket began (the ticket's
 *   generation is still current, so a stale result cannot release a newer block);
 * - D22 reads `absent`;
 * - the inspected primary state is `none`, or `lifecycle` with a valid marker.
 *
 * Any other state leaves the block in place, and the result is the existing
 * `stale` refusal. Successful authentication alone never releases anything,
 * and no durable evidence is changed by the release. Without the option the
 * behavior is unchanged (`releaseLocalBlock` remains the clean-state-only path).
 */
export interface ConfirmIdentityOptions {
  releaseBlock?: "identity-bound";
}

export async function confirmIdentity(
  ticket: AuthTicket,
  accountId: string,
  deps: SecurityDeps,
  options: ConfirmIdentityOptions = {},
): Promise<ConfirmIdentityResult> {
  assertLiveTicket(ticket);
  if (!isUuid(accountId)) return refused("invalid-identity");

  const result = await deps.coordinator.withLock(
    ticket.scope,
    SECURITY_LOCK,
    "exclusive",
    async ({ scope }): Promise<ConfirmIdentityResult> => {
      const state = await inspectSecurityState(scope, deps);
      if (
        options.releaseBlock === "identity-bound" &&
        deps.generation.isBlocked() &&
        state.evidence.safetyLock === "absent" &&
        (state.primary === "none" ||
          (state.primary === "lifecycle" && state.evidence.marker.kind === "valid"))
      ) {
        // Re-read D22 immediately before releasing (another tab may set it without any lock).
        if (deps.safetyLock.read() === "absent") {
          deps.generation.unblockFor(ticket.snapshot.generation);
        }
      }
      if (!deps.generation.isCurrent(ticket.snapshot)) return refused("stale");

      const marker = state.evidence.marker;
      if (marker.kind === "valid" && marker.marker.account_id !== accountId) {
        // Account switch (OFF-LIFE-4, OFF-LIFE-8): invalidate the previous lifecycle first.
        const removal = await removeMarkerWithin(scope, deps);
        if (removal === "remove-failed") {
          // Q29: never treated as termination. Block locally, then establish durable evidence.
          const blockToken = deps.generation.block();
          advise(deps, "lifecycle-ended");
          const escalation = await recordCleanupFailure(scope, deps);
          const after = await inspectSecurityState(scope, deps);
          return {
            kind: "account-switch",
            marker: "remove-failed",
            replacement: "blocked",
            blockToken,
            escalation,
            protection: protectionAfter(escalation, after.primary),
          };
        }
        deps.generation.advance();
        advise(deps, "lifecycle-ended");
        return { kind: "account-switch", marker: removal, replacement: "blocked" };
      }

      const decision = state.primary;
      if (decision === "none") {
        if (deps.safetyLock.read() !== "absent") return refused("safety-lock");
        const created: StoredAccountMarker = {
          key: "marker",
          schema_version: OFFLINE_SCHEMA_VERSION,
          account_id: accountId,
          lifecycle_id: deps.newLifecycleId(),
          verified_at: deps.now(),
        };
        if (!validateStoredMarker(created).ok) return refused("write-failed");
        if (!(await writeMarkerWithin(scope, deps, created))) return refused("write-failed");
        deps.notices.post("lifecycle-changed");
        return { kind: "created", lifecycleId: created.lifecycle_id };
      }
      if (decision === "lifecycle" && marker.kind === "valid") {
        if (deps.safetyLock.read() !== "absent") return refused("safety-lock");
        const reused: StoredAccountMarker = { ...marker.marker, verified_at: deps.now() };
        if (!validateStoredMarker(reused).ok) return refused("write-failed");
        if (!(await writeMarkerWithin(scope, deps, reused))) return refused("write-failed");
        return { kind: "reused", lifecycleId: reused.lifecycle_id };
      }
      return refused(decision === "lifecycle" ? "unreadable" : decision);
    },
  );
  return result.kind === "done" ? result.value : refused("coordination-unavailable");
}

/**
 * The result of `endLifecycleWithoutSession` (3c-1a, U5; OFF-OUT-8).
 * `marker` reports the invalidation; `cleanup` the ordinary residual cleanup
 * that follows it (`not-attempted` when invalidation did not succeed).
 */
export type EndLifecycleResult = {
  blockToken: number;
  marker:
    | "removed"
    | "absent"
    /** A malformed or unreadable marker: not removed (no authorization to discard it). */
    | "not-removed-unreadable"
    | { kind: "remove-failed"; escalation: FailureEscalation }
    | "coordination-unavailable";
  cleanup: CleanupResult | "not-attempted";
};

/**
 * Invalidates the current lifecycle after a coordinated session check
 * confirmed, through a validated server response under `ticket`, that no
 * server session exists (Specification 6 OFF-OUT-8, OFF-LIFE-4).
 *
 * 1. Synchronous local block and the advisory `lifecycle-ended` notice.
 * 2. Nested EXCLUSIVE security lock: fresh inspection; a VALID marker is
 *    removed and its absence verified. On failure, durable failure evidence is
 *    established through `recordCleanupFailure` (Q29 pattern). A malformed or
 *    unreadable marker is left in place (the library stays locked).
 * 3. After that lock is released, ordinary `cleanupResidual` removes the
 *    invalidated lifecycle's records (mandatory invalidation cleanup).
 *
 * It never records or clears a sign-out intent, never clears a failure record
 * or D22, sends nothing, and creates no server sign-out obligation.
 */
export async function endLifecycleWithoutSession(
  ticket: AuthTicket,
  deps: SecurityDeps,
): Promise<EndLifecycleResult> {
  assertLiveTicket(ticket);
  const blockToken = deps.generation.block();
  advise(deps, "lifecycle-ended");
  const locked = await deps.coordinator.withLock(
    ticket.scope,
    SECURITY_LOCK,
    "exclusive",
    async ({ scope }): Promise<EndLifecycleResult["marker"]> => {
      const state = await inspectSecurityState(scope, deps);
      const marker = state.evidence.marker;
      if (marker.kind === "absent") return "absent";
      if (marker.kind !== "valid") return "not-removed-unreadable";
      const removal = await removeMarkerWithin(scope, deps);
      if (removal !== "remove-failed") return removal;
      return { kind: "remove-failed", escalation: await recordCleanupFailure(scope, deps) };
    },
  );
  const marker = locked.kind === "done" ? locked.value : "coordination-unavailable";
  const cleanup =
    marker === "removed" || marker === "absent" ? await cleanupResidual(deps) : "not-attempted";
  return { blockToken, marker, cleanup };
}

export type ReleaseResult =
  | { kind: "released" }
  /** A fresh durable inspection found a state other than completely clean; the block stays. */
  | { kind: "blocked"; reason: RefusalReason | "lifecycle-present" }
  /** The token is not the current generation (a newer block exists). */
  | { kind: "stale-token" };

/** Lifts this tab's generation block only when a fresh check (shared security lock) finds a completely clean state. */
export async function releaseLocalBlock(token: number, deps: SecurityDeps): Promise<ReleaseResult> {
  const result = await deps.coordinator.withLock(
    createLockScope(),
    SECURITY_LOCK,
    "shared",
    async ({ scope }): Promise<ReleaseResult> => {
      const current = await inspectSecurityState(scope, deps);
      const permitted = current.primary === "none";
      if (!permitted) {
        return {
          kind: "blocked",
          reason:
            current.primary === "lifecycle"
              ? "lifecycle-present"
              : (current.primary as RefusalReason),
        };
      }
      return deps.generation.unblockFor(token) ? { kind: "released" } : { kind: "stale-token" };
    },
  );
  return result.kind === "done"
    ? result.value
    : { kind: "blocked", reason: "coordination-unavailable" };
}
