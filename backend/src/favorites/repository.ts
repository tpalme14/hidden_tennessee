import type { PrismaClient } from "@prisma/client";

/**
 * The ONLY data access for `favorites` (M03-T05 Increment 2).
 *
 * Ownership (ADR-012 decision 3): every function takes the authenticated
 * user's ID as a required argument and applies it INSIDE the SQL statement —
 * as the inserted `user_id`, or as `WHERE user_id = …` — never as a check
 * after an unscoped fetch. No function looks a favorite up by its own ID.
 * Every value is a bound parameter of a tagged `$queryRaw`.
 *
 * The favorite's own ID, the user ID, `created_at`, and the landmark's
 * `source_*` columns are never selected.
 */

const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A programming error (identity or ID not validated upstream) — surfaces as a 500, never as client input handling. */
function assertUuid(value: string, name: string): void {
  if (typeof value !== "string" || !UUID_SYNTAX.test(value)) {
    throw new Error(`favorites repository: ${name} is not a UUID`);
  }
}

export interface AddFavoriteResult {
  /** The landmark exists, is active, and is PUBLIC (decision D1). */
  eligible: boolean;
  /** This statement inserted the row. */
  created: boolean;
}

/**
 * Ensures (user, landmark) is favorited, in ONE statement: the eligibility
 * check, the insert, and the duplicate handling share a single snapshot, so
 * there is no gap between checking and inserting.
 *
 * - Ineligible (unknown, retired, UNREVIEWED, SENSITIVE): nothing is inserted
 *   and an existing saved row is left in place (`eligible: false`).
 * - `ON CONFLICT (user_id, landmark_id) DO NOTHING` makes a concurrent
 *   duplicate wait for the other transaction: if it commits, this statement
 *   inserts nothing (`created: false`); if it rolls back, this one inserts.
 *   No unique-violation error ever reaches the caller.
 */
export async function addFavorite(
  prisma: PrismaClient,
  userId: string,
  landmarkId: string,
): Promise<AddFavoriteResult> {
  assertUuid(userId, "userId");
  assertUuid(landmarkId, "landmarkId");

  const [row] = await prisma.$queryRaw<{ eligible: number; created: number }[]>`
    WITH eligible AS (
      SELECT id FROM landmarks
      WHERE id = ${landmarkId}::uuid AND is_active AND sensitivity_status = 'PUBLIC'
    ), ins AS (
      INSERT INTO favorites (user_id, landmark_id)
      SELECT ${userId}::uuid, id FROM eligible
      ON CONFLICT (user_id, landmark_id) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT count(*) FROM eligible)::int AS eligible,
           (SELECT count(*) FROM ins)::int      AS created
  `;
  return { eligible: (row?.eligible ?? 0) > 0, created: (row?.created ?? 0) > 0 };
}

/**
 * Ensures (user, landmark) is not favorited. Never consults `landmarks`, so a
 * retired or reclassified favorite can always be removed. `removed` is for
 * internal use and tests only — the API response never differs (decision D2).
 */
export async function removeFavorite(
  prisma: PrismaClient,
  userId: string,
  landmarkId: string,
): Promise<{ removed: boolean }> {
  assertUuid(userId, "userId");
  assertUuid(landmarkId, "landmarkId");

  const count = await prisma.$executeRaw`
    DELETE FROM favorites WHERE user_id = ${userId}::uuid AND landmark_id = ${landmarkId}::uuid
  `;
  return { removed: count > 0 };
}

export interface FavoriteListRow {
  landmarkId: string;
  displayName: string;
  category: string;
  sensitivityStatus: string;
  isActive: boolean;
  latitude: number;
  longitude: number;
}

interface RawListRow {
  landmark_id: string;
  display_name: string;
  category: string;
  sensitivity_status: string;
  is_active: boolean;
  latitude: number;
  longitude: number;
}

/**
 * One page of the user's favorites, newest first with a stable tie-break
 * (`created_at DESC, id ASC` — decision D5, matching the listing index).
 * Fetches one extra row to compute `hasMore`. Visibility is decided by the
 * service through the central redaction module, not here (decision E4).
 */
export async function listFavorites(
  prisma: PrismaClient,
  userId: string,
  page: { limit: number; offset: number },
): Promise<{ rows: FavoriteListRow[]; hasMore: boolean }> {
  assertUuid(userId, "userId");

  const raw = await prisma.$queryRaw<RawListRow[]>`
    SELECT f.landmark_id::text AS landmark_id, l.display_name, l.category::text AS category,
           l.sensitivity_status::text AS sensitivity_status, l.is_active, l.latitude, l.longitude
    FROM favorites f
    JOIN landmarks l ON l.id = f.landmark_id
    WHERE f.user_id = ${userId}::uuid
    ORDER BY f.created_at DESC, f.id ASC
    LIMIT ${page.limit + 1}
    OFFSET ${page.offset}
  `;

  const hasMore = raw.length > page.limit;
  const rows = raw.slice(0, page.limit).map((r) => ({
    landmarkId: r.landmark_id,
    displayName: r.display_name,
    category: r.category,
    sensitivityStatus: r.sensitivity_status,
    isActive: r.is_active,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
  return { rows, hasMore };
}
