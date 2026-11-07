import { Prisma, type PrismaClient } from "@prisma/client";
import type { LandmarkCollectionQuery } from "./query-schema.js";
import { escapeLikePattern } from "./like-escape.js";

const MILES_TO_METERS = 1609.344;

export interface LandmarkRow {
  id: string;
  displayName: string;
  category: string;
  sensitivityStatus: string;
  isActive: boolean;
  latitude: number;
  longitude: number;
  sourceDescription: string | null;
  sourceAccessLabel: string | null;
  sourceUrl: string | null;
  distanceMiles: number | null;
}

interface RawRow {
  id: string;
  display_name: string;
  category: string;
  sensitivity_status: string;
  is_active: boolean;
  latitude: number;
  longitude: number;
  source_description: string | null;
  source_access_label: string | null;
  source_url: string | null;
  distance_meters: number | null;
}

function mapRawRow(row: RawRow): LandmarkRow {
  return {
    id: row.id,
    displayName: row.display_name,
    category: row.category,
    sensitivityStatus: row.sensitivity_status,
    isActive: row.is_active,
    latitude: row.latitude,
    longitude: row.longitude,
    sourceDescription: row.source_description,
    sourceAccessLabel: row.source_access_label,
    sourceUrl: row.source_url,
    distanceMiles: row.distance_meters === null || row.distance_meters === undefined
      ? null
      : row.distance_meters / MILES_TO_METERS,
  };
}

/**
 * Builds the WHERE-clause fragments shared, unmodified, between the page
 * query and the bounded truncation count below — the single mechanism that
 * keeps `is_truncated` honest for every filter combination, geographic or
 * not (see M01-T05 planning discussion on cross-filter pagination testing).
 *
 * Geographic discovery (`bbox`/`near`) is restricted at the SQL level to
 * active, PUBLIC landmarks only (spec §9.4a / decision approved during
 * M01-T05 planning) — a bbox match or a distance value is itself location
 * information, so this cannot be enforced only at the response-shaping
 * layer without leaking through inclusion/exclusion or ordering.
 */
function buildWhereFragments(query: LandmarkCollectionQuery): Prisma.Sql[] {
  const fragments: Prisma.Sql[] = [Prisma.sql`is_active = true`];
  const isGeographic = query.bbox !== null || query.near !== null;

  if (isGeographic) {
    fragments.push(Prisma.sql`sensitivity_status = 'PUBLIC'`);
  }

  if (query.categories) {
    fragments.push(Prisma.sql`category::text IN (${Prisma.join(query.categories)})`);
  }

  if (query.q) {
    const likePattern = `%${escapeLikePattern(query.q)}%`;
    fragments.push(Prisma.sql`display_name ILIKE ${likePattern} ESCAPE '\\'`);
  }

  if (query.bbox) {
    const { minLng, minLat, maxLng, maxLat } = query.bbox;
    fragments.push(
      Prisma.sql`ST_Intersects(location, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)::geography)`,
    );
  }

  if (query.near && query.radiusMiles) {
    const { lat, lng } = query.near;
    const radiusMeters = query.radiusMiles * MILES_TO_METERS;
    fragments.push(
      Prisma.sql`ST_DWithin(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusMeters})`,
    );
  }

  return fragments;
}

function buildOrderBy(query: LandmarkCollectionQuery): Prisma.Sql {
  if (query.near) {
    return Prisma.sql`ORDER BY distance_meters ASC, display_name ASC, id ASC`;
  }
  return Prisma.sql`ORDER BY display_name ASC, id ASC`;
}

export interface LandmarkCollectionResult {
  rows: LandmarkRow[];
  hasMore: boolean;
  isTruncated: boolean;
}

export async function fetchLandmarkCollection(
  prisma: PrismaClient,
  query: LandmarkCollectionQuery,
): Promise<LandmarkCollectionResult> {
  const whereClause = Prisma.join(buildWhereFragments(query), " AND ");
  const orderBy = buildOrderBy(query);
  const offset = (query.page - 1) * query.limit;

  const distanceSelect = query.near
    ? Prisma.sql`, ST_Distance(location, ST_SetSRID(ST_MakePoint(${query.near.lng}, ${query.near.lat}), 4326)::geography) AS distance_meters`
    : Prisma.sql`, NULL AS distance_meters`;

  // Fetch one extra row to determine `has_more` for the current page without a second query.
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      id, display_name, category::text AS category, sensitivity_status::text AS sensitivity_status,
      is_active, latitude, longitude, source_description, source_access_label, source_url
      ${distanceSelect}
    FROM landmarks
    WHERE ${whereClause}
    ${orderBy}
    LIMIT ${query.limit + 1}
    OFFSET ${offset}
  `;

  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);

  // Bounded count (capped at 201) over the identical WHERE clause: describes
  // the full matching result set, not the current page, without an
  // unbounded full-table count (spec §7.2's "efficient bounded count or
  // lookahead strategy").
  const [countRow] = await prisma.$queryRaw<{ count: bigint | number }[]>`
    SELECT count(*) AS count FROM (
      SELECT 1 FROM landmarks WHERE ${whereClause} LIMIT 201
    ) bounded
  `;
  const isTruncated = Number(countRow?.count ?? 0) > 200;

  return { rows: pageRows.map(mapRawRow), hasMore, isTruncated };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findLandmarkById(prisma: PrismaClient, id: string): Promise<LandmarkRow | null> {
  if (!UUID_PATTERN.test(id)) return null;

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      id, display_name, category::text AS category, sensitivity_status::text AS sensitivity_status,
      is_active, latitude, longitude, source_description, source_access_label, source_url,
      NULL AS distance_meters
    FROM landmarks WHERE id = ${id}::uuid
  `;
  return rows[0] ? mapRawRow(rows[0]) : null;
}
