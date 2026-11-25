import { Prisma, type PrismaClient } from "@prisma/client";
import { categoryValueToSlug } from "../landmarks/categories.js";
import * as repository from "./repository.js";
import type { StopRow, TripRow } from "./repository.js";
import type { TripsListQuery } from "./request-schema.js";
import {
  buildShareUrl,
  generateShareToken,
  hashShareToken,
  isShareTokenSyntax,
} from "./share-token.js";

/**
 * Trips business logic, core operations (M05-T03 Increment 2;
 * specs/TRIP_PLANNING_SPEC.md v1.1 §§4, 5, 5.6, 6.4, 7.2, 10.1; ADR-014
 * decisions 4, 6, 7). Callers pass the authenticated user ID (from
 * `authenticatedUserId`, at the HTTP boundary in Increment 4) and
 * already-validated request values (request-schema.ts); identity never comes
 * from client input. HTTP status codes and envelopes are the router's job;
 * this module returns outcome kinds only:
 *
 *   created → 201   found / listed / renamed → 200   deleted → 204
 *   not_found        → 404 NOT_FOUND — ONE outcome for a missing trip and
 *                      another user's trip (ADR-012 decision 4)
 *   version_conflict → 409 TRIP_VERSION_CONFLICT (nothing changed)
 *
 * Stop mutations (Increment 3; spec §§6.1–6.4 as amended 2026-11-23):
 *
 *   added → 201 { stop }   removed → 204   reordered → 200 { trip }
 *   already_exists   → 409 TRIP_STOP_ALREADY_EXISTS
 *   limit_reached    → 409 TRIP_STOP_LIMIT_REACHED
 *   invalid_stop_ids → 400 INVALID_REQUEST (the reorder list is not exactly
 *                      the trip's current stops)
 *   not_found        → 404 also for a missing, inactive, SENSITIVE, or
 *                      UNREVIEWED landmark on add, and for a stop that is not
 *                      in the user's trip on remove
 *
 * Every stop mutation runs in one interactive transaction that first locks
 * the user's trip row, increments `version` exactly once (and sets
 * `updated_at`) on success, and rolls back completely on any failure.
 *
 * Sharing (Increment 5; spec §§4, 5.4, 6.4, 7.2, 10.3, 10.6; ADR-014
 * decision 10; M05-T03 decisions T3-1, T3-2):
 *
 *   shared → 200 { share_url }   revoked → 204
 *   sharing_unavailable → 409 TRIP_SHARING_UNAVAILABLE (owner only, after the
 *                         ownership lock; nothing changed)
 *   shared trip found → 200 { trip }   not_found → the generic 404 for a
 *                         malformed, unknown, revoked, or rotated token, and
 *                         for every token while sharing is off
 */

/** Settings the representations depend on, passed in so this module never reads the environment. */
export interface TripsServiceOptions {
  /** `env.trips.sharingEnabled` — reported to the owner as `sharing_enabled`. */
  sharingEnabled: boolean;
}

/** Spec §7.2: an available stop's landmark — exactly these five fields. */
export interface AvailableLandmarkSummary {
  id: string;
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
}

/** Spec §§4, 7.2, 10.4: an unavailable stop's landmark — exactly these two fields. */
export interface UnavailableLandmarkSummary {
  id: string;
  is_available: false;
}

export type StopRepresentation =
  | {
      id: string;
      position: number;
      is_available: true;
      distance_from_previous_miles: number | null;
      landmark: AvailableLandmarkSummary;
    }
  | {
      id: string;
      position: number;
      is_available: false;
      distance_from_previous_miles: null;
      landmark: UnavailableLandmarkSummary;
    };

/** Spec §5.6. */
export interface DistanceSummary {
  total_miles: number | null;
  measured_legs: number;
  total_legs: number;
}

/** Spec §7.2: the owner's trip. */
export interface OwnerTripRepresentation {
  id: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
  is_shared: boolean;
  sharing_enabled: boolean;
  stops: StopRepresentation[];
  distance_summary: DistanceSummary;
}

/** Spec §7.2: one row of the owner's trip list. */
export interface TripListItem {
  id: string;
  name: string;
  stop_count: number;
  updated_at: string;
  is_shared: boolean;
}

export interface TripListResponse {
  trips: TripListItem[];
  page: number;
  limit: number;
  has_more: boolean;
}

