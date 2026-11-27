import type { DBSchema, IDBPDatabase } from "idb";
import type { OfflineDataSchema, OfflineStateSchema, OpenResult, ProbeResult } from "./db";
import {
  AUTH_LOCK,
  createLockScope,
  SECURITY_LOCK,
  type LockCoordinator,
  type LockResult,
  type LockScope,
  type WithLockOptions,
} from "./locks";
import type { NoticeChannel } from "./notices";
import {
  validateStoredFailureRecord,
  validateStoredMarker,
  validateStoredSequence,
  validateStoredSignOutIntent,
  type StoredAccountMarker,
  type StoredFailureRecord,
} from "./records";
import type { SafetyLock, SafetyLockReading } from "./safetyLock";
import type { GenerationSnapshot, SecurityGeneration } from "./securityGeneration";

/**
 * Offline security-state inspection and authentication-operation ownership
 * (M06-T03 Increment 3b-ii; Specification 6 v1.1 OFF-LIFE-2–9, OFF-OUT-1–8,
 * OFF-FAIL-1–5; approved DR-2 Option B).
 *
 * - `inspectSecurityState` gathers ALL durable security evidence (D22, sign-out
 *   intent, failure record, marker, residual records) and classifies it. The
 *   primary classification follows a fixed priority, but the full evidence is
 *   always returned: a higher-priority condition is never hidden by a lower one
 *   and nothing here removes evidence. Malformed records and storage errors are
 *   `unreadable`, never "absent".
 * - It must run inside a `tnle-offline-security` callback (checked through the
 *   operation scope). The two databases are read in two separate read-only
 *   transactions; cross-database atomicity is NOT claimed — consistency relies
 *   on every security write happening under the exclusive security lock.
 * - 3b-iii-b: `metadata` (an unrecognized meta key, or an invalid sequence
 *   beside a valid marker, is `unreadable`) and the in-memory `dataEmpty`.
 * - 3b-iii-c2: the in-memory `savedCopies` (counted, never validated; unknown
 *   when uncounted).
 * - In 3b-ii the injected openers are the 3a `open*` functions, which create a
 *   v1 database when none exists. Non-creating inspection is a DR-1 obligation
 *   for 3c.
 * - `runAuthOperation` holds `tnle-auth` (exclusive) and issues an `AuthTicket`
 *   that is live only while that lock is held. Ownership is proven by ticket
 *   identity in a private registry, never by a caller-supplied flag.
 *
 * Nothing runs on import; nothing here is connected to the application.
 */

export interface SecurityDeps {
  coordinator: LockCoordinator;
  safetyLock: SafetyLock;
  generation: SecurityGeneration;
  /** Advisory only (OFF-LIFE-7); delivery is never relied upon. */
  notices: Pick<NoticeChannel, "post">;
  openData: () => Promise<OpenResult<OfflineDataSchema>>;
  openState: () => Promise<OpenResult<OfflineStateSchema>>;
  /** ISO 8601 UTC timestamp (`Date#toISOString`). */
  now: () => string;
  /** A new random lifecycle identifier (`crypto.randomUUID()`). */
  newLifecycleId: () => string;
}

export type IntentEvidence =
  | { kind: "absent" }
  | { kind: "pending"; token: string }
  | { kind: "invalid" }
  | { kind: "unreadable" };

export type FailureEvidence =
  | { kind: "absent" }
  | { kind: "present"; failure: StoredFailureRecord["kind"] }
  | { kind: "invalid" }
  | { kind: "unreadable" };

export type MarkerEvidence =
  | { kind: "absent" }
  | { kind: "valid"; marker: StoredAccountMarker }
  | { kind: "invalid" }
  | { kind: "unreadable" };

export type ResidualEvidence = "none" | "present" | "unreadable";

/**
 * Lifecycle metadata in `meta` other than the marker (3b-iii-b). `invalid`:
 * an unrecognized `meta` key (never assumed disposable), or an invalid
 * `sequence` while a valid marker exists (its ownership cannot be established).
 */
export type MetadataEvidence = "valid" | "invalid" | "unreadable";

