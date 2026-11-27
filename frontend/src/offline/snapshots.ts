import type { IDBPDatabase, IDBPTransaction } from "idb";
import { parseOwnerTripResponse } from "../api/tripValidation";
import type { UpdateSafety } from "../pwa/updateSafety";
import { recordCleanupFailure } from "./cleanup";
import type { OfflineDataSchema } from "./db";
import { createLockScope, SECURITY_LOCK } from "./locks";
import {
  projectAvailableLandmark,
  projectAvailableTrip,
  projectUnavailableLandmark,
  projectUnavailableTrip,
} from "./projection";
import {
  isUuid,
  LANDMARK_SNAPSHOT_LIMIT,
  OFFLINE_SCHEMA_VERSION,
  TRIP_SNAPSHOT_LIMIT,
  validateStoredDeletion,
  validateStoredInvalidation,
  validateStoredLandmark,
  validateStoredMarker,
  validateStoredSequence,
  validateStoredTrip,
  type StoredAvailableTrip,
  type StoredDeletion,
  type StoredInvalidation,
  type StoredLandmark,
  type StoredSequence,
  type StoredStop,
  type StoredTrip,
} from "./records";
import type { GenerationSnapshot } from "./securityGeneration";
import { inspectSecurityState, openDataDatabase, type SecurityDeps } from "./securityState";
import { advise } from "./signOutIntent";
import type { SnapshotNetwork } from "./snapshotNetwork";

/**
 * Landmark and trip snapshot operations (M06-T03 Increment 3d; Specification 6
 * v1.1 OFF-EV-1–9, OFF-SNAP-1–9, OFF-STORE-1–7, OFF-LIFE-6, OFF-FAIL-1–2,
 * OFF-CONC-2; ADR-007; DR-3, DR-5, DR-7; approved decision S1).
 *
 * Every operation is explicit (no startup, reload, or reconnect activity).
 * Records are built only by the accepted projections and validated on write
 * and on read; no raw response is persisted.
 *
 * Gates. An operation starts only for the tab's VERIFIED lifecycle (supplied
 * by AccountSecurity), with an update-safety hold (DR-5), and after a fresh
 * authoritative inspection under the SHARED security lock: the stored marker
 * is that lifecycle, nothing else is pending (no intent, failure record,
 * residual records, unreadable state), D22 is absent, and the tab is not
 * blocked. Every commit runs in ONE readwrite transaction over the five data
 * stores, under the shared lock, re-reads the marker INSIDE that transaction,
 * and re-checks D22 and the tab generation immediately before it.
 *
 * DR-7 ordering (S1: commit-based). `meta.sequence` is incremented by every
 * authoritative-unavailability commit and every user removal; invalidation and
 * deletion records carry that sequence; each snapshot carries a revision. An
 * operation records `start_seq` and the base revision when it starts:
 * - an available response writes a landmark's protected fields only if no
 *   invalidation of that landmark was committed after the start, and only if
 *   the item's revision is unchanged (first commit wins);
 * - authoritative unavailability is always applied (no revision requirement),
 *   atomically to the landmark snapshot and every saved trip containing it —
 *   but a removed copy is never recreated merely to record it;
 * - nothing is written for an item the user removed after the start;
 * - when order cannot be established, unavailability wins (refresh again).
 *
 * DR-3. Results are published to the tab-local view SYNCHRONOUSLY inside the
 * shared-lock callback, after the transaction has completed and after a final
 * generation check, so no exclusive security transition can run between the
 * check and the publication. Rendering is 3e.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotIdentity {
  accountId: string;
  lifecycleId: string;
}

export type Protection = "deleted" | "failure-record" | "safety-lock" | "memory-only";
export type Persistence = "granted" | "denied" | "unsupported" | "failed";

export type SnapshotResult =
  | { kind: "saved"; persistence?: Persistence }
  | { kind: "refreshed" }
  /** An unavailable marker was replaced by an eligible refresh (OFF-EV-8). */
  | { kind: "restored" }
  /** A duplicate save: nothing changed (OFF-STORE-3). */
  | { kind: "already-saved" }
  /** Authoritative unavailability was recorded (marker and/or invalidation). */
  | { kind: "unavailable"; marker: boolean }
  /** An available response arrived after this item's invalidation was committed (S1). */
  | { kind: "superseded" }
  | { kind: "deleted-meanwhile" }
  | { kind: "changed-meanwhile" }
  | { kind: "not-saved" }
  | { kind: "limit-reached"; limit: number }
  /** Transient or invalid response: the snapshot is unchanged and stale (OFF-EV-4). */
  | { kind: "stale"; reason: "transient" | "invalid" }
  /** 401: nothing stored; the coordinated session check is started (AC-37). */
  | { kind: "session-check-required" }
  | { kind: "not-eligible"; reason: "no-identity" | "lifecycle-ended" | "protected" }
  | { kind: "unreadable" }
  | { kind: "updating" }
  | { kind: "coordination-unavailable" }
  | { kind: "quota" }
  | { kind: "storage-unavailable" }
  | { kind: "storage-failed" }
  /** Authoritative evidence could not be recorded durably as intended (OFF-FAIL-1/2). */
  | { kind: "invalidation-not-durable"; protection: Protection };

export type RemoveResult =
  | { kind: "removed" }
  | { kind: "not-found" }
  | Extract<
      SnapshotResult,
      {
        kind:
          | "not-eligible"
          | "updating"
          | "coordination-unavailable"
          | "quota"
          | "storage-unavailable"
          | "storage-failed";
      }
    >;