/**
 * ISO 8601 in UTC with milliseconds, like the reviews API. The columns are
 * `TIMESTAMP(3)` holding UTC wall-clock time (both databases `Etc/UTC`).
 */
export function toIsoTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("trips service: invalid timestamp");
  }
  return value.toISOString();
}

/**
 * Builds one stop field by field (never by spreading a row). An unavailable
 * stop gets exactly the placeholder — whatever the row holds.
 */
export function toStopRepresentation(row: StopRow): StopRepresentation {
  if (!row.available) {
    return {
      id: row.id,
      position: row.position,
      is_available: false,
      distance_from_previous_miles: null,
      landmark: { id: row.landmarkId, is_available: false },
    };
  }
  if (
    row.displayName === null ||
    row.category === null ||
    row.latitude === null ||
    row.longitude === null
  ) {
    throw new Error("trips service: an available stop is missing landmark fields");
  }
  return {
    id: row.id,
    position: row.position,
    is_available: true,
    distance_from_previous_miles: row.distanceFromPreviousMiles,
    landmark: {
      id: row.landmarkId,
      display_name: row.displayName,
      category: categoryValueToSlug(row.category),
      latitude: row.latitude,
      longitude: row.longitude,
    },
  };
}

/**
 * Spec §5.6: `total_legs = max(n − 1, 0)`; `measured_legs` counts the legs the
 * database measured (both ends available); `total_miles` is their sum, or
 * `null` when none was measured. Partial when `measured_legs < total_legs`.
 */
export function toDistanceSummary(stops: readonly StopRepresentation[]): DistanceSummary {
  const legs = stops
    .map((s) => s.distance_from_previous_miles)
    .filter((d): d is number => d !== null);
  return {
    total_miles: legs.length === 0 ? null : legs.reduce((sum, d) => sum + d, 0),
    measured_legs: legs.length,
    total_legs: Math.max(stops.length - 1, 0),
  };
}

export function toOwnerTripRepresentation(
  trip: TripRow,
  stopRows: readonly StopRow[],
  options: TripsServiceOptions,
): OwnerTripRepresentation {
  const stops = stopRows.map(toStopRepresentation);
  return {
    id: trip.id,
    name: trip.name,
    version: trip.version,
    created_at: toIsoTimestamp(trip.createdAt),
    updated_at: toIsoTimestamp(trip.updatedAt),
    is_shared: trip.isShared,
    sharing_enabled: options.sharingEnabled,
    stops,
    distance_summary: toDistanceSummary(stops),
  };
}

export type CreateOutcome = { kind: "created"; trip: OwnerTripRepresentation };

/** Creates an empty trip (version 0, no stops) in one transaction. */
export async function createTrip(
  prisma: PrismaClient,
  userId: string,
  name: string,
  options: TripsServiceOptions,
): Promise<CreateOutcome> {
  const trip = await prisma.$transaction(async (tx) => repository.insertTrip(tx, userId, name));
  return { kind: "created", trip: toOwnerTripRepresentation(trip, [], options) };
}

export type GetOutcome = { kind: "found"; trip: OwnerTripRepresentation } | { kind: "not_found" };

/**
 * The user's trip with its stops. Read in one REPEATABLE READ transaction so
 * the trip's `version` and its stops come from the same snapshot.
 */
