/**
 * Persisted offline record contracts (M06-T03 Increment 3a; Specification 6
 * v1.1 §12.1–§12.8; ADR-007 amendment). Every record that may be written to
 * the offline databases is described here with an EXACT field allowlist, and
 * every record read back is validated here as untrusted data.
 *
 * - Validators check exact key sets (no unknown field is ever accepted),
 *   types, identifiers, timestamps, coordinates, status discriminants, and the
 *   structural rules of trips. TypeScript types alone are never relied upon.
 * - A failed validation returns a reason CODE only — never the record or any
 *   of its values — so an invalid stored record can be rejected (and later
 *   listed as an unreadable copy, OFF-SNAP-8) without exposing its contents.
 * - Nothing here touches storage; this module only describes and checks data.
 *   Projection from validated API responses lives in `projection.ts`.
 */

/** The only schema version this application reads or writes (both databases, every record). */
export const OFFLINE_SCHEMA_VERSION = 1;

/** Per account, per device (OFF-STORE-1). Enforced transactionally in a later increment. */
export const LANDMARK_SNAPSHOT_LIMIT = 200;
export const TRIP_SNAPSHOT_LIMIT = 25;
export const MAX_TRIP_STOPS = 25;
export const MAX_TRIP_NAME_CODE_POINTS = 100;

/**
 * The known landmark category slugs (OFF-EV-3): exactly the backend's
 * `CATEGORY_DEFINITIONS` (backend/src/landmarks/categories.ts, Specification 2
 * §9.8), which the frontend's map styles also use. A snapshot with any other
 * category is rejected.
 */
export const KNOWN_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  "arch",
  "bald",
  "falls",
  "lake",
  "other",
  "peak",
  "rock",
  "sink",
]);

// ---------------------------------------------------------------------------
// Record types (persisted shapes)
// ---------------------------------------------------------------------------

/** Ownership fields carried by every account-scoped content record (OFF-SNAP-1). */
export interface Ownership {
  schema_version: 1;
  account_id: string;
  lifecycle_id: string;
}

/** OFF-SNAP-2 — from a validated full profile only. */
export interface StoredAvailableLandmark extends Ownership {
  revision: number;
  landmark_id: string;
  status: "available";
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
  saved_at: string;
  source_description?: string | null;
  source_access_label?: string | null;
  source_url?: string | null;
  refreshed_at?: string;
}

/** OFF-SNAP-3 — management metadata only; no name, category, coordinates, or source fields. */
export interface StoredUnavailableLandmark extends Ownership {
  revision: number;
  landmark_id: string;
  status: "unavailable";
  saved_at: string;
  unavailable_recorded_at: string;
}

export type StoredLandmark = StoredAvailableLandmark | StoredUnavailableLandmark;

export interface StoredTripLandmark {
  id: string;
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
}

export interface StoredAvailableStop {
  stop_id: string;
  position: number;
  is_available: true;
  distance_from_previous_miles: number | null;
  landmark: StoredTripLandmark;
}

/** The exact unavailable placeholder (OFF-SNAP-4, OFF-EV-6). */
export interface StoredUnavailableStop {
  stop_id: string;
  position: number;
  is_available: false;
  distance_from_previous_miles: null;
  landmark: { id: string; is_available: false };
}

export type StoredStop = StoredAvailableStop | StoredUnavailableStop;

export interface StoredDistanceSummary {
  total_miles: number | null;
  measured_legs: number;
  total_legs: number;
}

/** OFF-SNAP-4 / OFF-SNAP-5. */
export interface StoredAvailableTrip extends Ownership {
  revision: number;
  trip_id: string;
  status: "available";
  name: string;
  stops: StoredStop[];
  distance_summary: StoredDistanceSummary | null;
  distance_summary_state: "server" | "invalidated";
  saved_at: string;
  trip_updated_at?: string;
  refreshed_at?: string;
  partially_invalidated_at?: string;
}