export interface SecurityEvidence {
  safetyLock: SafetyLockReading;
  intent: IntentEvidence;
  failure: FailureEvidence;
  marker: MarkerEvidence;
  residual: ResidualEvidence;
  metadata: MetadataEvidence;
  /**
   * In memory only (3b-iii-b): true only when the data database was read
   * successfully and holds no record in any of its five stores. A storage
   * error is never "empty".
   */
  dataEmpty: boolean;
  /**
   * In memory only (3b-iii-c2): whether the data database holds any saved
   * copy — any record in `landmarks` or `trips`, counted WITHOUT validation
   * (valid snapshots, unavailable markers, malformed records, any owner or
   * lifecycle, including terminated ones). `unknown` when the stores could not
   * be counted reliably; it is never reported as `none` and must fail closed.
   */
  savedCopies: SavedCopiesEvidence;
}

export type SavedCopiesEvidence = "none" | "present" | "unknown";

/** Priority order: the first matching condition is the primary classification. */
export type SecurityClassification =
  "unreadable" | "safety-lock" | "failure" | "intent-pending" | "residual" | "lifecycle" | "none";

export interface SecurityState {
  primary: SecurityClassification;
  evidence: SecurityEvidence;
}

export type OwnershipReason = "requires-auth" | "requires-security-lock" | "handle-invalid";

/** A programming error: an operation was invoked without the ownership it requires. */
export class OwnershipError extends Error {
  constructor(readonly reason: OwnershipReason) {
    super(`Offline security ownership violation: ${reason}`);
    this.name = "OwnershipError";
  }
}

export function classifySecurityState(evidence: SecurityEvidence): SecurityClassification {
  const records = [evidence.intent, evidence.failure, evidence.marker];
  if (
    evidence.safetyLock === "unreadable" ||
    evidence.residual === "unreadable" ||
    evidence.metadata !== "valid" ||
    records.some((record) => record.kind === "invalid" || record.kind === "unreadable")
  ) {
    return "unreadable";
  }
  if (evidence.safetyLock === "present") return "safety-lock";
  if (evidence.failure.kind === "present") return "failure";
  if (evidence.intent.kind === "pending") return "intent-pending";
  if (evidence.residual === "present") return "residual";
  if (evidence.marker.kind === "valid") return "lifecycle";
  return "none";
}

/** Throws unless `scope` currently holds `tnle-offline-security`. */
export function assertSecurityLockHeld(scope: LockScope): void {
  if (!scope.held.has(SECURITY_LOCK)) throw new OwnershipError("requires-security-lock");
}

async function openSafely<S extends DBSchema>(
  open: () => Promise<OpenResult<S>>,
): Promise<IDBPDatabase<S> | null> {
  try {
    const result = await open();
    return result.kind === "open" ? result.db : null;
  } catch {
    return null;
  }
}

function intentEvidence(raw: unknown): IntentEvidence {
  if (raw === undefined) return { kind: "absent" };
  const checked = validateStoredSignOutIntent(raw);
  return checked.ok ? { kind: "pending", token: checked.record.created_at } : { kind: "invalid" };
}

function failureEvidence(raw: unknown): FailureEvidence {
  if (raw === undefined) return { kind: "absent" };
  const checked = validateStoredFailureRecord(raw);
  return checked.ok ? { kind: "present", failure: checked.record.kind } : { kind: "invalid" };
}

function markerEvidence(raw: unknown): MarkerEvidence {
  if (raw === undefined) return { kind: "absent" };
  const checked = validateStoredMarker(raw);
  return checked.ok ? { kind: "valid", marker: checked.record } : { kind: "invalid" };
}

async function readStateDatabase(
  deps: Pick<SecurityDeps, "openState">,
): Promise<Pick<SecurityEvidence, "intent" | "failure">> {
  // Reads the state database only; never writes.
  const unreadable = { intent: { kind: "unreadable" }, failure: { kind: "unreadable" } } as const;
  const db = await openSafely(deps.openState);
  if (db === null) return unreadable;
  try {
    const tx = db.transaction("state", "readonly");
    const intent: unknown = await tx.store.get("signout_intent");
    const failure: unknown = await tx.store.get("failure");
    await tx.done;
    return { intent: intentEvidence(intent), failure: failureEvidence(failure) };
  } catch {
    return unreadable;
  } finally {
    db.close();
  }
}