export async function getTrip(
  prisma: PrismaClient,
  userId: string,
  tripId: string,
  options: TripsServiceOptions,
): Promise<GetOutcome> {
  const result = await prisma.$transaction(
    async (tx) => {
      const trip = await repository.findOwnedTrip(tx, userId, tripId);
      if (!trip) return null;
      return { trip, stops: await repository.findTripStops(tx, trip.id) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  if (!result) return { kind: "not_found" };
  return { kind: "found", trip: toOwnerTripRepresentation(result.trip, result.stops, options) };
}

export async function listTrips(
  prisma: PrismaClient,
  userId: string,
  query: TripsListQuery,
): Promise<{ kind: "listed"; body: TripListResponse }> {
  const { rows, hasMore } = await repository.listOwnedTrips(prisma, userId, query);
  return {
    kind: "listed",
    body: {
      trips: rows.map((r) => ({
        id: r.id,
        name: r.name,
        stop_count: r.stopCount,
        updated_at: toIsoTimestamp(r.updatedAt),
        is_shared: r.isShared,
      })),
      page: query.page,
      limit: query.limit,
      has_more: hasMore,
    },
  };
}

export type RenameOutcome =
  | { kind: "renamed"; trip: OwnerTripRepresentation }
  | { kind: "not_found" }
  | { kind: "version_conflict" };

/**
 * Spec §§5.5, 6.4: lock the user's trip row; a supplied `version` that is not
 * the locked row's version → `version_conflict` with nothing changed;
 * otherwise rename, increment `version` exactly once, set `updated_at`, and
 * return the trip as committed (re-read inside the same transaction).
 */
export async function renameTrip(
  prisma: PrismaClient,
  userId: string,
  tripId: string,
  input: { name: string; version?: number },
  options: TripsServiceOptions,
): Promise<RenameOutcome> {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await repository.lockOwnedTrip(tx, userId, tripId);
    if (!locked) return { kind: "not_found" } as const;
    if (input.version !== undefined && input.version !== locked.version) {
      return { kind: "version_conflict" } as const;
    }
    if (!(await repository.renameLockedTrip(tx, userId, tripId, input.name))) {
      throw new Error("trips service: a locked trip could not be renamed");
    }
    const trip = await repository.findOwnedTrip(tx, userId, tripId);
    if (!trip) throw new Error("trips service: a renamed trip could not be read back");
    return { kind: "renamed", trip, stops: await repository.findTripStops(tx, tripId) } as const;
  });
  if (result.kind !== "renamed") return result;
  return { kind: "renamed", trip: toOwnerTripRepresentation(result.trip, result.stops, options) };
}

export type DeleteOutcome = { kind: "deleted" } | { kind: "not_found" };

/** Deletes the user's trip and (by CASCADE) its stops, atomically. */
export async function deleteTrip(
  prisma: PrismaClient,
  userId: string,
  tripId: string,
): Promise<DeleteOutcome> {
  const deleted = await prisma.$transaction(async (tx) =>
    repository.deleteOwnedTrip(tx, userId, tripId),
  );
  return deleted ? { kind: "deleted" } : { kind: "not_found" };
}

// ---------------------------------------------------------------------------
// Stop mutations (M05-T03 Increment 3)
// ---------------------------------------------------------------------------

/**
 * Spec §7.2 add-stop response: `{ id, position, is_available: true, landmark }`
 * — exactly these keys, and NO `distance_from_previous_miles` (the client
 * reloads the trip for distances and the new `version`).
 */
export interface AddedStopRepresentation {
  id: string;
  position: number;
  is_available: true;
  landmark: AvailableLandmarkSummary;
}

export function toAddedStopRepresentation(
  row: repository.InsertedStopRow,
): AddedStopRepresentation {
  return {
    id: row.id,
    position: row.position,
    is_available: true,
    landmark: {
      id: row.landmarkId,
      display_name: row.displayName,
      category: categoryValueToSlug(row.category),
      latitude: row.latitude,
      longitude: row.longitude,
    },
  };
}

/** Spec §3.2: a trip has at most 25 stops. */
export const MAX_TRIP_STOPS = 25;

export type AddStopOutcome =
  | { kind: "added"; stop: AddedStopRepresentation }
  | { kind: "not_found" }
  | { kind: "already_exists" }
  | { kind: "limit_reached" };

/**
 * Adds a landmark to the end of the user's trip (spec §6.4 "Add stop", as
 * amended 2026-11-23; ADR-014 decision 4 clarification). Under the trip-row
 * lock, in order: (1) trip missing or not owned → not_found; (2) landmark
 * missing, inactive, SENSITIVE, or UNREVIEWED → not_found; (3) visible
 * landmark already in the trip → already_exists; (4) 25 stops →
 * limit_reached; (5) insert at position = count (visibility re-checked and
 * `ON CONFLICT … DO NOTHING` in the same statement), then version + 1.
 *
 * If the insert unexpectedly inserts nothing (the landmark stopped being
 * visible, or a duplicate appeared, between the inspection and the insert —
 * both prevented in practice by the lock, but handled), the state is
 * re-inspected and the outcome is not_found or already_exists by the same
 * precedence; the version is not changed and no landmark data is returned.
 */
export async function addTripStop(
  prisma: PrismaClient,
  userId: string,
  tripId: string,
  landmarkId: string,
): Promise<AddStopOutcome> {
  return prisma.$transaction(async (tx): Promise<AddStopOutcome> => {
    if (!(await repository.lockOwnedTrip(tx, userId, tripId))) return { kind: "not_found" };

    const before = await repository.inspectStopAddition(tx, tripId, landmarkId);
    if (!before.visible) return { kind: "not_found" };
    if (before.alreadyInTrip) return { kind: "already_exists" };
    if (before.stopCount >= MAX_TRIP_STOPS) return { kind: "limit_reached" };

    const inserted = await repository.insertVisibleStop(tx, tripId, landmarkId, before.stopCount);
    if (!inserted) {
      const after = await repository.inspectStopAddition(tx, tripId, landmarkId);
      if (!after.visible) return { kind: "not_found" };
      if (after.alreadyInTrip) return { kind: "already_exists" };
      throw new Error("trips service: a stop was neither inserted nor already present");
    }
    await repository.bumpLockedTripVersion(tx, userId, tripId);
    return { kind: "added", stop: toAddedStopRepresentation(inserted) };
  });
}

export type RemoveStopOutcome = { kind: "removed" } | { kind: "not_found" };

/**
 * Removes one stop from the user's trip and closes the gap in one statement
 * (spec §§6.2, 6.4). A stop that is not in this trip — missing, or in another
 * trip — is not_found, and nothing (including `version`) changes. Works for a
 * stop whose landmark is no longer available.
 */
export async function removeTripStop(
  prisma: PrismaClient,
  userId: string,
  tripId: string,
  stopId: string,
): Promise<RemoveStopOutcome> {
  return prisma.$transaction(async (tx): Promise<RemoveStopOutcome> => {
    if (!(await repository.lockOwnedTrip(tx, userId, tripId))) return { kind: "not_found" };
    if (!(await repository.deleteStopAndCloseGap(tx, tripId, stopId))) {
      return { kind: "not_found" };
    }
    await repository.bumpLockedTripVersion(tx, userId, tripId);
    return { kind: "removed" };
  });
}

export type ReorderOutcome =
  | { kind: "reordered"; trip: OwnerTripRepresentation }
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "invalid_stop_ids" };

