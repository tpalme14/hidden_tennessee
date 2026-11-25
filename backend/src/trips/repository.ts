import type { PrismaClient } from "@prisma/client";

/**
 * The ONLY data access for `trips` and `trip_stops` (M05-T03 Increment 2;
 * specs/TRIP_PLANNING_SPEC.md v1.1 §§3, 4, 5, 5.6, 6.4, 7.2, 10.1; ADR-014
 * decisions 4, 6, 7, 14).
 *
 * Ownership (ADR-012 decision 3): every function that reads or writes one
 * user's trip takes the authenticated user's ID as a required argument and
 * applies it INSIDE the SQL statement (`WHERE user_id = …`), never as a check
 * after an unscoped fetch. `findTripStops` and `findTripByShareHash` are the
 * exceptions by design: `findTripStops` takes only a trip ID and must be
 * called only for a trip the caller has already read or locked with its
 * owner's ID in the same transaction, or resolved from a share-token hash
 * (`findTripByShareHash`, the public shared view, Increment 5).
 *
 * Visibility (spec §4; ADR-014 decision 6): a stop is available only when its
 * landmark currently exists, is active, and is `PUBLIC` — evaluated in the
 * SAME statement that reads the stops. For an unavailable stop, the statement
 * returns NULL for every landmark field and for its distance, so no protected
 * value ever leaves the database for it.
 *
 * Distances (spec §5.6; ADR-014 decision 7): a leg joins adjacent positions
 * and is measured — `ST_Distance` on the `geography` column, as proximity
 * discovery does — only when BOTH stops are available; otherwise NULL. No
 * distance is computed across or around an unavailable stop.
 *
 * Every value is a bound parameter of a tagged `$queryRaw`/`$executeRaw`.
 * `user_id` and `share_token_hash` are never selected (only
 * `share_token_hash IS NOT NULL`). Raw SQL bypasses Prisma's client-side
 * `@updatedAt`, so inserts rely on the database defaults and every UPDATE
 * assigns `updated_at = now()` explicitly.
 */

/** The shared client or an interactive `$transaction` callback's `tx`. */
export type TripsExecutor = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A programming error (identity or ID not validated upstream) — surfaces as a 500, never as client input handling. */
function assertUuid(value: string, name: string): void {
  if (typeof value !== "string" || !UUID_SYNTAX.test(value)) {
    throw new Error(`trips repository: ${name} is not a UUID`);
  }
}

/** Meters per mile — the same constant proximity discovery uses. */
export const METERS_PER_MILE = 1609.344;