export type LandmarkEntry =
  | { status: "ok"; record: StoredLandmark; lastSyncedAt: string | null }
  | { status: "unreadable"; id: string };
export type TripEntry =
  | { status: "ok"; record: StoredTrip; lastSyncedAt: string | null }
  | { status: "unreadable"; id: string };

export type ListResult<E> =
  | { kind: "ok"; entries: E[] }
  | Extract<
      SnapshotResult,
      {
        kind:
          "not-eligible" | "coordination-unavailable" | "storage-unavailable" | "storage-failed";
      }
    >;

export type GetResult<E> = { kind: "ok"; entry: E | null } | ListResult<E>;

/** OFF-SNAP-7: `last_synced_at` is derived, never stored; markers have none. */
export function lastSyncedAt(record: StoredLandmark | StoredTrip): string | null {
  if (record.status !== "available") return null;
  return record.refreshed_at ?? record.saved_at;
}

// ---------------------------------------------------------------------------
// The tab-local view store (DR-3)
// ---------------------------------------------------------------------------

export interface SnapshotViewState {
  landmarks: ReadonlyMap<string, LandmarkEntry>;
  trips: ReadonlyMap<string, TripEntry>;
}

export interface SnapshotView {
  getSnapshot(): SnapshotViewState;
  subscribe(listener: () => void): () => void;
}

interface ViewChanges {
  landmarks?: [string, LandmarkEntry | null][];
  trips?: [string, TripEntry | null][];
  /** Replace everything of this kind (a full list publication). */
  replaceLandmarks?: boolean;
  replaceTrips?: boolean;
}

interface ViewControl extends SnapshotView {
  apply(changes: ViewChanges): void;
  clear(): void;
  /** In-memory blocking of content whose invalidation is not yet durable (OFF-FAIL-1 step 1). */
  suppress(landmarkIds: string[], tripIds: string[]): void;
  unsuppress(landmarkIds: string[], tripIds: string[]): void;
}

const EMPTY: SnapshotViewState = { landmarks: new Map(), trips: new Map() };

function tripMentions(entry: TripEntry, landmarkIds: ReadonlySet<string>): boolean {
  return (
    entry.status === "ok" &&
    entry.record.status === "available" &&
    entry.record.stops.some((s) => s.is_available && landmarkIds.has(s.landmark.id))
  );
}

