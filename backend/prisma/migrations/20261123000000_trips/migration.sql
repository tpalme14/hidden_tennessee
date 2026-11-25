-- M05-T02 Increment 1 — trips and trip_stops tables (docs/DECISIONS.md ADR-014
-- decision 14, ADR-011 decisions 7 and 10, ADR-010; specs/TRIP_PLANNING_SPEC.md
-- v1.1 §§3, 6.4, 10.3; docs/IMPLEMENTATION_PLAN.md M05-T01 and M05-T02).
-- Authored per ADR-010: hand-written, then cross-checked against read-only
-- `prisma migrate diff` output, and applied only via `prisma migrate deploy` —
-- to landmarks_test first, then landmarks_dev.
--
-- This migration creates TWO new tables and touches NOTHING else: no column,
-- index, constraint, trigger, or row on `landmarks` (including the generated
-- `location` column and its GiST index), `users`, `favorites`, `reviews`, or
-- any identity table. The foreign keys below add constraints on the new tables
-- only.
--
-- ONE deliberate difference from `prisma migrate diff` output: Prisma would
-- create "trip_stops_trip_id_position_key" as an ordinary UNIQUE INDEX. It is
-- created here instead as a UNIQUE CONSTRAINT declared DEFERRABLE INITIALLY
-- IMMEDIATE (explained below). Prisma's schema language cannot express
-- deferrability, so future `prisma migrate diff` output may propose dropping
-- or recreating this constraint; such output must never be applied.

-- CreateTable
-- One row per trip, owned by one user. `version` is the optimistic-concurrency
-- counter (spec §3.1): starts at 0, incremented by every successful trip or
-- stop mutation, never changed by the database itself. `updated_at` has a
-- database default (ADR-013 decision 3 precedent) because the repository
-- writes with raw SQL, which bypasses Prisma's client-side `@updatedAt`; every
-- UPDATE must set `updated_at = now()` explicitly. `share_token_hash` is NULL
-- for a private trip, otherwise the lowercase hex SHA-256 digest of the share
-- token — never the token itself (spec §10.3).
CREATE TABLE "trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "share_token_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- One row per stop. `landmark_id` is the internal landmark UUID, never
-- `source_code`. Only `position` is ever updated, so there is no `updated_at`.
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "landmark_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- A share token resolves to at most one trip (spec §10.3); the lookup path for
-- the public shared-trip read. NULLs are not equal, so any number of trips may
-- be private.
CREATE UNIQUE INDEX "trips_share_token_hash_key" ON "trips"("share_token_hash");

-- CreateIndex
-- The owner's trip list order `updated_at DESC, id DESC` (spec §10.1).
CREATE INDEX "trips_user_id_updated_at_id_idx" ON "trips"("user_id", "updated_at" DESC, "id" DESC);

-- CreateIndex
-- Spec §3.2: a landmark appears at most once per trip. An ORDINARY
-- (non-deferrable) unique index on purpose: adding a stop uses it as the
-- `ON CONFLICT ("trip_id", "landmark_id") DO NOTHING` arbiter (spec §6.4), and
-- PostgreSQL refuses a deferrable constraint as an ON CONFLICT arbiter.
CREATE UNIQUE INDEX "trip_stops_trip_id_landmark_id_key" ON "trip_stops"("trip_id", "landmark_id");

-- AddForeignKey
-- RESTRICT: no user deletion can silently remove application data
-- (ADR-011 decision 7; Authentication and Favorites spec §10.2.6).
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE: deleting a trip deletes its stops, and nothing else (spec §3.2, §5.5).
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: retirement (is_active = false) keeps stops; the import never
-- deletes landmarks (spec §3.2).
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_landmark_id_fkey" FOREIGN KEY ("landmark_id") REFERENCES "landmarks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (not expressible in Prisma's schema language;
-- same pattern as the `landmarks` and `reviews` CHECK constraints).
-- ---------------------------------------------------------------------------

-- Spec §3.2, §6.4; ADR-014 decision 14. Stop positions are unique per trip,
-- checked at the END OF EACH STATEMENT rather than after each row.
--
-- Why DEFERRABLE: PostgreSQL checks an ordinary (non-deferrable) unique
-- constraint row by row, so a single UPDATE that rewrites several positions —
-- a reorder that swaps or reverses stops, or the shift that closes the gap
-- after a removal — fails as soon as one row momentarily takes a position
-- another row still holds, even though the final result is valid. Verified on
-- PostgreSQL 17.5 during M05-T01: reversing three positions in one
-- `UPDATE … FROM unnest(…)` fails with error 23505 under an ordinary unique
-- constraint and succeeds under a deferrable one.
--
-- Why INITIALLY IMMEDIATE (not INITIALLY DEFERRED): the check still runs at
-- the end of every statement, so a genuine duplicate position is reported by
-- the statement that causes it, not later at COMMIT.
--
-- It must be a UNIQUE CONSTRAINT (a unique index cannot be deferrable). Its
-- backing index has the same name Prisma expects for `@@unique([tripId,
-- position])`. Every future migration must preserve DEFERRABLE INITIALLY
-- IMMEDIATE; a catalog test asserts it.
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_position_key" UNIQUE ("trip_id", "position") DEFERRABLE INITIALLY IMMEDIATE;

-- Spec §3.2; M05-T02 decision D1. Positions 0–24. Together with the unique
-- (trip_id, position) constraint this limits a trip to at most 25 stops at
-- the database, as a backstop to the service's in-transaction check. It does
-- NOT guarantee contiguous positions (0 … n-1): a trip with stops at
-- positions 0 and 7 satisfies every constraint here. Contiguity is enforced
-- by the service (spec §3.2, §6.4; M05-T02 decision D2).
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_position_check" CHECK ("position" BETWEEN 0 AND 24);

-- Spec §3.1, §5.1.1; M05-T02 decision D5. Name length 1–100, where char_length
-- counts Unicode code points in a UTF-8 database. A backstop only: trimming
-- and the control-character and visible-character rules are enforced by the
-- service (ECMAScript and PostgreSQL character definitions differ), as for
-- review text (ADR-013 decision 2).
ALTER TABLE "trips" ADD CONSTRAINT "trips_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 100);

-- Spec §3.1; M05-T02 decision D6.
ALTER TABLE "trips" ADD CONSTRAINT "trips_version_check" CHECK ("version" >= 0);

-- Spec §10.3; M05-T02 decision D4. Only a lowercase hexadecimal SHA-256 digest
-- (64 characters) can be stored, so a raw share token (43 base64url
-- characters) can never be written here by mistake.
ALTER TABLE "trips" ADD CONSTRAINT "trips_share_token_hash_format_check" CHECK ("share_token_hash" IS NULL OR "share_token_hash" ~ '^[0-9a-f]{64}$');