/**
 * Replaces the order of the user's trip's stops (spec §§6.3, 6.4). Under the
 * trip-row lock: a `version` that is not the locked row's → version_conflict;
 * then the list must be exactly the trip's current stop set (the request
 * schema already guarantees it is non-empty, at most 25, and duplicate-free)
 * → otherwise invalid_stop_ids, the same outcome whether an ID is unknown or
 * belongs to another trip; then one statement rewrites every position,
 * version + 1, and the committed trip is returned. Nothing changes on any
 * refusal.
 */
export async function reorderTripStops(
  prisma: PrismaClient,
  userId: string,
  tripId: string,
  input: { stopIds: readonly string[]; version: number },
  options: TripsServiceOptions,
): Promise<ReorderOutcome> {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await repository.lockOwnedTrip(tx, userId, tripId);
    if (!locked) return { kind: "not_found" } as const;
    if (input.version !== locked.version) return { kind: "version_conflict" } as const;

    const current = new Set(await repository.listStopIds(tx, tripId));
    const requested = new Set(input.stopIds);
    if (
      requested.size !== input.stopIds.length ||
      requested.size !== current.size ||
      input.stopIds.some((id) => !current.has(id))
    ) {
      return { kind: "invalid_stop_ids" } as const;
    }

    const updated = await repository.rewriteStopPositions(tx, tripId, input.stopIds);
    if (updated !== current.size) {
      throw new Error("trips service: a reorder did not update every stop");
    }
    await repository.bumpLockedTripVersion(tx, userId, tripId);
    const trip = await repository.findOwnedTrip(tx, userId, tripId);
    if (!trip) throw new Error("trips service: a reordered trip could not be read back");
    return { kind: "reordered", trip, stops: await repository.findTripStops(tx, tripId) } as const;
  });
  if (result.kind !== "reordered") return result;
  return {
    kind: "reordered",
    trip: toOwnerTripRepresentation(result.trip, result.stops, options),
  };
}

// ---------------------------------------------------------------------------
// Sharing (M05-T03 Increment 5)
// ---------------------------------------------------------------------------