export function createSnapshotView(): ViewControl {
  // `published` holds what operations published; `state` is what may be shown
  // (published minus suppressed). 3e fix: a publication made WHILE suppressed
  // (the marker of an unavailability commit) is kept hidden and revealed by
  // `unsuppress`, instead of being discarded.
  let published = EMPTY;
  let state = EMPTY;
  const listeners = new Set<() => void>();
  const suppressedLandmarks = new Set<string>();
  const suppressedTrips = new Set<string>();

  function visible(next: SnapshotViewState): SnapshotViewState {
    if (suppressedLandmarks.size === 0 && suppressedTrips.size === 0) return next;
    return {
      landmarks: new Map([...next.landmarks].filter(([id]) => !suppressedLandmarks.has(id))),
      trips: new Map(
        [...next.trips].filter(
          ([id, entry]) => !suppressedTrips.has(id) && !tripMentions(entry, suppressedLandmarks),
        ),
      ),
    };
  }
  function set(next: SnapshotViewState) {
    published = next;
    state = visible(next);
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply(changes) {
      const landmarks = new Map(changes.replaceLandmarks ? [] : published.landmarks);
      const trips = new Map(changes.replaceTrips ? [] : published.trips);
      for (const [id, entry] of changes.landmarks ?? []) {
        if (entry === null) landmarks.delete(id);
        else landmarks.set(id, entry);
      }
      for (const [id, entry] of changes.trips ?? []) {
        if (entry === null) trips.delete(id);
        else trips.set(id, entry);
      }
      set({ landmarks, trips });
    },
    clear() {
      set(EMPTY);
    },
    suppress(landmarkIds, tripIds) {
      for (const id of landmarkIds) suppressedLandmarks.add(id);
      for (const id of tripIds) suppressedTrips.add(id);
      // Content shown before suppression is dropped for good (conservative):
      // only what is published afterwards can reappear.
      set(visible(published));
    },
    unsuppress(landmarkIds, tripIds) {
      for (const id of landmarkIds) suppressedLandmarks.delete(id);
      for (const id of tripIds) suppressedTrips.delete(id);
      set(published);
    },
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export interface SnapshotDeps {
  security: SecurityDeps;
  safety: Pick<UpdateSafety, "acquireHold">;
  network: SnapshotNetwork;
  /** The tab's verified lifecycle, or null when offline access is not eligible. */
  identity: () => SnapshotIdentity | null;
  /**
   * 3e: the identity for READS and local REMOVAL (approved E2): the verified
   * identity, or the read-only offline identity AccountSecurity records from
   * the last verified account's marker while the server cannot be reached.
   * Saves and refreshes always require `identity`.
   */
  readIdentity?: () => SnapshotIdentity | null;
  /** Called on a 401 (AC-37): starts the coordinated session check. */
  onSessionCheckRequired: () => void;
  /** Best-effort persistent-storage request (OFF-STORE-6); absent when unsupported. */
  persist?: () => Promise<boolean>;
  view: ViewControl;
}

export interface SnapshotOperations {
  readonly view: SnapshotView;
  saveLandmark(id: string): Promise<SnapshotResult>;
  refreshLandmark(id: string): Promise<SnapshotResult>;
  removeLandmark(id: string): Promise<RemoveResult>;
  getLandmark(id: string): Promise<GetResult<LandmarkEntry>>;
  listLandmarks(): Promise<ListResult<LandmarkEntry>>;
  saveTrip(id: string): Promise<SnapshotResult>;
  refreshTrip(id: string): Promise<SnapshotResult>;
  removeTrip(id: string): Promise<RemoveResult>;
  getTrip(id: string): Promise<GetResult<TripEntry>>;
  listTrips(): Promise<ListResult<TripEntry>>;
  /**
   * 3e: re-reads what is currently published (after a notice or on regaining
   * focus), so removed or invalidated copies leave rendered views. Advisory:
   * every read still runs the full gates.
   */
  revalidateView(): Promise<void>;
  /** Clears the published view (on any local block). */
  clearView(): void;
}

type Kind = "landmark" | "trip";
const STORES = ["meta", "landmarks", "trips", "invalidations", "deletions"] as const;
type WriteTx = IDBPTransaction<OfflineDataSchema, (typeof STORES)[number][], "readwrite">;
type ReadTx = IDBPTransaction<OfflineDataSchema, (typeof STORES)[number][], "readonly">;

interface Start {
  identity: SnapshotIdentity;
  startSeq: number;
  /** The record at the start: absent, a validated record, or unreadable. */
  base: StoredLandmark | StoredTrip | null | "unreadable";
  snapshot: GenerationSnapshot;
}

/** A commit's decision: write (then publish) or stop (nothing written). */
type Decision<T> = { result: T; publish?: ViewChanges; write: boolean };

const owner = (identity: SnapshotIdentity) =>
  ({
    schema_version: OFFLINE_SCHEMA_VERSION,
    account_id: identity.accountId,
    lifecycle_id: identity.lifecycleId,
  }) as const;
const lifecycleRange = (identity: SnapshotIdentity) =>
  IDBKeyRange.only([identity.accountId, identity.lifecycleId]);
const recordKey = (identity: SnapshotIdentity, id: string): [string, string, string] => [
  identity.accountId,
  identity.lifecycleId,
  id,
];
const storeOf = (kind: Kind) => (kind === "landmark" ? "landmarks" : "trips");

const entryFor = <R extends StoredLandmark | StoredTrip>(record: R) =>
  ({ status: "ok", record, lastSyncedAt: lastSyncedAt(record) }) as const;

async function settleAbort(tx: { abort(): void; done: Promise<void> }): Promise<void> {
  try {
    tx.abort();
  } catch {
    // Already finished or aborted.
  }
  await tx.done.catch(() => undefined);
}

function storageError(error: unknown): SnapshotResult {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "QuotaExceededError" ? { kind: "quota" } : { kind: "storage-failed" };
}

/** The exact placeholder for a stop (OFF-SNAP-4, OFF-EV-6). */
function placeholder(stop: StoredStop): StoredStop {
  return {
    stop_id: stop.stop_id,
    position: stop.position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: stop.landmark.id, is_available: false },
  };
}

/**
 * OFF-EV-6 within one trip: each affected available stop becomes the exact
 * placeholder, its own and the following stop's leg become null, unaffected
 * legs stay, and the summary becomes `invalidated` with its numbers REMOVED.
 * No distance is calculated. Returns null when the trip is unaffected.
 */
export function invalidateTripStops(
  trip: StoredAvailableTrip,
  landmarkIds: ReadonlySet<string>,
  now: string,
  revision: number,
): StoredAvailableTrip | null {
  const affected = trip.stops.map((s) => s.is_available && landmarkIds.has(s.landmark.id));
  if (!affected.includes(true)) return null;
  const stops = trip.stops.map((stop, i) => {
    if (affected[i]) return placeholder(stop);
    if (i > 0 && affected[i - 1] && stop.is_available) {
      return { ...stop, distance_from_previous_miles: null };
    }
    return stop;
  });
  const next: StoredAvailableTrip = {
    ...trip,
    revision,
    stops,
    distance_summary: null,
    distance_summary_state: "invalidated",
    partially_invalidated_at: now,
  };
  const checked = validateStoredTrip(next);
  if (!checked.ok || checked.record.status !== "available") {
    throw new Error("invalidated trip failed validation");
  }
  return checked.record;
}

export function createSnapshotOperations(deps: SnapshotDeps): SnapshotOperations {
  const { security } = deps;
  const view = deps.view;
  let persistenceRequested = false;

  // -------------------------------------------------------------------------
  // Start: fresh authoritative inspection under the shared lock
  // -------------------------------------------------------------------------

  type Gate =
    | { kind: "not-eligible"; reason: "no-identity" | "lifecycle-ended" | "protected" }
    | { kind: "coordination-unavailable" }
    | { kind: "storage-unavailable" };

  async function begin(
    kind: Kind | null,
    id: string | null,
    access: "write" | "read" = "write",
  ): Promise<Start | Gate> {
    const identity = access === "write" ? deps.identity() : (deps.readIdentity ?? deps.identity)();
    if (identity === null) return { kind: "not-eligible", reason: "no-identity" };
    const locked = await security.coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "shared",
      async ({ scope }): Promise<Start | Gate> => {
        const snapshot = security.generation.snapshot();
        if (security.generation.isBlocked()) {
          return { kind: "not-eligible", reason: "lifecycle-ended" };
        }
        // OFF-STORE-5: unavailable storage is reported as such, never as an empty library.
        const probe = await openDataDatabase(security);
        if (probe === null) return { kind: "storage-unavailable" };
        probe.close();
        const state = await inspectSecurityState(scope, security);
        const marker = state.evidence.marker;
        if (state.primary !== "lifecycle" || marker.kind !== "valid") {
          return { kind: "not-eligible", reason: "protected" };
        }
        if (
          marker.marker.account_id !== identity.accountId ||
          marker.marker.lifecycle_id !== identity.lifecycleId
        ) {
          return { kind: "not-eligible", reason: "lifecycle-ended" };
        }
        const db = await openDataDatabase(security);
        if (db === null) return { kind: "storage-unavailable" };
        try {
          const tx: ReadTx = db.transaction([...STORES], "readonly");
          const startSeq = await readSequence(tx, identity);
          let base: Start["base"] = null;
          if (kind !== null && id !== null) {
            const raw: unknown = await tx.objectStore(storeOf(kind)).get(recordKey(identity, id));
            base = raw === undefined ? null : (validRecord(kind, raw, identity) ?? "unreadable");
          }
          await tx.done;
          if (startSeq === null) return { kind: "not-eligible", reason: "protected" };
          return { identity, startSeq, base, snapshot };
        } catch {
          return { kind: "storage-unavailable" };
        } finally {
          db.close();
        }
      },
    );
    return locked.kind === "done" ? locked.value : { kind: "coordination-unavailable" };
  }

  function validRecord(
    kind: Kind,
    raw: unknown,
    identity: SnapshotIdentity,
  ): StoredLandmark | StoredTrip | null {
    const checked = kind === "landmark" ? validateStoredLandmark(raw) : validateStoredTrip(raw);
    if (!checked.ok) return null;
    const r = checked.record;
    return r.account_id === identity.accountId && r.lifecycle_id === identity.lifecycleId
      ? r
      : null;
  }

  const validLandmark = (raw: unknown, identity: SnapshotIdentity) =>
    validRecord("landmark", raw, identity) as StoredLandmark | null;
  const validTrip = (raw: unknown, identity: SnapshotIdentity) =>
    validRecord("trip", raw, identity) as StoredTrip | null;

  /** The lifecycle's sequence value (0 when absent), or null when foreign or malformed. */
  async function readSequence(
    tx: ReadTx | WriteTx,
    identity: SnapshotIdentity,
  ): Promise<number | null> {
    const raw: unknown = await tx.objectStore("meta").get("sequence");
    if (raw === undefined) return 0;
    const checked = validateStoredSequence(raw);
    if (
      !checked.ok ||
      checked.record.account_id !== identity.accountId ||
      checked.record.lifecycle_id !== identity.lifecycleId
    ) {
      return null;
    }
    return checked.record.value;
  }

  async function nextSequence(tx: WriteTx, identity: SnapshotIdentity): Promise<number> {
    const current = await readSequence(tx, identity);
    if (current === null) throw new Error("sequence unreadable");
    const record: StoredSequence = { key: "sequence", ...owner(identity), value: current + 1 };
    if (!validateStoredSequence(record).ok) throw new Error("sequence invalid");
    await tx.objectStore("meta").put(record);
    return record.value;
  }

  async function seqOf(
    tx: WriteTx,
    store: "invalidations" | "deletions",
    key: IDBValidKey,
  ): Promise<number> {
    const raw: unknown = await tx.objectStore(store).get(key as never);
    if (raw === undefined) return 0;
    const checked =
      store === "invalidations" ? validateStoredInvalidation(raw) : validateStoredDeletion(raw);
    // A malformed ordering record never permits a write: treat it as the newest.
    return checked.ok ? checked.record.seq : Number.MAX_SAFE_INTEGER;
  }

  const deletionKey = (identity: SnapshotIdentity, kind: Kind, id: string) => [
    identity.accountId,
    identity.lifecycleId,
    kind,
    id,
  ];

  // -------------------------------------------------------------------------
  // Commit: one readwrite transaction under the shared lock (OFF-LIFE-6)
  // -------------------------------------------------------------------------

  async function commit<T extends SnapshotResult | RemoveResult>(
    start: Start,
    decide: (tx: WriteTx, now: string) => Promise<Decision<T>>,
  ): Promise<T | SnapshotResult> {
    const locked = await security.coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "shared",
      async (): Promise<T | SnapshotResult> => {
        // Final security checks immediately before the transaction.
        if (!security.generation.isCurrent(start.snapshot)) {
          return { kind: "not-eligible", reason: "lifecycle-ended" };
        }
        if (security.safetyLock.read() !== "absent") {
          return { kind: "not-eligible", reason: "protected" };
        }
        const db: IDBPDatabase<OfflineDataSchema> | null = await openDataDatabase(security);
        if (db === null) return { kind: "storage-unavailable" };
        let decision: Decision<T> | undefined;
        let tx: WriteTx | null = null;
        try {
          tx = db.transaction([...STORES], "readwrite");
          // The lifecycle must still be current INSIDE the commit transaction.
          const marker = validateStoredMarker(await tx.objectStore("meta").get("marker"));
          if (
            !marker.ok ||
            marker.record.account_id !== start.identity.accountId ||
            marker.record.lifecycle_id !== start.identity.lifecycleId
          ) {
            await settleAbort(tx);
            return { kind: "not-eligible", reason: "lifecycle-ended" };
          }
          decision = await decide(tx, security.now());
          if (!decision.write) {
            await settleAbort(tx);
          } else {
            await tx.done;
          }
        } catch (error) {
          if (tx !== null) await settleAbort(tx);
          return storageError(error);
        } finally {
          db.close();
        }
        // DR-3: final check after the transaction completed, then SYNCHRONOUS
        // publication while the shared lock is still held.
        if (decision === undefined) return { kind: "storage-failed" };
        if (decision.publish !== undefined && security.generation.isCurrent(start.snapshot)) {
          view.apply(decision.publish);
        }
        return decision.result;
      },
    );
    return locked.kind === "done" ? locked.value : { kind: "coordination-unavailable" };
  }

  // -------------------------------------------------------------------------
  // Authoritative unavailability (OFF-EV-6) — applied inside a commit
  // -------------------------------------------------------------------------

  /**
   * Records the invalidation of `landmarkIds` with a new sequence value and
   * propagates it atomically: a stored landmark snapshot becomes a marker (a
   * removed or never-saved copy is NOT recreated), and every available trip of
   * the lifecycle containing one of them is invalidated (except `skipTripId`,
   * which the caller writes itself).
   */
  async function applyUnavailability(
    tx: WriteTx,
    identity: SnapshotIdentity,
    landmarkIds: string[],
    now: string,
    skipTripId?: string,
  ): Promise<ViewChanges & { markers: string[] }> {
    const changes: ViewChanges & { markers: string[] } = { landmarks: [], trips: [], markers: [] };
    if (landmarkIds.length === 0) return changes;
    const seq = await nextSequence(tx, identity);
    for (const id of landmarkIds) {
      const invalidation: StoredInvalidation = {
        ...owner(identity),
        landmark_id: id,
        seq,
        recorded_at: now,
      };
      if (!validateStoredInvalidation(invalidation).ok) throw new Error("invalidation invalid");
      await tx.objectStore("invalidations").put(invalidation);
      const raw: unknown = await tx.objectStore("landmarks").get(recordKey(identity, id));
      const current = raw === undefined ? null : validLandmark(raw, identity);
      if (current !== null && current.status === "available") {
        const marker = projectUnavailableLandmark(
          current as StoredLandmark,
          now,
          current.revision + 1,
        );
        if (marker === null) throw new Error("marker projection failed");
        await tx.objectStore("landmarks").put(marker);
        changes.landmarks!.push([id, entryFor(marker)]);
        changes.markers.push(id);
      } else if (raw !== undefined && current === null) {
        // An unreadable record is never displayed; it stays removable (OFF-SNAP-8).
      }
    }
    const ids = new Set(landmarkIds);
    const trips: unknown[] = await tx
      .objectStore("trips")
      .index("by_lifecycle")
      .getAll(lifecycleRange(identity));
    for (const raw of trips) {
      const trip = validTrip(raw, identity);
      if (trip === null || trip.status !== "available" || trip.trip_id === skipTripId) continue;
      const next = invalidateTripStops(trip as StoredAvailableTrip, ids, now, trip.revision + 1);
      if (next === null) continue;
      await tx.objectStore("trips").put(next);
      changes.trips!.push([next.trip_id, entryFor(next)]);
    }
    return changes;
  }

  /**
   * OFF-FAIL-1 steps 3–6 after an invalidation commit failed (step 1, in-memory
   * suppression, already happened): a safe fallback deletion of the affected
   * records; otherwise the existing durable failure record or D22 escalation;
   * otherwise memory-only. Never claims physical erasure.
   */
  async function escalate(
    identity: SnapshotIdentity,
    landmarkIds: string[],
    tripIds: string[],
  ): Promise<Protection> {
    const deleted = await security.coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "shared",
      async () => {
        const db = await openDataDatabase(security);
        if (db === null) return false;
        try {
          const tx: WriteTx = db.transaction([...STORES], "readwrite");
          const ids = new Set(landmarkIds);
          for (const id of landmarkIds) {
            await tx.objectStore("landmarks").delete(recordKey(identity, id));
          }
          for (const id of tripIds) await tx.objectStore("trips").delete(recordKey(identity, id));
          const trips: unknown[] = await tx
            .objectStore("trips")
            .index("by_lifecycle")
            .getAll(lifecycleRange(identity));
          for (const raw of trips) {
            const trip = validTrip(raw, identity);
            if (
              trip !== null &&
              trip.status === "available" &&
              trip.stops.some((s) => s.is_available && ids.has(s.landmark.id))
            ) {
              await tx.objectStore("trips").delete(recordKey(identity, trip.trip_id));
            }
          }
          await tx.done;
          return true;
        } catch {
          return false;
        } finally {
          db.close();
        }
      },
    );
    if (deleted.kind === "done" && deleted.value) {
      advise(security, "state-changed");
      return "deleted";
    }
    const recorded = await security.coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "exclusive",
      ({ scope }) => recordCleanupFailure(scope, security),
    );
    if (recorded.kind !== "done") return "memory-only";
    const { failureRecord, safetyLock } = recorded.value;
    if (failureRecord === "written" || failureRecord === "joined") return "failure-record";
    return safetyLock?.durable === true ? "safety-lock" : "memory-only";
  }

  /** Commits authoritative unavailability, escalating if it cannot be recorded. */
  async function commitUnavailability(
    start: Start,
    landmarkIds: string[],
    tripIds: string[],
    decide: (tx: WriteTx, now: string) => Promise<Decision<SnapshotResult>>,
  ): Promise<SnapshotResult> {
    view.suppress(landmarkIds, tripIds); // OFF-FAIL-1 step 1: block at once, in memory
    const result = await commit(start, decide);
    if (
      result.kind === "quota" ||
      result.kind === "storage-failed" ||
      result.kind === "storage-unavailable"
    ) {
      const protection = await escalate(start.identity, landmarkIds, tripIds);
      return { kind: "invalidation-not-durable", protection };
    }
    if (result.kind === "not-eligible" || result.kind === "coordination-unavailable") {
      return result; // the lifecycle ended or is protected; the view stays suppressed
    }
    view.unsuppress(landmarkIds, tripIds); // durably recorded and republished as markers
    if (result.kind === "unavailable" || result.kind === "saved" || result.kind === "refreshed") {
      advise(security, "state-changed"); // 3e: other tabs re-read what they show (advisory)
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------

  async function withHold<T>(run: () => Promise<T>): Promise<T | { kind: "updating" }> {
    const hold = deps.safety.acquireHold(); // DR-5: refused while an update holds the gate
    if (hold === null) return { kind: "updating" };
    try {
      return await run();
    } finally {
      hold.release();
    }
  }

  async function requestPersistence(): Promise<Persistence> {
    persistenceRequested = true;
    if (deps.persist === undefined) return "unsupported";
    try {
      return (await deps.persist()) ? "granted" : "denied";
    } catch {
      return "failed";
    }
  }

  function landmarkOperation(rawId: string, mode: "save" | "refresh"): Promise<SnapshotResult> {
    const id = rawId.toLowerCase();
    if (!isUuid(id)) return Promise.resolve({ kind: "stale", reason: "invalid" });
    return withHold(async (): Promise<SnapshotResult> => {
      const start = await begin("landmark", id);
      if (!("identity" in start)) return start;
      if (start.base === "unreadable") return { kind: "unreadable" };
      if (mode === "save" && start.base !== null) return { kind: "already-saved" };
      if (mode === "refresh" && start.base === null) return { kind: "not-saved" };

      const response = await deps.network.fetchLandmark(id);
      if (response.kind === "auth") {
        deps.onSessionCheckRequired();
        return { kind: "session-check-required" };
      }
      if (response.kind === "transient" || response.kind === "invalid") {
        return { kind: "stale", reason: response.kind };
      }
      const identity = start.identity;
      const key = recordKey(identity, id);

      if (response.kind === "unavailable") {
        return commitUnavailability(start, [id], [], async (tx, now) => {
          // A removal after the start: never recreate, but the invalidation and
          // its propagation into saved trips are still applied (DR-7).
          const changes = await applyUnavailability(tx, identity, [id], now);
          return {
            write: true,
            publish: changes,
            result: { kind: "unavailable", marker: changes.markers.includes(id) },
          };
        });
      }

      const result = await commit(start, async (tx, now): Promise<Decision<SnapshotResult>> => {
        const stop = (result: SnapshotResult): Decision<SnapshotResult> => ({
          write: false,
          result,
        });
        if (
          (await seqOf(tx, "deletions", deletionKey(identity, "landmark", id))) > start.startSeq
        ) {
          return stop({ kind: "deleted-meanwhile" });
        }
        if ((await seqOf(tx, "invalidations", key)) > start.startSeq) {
          return stop({ kind: "superseded" }); // S1: overlapping → unavailability wins
        }
        const raw: unknown = await tx.objectStore("landmarks").get(key);
        const current = raw === undefined ? null : validLandmark(raw, identity);
        if (raw !== undefined && current === null) return stop({ kind: "unreadable" });
        if (mode === "save") {
          if (current !== null) return stop({ kind: "already-saved" });
          const count = await tx
            .objectStore("landmarks")
            .index("by_lifecycle")
            .count(lifecycleRange(identity));
          if (count >= LANDMARK_SNAPSHOT_LIMIT) {
            return stop({ kind: "limit-reached", limit: LANDMARK_SNAPSHOT_LIMIT });
          }
        } else {
          if (current === null) return stop({ kind: "deleted-meanwhile" });
          const base = start.base as StoredLandmark;
          if (current.revision !== base.revision) return stop({ kind: "changed-meanwhile" });
        }
        const record = projectAvailableLandmark(response.body, id, {
          account_id: identity.accountId,
          lifecycle_id: identity.lifecycleId,
          revision: current === null ? 1 : current.revision + 1,
          saved_at: current === null ? now : current.saved_at,
          ...(mode === "refresh" ? { refreshed_at: now } : {}),
        });
        if (record === null) return stop({ kind: "stale", reason: "invalid" });
        await tx.objectStore("landmarks").put(record);
        return {
          write: true,
          publish: { landmarks: [[id, entryFor(record)]] },
          result:
            mode === "save"
              ? { kind: "saved" }
              : current?.status === "unavailable"
                ? { kind: "restored" }
                : { kind: "refreshed" },
        };
      });
      if (result.kind === "saved" && !persistenceRequested) {
        return { kind: "saved", persistence: await requestPersistence() };
      }
      return result;
    });
  }

  function tripOperation(rawId: string, mode: "save" | "refresh"): Promise<SnapshotResult> {
    const id = rawId.toLowerCase();
    if (!isUuid(id)) return Promise.resolve({ kind: "stale", reason: "invalid" });
    return withHold(async (): Promise<SnapshotResult> => {
      const start = await begin("trip", id);
      if (!("identity" in start)) return start;
      if (start.base === "unreadable") return { kind: "unreadable" };
      if (mode === "save" && start.base !== null) return { kind: "already-saved" };
      if (mode === "refresh" && start.base === null) return { kind: "not-saved" };

      const response = await deps.network.fetchTrip(id);
      if (response.kind === "auth") {
        deps.onSessionCheckRequired();
        return { kind: "session-check-required" };
      }
      if (response.kind === "transient" || response.kind === "invalid") {
        return { kind: "stale", reason: response.kind };
      }
      const identity = start.identity;
      const key = recordKey(identity, id);
      const deletedAfterStart = async (tx: WriteTx) =>
        (await seqOf(tx, "deletions", deletionKey(identity, "trip", id))) > start.startSeq;

      if (response.kind === "unavailable") {
        // OFF-EV-7: only this trip; never landmark evidence; never recreated.
        return commitUnavailability(start, [], [id], async (tx, now) => {
          if (await deletedAfterStart(tx)) {
            return { write: false, result: { kind: "deleted-meanwhile" } };
          }
          const raw: unknown = await tx.objectStore("trips").get(key);
          const current = raw === undefined ? null : validTrip(raw, identity);
          if (current === null || current.status === "unavailable") {
            return { write: false, result: { kind: "unavailable", marker: current !== null } };
          }
          const marker = projectUnavailableTrip(current, now, current.revision + 1);
          if (marker === null) throw new Error("trip marker projection failed");
          await tx.objectStore("trips").put(marker);
          return {
            write: true,
            publish: { trips: [[id, entryFor(marker)]] },
            result: { kind: "unavailable", marker: true },
          };
        });
      }

      // An available trip: validated unavailable stops are authoritative landmark evidence.
      const unavailableStops = unavailableStopIds(response.body);
      const decide = async (tx: WriteTx, now: string): Promise<Decision<SnapshotResult>> => {
        // Authoritative unavailable stops are ALWAYS applied, even when this
        // trip's own write stops early (DR-7): the trip is not recreated, but
        // the evidence still reaches the other saved copies.
        const stop = async (result: SnapshotResult): Promise<Decision<SnapshotResult>> => {
          if (unavailableStops.length === 0) return { write: false, result };
          const propagated = await applyUnavailability(tx, identity, unavailableStops, now, id);
          return { write: true, publish: propagated, result };
        };
        if (await deletedAfterStart(tx)) return stop({ kind: "deleted-meanwhile" });
        const raw: unknown = await tx.objectStore("trips").get(key);
        const current = raw === undefined ? null : validTrip(raw, identity);
        if (raw !== undefined && current === null) return stop({ kind: "unreadable" });
        if (mode === "save") {
          if (current !== null) return stop({ kind: "already-saved" });
          const count = await tx
            .objectStore("trips")
            .index("by_lifecycle")
            .count(lifecycleRange(identity));
          if (count >= TRIP_SNAPSHOT_LIMIT) {
            return stop({ kind: "limit-reached", limit: TRIP_SNAPSHOT_LIMIT });
          }
        } else {
          if (current === null) return stop({ kind: "deleted-meanwhile" });
          if (current.revision !== (start.base as StoredTrip).revision) {
            return stop({ kind: "changed-meanwhile" });
          }
        }
        const revision = current === null ? 1 : current.revision + 1;
        const projected = projectAvailableTrip(response.body, id, {
          account_id: identity.accountId,
          lifecycle_id: identity.lifecycleId,
          revision,
          saved_at: current === null ? now : current.saved_at,
          ...(mode === "refresh" ? { refreshed_at: now } : {}),
        });
        if (projected === null) return stop({ kind: "stale", reason: "invalid" });
        // OFF-EV-5(c): stops whose landmark was invalidated AFTER the start are
        // stored as placeholders; earlier invalidations are an established order.
        const lateIds = new Set<string>();
        for (const s of projected.stops) {
          if (!s.is_available) continue;
          const invSeq = await seqOf(tx, "invalidations", recordKey(identity, s.landmark.id));
          if (invSeq > start.startSeq) lateIds.add(s.landmark.id);
        }
        const record =
          lateIds.size > 0
            ? (invalidateTripStops(projected, lateIds, now, revision) ?? projected)
            : projected;
        // Authoritative unavailable stops propagate to the other saved copies.
        const propagated = await applyUnavailability(tx, identity, unavailableStops, now, id);
        await tx.objectStore("trips").put(record);
        return {
          write: true,
          publish: {
            landmarks: propagated.landmarks,
            trips: [...(propagated.trips ?? []), [id, entryFor(record)]],
          },
          result:
            mode === "save"
              ? { kind: "saved" }
              : current?.status === "unavailable"
                ? { kind: "restored" }
                : { kind: "refreshed" },
        };
      };
      const result =
        unavailableStops.length > 0
          ? await commitUnavailability(start, unavailableStops, [], decide)
          : await commit(start, decide);
      if (result.kind === "saved" && !persistenceRequested) {
        return { kind: "saved", persistence: await requestPersistence() };
      }
      return result;
    });
  }

  function remove(kind: Kind, rawId: string): Promise<RemoveResult> {
    const id = rawId.toLowerCase();
    return withHold(async (): Promise<RemoveResult> => {
      // E2: local removal also works with the read-only offline identity; it
      // sends no request and keeps every lifecycle, security, coordination,
      // and deletion-ordering check.
      const start = await begin(null, null, "read");
      if (!("identity" in start)) return start;
      const identity = start.identity;
      const result = await commit(start, async (tx): Promise<Decision<RemoveResult>> => {
        const store = tx.objectStore(storeOf(kind));
        const key = recordKey(identity, id);
        const existed = (await store.get(key)) !== undefined;
        await store.delete(key);
        // The removal is recorded so a late response never recreates it (DR-7).
        const seq = await nextSequence(tx, identity);
        const deletion: StoredDeletion = { ...owner(identity), kind, item_id: id, seq };
        if (!validateStoredDeletion(deletion).ok) throw new Error("deletion invalid");
        await tx.objectStore("deletions").put(deletion);
        return {
          write: true,
          publish: kind === "landmark" ? { landmarks: [[id, null]] } : { trips: [[id, null]] },
          result: existed ? { kind: "removed" } : { kind: "not-found" },
        };
      });
      if (result.kind === "removed") advise(security, "state-changed"); // 3e, advisory
      return result as RemoveResult;
    });
  }

  async function read<E extends LandmarkEntry | TripEntry>(
    kind: Kind,
    id: string | null,
  ): Promise<GetResult<E>> {
    const result = await readOnce<E>(kind, id);
    // An observed security invalidation withdraws published content at once.
    if (
      result.kind === "not-eligible" &&
      (result.reason === "lifecycle-ended" || result.reason === "protected")
    ) {
      view.clear();
    }
    return result;
  }

  async function readOnce<E extends LandmarkEntry | TripEntry>(
    kind: Kind,
    id: string | null,
  ): Promise<GetResult<E>> {
    const start = await begin(null, null, "read");
    if (!("identity" in start)) return start;
    const identity = start.identity;
    const locked = await security.coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "shared",
      async (): Promise<GetResult<E>> => {
        if (!security.generation.isCurrent(start.snapshot)) {
          return { kind: "not-eligible", reason: "lifecycle-ended" };
        }
        if (security.safetyLock.read() !== "absent") {
          return { kind: "not-eligible", reason: "protected" };
        }
        const db = await openDataDatabase(security);
        if (db === null) return { kind: "storage-unavailable" };
        const entries: E[] = [];
        try {
          const tx: ReadTx = db.transaction([...STORES], "readonly");
          const marker = validateStoredMarker(await tx.objectStore("meta").get("marker"));
          if (
            !marker.ok ||
            marker.record.account_id !== identity.accountId ||
            marker.record.lifecycle_id !== identity.lifecycleId
          ) {
            await tx.done;
            return { kind: "not-eligible", reason: "lifecycle-ended" };
          }
          const store = tx.objectStore(storeOf(kind));
          const pairs: [unknown, unknown][] = [];
          if (id === null) {
            const index = store.index("by_lifecycle");
            const keys = await index.getAllKeys(lifecycleRange(identity));
            const values: unknown[] = await index.getAll(lifecycleRange(identity));
            keys.forEach((k, i) => pairs.push([k, values[i]]));
          } else {
            const key = recordKey(identity, id.toLowerCase());
            const value: unknown = await store.get(key);
            if (value !== undefined) pairs.push([key, value]);
          }
          await tx.done;
          for (const [key, value] of pairs) {
            const record = validRecord(kind, value, identity);
            const itemId = String((key as unknown[])[2]);
            entries.push(
              (record === null ? { status: "unreadable", id: itemId } : entryFor(record)) as E,
            );
          }
        } catch {
          return { kind: "storage-failed" };
        } finally {
          db.close();
        }
        // DR-3: final check and synchronous publication inside the shared lock.
        if (!security.generation.isCurrent(start.snapshot)) {
          return { kind: "not-eligible", reason: "lifecycle-ended" };
        }
        const idOf = (e: E) => (e.status === "ok" ? recordId(e.record) : e.id);
        const pairsForView = entries.map((e) => [idOf(e), e] as [string, E]);
        if (kind === "landmark") {
          view.apply({
            landmarks: (id === null
              ? pairsForView
              : pairsForView.length === 0
                ? [[id.toLowerCase(), null]]
                : pairsForView) as [string, LandmarkEntry | null][],
            replaceLandmarks: id === null,
          });
        } else {
          view.apply({
            trips: (id === null
              ? pairsForView
              : pairsForView.length === 0
                ? [[id.toLowerCase(), null]]
                : pairsForView) as [string, TripEntry | null][],
            replaceTrips: id === null,
          });
        }
        return id === null ? { kind: "ok", entries } : { kind: "ok", entry: entries[0] ?? null };
      },
    );
    return locked.kind === "done" ? locked.value : { kind: "coordination-unavailable" };
  }

  return {
    view,
    saveLandmark: (id) => landmarkOperation(id, "save"),
    refreshLandmark: (id) => landmarkOperation(id, "refresh"),
    removeLandmark: (id) => remove("landmark", id),
    getLandmark: (id) => read<LandmarkEntry>("landmark", id),
    listLandmarks: () =>
      read<LandmarkEntry>("landmark", null) as Promise<ListResult<LandmarkEntry>>,
    saveTrip: (id) => tripOperation(id, "save"),
    refreshTrip: (id) => tripOperation(id, "refresh"),
    removeTrip: (id) => remove("trip", id),
    getTrip: (id) => read<TripEntry>("trip", id),
    listTrips: () => read<TripEntry>("trip", null) as Promise<ListResult<TripEntry>>,
    clearView: () => view.clear(),
    async revalidateView() {
      const { landmarks, trips } = view.getSnapshot();
      if (landmarks.size > 0) await read<LandmarkEntry>("landmark", null);
      if (trips.size > 0) await read<TripEntry>("trip", null);
    },
  };
}

function recordId(record: StoredLandmark | StoredTrip): string {
  return "landmark_id" in record ? record.landmark_id : record.trip_id;
}

/** Landmark IDs of the VALIDATED unavailable stops of an owner-trip response (OFF-EV-2). */
function unavailableStopIds(body: unknown): string[] {
  const trip = parseOwnerTripResponse(body);
  if (trip === null) return [];
  return trip.stops.filter((s) => !s.is_available).map((s) => s.landmark.id);
}