/** OFF-SNAP-6 — management metadata only. */
export interface StoredUnavailableTrip extends Ownership {
  revision: number;
  trip_id: string;
  status: "unavailable";
  saved_at: string;
  unavailable_recorded_at: string;
}

export type StoredTrip = StoredAvailableTrip | StoredUnavailableTrip;

/** OFF-LIFE-1 — the account marker (`meta`, key "marker"). Not an authenticated session. */
export interface StoredAccountMarker extends Ownership {
  key: "marker";
  verified_at: string;
}

/** The lifecycle-scoped invalidation sequence (`meta`, key "sequence"; OFF-EV-5 mechanism, D-d). */
export interface StoredSequence extends Ownership {
  key: "sequence";
  value: number;
}

/** A landmark's latest authoritative invalidation in a lifecycle (D-d). */
export interface StoredInvalidation extends Ownership {
  landmark_id: string;
  seq: number;
  recorded_at: string;
}

/** A user removal of a saved copy, so a stale operation never recreates it (OFF-EV-5(j); D-d). */
export interface StoredDeletion extends Ownership {
  kind: "landmark" | "trip";
  item_id: string;
  seq: number;
}

/** OFF-OUT-2 — `tnle-offline-state`, key "signout_intent": a pending state and its creation time only. */
export interface StoredSignOutIntent {
  key: "signout_intent";
  schema_version: 1;
  pending: true;
  created_at: string;
}

/** OFF-FAIL-3 — `tnle-offline-state`, key "failure": the kind of durably recorded failure only. */
export interface StoredFailureRecord {
  key: "failure";
  schema_version: 1;
  kind: "invalidation" | "cleanup" | "migration";
  recorded_at: string;
}

// ---------------------------------------------------------------------------
// Validation results (reason codes only — never record contents)
// ---------------------------------------------------------------------------

export type InvalidReason =
  | "not-object"
  | "unknown-or-missing-field"
  | "schema-version"
  | "ownership"
  | "identifier"
  | "status"
  | "timestamp"
  | "revision"
  | "value";

export type Validation<T> = { ok: true; record: T } | { ok: false; reason: InvalidReason };

const fail = <T>(reason: InvalidReason): Validation<T> => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// Primitive checks
// ---------------------------------------------------------------------------

/** Canonical lower-case UUIDs: every identifier here is a database UUID (users, landmarks, trips, stops) or a `crypto.randomUUID()` lifecycle. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** ISO 8601 UTC exactly as `Date#toISOString` writes it (OFF-SNAP-7). */
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** True when every key is allowed and every required key is present. */
export function hasAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_UTC_MS.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isKnownCategory(value: unknown): value is string {
  return typeof value === "string" && KNOWN_CATEGORY_SLUGS.has(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isTripName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Array.from(value).length <= MAX_TRIP_NAME_CODE_POINTS
  );
}

