-- M04-T02 Increment 1 — reviews table (docs/DECISIONS.md ADR-013 decisions
-- 1–3, ADR-011 decisions 7 and 10; specs/RATINGS_REVIEWS_SPEC.md v1.1 §§3,
-- 4.1, 10.1; docs/IMPLEMENTATION_PLAN.md M04-T01 and M04-T02). Authored per
-- ADR-010: hand-written, then cross-checked against read-only
-- `prisma migrate diff` output, and applied only via `prisma migrate deploy` —
-- to landmarks_test first, then landmarks_dev.
--
-- This migration creates ONE new table and touches NOTHING else: no column,
-- index, constraint, trigger, or row on `landmarks` (including the generated
-- `location` column and its GiST index), `users`, `favorites`, or any
-- identity table. The two foreign keys below add constraints on `reviews`
-- only.

-- CreateTable
-- One row per (user, landmark). `landmark_id` is the internal landmark UUID,
-- never `source_code`. `updated_at` has a database default (ADR-013 decision
-- 3) because the repository writes with raw SQL, which bypasses Prisma's
-- client-side `@updatedAt`; every UPDATE must set `updated_at = now()`
-- explicitly, and it is not guaranteed to increase strictly.
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "landmark_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Spec §3/§4.1: at most one review per (user, landmark), enforced by the
-- database under concurrent requests. Also the conflict target that makes
-- create a single atomic statement, and the lookup path for the
-- authenticated own-review lookup.
CREATE UNIQUE INDEX "reviews_user_id_landmark_id_key" ON "reviews"("user_id", "landmark_id");

-- CreateIndex
-- Public list order `created_at DESC, id DESC` (spec §6): an ordered index
-- walk with no sort. The per-landmark aggregate uses it only to locate the
-- landmark's rows (ADR-013 decision 1; no covering index by design).
CREATE INDEX "reviews_landmark_id_created_at_id_idx" ON "reviews"("landmark_id", "created_at" DESC, "id" DESC);

-- AddForeignKey
-- RESTRICT: no user deletion can silently remove application data
-- (ADR-011 decision 7; Authentication and Favorites spec §10.2.6).
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: retirement (is_active = false) keeps reviews; the import never
-- deletes landmarks (spec §2.5, §7).
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_landmark_id_fkey" FOREIGN KEY ("landmark_id") REFERENCES "landmarks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (not expressible in Prisma's schema language and
-- therefore absent from `prisma migrate diff` output; same pattern as the
-- `landmarks` CHECK constraints). ADR-013 decision 2.
-- ---------------------------------------------------------------------------

-- Spec §3, §10.1.1: integer rating from 1 through 5.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range_check" CHECK ("rating" BETWEEN 1 AND 5);

-- Spec §3, §4.1, §10.1.2: body is NULL or 1–2,000 characters, where
-- char_length counts Unicode code points in a UTF-8 database. Trimming,
-- NUL rejection, and well-formedness are enforced by the service; this
-- constraint is a backstop for writes that bypass it (ECMAScript and
-- PostgreSQL whitespace definitions differ, so trimming is not repeated
-- here).
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_body_length_check" CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 2000);