const SCOPED_STORES = ["landmarks", "trips", "invalidations", "deletions"] as const;

/** True when a data-store primary key belongs to `owner` ([account_id, lifecycle_id] prefix). */
export function isOwnedKey(key: unknown, owner: readonly [string, string] | null): boolean {
  return owner !== null && Array.isArray(key) && key[0] === owner[0] && key[1] === owner[1];
}

async function readDataDatabase(
  deps: Pick<SecurityDeps, "openData">,
): Promise<
  Pick<SecurityEvidence, "marker" | "residual" | "metadata" | "dataEmpty" | "savedCopies">
> {
  const unreadable = {
    marker: { kind: "unreadable" },
    residual: "unreadable",
    metadata: "unreadable",
    dataEmpty: false,
    savedCopies: "unknown",
  } as const;
  const db = await openSafely(deps.openData);
  if (db === null) return unreadable;
  try {
    const tx = db.transaction(["meta", ...SCOPED_STORES], "readonly");
    const meta = tx.objectStore("meta");
    const marker = markerEvidence(await meta.get("marker"));
    const owner: [string, string] | null =
      marker.kind === "valid" ? [marker.marker.account_id, marker.marker.lifecycle_id] : null;
    let residual = false;
    let metadata: MetadataEvidence = "valid";
    const metaKeys = await meta.getAllKeys();
    for (const key of metaKeys) {
      if (key === "marker") continue;
      if (key !== "sequence") {
        metadata = "invalid"; // unrecognized: never assumed disposable
        continue;
      }
      const sequence = validateStoredSequence(await meta.get("sequence"));
      if (!sequence.ok) {
        if (owner !== null)
          metadata = "invalid"; // the current lifecycle's ordering metadata is unreadable
        else residual = true;
      } else if (
        owner === null ||
        sequence.record.account_id !== owner[0] ||
        sequence.record.lifecycle_id !== owner[1]
      ) {
        residual = true;
      }
    }
    let records = metaKeys.length;
    let saved = 0;
    for (const name of SCOPED_STORES) {
      const store = tx.objectStore(name);
      const total = await store.count();
      records += total;
      if (name === "landmarks" || name === "trips") saved += total;
      const owned = owner === null ? 0 : await store.index("by_lifecycle").count(owner);
      if (total > owned) residual = true;
    }
    await tx.done;
    return {
      marker,
      residual: residual ? "present" : "none",
      metadata,
      dataEmpty: records === 0,
      savedCopies: saved > 0 ? "present" : "none",
    };
  } catch {
    return unreadable;
  } finally {
    db.close();
  }
}

/**
 * Reads and classifies every piece of durable security evidence. Call only
 * inside a `tnle-offline-security` callback, passing that callback's scope.
 */
export async function inspectSecurityState(
  scope: LockScope,
  deps: SecurityDeps,
): Promise<SecurityState> {
  assertSecurityLockHeld(scope);
  const safetyLock = deps.safetyLock.read();
  const state = await readStateDatabase(deps);
  const data = await readDataDatabase(deps);
  const evidence: SecurityEvidence = { safetyLock, ...state, ...data };
  return { primary: classifySecurityState(evidence), evidence };
}

/**
 * Reads only D22 and the state database (intent and failure record). Call only
 * inside a `tnle-offline-security` callback. Used where the data database must
 * not be opened (Delete all).
 */
export async function inspectStateEvidence(
  scope: LockScope,
  deps: SecurityDeps,
): Promise<Pick<SecurityEvidence, "safetyLock" | "intent" | "failure">> {
  assertSecurityLockHeld(scope);
  const safetyLock = deps.safetyLock.read();
  return { safetyLock, ...(await readStateDatabase(deps)) };
}

// ---------------------------------------------------------------------------
// 3b-iii-d (DR-1) — non-creating, lock-free inspection
// ---------------------------------------------------------------------------

export type NonCreatingConflict =
  | "safety-lock"
  | "sign-out-intent"
  | "failure-record"
  | "account-marker"
  | "saved-or-residual-records"
  | "lifecycle-metadata"
  | "unrecognized-state";

type NotInspected =
  | "unavailable"
  | "failed"
  | "unsupported-version"
  | "unexpected-schema"
  | "indeterminate"
  | "unreadable";