/** One stored trip, without its owner and without its share-token hash. */
export interface TripRow {
  id: string;
  name: string;
  version: number;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RawTripColumns {
  id: string;
  name: string;
  version: number;
  is_shared: boolean;
  created_at: Date;
  updated_at: Date;
}

function toTripRow(raw: RawTripColumns): TripRow {
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    isShared: raw.is_shared,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * One stop in position order. Every landmark field is `null` unless
 * `available` is true (enforced by the SQL, not by the caller).
 */
export interface StopRow {
  id: string;
  position: number;
  landmarkId: string;
  available: boolean;
  displayName: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The measured leg from the previous stop, in miles, unrounded; `null` when not measured. */
  distanceFromPreviousMiles: number | null;
}

interface RawStopColumns {
  id: string;
  position: number;
  landmark_id: string;
  available: boolean;
  display_name: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_meters: number | null;
}

/** Inserts a trip for the user; the database supplies the ID, version 0, and timestamps. */
export async function insertTrip(
  db: TripsExecutor,
  userId: string,
  name: string,
): Promise<TripRow> {
  assertUuid(userId, "userId");
  const [row] = await db.$queryRaw<RawTripColumns[]>`
    INSERT INTO trips (user_id, name) VALUES (${userId}::uuid, ${name})
    RETURNING id::text AS id, name, version, share_token_hash IS NOT NULL AS is_shared,
              created_at, updated_at
  `;
  if (!row) throw new Error("trips repository: insert returned no row");
  return toTripRow(row);
}

/** The user's trip, or `null` — one outcome for a missing trip and another user's trip. */
export async function findOwnedTrip(
  db: TripsExecutor,
  userId: string,
  tripId: string,
): Promise<TripRow | null> {
  assertUuid(userId, "userId");
  assertUuid(tripId, "tripId");
  const [row] = await db.$queryRaw<RawTripColumns[]>`
    SELECT id::text AS id, name, version, share_token_hash IS NOT NULL AS is_shared,
           created_at, updated_at
    FROM trips
    WHERE id = ${tripId}::uuid AND user_id = ${userId}::uuid
  `;
  return row ? toTripRow(row) : null;
}

/**
 * Locks the user's trip row for the rest of the current transaction
 * (`SELECT … FOR UPDATE`, spec §6.4) and returns its current version, or
 * `null` when the trip is missing or belongs to another user. Must be called
 * inside an interactive transaction; every trip mutation calls it first, so
 * mutations of one trip are serialized and mutations of different trips never
 * wait for each other.
 */
export async function lockOwnedTrip(
  tx: TripsExecutor,
  userId: string,
  tripId: string,
): Promise<{ version: number } | null> {
  assertUuid(userId, "userId");
  assertUuid(tripId, "tripId");
  const [row] = await tx.$queryRaw<{ version: number }[]>`
    SELECT version FROM trips
    WHERE id = ${tripId}::uuid AND user_id = ${userId}::uuid
    FOR UPDATE
  `;
  return row ?? null;
}

/**
 * Renames a trip the caller has ALREADY locked with `lockOwnedTrip`, and
 * increments `version` by exactly one and sets `updated_at = now()`. The
 * owner filter is repeated as defence in depth.
 */
export async function renameLockedTrip(
  tx: TripsExecutor,
  userId: string,
  tripId: string,
  name: string,
): Promise<boolean> {
  assertUuid(userId, "userId");
  assertUuid(tripId, "tripId");
  const count = await tx.$executeRaw`
    UPDATE trips SET name = ${name}, version = version + 1, updated_at = now()
    WHERE id = ${tripId}::uuid AND user_id = ${userId}::uuid
  `;
  return count === 1;
}

// ---------------------------------------------------------------------------
// Stop mutations (M05-T03 Increment 3; spec v1.1 §§6.1–6.4 as amended
// 2026-11-23; ADR-014 decision 4 and its clarification). Every function below
// must be called inside an interactive transaction AFTER `lockOwnedTrip` has
// locked the trip row for the same user, so the trip is known to be the
// caller's and its stops cannot change underneath.
// ---------------------------------------------------------------------------

/**
 * Increments a locked trip's `version` by exactly one and sets
 * `updated_at = now()` — called once per successful stop mutation.
 */
export async function bumpLockedTripVersion(
  tx: TripsExecutor,
  userId: string,
  tripId: string,
): Promise<void> {
  assertUuid(userId, "userId");
  assertUuid(tripId, "tripId");
  const count = await tx.$executeRaw`
    UPDATE trips SET version = version + 1, updated_at = now()
    WHERE id = ${tripId}::uuid AND user_id = ${userId}::uuid
  `;
  if (count !== 1) throw new Error("trips repository: a locked trip could not be updated");
}

/**
 * The add-stop pre-checks, in one statement (spec §6.4 steps 2–4 read
 * together): whether the landmark currently exists, is active, and is
 * `PUBLIC`; whether it is already a stop of the trip; and the trip's stop
 * count. Reveals nothing about a non-visible landmark beyond `visible: false`.
 */
export async function inspectStopAddition(
  tx: TripsExecutor,
  tripId: string,
  landmarkId: string,
): Promise<{ visible: boolean; alreadyInTrip: boolean; stopCount: number }> {
  assertUuid(tripId, "tripId");
  assertUuid(landmarkId, "landmarkId");
  const [row] = await tx.$queryRaw<
    { visible: boolean; already_in_trip: boolean; stop_count: number }[]
  >`
    SELECT
      EXISTS (SELECT 1 FROM landmarks
              WHERE id = ${landmarkId}::uuid AND is_active AND sensitivity_status = 'PUBLIC') AS visible,
      EXISTS (SELECT 1 FROM trip_stops
              WHERE trip_id = ${tripId}::uuid AND landmark_id = ${landmarkId}::uuid) AS already_in_trip,
      (SELECT count(*) FROM trip_stops WHERE trip_id = ${tripId}::uuid)::int AS stop_count
  `;
  if (!row) throw new Error("trips repository: inspection returned no row");
  return { visible: row.visible, alreadyInTrip: row.already_in_trip, stopCount: row.stop_count };
}

/** A newly inserted stop with its (visible) landmark's summary fields. */
export interface InsertedStopRow {
  id: string;
  position: number;
  landmarkId: string;
  displayName: string;
  category: string;
  latitude: number;
  longitude: number;
}

/**
 * Inserts a stop at `position`, re-checking the landmark's visibility IN THE
 * SAME STATEMENT, with `ON CONFLICT (trip_id, landmark_id) DO NOTHING` as the
 * uniqueness backstop (spec §6.4 step 5). The landmark's summary comes from
 * that same statement's snapshot, so the returned fields can only belong to a
 * landmark that was visible when the stop was inserted. `null` when nothing
 * was inserted (the landmark is no longer visible, or the stop already
 * exists); the caller decides which by re-inspecting.
 */
export async function insertVisibleStop(
  tx: TripsExecutor,
  tripId: string,
  landmarkId: string,
  position: number,
): Promise<InsertedStopRow | null> {
  assertUuid(tripId, "tripId");
  assertUuid(landmarkId, "landmarkId");
  if (!Number.isInteger(position) || position < 0) {
    throw new Error("trips repository: position is not a non-negative integer");
  }
  const [row] = await tx.$queryRaw<
    {
      id: string;
      position: number;
      landmark_id: string;
      display_name: string;
      category: string;
      latitude: number;
      longitude: number;
    }[]
  >`
    WITH visible AS (
      SELECT id, display_name, category, latitude, longitude
      FROM landmarks
      WHERE id = ${landmarkId}::uuid AND is_active AND sensitivity_status = 'PUBLIC'
    ), inserted AS (
      INSERT INTO trip_stops (trip_id, landmark_id, position)
      SELECT ${tripId}::uuid, id, ${position}::int FROM visible
      ON CONFLICT (trip_id, landmark_id) DO NOTHING
      RETURNING id, position, landmark_id
    )
    SELECT i.id::text AS id, i.position, i.landmark_id::text AS landmark_id,
           v.display_name, v.category::text AS category, v.latitude, v.longitude
    FROM inserted AS i JOIN visible AS v ON v.id = i.landmark_id
  `;
  if (!row) return null;
  return {
    id: row.id,
    position: row.position,
    landmarkId: row.landmark_id,
    displayName: row.display_name,
    category: row.category,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

/**
 * Deletes one stop of the trip and shifts every later stop down by one, in ONE
 * statement (spec §§6.2, 6.4). The shift is valid only because the
 * `(trip_id, position)` unique constraint is DEFERRABLE INITIALLY IMMEDIATE
 * (checked at the end of the statement). Returns `false`, changing nothing,
 * when the stop does not exist in this trip (including a stop of another
 * trip).
 */
export async function deleteStopAndCloseGap(
  tx: TripsExecutor,
  tripId: string,
  stopId: string,
): Promise<boolean> {
  assertUuid(tripId, "tripId");
  assertUuid(stopId, "stopId");
  const [row] = await tx.$queryRaw<{ deleted: number }[]>`
    WITH deleted AS (
      DELETE FROM trip_stops
      WHERE id = ${stopId}::uuid AND trip_id = ${tripId}::uuid
      RETURNING position
    ), shifted AS (
      UPDATE trip_stops
      SET position = position - 1
      WHERE trip_id = ${tripId}::uuid AND position > (SELECT position FROM deleted)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM deleted)::int AS deleted,
           (SELECT count(*) FROM shifted)::int AS shifted
  `;
  return (row?.deleted ?? 0) === 1;
}

/** The IDs of a trip's stops (any order). */
export async function listStopIds(tx: TripsExecutor, tripId: string): Promise<string[]> {
  assertUuid(tripId, "tripId");
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM trip_stops WHERE trip_id = ${tripId}::uuid
  `;
  return rows.map((r) => r.id);
}

/**
 * Rewrites every listed stop's position to its index in `stopIds`, in ONE
 * statement (spec §§6.3, 6.4) — valid only because of the DEFERRABLE
 * INITIALLY IMMEDIATE `(trip_id, position)` constraint. The caller must
 * already have checked that `stopIds` is exactly the trip's stop set; this
 * returns the number of rows updated so the caller can assert it.
 */
export async function rewriteStopPositions(
  tx: TripsExecutor,
  tripId: string,
  stopIds: readonly string[],
): Promise<number> {
  assertUuid(tripId, "tripId");
  stopIds.forEach((id) => assertUuid(id, "stopId"));
  return tx.$executeRaw`
    UPDATE trip_stops AS s
    SET position = (v.ordinal - 1)::int
    FROM unnest(${[...stopIds]}::uuid[]) WITH ORDINALITY AS v(id, ordinal)
    WHERE s.trip_id = ${tripId}::uuid AND s.id = v.id
  `;
}

/**
 * Deletes the user's trip in one statement; its stops go with it through the
 * `trip_stops.trip_id` ON DELETE CASCADE foreign key, and nothing else is
 * touched. `false` — one outcome — for a missing trip or another user's trip.
 */
export async function deleteOwnedTrip(
  db: TripsExecutor,
  userId: string,
  tripId: string,
): Promise<boolean> {
  assertUuid(userId, "userId");
  assertUuid(tripId, "tripId");
  const count = await db.$executeRaw`
    DELETE FROM trips WHERE id = ${tripId}::uuid AND user_id = ${userId}::uuid
  `;
  return count > 0;
}

// ---------------------------------------------------------------------------
// Sharing (M05-T03 Increment 5; spec v1.1 §§4, 5.4, 6.4, 10.3; ADR-014
// decision 10). Only hashes cross this boundary; raw tokens never do.
// ---------------------------------------------------------------------------

const SHARE_HASH_SYNTAX = /^[0-9a-f]{64}$/;

/**
 * Replaces (a hash) or clears (`null`) the share-token hash of a trip the
 * caller has ALREADY locked with `lockOwnedTrip`, increments `version` by
 * exactly one, and sets `updated_at = now()` (spec §6.4). The owner filter is
 * repeated as defence in depth.
 */
export async function setLockedTripShareHash(
  tx: TripsExecutor,
  userId: string,
  tripId: string,
  shareTokenHash: string | null,
): Promise<void> {
  assertUuid(userId, "userId");
  assertUuid(tripId, "tripId");
  if (shareTokenHash !== null && !SHARE_HASH_SYNTAX.test(shareTokenHash)) {
    throw new Error("trips repository: share token hash is not a SHA-256 hex digest");
  }
  const count = await tx.$executeRaw`
    UPDATE trips
    SET share_token_hash = ${shareTokenHash}, version = version + 1, updated_at = now()
    WHERE id = ${tripId}::uuid AND user_id = ${userId}::uuid
  `;
  if (count !== 1) throw new Error("trips repository: a locked trip could not be updated");
}

/**
 * The trip whose current share-token hash is `shareTokenHash`, or `null`
 * (unknown, revoked, or rotated away). Returns only the ID — for reading its
 * stops in the same transaction, never for a response — and the name.
 */
export async function findTripByShareHash(
  db: TripsExecutor,
  shareTokenHash: string,
): Promise<{ id: string; name: string } | null> {
  if (!SHARE_HASH_SYNTAX.test(shareTokenHash)) {
    throw new Error("trips repository: share token hash is not a SHA-256 hex digest");
  }
  const [row] = await db.$queryRaw<{ id: string; name: string }[]>`
    SELECT id::text AS id, name FROM trips WHERE share_token_hash = ${shareTokenHash}
  `;
  return row ?? null;
}

/** One row of the owner's trip list. */
export interface TripListRow {
  id: string;
  name: string;
  stopCount: number;
  isShared: boolean;
  updatedAt: Date;
}

/**
 * One page of the user's trips, `updated_at DESC, id DESC` (spec §10.1), with
 * each trip's stop count. Fetches one extra row to compute `hasMore`.
 */
export async function listOwnedTrips(
  db: TripsExecutor,
  userId: string,
  page: { limit: number; offset: number },
): Promise<{ rows: TripListRow[]; hasMore: boolean }> {
  assertUuid(userId, "userId");
  const raw = await db.$queryRaw<
    { id: string; name: string; stop_count: number; is_shared: boolean; updated_at: Date }[]
  >`
    SELECT t.id::text AS id, t.name,
           (SELECT count(*) FROM trip_stops s WHERE s.trip_id = t.id)::int AS stop_count,
           t.share_token_hash IS NOT NULL AS is_shared,
           t.updated_at
    FROM trips AS t
    WHERE t.user_id = ${userId}::uuid
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT ${page.limit + 1}
    OFFSET ${page.offset}
  `;
  const rows = raw.map((r) => ({
    id: r.id,
    name: r.name,
    stopCount: r.stop_count,
    isShared: r.is_shared,
    updatedAt: r.updated_at,
  }));
  return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
}

/**
 * A trip's stops in position order, with read-time visibility and the
 * straight-line leg from each stop's predecessor. Call only for a trip already
 * read or locked with its owner's ID (see the module comment).
 *
 * The landmark is LEFT JOINed so a missing landmark (impossible under the
 * RESTRICT foreign key, but specified) is treated as unavailable.
 */
export async function findTripStops(db: TripsExecutor, tripId: string): Promise<StopRow[]> {
  assertUuid(tripId, "tripId");
  const raw = await db.$queryRaw<RawStopColumns[]>`
    WITH s AS (
      SELECT ts.id, ts.position, ts.landmark_id,
             COALESCE(l.is_active AND l.sensitivity_status = 'PUBLIC', false) AS available,
             l.display_name, l.category, l.latitude, l.longitude, l.location
      FROM trip_stops AS ts
      LEFT JOIN landmarks AS l ON l.id = ts.landmark_id
      WHERE ts.trip_id = ${tripId}::uuid
    ), w AS (
      SELECT s.*,
             LAG(s.available) OVER (ORDER BY s.position) AS previous_available,
             LAG(s.location) OVER (ORDER BY s.position) AS previous_location
      FROM s
    )
    SELECT w.id::text AS id, w.position, w.landmark_id::text AS landmark_id, w.available,
           CASE WHEN w.available THEN w.display_name END AS display_name,
           CASE WHEN w.available THEN w.category::text END AS category,
           CASE WHEN w.available THEN w.latitude END AS latitude,
           CASE WHEN w.available THEN w.longitude END AS longitude,
           CASE WHEN w.available AND COALESCE(w.previous_available, false)
                THEN ST_Distance(w.previous_location, w.location) END AS distance_meters
    FROM w
    ORDER BY w.position
  `;
  return raw.map((r) => ({
    id: r.id,
    position: r.position,
    landmarkId: r.landmark_id,
    available: r.available,
    displayName: r.display_name,
    category: r.category,
    latitude: r.latitude,
    longitude: r.longitude,
    distanceFromPreviousMiles:
      r.distance_meters === null ? null : r.distance_meters / METERS_PER_MILE,
  }));
}
