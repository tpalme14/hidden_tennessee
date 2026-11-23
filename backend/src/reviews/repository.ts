import type { PrismaClient } from "@prisma/client";

/**
 * The ONLY data access for `reviews` (M04-T02 Increment 2; ADR-013
 * decisions 1–7; specs/RATINGS_REVIEWS_SPEC.md v1.1 §§4–7).
 *
 * Ownership (ADR-012 decision 3): every function that touches one user's
 * review takes the authenticated user's ID as a required argument and applies
 * it INSIDE the SQL statement — as the inserted `user_id`, or as
 * `WHERE user_id = …` — never as a check after an unscoped fetch.
 *
 * Visibility (ADR-013 decision 6): a landmark is visible when it exists, is
 * active, and is `PUBLIC`. Create, update, the own-review lookup, and the
 * public list check visibility in the SAME statement as their read or write,
 * so there is no check-then-act gap. Delete never consults `landmarks`, so an
 * author can always delete their review and nothing about the landmark leaks.
 *
 * Every value is a bound parameter of a tagged `$queryRaw`/`$executeRaw`.
 * `user_id` is never selected, and no landmark column is ever returned.
 *
 * `updated_at`: raw SQL bypasses Prisma's client-side `@updatedAt`, so the
 * insert relies on the column's database default and the update assigns
 * `now()` explicitly (ADR-013 decision 3; not guaranteed strictly increasing).
 */

const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A programming error (identity or ID not validated upstream) — surfaces as a 500, never as client input handling. */
function assertUuid(value: string, name: string): void {
  if (typeof value !== "string" || !UUID_SYNTAX.test(value)) {
    throw new Error(`reviews repository: ${name} is not a UUID`);
  }
}

function assertRating(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("reviews repository: rating is not an integer from 1 through 5");
  }
}