export type NotEstablishedReason =
  "safety-lock-unreadable" | `data-${NotInspected}` | `state-${NotInspected}`;

/** Classifications only: no token, identifier, record content, or malformed value. */
export interface NonCreatingInspection {
  kind: "no-conflicting-state" | "conflicting-state" | "not-established";
  conflicts: NonCreatingConflict[];
  notEstablished: NotEstablishedReason[];
}

export interface NonCreatingInspectionDeps {
  safetyLock: Pick<SafetyLock, "read">;
  probeData: () => Promise<ProbeResult<OfflineDataSchema>>;
  probeState: () => Promise<ProbeResult<OfflineStateSchema>>;
}

const RECOGNIZED_STATE_KEYS: readonly unknown[] = ["signout_intent", "failure"];

async function probeSafely<S extends DBSchema>(
  probe: () => Promise<ProbeResult<S>>,
): Promise<ProbeResult<S>> {
  try {
    return await probe();
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Inspects D22 and both offline databases WITHOUT creating, upgrading,
 * deleting, or modifying anything, and without Web Locks (DR-1). Existing
 * databases are read with the same readers as `inspectSecurityState`.
 *
 * `no-conflicting-state` requires D22 absent and, for each database, either a
 * confirmed absence or a successful read showing no intent, no failure record,
 * no marker, no record of any lifecycle, valid metadata, and no unrecognized
 * state key (valid or malformed records all count). Otherwise the result is
 * `conflicting-state` or `not-established`, both of which fail closed.
 *
 * The result is a point-in-time observation (Q54). It does NOT establish the
 * OFF-OUT-7 execution-environment condition and authorizes nothing:
 * not authentication, not offline access, not lifecycle creation.
 */
export async function inspectWithoutCreating(
  deps: NonCreatingInspectionDeps,
): Promise<NonCreatingInspection> {
  const conflicts: NonCreatingConflict[] = [];
  const notEstablished: NotEstablishedReason[] = [];

  const safetyLock = deps.safetyLock.read();
  if (safetyLock === "present") conflicts.push("safety-lock");
  else if (safetyLock !== "absent") notEstablished.push("safety-lock-unreadable");

  const state = await probeSafely(deps.probeState);
  if (state.kind === "open") {
    let unrecognized: boolean | null;
    try {
      const tx = state.db.transaction("state", "readonly");
      const keys = await tx.store.getAllKeys();
      await tx.done;
      unrecognized = keys.some((key) => !RECOGNIZED_STATE_KEYS.includes(key));
    } catch {
      unrecognized = null;
    }
    // The reader closes the probe connection.
    const read = await readStateDatabase({ openState: async () => state });
    if (unrecognized === null || read.intent.kind === "unreadable") {
      notEstablished.push("state-unreadable");
    } else {
      if (unrecognized) conflicts.push("unrecognized-state");
      if (read.intent.kind !== "absent") conflicts.push("sign-out-intent");
      if (read.failure.kind !== "absent") conflicts.push("failure-record");
    }
  } else if (state.kind !== "absent") {
    notEstablished.push(`state-${state.kind}`);
  }

  const data = await probeSafely(deps.probeData);
  if (data.kind === "open") {
    // The reader closes the probe connection.
    const read = await readDataDatabase({ openData: async () => data });
    if (read.marker.kind === "unreadable") {
      notEstablished.push("data-unreadable");
    } else {
      if (read.marker.kind !== "absent") conflicts.push("account-marker");
      if (read.metadata !== "valid") conflicts.push("lifecycle-metadata");
      const recordsBesideMarker =
        read.marker.kind === "absent"
          ? !read.dataEmpty
          : read.savedCopies !== "none" || read.residual !== "none";
      if (recordsBesideMarker) conflicts.push("saved-or-residual-records");
    }
  } else if (data.kind !== "absent") {
    notEstablished.push(`data-${data.kind}`);
  }

  const kind =
    conflicts.length > 0
      ? "conflicting-state"
      : notEstablished.length > 0
        ? "not-established"
        : "no-conflicting-state";
  return { kind, conflicts, notEstablished };
}

// ---------------------------------------------------------------------------
// Authentication-operation ownership
// ---------------------------------------------------------------------------

/** Proof of a live `tnle-auth` hold, issued only by `runAuthOperation`. */
export interface AuthTicket {
  readonly scope: LockScope;
  /** This tab's security generation when the authentication operation began. */
  readonly snapshot: GenerationSnapshot;
}

const liveTickets = new WeakSet<AuthTicket>();

/** Throws unless `ticket` was issued by `runAuthOperation` and its `tnle-auth` hold is still live. */
export function assertLiveTicket(ticket: AuthTicket): void {
  if (!liveTickets.has(ticket) || !ticket.scope.held.has(AUTH_LOCK)) {
    throw new OwnershipError("requires-auth");
  }
}

/**
 * Runs one authentication operation under exclusive `tnle-auth`. The ticket
 * is revoked when the callback settles, before the browser releases the lock.
 */
export function runAuthOperation<T>(
  deps: Pick<SecurityDeps, "coordinator" | "generation">,
  callback: (ticket: AuthTicket) => T | Promise<T>,
  options?: WithLockOptions,
): Promise<LockResult<Awaited<T>>> {
  return deps.coordinator.withLock(
    createLockScope(),
    AUTH_LOCK,
    "exclusive",
    async ({ scope }) => {
      const ticket: AuthTicket = Object.freeze({ scope, snapshot: deps.generation.snapshot() });
      liveTickets.add(ticket);
      try {
        return await callback(ticket);
      } finally {
        liveTickets.delete(ticket);
      }
    },
    options,
  );
}

/**
 * Reads the classified security state under a SHARED security lock — nested
 * under the ticket's `tnle-auth` when a ticket is given (auth → security).
 */
export async function readSecurityState(
  deps: SecurityDeps,
  ticket?: AuthTicket,
): Promise<LockResult<SecurityState>> {
  let scope = createLockScope();
  if (ticket !== undefined) {
    assertLiveTicket(ticket);
    scope = ticket.scope;
  }
  return deps.coordinator.withLock(scope, SECURITY_LOCK, "shared", ({ scope: held }) =>
    inspectSecurityState(held, deps),
  );
}

// ---------------------------------------------------------------------------
// Marker writes (exclusive security lock held by the caller)
// ---------------------------------------------------------------------------

export type MarkerRemoval = "removed" | "absent" | "remove-failed";

/** Removes the account marker and verifies the removal by a separate read. */
export async function removeMarkerWithin(
  scope: LockScope,
  deps: SecurityDeps,
): Promise<MarkerRemoval> {
  assertSecurityLockHeld(scope);
  const db = await openSafely(deps.openData);
  if (db === null) return "remove-failed";
  try {
    const tx = db.transaction("meta", "readwrite");
    const existing: unknown = await tx.store.get("marker");
    if (existing !== undefined) await tx.store.delete("marker");
    await tx.done;
    const after: unknown = await db.get("meta", "marker");
    if (after !== undefined) return "remove-failed";
    return existing === undefined ? "absent" : "removed";
  } catch {
    return "remove-failed";
  } finally {
    db.close();
  }
}

/** Writes a validated marker and verifies it by a separate read. */
export async function writeMarkerWithin(
  scope: LockScope,
  deps: SecurityDeps,
  marker: StoredAccountMarker,
): Promise<boolean> {
  assertSecurityLockHeld(scope);
  const db = await openSafely(deps.openData);
  if (db === null) return false;
  try {
    const tx = db.transaction("meta", "readwrite");
    await tx.store.put(marker);
    await tx.done;
    const stored = validateStoredMarker(await db.get("meta", "marker"));
    return (
      stored.ok &&
      stored.record.account_id === marker.account_id &&
      stored.record.lifecycle_id === marker.lifecycle_id &&
      stored.record.verified_at === marker.verified_at
    );
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** The data database opener, for modules writing data-store records under the security lock. */
export function openDataDatabase(
  deps: SecurityDeps,
): Promise<IDBPDatabase<OfflineDataSchema> | null> {
  return openSafely(deps.openData);
}

/** The state database opener, for modules writing the intent record. */
export function openStateDatabase(
  deps: SecurityDeps,
): Promise<IDBPDatabase<OfflineStateSchema> | null> {
  return openSafely(deps.openState);
}