export interface EnableSharingOptions extends TripsServiceOptions {
  /** The configured public origin (`env.auth.baseUrl`), as for password-reset links. */
  publicOrigin: string;
}

export type EnableSharingOutcome =
  { kind: "shared"; shareUrl: string } | { kind: "not_found" } | { kind: "sharing_unavailable" };

/**
 * Enables or rotates the user's trip's share link (spec §§5.4, 6.4, 10.3).
 * Under the trip-row lock: (1) trip missing or not owned → not_found, the same
 * whether sharing is on or off (T3-2 revised); (2) `sharingEnabled` off →
 * sharing_unavailable, nothing changed; (3) a fresh token's hash REPLACES any
 * previous hash — so the previous link stops working in the same commit —
 * then version + 1. The raw token is returned only inside `shareUrl`, after
 * the transaction commits; it is never stored. A hash collision (≈ 2⁻²⁵⁶)
 * violates the unique index and becomes a 500 (T3-7).
 */
export async function enableTripSharing(
  prisma: PrismaClient,
  userId: string,
  tripId: string,
  options: EnableSharingOptions,
): Promise<EnableSharingOutcome> {
  const token = await prisma.$transaction(async (tx) => {
    if (!(await repository.lockOwnedTrip(tx, userId, tripId)))
      return { kind: "not_found" } as const;
    if (!options.sharingEnabled) return { kind: "sharing_unavailable" } as const;
    const fresh = generateShareToken();
    await repository.setLockedTripShareHash(tx, userId, tripId, hashShareToken(fresh));
    return { kind: "shared", token: fresh } as const;
  });
  if (token.kind !== "shared") return token;
  return { kind: "shared", shareUrl: buildShareUrl(options.publicOrigin, token.token) };
}

export type RevokeSharingOutcome = { kind: "revoked" } | { kind: "not_found" };

/**
 * Revokes the user's trip's share link (spec §§5.4, 6.4): under the trip-row
 * lock, clears the hash and increments `version` exactly once. Allowed
 * whether sharing is on or off (T3-1), so an owner can always turn a link
 * off. Revoking a trip that has no active link is also a successful revoke
 * (204; version + 1), keeping the operation idempotent for the client.
 */
export async function revokeTripSharing(
  prisma: PrismaClient,
  userId: string,
  tripId: string,
): Promise<RevokeSharingOutcome> {
  return prisma.$transaction(async (tx): Promise<RevokeSharingOutcome> => {
    if (!(await repository.lockOwnedTrip(tx, userId, tripId))) return { kind: "not_found" };
    await repository.setLockedTripShareHash(tx, userId, tripId, null);
    return { kind: "revoked" };
  });
}

/**
 * Spec §7.2 shared trip: `{ name, stops, distance_summary }` only — no trip
 * ID, owner, version, timestamps, or sharing state. Stops are the same
 * objects as the owner view (same redaction, same distances).
 */
export interface SharedTripRepresentation {
  name: string;
  stops: StopRepresentation[];
  distance_summary: DistanceSummary;
}

export type SharedTripOutcome =
  { kind: "found"; trip: SharedTripRepresentation } | { kind: "not_found" };

/**
 * The public read of a shared trip (spec §§4, 5.4, 7.2, 10.3, 10.6). While
 * sharing is off, and for a value without token syntax, the answer is
 * not_found WITHOUT any database access. Otherwise the token is hashed and
 * resolved, and the trip and its stops are read in one REPEATABLE READ
 * transaction with the same visibility and distance SQL as the owner view.
 */
export async function getSharedTrip(
  prisma: PrismaClient,
  shareToken: unknown,
  options: TripsServiceOptions,
): Promise<SharedTripOutcome> {
  if (!options.sharingEnabled || !isShareTokenSyntax(shareToken)) return { kind: "not_found" };
  const hash = hashShareToken(shareToken);
  const result = await prisma.$transaction(
    async (tx) => {
      const trip = await repository.findTripByShareHash(tx, hash);
      if (!trip) return null;
      return { name: trip.name, stops: await repository.findTripStops(tx, trip.id) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  if (!result) return { kind: "not_found" };
  const stops = result.stops.map(toStopRepresentation);
  return {
    kind: "found",
    trip: { name: result.name, stops, distance_summary: toDistanceSummary(stops) },
  };
}