/** One stored review, without its owner. */
export interface ReviewRow {
  id: string;
  rating: number;
  body: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawReviewColumns {
  id: string | null;
  rating: number | null;
  body: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

function toReviewRow(raw: RawReviewColumns): ReviewRow | null {
  if (raw.id === null) return null;
  return {
    id: raw.id,
    rating: raw.rating as number,
    body: raw.body,
    createdAt: raw.created_at as Date,
    updatedAt: raw.updated_at as Date,
  };
}

export interface CreateReviewResult {
  /** The landmark exists, is active, and is PUBLIC. */
  visible: boolean;
  /** The inserted review; `null` when not visible or when the user already has one. */
  review: ReviewRow | null;
}

/**
 * Creates the user's review of a visible landmark in ONE statement: the
 * visibility check, the insert, and the duplicate handling share a single
 * snapshot. `ON CONFLICT (user_id, landmark_id) DO NOTHING` makes a concurrent
 * duplicate wait for the other transaction: if it commits, nothing is inserted
 * here (`visible: true, review: null` → duplicate); if it rolls back, this
 * statement inserts. No unique-violation error ever reaches the caller.
 */
export async function createReview(
  prisma: PrismaClient,
  userId: string,
  input: { landmarkId: string; rating: number; body: string | null },
): Promise<CreateReviewResult> {
  assertUuid(userId, "userId");
  assertUuid(input.landmarkId, "landmarkId");
  assertRating(input.rating);

  const [row] = await prisma.$queryRaw<(RawReviewColumns & { visible: number })[]>`
    WITH visible AS (
      SELECT id FROM landmarks
      WHERE id = ${input.landmarkId}::uuid AND is_active AND sensitivity_status = 'PUBLIC'
    ), ins AS (
      INSERT INTO reviews (user_id, landmark_id, rating, body)
      SELECT ${userId}::uuid, id, ${input.rating}::int, ${input.body}::text FROM visible
      ON CONFLICT (user_id, landmark_id) DO NOTHING
      RETURNING id, rating, body, created_at, updated_at
    )
    SELECT (SELECT count(*) FROM visible)::int AS visible,
           ins.id::text AS id, ins.rating, ins.body, ins.created_at, ins.updated_at
    FROM (SELECT 1) AS one
    LEFT JOIN ins ON true
  `;
  if (!row) throw new Error("reviews repository: create returned no row");
  return { visible: row.visible > 0, review: toReviewRow(row) };
}

/**
 * Updates the user's OWN review, only while its landmark is visible, and
 * assigns `updated_at = now()` on every successful update (even when the
 * submitted values equal the stored ones). An omitted field keeps its value.
 * Returns `null` — one outcome, never distinguished — when the review does not
 * exist, belongs to another user, or its landmark is not visible (A2).
 */
export async function updateReview(
  prisma: PrismaClient,
  userId: string,
  reviewId: string,
  patch: { rating?: number; body?: string | null },
): Promise<ReviewRow | null> {
  assertUuid(userId, "userId");
  assertUuid(reviewId, "reviewId");
  const setRating = patch.rating !== undefined;
  const setBody = patch.body !== undefined;
  if (!setRating && !setBody) throw new Error("reviews repository: empty patch");
  if (setRating) assertRating(patch.rating as number);

  const rows = await prisma.$queryRaw<RawReviewColumns[]>`
    UPDATE reviews AS r
    SET rating = CASE WHEN ${setRating}::boolean THEN ${patch.rating ?? null}::int ELSE r.rating END,
        body = CASE WHEN ${setBody}::boolean THEN ${patch.body ?? null}::text ELSE r.body END,
        updated_at = now()
    FROM landmarks AS l
    WHERE r.id = ${reviewId}::uuid
      AND r.user_id = ${userId}::uuid
      AND l.id = r.landmark_id
      AND l.is_active
      AND l.sensitivity_status = 'PUBLIC'
    RETURNING r.id::text AS id, r.rating, r.body, r.created_at, r.updated_at
  `;
  return rows[0] ? toReviewRow(rows[0]) : null;
}

/**
 * Deletes the user's OWN review by its ID, whatever the landmark's state
 * (spec §§4.2, 7; ADR-013 decision 6). Never joins `landmarks`. Returns
 * `false` — one outcome — for a missing review or another user's review.
 */
export async function deleteReview(
  prisma: PrismaClient,
  userId: string,
  reviewId: string,
): Promise<boolean> {
  assertUuid(userId, "userId");
  assertUuid(reviewId, "reviewId");
  const count = await prisma.$executeRaw`
    DELETE FROM reviews WHERE id = ${reviewId}::uuid AND user_id = ${userId}::uuid
  `;
  return count > 0;
}

export interface OwnReviewResult {
  visible: boolean;
  review: ReviewRow | null;
}

/**
 * The user's own review of a landmark, only while the landmark is visible
 * (A3). `{ visible: false }` for a missing, retired, SENSITIVE, or UNREVIEWED
 * landmark, without saying which and without any review data.
 */
export async function findOwnReview(
  prisma: PrismaClient,
  userId: string,
  landmarkId: string,
): Promise<OwnReviewResult> {
  assertUuid(userId, "userId");
  assertUuid(landmarkId, "landmarkId");

  const [row] = await prisma.$queryRaw<(RawReviewColumns & { visible: number })[]>`
    WITH visible AS (
      SELECT id FROM landmarks
      WHERE id = ${landmarkId}::uuid AND is_active AND sensitivity_status = 'PUBLIC'
    )
    SELECT (SELECT count(*) FROM visible)::int AS visible,
           r.id::text AS id, r.rating, r.body, r.created_at, r.updated_at
    FROM (SELECT 1) AS one
    LEFT JOIN reviews AS r
      ON r.user_id = ${userId}::uuid AND r.landmark_id IN (SELECT id FROM visible)
  `;
  if (!row) throw new Error("reviews repository: lookup returned no row");
  const visible = row.visible > 0;
  return { visible, review: visible ? toReviewRow(row) : null };
}

export interface PublicListResult {
  visible: boolean;
  /** All reviews of the landmark, independent of pagination. */
  ratingCount: number;
  /**
   * `sum(rating)::float8 / count(*)` — the correctly rounded double of the
   * exact arithmetic mean, never rounded for display (R5); `null` when the
   * count is zero.
   */
  averageRating: number | null;
  rows: ReviewRow[];
  hasMore: boolean;
}

/**
 * One page of a visible landmark's reviews, newest first with a stable
 * tie-break (`created_at DESC, id DESC`, spec §6), plus the aggregate over ALL
 * its reviews. The visibility check, the aggregate, and the page are ONE
 * statement, so the count and the page always come from the same snapshot.
 * Fetches one extra row to compute `hasMore`.
 */
export async function listPublicReviews(
  prisma: PrismaClient,
  landmarkId: string,
  page: { limit: number; offset: number },
): Promise<PublicListResult> {
  assertUuid(landmarkId, "landmarkId");

  const raw = await prisma.$queryRaw<
    (RawReviewColumns & { visible: number; rating_count: number; average_rating: number | null })[]
  >`
    WITH visible AS (
      SELECT id FROM landmarks
      WHERE id = ${landmarkId}::uuid AND is_active AND sensitivity_status = 'PUBLIC'
    ), agg AS (
      SELECT count(*)::int AS rating_count,
             CASE WHEN count(*) = 0 THEN NULL ELSE sum(rating)::float8 / count(*) END AS average_rating
      FROM reviews
      WHERE landmark_id IN (SELECT id FROM visible)
    ), page AS (
      SELECT id, rating, body, created_at, updated_at
      FROM reviews
      WHERE landmark_id IN (SELECT id FROM visible)
      ORDER BY created_at DESC, id DESC
      LIMIT ${page.limit + 1}
      OFFSET ${page.offset}
    )
    SELECT (SELECT count(*) FROM visible)::int AS visible,
           agg.rating_count, agg.average_rating,
           p.id::text AS id, p.rating, p.body, p.created_at, p.updated_at
    FROM agg
    LEFT JOIN page AS p ON true
    ORDER BY p.created_at DESC, p.id DESC
  `;

  const first = raw[0];
  if (!first) throw new Error("reviews repository: list returned no row");
  if (first.visible === 0) {
    return { visible: false, ratingCount: 0, averageRating: null, rows: [], hasMore: false };
  }
  const reviews = raw.map(toReviewRow).filter((r): r is ReviewRow => r !== null);
  return {
    visible: true,
    ratingCount: first.rating_count,
    averageRating: first.rating_count === 0 ? null : first.average_rating,
    rows: reviews.slice(0, page.limit),
    hasMore: reviews.length > page.limit,
  };
}
