/**
 * Mutation and unsaved-input safety for application updates (M06-T02
 * Increments 4b-i and 4b-ii; Specification 6 §5 and OFF-SW-1: an update must
 * never discard an in-progress action). Tab-local and in memory only;
 * nothing is stored.
 *
 * Four things are tracked:
 * - **mutation requests** — every in-flight request whose method is not GET
 *   or HEAD, counted by the shared API client from before `fetch` until its
 *   response has been read and mapped (`beginMutationRequest`);
 * - **operation holds** — taken synchronously by multi-step workflows
 *   (`useTrip`, `useAddToTrip`) at their existing lock, so a workflow is
 *   protected across the gaps between its requests (`acquireHold`);
 * - **the transition gate** — acquired synchronously, in one step, only when
 *   no mutation request and no hold is active (`tryAcquireGate`). While it is
 *   held, new mutation requests and new holds are refused;
 * - **protected information** (4b-ii) — reload-sensitive information that a
 *   reload would discard: unsaved drafts, a captured reset token, a completed
 *   reset, a one-time share link, an unfinished trip add. Its owners register
 *   its PRESENCE only (`protect(category)`): a registration holds an opaque
 *   token and one fixed category — never a value, identifier, or hash. Every
 *   activation, deactivation, and edit of an active draft (`touch`) increments
 *   `protectedRevision`, so a confirmation shown for an earlier revision can
 *   be recognized as stale (4b-iii). It does not block the gate: 4b-iii asks
 *   the user to confirm instead.
 *
 * Every release is idempotent and belongs to exactly one acquisition: a stale
 * or repeated release can never release another request, hold, gate, or
 * registration. There is no queue, no retry, and no automatic activation of
 * anything when pending work finishes. Nothing in production acquires the
 * gate yet.
 */

/** The fixed kinds of reload-sensitive information (no values, ever). */
export type ProtectedCategory =
  | "review-draft"
  | "review-edit"
  | "trip-name"
  | "trip-rename"
  | "sign-in"
  | "registration"
  | "password-reset-request"
  | "new-password"
  | "reset-link"
  | "password-reset-complete"
  | "share-link"
  | "unfinished-trip-add";

export interface SafetySnapshot {
  /** In-flight non-GET/HEAD requests. */
  readonly pendingRequests: number;
  /** Active operation holds. */
  readonly operationHolds: number;
  /** Whether a transition currently owns the gate. */
  readonly gateHeld: boolean;
  /** One entry per active protection registration, in registration order. */
  readonly protectedCategories: readonly ProtectedCategory[];
  /** Incremented on every protection activation, deactivation, or edit. */
  readonly protectedRevision: number;
}

export interface OperationHold {
  /** Ends this hold; harmless when repeated. */
  release(): void;
}

export interface TransitionGate {
  /** Releases this gate, if it still owns it; harmless when repeated or stale. */
  release(): void;
}

/** One owner's registration of protected information. */
export interface Protection {
  /** Records an edit of the protected information (a new revision); no-op once released. */
  touch(): void;
  /** Ends this registration; harmless when repeated, and never affects another registration. */
  release(): void;
}

export type GateResult =
  | { kind: "acquired"; gate: TransitionGate }
  | { kind: "busy" } // a mutation request or an operation hold is active
  | { kind: "in-transition" }; // another transition already owns the gate

export interface UpdateSafety {
  /** Counts a mutation request, or returns null (nothing counted) while the gate is held. */
  beginMutationRequest(): (() => void) | null;
  /** Takes an operation hold, or returns null (nothing taken) while the gate is held. */
  acquireHold(): OperationHold | null;
  /** Checks for pending work and acquires the gate in one synchronous step. */
  tryAcquireGate(): GateResult;
  /** Registers the presence of protected information of `category`. */
  protect(category: ProtectedCategory): Protection;
  getSnapshot(): SafetySnapshot;
  /** Calls `listener` after every snapshot change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Methods counted as mutations: anything other than GET and HEAD (case-insensitive). */
export function isMutationMethod(method: string | undefined): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD";
}

const IDLE: SafetySnapshot = {
  pendingRequests: 0,
  operationHolds: 0,
  gateHeld: false,
  protectedCategories: [],
  protectedRevision: 0,
};

export function createUpdateSafety(): UpdateSafety {
  const requests = new Set<object>();
  const holds = new Set<object>();
  /** Opaque token → its fixed category. Nothing else is recorded. */
  const registrations = new Map<object, ProtectedCategory>();
  let revision = 0;
  let categories: readonly ProtectedCategory[] = IDLE.protectedCategories;
  let gate: object | null = null;
  let snapshot = IDLE;
  const listeners = new Set<() => void>();

  function publish() {
    const next: SafetySnapshot = {
      pendingRequests: requests.size,
      operationHolds: holds.size,
      gateHeld: gate !== null,
      protectedCategories: categories,
      protectedRevision: revision,
    };
    if (
      next.pendingRequests === snapshot.pendingRequests &&
      next.operationHolds === snapshot.operationHolds &&
      next.gateHeld === snapshot.gateHeld &&
      next.protectedCategories === snapshot.protectedCategories &&
      next.protectedRevision === snapshot.protectedRevision
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function registrationsChanged() {
    revision += 1;
    categories = [...registrations.values()];
    publish();
  }

  return {
    beginMutationRequest() {
      if (gate !== null) return null;
      const token = {};
      requests.add(token);
      publish();
      return () => {
        if (requests.delete(token)) publish();
      };
    },
    acquireHold() {
      if (gate !== null) return null;
      const token = {};
      holds.add(token);
      publish();
      return {
        release() {
          if (holds.delete(token)) publish();
        },
      };
    },
    tryAcquireGate() {
      if (gate !== null) return { kind: "in-transition" };
      if (requests.size > 0 || holds.size > 0) return { kind: "busy" };
      const token = {};
      gate = token;
      publish();
      return {
        kind: "acquired",
        gate: {
          release() {
            if (gate !== token) return;
            gate = null;
            publish();
          },
        },
      };
    },
    protect(category) {
      const token = {};
      registrations.set(token, category);
      registrationsChanged();
      return {
        touch() {
          if (!registrations.has(token)) return;
          revision += 1;
          publish();
        },
        release() {
          if (registrations.delete(token)) registrationsChanged();
        },
      };
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The application's single instance (tab-local). */
export const updateSafety = createUpdateSafety();