/** Totals agree when both are null, or both are numbers within floating-point rounding. */
function totalsAgree(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

const OWNERSHIP_KEYS = ["schema_version", "account_id", "lifecycle_id"] as const;

function checkOwnership(value: Record<string, unknown>): InvalidReason | null {
  if (value.schema_version !== OFFLINE_SCHEMA_VERSION) return "schema-version";
  if (!isUuid(value.account_id) || !isUuid(value.lifecycle_id)) return "ownership";
  return null;
}

// ---------------------------------------------------------------------------
// Landmark records
// ---------------------------------------------------------------------------

const AVAILABLE_LANDMARK_REQUIRED = [
  ...OWNERSHIP_KEYS,
  "revision",
  "landmark_id",
  "status",
  "display_name",
  "category",
  "latitude",
  "longitude",
  "saved_at",
] as const;
const AVAILABLE_LANDMARK_OPTIONAL = [
  "source_description",
  "source_access_label",
  "source_url",
  "refreshed_at",
] as const;
const UNAVAILABLE_LANDMARK_REQUIRED = [
  ...OWNERSHIP_KEYS,
  "revision",
  "landmark_id",
  "status",
  "saved_at",
  "unavailable_recorded_at",
] as const;

export function validateStoredLandmark(value: unknown): Validation<StoredLandmark> {
  if (!isPlainRecord(value)) return fail("not-object");
  if (value.status === "available") {
    if (!hasAllowedKeys(value, AVAILABLE_LANDMARK_REQUIRED, AVAILABLE_LANDMARK_OPTIONAL)) {
      return fail("unknown-or-missing-field");
    }
  } else if (value.status === "unavailable") {
    if (!hasAllowedKeys(value, UNAVAILABLE_LANDMARK_REQUIRED)) {
      return fail("unknown-or-missing-field");
    }
  } else {
    return fail("status");
  }
  const ownership = checkOwnership(value);
  if (ownership) return fail(ownership);
  if (!isRevision(value.revision)) return fail("revision");
  if (!isUuid(value.landmark_id)) return fail("identifier");
  if (!isIsoTimestamp(value.saved_at)) return fail("timestamp");
  if (value.status === "unavailable") {
    if (!isIsoTimestamp(value.unavailable_recorded_at)) return fail("timestamp");
    return { ok: true, record: value as unknown as StoredUnavailableLandmark };
  }
  if (!isNonEmptyString(value.display_name) || !isKnownCategory(value.category)) {
    return fail("value");
  }
  if (!isLatitude(value.latitude) || !isLongitude(value.longitude)) return fail("value");
  for (const key of AVAILABLE_LANDMARK_OPTIONAL.slice(0, 3)) {
    if (key in value && !isNullableString(value[key])) return fail("value");
  }
  if ("refreshed_at" in value && !isIsoTimestamp(value.refreshed_at)) return fail("timestamp");
  return { ok: true, record: value as unknown as StoredAvailableLandmark };
}

// ---------------------------------------------------------------------------
// Trip records
// ---------------------------------------------------------------------------

const STOP_KEYS = [
  "stop_id",
  "position",
  "is_available",
  "distance_from_previous_miles",
  "landmark",
] as const;
const TRIP_LANDMARK_KEYS = ["id", "display_name", "category", "latitude", "longitude"] as const;
const UNAVAILABLE_TRIP_LANDMARK_KEYS = ["id", "is_available"] as const;
const SUMMARY_KEYS = ["total_miles", "measured_legs", "total_legs"] as const;

const AVAILABLE_TRIP_REQUIRED = [
  ...OWNERSHIP_KEYS,
  "revision",
  "trip_id",
  "status",
  "name",
  "stops",
  "distance_summary",
  "distance_summary_state",
  "saved_at",
] as const;
const AVAILABLE_TRIP_OPTIONAL = [
  "trip_updated_at",
  "refreshed_at",
  "partially_invalidated_at",
] as const;
const UNAVAILABLE_TRIP_REQUIRED = [
  ...OWNERSHIP_KEYS,
  "revision",
  "trip_id",
  "status",
  "saved_at",
  "unavailable_recorded_at",
] as const;

/**
 * Stops in position order 0…n−1, at most 25, unique stop and landmark IDs;
 * each stop in exactly one of the two shapes; the first stop and any stop
 * touching an unavailable stop carry no distance.
 */
export function areValidStoredStops(value: unknown): value is StoredStop[] {
  if (!Array.isArray(value) || value.length > MAX_TRIP_STOPS) return false;
  const stopIds = new Set<string>();
  const landmarkIds = new Set<string>();
  for (const [index, stop] of value.entries()) {
    if (!isPlainRecord(stop) || !hasAllowedKeys(stop, STOP_KEYS)) return false;
    if (!isUuid(stop.stop_id) || stop.position !== index) return false;
    const landmark = stop.landmark;
    if (!isPlainRecord(landmark)) return false;
    if (stop.is_available === true) {
      if (!hasAllowedKeys(landmark, TRIP_LANDMARK_KEYS)) return false;
      if (!isUuid(landmark.id) || !isNonEmptyString(landmark.display_name)) return false;
      if (!isKnownCategory(landmark.category)) return false;
      if (!isLatitude(landmark.latitude) || !isLongitude(landmark.longitude)) return false;
      const distance = stop.distance_from_previous_miles;
      if (distance !== null && !isNonNegativeFinite(distance)) return false;
      const previous = value[index - 1] as Record<string, unknown> | undefined;
      if (distance !== null && (previous === undefined || previous.is_available !== true)) {
        return false; // only between two available stops
      }
    } else if (stop.is_available === false) {
      if (!hasAllowedKeys(landmark, UNAVAILABLE_TRIP_LANDMARK_KEYS)) return false;
      if (!isUuid(landmark.id) || landmark.is_available !== false) return false;
      if (stop.distance_from_previous_miles !== null) return false;
    } else {
      return false;
    }
    if (stopIds.has(stop.stop_id) || landmarkIds.has(landmark.id as string)) return false;
    stopIds.add(stop.stop_id);
    landmarkIds.add(landmark.id as string);
  }
  return true;
}

/** A server summary consistent with the stored stops (Specification 5 §5.6). */
export function isConsistentSummary(summary: unknown, stops: readonly StoredStop[]): boolean {
  if (!isPlainRecord(summary) || !hasAllowedKeys(summary, SUMMARY_KEYS)) return false;
  const { total_miles, measured_legs, total_legs } = summary;
  if (!isNonNegativeInteger(measured_legs) || !isNonNegativeInteger(total_legs)) return false;
  if (total_miles !== null && !isNonNegativeFinite(total_miles)) return false;
  const legs = stops
    .map((s) => s.distance_from_previous_miles)
    .filter((d): d is number => d !== null);
  if (total_legs !== Math.max(stops.length - 1, 0)) return false;
  if (measured_legs !== legs.length || measured_legs > total_legs) return false;
  const computed = legs.length === 0 ? null : legs.reduce((sum, d) => sum + d, 0);
  if ((total_miles === null) !== (measured_legs === 0)) return false;
  return totalsAgree(total_miles as number | null, computed);
}

export function validateStoredTrip(value: unknown): Validation<StoredTrip> {
  if (!isPlainRecord(value)) return fail("not-object");
  if (value.status === "available") {
    if (!hasAllowedKeys(value, AVAILABLE_TRIP_REQUIRED, AVAILABLE_TRIP_OPTIONAL)) {
      return fail("unknown-or-missing-field");
    }
  } else if (value.status === "unavailable") {
    if (!hasAllowedKeys(value, UNAVAILABLE_TRIP_REQUIRED)) return fail("unknown-or-missing-field");
  } else {
    return fail("status");
  }
  const ownership = checkOwnership(value);
  if (ownership) return fail(ownership);
  if (!isRevision(value.revision)) return fail("revision");
  if (!isUuid(value.trip_id)) return fail("identifier");
  if (!isIsoTimestamp(value.saved_at)) return fail("timestamp");
  if (value.status === "unavailable") {
    if (!isIsoTimestamp(value.unavailable_recorded_at)) return fail("timestamp");
    return { ok: true, record: value as unknown as StoredUnavailableTrip };
  }
  if (!isTripName(value.name)) return fail("value");
  if (!areValidStoredStops(value.stops)) return fail("value");
  if (value.distance_summary_state === "server") {
    if (!isConsistentSummary(value.distance_summary, value.stops)) return fail("value");
  } else if (value.distance_summary_state === "invalidated") {
    if (value.distance_summary !== null) return fail("value"); // obsolete values removed (OFF-SNAP-5)
  } else {
    return fail("status");
  }
  for (const key of AVAILABLE_TRIP_OPTIONAL) {
    if (key in value && !isIsoTimestamp(value[key])) return fail("timestamp");
  }
  return { ok: true, record: value as unknown as StoredAvailableTrip };
}

// ---------------------------------------------------------------------------
// Lifecycle and security metadata
// ---------------------------------------------------------------------------

export function validateStoredMarker(value: unknown): Validation<StoredAccountMarker> {
  if (!isPlainRecord(value)) return fail("not-object");
  if (!hasAllowedKeys(value, ["key", ...OWNERSHIP_KEYS, "verified_at"])) {
    return fail("unknown-or-missing-field");
  }
  if (value.key !== "marker") return fail("status");
  const ownership = checkOwnership(value);
  if (ownership) return fail(ownership);
  if (!isIsoTimestamp(value.verified_at)) return fail("timestamp");
  return { ok: true, record: value as unknown as StoredAccountMarker };
}

export function validateStoredSequence(value: unknown): Validation<StoredSequence> {
  if (!isPlainRecord(value)) return fail("not-object");
  if (!hasAllowedKeys(value, ["key", ...OWNERSHIP_KEYS, "value"])) {
    return fail("unknown-or-missing-field");
  }
  if (value.key !== "sequence") return fail("status");
  const ownership = checkOwnership(value);
  if (ownership) return fail(ownership);
  if (!isNonNegativeInteger(value.value)) return fail("value");
  return { ok: true, record: value as unknown as StoredSequence };
}

export function validateStoredInvalidation(value: unknown): Validation<StoredInvalidation> {
  if (!isPlainRecord(value)) return fail("not-object");
  if (!hasAllowedKeys(value, [...OWNERSHIP_KEYS, "landmark_id", "seq", "recorded_at"])) {
    return fail("unknown-or-missing-field");
  }
  const ownership = checkOwnership(value);
  if (ownership) return fail(ownership);
  if (!isUuid(value.landmark_id)) return fail("identifier");
  if (!isRevision(value.seq)) return fail("value");
  if (!isIsoTimestamp(value.recorded_at)) return fail("timestamp");
  return { ok: true, record: value as unknown as StoredInvalidation };
}

export function validateStoredDeletion(value: unknown): Validation<StoredDeletion> {
  if (!isPlainRecord(value)) return fail("not-object");
  if (!hasAllowedKeys(value, [...OWNERSHIP_KEYS, "kind", "item_id", "seq"])) {
    return fail("unknown-or-missing-field");
  }
  const ownership = checkOwnership(value);
  if (ownership) return fail(ownership);
  if (value.kind !== "landmark" && value.kind !== "trip") return fail("status");
  if (!isUuid(value.item_id)) return fail("identifier");
  if (!isRevision(value.seq)) return fail("value");
  return { ok: true, record: value as unknown as StoredDeletion };
}

export function validateStoredSignOutIntent(value: unknown): Validation<StoredSignOutIntent> {
  if (!isPlainRecord(value)) return fail("not-object");
  if (!hasAllowedKeys(value, ["key", "schema_version", "pending", "created_at"])) {
    return fail("unknown-or-missing-field");
  }
  if (value.key !== "signout_intent" || value.pending !== true) return fail("status");
  if (value.schema_version !== OFFLINE_SCHEMA_VERSION) return fail("schema-version");
  if (!isIsoTimestamp(value.created_at)) return fail("timestamp");
  return { ok: true, record: value as unknown as StoredSignOutIntent };
}

export function validateStoredFailureRecord(value: unknown): Validation<StoredFailureRecord> {
  if (!isPlainRecord(value)) return fail("not-object");
  if (!hasAllowedKeys(value, ["key", "schema_version", "kind", "recorded_at"])) {
    return fail("unknown-or-missing-field");
  }
  if (value.key !== "failure") return fail("status");
  if (value.schema_version !== OFFLINE_SCHEMA_VERSION) return fail("schema-version");
  if (value.kind !== "invalidation" && value.kind !== "cleanup" && value.kind !== "migration") {
    return fail("status");
  }
  if (!isIsoTimestamp(value.recorded_at)) return fail("timestamp");
  return { ok: true, record: value as unknown as StoredFailureRecord };
}
